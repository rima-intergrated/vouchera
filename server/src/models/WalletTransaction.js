import mongoose from 'mongoose';

export const WALLET_TXN_TYPES = ['TOP_UP', 'DEBIT'];
export const WALLET_TXN_METHODS = ['CASH', 'TRANSFER'];
export const WALLET_TXN_TARGETS = ['WALLET', 'GIFT_CARD'];

// Append-only money movement for customer wallets (and later gift cards).
// Balances change ONLY through these records — never by direct edit.
// Mirrors the VoucherRedemption immutability guarantees.
const txnSchema = new mongoose.Schema(
  {
    customer: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', default: null, index: true },
    type: { type: String, enum: WALLET_TXN_TYPES, required: true, index: true },
    amount: { type: Number, required: true, min: 0.01 },
    previousBalance: { type: Number, required: true, min: 0 },
    newBalance: { type: Number, required: true, min: 0 },
    method: { type: String, enum: WALLET_TXN_METHODS, required: true },
    // Payment proof (transfer ref / receipt no). Unique when present so a
    // transfer can never be credited twice.
    paymentReference: { type: String, trim: true, default: undefined },
    // Proof of payment for TRANSFER credits (bytes in GridFS; served via an
    // authenticated download, never a public URL).
    proof: {
      fileId: { type: mongoose.Schema.Types.ObjectId, default: undefined },
      filename: { type: String, default: undefined },
      mimetype: { type: String, default: undefined },
      size: { type: Number, default: undefined },
    },
    target: { type: String, enum: WALLET_TXN_TARGETS, default: 'WALLET' },
    voucher: { type: mongoose.Schema.Types.ObjectId, ref: 'Voucher', default: null },
    store: { type: mongoose.Schema.Types.ObjectId, ref: 'Store', default: null },
    performedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    // Client-generated UUID for safe retries (replay protection)
    idempotencyKey: { type: String, default: undefined },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

txnSchema.index({ customer: 1, createdAt: -1 });
txnSchema.index(
  { paymentReference: 1 },
  { unique: true, partialFilterExpression: { paymentReference: { $type: 'string' } } }
);
txnSchema.index(
  { idempotencyKey: 1 },
  { unique: true, partialFilterExpression: { idempotencyKey: { $type: 'string' } } }
);

// Immutable — corrections are new compensating entries, never edits.
txnSchema.pre('findOneAndUpdate', function () {
  throw new Error('WalletTransaction records are immutable');
});
txnSchema.pre('updateOne', function () {
  throw new Error('WalletTransaction records are immutable');
});
txnSchema.pre('findOneAndDelete', function () {
  throw new Error('WalletTransaction records are immutable');
});

const WalletTransaction = mongoose.model('WalletTransaction', txnSchema);
export default WalletTransaction;

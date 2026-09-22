import mongoose from 'mongoose';

export const LOYALTY_TXN_TYPES = ['EARN', 'REDEEM', 'ADJUST'];

// Append-only points ledger. Mirrors the WalletTransaction immutability
// guarantees: point balances change ONLY through these records.
const loyaltySchema = new mongoose.Schema(
  {
    customer: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', required: true, index: true },
    type: { type: String, enum: LOYALTY_TXN_TYPES, required: true, index: true },
    points: { type: Number, required: true, min: 1 },
    // MWK 2dp: earn base (amount spent) for EARN, discount value for REDEEM.
    cashValue: { type: Number, required: true, min: 0 },
    previousPoints: { type: Number, required: true, min: 0 },
    newPoints: { type: Number, required: true, min: 0 },
    store: { type: mongoose.Schema.Types.ObjectId, ref: 'Store', default: null },
    performedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    // Redemption that triggered this entry (earn source / redeem tender).
    redemption: { type: mongoose.Schema.Types.ObjectId, ref: 'VoucherRedemption', default: null },
    // Client-generated UUID for safe retries (replay protection)
    idempotencyKey: { type: String, default: undefined },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

loyaltySchema.index({ customer: 1, createdAt: -1 });
loyaltySchema.index(
  { idempotencyKey: 1 },
  { unique: true, partialFilterExpression: { idempotencyKey: { $type: 'string' } } }
);

// Immutable — corrections are new ADJUST entries, never edits.
loyaltySchema.pre('findOneAndUpdate', function () {
  throw new Error('LoyaltyTransaction records are immutable');
});
loyaltySchema.pre('updateOne', function () {
  throw new Error('LoyaltyTransaction records are immutable');
});
loyaltySchema.pre('findOneAndDelete', function () {
  throw new Error('LoyaltyTransaction records are immutable');
});

const LoyaltyTransaction = mongoose.model('LoyaltyTransaction', loyaltySchema);
export default LoyaltyTransaction;

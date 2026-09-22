import mongoose from 'mongoose';

export const TOPUP_REQUEST_STATUSES = ['PENDING', 'APPROVED', 'REJECTED'];

// Maker-checker for large credits: a non-admin captures the top-up (with
// proof of payment); nothing moves until an ADMIN approves or rejects.
// On approval the stored details replay through creditWallet, so the money
// path keeps its atomicity + idempotency guarantees.
const topUpRequestSchema = new mongoose.Schema(
  {
    customer: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', required: true, index: true },
    amount: { type: Number, required: true, min: 0.01 },
    method: { type: String, enum: ['CASH', 'TRANSFER'], required: true },
    paymentReference: { type: String, trim: true, default: undefined },
    proof: {
      fileId: { type: mongoose.Schema.Types.ObjectId, default: undefined },
      filename: { type: String, default: undefined },
      mimetype: { type: String, default: undefined },
      size: { type: Number, default: undefined },
    },
    store: { type: mongoose.Schema.Types.ObjectId, ref: 'Store', default: null },
    requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    status: { type: String, enum: TOPUP_REQUEST_STATUSES, default: 'PENDING', index: true },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    reviewedAt: { type: Date, default: null },
    reviewNote: { type: String, default: '', maxlength: 500 },
    resultingTxn: { type: mongoose.Schema.Types.ObjectId, ref: 'WalletTransaction', default: null },
    idempotencyKey: { type: String, default: undefined },
  },
  { timestamps: true }
);

topUpRequestSchema.index({ status: 1, createdAt: -1 });
topUpRequestSchema.index(
  { idempotencyKey: 1 },
  { unique: true, partialFilterExpression: { idempotencyKey: { $type: 'string' } } }
);

const TopUpRequest = mongoose.model('TopUpRequest', topUpRequestSchema);
export default TopUpRequest;

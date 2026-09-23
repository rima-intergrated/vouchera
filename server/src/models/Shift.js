import mongoose from 'mongoose';

export const SHIFT_STATUSES = ['OPEN', 'CLOSED'];

// Cashier shift for end-of-day reconciliation: the system computes what the
// drawer should hold (cash top-ups received + cash tenders collected, VISA
// slips, stored-value legs) from the immutable ledgers; the cashier declares
// counted cash at close and the variance is reported. One OPEN shift max per
// cashier (partial unique index below).
const shiftSchema = new mongoose.Schema(
  {
    cashier: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    store: { type: mongoose.Schema.Types.ObjectId, ref: 'Store', required: true, index: true },
    openedAt: { type: Date, default: Date.now, index: true },
    closedAt: { type: Date, default: null },
    status: { type: String, enum: SHIFT_STATUSES, default: 'OPEN', index: true },
    // Counted cash in drawer at close (declared by the cashier).
    declaredCash: { type: Number, default: null, min: 0 },
    // System-computed expectations from ledger windows at close time.
    expectedCash: { type: Number, default: null, min: 0 },
    expectedVisa: { type: Number, default: null, min: 0 },
    expectedStored: { type: Number, default: null, min: 0 },
    topupsCashReceived: { type: Number, default: null, min: 0 },
    redemptionCount: { type: Number, default: 0, min: 0 },
    topupCount: { type: Number, default: 0, min: 0 },
    varianceCash: { type: Number, default: null },
    note: { type: String, default: '', maxlength: 500 },
  },
  { timestamps: true }
);

shiftSchema.index(
  { cashier: 1, status: 1 },
  { unique: true, partialFilterExpression: { status: 'OPEN' } }
);

const Shift = mongoose.model('Shift', shiftSchema);
export default Shift;

import mongoose from 'mongoose';

// Immutable redemption record: created once, never updated (except explicitly
// controlled admin corrections in a later phase via a separate corrective entry).
//
// Required Phase-2 fields:
//   voucher, voucherCode, amountRedeemed, cashier, store,
//   posTransactionReference, redemptionReference, redeemedAt, metadata
// Audit extensions (from core concept + security requirements):
//   previousBalance / newBalance (balance audit trail),
//   idempotencyKey (replay protection for safe client retries).
// G4: wallet debits share this table (source WALLET) so till history,
// reports and audit stay unified. For WALLET rows the voucher fields are
// empty and the wallet/customer fields carry the identity instead.
// LOYALTY rows record points-funded discounts (amountRedeemed = MWK value,
// metadata.pointsUsed = points consumed).
const isVoucherSource = function () {
  return this.source !== 'WALLET' && this.source !== 'LOYALTY';
};
const redemptionSchema = new mongoose.Schema(
  {
    source: { type: String, enum: ['VOUCHER', 'GIFT_CARD', 'WALLET', 'LOYALTY'], default: 'VOUCHER', index: true },
    voucher: { type: mongoose.Schema.Types.ObjectId, ref: 'Voucher', default: null, required: isVoucherSource, index: true },
    voucherCode: { type: String, uppercase: true, trim: true, default: undefined, required: isVoucherSource, index: true },
    customer: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', default: null },
    walletCode: { type: String, uppercase: true, trim: true, default: undefined },
    amountRedeemed: { type: Number, required: true, min: 0.01 },
    previousBalance: { type: Number, required: true, min: 0 },
    newBalance: { type: Number, required: true, min: 0 },
    // Till tender split: amountRedeemed is the stored-value leg; when outside
    // money completed the sale, billTotal + tender* record the whole receipt
    // so every sale self-balances (stored + external = bill). NONE = the
    // stored value covered the bill (or the bill is unknown to Vouchera).
    billTotal: { type: Number, default: null, min: 0 },
    tenderMethod: { type: String, enum: ['NONE', 'CASH', 'VISA'], default: 'NONE', index: true },
    tenderAmount: { type: Number, default: 0, min: 0 },
    tenderReference: { type: String, trim: true, default: undefined },
    cashier: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    store: { type: mongoose.Schema.Types.ObjectId, ref: 'Store', required: true, index: true },
    posTransactionReference: { type: String, required: true, trim: true },
    // Unique human-friendly reference shown on the cashier success screen (e.g. VR-829174)
    redemptionReference: { type: String, required: true, unique: true, uppercase: true, trim: true },
    redeemedAt: { type: Date, default: Date.now, index: true },
    // Device/session info (ip, userAgent) and any future context
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
    // Client-generated UUID for safe retries (replay protection).
    // Partial index below enforces uniqueness only when a key is present.
    idempotencyKey: { type: String, default: undefined },
  },
  { timestamps: false }
);

// Duplicate-redemption protection: same POS ref cannot be reused within one store
redemptionSchema.index({ store: 1, posTransactionReference: 1 }, { unique: true });
redemptionSchema.index({ voucher: 1, redeemedAt: -1 });
// Reporting pipelines
redemptionSchema.index({ store: 1, redeemedAt: -1 });
redemptionSchema.index({ cashier: 1, redeemedAt: -1 });
// Unique only when a key is supplied (multiple keyless records allowed)
redemptionSchema.index(
  { idempotencyKey: 1 },
  { unique: true, partialFilterExpression: { idempotencyKey: { $type: 'string' } } }
);

// Enforce immutability at the ODM layer
redemptionSchema.pre('findOneAndUpdate', function () {
  throw new Error('VoucherRedemption records are immutable');
});
redemptionSchema.pre('updateOne', function () {
  throw new Error('VoucherRedemption records are immutable');
});
redemptionSchema.pre('findOneAndDelete', function () {
  throw new Error('VoucherRedemption records are immutable');
});
redemptionSchema.pre('deleteOne', { document: true, query: false }, function () {
  throw new Error('VoucherRedemption records are immutable');
});

const VoucherRedemption = mongoose.model('VoucherRedemption', redemptionSchema);
export default VoucherRedemption;

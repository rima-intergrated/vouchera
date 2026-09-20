import mongoose from 'mongoose';

export const VOUCHER_TYPES = [
  'FIXED_VALUE',
  'GIFT_CARD',
  'PERCENTAGE',
  'PRODUCT',
  'DEPARTMENT',
  'CAMPAIGN',
];

export const VOUCHER_STATUSES = [
  'DRAFT',
  'ACTIVE',
  'PARTIALLY_REDEEMED',
  'FULLY_REDEEMED',
  'EXPIRED',
  'CANCELLED',
  'SUSPENDED',
];

const voucherSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, unique: true, uppercase: true, trim: true },
    // MVP prioritizes FIXED_VALUE; other types are architected in but enforced per-type in Phase 2+
    type: { type: String, enum: VOUCHER_TYPES, default: 'FIXED_VALUE', index: true },
    originalValue: { type: Number, required: true, min: 0 },
    remainingBalance: { type: Number, required: true, min: 0 },
    totalRedeemed: { type: Number, default: 0, min: 0 },
    redemptionCount: { type: Number, default: 0, min: 0 },
    status: { type: String, enum: VOUCHER_STATUSES, default: 'DRAFT', index: true },
    issueDate: { type: Date, default: Date.now },
    expiryDate: { type: Date, required: true, index: true },
    customer: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', default: null },
    campaign: { type: mongoose.Schema.Types.ObjectId, ref: 'Campaign', default: null },
    // Empty array = valid at all stores; non-empty = restricted to listed stores
    validStores: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Store' }],
    restrictions: {
      minPurchase: { type: Number, default: 0, min: 0 },
      notes: { type: String, default: '', maxlength: 500 },
      // Per-type extension points (validated in service layer, Phase 2+):
      percentOff: { type: Number, default: null, min: 0, max: 100 },
      productSku: { type: String, default: null },
      department: { type: String, default: null },
    },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
);

voucherSchema.index({ status: 1, expiryDate: 1 });
voucherSchema.index({ customer: 1 });
voucherSchema.index({ campaign: 1 });
// Reporting pipelines
voucherSchema.index({ createdAt: -1 });
voucherSchema.index({ campaign: 1, status: 1 });
voucherSchema.index({ expiryDate: 1, status: 1 });

const Voucher = mongoose.model('Voucher', voucherSchema);
export default Voucher;

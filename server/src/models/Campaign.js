import mongoose from 'mongoose';
import { VOUCHER_TYPES } from './Voucher.js';

export const CAMPAIGN_STATUSES = ['DRAFT', 'ACTIVE', 'PAUSED', 'ENDED'];

const campaignSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 150 },
    code: { type: String, required: true, unique: true, uppercase: true, trim: true },
    description: { type: String, default: '', maxlength: 1000 },
    startsAt: { type: Date, default: null },
    endsAt: { type: Date, default: null },
    // Voucher blueprint used by bulk generation
    voucherType: { type: String, enum: VOUCHER_TYPES, default: 'FIXED_VALUE' },
    voucherValue: { type: Number, default: 0, min: 0 },
    voucherQuantity: { type: Number, default: 0, min: 0, validate: { validator: Number.isInteger, message: 'Quantity must be whole' } },
    // Empty = all Shopwise stores
    eligibleStores: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Store' }],
    terms: { type: String, default: '', maxlength: 2000 },
    status: { type: String, enum: CAMPAIGN_STATUSES, default: 'DRAFT', index: true },
    // Mirrors status === 'ACTIVE' so legacy ?active=true queries keep working
    isActive: { type: Boolean, default: false, index: true },
    generatedCount: { type: Number, default: 0, min: 0 },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
);

const Campaign = mongoose.model('Campaign', campaignSchema);
export default Campaign;

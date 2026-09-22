import mongoose from 'mongoose';

// Closed-set system settings (ADMIN-managed). Only keys declared in
// KNOWN_SETTINGS can exist — no arbitrary configuration at runtime.
export const KNOWN_SETTINGS = {
  'app.name': { type: 'string', min: 2, max: 60, default: 'Vouchera', description: 'Application display name' },
  'voucher.defaultExpiryDays': { type: 'integer', min: 1, max: 1825, default: 365, description: 'Default voucher expiry used by the creation form' },
  // Loyalty program (admin-managed, dynamic — no code deploys to change rates).
  'loyalty.pointsPer100MWK': { type: 'number', min: 0, max: 1000, default: 1, description: 'Points earned per MWK 100 spent (0 disables earning)' },
  'loyalty.mwkPerPoint': { type: 'number', min: 0.01, max: 10000, default: 1, description: 'Cash value (MWK) of one loyalty point when redeemed at the till' },
  'loyalty.minRedeemPoints': { type: 'integer', min: 1, max: 1000000, default: 100, description: 'Minimum points per redemption at the till' },
};

const settingSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true, trim: true },
    value: { type: mongoose.Schema.Types.Mixed, required: true },
    description: { type: String, default: '' },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
);

const Setting = mongoose.model('Setting', settingSchema);
export default Setting;

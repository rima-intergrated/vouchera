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
  // Top-up maker-checker: credits at/above this MWK amount entered by
  // non-admin staff wait for ADMIN approval instead of applying instantly.
  // 0 disables the gate (everything credits immediately — not recommended).
  'topup.approvalThresholdMWK': { type: 'number', min: 0, max: 100000000, default: 200000, description: 'Top-ups at/above this amount need admin approval (0 = off, not recommended)' },
  // Staff two-factor authentication: when 1, ADMIN and MANAGER logins
  // require a TOTP code (or mandatory enrollment on next login).
  'security.requireStaff2fa': { type: 'integer', min: 0, max: 1, default: 0, description: 'Require 2FA for admin/manager logins (0 = optional, 1 = required)' },
  // Short sessions for shared till devices (minutes). Applies to CASHIER
  // logins; other roles use JWT_EXPIRES_IN.
  'security.cashierSessionMinutes': { type: 'integer', min: 30, max: 1440, default: 480, description: 'Cashier session lifetime in minutes (shared tills: lower is safer)' },
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

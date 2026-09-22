import mongoose from 'mongoose';

const customerSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    // Optional identifiers: unique WHEN present (partial indexes below).
    // Never default these to null — a stored null would collide on a sparse
    // unique index the second time it appears.
    phone: { type: String, trim: true, default: undefined },
    email: { type: String, trim: true, lowercase: true, default: undefined },
    notes: { type: String, default: '', maxlength: 500 },
    // Stored-value wallet (2dp MWK). Changed ONLY via WalletTransaction
    // entries — never edited directly.
    walletBalance: { type: Number, default: 0, min: 0 },
    // Personal wallet code for the portal QR (code only, like vouchers)
    walletCode: { type: String, uppercase: true, trim: true, default: undefined },
    // 6-digit transaction PIN (bcrypt hash, never returned). Required to
    // authorise till debits from this account.
    pinHash: { type: String, default: undefined, select: false },
    pinSetAt: { type: Date, default: null },
    pinFailedAttempts: { type: Number, default: 0, min: 0 },
    pinLockedUntil: { type: Date, default: null },
    // Loyalty points (integer units, NOT cash). Cash value is derived via
    // loyalty.mwkPerPoint setting. Changed ONLY via LoyaltyTransaction entries.
    loyaltyPoints: { type: Number, default: 0, min: 0 },
    loyaltyLifetimeEarned: { type: Number, default: 0, min: 0 },
    loyaltyLifetimeRedeemed: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true }
);

customerSchema.index({ name: 1 });
customerSchema.index(
  { phone: 1 },
  { unique: true, partialFilterExpression: { phone: { $type: 'string' } } }
);
customerSchema.index(
  { email: 1 },
  { unique: true, partialFilterExpression: { email: { $type: 'string' } } }
);
customerSchema.index(
  { walletCode: 1 },
  { unique: true, partialFilterExpression: { walletCode: { $type: 'string' } } }
);

const Customer = mongoose.model('Customer', customerSchema);
export default Customer;

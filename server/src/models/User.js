import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

export const ROLES = ['ADMIN', 'MANAGER', 'CASHIER', 'AUDITOR', 'CUSTOMER'];

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    passwordHash: { type: String, required: true, select: false },
    role: { type: String, enum: ROLES, default: 'CASHIER', index: true },
    store: { type: mongoose.Schema.Types.ObjectId, ref: 'Store', default: null },
    // Portal login: links a CUSTOMER-role user to their Customer account.
    // Partial index below enforces one login per customer while allowing
    // any number of unlinked staff accounts.
    customer: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', default: undefined },
    // Invite onboarding: SHA-256 hash of the one-time signup token.
    inviteTokenHash: { type: String, default: undefined, select: false },
    inviteExpiresAt: { type: Date, default: null },
    inviteAcceptedAt: { type: Date, default: null },
    // Password-reset token (SHA-256 hash, single-use, 1h TTL)
    resetTokenHash: { type: String, default: undefined, select: false },
    resetExpiresAt: { type: Date, default: null },
    // Staff two-factor auth (TOTP). The secret is stored like a credential
    // (never returned); a production-hardened step would encrypt it at rest.
    totpSecret: { type: String, default: undefined, select: false },
    totpEnabled: { type: Boolean, default: false, index: true },
    totpEnabledAt: { type: Date, default: null },
    isActive: { type: Boolean, default: true, index: true },
  },
  { timestamps: true }
);

userSchema.index(
  { customer: 1 },
  { unique: true, partialFilterExpression: { customer: { $type: 'objectId' } } }
);

userSchema.methods.comparePassword = function (plain) {
  return bcrypt.compare(plain, this.passwordHash);
};

export async function hashPassword(plain) {
  const salt = await bcrypt.genSalt(10);
  return bcrypt.hash(plain, salt);
}

const User = mongoose.model('User', userSchema);
export default User;

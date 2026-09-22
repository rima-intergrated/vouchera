import crypto from 'node:crypto';
import Customer from '../models/Customer.js';
import User from '../models/User.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { audit } from '../utils/helpers.js';
import { hashPin, assertPinFormat } from '../services/pin.service.js';
import { env } from '../config/env.js';
import { sendDirect } from '../services/notification.service.js';

// POST /api/customers/me/pin — first-time set (CUSTOMER self-service).
// Refused if a PIN already exists (use change instead).
export const setPin = asyncHandler(async (req, res) => {
  const customerId = req.user.role === 'CUSTOMER'
    ? String(req.user.customer?._id || req.user.customer || '')
    : String(req.body.customerId || '');
  if (!customerId) throw ApiError.badRequest('customerId is required');
  assertPinFormat(req.body.pin);
  const customer = await Customer.findById(customerId).select('+pinHash');
  if (!customer) throw ApiError.notFound('Customer not found');
  if (customer.pinHash) throw ApiError.conflict('PIN already set — use change instead');
  customer.pinHash = await hashPin(req.body.pin);
  customer.pinSetAt = new Date();
  customer.pinFailedAttempts = 0;
  customer.pinLockedUntil = null;
  await customer.save();
  audit({ actor: req.user, action: 'customer.pin.set', entity: 'Customer', entityId: String(customer._id), req });
  res.status(201).json({ pinSet: true, pinSetAt: customer.pinSetAt });
});

// POST /api/customers/me/pin/change — requires current PIN (or staff override).
export const changePin = asyncHandler(async (req, res) => {
  const selfService = req.user.role === 'CUSTOMER';
  const customerId = selfService
    ? String(req.user.customer?._id || req.user.customer || '')
    : String(req.body.customerId || '');
  if (!customerId) throw ApiError.badRequest('customerId is required');
  assertPinFormat(req.body.newPin);
  const customer = await Customer.findById(customerId).select('+pinHash');
  if (!customer) throw ApiError.notFound('Customer not found');
  if (!customer.pinHash) throw ApiError.badRequest('No PIN set yet — set one first');

  if (selfService) {
    const bcrypt = (await import('bcryptjs')).default;
    const ok = await bcrypt.compare(String(req.body.currentPin || ''), customer.pinHash);
    if (!ok) throw ApiError.unauthorized('Current PIN is incorrect');
  }
  customer.pinHash = await hashPin(req.body.newPin);
  customer.pinSetAt = new Date();
  customer.pinFailedAttempts = 0;
  customer.pinLockedUntil = null;
  await customer.save();
  audit({ actor: req.user, action: 'customer.pin.change', entity: 'Customer', entityId: String(customer._id), req });
  res.json({ pinSet: true, pinSetAt: customer.pinSetAt });
});

function sha256(s) {
  return crypto.createHash('sha256').update(s).digest('hex');
}

const PIN_RESET_TTL_MS = 3600 * 1000;

function pinResetLink(token) {
  return `${env.clientUrl.replace(/\/$/, '')}/reset-pin?token=${token}`;
}

// POST /api/auth/forgot-pin — email link to reset a forgotten till PIN.
export const forgotPin = asyncHandler(async (req, res) => {
  const user = await User.findOne({ email: String(req.body.email || '').toLowerCase() });
  if (!user || !user.isActive || user.role !== 'CUSTOMER' || !user.customer) {
    throw ApiError.notFound('Email not recognised.');
  }
  const token = crypto.randomBytes(32).toString('hex');
  user.resetTokenHash = sha256(`pin:${token}`);
  user.resetExpiresAt = new Date(Date.now() + PIN_RESET_TTL_MS);
  await user.save();
  try {
    await sendDirect({
      channel: 'email',
      recipient: user.email,
      subject: 'Reset your Vouchera payment PIN',
      text: `Hello ${user.name},\n\nReset your 6-digit till payment PIN within 1 hour:\n\n${pinResetLink(token)}\n\nIf you did not request this, ignore this message.`,
      actor: user,
    });
  } catch {
    // Logged in the delivery log.
  }
  audit({ actor: user, action: 'auth.pin.reset.requested', entity: 'User', entityId: String(user._id), req });
  res.json({ message: 'A PIN reset link has been sent to your email address.' });
});

// POST /api/auth/reset-pin — single-use token, sets a new PIN on the linked account.
export const resetPin = asyncHandler(async (req, res) => {
  assertPinFormat(req.body.pin);
  const user = await User.findOne({ resetTokenHash: sha256(`pin:${String(req.body.token || '')}`) })
    .select('+resetTokenHash')
    .populate('customer');
  if (!user || !user.resetExpiresAt || user.resetExpiresAt < new Date()) {
    throw ApiError.badRequest('This PIN reset link is invalid or has expired. Request a new one.');
  }
  const customer = await Customer.findById(user.customer?._id || user.customer).select('+pinHash');
  if (!customer) throw ApiError.notFound('Customer account not found');
  customer.pinHash = await hashPin(req.body.pin);
  customer.pinSetAt = new Date();
  customer.pinFailedAttempts = 0;
  customer.pinLockedUntil = null;
  await customer.save();
  user.resetTokenHash = undefined;
  user.resetExpiresAt = null;
  // Burn an unusable password hash rotation is unnecessary — keep login intact.
  await user.save();
  audit({ actor: user, action: 'auth.pin.reset.completed', entity: 'Customer', entityId: String(customer._id), req });
  res.json({ pinSet: true });
});

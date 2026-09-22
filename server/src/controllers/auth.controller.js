import crypto from 'node:crypto';
import User, { hashPassword } from '../models/User.js';
import Store from '../models/Store.js';
import Customer from '../models/Customer.js';
import { env } from '../config/env.js';
import { sendDirect } from '../services/notification.service.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { signToken } from '../middleware/auth.js';
import { isTotpRole, staff2faRequired, sessionLifetime } from './twoFactor.controller.js';
import { signChallenge } from '../middleware/auth.js';
import { audit, generateVoucherCode } from '../utils/helpers.js';

function publicUser(u) {
  return {
    id: String(u._id),
    name: u.name,
    email: u.email,
    role: u.role,
    store: u.store ?? null,
    customer: u.customer ?? null,
    isActive: u.isActive,
    totpEnabled: !!u.totpEnabled,
  };
}

const CUSTOMER_POPULATE = { path: 'customer', select: 'name phone walletBalance walletCode' };

export const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  const user = await User.findOne({ email }).select('+passwordHash').populate('store', 'name code').populate(CUSTOMER_POPULATE);
  // Identical response for unknown, deactivated, or wrong-password accounts
  // (no user enumeration), but every failure is audit-logged for review.
  if (!user || !user.isActive) {
    audit({ actor: null, action: 'auth.login.failed', entity: 'User', metadata: { email, reason: 'unknown-or-inactive' }, req });
    throw ApiError.unauthorized('Invalid credentials');
  }
  const ok = await user.comparePassword(password);
  if (!ok) {
    audit({ actor: user, action: 'auth.login.failed', entity: 'User', entityId: String(user._id), metadata: { email, reason: 'bad-password' }, req });
    throw ApiError.unauthorized('Invalid credentials');
  }

  // Staff 2FA gate: enrolled staff always step up with a TOTP code; once the
  // admin enables security.requireStaff2fa, unenrolled staff must enroll on
  // the spot (challenge token, 5 min) instead of entering.
  if (isTotpRole(user.role) && (user.totpEnabled || (await staff2faRequired()))) {
    if (user.totpEnabled) {
      audit({ actor: user, action: 'auth.login.2fa.challenged', entity: 'User', entityId: String(user._id), req });
      return res.json({ requires2fa: true, mustEnroll: false, challengeToken: signChallenge(user, '2fa-challenge') });
    }
    audit({ actor: user, action: 'auth.login.2fa.enroll-required', entity: 'User', entityId: String(user._id), req });
    return res.json({ requires2fa: true, mustEnroll: true, challengeToken: signChallenge(user, '2fa-enroll') });
  }

  audit({ actor: user, action: 'auth.login', entity: 'User', entityId: String(user._id), req });
  const token = signToken(user, await sessionLifetime(user));
  res.json({ token, user: publicUser(user) });
});

export const me = asyncHandler(async (req, res) => {
  res.json({ user: publicUser(req.user) });
});

// Stateless JWT logout: the client discards the token; the server records
// the event for audit purposes. Returns 200 so the client can always
// complete logout locally, even if this call fails.
export const logout = asyncHandler(async (req, res) => {
  audit({ actor: req.user, action: 'auth.logout', entity: 'User', entityId: String(req.user._id), req });
  res.json({ message: 'Logged out' });
});

export const createUser = asyncHandler(async (req, res) => {
  const { name, email, password, role, store = null, customer = null } = req.body;
  const exists = await User.findOne({ email });
  if (exists) throw ApiError.conflict('Email already exists');
  if (store) {
    const storeDoc = await Store.findOne({ _id: store, isActive: true });
    if (!storeDoc) throw ApiError.badRequest('Store not found');
  }
  if (customer) {
    const customerDoc = await Customer.findById(customer);
    if (!customerDoc) throw ApiError.badRequest('Customer not found');
    if (role !== 'CUSTOMER') throw ApiError.badRequest('Only CUSTOMER users link to a customer account');
  }
  if (role === 'CUSTOMER' && !customer) throw ApiError.badRequest('CUSTOMER users require a customer account');

  // With a password: immediate active account (legacy path). Without one:
  // invite onboarding — the user sets their own password via signup link.
  if (password) {
    const passwordHash = await hashPassword(password);
    const user = await User.create({ name, email, passwordHash, role, store, customer });
    audit({
      actor: req.user,
      action: 'user.create',
      entity: 'User',
      entityId: String(user._id),
      metadata: { email, role },
      req,
    });
    return res.status(201).json({ user: publicUser(user) });
  }

  const { user, invite } = await issueInvite({ name, email, role, store, customer }, req.user, req);
  return res.status(201).json({ user: publicUser(user), invite });
});

const INVITE_TTL_MS = 72 * 3600 * 1000;

function sha256(s) {
  return crypto.createHash('sha256').update(s).digest('hex');
}

function inviteLink(token) {
  return `${env.clientUrl.replace(/\/$/, '')}/accept-invite?token=${token}`;
}

// Attempt the signup email; failures never block the invite — the link is
// always returned so the admin can share it manually (copy/WhatsApp/email).
async function tryInviteEmail(user, link, actor) {
  try {
    await sendDirect({
      channel: 'email',
      recipient: user.email,
      subject: 'Your Vouchera account — set your password',
      text: `Hello ${user.name},\n\nAn account was created for you on Vouchera (${user.role}). Set your password within 72 hours:\n\n${link}\n\nIf you did not expect this, ignore this message.`,
      actor,
    });
    return { emailed: true };
  } catch (err) {
    if (err?.status === 400) throw err;
    return { emailed: false, emailError: err?.message || 'Email delivery failed' };
  }
}

async function issueInvite({ name, email, role, store, customer }, actor, req) {
  const token = crypto.randomBytes(32).toString('hex');
  // Unusable random secret — login is impossible until the invite is accepted.
  const passwordHash = await hashPassword(crypto.randomBytes(32).toString('hex'));
  const user = await User.create({
    name,
    email,
    passwordHash,
    role,
    store,
    customer,
    inviteTokenHash: sha256(token),
    inviteExpiresAt: new Date(Date.now() + INVITE_TTL_MS),
  });
  const link = inviteLink(token);
  const { emailed, emailError } = await tryInviteEmail(user, link, actor);
  audit({
    actor,
    action: 'user.invite',
    entity: 'User',
    entityId: String(user._id),
    metadata: { email, role, emailed },
    req,
  });
  return {
    user,
    invite: {
      link,
      expiresAt: user.inviteExpiresAt,
      emailed,
      ...(emailError ? { emailError } : {}),
    },
  };
}

// Public signup-link acceptance: sets the password, burns the token, logs in.
export const acceptInvite = asyncHandler(async (req, res) => {
  const { token, password } = req.body;
  const user = await User.findOne({ inviteTokenHash: sha256(String(token || '')) })
    .select('+inviteTokenHash')
    .populate('store', 'name code')
    .populate('customer', 'name phone walletBalance walletCode');
  if (!user || !user.inviteExpiresAt || user.inviteExpiresAt < new Date()) {
    throw ApiError.badRequest('This invite link is invalid or has expired. Ask your administrator for a new one.');
  }
  user.passwordHash = await hashPassword(password);
  user.inviteTokenHash = undefined;
  user.inviteExpiresAt = null;
  user.inviteAcceptedAt = new Date();
  await user.save();
  audit({ actor: user, action: 'user.invite.accepted', entity: 'User', entityId: String(user._id), req });
  res.json({ token: signToken(user, await sessionLifetime(user)), user: publicUser(user) });
});

// Regenerate an invite link (ADMIN). Refused once the invite was accepted.
export const reinviteUser = asyncHandler(async (req, res) => {
  const target = await User.findById(req.params.id).select('+inviteTokenHash');
  if (!target) throw ApiError.notFound('User not found');
  if (target.inviteAcceptedAt || !target.inviteTokenHash) {
    throw ApiError.badRequest('Invite already accepted — use password reset instead');
  }
  const token = crypto.randomBytes(32).toString('hex');
  target.inviteTokenHash = sha256(token);
  target.inviteExpiresAt = new Date(Date.now() + INVITE_TTL_MS);
  await target.save();
  const link = inviteLink(token);
  const { emailed, emailError } = await tryInviteEmail(target, link, req.user);
  audit({ actor: req.user, action: 'user.reinvite', entity: 'User', entityId: String(target._id), metadata: { email: target.email, emailed }, req });
  res.json({ invite: { link, expiresAt: target.inviteExpiresAt, emailed, ...(emailError ? { emailError } : {}) } });
});

const RESET_TTL_MS = 3600 * 1000;

function resetLink(token) {
  return `${env.clientUrl.replace(/\/$/, '')}/reset-password?token=${token}`;
}

// Public reset request. Unknown addresses are rejected outright (note: this
// lets callers probe for registered emails; the auth rate limiter is the
// backstop against bulk enumeration).
export const forgotPassword = asyncHandler(async (req, res) => {
  const { email } = req.body;
  const user = await User.findOne({ email });
  if (!user || !user.isActive) {
    throw ApiError.notFound('Email not recognised. Please verify your details or click "Register" below.');
  }
  const token = crypto.randomBytes(32).toString('hex');
  user.resetTokenHash = sha256(token);
  user.resetExpiresAt = new Date(Date.now() + RESET_TTL_MS);
  await user.save();
  try {
    await sendDirect({
      channel: 'email',
      recipient: user.email,
      subject: 'Reset your Vouchera password',
      text: `Hello ${user.name},\n\nReset your Vouchera password within 1 hour:\n\n${resetLink(token)}\n\nIf you did not request this, ignore this message.`,
      actor: user,
    });
  } catch {
    // Logged in the delivery log; the link also goes out once a provider exists.
  }
  audit({ actor: user, action: 'auth.password.reset.requested', entity: 'User', entityId: String(user._id), req });
  res.json({ message: 'A reset link has been sent to your email address.' });
});

// Public reset completion: single-use token, then auto-login.
export const resetPassword = asyncHandler(async (req, res) => {
  const { token, password } = req.body;
  const user = await User.findOne({ resetTokenHash: sha256(String(token || '')) })
    .select('+resetTokenHash')
    .populate('store', 'name code')
    .populate('customer', 'name phone walletBalance walletCode');
  if (!user || !user.resetExpiresAt || user.resetExpiresAt < new Date()) {
    throw ApiError.badRequest('This reset link is invalid or has expired. Request a new one.');
  }
  user.passwordHash = await hashPassword(password);
  user.resetTokenHash = undefined;
  user.resetExpiresAt = null;
  await user.save();
  audit({ actor: user, action: 'auth.password.reset.completed', entity: 'User', entityId: String(user._id), req });
  res.json({ token: signToken(user, await sessionLifetime(user)), user: publicUser(user) });
});

export const listUsers = asyncHandler(async (req, res) => {
  const users = await User.find().select('+inviteTokenHash').populate('store', 'name code').populate('customer', 'name').sort({ createdAt: -1 }).limit(200);
  res.json({ users: users.map((u) => ({ ...publicUser(u), invitePending: !!u.inviteTokenHash })) });
});

// ADMIN-only edit: name, role, store/customer links, active flag, password
// reset. Self-demotion and self-deactivation are refused (no lockouts).
export const updateUser = asyncHandler(async (req, res) => {
  const target = await User.findById(req.params.id);
  if (!target) throw ApiError.notFound('User not found');
  const self = String(target._id) === String(req.user._id);
  const { name, role, store, customer, isActive, password } = req.body;

  if (self && isActive === false) throw ApiError.badRequest('You cannot deactivate your own account');
  if (self && role && role !== 'ADMIN') throw ApiError.badRequest('You cannot remove your own admin role');
  if (role && !['ADMIN', 'MANAGER', 'CASHIER', 'AUDITOR', 'CUSTOMER'].includes(role)) {
    throw ApiError.badRequest('Invalid role');
  }
  if (store !== undefined && store !== null) {
    const storeDoc = await Store.findOne({ _id: store, isActive: true });
    if (!storeDoc) throw ApiError.badRequest('Store not found');
  }
  if (customer !== undefined && customer !== null) {
    const customerDoc = await Customer.findById(customer);
    if (!customerDoc) throw ApiError.badRequest('Customer not found');
  }

  const changed = [];
  if (name !== undefined && name !== target.name) { target.name = name; changed.push('name'); }
  if (role !== undefined && role !== target.role) { target.role = role; changed.push('role'); }
  if (store !== undefined) { target.store = store; changed.push('store'); }
  if (customer !== undefined) { target.customer = customer; changed.push('customer'); }
  if (isActive !== undefined && isActive !== target.isActive) { target.isActive = isActive; changed.push('isActive'); }
  if (password !== undefined && password !== '') {
    if (String(password).length < 8) throw ApiError.badRequest('Password must be at least 8 characters');
    target.passwordHash = await hashPassword(password);
    changed.push('password');
  }
  try {
    await target.save();
  } catch (err) {
    if (err?.code === 11000) throw ApiError.conflict('Customer account already linked to another user');
    throw err;
  }
  await target.populate([{ path: 'store', select: 'name code' }, { path: 'customer', select: 'name' }]);
  audit({ actor: req.user, action: 'user.update', entity: 'User', entityId: String(target._id), metadata: { changed }, req });
  res.json({ user: publicUser(target) });
});

// Public self-registration — CUSTOMER accounts only. The role is forced
// server-side: any role sent by the client is ignored, so staff accounts can
// only ever be created by an admin. A wallet-carrying Customer record is
// created alongside, and the new user is logged straight in.
export const registerCustomer = asyncHandler(async (req, res) => {
  const { name, phone, email, password } = req.body;
  const exists = await User.findOne({ email });
  if (exists) throw ApiError.conflict('Email already registered. Try signing in instead.');
  let customer = null;
  for (let attempt = 0; attempt < 5 && !customer; attempt += 1) {
    try {
      customer = await Customer.create({
        name: name.trim(),
        ...(phone ? { phone } : {}),
        email,
        walletCode: generateVoucherCode('WC'),
      });
    } catch (err) {
      if (err?.code === 11000) throw ApiError.conflict('This phone or email is already registered. Try signing in instead.');
      if (attempt === 4) throw err;
    }
  }
  const user = await User.create({
    name: name.trim(),
    email,
    passwordHash: await hashPassword(password),
    role: 'CUSTOMER',
    customer: customer._id,
  });
  await user.populate({ path: 'customer', select: 'name phone walletBalance walletCode' });
  audit({ actor: user, action: 'user.register', entity: 'User', entityId: String(user._id), metadata: { email }, req });
  res.status(201).json({ token: signToken(user), user: publicUser(user) });
});

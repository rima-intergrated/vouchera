import jwt from 'jsonwebtoken';
import { generateSecret, generateURI, verify as verifyTotp } from 'otplib';
import QRCode from 'qrcode';
import User from '../models/User.js';
import Setting from '../models/Setting.js';
import { env } from '../config/env.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { signToken, signChallenge } from '../middleware/auth.js';
import { audit } from '../utils/helpers.js';

// Staff two-factor authentication (TOTP, RFC 6238 — any authenticator app).
// ±30s tolerance absorbs normal clock skew between phone and server.
// The login/2FA endpoints sit behind the auth rate limiter, and TOTP codes
// rotate every 30s, so online guessing is infeasible.
const SKEW_TOLERANCE_S = 30;

async function checkTotp(secret, token) {
  try {
    const result = await verifyTotp({ secret, token: String(token || ''), epochTolerance: SKEW_TOLERANCE_S });
    return result?.valid === true;
  } catch {
    return false;
  }
}

const TOTP_ROLES = ['ADMIN', 'MANAGER'];

export function isTotpRole(role) {
  return TOTP_ROLES.includes(role);
}

export async function staff2faRequired() {
  const row = await Setting.findOne({ key: 'security.requireStaff2fa' }).select('value').lean();
  return Number(row?.value ?? 0) === 1;
}

// Short sessions for shared till devices; everyone else uses JWT_EXPIRES_IN.
export async function sessionLifetime(user) {
  if (user.role === 'CASHIER') {
    const row = await Setting.findOne({ key: 'security.cashierSessionMinutes' }).select('value').lean();
    const mins = Math.min(1440, Math.max(30, Math.floor(Number(row?.value ?? 480))));
    return `${mins}m`;
  }
  return env.jwtExpiresIn;
}

function challengeUser(challengeToken, purpose) {
  let payload;
  try {
    payload = jwt.verify(challengeToken, env.jwtSecret);
  } catch {
    throw ApiError.badRequest('This verification session expired — sign in again');
  }
  if (payload.purpose !== purpose) throw ApiError.badRequest('Invalid verification session');
  return payload.sub;
}

async function totpBundle(user, secret) {
  const otpauthUrl = generateURI({ issuer: 'Vouchera', label: user.email, secret });
  return {
    otpauthUrl,
    manualKey: secret,
    qrCode: await QRCode.toDataURL(otpauthUrl, { errorCorrectionLevel: 'M', width: 256, margin: 1 }),
  };
}

// ---- Voluntary enrollment (authenticated session, ADMIN/MANAGER) ----

// POST /api/auth/2fa/setup — generate (or regenerate) a pending secret.
// Nothing is enforced until enable confirms a live code.
export const setup2fa = asyncHandler(async (req, res) => {
  const secret = generateSecret();
  await User.updateOne({ _id: req.user._id }, { $set: { totpSecret: secret } });
  audit({ actor: req.user, action: 'auth.2fa.setup', entity: 'User', entityId: String(req.user._id), req });
  res.json({ ...(await totpBundle(req.user, secret)), enabled: req.user.totpEnabled });
});

// POST /api/auth/2fa/enable { token } — confirm a live code, switch 2FA on.
export const enable2fa = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id).select('+totpSecret');
  if (!user?.totpSecret) throw ApiError.badRequest('Run setup first to get a secret');
  if (!(await checkTotp(user.totpSecret, req.body.token))) {
    audit({ actor: req.user, action: 'auth.2fa.enable.failed', entity: 'User', entityId: String(user._id), req });
    throw ApiError.badRequest('Wrong code — check your authenticator app and try again');
  }
  user.totpEnabled = true;
  user.totpEnabledAt = new Date();
  await user.save();
  audit({ actor: req.user, action: 'auth.2fa.enabled', entity: 'User', entityId: String(user._id), req });
  res.json({ enabled: true });
});

// POST /api/auth/2fa/disable { token } — switch 2FA off (proves possession).
export const disable2fa = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id).select('+totpSecret');
  if (!user?.totpEnabled) throw ApiError.badRequest('Two-factor authentication is not enabled');
  if (!(await checkTotp(user.totpSecret, req.body.token))) {
    throw ApiError.badRequest('Wrong code — 2FA stays on');
  }
  user.totpSecret = undefined;
  user.totpEnabled = false;
  user.totpEnabledAt = null;
  await user.save();
  audit({ actor: req.user, action: 'auth.2fa.disabled', entity: 'User', entityId: String(user._id), req });
  res.json({ enabled: false });
});

// ---- Mandatory enrollment (no session yet — challenge token only) ----

// POST /api/auth/2fa/enroll { challengeToken } — required-but-not-enrolled
// staff get their secret here, then activate below. Same response as setup.
export const enroll2fa = asyncHandler(async (req, res) => {
  const sub = challengeUser(String(req.body.challengeToken || ''), '2fa-enroll');
  const user = await User.findById(sub);
  if (!user || !user.isActive) throw ApiError.unauthorized('Invalid credentials');
  if (user.totpEnabled) throw ApiError.badRequest('2FA is already enabled — sign in normally');
  const secret = generateSecret();
  await User.updateOne({ _id: user._id }, { $set: { totpSecret: secret } });
  audit({ actor: user, action: 'auth.2fa.setup', entity: 'User', entityId: String(user._id), req });
  res.json(await totpBundle(user, secret));
});

// POST /api/auth/2fa/activate { challengeToken, token } — confirm + enable,
// then complete the interrupted login in the same call.
export const activate2fa = asyncHandler(async (req, res) => {
  const sub = challengeUser(String(req.body.challengeToken || ''), '2fa-enroll');
  const user = await User.findById(sub).select('+totpSecret').populate('store', 'name code').populate('customer', 'name phone walletBalance walletCode');
  if (!user || !user.isActive) throw ApiError.unauthorized('Invalid credentials');
  if (!user.totpSecret || !(await checkTotp(user.totpSecret, req.body.token))) {
    throw ApiError.badRequest('Wrong code — try again');
  }
  user.totpEnabled = true;
  user.totpEnabledAt = new Date();
  await user.save();
  audit({ actor: user, action: 'auth.2fa.enabled', entity: 'User', entityId: String(user._id), req });
  audit({ actor: user, action: 'auth.login', entity: 'User', entityId: String(user._id), req });
  res.json({ token: signToken(user, await sessionLifetime(user)), user: publicUserShape(user) });
});

// ---- Second factor at login ----

// POST /api/auth/2fa/verify { challengeToken, token } — complete login.
export const verify2fa = asyncHandler(async (req, res) => {
  const sub = challengeUser(String(req.body.challengeToken || ''), '2fa-challenge');
  const user = await User.findById(sub).select('+totpSecret').populate('store', 'name code').populate('customer', 'name phone walletBalance walletCode');
  if (!user || !user.isActive || !user.totpEnabled) throw ApiError.unauthorized('Invalid credentials');
  if (!(await checkTotp(user.totpSecret, req.body.token))) {
    audit({ actor: user, action: 'auth.2fa.failed', entity: 'User', entityId: String(user._id), req });
    throw ApiError.badRequest('Wrong code — try again');
  }
  audit({ actor: user, action: 'auth.login', entity: 'User', entityId: String(user._id), req });
  res.json({ token: signToken(user, await sessionLifetime(user)), user: publicUserShape(user) });
});

// POST /api/auth/users/:id/2fa/reset (ADMIN) — recovery when a staffer loses
// their authenticator. Self-reset is refused (use disable instead).
export const reset2fa = asyncHandler(async (req, res) => {
  const target = await User.findById(req.params.id);
  if (!target) throw ApiError.notFound('User not found');
  if (String(target._id) === String(req.user._id)) {
    throw ApiError.badRequest('You cannot reset your own 2FA — disable it instead');
  }
  target.totpSecret = undefined;
  target.totpEnabled = false;
  target.totpEnabledAt = null;
  await target.save();
  audit({ actor: req.user, action: 'auth.2fa.reset', entity: 'User', entityId: String(target._id), req });
  res.json({ enabled: false });
});

function publicUserShape(u) {
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

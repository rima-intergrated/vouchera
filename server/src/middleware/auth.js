import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { env } from '../config/env.js';
import User from '../models/User.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';

export function signToken(user) {
  return jwt.sign({ sub: String(user._id), role: user.role }, env.jwtSecret, {
    expiresIn: env.jwtExpiresIn,
  });
}

// Session contract: every 401 produced here carries code SESSION_INVALID.
// The client only destroys the stored login on 401 + SESSION_INVALID —
// business-logic failures (wrong till PIN, etc.) MUST NOT use 401, or the
// till would log staff out mid-sale.
function sessionDead(message) {
  const err = ApiError.unauthorized(message);
  err.code = 'SESSION_INVALID';
  return err;
}

// Validates JWT, loads user, rejects unknown/deactivated accounts.
// Also guards against malformed ObjectIds in the token.
export const requireAuth = asyncHandler(async (req, res, next) => {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) throw sessionDead('Missing auth token');
  let payload;
  try {
    payload = jwt.verify(token, env.jwtSecret);
  } catch {
    throw sessionDead('Invalid or expired token');
  }
  if (!mongoose.isValidObjectId(payload.sub)) throw sessionDead('Invalid token subject');
  const user = await User.findById(payload.sub)
    .populate('store', 'name code')
    .populate('customer', 'name phone walletBalance walletCode');
  if (!user || !user.isActive) throw sessionDead('Account unavailable');
  req.user = user;
  next();
});

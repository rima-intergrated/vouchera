import bcrypt from 'bcryptjs';
import Customer from '../models/Customer.js';
import { ApiError } from '../utils/ApiError.js';

export const PIN_LENGTH = 4;
export const PIN_REGEX = /^\d{4}$/;
export const PIN_MAX_ATTEMPTS = 5;
export const PIN_LOCK_MS = 15 * 60 * 1000;

export function assertPinFormat(pin) {
  if (!PIN_REGEX.test(String(pin ?? ''))) {
    throw ApiError.badRequest('PIN must be exactly 4 digits');
  }
}

export async function hashPin(pin) {
  assertPinFormat(pin);
  const salt = await bcrypt.genSalt(10);
  return bcrypt.hash(String(pin), salt);
}

// Verify a customer's till PIN. Enforces lockout: 5 bad attempts lock the
// account for 15 minutes. Throws 423 when locked, 403 when no PIN set,
// 401 on mismatch. Resets the counter on success.
export async function verifyCustomerPin(customer, pin) {
  const fresh = customer.pinHash !== undefined
    ? customer
    : await Customer.findById(customer._id || customer).select('+pinHash pinFailedAttempts pinLockedUntil');
  if (!fresh) throw ApiError.notFound('Customer wallet not found');

  if (fresh.pinLockedUntil && fresh.pinLockedUntil > new Date()) {
    const mins = Math.ceil((fresh.pinLockedUntil - Date.now()) / 60000);
    const err = ApiError.badRequest(`Too many wrong PIN attempts — try again in ${mins} min`);
    err.status = 423;
    throw err;
  }
  if (!fresh.pinHash) throw ApiError.forbidden('No payment PIN set on this account — set it in the customer portal first');
  if (!String(pin ?? '').trim()) throw ApiError.badRequest('Payment PIN is required');

  const ok = await bcrypt.compare(String(pin), fresh.pinHash);
  if (ok) {
    if (fresh.pinFailedAttempts || fresh.pinLockedUntil) {
      await Customer.updateOne(
        { _id: fresh._id },
        { $set: { pinFailedAttempts: 0, pinLockedUntil: null } }
      );
    }
    return fresh;
  }

  const attempts = (fresh.pinFailedAttempts || 0) + 1;
  const locked = attempts >= PIN_MAX_ATTEMPTS;
  await Customer.updateOne(
    { _id: fresh._id },
    {
      $set: {
        pinFailedAttempts: locked ? 0 : attempts,
        pinLockedUntil: locked ? new Date(Date.now() + PIN_LOCK_MS) : null,
      },
    }
  );
  if (locked) {
    const err = ApiError.badRequest('Too many wrong PIN attempts — account locked for 15 min');
    err.status = 423;
    throw err;
  }
  // NOTE: 400, not 401 — the cashier's session is fine; it is the
  // *customer's* credential that is wrong. A 401 would make the till client
  // treat this as a dead session and log the cashier out.
  throw ApiError.badRequest(`Wrong PIN (${PIN_MAX_ATTEMPTS - attempts} attempts left)`);
}

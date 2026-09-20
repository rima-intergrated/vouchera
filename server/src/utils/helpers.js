import crypto from 'node:crypto';
import AuditLog from '../models/AuditLog.js';

// Fire-and-forget audit entry; never blocks the request on failure.
export function audit({ actor, action, entity, entityId = '', metadata = {}, req = null }) {
  const entry = {
    actor: actor?._id ?? actor ?? null,
    actorEmail: actor?.email ?? '',
    actorRole: actor?.role ?? '',
    action,
    entity,
    entityId: String(entityId ?? ''),
    metadata,
    ip: req ? (req.ip || req.headers['x-forwarded-for'] || '') : '',
    userAgent: req ? (req.headers['user-agent'] || '') : '',
  };
  AuditLog.create(entry).catch((err) => console.error('[audit] write failed:', err.message));
}

// Escape user input before embedding it in a MongoDB $regex — otherwise a
// crafted pattern (e.g. nested quantifiers) can ReDoS the database.
export function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Malawi Kwacha is decimal (1 K = 100 tambala). Round every monetary input
// to 2dp at the boundary so floating-point artifacts never reach the database.
export function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}

// Generates a cryptographically strong unique voucher code, e.g. SW-8F7K-29QP.
// Random (never sequential); contains only the identifier — never value or
// customer data. Uniqueness is enforced by the DB unique index with retry.
export function generateVoucherCode(prefix = 'SW') {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const bytes = crypto.randomBytes(8);
  let raw = '';
  for (let i = 0; i < 8; i += 1) {
    raw += alphabet[bytes[i] % alphabet.length];
  }
  return `${prefix}-${raw.slice(0, 4)}-${raw.slice(4)}`;
}

// Generates a unique human-friendly redemption reference, e.g. VR-829174.
// Shown on the cashier success screen; uniqueness enforced by DB unique index.
export function generateRedemptionReference(prefix = 'VR') {
  const digits = String(Math.floor(100000 + Math.random() * 900000));
  return `${prefix}-${digits}`;
}

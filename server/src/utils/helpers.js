import crypto from 'node:crypto';
import AuditLog from '../models/AuditLog.js';
import { ApiError } from './ApiError.js';

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

// Validates an external (non-stored-value) tender leg against the bill:
// storedCharge (wallet/voucher/points value given) + external tender must
// equal billTotal to the tambala. Returns normalized tender fields for the
// redemption record. No tender info → all-NONE (bill unknown to Vouchera).
export function parseExternalTender(input = {}, storedCharge = 0) {
  const { billTotal, tenderMethod, tenderAmount, tenderReference } = input;
  const hasAny =
    (billTotal !== undefined && billTotal !== null && String(billTotal) !== '') ||
    (tenderMethod !== undefined && tenderMethod !== null && String(tenderMethod) !== '') ||
    (tenderAmount !== undefined && tenderAmount !== null && String(tenderAmount) !== '') ||
    (tenderReference !== undefined && tenderReference !== null && String(tenderReference).trim() !== '');
  if (!hasAny) {
    return { billTotal: null, tenderMethod: 'NONE', tenderAmount: 0, tenderReference: undefined };
  }
  const bill = round2(billTotal);
  if (!Number.isFinite(bill) || bill < 0.01) throw ApiError.badRequest('Bill total must be at least 0.01');
  const method = String(tenderMethod || '').trim().toUpperCase();
  if (!['CASH', 'VISA'].includes(method)) {
    throw ApiError.badRequest('Tender method must be CASH or VISA when a bill total is given');
  }
  const stored = round2(storedCharge);
  const ext = tenderAmount === undefined || tenderAmount === null || String(tenderAmount) === ''
    ? round2(bill - stored)
    : round2(tenderAmount);
  if (!Number.isFinite(ext) || ext < 0) throw ApiError.badRequest('Tender amount cannot be negative');
  if (Math.abs(round2(stored + ext) - bill) > 0.011) {
    throw ApiError.badRequest(`Tender split must equal the bill (${stored} stored + ${ext} ${method} ≠ ${bill})`);
  }
  const ref = tenderReference ? String(tenderReference).trim().slice(0, 120) : '';
  if (method === 'VISA' && !ref) throw ApiError.badRequest('VISA payments require the card auth code');
  return { billTotal: bill, tenderMethod: method, tenderAmount: ext, tenderReference: ref || undefined };
}
// Random (never sequential); contains only the identifier — never value or
// customer data. Uniqueness is enforced by the DB unique index with retry.
// Generates a cryptographically strong unique voucher code, e.g. SW-8F7K-29QP.
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

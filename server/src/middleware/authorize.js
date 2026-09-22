import { ApiError } from '../utils/ApiError.js';

// Role-based authorization: requireRole('ADMIN'), requireRole('ADMIN','MANAGER'), ...
export const requireRole = (...allowed) => (req, res, next) => {
  if (!req.user) return next(ApiError.unauthorized());
  if (!allowed.includes(req.user.role)) return next(ApiError.forbidden('Insufficient permissions'));
  next();
};

// Central permission matrix — the single source of truth for what each
// role may do. Phase 4+ routes (vouchers, redemptions, reports) gate on
// these permissions instead of scattering role checks.
//
// ADMIN:   full access (all permissions)
// MANAGER: management access — vouchers/campaigns/customers/stores/reports,
//          but no system-level administration (user management, audit, settings)
// CASHIER: voucher validation and redemption only (+ own history)
// AUDITOR: read-only reporting and audit access
// CUSTOMER: own wallet only (portal) — enforced per-controller, not matrix-wide
export const PERMISSIONS = {
  // System administration
  'users.manage': ['ADMIN'],
  'audit.read': ['ADMIN', 'AUDITOR'],
  'settings.manage': ['ADMIN'],
  'settings.read': ['ADMIN', 'MANAGER'],
  // Voucher lifecycle
  'vouchers.create': ['ADMIN', 'MANAGER'],
  'vouchers.read': ['ADMIN', 'MANAGER', 'AUDITOR'],
  'vouchers.validate': ['ADMIN', 'MANAGER', 'CASHIER'],
  'vouchers.redeem': ['ADMIN', 'CASHIER'],
  'vouchers.cancel': ['ADMIN'],
  'vouchers.suspend': ['ADMIN'],
  'vouchers.notify': ['ADMIN', 'MANAGER'],
  'vouchers.reload': ['ADMIN', 'MANAGER'],
  // Supporting data
  'campaigns.manage': ['ADMIN', 'MANAGER'],
  'campaigns.read': ['ADMIN', 'MANAGER', 'AUDITOR'],
  'customers.manage': ['ADMIN', 'MANAGER'],
  'customers.read': ['ADMIN', 'MANAGER', 'AUDITOR'],
  'stores.manage': ['ADMIN'],
  'stores.read': ['ADMIN', 'MANAGER', 'CASHIER', 'AUDITOR'],
  // Oversight
  'redemptions.read': ['ADMIN', 'MANAGER', 'AUDITOR'],
  'reports.read': ['ADMIN', 'MANAGER', 'AUDITOR'],
  // Customer wallets
  'wallets.topup': ['ADMIN', 'MANAGER'],
  'wallets.read': ['ADMIN', 'MANAGER', 'AUDITOR', 'CUSTOMER'],
  'wallets.approve': ['ADMIN'],
  // Loyalty program
  'loyalty.read': ['ADMIN', 'MANAGER', 'AUDITOR', 'CUSTOMER'],
};

export const requirePermission = (...needed) => (req, res, next) => {
  if (!req.user) return next(ApiError.unauthorized());
  // ADMIN holds every permission implicitly
  if (req.user.role === 'ADMIN') return next();
  const granted = needed.every((p) => (PERMISSIONS[p] || []).includes(req.user.role));
  if (!granted) return next(ApiError.forbidden('Insufficient permissions'));
  next();
};

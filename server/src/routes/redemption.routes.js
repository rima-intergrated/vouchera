import { Router } from 'express';
import { param, query } from 'express-validator';
import { myRedemptions } from '../controllers/cashier.controller.js';
import { listRedemptions, voucherRedemptions, redemptionReceipt } from '../controllers/redemption.controller.js';
import { requireAuth } from '../middleware/auth.js';
import { requirePermission } from '../middleware/authorize.js';
import { validate } from '../middleware/validate.js';

const router = Router();

const STATUS_VALUES = ['DRAFT', 'ACTIVE', 'PARTIALLY_REDEEMED', 'FULLY_REDEEMED', 'EXPIRED', 'CANCELLED', 'SUSPENDED'];

// Own redemption history for cashiers; staff with read access may pass ?cashier=.
router.get('/mine', requireAuth, myRedemptions);

// Single-receipt view (controller enforces role scoping). Literal-safe:
// ':id/receipt' cannot collide with '/voucher/:voucherId'.
router.get(
  '/:id/receipt',
  requireAuth,
  [param('id').isMongoId().withMessage('Invalid redemption id')],
  validate,
  redemptionReceipt
);

// Complete scoped history: all roles authenticated; controller enforces
// ADMIN/AUDITOR = all, MANAGER = own store, CASHIER = own records.
router.get(
  '/',
  requireAuth,
  [
    query('from').optional().isISO8601().withMessage('from must be a valid date'),
    query('to').optional().isISO8601().withMessage('to must be a valid date'),
    query('store').optional().isMongoId().withMessage('Invalid store id'),
    query('cashier').optional().trim().notEmpty().withMessage('Invalid cashier filter'),
    query('voucherId').optional().isMongoId().withMessage('Invalid voucher id'),
    query('campaign').optional().isMongoId().withMessage('Invalid campaign id'),
    query('minAmount').optional().isFloat({ min: 0 }).withMessage('Invalid minAmount'),
    query('maxAmount').optional().isFloat({ min: 0 }).withMessage('Invalid maxAmount'),
    query('status').optional().isIn(STATUS_VALUES).withMessage('Invalid status'),
    query('page').optional().isInt({ min: 1 }).withMessage('Invalid page'),
    query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Invalid limit'),
  ],
  validate,
  listRedemptions
);

// Per-voucher history for the admin detail page.
router.get(
  '/voucher/:voucherId',
  requireAuth,
  requirePermission('vouchers.read'),
  [param('voucherId').isMongoId().withMessage('Invalid voucher id')],
  validate,
  voucherRedemptions
);

export default router;

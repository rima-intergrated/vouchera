import { Router } from 'express';
import { body, query } from 'express-validator';
import { topUpWallet, listWalletTransactions, walletQr, validateWallet, debitWalletHandler, myVouchers } from '../controllers/wallet.controller.js';
import { requireAuth } from '../middleware/auth.js';
import { requirePermission } from '../middleware/authorize.js';
import { sensitiveLimiter } from '../middleware/rateLimits.js';
import { validate } from '../middleware/validate.js';

const router = Router();

router.get(
  '/qr',
  requireAuth,
  requirePermission('wallets.read'),
  [query('customer').optional().isMongoId().withMessage('Invalid customer id')],
  validate,
  walletQr
);

router.post(
  '/topup',
  requireAuth,
  requirePermission('wallets.topup'),
  [
    body('customerId').isMongoId().withMessage('Invalid customer id'),
    body('amount').isFloat({ min: 0.01 }).withMessage('Amount must be at least 0.01'),
    body('method').isIn(['CASH', 'TRANSFER']).withMessage('Method must be CASH or TRANSFER'),
    body('paymentReference').optional().trim().isLength({ max: 120 }).withMessage('Reference too long'),
    body('storeId').optional().isMongoId().withMessage('Invalid store id'),
    body('idempotencyKey').optional().isUUID().withMessage('Invalid idempotency key'),
  ],
  validate,
  topUpWallet
);

router.get(
  '/transactions',
  requireAuth,
  requirePermission('wallets.read'),
  [
    query('customer').optional().isMongoId().withMessage('Invalid customer id'),
    query('page').optional().isInt({ min: 1 }).withMessage('Invalid page'),
    query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Invalid limit'),
  ],
  validate,
  listWalletTransactions
);

// Till scan check (read-only) — same abuse limiter as voucher validation.
router.post(
  '/validate',
  sensitiveLimiter,
  requireAuth,
  requirePermission('vouchers.validate'),
  [body('code').trim().notEmpty().withMessage('Wallet code is required')],
  validate,
  validateWallet
);

// Explicit till purchase from a wallet.
router.post(
  '/debit',
  sensitiveLimiter,
  requireAuth,
  requirePermission('vouchers.redeem'),
  [
    body('walletCode').optional().trim().notEmpty().withMessage('Invalid wallet code'),
    body('customerId').optional().isMongoId().withMessage('Invalid customer id'),
    body('amount').isFloat({ min: 0.01 }).withMessage('Amount must be at least 0.01'),
    body('posTransactionReference').trim().notEmpty().withMessage('POS transaction reference is required'),
    body('storeId').optional().isMongoId().withMessage('Invalid store id'),
    body('idempotencyKey').optional().isUUID().withMessage('Invalid idempotency key'),
    // Verification accepts 4–6 digits so PINs created before the 4-digit
    // switch still authorise; every newly set PIN is exactly 4 digits.
    body('pin').trim().matches(/^\d{4,6}$/).withMessage('Payment PIN must be 4 to 6 digits'),
    body('loyaltyPoints').optional().isInt({ min: 0 }).withMessage('Loyalty points must be a whole number'),
  ],
  validate,
  debitWalletHandler
);

router.get(
  '/vouchers',
  requireAuth,
  requirePermission('wallets.read'),
  [
    query('customer').optional().isMongoId().withMessage('Invalid customer id'),
    query('page').optional().isInt({ min: 1 }).withMessage('Invalid page'),
    query('limit').optional().isInt({ min: 1, max: 50 }).withMessage('Invalid limit'),
  ],
  validate,
  myVouchers
);

export default router;

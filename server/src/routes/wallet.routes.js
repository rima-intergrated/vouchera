import { Router } from 'express';
import { body, param, query } from 'express-validator';
import { topUpWallet, listWalletTransactions, walletQr, validateWallet, debitWalletHandler, myVouchers, downloadProof, transactionReceipt, listTopUpApprovals, approveTopUpRequest, rejectTopUpRequest, approvalProof } from '../controllers/wallet.controller.js';
import { requireAuth } from '../middleware/auth.js';
import { requirePermission } from '../middleware/authorize.js';
import { sensitiveLimiter } from '../middleware/rateLimits.js';
import { proofUpload } from '../middleware/upload.js';
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
  proofUpload,
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

router.get(
  '/transactions/:id/proof',
  requireAuth,
  requirePermission('wallets.read'),
  [param('id').isMongoId().withMessage('Invalid transaction id')],
  validate,
  downloadProof
);
router.get(
  '/transactions/:id/receipt',
  requireAuth,
  requirePermission('wallets.read'),
  [param('id').isMongoId().withMessage('Invalid transaction id')],
  validate,
  transactionReceipt
);

// Maker-checker approvals (ADMIN only) — literal paths before any ':id'.
router.get(
  '/approvals',
  requireAuth,
  requirePermission('wallets.approve'),
  [
    query('status').optional().isIn(['PENDING', 'APPROVED', 'REJECTED']).withMessage('Invalid status'),
    query('page').optional().isInt({ min: 1 }).withMessage('Invalid page'),
    query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Invalid limit'),
  ],
  validate,
  listTopUpApprovals
);
router.post(
  '/approvals/:id/approve',
  requireAuth,
  requirePermission('wallets.approve'),
  [param('id').isMongoId().withMessage('Invalid request id')],
  validate,
  approveTopUpRequest
);
router.post(
  '/approvals/:id/reject',
  requireAuth,
  requirePermission('wallets.approve'),
  [
    param('id').isMongoId().withMessage('Invalid request id'),
    body('note').optional().trim().isLength({ max: 500 }).withMessage('Note too long'),
  ],
  validate,
  rejectTopUpRequest
);
router.get(
  '/approvals/:id/proof',
  requireAuth,
  requirePermission('wallets.approve'),
  [param('id').isMongoId().withMessage('Invalid request id')],
  validate,
  approvalProof
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
    body('billTotal').optional().isFloat({ min: 0.01 }).withMessage('Bill total must be at least 0.01'),
    body('tenderMethod').optional().isIn(['CASH', 'VISA']).withMessage('Tender method must be CASH or VISA'),
    body('tenderAmount').optional().isFloat({ min: 0 }).withMessage('Tender amount cannot be negative'),
    body('tenderReference').optional().trim().isLength({ max: 120 }).withMessage('Tender reference too long'),
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

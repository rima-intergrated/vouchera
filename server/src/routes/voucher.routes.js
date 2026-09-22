import { Router } from 'express';
import {
  listVouchers,
  createVoucher,
  getVoucher,
  getVoucherQr,
  updateVoucher,
  cancelVoucher,
  suspendVoucher,
  reactivateVoucher,
} from '../controllers/voucher.controller.js';
import { requireAuth } from '../middleware/auth.js';
import { requirePermission } from '../middleware/authorize.js';
import { sensitiveLimiter } from '../middleware/rateLimits.js';
import { validate } from '../middleware/validate.js';
import {
  voucherIdParam,
  createVoucherValidators,
  updateVoucherValidators,
  listVoucherValidators,
  validateVoucherValidators,
  redeemVoucherValidators,
} from '../validators/voucher.validators.js';
import { validateVoucher, redeemVoucher } from '../controllers/cashier.controller.js';
import { reloadCard } from '../controllers/wallet.controller.js';
import {
  listNotifyChannels,
  downloadVoucherPdf,
  notifyVoucher,
  voucherDeliveries,
} from '../controllers/delivery.controller.js';
import { body } from 'express-validator';
import { proofUpload } from '../middleware/upload.js';

const router = Router();

router.get('/', requireAuth, requirePermission('vouchers.read'), listVoucherValidators, validate, listVouchers);
router.post('/', requireAuth, requirePermission('vouchers.create'), createVoucherValidators, validate, createVoucher);
// Scan-validation (read-only) and explicit redemption — order matters: these
// literal paths must precede '/:id' routes.
router.post('/validate', sensitiveLimiter, requireAuth, requirePermission('vouchers.validate'), validateVoucherValidators, validate, validateVoucher);
router.post('/redeem', sensitiveLimiter, requireAuth, requirePermission('vouchers.redeem'), redeemVoucherValidators, validate, redeemVoucher);
// Delivery: literal paths before '/:id'
router.get('/notify-channels', requireAuth, requirePermission('vouchers.read'), listNotifyChannels);
router.get('/:id', requireAuth, requirePermission('vouchers.read'), voucherIdParam, validate, getVoucher);
router.get('/:id/qr', requireAuth, requirePermission('vouchers.read'), voucherIdParam, validate, getVoucherQr);
router.patch('/:id', requireAuth, requirePermission('vouchers.create'), updateVoucherValidators, validate, updateVoucher);
router.post('/:id/cancel', requireAuth, requirePermission('vouchers.cancel'), voucherIdParam, validate, cancelVoucher);
router.post('/:id/suspend', requireAuth, requirePermission('vouchers.suspend'), voucherIdParam, validate, suspendVoucher);
router.post('/:id/reactivate', requireAuth, requirePermission('vouchers.suspend'), voucherIdParam, validate, reactivateVoucher);
router.post(
  '/:id/reload',
  requireAuth,
  requirePermission('vouchers.reload'),
  proofUpload,
  [
    ...voucherIdParam,
    body('amount').isFloat({ min: 0.01 }).withMessage('Amount must be at least 0.01'),
    body('method').isIn(['CASH', 'TRANSFER']).withMessage('Method must be CASH or TRANSFER'),
    body('paymentReference').optional().trim().isLength({ max: 120 }).withMessage('Reference too long'),
    body('storeId').optional().isMongoId().withMessage('Invalid store id'),
    body('idempotencyKey').optional().isUUID().withMessage('Invalid idempotency key'),
  ],
  validate,
  reloadCard
);
router.get('/:id/pdf', sensitiveLimiter, requireAuth, requirePermission('vouchers.read'), voucherIdParam, validate, downloadVoucherPdf);
router.get('/:id/deliveries', requireAuth, requirePermission('vouchers.read'), voucherIdParam, validate, voucherDeliveries);
router.post(
  '/:id/notify',
  sensitiveLimiter,
  requireAuth,
  requirePermission('vouchers.notify'),
  [
    ...voucherIdParam,
    body('channel').isIn(['email', 'sms', 'whatsapp']).withMessage('Invalid channel'),
    body('recipient').trim().notEmpty().withMessage('Recipient is required').isLength({ max: 254 }).withMessage('Recipient too long'),
  ],
  validate,
  notifyVoucher
);

export default router;

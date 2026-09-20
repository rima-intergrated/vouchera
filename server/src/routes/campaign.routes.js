import { Router } from 'express';
import { body, param, query } from 'express-validator';
import {
  listCampaigns,
  createCampaign,
  getCampaign,
  updateCampaign,
  activateCampaign,
  pauseCampaign,
  endCampaign,
  generateCampaignVouchers,
  campaignVouchers,
  getCampaignStats,
} from '../controllers/campaign.controller.js';
import { requireAuth } from '../middleware/auth.js';
import { requirePermission } from '../middleware/authorize.js';
import { validate } from '../middleware/validate.js';

const router = Router();

const idParam = [param('id').isMongoId().withMessage('Invalid campaign id')];
const manage = [requireAuth, requirePermission('campaigns.manage')];
const read = [requireAuth, requirePermission('campaigns.read')];

router.get('/', ...read, [query('status').optional().isIn(['DRAFT', 'ACTIVE', 'PAUSED', 'ENDED']).withMessage('Invalid status')], validate, listCampaigns);
router.post(
  '/',
  ...manage,
  [
    body('name').trim().isLength({ min: 2 }).withMessage('Campaign name required'),
    body('code').trim().isLength({ min: 2 }).withMessage('Campaign code required'),
    body('description').optional().isLength({ max: 1000 }).withMessage('Description too long'),
    body('startsAt').optional({ nullable: true }).isISO8601().withMessage('Invalid start date'),
    body('endsAt').optional({ nullable: true }).isISO8601().withMessage('Invalid end date'),
    body('voucherType').optional().isIn(['FIXED_VALUE', 'GIFT_CARD', 'PERCENTAGE', 'PRODUCT', 'DEPARTMENT', 'CAMPAIGN']).withMessage('Invalid voucher type'),
    body('voucherValue').optional().isFloat({ min: 0 }).withMessage('Voucher value must be >= 0'),
    body('voucherQuantity').optional().isInt({ min: 0, max: 10000 }).withMessage('Quantity must be 0–10000'),
    body('eligibleStores').optional().isArray().withMessage('eligibleStores must be an array'),
    body('eligibleStores.*').isMongoId().withMessage('Invalid store id'),
    body('terms').optional().isLength({ max: 2000 }).withMessage('Terms too long'),
  ],
  validate,
  createCampaign
);

router.get('/:id', ...read, idParam, validate, getCampaign);
router.patch(
  '/:id',
  ...manage,
  [
    ...idParam,
    body('name').optional().trim().isLength({ min: 2 }).withMessage('Campaign name required'),
    body('description').optional().isLength({ max: 1000 }).withMessage('Description too long'),
    body('startsAt').optional({ nullable: true }).isISO8601().withMessage('Invalid start date'),
    body('endsAt').optional({ nullable: true }).isISO8601().withMessage('Invalid end date'),
    body('voucherType').optional().isIn(['FIXED_VALUE', 'GIFT_CARD', 'PERCENTAGE', 'PRODUCT', 'DEPARTMENT', 'CAMPAIGN']).withMessage('Invalid voucher type'),
    body('voucherValue').optional().isFloat({ min: 0 }).withMessage('Voucher value must be >= 0'),
    body('voucherQuantity').optional().isInt({ min: 0, max: 10000 }).withMessage('Quantity must be 0–10000'),
    body('eligibleStores').optional().isArray().withMessage('eligibleStores must be an array'),
    body('eligibleStores.*').isMongoId().withMessage('Invalid store id'),
    body('terms').optional().isLength({ max: 2000 }).withMessage('Terms too long'),
  ],
  validate,
  updateCampaign
);

router.post('/:id/activate', ...manage, idParam, validate, activateCampaign);
router.post('/:id/pause', ...manage, idParam, validate, pauseCampaign);
router.post('/:id/end', ...manage, idParam, validate, endCampaign);
router.post(
  '/:id/generate',
  ...manage,
  [...idParam, body('expiryDate').optional({ nullable: true }).isISO8601().withMessage('Invalid expiry date')],
  validate,
  generateCampaignVouchers
);
router.get('/:id/vouchers', ...read, [...idParam, query('status').optional().isString()], validate, campaignVouchers);
router.get('/:id/stats', ...read, idParam, validate, getCampaignStats);

export default router;

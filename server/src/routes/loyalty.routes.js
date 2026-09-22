import { Router } from 'express';
import { query } from 'express-validator';
import { myLoyalty, listLoyaltyTransactions } from '../controllers/loyalty.controller.js';
import { requireAuth } from '../middleware/auth.js';
import { requirePermission } from '../middleware/authorize.js';
import { validate } from '../middleware/validate.js';

const router = Router();

router.get('/me', requireAuth, requirePermission('loyalty.read'), myLoyalty);
router.get(
  '/transactions',
  requireAuth,
  requirePermission('loyalty.read'),
  [
    query('customer').optional().isMongoId().withMessage('Invalid customer id'),
    query('page').optional().isInt({ min: 1 }).withMessage('Invalid page'),
    query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Invalid limit'),
  ],
  validate,
  listLoyaltyTransactions
);

export default router;

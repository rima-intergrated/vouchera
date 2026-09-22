import { Router } from 'express';
import { body } from 'express-validator';
import { validateOnlineTender, authorizeOnlinePayment } from '../controllers/online.controller.js';
import { sensitiveLimiter } from '../middleware/rateLimits.js';
import { validate } from '../middleware/validate.js';

const router = Router();

// Public online-checkout endpoints for the Shopwise website.
// No staff token: shoppers prove ownership with the holder's 4-digit
// till PIN (verified server-side with lockout). Same abuse limiter as
// till validation. Read-only except the authorization record itself —
// money NEVER moves here; capture stays a staff till action.
router.post(
  '/validate',
  sensitiveLimiter,
  [
    body('code').trim().notEmpty().withMessage('Code is required'),
    body('amount').optional().isFloat({ min: 0.01 }).withMessage('Amount must be greater than 0'),
  ],
  validate,
  validateOnlineTender
);

router.post(
  '/authorize',
  sensitiveLimiter,
  [
    body('code').trim().notEmpty().withMessage('Code is required'),
    body('amount').isFloat({ min: 0.01 }).withMessage('Amount must be greater than 0'),
    body('pin').trim().matches(/^\d{4}$/).withMessage('Payment PIN must be exactly 4 digits'),
    body('orderRef').trim().notEmpty().isLength({ max: 120 }).withMessage('Order reference is required'),
    body('storeLabel').optional().trim().isLength({ max: 160 }).withMessage('Store label too long'),
  ],
  validate,
  authorizeOnlinePayment
);

export default router;

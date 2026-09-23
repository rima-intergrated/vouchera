import { Router } from 'express';
import { body, query } from 'express-validator';
import { openShift, closeShift, myShifts, listShifts } from '../controllers/shift.controller.js';
import { requireAuth } from '../middleware/auth.js';
import { requirePermission } from '../middleware/authorize.js';
import { validate } from '../middleware/validate.js';

const router = Router();

// Till shifts: anyone who may redeem at the till may open/close their own.
// Oversight lists reuse the reporting permission.
router.post(
  '/open',
  requireAuth,
  requirePermission('vouchers.redeem'),
  [body('storeId').optional().isMongoId().withMessage('Invalid store id')],
  validate,
  openShift
);
router.post(
  '/close',
  requireAuth,
  requirePermission('vouchers.redeem'),
  [
    body('declaredCash').isFloat({ min: 0 }).withMessage('Declared cash must be 0 or more'),
    body('note').optional().trim().isLength({ max: 500 }).withMessage('Note too long'),
  ],
  validate,
  closeShift
);
router.get('/mine', requireAuth, myShifts);
router.get(
  '/',
  requireAuth,
  requirePermission('reports.read'),
  [
    query('from').optional().isISO8601().withMessage('from must be a valid date'),
    query('to').optional().isISO8601().withMessage('to must be a valid date'),
    query('store').optional().isMongoId().withMessage('Invalid store id'),
    query('cashier').optional().isMongoId().withMessage('Invalid cashier id'),
    query('status').optional().isIn(['OPEN', 'CLOSED']).withMessage('Invalid status'),
    query('page').optional().isInt({ min: 1 }).withMessage('Invalid page'),
    query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Invalid limit'),
  ],
  validate,
  listShifts
);

export default router;

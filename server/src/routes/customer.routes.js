import { Router } from 'express';
import { body, param, query } from 'express-validator';
import { listCustomers, createCustomer, getCustomer, updateCustomer, getMe } from '../controllers/customer.controller.js';
import { setPin, changePin } from '../controllers/pin.controller.js';
import { requireAuth } from '../middleware/auth.js';
import { requirePermission, requireRole } from '../middleware/authorize.js';
import { validate } from '../middleware/validate.js';

const router = Router();

// Self-service ONLY: a login can touch nobody's PIN but its own linked
// account. (Previously any authenticated staff could pass `customerId` and
// overwrite an arbitrary customer's PIN — then authorize debits against it.
// Staff must never set customer PINs; resets go through the customer-owned
// email flow.)
router.get('/me', requireAuth, requireRole('CUSTOMER'), getMe);
router.post(
  '/me/pin',
  requireAuth,
  requireRole('CUSTOMER'),
  [body('pin').matches(/^\d{4}$/).withMessage('PIN must be exactly 4 digits')],
  validate,
  setPin
);
router.post(
  '/me/pin/change',
  requireAuth,
  requireRole('CUSTOMER'),
  [
    // Current PIN accepts 4–6 digits (legacy 6-digit PINs verify here once,
    // then are replaced by a 4-digit PIN); the new PIN is 4 digits only.
    body('currentPin').optional().trim().matches(/^\d{4,6}$/).withMessage('Current PIN must be 4 to 6 digits'),
    body('newPin').matches(/^\d{4}$/).withMessage('PIN must be exactly 4 digits'),
  ],
  validate,
  changePin
);

router.get(
  '/',
  requireAuth,
  requirePermission('customers.read'),
  [query('q').optional().trim()],
  validate,
  listCustomers
);
router.post(
  '/',
  requireAuth,
  requirePermission('customers.manage'),
  [
    body('name').trim().isLength({ min: 2 }).withMessage('Customer name required'),
    body('phone').optional({ nullable: true }).trim(),
    body('email').optional({ nullable: true }).isEmail().withMessage('Invalid email').normalizeEmail(),
    body('notes').optional().isLength({ max: 500 }).withMessage('Notes too long'),
  ],
  validate,
  createCustomer
);

const idParam = [param('id').isMongoId().withMessage('Invalid customer id')];

router.get('/:id', requireAuth, requirePermission('customers.read'), idParam, validate, getCustomer);
router.patch(
  '/:id',
  requireAuth,
  requirePermission('customers.manage'),
  [
    ...idParam,
    body('name').optional().trim().isLength({ min: 2 }).withMessage('Name too short'),
    body('phone').optional({ nullable: true }).trim(),
    body('email').optional({ nullable: true }).isEmail().withMessage('Invalid email').normalizeEmail(),
    body('notes').optional().isLength({ max: 500 }).withMessage('Notes too long'),
  ],
  validate,
  updateCustomer
);

export default router;

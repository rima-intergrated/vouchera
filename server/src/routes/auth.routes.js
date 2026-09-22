import { Router } from 'express';
import { body, param } from 'express-validator';
import { login, me, logout, createUser, listUsers, updateUser, acceptInvite, reinviteUser, forgotPassword, resetPassword, registerCustomer } from '../controllers/auth.controller.js';
import { forgotPin, resetPin } from '../controllers/pin.controller.js';
import { requireAuth } from '../middleware/auth.js';
import { requireRole } from '../middleware/authorize.js';
import { validate } from '../middleware/validate.js';
import { loginValidators } from '../validators/auth.validators.js';
import { createUserValidators } from '../validators/admin.validators.js';

const router = Router();

router.post('/login', loginValidators, validate, login);
router.get('/me', requireAuth, me);
router.post('/logout', requireAuth, logout);
router.post(
  '/accept-invite',
  [
    body('token').trim().notEmpty().withMessage('Invite token is required'),
    body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
  ],
  validate,
  acceptInvite
);
router.post(
  '/forgot-password',
  [body('email').isEmail().withMessage('Valid email required').normalizeEmail()],
  validate,
  forgotPassword
);
router.post(
  '/register',
  [
    body('name').trim().isLength({ min: 2 }).withMessage('Name is required'),
    body('phone').optional().trim(),
    body('email').isEmail().withMessage('Valid email required').normalizeEmail(),
    body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
  ],
  validate,
  registerCustomer
);
router.post(
  '/reset-password',
  [
    body('token').trim().notEmpty().withMessage('Reset token is required'),
    body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
  ],
  validate,
  resetPassword
);
router.post(
  '/forgot-pin',
  [body('email').isEmail().withMessage('Valid email required').normalizeEmail()],
  validate,
  forgotPin
);
router.post(
  '/reset-pin',
  [
    body('token').trim().notEmpty().withMessage('Reset token is required'),
    body('pin').matches(/^\d{6}$/).withMessage('PIN must be exactly 6 digits'),
  ],
  validate,
  resetPin
);

// User management (ADMIN only) — mounted under /api/auth for Phase 1;
// promoted to /api/users in a later phase with full CRUD.
router.get('/users', requireAuth, requireRole('ADMIN'), listUsers);
router.post('/users', requireAuth, requireRole('ADMIN'), createUserValidators, validate, createUser);
router.patch(
  '/users/:id',
  requireAuth,
  requireRole('ADMIN'),
  [
    param('id').isMongoId().withMessage('Invalid user id'),
    body('name').optional().trim().isLength({ min: 2 }).withMessage('Name too short'),
    body('role').optional().isIn(['ADMIN', 'MANAGER', 'CASHIER', 'AUDITOR', 'CUSTOMER']).withMessage('Invalid role'),
    body('store').optional({ nullable: true }).isMongoId().withMessage('Invalid store id'),
    body('customer').optional({ nullable: true }).isMongoId().withMessage('Invalid customer id'),
    body('isActive').optional().isBoolean().withMessage('isActive must be boolean'),
    body('password').optional().isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
  ],
  validate,
  updateUser
);
router.post('/users/:id/reinvite', requireAuth, requireRole('ADMIN'), [param('id').isMongoId().withMessage('Invalid user id')], validate, reinviteUser);

export default router;

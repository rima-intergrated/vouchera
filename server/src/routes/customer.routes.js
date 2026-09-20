import { Router } from 'express';
import { body, param, query } from 'express-validator';
import { listCustomers, createCustomer, getCustomer, updateCustomer } from '../controllers/customer.controller.js';
import { requireAuth } from '../middleware/auth.js';
import { requirePermission } from '../middleware/authorize.js';
import { validate } from '../middleware/validate.js';

const router = Router();

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

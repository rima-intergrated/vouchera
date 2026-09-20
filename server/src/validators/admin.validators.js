import { body } from 'express-validator';

export const createStoreValidators = [
  body('name').trim().isLength({ min: 2 }).withMessage('Store name required'),
  body('code').trim().isLength({ min: 2 }).withMessage('Store code required'),
  body('location').optional().trim(),
];

export const createUserValidators = [
  body('name').trim().isLength({ min: 2 }).withMessage('Name required'),
  body('email').isEmail().withMessage('Valid email required').normalizeEmail(),
  body('password').optional().isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
  body('role').isIn(['ADMIN', 'MANAGER', 'CASHIER', 'AUDITOR', 'CUSTOMER']).withMessage('Invalid role'),
  body('store').optional().isMongoId().withMessage('Invalid store id'),
  body('customer').optional().isMongoId().withMessage('Invalid customer id'),
];

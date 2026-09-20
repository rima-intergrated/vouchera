import { body } from 'express-validator';

export const loginValidators = [
  body('email').isEmail().withMessage('Valid email required').normalizeEmail(),
  body('password').isLength({ min: 1 }).withMessage('Password required'),
];

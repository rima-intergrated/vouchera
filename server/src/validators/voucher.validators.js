import { body, param, query } from 'express-validator';

export const voucherIdParam = [param('id').isMongoId().withMessage('Invalid voucher id')];

export const createVoucherValidators = [
  body('originalValue')
    .isFloat({ min: 1 })
    .withMessage('Voucher value must be at least 1'),
  body('type')
    .optional()
    .isIn(['FIXED_VALUE', 'GIFT_CARD', 'PERCENTAGE', 'PRODUCT', 'DEPARTMENT', 'CAMPAIGN'])
    .withMessage('Invalid voucher type'),
  body('expiryDate').isISO8601().withMessage('Expiry date must be valid').toDate(),
  body('issueDate').optional().isISO8601().withMessage('Issue date must be valid').toDate(),
  body('customer').optional({ nullable: true }).isMongoId().withMessage('Invalid customer id'),
  body('campaign').optional({ nullable: true }).isMongoId().withMessage('Invalid campaign id'),
  body('validStores').optional().isArray().withMessage('validStores must be an array'),
  body('validStores.*').isMongoId().withMessage('Invalid store id'),
  body('restrictions.notes').optional().isLength({ max: 500 }).withMessage('Notes too long'),
  body('restrictions.minPurchase').optional().isFloat({ min: 0 }).withMessage('minPurchase must be >= 0'),
  body('status').optional().isIn(['DRAFT', 'ACTIVE']).withMessage('New vouchers must be DRAFT or ACTIVE'),
];

export const updateVoucherValidators = [
  ...voucherIdParam,
  body('expiryDate').optional().isISO8601().withMessage('Expiry date must be valid').toDate(),
  body('customer').optional({ nullable: true }).isMongoId().withMessage('Invalid customer id'),
  body('campaign').optional({ nullable: true }).isMongoId().withMessage('Invalid campaign id'),
  body('validStores').optional().isArray().withMessage('validStores must be an array'),
  body('validStores.*').isMongoId().withMessage('Invalid store id'),
  body('restrictions.notes').optional().isLength({ max: 500 }).withMessage('Notes too long'),
  body('status').optional().isIn(['ACTIVE']).withMessage('Only activation (DRAFT to ACTIVE) is allowed here'),
];

export const validateVoucherValidators = [
  body('code').trim().notEmpty().withMessage('Voucher code is required'),
];

export const redeemVoucherValidators = [
  body('code').trim().notEmpty().withMessage('Voucher code is required'),
  body('amount').isFloat({ min: 0.01 }).withMessage('Amount must be at least 0.01'),
  body('posTransactionReference').trim().notEmpty().withMessage('POS transaction reference is required'),
  body('storeId').optional().isMongoId().withMessage('Invalid store id'),
  body('idempotencyKey').optional().isUUID().withMessage('Invalid idempotency key'),
  // Till PIN: required for customer-linked vouchers (enforced server-side),
  // skipped for bearer/paper vouchers. Loyalty tender for linked accounts.
  body('pin').optional().trim().matches(/^\d{6}$/).withMessage('Payment PIN must be exactly 6 digits'),
  body('loyaltyPoints').optional().isInt({ min: 0 }).withMessage('Loyalty points must be a whole number'),
];

export const listVoucherValidators = [
  query('q').optional().trim(),
  query('status')
    .optional()
    .isIn(['DRAFT', 'ACTIVE', 'PARTIALLY_REDEEMED', 'FULLY_REDEEMED', 'EXPIRED', 'CANCELLED', 'SUSPENDED'])
    .withMessage('Invalid status'),
  query('store').optional().isMongoId().withMessage('Invalid store id'),
  query('campaign').optional().isMongoId().withMessage('Invalid campaign id'),
  query('from').optional().isISO8601().withMessage('from must be a valid date'),
  query('to').optional().isISO8601().withMessage('to must be a valid date'),
  query('page').optional().isInt({ min: 1 }).withMessage('Invalid page'),
  query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Invalid limit'),
];

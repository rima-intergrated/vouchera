import { Router } from 'express';
import { body, param } from 'express-validator';
import { listStores, createStore, updateStore } from '../controllers/store.controller.js';
import { requireAuth } from '../middleware/auth.js';
import { requirePermission } from '../middleware/authorize.js';
import { validate } from '../middleware/validate.js';
import { createStoreValidators } from '../validators/admin.validators.js';

const router = Router();

router.get('/', requireAuth, requirePermission('stores.read'), listStores);
router.post('/', requireAuth, requirePermission('stores.manage'), createStoreValidators, validate, createStore);
router.patch(
  '/:id',
  requireAuth,
  requirePermission('stores.manage'),
  [
    param('id').isMongoId().withMessage('Invalid store id'),
    body('name').optional().trim().isLength({ min: 2 }).withMessage('Store name too short'),
    body('location').optional().trim(),
    body('isActive').optional().isBoolean().withMessage('isActive must be boolean'),
  ],
  validate,
  updateStore
);

export default router;

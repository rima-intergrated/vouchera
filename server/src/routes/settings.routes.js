import { Router } from 'express';
import { param } from 'express-validator';
import { listSettings, updateSetting } from '../controllers/settings.controller.js';
import { requireAuth } from '../middleware/auth.js';
import { requirePermission } from '../middleware/authorize.js';
import { validate } from '../middleware/validate.js';

const router = Router();

router.get('/', requireAuth, requirePermission('settings.read'), listSettings);
router.patch(
  '/:key',
  requireAuth,
  requirePermission('settings.manage'),
  [param('key').trim().notEmpty().withMessage('Invalid setting key')],
  validate,
  updateSetting
);

export default router;

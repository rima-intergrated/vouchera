import { Router } from 'express';
import { query } from 'express-validator';
import { listAuditLogs } from '../controllers/audit.controller.js';
import { requireAuth } from '../middleware/auth.js';
import { requirePermission } from '../middleware/authorize.js';
import { validate } from '../middleware/validate.js';

const router = Router();

router.get(
  '/',
  requireAuth,
  requirePermission('audit.read'),
  [
    query('action').optional().trim(),
    query('entity').optional().trim(),
    query('actor').optional().isMongoId().withMessage('Invalid actor id'),
    query('from').optional().isISO8601().withMessage('from must be a valid date'),
    query('to').optional().isISO8601().withMessage('to must be a valid date'),
    query('page').optional().isInt({ min: 1 }).withMessage('Invalid page'),
    query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Invalid limit'),
  ],
  validate,
  listAuditLogs
);

export default router;

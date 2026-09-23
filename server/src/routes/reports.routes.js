import { Router } from 'express';
import { query } from 'express-validator';
import { getSummary, getRedemptions, topupAnomalies, salesLedger } from '../controllers/reports.controller.js';
import {
  issuanceReport,
  liabilityReport,
  expiredReport,
  byStoreReport,
  byCashierReport,
  campaignReport,
  dailyReport,
  monthlyReport,
  reconciliationReport,
} from '../controllers/analytics.controller.js';
import { requireAuth } from '../middleware/auth.js';
import { requirePermission } from '../middleware/authorize.js';
import { validate } from '../middleware/validate.js';

const router = Router();

const dateFilters = [
  query('from').optional().isISO8601().withMessage('from must be a valid date (YYYY-MM-DD)'),
  query('to').optional().isISO8601().withMessage('to must be a valid date (YYYY-MM-DD)'),
];

router.get('/summary', requireAuth, requirePermission('reports.read'), dateFilters, validate, getSummary);
router.get(
  '/topup-anomalies',
  requireAuth,
  requirePermission('reports.read'),
  [
    query('days').optional().isInt({ min: 7, max: 90 }).withMessage('days must be 7–90'),
    query('floor').optional().isFloat({ min: 0 }).withMessage('floor must be >= 0'),
  ],
  validate,
  topupAnomalies
);
router.get(
  '/redemptions',
  requireAuth,
  requirePermission('reports.read'),
  [...dateFilters, query('store').optional().isMongoId().withMessage('Invalid store id')],
  validate,
  getRedemptions
);

const optId = (name) => query(name).optional().isMongoId().withMessage(`Invalid ${name} id`);
const optFormat = query('format').optional().isIn(['json', 'csv']).withMessage('format must be json or csv');
const paging = [
  query('page').optional().isInt({ min: 1 }).withMessage('Invalid page'),
  query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Invalid limit'),
];
const read = [requireAuth, requirePermission('reports.read')];

router.get('/issuance', ...read, [...dateFilters, optId('campaign'), optId('store'), optFormat], validate, issuanceReport);
router.get('/liability', ...read, [optId('campaign'), optFormat], validate, liabilityReport);
router.get('/expired', ...read, [...dateFilters, optFormat, ...paging], validate, expiredReport);
router.get('/by-store', ...read, [...dateFilters, optId('store'), optFormat], validate, byStoreReport);
router.get('/by-cashier', ...read, [...dateFilters, optId('store'), optFormat], validate, byCashierReport);
router.get('/campaigns', ...read, [...dateFilters, optFormat], validate, campaignReport);
router.get('/daily', ...read, [...dateFilters, optFormat], validate, dailyReport);
router.get('/monthly', ...read, [...dateFilters, optFormat], validate, monthlyReport);
router.get('/reconciliation', ...read, [optFormat], validate, reconciliationReport);
router.get(
  '/sales-ledger',
  ...read,
  [
    ...dateFilters,
    optId('store'),
    optId('cashier'),
    query('tender').optional().isIn(['NONE', 'CASH', 'VISA']).withMessage('tender must be NONE, CASH or VISA'),
    optFormat,
    ...paging,
  ],
  validate,
  salesLedger
);

export default router;

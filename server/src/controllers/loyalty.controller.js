import mongoose from 'mongoose';
import Customer from '../models/Customer.js';
import LoyaltyTransaction from '../models/LoyaltyTransaction.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { getLoyaltyConfig, cashValueForPoints } from '../services/loyalty.service.js';

function resolveCustomerId(req, allowQuery = true) {
  if (req.user.role === 'CUSTOMER') {
    const id = req.user.customer?._id || req.user.customer || null;
    if (!id) throw ApiError.forbidden('No customer account linked to this login');
    return String(id);
  }
  const id = allowQuery ? req.query.customer || req.body.customerId : req.body.customerId;
  if (!id) throw ApiError.badRequest('customer is required');
  if (!mongoose.isValidObjectId(id)) throw ApiError.badRequest('Invalid customer id');
  return String(id);
}

// GET /api/loyalty/me — own (or staff-queried) points balance + cash value + rates.
export const myLoyalty = asyncHandler(async (req, res) => {
  const customerId = resolveCustomerId(req);
  const [customer, cfg] = await Promise.all([
    Customer.findById(customerId).select('name loyaltyPoints loyaltyLifetimeEarned loyaltyLifetimeRedeemed pinSetAt pinHash'),
    getLoyaltyConfig(),
  ]);
  if (!customer) throw ApiError.notFound('Customer not found');
  res.json({
    customer: { id: String(customer._id), name: customer.name },
    points: customer.loyaltyPoints || 0,
    cashValue: cashValueForPoints(customer.loyaltyPoints || 0, cfg.mwkPerPoint),
    lifetimeEarned: customer.loyaltyLifetimeEarned || 0,
    lifetimeRedeemed: customer.loyaltyLifetimeRedeemed || 0,
    pinSet: !!customer.pinHash,
    rates: cfg,
  });
});

// GET /api/loyalty/transactions?customer= — points ledger view.
export const listLoyaltyTransactions = asyncHandler(async (req, res) => {
  const customerId = resolveCustomerId(req);
  const page = Math.max(1, parseInt(req.query.page ?? '1', 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit ?? '20', 10) || 20));
  const [customer, total, items, cfg] = await Promise.all([
    Customer.findById(customerId).select('name loyaltyPoints'),
    LoyaltyTransaction.countDocuments({ customer: customerId }),
    LoyaltyTransaction.find({ customer: customerId })
      .populate('store', 'name code')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    getLoyaltyConfig(),
  ]);
  if (!customer) throw ApiError.notFound('Customer not found');
  res.json({
    customer: { id: String(customer._id), name: customer.name, points: customer.loyaltyPoints || 0 },
    rates: cfg,
    items: items.map((t) => ({
      id: String(t._id),
      type: t.type,
      points: t.points,
      cashValue: t.cashValue,
      previousPoints: t.previousPoints,
      newPoints: t.newPoints,
      store: t.store ? { name: t.store.name, code: t.store.code } : null,
      createdAt: t.createdAt,
    })),
    pagination: { page, limit, total, pages: Math.ceil(total / limit) },
  });
});

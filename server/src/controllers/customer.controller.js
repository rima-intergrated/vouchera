import Customer from '../models/Customer.js';
import User from '../models/User.js';
import WalletTransaction from '../models/WalletTransaction.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { audit, escapeRegExp, generateVoucherCode } from '../utils/helpers.js';

export const listCustomers = asyncHandler(async (req, res) => {
  const filter = {};
  if (req.query.q) filter.name = { $regex: escapeRegExp(req.query.q.trim()), $options: 'i' };
  const customers = await Customer.find(filter).sort({ name: 1 }).limit(200);
  res.json({ customers });
});

// GET /api/customers/me — own account for the customer portal: balances,
// loyalty + cash value + rates, and whether the till PIN is set.
export const getMe = asyncHandler(async (req, res) => {
  const customerId = req.user.customer?._id || req.user.customer || null;
  if (!customerId) throw ApiError.forbidden('No customer account linked to this login');
  const customer = await Customer.findById(customerId).select('+pinHash');
  if (!customer) throw ApiError.notFound('Customer not found');
  const { getLoyaltyConfig, cashValueForPoints } = await import('../services/loyalty.service.js');
  const cfg = await getLoyaltyConfig();
  res.json({
    customer: {
      id: String(customer._id),
      name: customer.name,
      phone: customer.phone ?? null,
      email: customer.email ?? null,
      walletBalance: customer.walletBalance,
      walletCode: customer.walletCode,
      loyaltyPoints: customer.loyaltyPoints || 0,
      loyaltyCashValue: cashValueForPoints(customer.loyaltyPoints || 0, cfg.mwkPerPoint),
    },
    pinSet: !!customer.pinHash,
    pinSetAt: customer.pinSetAt ?? null,
    rates: cfg,
  });
});

export const getCustomer = asyncHandler(async (req, res) => {
  const customer = await Customer.findById(req.params.id).select('+pinHash');
  if (!customer) throw ApiError.notFound('Customer not found');
  const [flows, loyaltyFlows, login] = await Promise.all([
    WalletTransaction.aggregate([
      { $match: { customer: customer._id } },
      { $group: { _id: '$type', total: { $sum: '$amount' }, count: { $sum: 1 } } },
    ]),
    (await import('../models/LoyaltyTransaction.js')).default.aggregate([
      { $match: { customer: customer._id } },
      { $group: { _id: '$type', total: { $sum: '$points' }, count: { $sum: 1 } } },
    ]),
    User.findOne({ customer: customer._id }).select('name email role isActive createdAt'),
  ]);
  const byType = Object.fromEntries(flows.map((f) => [f._id, f]));
  const loyaltyByType = Object.fromEntries(loyaltyFlows.map((f) => [f._id, f]));
  const r2 = (n) => Math.round(Number(n) * 100) / 100;
  const safe = customer.toObject();
  delete safe.pinHash;
  res.json({
    customer: { ...safe, pinSet: !!customer.pinHash },
    stats: {
      toppedUp: r2(byType.TOP_UP?.total ?? 0),
      spent: r2(byType.DEBIT?.total ?? 0),
      transactions: (byType.TOP_UP?.count ?? 0) + (byType.DEBIT?.count ?? 0),
      loyaltyPoints: customer.loyaltyPoints || 0,
      loyaltyEarned: loyaltyByType.EARN?.total ?? 0,
      loyaltyRedeemed: loyaltyByType.REDEEM?.total ?? 0,
    },
    login: login
      ? { id: String(login._id), name: login.name, email: login.email, isActive: login.isActive }
      : null,
  });
});

export const updateCustomer = asyncHandler(async (req, res) => {
  const customer = await Customer.findById(req.params.id);
  if (!customer) throw ApiError.notFound('Customer not found');
  const { name, phone, email, notes } = req.body;
  if (name !== undefined) customer.name = name;
  if (phone !== undefined) customer.phone = phone || undefined;
  if (email !== undefined) customer.email = email || undefined;
  if (notes !== undefined) customer.notes = notes;
  try {
    await customer.save();
  } catch (err) {
    if (err?.code === 11000) throw ApiError.conflict('Phone or email already exists');
    throw err;
  }
  audit({ actor: req.user, action: 'customer.update', entity: 'Customer', entityId: String(customer._id), req });
  res.json({ customer });
});

export const createCustomer = asyncHandler(async (req, res) => {
  const { name, phone = null, email = null, notes = '' } = req.body;
  try {
    // Every customer gets a unique wallet code (portal QR) at creation.
    let customer = null;
    for (let attempt = 0; attempt < 5 && !customer; attempt += 1) {
      try {
        customer = await Customer.create({ name, phone, email, notes, walletCode: generateVoucherCode('WC') });
      } catch (err) {
        if (err?.code !== 11000 || attempt === 4) throw err;
      }
    }
    audit({ actor: req.user, action: 'customer.create', entity: 'Customer', entityId: String(customer._id), req });
    res.status(201).json({ customer });
  } catch (err) {
    if (err?.code === 11000) throw ApiError.conflict('Phone or email already exists');
    throw err;
  }
});

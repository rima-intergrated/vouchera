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

export const getCustomer = asyncHandler(async (req, res) => {
  const customer = await Customer.findById(req.params.id);
  if (!customer) throw ApiError.notFound('Customer not found');
  const [flows, login] = await Promise.all([
    WalletTransaction.aggregate([
      { $match: { customer: customer._id } },
      { $group: { _id: '$type', total: { $sum: '$amount' }, count: { $sum: 1 } } },
    ]),
    User.findOne({ customer: customer._id }).select('name email role isActive createdAt'),
  ]);
  const byType = Object.fromEntries(flows.map((f) => [f._id, f]));
  const r2 = (n) => Math.round(Number(n) * 100) / 100;
  res.json({
    customer,
    stats: {
      toppedUp: r2(byType.TOP_UP?.total ?? 0),
      spent: r2(byType.DEBIT?.total ?? 0),
      transactions: (byType.TOP_UP?.count ?? 0) + (byType.DEBIT?.count ?? 0),
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

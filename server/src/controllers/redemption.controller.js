import mongoose from 'mongoose';
import Voucher from '../models/Voucher.js';
import VoucherRedemption from '../models/VoucherRedemption.js';
import User from '../models/User.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { escapeRegExp } from '../utils/helpers.js';

// Accepts a user id or email; unknown emails match nothing (empty result, not an error).
async function cashierMatch(value) {
  if (mongoose.isValidObjectId(value)) return new mongoose.Types.ObjectId(value);
  const user = await User.findOne({ email: String(value).toLowerCase() }).select('_id');
  return user ? user._id : new mongoose.Types.ObjectId();
}

// GET /api/redemptions — complete history with role scoping:
//   ADMIN/AUDITOR: all records (optional store/cashier filters)
//   MANAGER:       own store only (store assignment required)
//   CASHIER:       own records only
// Filters: from, to, store, cashier, voucher (code prefix), voucherId,
//          campaign, minAmount, maxAmount, status (current voucher status).
export const listRedemptions = asyncHandler(async (req, res) => {
  const role = req.user.role;
  const match = {};

  if (role === 'CASHIER') {
    match.cashier = req.user._id;
  } else if (role === 'MANAGER') {
    const storeId = req.user.store?._id || req.user.store || null;
    if (!storeId) throw ApiError.forbidden('No store assigned to this manager account');
    match.store = new mongoose.Types.ObjectId(String(storeId));
    if (req.query.cashier) match.cashier = await cashierMatch(req.query.cashier);
  } else {
    if (req.query.store) match.store = new mongoose.Types.ObjectId(req.query.store);
    if (req.query.cashier) match.cashier = await cashierMatch(req.query.cashier);
  }

  if (req.query.from || req.query.to) {
    match.redeemedAt = {};
    if (req.query.from) match.redeemedAt.$gte = new Date(`${req.query.from}T00:00:00.000Z`);
    if (req.query.to) match.redeemedAt.$lte = new Date(`${req.query.to}T23:59:59.999Z`);
  }
  if (req.query.voucher) {
    // Matches voucher codes AND wallet codes (WALLET rows carry walletCode).
    const rx = { $regex: `^${escapeRegExp(String(req.query.voucher).trim().toUpperCase())}`, $options: 'i' };
    match.$or = [{ voucherCode: rx }, { walletCode: rx }];
  }
  if (req.query.voucherId) match.voucher = new mongoose.Types.ObjectId(req.query.voucherId);
  if (req.query.minAmount || req.query.maxAmount) {
    match.amountRedeemed = {};
    if (req.query.minAmount) match.amountRedeemed.$gte = Number(req.query.minAmount);
    if (req.query.maxAmount) match.amountRedeemed.$lte = Number(req.query.maxAmount);
  }

  const postMatch = {};
  if (req.query.campaign) {
    const vouchers = await Voucher.find({ campaign: req.query.campaign }).select('_id');
    postMatch.voucher = { $in: vouchers.map((v) => v._id) };
  }

  const pipeline = [
    { $match: match },
    {
      $lookup: {
        from: 'vouchers',
        localField: 'voucher',
        foreignField: '_id',
        as: '_voucher',
      },
    },
    { $unwind: { path: '$_voucher', preserveNullAndEmptyArrays: true } },
  ];
  if (req.query.status) postMatch['_voucher.status'] = req.query.status;
  if (Object.keys(postMatch).length) pipeline.push({ $match: postMatch });

  const page = Math.max(1, parseInt(req.query.page ?? '1', 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit ?? '20', 10) || 20));

  pipeline.push(
    { $sort: { redeemedAt: -1 } },
    {
      $facet: {
        items: [
          { $skip: (page - 1) * limit },
          { $limit: limit },
          {
            $lookup: { from: 'stores', localField: 'store', foreignField: '_id', as: '_store' },
          },
          {
            $lookup: { from: 'users', localField: 'cashier', foreignField: '_id', as: '_cashier' },
          },
          {
            $lookup: { from: 'customers', localField: 'customer', foreignField: '_id', as: '_customer' },
          },
          { $unwind: { path: '$_store', preserveNullAndEmptyArrays: true } },
          { $unwind: { path: '$_cashier', preserveNullAndEmptyArrays: true } },
          { $unwind: { path: '$_customer', preserveNullAndEmptyArrays: true } },
          {
            $project: {
              source: 1,
              redemptionReference: 1,
              voucherCode: 1,
              walletCode: 1,
              amountRedeemed: 1,
              previousBalance: 1,
              newBalance: 1,
              posTransactionReference: 1,
              redeemedAt: 1,
              status: '$_voucher.status',
              store: { name: '$_store.name', code: '$_store.code' },
              cashier: { name: '$_cashier.name', email: '$_cashier.email' },
              customer: { name: '$_customer.name' },
            },
          },
        ],
        total: [{ $count: 'count' }],
      },
    }
  );

  const [result] = await VoucherRedemption.aggregate(pipeline);
  const items = (result?.items ?? []).map((r) => ({ ...r, id: String(r._id), status: r.status ?? '—' }));
  const total = result?.total?.[0]?.count ?? 0;
  res.json({ items, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
});

// GET /api/redemptions/voucher/:voucherId — per-voucher history for the detail page.
export const voucherRedemptions = asyncHandler(async (req, res) => {
  const voucher = await Voucher.findById(req.params.voucherId).select('code originalValue remainingBalance totalRedeemed status');
  if (!voucher) throw ApiError.notFound('Voucher not found');

  // Managers only see their own store's redemptions of this voucher
  const filter = { voucher: voucher._id };
  if (req.user.role === 'MANAGER') {
    const storeId = req.user.store?._id || req.user.store || null;
    if (!storeId) throw ApiError.forbidden('No store assigned to this manager account');
    filter.store = storeId;
  } else if (req.user.role === 'CASHIER') {
    filter.cashier = req.user._id;
  }

  const items = await VoucherRedemption.find(filter)
    .populate('store', 'name code')
    .populate('cashier', 'name email')
    .sort({ redeemedAt: -1 })
    .lean();
  res.json({
    voucher: {
      code: voucher.code,
      originalValue: voucher.originalValue,
      remainingBalance: voucher.remainingBalance,
      totalRedeemed: voucher.totalRedeemed,
      status: voucher.status,
    },
    items: items.map((r) => ({
      id: String(r._id),
      redemptionReference: r.redemptionReference,
      amountRedeemed: r.amountRedeemed,
      previousBalance: r.previousBalance,
      newBalance: r.newBalance,
      store: r.store ? { name: r.store.name, code: r.store.code } : null,
      cashier: r.cashier ? { name: r.cashier.name, email: r.cashier.email } : null,
      posTransactionReference: r.posTransactionReference,
      redeemedAt: r.redeemedAt,
    })),
  });
});

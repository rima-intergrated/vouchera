import Voucher from '../models/Voucher.js';
import VoucherRedemption from '../models/VoucherRedemption.js';
import Store from '../models/Store.js';
import { asyncHandler } from '../utils/asyncHandler.js';

// Optional ?from=YYYY-MM-DD&to=YYYY-MM-DD scope for redemption metrics.
// Voucher snapshot metrics (counts, issued, outstanding) are always all-time.
function redemptionDateFilter(query) {
  const filter = {};
  const { from, to } = query;
  if (from || to) {
    filter.redeemedAt = {};
    if (from) filter.redeemedAt.$gte = new Date(`${from}T00:00:00.000Z`);
    if (to) filter.redeemedAt.$lte = new Date(`${to}T23:59:59.999Z`);
  }
  return filter;
}

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

// GET /api/reports/summary
export const getSummary = asyncHandler(async (req, res) => {
  const dateFilter = redemptionDateFilter(req.query);

  const [
    totalVouchers,
    statusCounts,
    valueStats,
    outstandingStats,
    redemptionStats,
    todayStats,
    storeActivity,
    recent,
  ] = await Promise.all([
    Voucher.countDocuments(),
    Voucher.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
    Voucher.aggregate([
      { $match: { status: { $ne: 'DRAFT' } } },
      { $group: { _id: null, issued: { $sum: '$originalValue' } } },
    ]),
    Voucher.aggregate([
      { $match: { status: { $in: ['ACTIVE', 'PARTIALLY_REDEEMED'] } } },
      { $group: { _id: null, outstanding: { $sum: '$remainingBalance' } } },
    ]),
    VoucherRedemption.aggregate([
      { $match: dateFilter },
      { $group: { _id: null, count: { $sum: 1 }, value: { $sum: '$amountRedeemed' } } },
    ]),
    VoucherRedemption.aggregate([
      { $match: { redeemedAt: { $gte: startOfToday() } } },
      { $group: { _id: null, count: { $sum: 1 }, value: { $sum: '$amountRedeemed' } } },
    ]),
    VoucherRedemption.aggregate([
      { $match: dateFilter },
      { $group: { _id: '$store', count: { $sum: 1 }, value: { $sum: '$amountRedeemed' } } },
      { $sort: { value: -1 } },
    ]),
    VoucherRedemption.find(dateFilter)
      .populate('store', 'name code')
      .populate('cashier', 'name email')
      .sort({ redeemedAt: -1 })
      .limit(10)
      .lean(),
  ]);

  const byStatus = {};
  for (const row of statusCounts) byStatus[row._id] = row.count;

  const stores = await Store.find({ isActive: true }).sort({ name: 1 }).lean();
  const activityByStore = stores.map((s) => {
    const hit = storeActivity.find((a) => String(a._id) === String(s._id));
    return {
      store: { id: String(s._id), name: s.name, code: s.code },
      redemptions: hit?.count ?? 0,
      value: hit?.value ?? 0,
    };
  });

  res.json({
    vouchers: {
      total: totalVouchers,
      active: byStatus.ACTIVE ?? 0,
      redeemed: (byStatus.PARTIALLY_REDEEMED ?? 0) + (byStatus.FULLY_REDEEMED ?? 0),
      expired: byStatus.EXPIRED ?? 0,
      byStatus,
    },
    values: {
      totalIssued: valueStats[0]?.issued ?? 0,
      totalRedeemed: redemptionStats[0]?.value ?? 0,
      outstanding: outstandingStats[0]?.outstanding ?? 0,
    },
    redemptions: {
      count: redemptionStats[0]?.count ?? 0,
      today: { count: todayStats[0]?.count ?? 0, value: todayStats[0]?.value ?? 0 },
    },
    activityByStore,
    recentRedemptions: recent.map((r) => ({
      id: String(r._id),
      redemptionReference: r.redemptionReference,
      voucherCode: r.voucherCode,
      amountRedeemed: r.amountRedeemed,
      store: r.store ? { name: r.store.name, code: r.store.code } : null,
      cashier: r.cashier ? { name: r.cashier.name, email: r.cashier.email } : null,
      posTransactionReference: r.posTransactionReference,
      redeemedAt: r.redeemedAt,
    })),
    filter: { from: req.query.from ?? null, to: req.query.to ?? null },
  });
});

// GET /api/reports/redemptions?from&to&store&page&limit
export const getRedemptions = asyncHandler(async (req, res) => {
  const filter = redemptionDateFilter(req.query);
  if (req.query.store) filter.store = req.query.store;

  const page = Math.max(1, parseInt(req.query.page ?? '1', 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit ?? '20', 10) || 20));

  const [total, items, storeActivity] = await Promise.all([
    VoucherRedemption.countDocuments(filter),
    VoucherRedemption.find(filter)
      .populate('store', 'name code')
      .populate('cashier', 'name email')
      .sort({ redeemedAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    VoucherRedemption.aggregate([
      { $match: filter },
      { $group: { _id: '$store', count: { $sum: 1 }, value: { $sum: '$amountRedeemed' } } },
      { $sort: { value: -1 } },
    ]),
  ]);

  const stores = await Store.find({ isActive: true }).sort({ name: 1 }).lean();
  const activityByStore = stores.map((s) => {
    const hit = storeActivity.find((a) => String(a._id) === String(s._id));
    return {
      store: { id: String(s._id), name: s.name, code: s.code },
      redemptions: hit?.count ?? 0,
      value: hit?.value ?? 0,
    };
  });

  res.json({
    items: items.map((r) => ({
      id: String(r._id),
      redemptionReference: r.redemptionReference,
      voucherCode: r.voucherCode,
      amountRedeemed: r.amountRedeemed,
      store: r.store ? { name: r.store.name, code: r.store.code } : null,
      cashier: r.cashier ? { name: r.cashier.name, email: r.cashier.email } : null,
      posTransactionReference: r.posTransactionReference,
      redeemedAt: r.redeemedAt,
    })),
    activityByStore,
    pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    filter: { from: req.query.from ?? null, to: req.query.to ?? null, store: req.query.store ?? null },
  });
});

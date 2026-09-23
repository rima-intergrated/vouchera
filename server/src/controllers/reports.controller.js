import mongoose from 'mongoose';
import Voucher from '../models/Voucher.js';
import VoucherRedemption from '../models/VoucherRedemption.js';
import Customer from '../models/Customer.js';
import WalletTransaction from '../models/WalletTransaction.js';
import Store from '../models/Store.js';
import User from '../models/User.js';
import Setting from '../models/Setting.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ApiError } from '../utils/ApiError.js';
import { audit } from '../utils/helpers.js';

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
    walletStats,
    topUpStats,
    giftCardStats,
    giftCardOutstanding,
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
    // Stored-value wallets: issued codes, funded count, balance held.
    Customer.aggregate([
      { $match: { walletCode: { $type: 'string' } } },
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          funded: { $sum: { $cond: [{ $gt: ['$walletBalance', 0] }, 1, 0] } },
          totalBalance: { $sum: '$walletBalance' },
        },
      },
    ]),
    // All-time wallet top-ups (money loaded onto wallets).
    WalletTransaction.aggregate([
      { $match: { type: 'TOP_UP' } },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]),
    // Gift cards are vouchers too — broken out for the stored-value view.
    Voucher.aggregate([
      { $match: { type: 'GIFT_CARD', status: { $ne: 'DRAFT' } } },
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          issued: { $sum: '$originalValue' },
        },
      },
    ]),
    Voucher.aggregate([
      { $match: { type: 'GIFT_CARD', status: { $in: ['ACTIVE', 'PARTIALLY_REDEEMED'] } } },
      { $group: { _id: null, outstanding: { $sum: '$remainingBalance' } } },
    ]),
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
    wallets: {
      total: walletStats[0]?.total ?? 0,
      funded: walletStats[0]?.funded ?? 0,
      totalBalance: walletStats[0]?.totalBalance ?? 0,
      totalToppedUp: topUpStats[0]?.total ?? 0,
    },
    giftCards: {
      total: giftCardStats[0]?.total ?? 0,
      issued: giftCardStats[0]?.issued ?? 0,
      outstanding: giftCardOutstanding[0]?.outstanding ?? 0,
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

// GET /api/reports/topup-anomalies?days=30&floor=50000
//
// Fraud tripwire for self-crediting staff: per-performer top-up totals for
// today against their own trailing daily average. Flags when today's total
// reaches 3× the baseline AND clears a noise floor (a quiet cashier's first
// K1,000 day is not fraud), or when any single top-up hits the approval
// threshold. Run daily; every check is audit-logged with its flag count.
export const topupAnomalies = asyncHandler(async (req, res) => {
  const days = Math.min(90, Math.max(7, parseInt(req.query.days ?? '30', 10) || 30));
  const floor = Math.max(0, Number(req.query.floor ?? 50000) || 0);

  const now = new Date();
  const todayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const baseStart = new Date(todayStart.getTime() - days * 86400000);

  const [todayAgg, baseAgg, thresholdRow] = await Promise.all([
    WalletTransaction.aggregate([
      { $match: { type: 'TOP_UP', createdAt: { $gte: todayStart } } },
      { $group: { _id: '$performedBy', total: { $sum: '$amount' }, count: { $sum: 1 }, maxSingle: { $max: '$amount' } } },
    ]),
    WalletTransaction.aggregate([
      { $match: { type: 'TOP_UP', createdAt: { $gte: baseStart, $lt: todayStart } } },
      {
        $group: {
          _id: '$performedBy',
          total: { $sum: '$amount' },
          activeDays: { $addToSet: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } } },
        },
      },
    ]),
    Setting.findOne({ key: 'topup.approvalThresholdMWK' }).select('value').lean(),
  ]);
  const threshold = Number(thresholdRow?.value ?? 0);

  const staffIds = [...new Set([...todayAgg, ...baseAgg].map((r) => String(r._id)).filter(Boolean))];
  const staff = await User.find({ _id: { $in: staffIds } }).select('name email role').lean();
  const byId = Object.fromEntries(staff.map((u) => [String(u._id), u]));
  const baseById = Object.fromEntries(baseAgg.map((r) => [String(r._id), r]));

  const items = todayAgg
    .filter((r) => r._id)
    .map((r) => {
      const id = String(r._id);
      const base = baseById[id];
      const dailyAvg = base ? base.total / days : 0;
      const ratio = dailyAvg > 0 ? r.total / dailyAvg : (r.total >= floor ? Infinity : 0);
      const reasons = [];
      if (r.total >= Math.max(3 * dailyAvg, floor)) reasons.push(r.total >= floor && dailyAvg === 0 ? 'FIRST_ACTIVITY_ABOVE_FLOOR' : 'SPIKE_VS_BASELINE');
      if (threshold > 0 && r.maxSingle >= threshold) reasons.push('SINGLE_ABOVE_APPROVAL_THRESHOLD');
      return {
        staff: byId[id] ? { id, name: byId[id].name, email: byId[id].email, role: byId[id].role } : { id, name: 'Unknown', email: '', role: '' },
        today: { total: Math.round(r.total * 100) / 100, count: r.count, maxSingle: r.maxSingle },
        baseline: { windowDays: days, dailyAvg: Math.round(dailyAvg * 100) / 100 },
        ratio: ratio === Infinity ? null : Math.round(ratio * 100) / 100,
        flagged: reasons.length > 0,
        reasons,
      };
    })
    .sort((a, b) => Number(b.flagged) - Number(a.flagged) || b.today.total - a.today.total);

  const flagged = items.filter((i) => i.flagged).length;
  audit({
    actor: req.user,
    action: 'reports.anomalies.checked',
    entity: 'WalletTransaction',
    metadata: { windowDays: days, floor, checked: items.length, flagged },
    req,
  });
  res.json({ generatedAt: now.toISOString(), windowDays: days, floor, approvalThreshold: threshold, flagged, items });
});

// GET /api/reports/sales-ledger?from&to&store&cashier&tender&format&page&limit
//
// The sales ledger: one row per sale with bill, stored-value leg, and
// outside-money legs (cash/VISA + auth code). Derived — never stored
// separately — so it cannot drift from the redemption table it reads.
// Totals must satisfy bills ≈ stored + cash + visa (unknown bills, i.e.
// rows with no billTotal, count only toward stored).
export const salesLedger = asyncHandler(async (req, res) => {
  const filter = {};
  if (req.query.from || req.query.to) {
    filter.redeemedAt = {};
    if (req.query.from) filter.redeemedAt.$gte = new Date(`${req.query.from}T00:00:00.000Z`);
    if (req.query.to) filter.redeemedAt.$lte = new Date(`${req.query.to}T23:59:59.999Z`);
  }
  if (req.user.role === 'MANAGER') {
    const storeId = req.user.store?._id || req.user.store || null;
    if (!storeId) throw ApiError.forbidden('No store assigned to this manager account');
    filter.store = new mongoose.Types.ObjectId(String(storeId));
  } else if (req.query.store) {
    filter.store = new mongoose.Types.ObjectId(req.query.store);
  }
  if (req.query.cashier) filter.cashier = new mongoose.Types.ObjectId(req.query.cashier);
  if (req.query.tender) filter.tenderMethod = req.query.tender;

  const toRow = (r) => ({
    id: String(r._id),
    date: r.redeemedAt,
    posRef: r.posTransactionReference,
    reference: r.redemptionReference,
    store: r.store ? { name: r.store.name, code: r.store.code } : null,
    cashier: r.cashier ? { name: r.cashier.name, email: r.cashier.email } : null,
    customer: r.customer ? { name: r.customer.name } : null,
    code: r.voucherCode ?? r.walletCode ?? null,
    source: r.source ?? 'VOUCHER',
    bill: r.billTotal ?? null,
    stored: r.amountRedeemed,
    cash: r.tenderMethod === 'CASH' ? (r.tenderAmount ?? 0) : 0,
    visa: r.tenderMethod === 'VISA' ? (r.tenderAmount ?? 0) : 0,
    visaAuth: r.tenderMethod === 'VISA' ? (r.tenderReference ?? null) : null,
    points: r.metadata?.pointsUsed ?? null,
  });

  if (String(req.query.format || '').toLowerCase() === 'csv') {
    const items = await VoucherRedemption.find(filter)
      .populate('store', 'name code')
      .populate('cashier', 'name email')
      .populate('customer', 'name')
      .sort({ redeemedAt: -1 })
      .limit(5000)
      .lean();
    const rows = items.map(toRow);
    const esc = (v) => {
      const s = v === null || v === undefined ? '' : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const cols = [
      ['date', 'Date'], ['posRef', 'POS Ref'], ['reference', 'Reference'], ['store', 'Store'],
      ['cashier', 'Cashier'], ['customer', 'Customer'], ['code', 'Code'], ['source', 'Source'],
      ['bill', 'Bill'], ['stored', 'Stored Value'], ['cash', 'Cash'], ['visa', 'VISA'],
      ['visaAuth', 'VISA Auth'], ['points', 'Points Used'],
    ];
    const flat = rows.map((r) => ({
      ...r,
      date: new Date(r.date).toISOString(),
      store: r.store?.name ?? '',
      cashier: r.cashier?.name ?? '',
      customer: r.customer?.name ?? '',
    }));
    const lines = [cols.map(([, label]) => label).join(',')];
    for (const row of flat) lines.push(cols.map(([key]) => esc(row[key])).join(','));
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="sales-ledger.csv"');
    return res.send(`\uFEFF${lines.join('\n')}`);
  }

  const page = Math.max(1, parseInt(req.query.page ?? '1', 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit ?? '20', 10) || 20));
  const [total, items, sums] = await Promise.all([
    VoucherRedemption.countDocuments(filter),
    VoucherRedemption.find(filter)
      .populate('store', 'name code')
      .populate('cashier', 'name email')
      .populate('customer', 'name')
      .sort({ redeemedAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    VoucherRedemption.aggregate([
      { $match: filter },
      {
        $group: {
          _id: null,
          bills: { $sum: '$billTotal' },
          stored: { $sum: '$amountRedeemed' },
          cash: { $sum: { $cond: [{ $eq: ['$tenderMethod', 'CASH'] }, '$tenderAmount', 0] } },
          visa: { $sum: { $cond: [{ $eq: ['$tenderMethod', 'VISA'] }, '$tenderAmount', 0] } },
          count: { $sum: 1 },
        },
      },
    ]),
  ]);
  const r2 = (n) => Math.round(Number(n || 0) * 100) / 100;
  const totals = {
    bills: r2(sums[0]?.bills ?? 0),
    stored: r2(sums[0]?.stored ?? 0),
    cash: r2(sums[0]?.cash ?? 0),
    visa: r2(sums[0]?.visa ?? 0),
    count: sums[0]?.count ?? 0,
  };
  audit({
    actor: req.user,
    action: 'reports.sales-ledger.viewed',
    entity: 'VoucherRedemption',
    metadata: { count: totals.count },
    req,
  });
  res.json({
    items: items.map(toRow),
    totals,
    balanced: Math.abs(totals.bills - (totals.stored + totals.cash + totals.visa)) < 0.02 || totals.bills === 0,
    pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    filter: { from: req.query.from ?? null, to: req.query.to ?? null, store: req.query.store ?? null, cashier: req.query.cashier ?? null, tender: req.query.tender ?? null },
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

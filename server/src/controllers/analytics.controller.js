import mongoose from 'mongoose';
import Voucher from '../models/Voucher.js';
import VoucherRedemption from '../models/VoucherRedemption.js';
import Campaign from '../models/Campaign.js';
import Store from '../models/Store.js';
import Customer from '../models/Customer.js';
import WalletTransaction from '../models/WalletTransaction.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

// ?from=YYYY-MM-DD&to=YYYY-MM-DD on an arbitrary date field.
function range(query, field) {
  const match = {};
  if (query.from || query.to) {
    match[field] = {};
    if (query.from) match[field].$gte = new Date(`${query.from}T00:00:00.000Z`);
    if (query.to) match[field].$lte = new Date(`${query.to}T23:59:59.999Z`);
  }
  return match;
}

// Managers are scoped to their own store on every redemption-derived report.
function scopedStore(req) {
  if (req.user.role !== 'MANAGER') {
    return req.query.store ? new mongoose.Types.ObjectId(req.query.store) : null;
  }
  const storeId = req.user.store?._id || req.user.store || null;
  if (!storeId) throw ApiError.forbidden('No store assigned to this manager account');
  return new mongoose.Types.ObjectId(String(storeId));
}

function usd2(expr) {
  return { $round: [expr, 2] };
}

// Minimal CSV writer: columns [{ key, label }], values quoted/escaped.
function sendCsv(res, filename, columns, rows) {
  const esc = (v) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [columns.map((c) => esc(c.label)).join(',')];
  for (const row of rows) lines.push(columns.map((c) => esc(row[c.key])).join(','));
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(`\uFEFF${lines.join('\n')}`);
}

function wantsCsv(req) {
  return String(req.query.format || '').toLowerCase() === 'csv';
}

// ---------------------------------------------------------------------------
// 1. Voucher issuance — vouchers created in range
// GET /api/reports/issuance?from&to&campaign&store&format
// ---------------------------------------------------------------------------
export const issuanceReport = asyncHandler(async (req, res) => {
  const match = { ...range(req.query, 'createdAt') };
  if (req.query.campaign) match.campaign = new mongoose.Types.ObjectId(req.query.campaign);
  if (req.query.store) match.validStores = new mongoose.Types.ObjectId(req.query.store);

  const [totals, byDay, byStatus] = await Promise.all([
    Voucher.aggregate([
      { $match: match },
      { $group: { _id: null, count: { $sum: 1 }, value: { $sum: '$originalValue' } } },
    ]),
    Voucher.aggregate([
      { $match: match },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
          count: { $sum: 1 },
          value: { $sum: '$originalValue' },
        },
      },
      { $sort: { _id: 1 } },
    ]),
    Voucher.aggregate([{ $match: match }, { $group: { _id: '$status', count: { $sum: 1 } } }]),
  ]);

  const rows = byDay.map((d) => ({ date: d._id, issued: d.count, value: usd2val(d.value) }));
  if (wantsCsv(req)) {
    return sendCsv(res, 'voucher-issuance.csv',
      [{ key: 'date', label: 'Date' }, { key: 'issued', label: 'Issued' }, { key: 'value', label: 'Value (K)' }], rows);
  }
  res.json({
    totals: { count: totals[0]?.count ?? 0, value: usd2val(totals[0]?.value ?? 0) },
    byDay: rows,
    byStatus: Object.fromEntries(byStatus.map((s) => [s._id, s.count])),
    filter: { from: req.query.from ?? null, to: req.query.to ?? null },
  });
});

function usd2val(n) {
  return Math.round(Number(n) * 100) / 100;
}

// ---------------------------------------------------------------------------
// 2. Outstanding voucher liability — redeemable snapshot
// GET /api/reports/liability?campaign&format
// ---------------------------------------------------------------------------
export const liabilityReport = asyncHandler(async (req, res) => {
  const match = { status: { $in: ['ACTIVE', 'PARTIALLY_REDEEMED'] } };
  if (req.query.campaign) match.campaign = new mongoose.Types.ObjectId(req.query.campaign);

  const [totals, byStatus, byCampaign, expiring] = await Promise.all([
    Voucher.aggregate([
      { $match: match },
      { $group: { _id: null, count: { $sum: 1 }, outstanding: { $sum: '$remainingBalance' } } },
    ]),
    Voucher.aggregate([{ $match: match }, { $group: { _id: '$status', count: { $sum: 1 }, outstanding: { $sum: '$remainingBalance' } } }]),
    Voucher.aggregate([
      { $match: match },
      { $group: { _id: '$campaign', count: { $sum: 1 }, outstanding: { $sum: '$remainingBalance' } } },
    ]),
    Voucher.aggregate([
      { $match: { ...match, expiryDate: { $lte: new Date(Date.now() + 30 * 864e5) } } },
      { $group: { _id: null, count: { $sum: 1 }, outstanding: { $sum: '$remainingBalance' } } },
    ]),
  ]);

  const campaigns = await Campaign.find({ _id: { $in: byCampaign.filter((c) => c._id).map((c) => c._id) } })
    .select('name code')
    .lean();
  const byId = Object.fromEntries(campaigns.map((c) => [String(c._id), c]));
  const campaignRows = byCampaign.map((c) => ({
    campaign: c._id ? `${byId[String(c._id)]?.name ?? 'Unknown'} (${byId[String(c._id)]?.code ?? '?'})` : 'No campaign',
    vouchers: c.count,
    outstanding: usd2val(c.outstanding),
  }));

  if (wantsCsv(req)) {
    return sendCsv(res, 'outstanding-liability.csv',
      [{ key: 'campaign', label: 'Campaign' }, { key: 'vouchers', label: 'Vouchers' }, { key: 'outstanding', label: 'Outstanding (K)' }], campaignRows);
  }
  res.json({
    totals: { count: totals[0]?.count ?? 0, outstanding: usd2val(totals[0]?.outstanding ?? 0) },
    byStatus: byStatus.map((s) => ({ status: s._id, count: s.count, outstanding: usd2val(s.outstanding) })),
    byCampaign: campaignRows,
    expiring30Days: { count: expiring[0]?.count ?? 0, outstanding: usd2val(expiring[0]?.outstanding ?? 0) },
  });
});

// ---------------------------------------------------------------------------
// 3. Expired vouchers — value written off in expiry-date range
// GET /api/reports/expired?from&to&format&page&limit
// ---------------------------------------------------------------------------
export const expiredReport = asyncHandler(async (req, res) => {
  const match = { status: 'EXPIRED', ...range(req.query, 'expiryDate') };
  const page = Math.max(1, parseInt(req.query.page ?? '1', 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit ?? '20', 10) || 20));

  const [totals, total, items] = await Promise.all([
    Voucher.aggregate([
      { $match: match },
      { $group: { _id: null, count: { $sum: 1 }, lostValue: { $sum: '$remainingBalance' } } },
    ]),
    Voucher.countDocuments(match),
    Voucher.find(match)
      .populate('customer', 'name phone')
      .sort({ expiryDate: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
  ]);

  const rows = items.map((v) => ({
    code: v.code,
    originalValue: usd2val(v.originalValue),
    lostValue: usd2val(v.remainingBalance),
    expiryDate: new Date(v.expiryDate).toISOString().slice(0, 10),
    customer: v.customer?.name ?? '',
  }));
  if (wantsCsv(req)) {
    return sendCsv(res, 'expired-vouchers.csv',
      [{ key: 'code', label: 'Voucher Code' }, { key: 'originalValue', label: 'Original (K)' }, { key: 'lostValue', label: 'Written Off (K)' }, { key: 'expiryDate', label: 'Expiry' }, { key: 'customer', label: 'Customer' }], rows);
  }
  res.json({
    totals: { count: totals[0]?.count ?? 0, lostValue: usd2val(totals[0]?.lostValue ?? 0) },
    items: rows,
    pagination: { page, limit, total, pages: Math.ceil(total / limit) },
  });
});

// ---------------------------------------------------------------------------
// 4. Redemption by store
// GET /api/reports/by-store?from&to&store&format
// ---------------------------------------------------------------------------
export const byStoreReport = asyncHandler(async (req, res) => {
  const storeId = scopedStore(req);
  const match = { ...range(req.query, 'redeemedAt') };
  if (storeId) match.store = storeId;

  const grouped = await VoucherRedemption.aggregate([
    { $match: match },
    {
      $group: {
        _id: '$store',
        redemptions: { $sum: 1 },
        value: { $sum: '$amountRedeemed' },
        vouchers: { $addToSet: '$voucher' },
        avgTicket: { $avg: '$amountRedeemed' },
      },
    },
    // Round money inside the pipeline so division results stay exact to tambala
    { $set: { value: { $round: ['$value', 2] }, avgTicket: { $round: ['$avgTicket', 2] } } },
    { $sort: { value: -1 } },
  ]);

  const stores = await Store.find({ _id: { $in: grouped.map((g) => g._id) } }).select('name code').lean();
  const byId = Object.fromEntries(stores.map((s) => [String(s._id), s]));
  const rows = grouped.map((g) => ({
    store: byId[String(g._id)]?.name ?? 'Unknown',
    code: byId[String(g._id)]?.code ?? '',
    redemptions: g.redemptions,
    value: usd2val(g.value),
    uniqueVouchers: g.vouchers.length,
    avgTicket: usd2val(g.avgTicket ?? 0),
  }));

  if (wantsCsv(req)) {
    return sendCsv(res, 'redemption-by-store.csv',
      [{ key: 'store', label: 'Store' }, { key: 'code', label: 'Code' }, { key: 'redemptions', label: 'Redemptions' }, { key: 'value', label: 'Value (K)' }, { key: 'uniqueVouchers', label: 'Vouchers' }, { key: 'avgTicket', label: 'Avg Ticket (K)' }], rows);
  }
  res.json({ rows, filter: { from: req.query.from ?? null, to: req.query.to ?? null } });
});

// ---------------------------------------------------------------------------
// 5. Redemption by cashier
// GET /api/reports/by-cashier?from&to&store&format
// ---------------------------------------------------------------------------
export const byCashierReport = asyncHandler(async (req, res) => {
  const storeId = scopedStore(req);
  const match = { ...range(req.query, 'redeemedAt') };
  if (storeId) match.store = storeId;

  const grouped = await VoucherRedemption.aggregate([
    { $match: match },
    {
      $group: {
        _id: { cashier: '$cashier', store: '$store' },
        redemptions: { $sum: 1 },
        value: { $sum: '$amountRedeemed' },
      },
    },
    { $sort: { value: -1 } },
    { $lookup: { from: 'users', localField: '_id.cashier', foreignField: '_id', as: '_u' } },
    { $lookup: { from: 'stores', localField: '_id.store', foreignField: '_id', as: '_s' } },
    { $unwind: { path: '$_u', preserveNullAndEmptyArrays: true } },
    { $unwind: { path: '$_s', preserveNullAndEmptyArrays: true } },
  ]);

  const rows = grouped.map((g) => ({
    cashier: g._u?.name ?? 'Unknown',
    email: g._u?.email ?? '',
    store: g._s?.name ?? '',
    redemptions: g.redemptions,
    value: usd2val(g.value),
  }));

  if (wantsCsv(req)) {
    return sendCsv(res, 'redemption-by-cashier.csv',
      [{ key: 'cashier', label: 'Cashier' }, { key: 'email', label: 'Email' }, { key: 'store', label: 'Store' }, { key: 'redemptions', label: 'Redemptions' }, { key: 'value', label: 'Value (K)' }], rows);
  }
  res.json({ rows, filter: { from: req.query.from ?? null, to: req.query.to ?? null } });
});

// ---------------------------------------------------------------------------
// 6. Campaign performance — issued vs redeemed vs outstanding per campaign
// GET /api/reports/campaigns?from&to&format
// ---------------------------------------------------------------------------
export const campaignReport = asyncHandler(async (req, res) => {
  const redMatch = { ...range(req.query, 'redeemedAt') };

  const [issued, redeemed] = await Promise.all([
    Voucher.aggregate([
      { $match: { status: { $ne: 'DRAFT' }, campaign: { $ne: null } } },
      {
        $group: {
          _id: '$campaign',
          issuedCount: { $sum: 1 },
          issuedValue: { $sum: '$originalValue' },
          outstanding: {
            $sum: { $cond: [{ $in: ['$status', ['ACTIVE', 'PARTIALLY_REDEEMED']] }, '$remainingBalance', 0] },
          },
        },
      },
    ]),
    VoucherRedemption.aggregate([
      { $match: redMatch },
      {
        $lookup: { from: 'vouchers', localField: 'voucher', foreignField: '_id', as: '_v' },
      },
      { $unwind: '$_v' },
      { $match: { '_v.campaign': { $ne: null } } },
      { $group: { _id: '$_v.campaign', redeemedValue: { $sum: '$amountRedeemed' }, redemptions: { $sum: 1 } } },
    ]),
  ]);

  const ids = [...new Set([...issued.map((i) => String(i._id)), ...redeemed.map((r) => String(r._id))])];
  const campaigns = await Campaign.find({ _id: { $in: ids } }).select('name code').lean();
  const byId = Object.fromEntries(campaigns.map((c) => [String(c._id), c]));
  const issuedById = Object.fromEntries(issued.map((i) => [String(i._id), i]));
  const redeemedById = Object.fromEntries(redeemed.map((r) => [String(r._id), r]));

  const rows = ids.map((id) => {
    const iv = usd2val(issuedById[id]?.issuedValue ?? 0);
    const rv = usd2val(redeemedById[id]?.redeemedValue ?? 0);
    return {
      campaign: byId[id]?.name ?? 'Unknown',
      code: byId[id]?.code ?? '',
      issued: issuedById[id]?.issuedCount ?? 0,
      issuedValue: iv,
      redeemedValue: rv,
      redemptions: redeemedById[id]?.redemptions ?? 0,
      outstanding: usd2val(issuedById[id]?.outstanding ?? 0),
      redemptionRate: iv > 0 ? Math.round((rv / iv) * 1000) / 10 : 0,
    };
  }).sort((a, b) => b.redeemedValue - a.redeemedValue);

  if (wantsCsv(req)) {
    return sendCsv(res, 'campaign-performance.csv',
      [{ key: 'campaign', label: 'Campaign' }, { key: 'code', label: 'Code' }, { key: 'issued', label: 'Issued' }, { key: 'issuedValue', label: 'Issued (K)' }, { key: 'redemptions', label: 'Redemptions' }, { key: 'redeemedValue', label: 'Redeemed (K)' }, { key: 'outstanding', label: 'Outstanding (K)' }, { key: 'redemptionRate', label: 'Rate %' }], rows);
  }
  res.json({ rows, filter: { from: req.query.from ?? null, to: req.query.to ?? null } });
});

// ---------------------------------------------------------------------------
// 7/8. Daily + monthly redemption summaries (with issuance side-by-side)
// ---------------------------------------------------------------------------
function periodBounds(query, defDays, maxDays) {
  const to = query.to ? new Date(`${query.to}T23:59:59.999Z`) : new Date();
  const from = query.from ? new Date(`${query.from}T00:00:00.000Z`) : new Date(to.getTime() - defDays * 864e5);
  if (from > to) throw ApiError.badRequest('from must not be after to');
  if ((to - from) / 864e5 > maxDays) throw ApiError.badRequest(`Date range too wide (max ${maxDays} days)`);
  return { from, to };
}

async function periodReport(req, format) {
  const { from, to } = periodBounds(req.query, 30, 366);
  const storeId = scopedStore(req);
  const redMatch = { redeemedAt: { $gte: from, $lte: to } };
  if (storeId) redMatch.store = storeId;
  const issueMatch = { createdAt: { $gte: from, $lte: to }, status: { $ne: 'DRAFT' } };

  const [red, issued] = await Promise.all([
    VoucherRedemption.aggregate([
      { $match: redMatch },
      {
        $group: {
          _id: { $dateToString: { format, date: '$redeemedAt' } },
          redemptions: { $sum: 1 },
          redeemedValue: { $sum: '$amountRedeemed' },
        },
      },
    ]),
    Voucher.aggregate([
      { $match: issueMatch },
      {
        $group: {
          _id: { $dateToString: { format, date: '$createdAt' } },
          issued: { $sum: 1 },
          issuedValue: { $sum: '$originalValue' },
        },
      },
    ]),
  ]);

  const map = new Map();
  for (const r of red) map.set(r._id, { period: r._id, redemptions: r.redemptions, redeemedValue: usd2val(r.redeemedValue), issued: 0, issuedValue: 0 });
  for (const v of issued) {
    const cur = map.get(v._id) ?? { period: v._id, redemptions: 0, redeemedValue: 0, issued: 0, issuedValue: 0 };
    cur.issued = v.issued;
    cur.issuedValue = usd2val(v.issuedValue);
    map.set(v._id, cur);
  }
  return [...map.values()].sort((a, b) => (a.period < b.period ? -1 : 1));
}

export const dailyReport = asyncHandler(async (req, res) => {
  const rows = await periodReport(req, '%Y-%m-%d');
  if (wantsCsv(req)) {
    return sendCsv(res, 'daily-redemptions.csv',
      [{ key: 'period', label: 'Date' }, { key: 'redemptions', label: 'Redemptions' }, { key: 'redeemedValue', label: 'Redeemed (K)' }, { key: 'issued', label: 'Issued' }, { key: 'issuedValue', label: 'Issued (K)' }], rows);
  }
  res.json({ rows });
});

export const monthlyReport = asyncHandler(async (req, res) => {
  const rows = await periodReport(req, '%Y-%m');
  if (wantsCsv(req)) {
    return sendCsv(res, 'monthly-redemptions.csv',
      [{ key: 'period', label: 'Month' }, { key: 'redemptions', label: 'Redemptions' }, { key: 'redeemedValue', label: 'Redeemed (K)' }, { key: 'issued', label: 'Issued' }, { key: 'issuedValue', label: 'Issued (K)' }], rows);
  }
  res.json({ rows });
});

// ---------------------------------------------------------------------------
// 9. Reconciliation — every kwacha accounted for (cumulative snapshot).
// Identity: (issued + topups + reloads)
//           − (redeemed + wallet debits + expired + cancelled)
//           == voucher outstanding + wallet outstanding == drift ≈ 0.
// Any non-zero drift means money moved outside the ledger and must be
// investigated. GET /api/reports/reconciliation?format
// ---------------------------------------------------------------------------
export const reconciliationReport = asyncHandler(async (req, res) => {
  const [
    issued,
    topups,
    reloads,
    redeemed,
    debits,
    expiredLost,
    cancelledLost,
    voucherOutstanding,
    walletOutstanding,
  ] = await Promise.all([
    Voucher.aggregate([
      { $match: { status: { $ne: 'DRAFT' } } },
      { $group: { _id: null, value: { $sum: '$originalValue' } } },
    ]),
    WalletTransaction.aggregate([
      { $match: { type: 'TOP_UP', target: 'WALLET' } },
      { $group: { _id: null, value: { $sum: '$amount' } } },
    ]),
    WalletTransaction.aggregate([
      { $match: { type: 'TOP_UP', target: 'GIFT_CARD' } },
      { $group: { _id: null, value: { $sum: '$amount' } } },
    ]),
    VoucherRedemption.aggregate([
      // Voucher-source spends only — WALLET debits are counted separately
      // below. ($ne also matches pre-G4 rows that predate the field.)
      { $match: { source: { $ne: 'WALLET' } } },
      { $group: { _id: null, value: { $sum: '$amountRedeemed' } } },
    ]),
    WalletTransaction.aggregate([
      { $match: { type: 'DEBIT' } },
      { $group: { _id: null, value: { $sum: '$amount' } } },
    ]),
    Voucher.aggregate([
      { $match: { status: 'EXPIRED' } },
      { $group: { _id: null, value: { $sum: '$remainingBalance' } } },
    ]),
    Voucher.aggregate([
      { $match: { status: 'CANCELLED' } },
      { $group: { _id: null, value: { $sum: '$remainingBalance' } } },
    ]),
    Voucher.aggregate([
      { $match: { status: { $in: ['ACTIVE', 'PARTIALLY_REDEEMED'] } } },
      { $group: { _id: null, value: { $sum: '$remainingBalance' } } },
    ]),
    Customer.aggregate([{ $group: { _id: null, value: { $sum: '$walletBalance' } } }]),
  ]);

  const val = (rows) => usd2val(rows[0]?.value ?? 0);
  const inflows = {
    voucherIssued: val(issued),
    walletTopups: val(topups),
    giftReloads: val(reloads),
  };
  const outflows = {
    voucherRedeemed: val(redeemed),
    walletDebits: val(debits),
    expiredWrittenOff: val(expiredLost),
    cancelledForfeited: val(cancelledLost),
  };
  const outstanding = {
    vouchers: val(voucherOutstanding),
    wallets: val(walletOutstanding),
  };
  const inTotal = usd2val(inflows.voucherIssued + inflows.walletTopups + inflows.giftReloads);
  const outTotal = usd2val(outflows.voucherRedeemed + outflows.walletDebits + outflows.expiredWrittenOff + outflows.cancelledForfeited);
  const outstandingTotal = usd2val(outstanding.vouchers + outstanding.wallets);
  const drift = usd2val(inTotal - outTotal - outstandingTotal);

  const rows = [
    { metric: 'Voucher issued', value: inflows.voucherIssued },
    { metric: 'Wallet top-ups', value: inflows.walletTopups },
    { metric: 'Gift card reloads', value: inflows.giftReloads },
    { metric: 'Voucher redeemed', value: -outflows.voucherRedeemed },
    { metric: 'Wallet debits', value: -outflows.walletDebits },
    { metric: 'Expired written off', value: -outflows.expiredWrittenOff },
    { metric: 'Cancelled forfeited', value: -outflows.cancelledForfeited },
    { metric: 'Outstanding (vouchers)', value: outstanding.vouchers },
    { metric: 'Outstanding (wallets)', value: outstanding.wallets },
    { metric: 'DRIFT (must be 0)', value: drift },
  ];
  if (wantsCsv(req)) {
    return sendCsv(res, 'reconciliation.csv',
      [{ key: 'metric', label: 'Metric' }, { key: 'value', label: 'Value (K)' }], rows);
  }
  res.json({ inflows, outflows, outstanding, totals: { inTotal, outTotal, outstandingTotal, drift } });
});

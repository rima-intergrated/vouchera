import mongoose from 'mongoose';
import Shift from '../models/Shift.js';
import VoucherRedemption from '../models/VoucherRedemption.js';
import WalletTransaction from '../models/WalletTransaction.js';
import Store from '../models/Store.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { audit, round2 } from '../utils/helpers.js';

function serializeShift(s) {
  const o = s.toObject ? s.toObject() : s;
  const cashier = o.cashier && typeof o.cashier === 'object' ? { name: o.cashier.name, email: o.cashier.email } : null;
  const store = o.store && typeof o.store === 'object' ? { name: o.store.name, code: o.store.code } : null;
  return {
    id: String(o._id),
    cashier,
    store,
    openedAt: o.openedAt,
    closedAt: o.closedAt,
    status: o.status,
    declaredCash: o.declaredCash,
    expectedCash: o.expectedCash,
    expectedVisa: o.expectedVisa,
    expectedStored: o.expectedStored,
    topupsCashReceived: o.topupsCashReceived,
    redemptionCount: o.redemptionCount,
    topupCount: o.topupCount,
    varianceCash: o.varianceCash,
    note: o.note || '',
  };
}

async function resolveStore(req) {
  const storeId = req.body.storeId || req.user.store?._id || req.user.store || null;
  if (!storeId) throw ApiError.badRequest('Store is required');
  const store = await Store.findOne({ _id: storeId, isActive: true });
  if (!store) throw ApiError.badRequest('Store not found');
  return store;
}

// POST /api/shifts/open — start a till shift. Idempotent per cashier: an
// existing OPEN shift is returned instead of erroring.
export const openShift = asyncHandler(async (req, res) => {
  const existing = await Shift.findOne({ cashier: req.user._id, status: 'OPEN' })
    .populate('store', 'name code')
    .populate('cashier', 'name email');
  if (existing) return res.json({ replayed: true, shift: serializeShift(existing) });
  const store = await resolveStore(req);
  try {
    const shift = await Shift.create({ cashier: req.user._id, store: store._id });
    await shift.populate([{ path: 'store', select: 'name code' }, { path: 'cashier', select: 'name email' }]);
    audit({ actor: req.user, action: 'shift.open', entity: 'Shift', entityId: String(shift._id), metadata: { store: store.code }, req });
    res.status(201).json({ shift: serializeShift(shift) });
  } catch (err) {
    if (err?.code === 11000) {
      const race = await Shift.findOne({ cashier: req.user._id, status: 'OPEN' }).populate('store', 'name code').populate('cashier', 'name email');
      return res.json({ replayed: true, shift: serializeShift(race) });
    }
    throw err;
  }
});

// POST /api/shifts/close { declaredCash, note? } — close own shift. Expected
// figures are computed from the immutable ledgers over the shift window:
// cash drawer should hold CASH top-ups received + CASH tenders collected.
export const closeShift = asyncHandler(async (req, res) => {
  const declared = round2(req.body.declaredCash);
  if (!Number.isFinite(declared) || declared < 0) throw ApiError.badRequest('Declared cash must be 0 or more');
  const shift = await Shift.findOne({ cashier: req.user._id, status: 'OPEN' });
  if (!shift) throw ApiError.badRequest('No open shift — open one first');
  const closedAt = new Date();
  const window = { $gte: shift.openedAt, $lt: closedAt };

  const [tenderAgg, storedAgg, topupAgg] = await Promise.all([
    VoucherRedemption.aggregate([
      { $match: { cashier: shift.cashier, store: shift.store, redeemedAt: window } },
      { $group: { _id: '$tenderMethod', total: { $sum: '$tenderAmount' }, count: { $sum: 1 } } },
    ]),
    VoucherRedemption.aggregate([
      { $match: { cashier: shift.cashier, store: shift.store, redeemedAt: window } },
      { $group: { _id: null, total: { $sum: '$amountRedeemed' }, count: { $sum: 1 } } },
    ]),
    WalletTransaction.aggregate([
      { $match: { performedBy: shift.cashier, store: shift.store, type: 'TOP_UP', method: 'CASH', createdAt: window } },
      { $group: { _id: null, total: { $sum: '$amount' }, count: { $sum: 1 } } },
    ]),
  ]);
  const tenderBy = Object.fromEntries(tenderAgg.map((t) => [t._id, t]));
  const expectedCash = round2((topupAgg[0]?.total ?? 0) + (tenderBy.CASH?.total ?? 0));
  const expectedVisa = round2(tenderBy.VISA?.total ?? 0);
  const expectedStored = round2(storedAgg[0]?.total ?? 0);

  shift.closedAt = closedAt;
  shift.status = 'CLOSED';
  shift.declaredCash = declared;
  shift.expectedCash = expectedCash;
  shift.expectedVisa = expectedVisa;
  shift.expectedStored = expectedStored;
  shift.topupsCashReceived = round2(topupAgg[0]?.total ?? 0);
  shift.redemptionCount = storedAgg[0]?.count ?? 0;
  shift.topupCount = topupAgg[0]?.count ?? 0;
  shift.varianceCash = round2(declared - expectedCash);
  shift.note = String(req.body.note || '').slice(0, 500);
  await shift.save();
  await shift.populate([{ path: 'store', select: 'name code' }, { path: 'cashier', select: 'name email' }]);
  audit({
    actor: req.user,
    action: 'shift.close',
    entity: 'Shift',
    entityId: String(shift._id),
    metadata: { declared, expectedCash, variance: shift.varianceCash },
    req,
  });
  res.json({ shift: serializeShift(shift) });
});

// GET /api/shifts/mine — current OPEN shift + recent history for the till.
export const myShifts = asyncHandler(async (req, res) => {
  const limit = Math.min(20, Math.max(1, parseInt(req.query.limit ?? '10', 10) || 10));
  const items = await Shift.find({ cashier: req.user._id })
    .populate('store', 'name code')
    .sort({ openedAt: -1 })
    .limit(limit)
    .lean();
  res.json({ items: items.map(serializeShift), open: items.some((s) => s.status === 'OPEN') });
});

// GET /api/shifts?from&to&store&cashier — closeout oversight with variances.
export const listShifts = asyncHandler(async (req, res) => {
  const filter = {};
  if (req.user.role === 'MANAGER') {
    const storeId = req.user.store?._id || req.user.store || null;
    if (!storeId) throw ApiError.forbidden('No store assigned to this manager account');
    filter.store = new mongoose.Types.ObjectId(String(storeId));
  } else {
    if (req.query.store) filter.store = new mongoose.Types.ObjectId(req.query.store);
  }
  if (req.query.cashier) {
    if (!mongoose.isValidObjectId(req.query.cashier)) throw ApiError.badRequest('Invalid cashier id');
    filter.cashier = new mongoose.Types.ObjectId(req.query.cashier);
  }
  if (req.query.from || req.query.to) {
    filter.openedAt = {};
    if (req.query.from) filter.openedAt.$gte = new Date(`${req.query.from}T00:00:00.000Z`);
    if (req.query.to) filter.openedAt.$lte = new Date(`${req.query.to}T23:59:59.999Z`);
  }
  if (req.query.status) {
    if (!['OPEN', 'CLOSED'].includes(req.query.status)) throw ApiError.badRequest('Invalid status');
    filter.status = req.query.status;
  }
  const page = Math.max(1, parseInt(req.query.page ?? '1', 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit ?? '20', 10) || 20));
  const [total, items] = await Promise.all([
    Shift.countDocuments(filter),
    Shift.find(filter)
      .populate('store', 'name code')
      .populate('cashier', 'name email')
      .sort({ openedAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
  ]);
  res.json({
    items: items.map(serializeShift),
    pagination: { page, limit, total, pages: Math.ceil(total / limit) },
  });
});

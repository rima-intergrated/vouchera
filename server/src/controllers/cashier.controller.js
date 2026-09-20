import Voucher from '../models/Voucher.js';
import VoucherRedemption from '../models/VoucherRedemption.js';
import Store from '../models/Store.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { audit, generateRedemptionReference, round2 } from '../utils/helpers.js';

const REDEEMABLE = ['ACTIVE', 'PARTIALLY_REDEEMED'];

const VALIDATE_POPULATE = [
  { path: 'customer', select: 'name phone' },
  { path: 'validStores', select: 'name code' },
  { path: 'campaign', select: 'name code' },
];

function snapshot(v) {
  return {
    code: v.code,
    type: v.type,
    originalValue: v.originalValue,
    remainingBalance: v.remainingBalance,
    status: v.status,
    expiryDate: v.expiryDate,
    customer: v.customer ? { name: v.customer.name, phone: v.customer.phone ?? null } : null,
    campaign: v.campaign ? { name: v.campaign.name, code: v.campaign.code } : null,
    validStores: (v.validStores ?? []).map((s) => ({ id: String(s._id), name: s.name, code: s.code })),
    restrictions: { notes: v.restrictions?.notes ?? '', minPurchase: v.restrictions?.minPurchase ?? 0 },
  };
}

const REASONS = {
  NOT_FOUND: 'Voucher not found. Check the code and try again.',
  DRAFT: 'This voucher has not been issued yet.',
  EXPIRED: 'This voucher has expired.',
  CANCELLED: 'This voucher has been cancelled.',
  SUSPENDED: 'This voucher is suspended. Ask a manager for help.',
  FULLY_REDEEMED: 'This voucher has been fully redeemed (zero balance).',
};

// Scanning only validates and displays — it MUST NOT change anything.
export const validateVoucher = asyncHandler(async (req, res) => {
  const code = String(req.body.code || '').trim().toUpperCase();
  const voucher = await Voucher.findOne({ code }).populate(VALIDATE_POPULATE);

  if (!voucher) {
    return res.json({ valid: false, code, reason: 'NOT_FOUND', message: REASONS.NOT_FOUND });
  }
  // Lazy expiry so scans report the truth without a background job
  if (REDEEMABLE.includes(voucher.status) && voucher.expiryDate < new Date()) {
    voucher.status = 'EXPIRED';
    await voucher.save();
  }
  if (!REDEEMABLE.includes(voucher.status)) {
    const reason = voucher.status in REASONS ? voucher.status : 'NOT_FOUND';
    return res.json({
      valid: false,
      code: voucher.code,
      reason,
      message: REASONS[reason] ?? REASONS.NOT_FOUND,
      voucher: snapshot(voucher),
    });
  }
  audit({ actor: req.user, action: 'voucher.validate', entity: 'Voucher', entityId: String(voucher._id), metadata: { code }, req });
  res.json({ valid: true, code: voucher.code, voucher: snapshot(voucher) });
});

function deviceMetadata(req) {
  return { ip: req.ip || req.headers['x-forwarded-for'] || '', userAgent: req.headers['user-agent'] || '' };
}

// Atomic redemption via a SINGLE aggregation-pipeline update:
// balance decrement, totals increment and status flip happen in one
// indivisible operation guarded by redeemability conditions, so concurrent
// scans can never double-spend the same balance.
export const redeemVoucher = asyncHandler(async (req, res) => {
  const code = String(req.body.code || '').trim().toUpperCase();
  const amount = round2(req.body.amount);
  const posTransactionReference = String(req.body.posTransactionReference || '').trim();
  const idempotencyKey = req.body.idempotencyKey ? String(req.body.idempotencyKey) : undefined;

  if (!Number.isFinite(amount) || amount <= 0) throw ApiError.badRequest('Redemption amount must be greater than 0');
  if (!posTransactionReference) throw ApiError.badRequest('POS transaction reference is required');

  // Safe retry: same key returns the original record instead of double-spending
  if (idempotencyKey) {
    const existing = await VoucherRedemption.findOne({ idempotencyKey })
      .populate('store', 'name code')
      .populate('cashier', 'name email');
    if (existing) {
      return res.json({
        replayed: true,
        redemption: serializeRedemption(existing),
        voucher: { code: existing.voucherCode, remainingBalance: existing.newBalance },
      });
    }
  }

  const voucher = await Voucher.findOne({ code }).populate('validStores', 'name code');
  if (!voucher) throw ApiError.notFound('Voucher not found');
  if (voucher.expiryDate < new Date() && REDEEMABLE.includes(voucher.status)) {
    voucher.status = 'EXPIRED';
    await voucher.save();
  }
  if (!REDEEMABLE.includes(voucher.status)) {
    throw ApiError.conflict(REASONS[voucher.status] ?? 'Voucher cannot be redeemed');
  }
  if (amount > voucher.remainingBalance) {
    throw ApiError.badRequest(`Amount exceeds remaining balance (${voucher.remainingBalance})`);
  }

  const storeId = req.body.storeId || req.user.store?._id || req.user.store || null;
  if (!storeId) throw ApiError.badRequest('Store is required');
  const store = await Store.findOne({ _id: storeId, isActive: true });
  if (!store) throw ApiError.badRequest('Store not found');
  if (voucher.validStores?.length && !voucher.validStores.some((s) => String(s._id) === String(store._id))) {
    throw ApiError.forbidden('Voucher is not valid at this store');
  }

  const now = new Date();
  const updated = await Voucher.findOneAndUpdate(
    {
      _id: voucher._id,
      status: { $in: REDEEMABLE },
      remainingBalance: { $gte: amount },
      expiryDate: { $gte: now },
    },
    [
      {
        $set: {
          // $round keeps every stored value at exactly 2dp (MWK tambala).
          remainingBalance: { $round: [{ $subtract: ['$remainingBalance', amount] }, 2] },
          totalRedeemed: { $round: [{ $add: ['$totalRedeemed', amount] }, 2] },
          redemptionCount: { $add: ['$redemptionCount', 1] },
          status: {
            $cond: [{ $eq: [{ $round: [{ $subtract: ['$remainingBalance', amount] }, 2] }, 0] }, 'FULLY_REDEEMED', 'PARTIALLY_REDEEMED'],
          },
        },
      },
    ],
    { new: true }
  );
  if (!updated) throw ApiError.conflict('Voucher changed during redemption — please re-scan and try again');

  const previousBalance = round2(updated.remainingBalance + amount);
  // Reference prefix follows the source: GC for gift cards, VR otherwise.
  const refPrefix = voucher.type === 'GIFT_CARD' ? 'GC' : 'VR';
  let redemption = null;
  let reference = null;
  for (let attempt = 0; attempt < 5 && !redemption; attempt += 1) {
    reference = generateRedemptionReference(refPrefix);
    try {
      redemption = await VoucherRedemption.create({
        source: voucher.type === 'GIFT_CARD' ? 'GIFT_CARD' : 'VOUCHER',
        voucher: voucher._id,
        voucherCode: voucher.code,
        amountRedeemed: amount,
        previousBalance,
        newBalance: updated.remainingBalance,
        cashier: req.user._id,
        store: store._id,
        posTransactionReference,
        redemptionReference: reference,
        metadata: deviceMetadata(req),
        ...(idempotencyKey ? { idempotencyKey } : {}),
      });
    } catch (err) {
      const fields = Object.keys(err.keyValue || {});
      if (err?.code === 11000 && fields.includes('redemptionReference')) continue; // harmless collision — regenerate
      // The balance was already debited atomically: roll it back before surfacing
      // ANY failure, otherwise money would disappear without a record.
      await Voucher.findOneAndUpdate({ _id: voucher._id }, [
        {
          $set: {
            remainingBalance: { $round: [{ $add: ['$remainingBalance', amount] }, 2] },
            totalRedeemed: { $round: [{ $subtract: ['$totalRedeemed', amount] }, 2] },
            redemptionCount: { $subtract: ['$redemptionCount', 1] },
            status: { $cond: [{ $eq: ['$totalRedeemed', amount] }, 'ACTIVE', 'PARTIALLY_REDEEMED'] },
          },
        },
      ]);
      if (err?.code === 11000) {
        throw ApiError.conflict('Duplicate redemption — this POS transaction was already recorded');
      }
      throw err;
    }
  }
  if (!redemption) throw ApiError.conflict('Could not record redemption — please try again');

  audit({
    actor: req.user,
    action: 'voucher.redeem',
    entity: 'VoucherRedemption',
    entityId: String(redemption._id),
    metadata: { code, amount, reference, store: store.code, posTransactionReference },
    req,
  });
  await redemption.populate([{ path: 'store', select: 'name code' }, { path: 'cashier', select: 'name email' }]);
  res.status(201).json({
    redemption: serializeRedemption(redemption),
    voucher: { code: voucher.code, remainingBalance: updated.remainingBalance, status: updated.status },
  });
});

function serializeRedemption(r) {
  return {
    id: String(r._id),
    source: r.source ?? 'VOUCHER',
    redemptionReference: r.redemptionReference,
    voucherCode: r.voucherCode ?? r.walletCode ?? null,
    walletCode: r.walletCode ?? null,
    customer: r.customer && typeof r.customer === 'object' ? { name: r.customer.name } : null,
    amountRedeemed: r.amountRedeemed,
    previousBalance: r.previousBalance,
    newBalance: r.newBalance,
    store: r.store ? { name: r.store.name, code: r.store.code } : null,
    cashier: r.cashier ? { name: r.cashier.name, email: r.cashier.email } : null,
    posTransactionReference: r.posTransactionReference,
    redeemedAt: r.redeemedAt,
  };
}

// Cashier's own redemption history (staff with read access may filter by cashier).
export const myRedemptions = asyncHandler(async (req, res) => {
  const filter = {};
  const canViewAll = ['ADMIN', 'MANAGER', 'AUDITOR'].includes(req.user.role);
  if (req.query.cashier && canViewAll) {
    filter.cashier = req.query.cashier;
  } else {
    filter.cashier = req.user._id;
  }
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit ?? '20', 10) || 20));
  const items = await VoucherRedemption.find(filter)
    .populate('store', 'name code')
    .sort({ redeemedAt: -1 })
    .limit(limit)
    .lean();
  res.json({
    items: items.map((r) => ({
      id: String(r._id),
      redemptionReference: r.redemptionReference,
      voucherCode: r.voucherCode ?? r.walletCode ?? null,
      amountRedeemed: r.amountRedeemed,
      newBalance: r.newBalance,
      store: r.store ? { name: r.store.name, code: r.store.code } : null,
      posTransactionReference: r.posTransactionReference,
      redeemedAt: r.redeemedAt,
    })),
  });
});

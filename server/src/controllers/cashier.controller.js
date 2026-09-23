import Voucher from '../models/Voucher.js';
import VoucherRedemption from '../models/VoucherRedemption.js';
import Customer from '../models/Customer.js';
import Store from '../models/Store.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { audit, generateRedemptionReference, round2, parseExternalTender } from '../utils/helpers.js';
import { verifyCustomerPin } from '../services/pin.service.js';
import { getLoyaltyConfig, cashValueForPoints, earnForSpend } from '../services/loyalty.service.js';

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
  // Linked (customer) vouchers need the holder's till PIN at redemption;
  // bearer/paper vouchers skip PIN.
  let pinSet = null;
  let loyalty = null;
  if (voucher.customer?._id || voucher.customer) {
    const holder = await Customer.findById(voucher.customer?._id || voucher.customer).select('loyaltyPoints pinHash');
    pinSet = !!holder?.pinHash;
    if (holder) {
      const cfg = await getLoyaltyConfig();
      loyalty = {
        points: holder.loyaltyPoints || 0,
        cashValue: cashValueForPoints(holder.loyaltyPoints || 0, cfg.mwkPerPoint),
        minRedeemPoints: cfg.minRedeemPoints,
        mwkPerPoint: cfg.mwkPerPoint,
      };
    }
  }
  res.json({
    valid: true,
    code: voucher.code,
    voucher: snapshot(voucher),
    requiresPin: !!voucher.customer,
    ...(pinSet !== null ? { pinSet } : {}),
    ...(loyalty ? { loyalty } : {}),
  });
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

  // Customer-linked vouchers require the holder's 4-digit till PIN.
  // Bearer/paper vouchers (no customer link) skip PIN authorisation.
  let pinCustomer = null;
  if (voucher.customer) {
    pinCustomer = await Customer.findById(voucher.customer).select('+pinHash');
    if (!pinCustomer) throw ApiError.notFound('Linked customer account not found');
    await verifyCustomerPin(pinCustomer, req.body.pin);
  }

  // Optional loyalty tender (linked accounts only): points discount reduces
  // the voucher charge. One PIN authorises both legs.
  const wantPoints = Math.floor(Number(req.body.loyaltyPoints) || 0);
  let pointsToUse = 0;
  let pointsDiscount = 0;
  if (wantPoints > 0) {
    if (!voucher.customer || !pinCustomer) throw ApiError.badRequest('Loyalty points require a customer-linked voucher');
    const cfg = await getLoyaltyConfig();
    if (wantPoints < cfg.minRedeemPoints) throw ApiError.badRequest(`Minimum ${cfg.minRedeemPoints} points per redemption`);
    if (wantPoints > (pinCustomer.loyaltyPoints || 0)) throw ApiError.badRequest(`Only ${pinCustomer.loyaltyPoints || 0} points available`);
    const maxUsable = Math.floor(amount / cfg.mwkPerPoint);
    pointsToUse = Math.min(wantPoints, maxUsable);
    pointsDiscount = cashValueForPoints(pointsToUse, cfg.mwkPerPoint);
  }
  const charge = round2(amount - pointsDiscount);
  if (charge < 0.01) {
    throw ApiError.badRequest('Points cover the full bill — pay with wallet debit instead of voucher');
  }
  // External tender validates against the voucher leg before anything moves.
  const tenderSplit = parseExternalTender(
    { billTotal: req.body.billTotal, tenderMethod: req.body.tenderMethod, tenderAmount: req.body.tenderAmount, tenderReference: req.body.tenderReference },
    charge
  );
  if (charge > voucher.remainingBalance) {
    throw ApiError.badRequest(
      pointsToUse
        ? `Amount exceeds remaining balance after ${pointsDiscount} points discount (${voucher.remainingBalance})`
        : `Amount exceeds remaining balance (${voucher.remainingBalance})`
    );
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
      remainingBalance: { $gte: charge },
      expiryDate: { $gte: now },
    },
    [
      {
        $set: {
          // $round keeps every stored value at exactly 2dp (MWK tambala).
          remainingBalance: { $round: [{ $subtract: ['$remainingBalance', charge] }, 2] },
          totalRedeemed: { $round: [{ $add: ['$totalRedeemed', charge] }, 2] },
          redemptionCount: { $add: ['$redemptionCount', 1] },
          status: {
            $cond: [{ $eq: [{ $round: [{ $subtract: ['$remainingBalance', charge] }, 2] }, 0] }, 'FULLY_REDEEMED', 'PARTIALLY_REDEEMED'],
          },
        },
      },
    ],
    { new: true }
  );
  if (!updated) throw ApiError.conflict('Voucher changed during redemption — please re-scan and try again');

  const previousBalance = round2(updated.remainingBalance + charge);
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
        amountRedeemed: charge,
        previousBalance,
        newBalance: updated.remainingBalance,
        cashier: req.user._id,
        store: store._id,
        posTransactionReference,
        redemptionReference: reference,
        metadata: {
          ...deviceMetadata(req),
          ...(pointsToUse ? { billTotal: amount, pointsUsed: pointsToUse, pointsDiscount } : {}),
        },
        billTotal: tenderSplit.billTotal,
        tenderMethod: tenderSplit.tenderMethod,
        tenderAmount: tenderSplit.tenderAmount,
        tenderReference: tenderSplit.tenderReference,
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
            remainingBalance: { $round: [{ $add: ['$remainingBalance', charge] }, 2] },
            totalRedeemed: { $round: [{ $subtract: ['$totalRedeemed', charge] }, 2] },
            redemptionCount: { $subtract: ['$redemptionCount', 1] },
            status: { $cond: [{ $eq: ['$totalRedeemed', charge] }, 'ACTIVE', 'PARTIALLY_REDEEMED'] },
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
    metadata: { code, amount: charge, billTotal: amount, reference, store: store.code, posTransactionReference, ...(pointsToUse ? { pointsUsed: pointsToUse } : {}) },
    req,
  });

  // Points leg of split tender (voucher charged first; on failure the voucher
  // debit above is rolled back so no value disappears).
  let loyalty = null;
  if (pointsToUse > 0) {
    try {
      const { redeemPoints } = await import('../services/loyalty.service.js');
      const r = await redeemPoints({
        customer: { _id: pinCustomer._id, loyaltyPoints: pinCustomer.loyaltyPoints },
        points: pointsToUse,
        storeId: store._id,
        actor: req.user,
        idempotencyKey: idempotencyKey ? `${idempotencyKey}:loyalty` : undefined,
      });
      r.txn.redemption = redemption._id;
      await r.txn.save().catch(() => {});
      loyalty = { points: r.points, discount: r.discount };
    } catch (err) {
      await Voucher.findOneAndUpdate({ _id: voucher._id }, [
        {
          $set: {
            remainingBalance: { $round: [{ $add: ['$remainingBalance', charge] }, 2] },
            totalRedeemed: { $round: [{ $subtract: ['$totalRedeemed', charge] }, 2] },
            redemptionCount: { $subtract: ['$redemptionCount', 1] },
            status: { $cond: [{ $eq: ['$totalRedeemed', charge] }, 'ACTIVE', 'PARTIALLY_REDEEMED'] },
          },
        },
      ]);
      throw err;
    }
  }

  // Auto-earn on the voucher-paid portion for linked accounts (best-effort).
  let earnedPoints = 0;
  if (voucher.customer) {
    try {
      const r = await earnForSpend({
        customerId: voucher.customer,
        amountMWK: charge,
        storeId: store._id,
        actor: req.user,
        redemptionId: redemption._id,
        idempotencyKey: idempotencyKey ? `${idempotencyKey}:earn` : undefined,
      });
      earnedPoints = r.earned || 0;
    } catch (err) {
      console.error('[loyalty] earn failed (redemption stands):', err.message);
    }
  }

  await redemption.populate([{ path: 'store', select: 'name code' }, { path: 'cashier', select: 'name email' }]);
  res.status(201).json({
    redemption: serializeRedemption(redemption),
    voucher: { code: voucher.code, remainingBalance: updated.remainingBalance, status: updated.status },
    ...(loyalty ? { loyalty } : {}),
    ...(earnedPoints ? { earnedPoints } : {}),
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
    billTotal: r.billTotal ?? null,
    tenderMethod: r.tenderMethod ?? 'NONE',
    tenderAmount: r.tenderAmount ?? 0,
    tenderReference: r.tenderReference ?? null,
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
      billTotal: r.billTotal ?? null,
      tenderMethod: r.tenderMethod ?? 'NONE',
      tenderAmount: r.tenderAmount ?? 0,
      store: r.store ? { name: r.store.name, code: r.store.code } : null,
      posTransactionReference: r.posTransactionReference,
      redeemedAt: r.redeemedAt,
    })),
  });
});

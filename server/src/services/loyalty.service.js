import Customer from '../models/Customer.js';
import LoyaltyTransaction from '../models/LoyaltyTransaction.js';
import Setting from '../models/Setting.js';
import { ApiError } from '../utils/ApiError.js';
import { round2 } from '../utils/helpers.js';

// Admin-configured rates (dynamic — Settings UI, no deploys).
export async function getLoyaltyConfig() {
  const rows = await Setting.find({
    key: { $in: ['loyalty.pointsPer100MWK', 'loyalty.mwkPerPoint', 'loyalty.minRedeemPoints'] },
  }).lean();
  const byKey = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  return {
    pointsPer100MWK: Number(byKey['loyalty.pointsPer100MWK'] ?? 1),
    mwkPerPoint: Number(byKey['loyalty.mwkPerPoint'] ?? 1),
    minRedeemPoints: Math.max(1, Math.floor(Number(byKey['loyalty.minRedeemPoints'] ?? 100))),
  };
}

export function pointsForSpend(amountMWK, pointsPer100MWK) {
  if (!pointsPer100MWK || pointsPer100MWK <= 0) return 0;
  return Math.floor((round2(amountMWK) / 100) * pointsPer100MWK);
}

export function cashValueForPoints(points, mwkPerPoint) {
  return round2(points * mwkPerPoint);
}

// Auto-earn after a cash/wallet till payment. Idempotent per redemption:
// same idempotencyKey returns the original entry. Zero-point spends skip.
export async function earnForSpend({ customerId, amountMWK, storeId = null, actor = null, redemptionId = null, idempotencyKey = undefined }) {
  const cfg = await getLoyaltyConfig();
  const points = pointsForSpend(amountMWK, cfg.pointsPer100MWK);
  if (points <= 0) return { earned: 0, txn: null, config: cfg };
  if (idempotencyKey) {
    const existing = await LoyaltyTransaction.findOne({ idempotencyKey });
    if (existing) return { earned: existing.points, txn: existing, replayed: true, config: cfg };
  }
  const updated = await Customer.findOneAndUpdate(
    { _id: customerId },
    [{ $set: { loyaltyPoints: { $add: ['$loyaltyPoints', points] }, loyaltyLifetimeEarned: { $add: ['$loyaltyLifetimeEarned', points] } } }],
    { new: false }
  );
  if (!updated) throw ApiError.notFound('Customer not found');
  const previousPoints = updated.loyaltyPoints || 0;
  try {
    const txn = await LoyaltyTransaction.create({
      customer: updated._id,
      type: 'EARN',
      points,
      cashValue: round2(amountMWK),
      previousPoints,
      newPoints: previousPoints + points,
      store: storeId,
      performedBy: actor?._id ?? null,
      redemption: redemptionId,
      idempotencyKey,
      metadata: { pointsPer100MWK: cfg.pointsPer100MWK },
    });
    return { earned: points, txn, config: cfg };
  } catch (err) {
    await Customer.findOneAndUpdate({ _id: updated._id }, [
      { $set: { loyaltyPoints: { $subtract: ['$loyaltyPoints', points] }, loyaltyLifetimeEarned: { $subtract: ['$loyaltyLifetimeEarned', points] } } },
    ]);
    if (err?.code === 11000) throw ApiError.conflict('Duplicate loyalty earn — already recorded');
    throw err;
  }
}

// Spend points for a MWK discount at the till. Returns the discount value.
// Caller applies `discount` against the bill before debiting wallet/voucher.
export async function redeemPoints({ customer, points, storeId = null, actor = null, idempotencyKey = undefined }) {
  const cfg = await getLoyaltyConfig();
  const want = Math.floor(Number(points));
  if (!Number.isFinite(want) || want <= 0) throw ApiError.badRequest('Points to redeem must be at least 1');
  if (want < cfg.minRedeemPoints) {
    throw ApiError.badRequest(`Minimum ${cfg.minRedeemPoints} points per redemption`);
  }
  if (idempotencyKey) {
    const existing = await LoyaltyTransaction.findOne({ idempotencyKey });
    if (existing) {
      return { replayed: true, txn: existing, discount: existing.cashValue, points: existing.points, config: cfg };
    }
  }
  if (want > (customer.loyaltyPoints || 0)) {
    throw ApiError.badRequest(`Only ${customer.loyaltyPoints || 0} points available`);
  }
  const discount = cashValueForPoints(want, cfg.mwkPerPoint);

  const updated = await Customer.findOneAndUpdate(
    { _id: customer._id, loyaltyPoints: { $gte: want } },
    [{ $set: { loyaltyPoints: { $subtract: ['$loyaltyPoints', want] }, loyaltyLifetimeRedeemed: { $add: ['$loyaltyLifetimeRedeemed', want] } } }],
    { new: false }
  );
  if (!updated) throw ApiError.conflict('Points changed — please re-scan and try again');
  const previousPoints = updated.loyaltyPoints || 0;
  try {
    const txn = await LoyaltyTransaction.create({
      customer: updated._id,
      type: 'REDEEM',
      points: want,
      cashValue: discount,
      previousPoints,
      newPoints: previousPoints - want,
      store: storeId,
      performedBy: actor?._id ?? null,
      idempotencyKey,
      metadata: { mwkPerPoint: cfg.mwkPerPoint },
    });
    return { replayed: false, txn, discount, points: want, config: cfg };
  } catch (err) {
    await Customer.findOneAndUpdate({ _id: updated._id }, [
      { $set: { loyaltyPoints: { $add: ['$loyaltyPoints', want] }, loyaltyLifetimeRedeemed: { $subtract: ['$loyaltyLifetimeRedeemed', want] } } },
    ]);
    if (err?.code === 11000) throw ApiError.conflict('Duplicate points redemption — already recorded');
    throw err;
  }
}

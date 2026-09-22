import Customer from '../models/Customer.js';
import Voucher from '../models/Voucher.js';
import VoucherRedemption from '../models/VoucherRedemption.js';
import WalletTransaction from '../models/WalletTransaction.js';
import Store from '../models/Store.js';
import { ApiError } from '../utils/ApiError.js';
import { generateRedemptionReference, round2 } from '../utils/helpers.js';
import { verifyCustomerPin } from './pin.service.js';
import { getLoyaltyConfig, cashValueForPoints, earnForSpend } from './loyalty.service.js';

// ---------------------------------------------------------------------------
// Wallet domain logic — money INTO customer accounts. Spending (DEBIT) lands
// in G4 and reuses the same ledger. Every balance change is an atomic
// single-document update paired with an immutable transaction record.
// ---------------------------------------------------------------------------

// Credit a customer wallet after verified payment (cash at till or transfer
// confirmed by admin). TRANSFER always requires a payment reference.
export async function creditWallet({ customerId, amount, method, paymentReference = null, storeId = null, actor = null, idempotencyKey = undefined }) {
  const value = round2(amount);
  if (!Number.isFinite(value) || value < 0.01) throw ApiError.badRequest('Top-up amount must be at least 0.01');
  if (!['CASH', 'TRANSFER'].includes(method)) throw ApiError.badRequest('Method must be CASH or TRANSFER');
  const ref = paymentReference ? String(paymentReference).trim() : '';
  if (method === 'TRANSFER' && !ref) throw ApiError.badRequest('TRANSFER top-ups require a payment reference');

  if (idempotencyKey) {
    const existing = await WalletTransaction.findOne({ idempotencyKey }).populate('customer', 'name');
    if (existing) return { replayed: true, txn: existing };
  }
  if (ref) {
    const dup = await WalletTransaction.findOne({ paymentReference: ref }).select('_id');
    if (dup) throw ApiError.conflict('This payment reference was already credited');
  }

  const updated = await Customer.findOneAndUpdate(
    { _id: customerId },
    [{ $set: { walletBalance: { $round: [{ $add: ['$walletBalance', value] }, 2] } } }],
    { new: false }
  );
  if (!updated) throw ApiError.notFound('Customer not found');
  const previousBalance = round2(updated.walletBalance);

  try {
    const txn = await WalletTransaction.create({
      customer: updated._id,
      type: 'TOP_UP',
      amount: value,
      previousBalance,
      newBalance: round2(previousBalance + value),
      method,
      paymentReference: ref || undefined,
      target: 'WALLET',
      store: storeId,
      performedBy: actor?._id ?? null,
      idempotencyKey,
    });
    return { replayed: false, txn };
  } catch (err) {
    // Balance already moved — roll it back before surfacing ANY failure.
    await Customer.findOneAndUpdate({ _id: updated._id }, [
      { $set: { walletBalance: { $round: [{ $subtract: ['$walletBalance', value] }, 2] } } },
    ]);
    if (err?.code === 11000) throw ApiError.conflict('Duplicate top-up — this payment was already recorded');
    throw err;
  }
}

// Reload a gift card: atomically increase its balance and record the funding
// on the shared wallet ledger (target GIFT_CARD). A fully spent card becomes
// spendable again (status back to ACTIVE); lifetime totalRedeemed is kept.
export async function reloadGiftCard({ voucherId, amount, method, paymentReference = null, storeId = null, actor = null, idempotencyKey = undefined }) {
  const value = round2(amount);
  if (!Number.isFinite(value) || value < 0.01) throw ApiError.badRequest('Reload amount must be at least 0.01');
  if (!['CASH', 'TRANSFER'].includes(method)) throw ApiError.badRequest('Method must be CASH or TRANSFER');
  const ref = paymentReference ? String(paymentReference).trim() : '';
  if (method === 'TRANSFER' && !ref) throw ApiError.badRequest('TRANSFER reloads require a payment reference');

  if (idempotencyKey) {
    const existing = await WalletTransaction.findOne({ idempotencyKey }).populate('voucher', 'code');
    if (existing) return { replayed: true, txn: existing };
  }
  if (ref) {
    const dup = await WalletTransaction.findOne({ paymentReference: ref }).select('_id');
    if (dup) throw ApiError.conflict('This payment reference was already credited');
  }

  const voucher = await Voucher.findById(voucherId);
  if (!voucher) throw ApiError.notFound('Voucher not found');
  if (voucher.type !== 'GIFT_CARD') throw ApiError.badRequest('Only gift cards can be reloaded');
  if (voucher.expiryDate < new Date() && ['ACTIVE', 'PARTIALLY_REDEEMED', 'FULLY_REDEEMED'].includes(voucher.status)) {
    voucher.status = 'EXPIRED';
    await voucher.save();
  }
  if (!['ACTIVE', 'PARTIALLY_REDEEMED', 'FULLY_REDEEMED'].includes(voucher.status)) {
    throw ApiError.conflict(`Cannot reload a ${voucher.status} gift card`);
  }

  const updated = await Voucher.findOneAndUpdate(
    { _id: voucher._id, status: { $in: ['ACTIVE', 'PARTIALLY_REDEEMED', 'FULLY_REDEEMED'] } },
    [{ $set: { remainingBalance: { $round: [{ $add: ['$remainingBalance', value] }, 2] }, status: 'ACTIVE' } }],
    { new: false }
  );
  if (!updated) throw ApiError.conflict('Gift card changed during reload — please try again');
  const previousBalance = round2(updated.remainingBalance);

  try {
    const txn = await WalletTransaction.create({
      customer: voucher.customer ?? null,
      type: 'TOP_UP',
      amount: value,
      previousBalance,
      newBalance: round2(previousBalance + value),
      method,
      paymentReference: ref || undefined,
      target: 'GIFT_CARD',
      voucher: voucher._id,
      store: storeId,
      performedBy: actor?._id ?? null,
      idempotencyKey,
    });
    return { replayed: false, txn };
  } catch (err) {
    await Voucher.findOneAndUpdate({ _id: voucher._id }, [
      { $set: { remainingBalance: { $round: [{ $subtract: ['$remainingBalance', value] }, 2] }, status: updated.status } },
    ]);
    if (err?.code === 11000) throw ApiError.conflict('Duplicate reload — this payment was already recorded');
    throw err;
  }
}

// Spend from a customer wallet at the till: PIN-verified atomic debit +
// immutable ledger entry + unified redemption record (source WALLET), with
// the same duplicate/idempotency guarantees as voucher redemption.
// Optional loyalty tender: `loyaltyPoints` consumes points for a MWK
// discount first (one PIN authorises both legs); the wallet is charged the
// remainder. Points are earned on the cash-paid portion only.
export async function debitWallet({ walletCode = null, customerId = null, amount, posTransactionReference, storeId, actor = null, idempotencyKey = undefined, device = {}, pin = undefined, loyaltyPoints = 0 }) {
  const value = round2(amount);
  if (!Number.isFinite(value) || value < 0.01) throw ApiError.badRequest('Amount must be at least 0.01');
  const posRef = String(posTransactionReference || '').trim();
  if (!posRef) throw ApiError.badRequest('POS transaction reference is required');
  if (!storeId) throw ApiError.badRequest('Store is required');
  const store = await Store.findOne({ _id: storeId, isActive: true }).select('name code');
  if (!store) throw ApiError.badRequest('Store not found');

  const customer = walletCode
    ? await Customer.findOne({ walletCode: String(walletCode).trim().toUpperCase() }).select('+pinHash')
    : await Customer.findById(customerId).select('+pinHash');
  if (!customer) throw ApiError.notFound('Customer wallet not found');

  // The till PIN authorises every wallet debit — verified BEFORE money moves.
  await verifyCustomerPin(customer, pin);

  // Loyalty tender: compute the discount (pure calc, no writes yet).
  const wantPoints = Math.floor(Number(loyaltyPoints) || 0);
  let pointsToUse = 0;
  let pointsDiscount = 0;
  let loyaltyCfg = null;
  if (wantPoints > 0) {
    loyaltyCfg = await getLoyaltyConfig();
    if (wantPoints < loyaltyCfg.minRedeemPoints) {
      throw ApiError.badRequest(`Minimum ${loyaltyCfg.minRedeemPoints} points per redemption`);
    }
    if (wantPoints > (customer.loyaltyPoints || 0)) {
      throw ApiError.badRequest(`Only ${customer.loyaltyPoints || 0} points available`);
    }
    // Auto-cap so the discount never exceeds the bill.
    const maxUsable = Math.floor(value / loyaltyCfg.mwkPerPoint);
    pointsToUse = Math.min(wantPoints, maxUsable);
    if (pointsToUse < loyaltyCfg.minRedeemPoints) {
      throw ApiError.badRequest(`Bill too small — ${loyaltyCfg.minRedeemPoints} points need a bill of at least ${round2(loyaltyCfg.minRedeemPoints * loyaltyCfg.mwkPerPoint)}`);
    }
    pointsDiscount = cashValueForPoints(pointsToUse, loyaltyCfg.mwkPerPoint);
  }
  const walletCharge = round2(value - pointsDiscount);

  if (walletCharge >= 0.01 && walletCharge > customer.walletBalance) {
    throw ApiError.badRequest(
      pointsToUse
        ? `Amount exceeds wallet balance after ${pointsDiscount} points discount (needs ${walletCharge}, has ${customer.walletBalance})`
        : `Amount exceeds wallet balance (${customer.walletBalance})`
    );
  }

  if (idempotencyKey) {
    const priorTxn = await WalletTransaction.findOne({ idempotencyKey });
    if (priorTxn) {
      const priorRed = await VoucherRedemption.findOne({ idempotencyKey });
      return { replayed: true, txn: priorTxn, redemption: priorRed };
    }
    if (walletCharge < 0.01 && pointsToUse > 0) {
      const { default: LoyaltyTransaction } = await import('../models/LoyaltyTransaction.js');
      const priorLoyalty = await LoyaltyTransaction.findOne({ idempotencyKey: `${idempotencyKey}:loyalty` });
      if (priorLoyalty) {
        const priorRed = await VoucherRedemption.findOne({ idempotencyKey: `${idempotencyKey}:loyalty-red` });
        return { replayed: true, txn: null, redemption: priorRed, loyalty: { points: priorLoyalty.points, discount: priorLoyalty.cashValue } };
      }
    }
  }

  // Full-points payment: no wallet leg at all.
  if (walletCharge < 0.01 && pointsToUse > 0) {
    const { redeemPoints } = await import('./loyalty.service.js');
    const { txn: loyaltyTxn } = await redeemPoints({
      customer,
      points: pointsToUse,
      storeId: store._id,
      actor,
      idempotencyKey: idempotencyKey ? `${idempotencyKey}:loyalty` : undefined,
    });
    let loyaltyRedemption = null;
    for (let attempt = 0; attempt < 5 && !loyaltyRedemption; attempt += 1) {
      try {
        loyaltyRedemption = await VoucherRedemption.create({
          source: 'LOYALTY',
          voucher: null,
          customer: customer._id,
          walletCode: customer.walletCode,
          amountRedeemed: pointsDiscount,
          previousBalance: loyaltyTxn.previousPoints,
          newBalance: loyaltyTxn.newPoints,
          cashier: actor?._id ?? null,
          store: store._id,
          posTransactionReference: posRef,
          redemptionReference: generateRedemptionReference('LP'),
          metadata: { ...device, pointsUsed: pointsToUse, billTotal: value },
          ...(idempotencyKey ? { idempotencyKey: `${idempotencyKey}:loyalty-red` } : {}),
        });
      } catch (err) {
        if (err?.code === 11000 && Object.keys(err.keyValue || {}).includes('redemptionReference')) continue;
        throw err?.code === 11000
          ? ApiError.conflict('Duplicate points redemption — already recorded')
          : err;
      }
    }
    loyaltyTxn.redemption = loyaltyRedemption._id;
    await loyaltyTxn.save().catch(() => {});
    return {
      replayed: false, txn: null, redemption: loyaltyRedemption,
      newBalance: customer.walletBalance,
      loyalty: { points: pointsToUse, discount: pointsDiscount },
      earnedPoints: 0,
    };
  }

  const updated = await Customer.findOneAndUpdate(
    { _id: customer._id, walletBalance: { $gte: walletCharge } },
    [{ $set: { walletBalance: { $round: [{ $subtract: ['$walletBalance', walletCharge] }, 2] } } }],
    { new: false }
  );
  if (!updated) throw ApiError.conflict('Wallet changed during debit — please re-scan and try again');
  const previousBalance = round2(updated.walletBalance);

  const rollback = () =>
    Customer.findOneAndUpdate({ _id: customer._id }, [
      { $set: { walletBalance: { $round: [{ $add: ['$walletBalance', walletCharge] }, 2] } } },
    ]);

  // Redemption record first (reference-collision retry), then the ledger entry.
  // amountRedeemed = wallet leg; split-tender context (bill total, points) in metadata.
  let redemption = null;
  for (let attempt = 0; attempt < 5 && !redemption; attempt += 1) {
    try {
      redemption = await VoucherRedemption.create({
        source: 'WALLET',
        voucher: null,
        customer: customer._id,
        walletCode: customer.walletCode,
        amountRedeemed: walletCharge,
        previousBalance,
        newBalance: round2(previousBalance - walletCharge),
        cashier: actor?._id ?? null,
        store: store._id,
        posTransactionReference: posRef,
        redemptionReference: generateRedemptionReference('WR'),
        metadata: {
          ...device,
          ...(pointsToUse ? { billTotal: value, pointsUsed: pointsToUse, pointsDiscount } : {}),
        },
        ...(idempotencyKey ? { idempotencyKey } : {}),
      });
    } catch (err) {
      if (err?.code === 11000 && Object.keys(err.keyValue || {}).includes('redemptionReference')) continue;
      await rollback();
      if (err?.code === 11000) throw ApiError.conflict('Duplicate debit — this POS transaction was already recorded');
      throw err;
    }
  }
  if (!redemption) {
    await rollback();
    throw ApiError.conflict('Could not record debit — please try again');
  }

  try {
    const txn = await WalletTransaction.create({
      customer: customer._id,
      type: 'DEBIT',
      amount: walletCharge,
      previousBalance,
      newBalance: round2(previousBalance - walletCharge),
      method: 'CASH',
      target: 'WALLET',
      store: store._id,
      performedBy: actor?._id ?? null,
      idempotencyKey,
      metadata: {
        redemptionReference: redemption.redemptionReference,
        posTransactionReference: posRef,
        ...(pointsToUse ? { billTotal: value, pointsUsed: pointsToUse, pointsDiscount } : {}),
      },
    });

    // Second leg of split tender: consume the points (wallet leg already done).
    // On failure the wallet balance is restored; the orphan redemption row is
    // surfaced by reconciliation (same guarantee as the voucher path).
    let loyalty = null;
    if (pointsToUse > 0) {
      try {
        const { redeemPoints } = await import('./loyalty.service.js');
        const r = await redeemPoints({
          customer: { _id: customer._id, loyaltyPoints: customer.loyaltyPoints },
          points: pointsToUse,
          storeId: store._id,
          actor,
          idempotencyKey: idempotencyKey ? `${idempotencyKey}:loyalty` : undefined,
        });
        r.txn.redemption = redemption._id;
        await r.txn.save().catch(() => {});
        loyalty = { points: r.points, discount: r.discount };
      } catch (err) {
        await rollback();
        throw err;
      }
    }

    // Auto-earn on the cash-paid portion (best-effort: payment stands even if earn fails).
    let earnedPoints = 0;
    try {
      const r = await earnForSpend({
        customerId: customer._id,
        amountMWK: walletCharge,
        storeId: store._id,
        actor,
        redemptionId: redemption._id,
        idempotencyKey: idempotencyKey ? `${idempotencyKey}:earn` : undefined,
      });
      earnedPoints = r.earned || 0;
    } catch (err) {
      console.error('[loyalty] earn failed (payment stands):', err.message);
    }

    return { replayed: false, txn, redemption, newBalance: round2(previousBalance - walletCharge), loyalty, earnedPoints };
  } catch (err) {
    // Ledger write failed after a valid debit: restore the balance. The
    // redemption row without a ledger twin is surfaced by reconciliation.
    await rollback();
    throw err?.code === 11000
      ? ApiError.conflict('Duplicate debit — this transaction was already recorded')
      : err;
  }
}

import Customer from '../models/Customer.js';
import Voucher from '../models/Voucher.js';
import VoucherRedemption from '../models/VoucherRedemption.js';
import WalletTransaction from '../models/WalletTransaction.js';
import Store from '../models/Store.js';
import { ApiError } from '../utils/ApiError.js';
import { generateRedemptionReference, round2 } from '../utils/helpers.js';

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

// Spend from a customer wallet at the till: atomic debit + immutable ledger
// entry + unified redemption record (source WALLET), with the same
// duplicate/idempotency guarantees as voucher redemption.
export async function debitWallet({ walletCode = null, customerId = null, amount, posTransactionReference, storeId, actor = null, idempotencyKey = undefined, device = {} }) {
  const value = round2(amount);
  if (!Number.isFinite(value) || value < 0.01) throw ApiError.badRequest('Amount must be at least 0.01');
  const posRef = String(posTransactionReference || '').trim();
  if (!posRef) throw ApiError.badRequest('POS transaction reference is required');
  if (!storeId) throw ApiError.badRequest('Store is required');
  const store = await Store.findOne({ _id: storeId, isActive: true }).select('name code');
  if (!store) throw ApiError.badRequest('Store not found');

  const customer = walletCode
    ? await Customer.findOne({ walletCode: String(walletCode).trim().toUpperCase() })
    : await Customer.findById(customerId);
  if (!customer) throw ApiError.notFound('Customer wallet not found');
  if (value > customer.walletBalance) {
    throw ApiError.badRequest(`Amount exceeds wallet balance (${customer.walletBalance})`);
  }

  if (idempotencyKey) {
    const priorTxn = await WalletTransaction.findOne({ idempotencyKey });
    if (priorTxn) {
      const priorRed = await VoucherRedemption.findOne({ idempotencyKey });
      return { replayed: true, txn: priorTxn, redemption: priorRed };
    }
  }

  const updated = await Customer.findOneAndUpdate(
    { _id: customer._id, walletBalance: { $gte: value } },
    [{ $set: { walletBalance: { $round: [{ $subtract: ['$walletBalance', value] }, 2] } } }],
    { new: false }
  );
  if (!updated) throw ApiError.conflict('Wallet changed during debit — please re-scan and try again');
  const previousBalance = round2(updated.walletBalance);

  const rollback = () =>
    Customer.findOneAndUpdate({ _id: customer._id }, [
      { $set: { walletBalance: { $round: [{ $add: ['$walletBalance', value] }, 2] } } },
    ]);

  // Redemption record first (reference-collision retry), then the ledger entry.
  let redemption = null;
  for (let attempt = 0; attempt < 5 && !redemption; attempt += 1) {
    try {
      redemption = await VoucherRedemption.create({
        source: 'WALLET',
        voucher: null,
        customer: customer._id,
        walletCode: customer.walletCode,
        amountRedeemed: value,
        previousBalance,
        newBalance: round2(previousBalance - value),
        cashier: actor?._id ?? null,
        store: store._id,
        posTransactionReference: posRef,
        redemptionReference: generateRedemptionReference('WR'),
        metadata: device,
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
      amount: value,
      previousBalance,
      newBalance: round2(previousBalance - value),
      method: 'CASH',
      target: 'WALLET',
      store: store._id,
      performedBy: actor?._id ?? null,
      idempotencyKey,
      metadata: { redemptionReference: redemption.redemptionReference, posTransactionReference: posRef },
    });
    return { replayed: false, txn, redemption, newBalance: round2(previousBalance - value) };
  } catch (err) {
    // Ledger write failed after a valid debit: restore the balance. The
    // redemption row without a ledger twin is surfaced by reconciliation.
    await rollback();
    throw err?.code === 11000
      ? ApiError.conflict('Duplicate debit — this transaction was already recorded')
      : err;
  }
}

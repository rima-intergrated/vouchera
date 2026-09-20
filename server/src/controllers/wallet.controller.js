import mongoose from 'mongoose';
import QRCode from 'qrcode';
import Customer from '../models/Customer.js';
import Voucher from '../models/Voucher.js';
import WalletTransaction from '../models/WalletTransaction.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { audit } from '../utils/helpers.js';
import { creditWallet, reloadGiftCard, debitWallet } from '../services/wallet.service.js';

// POST /api/wallets/topup — credit after verified payment (ADMIN, MANAGER).
export const topUpWallet = asyncHandler(async (req, res) => {
  const { customerId, amount, method, paymentReference, storeId, idempotencyKey } = req.body;
  const { replayed, txn } = await creditWallet({
    customerId,
    amount,
    method,
    paymentReference,
    storeId: storeId || req.user.store?._id || req.user.store || null,
    actor: req.user,
    idempotencyKey,
  });
  await txn.populate([
    { path: 'customer', select: 'name phone walletBalance' },
    { path: 'store', select: 'name code' },
  ]);
  audit({
    actor: req.user,
    action: 'wallet.topup',
    entity: 'WalletTransaction',
    entityId: String(txn._id),
    metadata: { customer: String(txn.customer?._id ?? ''), amount: txn.amount, method: txn.method },
    req,
  });
  res.status(replayed ? 200 : 201).json({
    replayed,
    transaction: serializeTxn(txn),
    walletBalance: txn.newBalance,
  });
});

// GET /api/wallets/transactions?customer= — ledger view. Staff pass any
// customer; CUSTOMER role is forced to their own linked account.
export const listWalletTransactions = asyncHandler(async (req, res) => {
  let customerId = req.query.customer;
  if (req.user.role === 'CUSTOMER') {
    customerId = req.user.customer?._id || req.user.customer || null;
    if (!customerId) throw ApiError.forbidden('No customer account linked to this login');
  }
  if (!customerId) throw ApiError.badRequest('customer is required');
  if (!mongoose.isValidObjectId(customerId)) throw ApiError.badRequest('Invalid customer id');

  const page = Math.max(1, parseInt(req.query.page ?? '1', 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit ?? '20', 10) || 20));
  const [customer, total, items] = await Promise.all([
    Customer.findById(customerId).select('name phone walletBalance walletCode'),
    WalletTransaction.countDocuments({ customer: customerId }),
    WalletTransaction.find({ customer: customerId })
      .populate('store', 'name code')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
  ]);
  if (!customer) throw ApiError.notFound('Customer not found');
  res.json({
    customer: { id: String(customer._id), name: customer.name, phone: customer.phone, walletBalance: customer.walletBalance },
    items: items.map(serializeTxn),
    pagination: { page, limit, total, pages: Math.ceil(total / limit) },
  });
});

// POST /api/vouchers/:id/reload — top up a gift card balance (ADMIN, MANAGER).
export const reloadCard = asyncHandler(async (req, res) => {
  const { replayed, txn } = await reloadGiftCard({
    voucherId: req.params.id,
    amount: req.body.amount,
    method: req.body.method,
    paymentReference: req.body.paymentReference,
    storeId: req.body.storeId || req.user.store?._id || req.user.store || null,
    actor: req.user,
    idempotencyKey: req.body.idempotencyKey,
  });
  await txn.populate([{ path: 'voucher', select: 'code remainingBalance status' }]);
  audit({
    actor: req.user,
    action: 'giftcard.reload',
    entity: 'WalletTransaction',
    entityId: String(txn._id),
    metadata: { code: txn.voucher?.code, amount: txn.amount, method: txn.method },
    req,
  });
  res.status(replayed ? 200 : 201).json({
    replayed,
    transaction: serializeTxn(txn),
    voucher: txn.voucher ? { code: txn.voucher.code, remainingBalance: txn.newBalance, status: 'ACTIVE' } : null,
  });
});

// GET /api/wallets/qr — personal wallet QR (code only). CUSTOMER role is
// forced to their own account; staff may pass ?customer=.
export const walletQr = asyncHandler(async (req, res) => {
  let customerId = req.query.customer;
  if (req.user.role === 'CUSTOMER') {
    customerId = req.user.customer?._id || req.user.customer || null;
    if (!customerId) throw ApiError.forbidden('No customer account linked to this login');
  }
  if (!customerId) throw ApiError.badRequest('customer is required');
  const customer = await Customer.findById(customerId).select('name walletCode walletBalance');
  if (!customer) throw ApiError.notFound('Customer not found');
  if (!customer.walletCode) throw ApiError.badRequest('No wallet code issued for this account');
  const qrCode = await QRCode.toDataURL(customer.walletCode, { errorCorrectionLevel: 'M', width: 256, margin: 1 });
  res.json({ code: customer.walletCode, balance: customer.walletBalance, qrCode });
});

// POST /api/wallets/validate — till scan check (read-only, never moves money).
export const validateWallet = asyncHandler(async (req, res) => {
  const code = String(req.body.code || '').trim().toUpperCase();
  const customer = await Customer.findOne({ walletCode: code }).select('name phone walletBalance walletCode');
  if (!customer) return res.json({ valid: false, code, reason: 'NOT_FOUND', message: 'Wallet not found. Check the code and try again.' });
  if (customer.walletBalance <= 0) {
    return res.json({
      valid: false, code, reason: 'EMPTY',
      message: 'This wallet has zero balance.',
      wallet: { code: customer.walletCode, balance: 0, customer: customer.name },
    });
  }
  res.json({
    valid: true,
    code: customer.walletCode,
    wallet: { code: customer.walletCode, balance: customer.walletBalance, customer: customer.name, phone: customer.phone ?? null },
  });
});

// POST /api/wallets/debit — explicit till purchase from a wallet (cashiers).
export const debitWalletHandler = asyncHandler(async (req, res) => {
  const storeId = req.body.storeId || req.user.store?._id || req.user.store || null;
  const { replayed, txn, redemption, newBalance } = await debitWallet({
    walletCode: req.body.walletCode,
    customerId: req.body.customerId,
    amount: req.body.amount,
    posTransactionReference: req.body.posTransactionReference,
    storeId,
    actor: req.user,
    idempotencyKey: req.body.idempotencyKey,
    device: { ip: req.ip || '', userAgent: req.headers['user-agent'] || '' },
  });
  const customer = await Customer.findById(txn.customer).select('name walletCode');
  audit({
    actor: req.user,
    action: 'wallet.debit',
    entity: 'WalletTransaction',
    entityId: String(txn._id),
    metadata: { code: customer?.walletCode, amount: txn.amount, reference: redemption?.redemptionReference },
    req,
  });
  res.status(replayed ? 200 : 201).json({
    replayed,
    redemption: {
      id: String(redemption?._id ?? ''),
      source: 'WALLET',
      redemptionReference: redemption?.redemptionReference ?? '',
      amountRedeemed: txn.amount,
      posTransactionReference: redemption?.posTransactionReference ?? req.body.posTransactionReference,
      redeemedAt: redemption?.redeemedAt ?? txn.createdAt,
    },
    wallet: {
      code: customer?.walletCode ?? null,
      customer: customer?.name ?? null,
      remainingBalance: newBalance ?? txn.newBalance,
    },
  });
});

// GET /api/wallets/vouchers — vouchers issued to an account (code, value,
// balance, status, expiry + QR). CUSTOMER role is forced to their own
// account; bearer vouchers with no customer link never appear here.
export const myVouchers = asyncHandler(async (req, res) => {
  let customerId = req.query.customer;
  if (req.user.role === 'CUSTOMER') {
    customerId = req.user.customer?._id || req.user.customer || null;
    if (!customerId) throw ApiError.forbidden('No customer account linked to this login');
  }
  if (!customerId) throw ApiError.badRequest('customer is required');
  if (!mongoose.isValidObjectId(customerId)) throw ApiError.badRequest('Invalid customer id');

  // Keep statuses truthful without a background job.
  await Voucher.updateMany(
    { customer: customerId, status: { $in: ['ACTIVE', 'PARTIALLY_REDEEMED'] }, expiryDate: { $lt: new Date() } },
    { $set: { status: 'EXPIRED' } }
  );

  const page = Math.max(1, parseInt(req.query.page ?? '1', 10) || 1);
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit ?? '20', 10) || 20));
  const [total, items] = await Promise.all([
    Voucher.countDocuments({ customer: customerId }),
    Voucher.find({ customer: customerId })
      .populate('campaign', 'name code')
      .sort({ expiryDate: 1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
  ]);
  const rows = await Promise.all(
    items.map(async (v) => ({
      id: String(v._id),
      code: v.code,
      type: v.type,
      originalValue: v.originalValue,
      remainingBalance: v.remainingBalance,
      status: v.status,
      expiryDate: v.expiryDate,
      campaign: v.campaign ? { name: v.campaign.name, code: v.campaign.code } : null,
      qrCode: await QRCode.toDataURL(v.code, { errorCorrectionLevel: 'M', width: 220, margin: 1 }),
    }))
  );
  res.json({ items: rows, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
});

function serializeTxn(t) {
  const o = t.toObject ? t.toObject() : t;
  return {
    id: String(o._id),
    type: o.type,
    amount: o.amount,
    previousBalance: o.previousBalance,
    newBalance: o.newBalance,
    method: o.method,
    paymentReference: o.paymentReference ?? null,
    store: o.store ? { name: o.store.name, code: o.store.code } : null,
    createdAt: o.createdAt,
  };
}

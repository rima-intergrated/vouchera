import mongoose from 'mongoose';
import QRCode from 'qrcode';
import Customer from '../models/Customer.js';
import Voucher from '../models/Voucher.js';
import WalletTransaction from '../models/WalletTransaction.js';
import TopUpRequest from '../models/TopUpRequest.js';
import Setting from '../models/Setting.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { audit } from '../utils/helpers.js';
import { creditWallet, reloadGiftCard, debitWallet } from '../services/wallet.service.js';
import { notifyWalletCredit } from '../services/creditNotify.service.js';
import { saveProof, streamProof, deleteProof } from '../services/proofStorage.service.js';

async function approvalThreshold() {
  const row = await Setting.findOne({ key: 'topup.approvalThresholdMWK' }).select('value').lean();
  const n = Number(row?.value ?? 0);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

// POST /api/wallets/topup — credit after verified payment (ADMIN, MANAGER).
// Multipart form: fields + optional `proof` file (REQUIRED for TRANSFER).
export const topUpWallet = asyncHandler(async (req, res) => {
  const file = req.file ?? null;
  const method = req.body.method;
  if (method === 'TRANSFER' && !file) {
    throw ApiError.badRequest('TRANSFER top-ups require a proof-of-payment attachment (JPG, PNG or PDF)');
  }
  let proof = null;
  let savedFileId = null;
  try {
    // Persist bytes first so the transaction/request always references a
    // stored file; deleted again below if the surrounding write fails.
    if (file) {
      proof = await saveProof({ buffer: file.buffer, originalName: file.originalname, mimetype: file.mimetype });
      savedFileId = proof.fileId;
    }
    const { customerId, amount, paymentReference, storeId, idempotencyKey } = req.body;

    // Maker-checker: large credits captured by non-admin staff wait for
    // ADMIN approval instead of moving money immediately.
    const threshold = await approvalThreshold();
    if (threshold > 0 && Number(amount) >= threshold && req.user.role !== 'ADMIN') {
      const request = await TopUpRequest.create({
        customer: customerId,
        amount: Number(amount),
        method,
        paymentReference: paymentReference?.trim() || undefined,
        ...(proof ? { proof } : {}),
        store: storeId || req.user.store?._id || req.user.store || null,
        requestedBy: req.user._id,
        idempotencyKey: idempotencyKey || undefined,
      });
      await request.populate([
        { path: 'customer', select: 'name phone' },
        { path: 'store', select: 'name code' },
      ]);
      audit({
        actor: req.user,
        action: 'wallet.topup.requested',
        entity: 'TopUpRequest',
        entityId: String(request._id),
        metadata: { customer: String(customerId), amount: Number(amount), method, threshold },
        req,
      });
      return res.status(202).json({ pending: true, request: serializeTopUpRequest(request), threshold });
    }

    const { replayed, txn } = await creditWallet({
      customerId,
      amount,
      method,
      paymentReference,
      proof,
      storeId: storeId || req.user.store?._id || req.user.store || null,
      actor: req.user,
      idempotencyKey,
    });
    // Replay or validation failure must not orphan the uploaded file.
    if (replayed && savedFileId) await deleteProof(savedFileId).catch(() => {});
    await txn.populate([
      { path: 'customer', select: 'name phone walletBalance' },
      { path: 'store', select: 'name code' },
    ]);
    audit({
      actor: req.user,
      action: 'wallet.topup',
      entity: 'WalletTransaction',
      entityId: String(txn._id),
      metadata: { customer: String(txn.customer?._id ?? ''), amount: txn.amount, method: txn.method, hasProof: !!txn.proof?.filename },
      req,
    });
    notifyWalletCredit(txn).catch(() => {});
    res.status(replayed ? 200 : 201).json({
      replayed,
      transaction: serializeTxn(txn),
      walletBalance: txn.newBalance,
    });
  } catch (err) {
    if (savedFileId) await deleteProof(savedFileId).catch(() => {});
    throw err;
  }
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
  const file = req.file ?? null;
  if (req.body.method === 'TRANSFER' && !file) {
    throw ApiError.badRequest('TRANSFER reloads require a proof-of-payment attachment (JPG, PNG or PDF)');
  }
  let reloadProof = null;
  let savedFileId = null;
  try {
    if (file) {
      reloadProof = await saveProof({ buffer: file.buffer, originalName: file.originalname, mimetype: file.mimetype });
      savedFileId = reloadProof.fileId;
    }
    const { replayed, txn } = await reloadGiftCard({
      voucherId: req.params.id,
      amount: req.body.amount,
      method: req.body.method,
      paymentReference: req.body.paymentReference,
      proof: reloadProof,
      storeId: req.body.storeId || req.user.store?._id || req.user.store || null,
      actor: req.user,
      idempotencyKey: req.body.idempotencyKey,
    });
    if (replayed && savedFileId) await deleteProof(savedFileId).catch(() => {});
    await txn.populate([{ path: 'voucher', select: 'code remainingBalance status' }]);
    audit({
      actor: req.user,
      action: 'giftcard.reload',
      entity: 'WalletTransaction',
      entityId: String(txn._id),
      metadata: { code: txn.voucher?.code, amount: txn.amount, method: txn.method, hasProof: !!txn.proof?.filename },
      req,
    });
    notifyWalletCredit(txn).catch(() => {});
    res.status(replayed ? 200 : 201).json({
      replayed,
      transaction: serializeTxn(txn),
      voucher: txn.voucher ? { code: txn.voucher.code, remainingBalance: txn.newBalance, status: 'ACTIVE' } : null,
    });
  } catch (err) {
    if (savedFileId) await deleteProof(savedFileId).catch(() => {});
    throw err;
  }
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
  const customer = await Customer.findOne({ walletCode: code }).select('name phone walletBalance walletCode loyaltyPoints pinHash');
  if (!customer) return res.json({ valid: false, code, reason: 'NOT_FOUND', message: 'Wallet not found. Check the code and try again.' });
  const { getLoyaltyConfig, cashValueForPoints } = await import('../services/loyalty.service.js');
  const cfg = await getLoyaltyConfig();
  const loyalty = {
    points: customer.loyaltyPoints || 0,
    cashValue: cashValueForPoints(customer.loyaltyPoints || 0, cfg.mwkPerPoint),
    minRedeemPoints: cfg.minRedeemPoints,
    mwkPerPoint: cfg.mwkPerPoint,
  };
  if (customer.walletBalance <= 0 && (customer.loyaltyPoints || 0) <= 0) {
    return res.json({
      valid: false, code, reason: 'EMPTY',
      message: 'This wallet has zero balance and no loyalty points.',
      wallet: { code: customer.walletCode, balance: 0, customer: customer.name },
      requiresPin: true, pinSet: !!customer.pinHash, loyalty,
    });
  }
  res.json({
    valid: true,
    code: customer.walletCode,
    wallet: { code: customer.walletCode, balance: customer.walletBalance, customer: customer.name, phone: customer.phone ?? null },
    requiresPin: true,
    pinSet: !!customer.pinHash,
    loyalty,
  });
});

// POST /api/wallets/debit — explicit till purchase from a wallet (cashiers).
// The customer's 4-digit PIN authorises the debit; optional loyaltyPoints
// spends points for a discount in the same authorisation.
export const debitWalletHandler = asyncHandler(async (req, res) => {
  const storeId = req.body.storeId || req.user.store?._id || req.user.store || null;
  const { replayed, txn, redemption, newBalance, loyalty, earnedPoints } = await debitWallet({
    walletCode: req.body.walletCode,
    customerId: req.body.customerId,
    amount: req.body.amount,
    posTransactionReference: req.body.posTransactionReference,
    storeId,
    actor: req.user,
    idempotencyKey: req.body.idempotencyKey,
    device: { ip: req.ip || '', userAgent: req.headers['user-agent'] || '' },
    pin: req.body.pin,
    loyaltyPoints: req.body.loyaltyPoints ?? 0,
  });
  const customer = txn
    ? await Customer.findById(txn.customer).select('name walletCode')
    : await Customer.findById(redemption?.customer).select('name walletCode');
  audit({
    actor: req.user,
    action: 'wallet.debit',
    entity: txn ? 'WalletTransaction' : 'VoucherRedemption',
    entityId: String(txn?._id ?? redemption?._id ?? ''),
    metadata: { code: customer?.walletCode, amount: txn?.amount ?? redemption?.amountRedeemed, reference: redemption?.redemptionReference },
    req,
  });
  if (!txn) {
    // Full-points payment — no wallet leg.
    return res.status(replayed ? 200 : 201).json({
      replayed,
      redemption: {
        id: String(redemption?._id ?? ''),
        source: 'LOYALTY',
        redemptionReference: redemption?.redemptionReference ?? '',
        amountRedeemed: redemption?.amountRedeemed ?? 0,
        posTransactionReference: redemption?.posTransactionReference ?? req.body.posTransactionReference,
        redeemedAt: redemption?.redeemedAt ?? new Date(),
      },
      wallet: {
        code: customer?.walletCode ?? null,
        customer: customer?.name ?? null,
        remainingBalance: newBalance ?? 0,
      },
      loyalty: loyalty ?? null,
    });
  }
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
    ...(loyalty ? { loyalty } : {}),
    ...(earnedPoints ? { earnedPoints } : {}),
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
    hasProof: !!o.proof?.filename,
    store: o.store ? { name: o.store.name, code: o.store.code } : null,
    createdAt: o.createdAt,
  };
}

// GET /api/wallets/transactions/:id/proof — authenticated proof-of-payment
// download. Staff see any txn; CUSTOMER role is forced to their own account.
export const downloadProof = asyncHandler(async (req, res) => {
  const txn = await WalletTransaction.findById(req.params.id).select('customer proof');
  if (!txn || !txn.proof?.filename) throw ApiError.notFound('Proof of payment not found');
  if (req.user.role === 'CUSTOMER') {
    const own = String(req.user.customer?._id || req.user.customer || '');
    if (String(txn.customer) !== own) throw ApiError.forbidden('Insufficient permissions');
  }
  audit({ actor: req.user, action: 'wallet.proof.view', entity: 'WalletTransaction', entityId: String(txn._id), req });
  if (!txn.proof?.fileId) throw ApiError.notFound('Proof of payment not found');
  if (!(await streamProof(txn.proof.fileId, txn.proof.mimetype, res))) {
    throw ApiError.notFound('Proof file is missing from storage');
  }
});

// --- Top-up approvals (maker-checker, ADMIN only) ---

function serializeTopUpRequest(r) {
  const o = r.toObject ? r.toObject() : r;
  return {
    id: String(o._id),
    customer: o.customer ? { id: String(o.customer._id), name: o.customer.name, phone: o.customer.phone ?? null } : null,
    amount: o.amount,
    method: o.method,
    paymentReference: o.paymentReference ?? null,
    hasProof: !!o.proof?.filename,
    store: o.store ? { name: o.store.name, code: o.store.code } : null,
    requestedBy: o.requestedBy ? { name: o.requestedBy.name, email: o.requestedBy.email } : null,
    status: o.status,
    reviewNote: o.reviewNote || '',
    createdAt: o.createdAt,
    reviewedAt: o.reviewedAt ?? null,
  };
}

// GET /api/wallets/approvals?status=PENDING
export const listTopUpApprovals = asyncHandler(async (req, res) => {
  const status = req.query.status || 'PENDING';
  if (!['PENDING', 'APPROVED', 'REJECTED'].includes(status)) throw ApiError.badRequest('Invalid status');
  const page = Math.max(1, parseInt(req.query.page ?? '1', 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit ?? '20', 10) || 20));
  const [total, items, threshold] = await Promise.all([
    TopUpRequest.countDocuments({ status }),
    TopUpRequest.find({ status })
      .populate('customer', 'name phone')
      .populate('store', 'name code')
      .populate('requestedBy', 'name email')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    approvalThreshold(),
  ]);
  res.json({
    items: items.map(serializeTopUpRequest),
    pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    threshold,
  });
});

// POST /api/wallets/approvals/:id/approve — replays the captured details
// through creditWallet (atomic + idempotent), then notifies the customer.
export const approveTopUpRequest = asyncHandler(async (req, res) => {
  const request = await TopUpRequest.findById(req.params.id);
  if (!request) throw ApiError.notFound('Top-up request not found');
  if (request.status !== 'PENDING') throw ApiError.conflict(`Request already ${request.status.toLowerCase()}`);
  const { txn } = await creditWallet({
    customerId: request.customer,
    amount: request.amount,
    method: request.method,
    paymentReference: request.paymentReference,
    proof: request.proof?.filename ? { ...request.proof } : null,
    storeId: request.store,
    actor: req.user,
    idempotencyKey: request.idempotencyKey || undefined,
  });
  request.status = 'APPROVED';
  request.reviewedBy = req.user._id;
  request.reviewedAt = new Date();
  request.resultingTxn = txn._id;
  await request.save();
  await request.populate([
    { path: 'customer', select: 'name phone' },
    { path: 'store', select: 'name code' },
  ]);
  audit({
    actor: req.user,
    action: 'wallet.topup.approved',
    entity: 'TopUpRequest',
    entityId: String(request._id),
    metadata: { amount: request.amount, transaction: String(txn._id) },
    req,
  });
  notifyWalletCredit(txn).catch(() => {});
  res.json({ request: serializeTopUpRequest(request), transaction: serializeTxn(txn), walletBalance: txn.newBalance });
});

// POST /api/wallets/approvals/:id/reject { note } — no money ever moved;
// the proof file is deleted with the request's rejection.
export const rejectTopUpRequest = asyncHandler(async (req, res) => {
  const request = await TopUpRequest.findById(req.params.id);
  if (!request) throw ApiError.notFound('Top-up request not found');
  if (request.status !== 'PENDING') throw ApiError.conflict(`Request already ${request.status.toLowerCase()}`);
  request.status = 'REJECTED';
  request.reviewedBy = req.user._id;
  request.reviewedAt = new Date();
  request.reviewNote = String(req.body.note || '').slice(0, 500);
  await request.save();
  if (request.proof?.fileId) await deleteProof(request.proof.fileId).catch(() => {});
  audit({
    actor: req.user,
    action: 'wallet.topup.rejected',
    entity: 'TopUpRequest',
    entityId: String(request._id),
    metadata: { amount: request.amount, note: request.reviewNote },
    req,
  });
  res.json({ request: serializeTopUpRequest(request) });
});

// GET /api/wallets/approvals/:id/proof — view the captured proof (ADMIN).
export const approvalProof = asyncHandler(async (req, res) => {
  const request = await TopUpRequest.findById(req.params.id).select('proof');
  if (!request || !request.proof?.filename) throw ApiError.notFound('Proof of payment not found');
  audit({ actor: req.user, action: 'wallet.topup.proof.view', entity: 'TopUpRequest', entityId: String(request._id), req });
  if (!request.proof?.fileId) throw ApiError.notFound('Proof of payment not found');
  if (!(await streamProof(request.proof.fileId, request.proof.mimetype, res))) {
    throw ApiError.notFound('Proof file is missing from storage');
  }
});

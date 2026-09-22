import crypto from 'node:crypto';
import Voucher from '../models/Voucher.js';
import Customer from '../models/Customer.js';
import OnlineAuthorization from '../models/OnlineAuthorization.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { audit, round2 } from '../utils/helpers.js';
import { verifyCustomerPin } from '../services/pin.service.js';

// Public online-checkout endpoints for the Shopwise website.
// No auth token: the shopper proves ownership with the holder's 4-digit
// till PIN, verified here against the account (with lockout). Read-only
// except for the authorization record itself — money NEVER moves here;
// capture stays a staff till action (redeem/debit flows).
//
// Website rule (enforced): only customer-linked tenders work online —
// linked vouchers, gift cards with a holder, and wallets. Bearer/paper
// (unlinked) codes are rejected with UNLINKED.

const REDEEMABLE = ['ACTIVE', 'PARTIALLY_REDEEMED'];
const AUTH_TTL_MS = 15 * 60 * 1000;

const REASONS = {
  NOT_FOUND: 'Code not found. Check it and try again.',
  DRAFT: 'This voucher has not been issued yet.',
  EXPIRED: 'This voucher has expired.',
  CANCELLED: 'This voucher has been cancelled.',
  SUSPENDED: 'This voucher is suspended. Ask a manager for help.',
  FULLY_REDEEMED: 'This voucher has been fully redeemed (zero balance).',
  EMPTY_WALLET: 'This wallet has zero balance.',
};

function unlinkedError() {
  // 422 (not 401/403): the shopper's session is irrelevant — the tender
  // itself is not eligible for online use.
  const err = new ApiError(422, 'This code is not linked to any customer account, so it cannot be used for online checkout. Linked gift cards, vouchers and wallets only — or pay with it at any till.');
  err.code = 'UNLINKED';
  return err;
}

// Resolve a code to either a voucher/gift card or a wallet (both read-only).
// Returns { kind, voucher?, customer, holderName, balance } or null.
async function resolveTender(code) {
  const normalized = String(code || '').trim().toUpperCase();
  if (!normalized) return null;

  const voucher = await Voucher.findOne({ code: normalized }).populate('customer', 'name phone pinHash loyaltyPoints');
  if (voucher) {
    if (REDEEMABLE.includes(voucher.status) && voucher.expiryDate < new Date()) {
      voucher.status = 'EXPIRED';
      await voucher.save();
    }
    return {
      kind: voucher.type === 'GIFT_CARD' ? 'GIFT_CARD' : 'VOUCHER',
      voucher,
      customer: voucher.customer || null,
      holderName: voucher.customer?.name || '',
      balance: voucher.remainingBalance ?? 0,
    };
  }

  const customer = await Customer.findOne({ walletCode: normalized }).select('name phone walletBalance walletCode loyaltyPoints pinHash');
  if (customer) {
    return {
      kind: 'WALLET',
      voucher: null,
      customer,
      holderName: customer.name || '',
      balance: customer.walletBalance ?? 0,
    };
  }
  return null;
}

function serializeTender(t) {
  return {
    kind: t.kind,
    linked: !!t.customer,
    holderName: t.holderName,
    // Wallets always require PIN; vouchers only when customer-linked.
    requiresPin: t.kind === 'WALLET' ? true : !!t.customer,
  };
}

// POST /api/online/validate — public till-style check for website checkout.
// Body: { code, amount? }. Never moves money, never touches PIN counters.
export const validateOnlineTender = asyncHandler(async (req, res) => {
  const t = await resolveTender(req.body.code);
  if (!t) {
    return res.json({ valid: false, code: String(req.body.code || '').trim().toUpperCase(), reason: 'NOT_FOUND', message: REASONS.NOT_FOUND });
  }
  if (t.kind !== 'WALLET') {
    if (!REDEEMABLE.includes(t.voucher.status)) {
      const reason = t.voucher.status in REASONS ? t.voucher.status : 'NOT_FOUND';
      return res.json({ valid: false, code: t.voucher.code, reason, message: REASONS[reason] ?? REASONS.NOT_FOUND, ...serializeTender(t), balance: t.balance });
    }
  } else if (t.balance <= 0) {
    return res.json({ valid: false, code: t.customer.walletCode, reason: 'EMPTY_WALLET', message: REASONS.EMPTY_WALLET, ...serializeTender(t), balance: 0, pinSet: !!t.customer.pinHash });
  }

  const amount = req.body.amount !== undefined ? round2(req.body.amount) : null;
  if (amount !== null && Number.isFinite(amount) && amount > t.balance) {
    return res.json({
      valid: false, code: t.kind === 'WALLET' ? t.customer.walletCode : t.voucher.code,
      reason: 'INSUFFICIENT', message: `Amount exceeds available balance (${t.balance}).`,
      ...serializeTender(t), balance: t.balance,
    });
  }

  const holder = t.customer?._id ? await Customer.findById(t.customer._id).select('pinHash') : t.customer;
  res.json({
    valid: true,
    code: t.kind === 'WALLET' ? t.customer.walletCode : t.voucher.code,
    ...serializeTender(t),
    balance: t.balance,
    pinSet: !!holder?.pinHash,
  });
});

function newAuthCode() {
  return `AUTH-${crypto.randomInt(100000, 1000000)}`;
}

// POST /api/online/authorize — public. Body: { code, amount, pin, orderRef, storeLabel? }.
// Verifies the holder's 4-digit PIN (with lockout), enforces customer
// linkage, checks balance, then records a single-use 15-minute
// authorization. Idempotent per orderRef: retries replay the original.
export const authorizeOnlinePayment = asyncHandler(async (req, res) => {
  const code = String(req.body.code || '').trim().toUpperCase();
  const amount = round2(req.body.amount);
  const pin = String(req.body.pin ?? '');
  const orderRef = String(req.body.orderRef || '').trim().slice(0, 120);
  const storeLabel = String(req.body.storeLabel || '').trim().slice(0, 160);

  if (!Number.isFinite(amount) || amount <= 0) throw ApiError.badRequest('Amount must be greater than 0');
  if (!orderRef) throw ApiError.badRequest('Order reference is required');

  // Safe retry: same order reference replays instead of duplicating.
  const replay = await OnlineAuthorization.findOne({ orderRef });
  if (replay) {
    if (replay.code !== code || Number(replay.amount) !== amount) {
      throw ApiError.conflict('This order reference was already used for a different payment');
    }
    if (replay.status !== 'AUTHORIZED' || replay.expiresAt < new Date()) {
      throw ApiError.conflict('This authorization has expired — please start checkout again');
    }
    return res.json({
      replayed: true,
      authorizationId: String(replay._id),
      authorizationCode: replay.authorizationCode,
      kind: replay.kind,
      holderName: replay.holderName,
      amount: replay.amount,
      expiresAt: replay.expiresAt,
    });
  }

  const t = await resolveTender(code);
  if (!t) throw ApiError.notFound('Code not found. Check it and try again.');
  if (t.kind !== 'WALLET' && !REDEEMABLE.includes(t.voucher.status)) {
    throw ApiError.conflict(REASONS[t.voucher.status] ?? 'Voucher cannot be used');
  }
  // WEBSITE RULE: unlinked (bearer) codes never work online.
  if (!t.customer) throw unlinkedError();

  const customer = await Customer.findById(t.customer._id || t.customer).select('+pinHash');
  if (!customer) throw ApiError.notFound('Linked customer account not found');
  // Real PIN verification against the account (enforces 5-attempt lockout).
  await verifyCustomerPin(customer, pin);

  if (amount > t.balance) {
    throw ApiError.badRequest(`Amount exceeds available balance (${t.balance})`);
  }

  let record = null;
  let authorizationCode = null;
  for (let attempt = 0; attempt < 5 && !record; attempt += 1) {
    authorizationCode = newAuthCode();
    try {
      record = await OnlineAuthorization.create({
        code: t.kind === 'WALLET' ? customer.walletCode : t.voucher.code,
        kind: t.kind,
        customer: customer._id,
        holderName: customer.name || t.holderName,
        amount,
        orderRef,
        storeLabel,
        authorizationCode,
        expiresAt: new Date(Date.now() + AUTH_TTL_MS),
      });
    } catch (err) {
      if (err?.code === 11000) continue; // auth-code collision or raced orderRef — retry / fall through
      throw err;
    }
  }
  if (!record) throw ApiError.conflict('Could not record authorization — please try again');

  audit({
    actor: { role: 'ONLINE_CUSTOMER' },
    action: 'online.authorize',
    entity: 'OnlineAuthorization',
    entityId: String(record._id),
    metadata: { code: record.code, kind: record.kind, amount, orderRef, storeLabel },
    req,
  });

  res.status(201).json({
    authorizationId: String(record._id),
    authorizationCode: record.authorizationCode,
    kind: record.kind,
    holderName: record.holderName,
    amount: record.amount,
    balance: t.balance,
    expiresAt: record.expiresAt,
  });
});

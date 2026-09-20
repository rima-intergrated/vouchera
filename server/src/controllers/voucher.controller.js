import QRCode from 'qrcode';
import Voucher from '../models/Voucher.js';
import Store from '../models/Store.js';
import Customer from '../models/Customer.js';
import Campaign from '../models/Campaign.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { audit, escapeRegExp, generateVoucherCode, round2 } from '../utils/helpers.js';

const TERMINAL = ['FULLY_REDEEMED', 'EXPIRED', 'CANCELLED'];

// Lazily expire vouchers past their date so list/detail/filter counts stay true
// without a background job.
async function refreshExpiredStatuses() {
  await Voucher.updateMany(
    { status: { $in: ['ACTIVE', 'PARTIALLY_REDEEMED'] }, expiryDate: { $lt: new Date() } },
    { $set: { status: 'EXPIRED' } }
  );
}

const POPULATE = [
  { path: 'customer', select: 'name phone email' },
  { path: 'campaign', select: 'name code' },
  { path: 'validStores', select: 'name code' },
  { path: 'createdBy', select: 'name email' },
];

function serialize(v) {
  const o = v.toObject ? v.toObject() : v;
  return { ...o, id: String(o._id) };
}

// QR payload is the voucher code ONLY — never value or customer data.
async function qrFor(code) {
  return QRCode.toDataURL(code, { errorCorrectionLevel: 'M', width: 256, margin: 1 });
}

async function assertRefs({ customer, campaign, validStores }) {
  if (customer) {
    const c = await Customer.findById(customer);
    if (!c) throw ApiError.badRequest('Customer not found');
  }
  if (campaign) {
    const c = await Campaign.findById(campaign);
    if (!c) throw ApiError.badRequest('Campaign not found');
  }
  if (validStores?.length) {
    const count = await Store.countDocuments({ _id: { $in: validStores }, isActive: true });
    if (count !== validStores.length) throw ApiError.badRequest('One or more stores are invalid');
  }
}

export const listVouchers = asyncHandler(async (req, res) => {
  await refreshExpiredStatuses();
  const filter = {};
  if (req.query.q) filter.code = { $regex: `^${escapeRegExp(req.query.q.trim().toUpperCase())}`, $options: 'i' };
  if (req.query.status) filter.status = req.query.status;
  if (req.query.store) filter.validStores = req.query.store;
  if (req.query.campaign) filter.campaign = req.query.campaign;
  if (req.query.from || req.query.to) {
    filter.createdAt = {};
    if (req.query.from) filter.createdAt.$gte = new Date(`${req.query.from}T00:00:00.000Z`);
    if (req.query.to) filter.createdAt.$lte = new Date(`${req.query.to}T23:59:59.999Z`);
  }
  const page = Math.max(1, parseInt(req.query.page ?? '1', 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit ?? '20', 10) || 20));

  const [total, items] = await Promise.all([
    Voucher.countDocuments(filter),
    Voucher.find(filter).populate(POPULATE).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit),
  ]);
  res.json({
    items: items.map(serialize),
    pagination: { page, limit, total, pages: Math.ceil(total / limit) },
  });
});

export const createVoucher = asyncHandler(async (req, res) => {
  const {
    type = 'FIXED_VALUE',
    issueDate = new Date(),
    expiryDate,
    customer = null,
    campaign = null,
    validStores = [],
    restrictions = {},
    status = 'ACTIVE',
  } = req.body;

  // MWK to 2dp at the boundary — floating-point artifacts never reach the DB.
  const originalValue = round2(req.body.originalValue);
  if (!Number.isFinite(originalValue) || originalValue < 1) {
    throw ApiError.badRequest('Voucher value must be at least 1');
  }

  if (new Date(expiryDate) <= new Date(issueDate)) {
    throw ApiError.badRequest('Expiry date must be after the issue date');
  }
  await assertRefs({ customer, campaign, validStores });

  // Retry on the (astronomically unlikely) random code collision
  let voucher = null;
  for (let attempt = 0; attempt < 5 && !voucher; attempt += 1) {
    try {
      voucher = await Voucher.create({
        code: generateVoucherCode(),
        type,
        originalValue,
        remainingBalance: originalValue,
        status,
        issueDate,
        expiryDate,
        customer,
        campaign,
        validStores,
        restrictions: { minPurchase: 0, notes: '', ...restrictions },
        createdBy: req.user._id,
      });
    } catch (err) {
      if (err?.code !== 11000 || attempt === 4) throw err;
    }
  }
  await voucher.populate(POPULATE);
  audit({ actor: req.user, action: 'voucher.create', entity: 'Voucher', entityId: String(voucher._id), metadata: { code: voucher.code, originalValue }, req });
  res.status(201).json({ voucher: serialize(voucher), qrCode: await qrFor(voucher.code) });
});

export const getVoucher = asyncHandler(async (req, res) => {
  await refreshExpiredStatuses();
  const voucher = await Voucher.findById(req.params.id).populate(POPULATE);
  if (!voucher) throw ApiError.notFound('Voucher not found');
  res.json({ voucher: serialize(voucher), qrCode: await qrFor(voucher.code) });
});

export const getVoucherQr = asyncHandler(async (req, res) => {
  const voucher = await Voucher.findById(req.params.id).select('code');
  if (!voucher) throw ApiError.notFound('Voucher not found');
  res.json({ code: voucher.code, qrCode: await qrFor(voucher.code) });
});

// Limited edit: DRAFT vouchers only (plus DRAFT -> ACTIVE activation).
export const updateVoucher = asyncHandler(async (req, res) => {
  const voucher = await Voucher.findById(req.params.id);
  if (!voucher) throw ApiError.notFound('Voucher not found');
  if (voucher.status !== 'DRAFT') throw ApiError.badRequest('Only DRAFT vouchers can be edited');

  const { expiryDate, customer, campaign, validStores, restrictions, status } = req.body;
  await assertRefs({
    customer: customer ?? undefined,
    campaign: campaign ?? undefined,
    validStores: validStores ?? undefined,
  });
  if (expiryDate !== undefined) {
    if (new Date(expiryDate) <= new Date()) throw ApiError.badRequest('Expiry date must be in the future');
    voucher.expiryDate = expiryDate;
  }
  if (customer !== undefined) voucher.customer = customer;
  if (campaign !== undefined) voucher.campaign = campaign;
  if (validStores !== undefined) voucher.validStores = validStores;
  if (restrictions?.notes !== undefined) voucher.restrictions.notes = restrictions.notes;
  if (status === 'ACTIVE') voucher.status = 'ACTIVE';
  await voucher.save();
  await voucher.populate(POPULATE);
  const activated = status === 'ACTIVE';
  audit({ actor: req.user, action: activated ? 'voucher.activate' : 'voucher.update', entity: 'Voucher', entityId: String(voucher._id), req });
  res.json({ voucher: serialize(voucher) });
});

export const cancelVoucher = asyncHandler(async (req, res) => {
  const voucher = await Voucher.findById(req.params.id);
  if (!voucher) throw ApiError.notFound('Voucher not found');
  if (TERMINAL.includes(voucher.status)) {
    throw ApiError.conflict(`Cannot cancel a ${voucher.status} voucher`);
  }
  voucher.status = 'CANCELLED';
  await voucher.save();
  audit({ actor: req.user, action: 'voucher.cancel', entity: 'Voucher', entityId: String(voucher._id), metadata: { code: voucher.code }, req });
  res.json({ voucher: serialize(voucher) });
});

export const suspendVoucher = asyncHandler(async (req, res) => {
  const voucher = await Voucher.findById(req.params.id);
  if (!voucher) throw ApiError.notFound('Voucher not found');
  if (!['ACTIVE', 'PARTIALLY_REDEEMED'].includes(voucher.status)) {
    throw ApiError.conflict(`Cannot suspend a ${voucher.status} voucher`);
  }
  voucher.status = 'SUSPENDED';
  await voucher.save();
  audit({ actor: req.user, action: 'voucher.suspend', entity: 'Voucher', entityId: String(voucher._id), metadata: { code: voucher.code }, req });
  res.json({ voucher: serialize(voucher) });
});

export const reactivateVoucher = asyncHandler(async (req, res) => {
  const voucher = await Voucher.findById(req.params.id);
  if (!voucher) throw ApiError.notFound('Voucher not found');
  if (voucher.status !== 'SUSPENDED') {
    throw ApiError.conflict(`Only SUSPENDED vouchers can be reactivated (current: ${voucher.status})`);
  }
  if (voucher.expiryDate < new Date()) throw ApiError.conflict('Cannot reactivate an expired voucher');
  if (voucher.remainingBalance <= 0) throw ApiError.conflict('Cannot reactivate a fully redeemed voucher');
  voucher.status = voucher.totalRedeemed > 0 ? 'PARTIALLY_REDEEMED' : 'ACTIVE';
  await voucher.save();
  audit({ actor: req.user, action: 'voucher.reactivate', entity: 'Voucher', entityId: String(voucher._id), metadata: { code: voucher.code }, req });
  res.json({ voucher: serialize(voucher) });
});

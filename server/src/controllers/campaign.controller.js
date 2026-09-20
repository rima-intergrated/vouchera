import Campaign from '../models/Campaign.js';
import Voucher from '../models/Voucher.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { audit, round2 } from '../utils/helpers.js';
import {
  transition,
  assertEditable,
  assertEligibleStores,
  generateVouchers,
  campaignStats,
} from '../services/campaign.service.js';

const POPULATE = [
  { path: 'eligibleStores', select: 'name code' },
  { path: 'createdBy', select: 'name email' },
];

export const listCampaigns = asyncHandler(async (req, res) => {
  const filter = {};
  if (req.query.active === 'true') filter.isActive = true;
  if (req.query.status) filter.status = req.query.status;
  const campaigns = await Campaign.find(filter).populate('eligibleStores', 'name code').sort({ createdAt: -1 }).limit(200);
  res.json({ campaigns });
});

export const createCampaign = asyncHandler(async (req, res) => {
  const {
    name,
    code,
    description = '',
    startsAt = null,
    endsAt = null,
    voucherType = 'FIXED_VALUE',
    voucherValue = 0,
    voucherQuantity = 0,
    eligibleStores = [],
    terms = '',
  } = req.body;

  const upper = String(code).toUpperCase().trim();
  const exists = await Campaign.findOne({ $or: [{ code: upper }, { name }] });
  if (exists) throw ApiError.conflict('Campaign name or code already exists');
  if (startsAt && endsAt && new Date(startsAt) > new Date(endsAt)) {
    throw ApiError.badRequest('Start date must not be after end date');
  }
  await assertEligibleStores(eligibleStores);

  const campaign = await Campaign.create({
    name: name.trim(),
    code: upper,
    description,
    startsAt,
    endsAt,
    voucherType,
    voucherValue: round2(voucherValue),
    voucherQuantity,
    eligibleStores,
    terms,
    status: 'DRAFT',
    isActive: false,
    createdBy: req.user._id,
  });
  audit({ actor: req.user, action: 'campaign.create', entity: 'Campaign', entityId: String(campaign._id), metadata: { code: upper }, req });
  res.status(201).json({ campaign });
});

export const getCampaign = asyncHandler(async (req, res) => {
  const campaign = await Campaign.findById(req.params.id).populate(POPULATE);
  if (!campaign) throw ApiError.notFound('Campaign not found');
  res.json({ campaign, stats: await campaignStats(campaign._id) });
});

export const updateCampaign = asyncHandler(async (req, res) => {
  const campaign = await Campaign.findById(req.params.id);
  if (!campaign) throw ApiError.notFound('Campaign not found');

  const fields = Object.keys(req.body).filter((k) => req.body[k] !== undefined);
  assertEditable(campaign, fields);

  const { name, description, startsAt, endsAt, voucherType, voucherValue, voucherQuantity, eligibleStores, terms } = req.body;
  if (name !== undefined) campaign.name = name;
  if (description !== undefined) campaign.description = description;
  if (startsAt !== undefined) campaign.startsAt = startsAt;
  if (endsAt !== undefined) campaign.endsAt = endsAt;
  if (voucherType !== undefined) campaign.voucherType = voucherType;
  if (voucherValue !== undefined) campaign.voucherValue = round2(voucherValue);
  if (voucherQuantity !== undefined) {
    if (voucherQuantity < campaign.generatedCount) {
      throw ApiError.badRequest(`Quantity cannot drop below already-generated ${campaign.generatedCount}`);
    }
    campaign.voucherQuantity = voucherQuantity;
  }
  if (eligibleStores !== undefined) {
    await assertEligibleStores(eligibleStores);
    campaign.eligibleStores = eligibleStores;
  }
  if (terms !== undefined) campaign.terms = terms;
  if (campaign.startsAt && campaign.endsAt && campaign.startsAt > campaign.endsAt) {
    throw ApiError.badRequest('Start date must not be after end date');
  }

  await campaign.save();
  await campaign.populate(POPULATE);
  audit({ actor: req.user, action: 'campaign.update', entity: 'Campaign', entityId: String(campaign._id), req });
  res.json({ campaign });
});

async function changeStatus(req, res, to, action) {
  const campaign = await Campaign.findById(req.params.id);
  if (!campaign) throw ApiError.notFound('Campaign not found');
  transition(campaign, to);
  await campaign.save();
  audit({ actor: req.user, action, entity: 'Campaign', entityId: String(campaign._id), metadata: { to }, req });
  res.json({ campaign });
}

export const activateCampaign = asyncHandler((req, res) => changeStatus(req, res, 'ACTIVE', 'campaign.activate'));
export const pauseCampaign = asyncHandler((req, res) => changeStatus(req, res, 'PAUSED', 'campaign.pause'));
export const endCampaign = asyncHandler((req, res) => changeStatus(req, res, 'ENDED', 'campaign.end'));

export const generateCampaignVouchers = asyncHandler(async (req, res) => {
  const campaign = await Campaign.findById(req.params.id);
  if (!campaign) throw ApiError.notFound('Campaign not found');
  const created = await generateVouchers(campaign, { expiryDate: req.body.expiryDate ?? null, createdBy: req.user._id });
  audit({
    actor: req.user,
    action: 'campaign.generate',
    entity: 'Campaign',
    entityId: String(campaign._id),
    metadata: { generated: created.length, total: campaign.generatedCount },
    req,
  });
  res.status(201).json({
    generated: created.length,
    totalGenerated: campaign.generatedCount,
    quantity: campaign.voucherQuantity,
    vouchers: created.map((v) => ({ id: String(v._id), code: v.code, originalValue: v.originalValue })),
  });
});

export const campaignVouchers = asyncHandler(async (req, res) => {
  const campaign = await Campaign.findById(req.params.id).select('_id');
  if (!campaign) throw ApiError.notFound('Campaign not found');
  const filter = { campaign: campaign._id };
  if (req.query.status) filter.status = req.query.status;
  const page = Math.max(1, parseInt(req.query.page ?? '1', 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit ?? '20', 10) || 20));
  const [total, items] = await Promise.all([
    Voucher.countDocuments(filter),
    Voucher.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
  ]);
  res.json({
    items: items.map((v) => ({
      id: String(v._id),
      code: v.code,
      originalValue: v.originalValue,
      remainingBalance: v.remainingBalance,
      status: v.status,
      expiryDate: v.expiryDate,
    })),
    pagination: { page, limit, total, pages: Math.ceil(total / limit) },
  });
});

export const getCampaignStats = asyncHandler(async (req, res) => {
  const campaign = await Campaign.findById(req.params.id).select('_id code name');
  if (!campaign) throw ApiError.notFound('Campaign not found');
  res.json({ campaign: { id: String(campaign._id), code: campaign.code, name: campaign.name }, stats: await campaignStats(campaign._id) });
});

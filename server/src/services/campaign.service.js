import Campaign from '../models/Campaign.js';
import Voucher from '../models/Voucher.js';
import VoucherRedemption from '../models/VoucherRedemption.js';
import Store from '../models/Store.js';
import { ApiError } from '../utils/ApiError.js';
import { generateVoucherCode, round2 } from '../utils/helpers.js';

// ---------------------------------------------------------------------------
// Campaign domain logic — deliberately separate from core voucher logic.
// Controllers handle HTTP only; everything here is framework-free apart
// from Mongoose models.
// ---------------------------------------------------------------------------

const TERMINAL = ['ENDED'];
const MAX_GENERATE_PER_CALL = 1000;

export function syncActiveFlag(campaign) {
  campaign.isActive = campaign.status === 'ACTIVE';
}

export function transition(campaign, to) {
  const from = campaign.status;
  const allowed = {
    DRAFT: ['ACTIVE'],
    ACTIVE: ['PAUSED', 'ENDED'],
    PAUSED: ['ACTIVE', 'ENDED'],
    ENDED: [],
  };
  if (!allowed[from].includes(to)) {
    throw ApiError.conflict(`Cannot move campaign from ${from} to ${to}`);
  }
  if (to === 'ACTIVE') {
    if (campaign.startsAt && campaign.endsAt && campaign.startsAt > campaign.endsAt) {
      throw ApiError.badRequest('Campaign start date must not be after its end date');
    }
    if (campaign.endsAt && campaign.endsAt < new Date()) {
      throw ApiError.badRequest('Campaign end date is in the past');
    }
  }
  campaign.status = to;
  syncActiveFlag(campaign);
  return campaign;
}

// Which top-level fields may change in the current status.
export function assertEditable(campaign, fields) {
  if (TERMINAL.includes(campaign.status)) {
    throw ApiError.badRequest('ENDED campaigns cannot be edited');
  }
  const lockedAfterGenerate = ['voucherType', 'voucherValue', 'voucherQuantity'];
  if (campaign.generatedCount > 0 && fields.some((f) => lockedAfterGenerate.includes(f))) {
    throw ApiError.badRequest('Voucher blueprint is locked once vouchers have been generated');
  }
  if (campaign.status !== 'DRAFT') {
    const mutable = ['name', 'description', 'startsAt', 'endsAt', 'eligibleStores', 'terms'];
    const illegal = fields.filter((f) => !mutable.includes(f));
    if (illegal.length) {
      throw ApiError.badRequest(`Only ${mutable.join(', ')} can change on a ${campaign.status} campaign`);
    }
  }
}

export async function assertEligibleStores(ids) {
  if (!ids?.length) return;
  const count = await Store.countDocuments({ _id: { $in: ids }, isActive: true });
  if (count !== ids.length) throw ApiError.badRequest('One or more eligible stores are invalid');
}

// Bulk-generate the campaign's vouchers (ACTIVE campaigns only).
export async function generateVouchers(campaign, { expiryDate = null, createdBy = null } = {}) {
  if (campaign.status !== 'ACTIVE') {
    throw ApiError.badRequest('Vouchers can only be generated for an ACTIVE campaign');
  }
  const remaining = campaign.voucherQuantity - campaign.generatedCount;
  if (remaining <= 0) throw ApiError.conflict('Campaign quantity already fully generated');
  if (campaign.voucherValue <= 0) throw ApiError.badRequest('Campaign voucher value must be set before generation');

  const expiry = expiryDate ? new Date(expiryDate) : campaign.endsAt;
  if (!expiry || Number.isNaN(expiry.getTime())) throw ApiError.badRequest('An expiry date is required (campaign has no end date)');
  if (expiry <= new Date()) throw ApiError.badRequest('Voucher expiry must be in the future');

  const batch = Math.min(remaining, MAX_GENERATE_PER_CALL);
  const value = round2(campaign.voucherValue);
  const codes = new Set();
  while (codes.size < batch) codes.add(generateVoucherCode());

  const template = {
    type: campaign.voucherType,
    originalValue: value,
    remainingBalance: value,
    status: 'ACTIVE',
    issueDate: new Date(),
    expiryDate: expiry,
    campaign: campaign._id,
    validStores: campaign.eligibleStores ?? [],
    restrictions: { minPurchase: 0, notes: '' },
    createdBy,
  };
  const docs = [...codes].map((code) => ({ ...template, code }));

  let created = [];
  try {
    created = await Voucher.insertMany(docs, { ordered: false });
  } catch (err) {
    const writeErrors = err?.writeErrors || [];
    if (err?.code !== 11000 && !writeErrors.length) throw err;
    // ordered:false keeps the non-colliding docs; top up any shortfall once.
    created = await Voucher.find({ code: { $in: [...codes] } });
    const shortfall = batch - created.length;
    if (shortfall > 0) {
      const extra = new Set();
      while (extra.size < shortfall) extra.add(generateVoucherCode());
      const more = await Voucher.insertMany(
        [...extra].map((code) => ({ ...template, code })),
        { ordered: true }
      );
      created = [...created, ...more];
    }
  }

  campaign.generatedCount += created.length;
  await campaign.save();
  return created;
}

export async function campaignStats(campaignId) {
  const [issued, redeemed] = await Promise.all([
    Voucher.aggregate([
      { $match: { campaign: campaignId, status: { $ne: 'DRAFT' } } },
      {
        $group: {
          _id: null,
          issued: { $sum: 1 },
          issuedValue: { $sum: '$originalValue' },
          outstanding: {
            $sum: { $cond: [{ $in: ['$status', ['ACTIVE', 'PARTIALLY_REDEEMED']] }, '$remainingBalance', 0] },
          },
        },
      },
    ]),
    VoucherRedemption.aggregate([
      {
        $lookup: { from: 'vouchers', localField: 'voucher', foreignField: '_id', as: '_v' },
      },
      { $unwind: '$_v' },
      { $match: { '_v.campaign': campaignId } },
      { $group: { _id: null, redemptions: { $sum: 1 }, redeemedValue: { $sum: '$amountRedeemed' } } },
    ]),
  ]);
  const iv = Math.round((issued[0]?.issuedValue ?? 0) * 100) / 100;
  const rv = Math.round((redeemed[0]?.redeemedValue ?? 0) * 100) / 100;
  return {
    issued: issued[0]?.issued ?? 0,
    issuedValue: iv,
    redemptions: redeemed[0]?.redemptions ?? 0,
    redeemedValue: rv,
    outstanding: Math.round((issued[0]?.outstanding ?? 0) * 100) / 100,
    redemptionRate: iv > 0 ? Math.round((rv / iv) * 1000) / 10 : 0,
  };
}

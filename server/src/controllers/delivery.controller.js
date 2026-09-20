import Voucher from '../models/Voucher.js';
import NotificationDelivery from '../models/NotificationDelivery.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { audit } from '../utils/helpers.js';
import { buildVoucherPdf } from '../services/voucherDocument.service.js';
import { dispatchNotification, availableChannels } from '../services/notification.service.js';

// GET /api/vouchers/notify-channels — which delivery channels exist and
// whether a provider is configured (literal path; mounted before '/:id').
export const listNotifyChannels = asyncHandler(async (req, res) => {
  res.json({ channels: availableChannels() });
});

// GET /api/vouchers/:id/pdf — downloadable voucher document.
export const downloadVoucherPdf = asyncHandler(async (req, res) => {
  const voucher = await Voucher.findById(req.params.id).populate('validStores', 'name code');
  if (!voucher) throw ApiError.notFound('Voucher not found');
  const pdf = await buildVoucherPdf(voucher);
  audit({ actor: req.user, action: 'voucher.download', entity: 'Voucher', entityId: String(voucher._id), metadata: { code: voucher.code }, req });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="shopwise-voucher-${voucher.code}.pdf"`);
  res.send(pdf);
});

// POST /api/vouchers/:id/notify — queue a delivery via a configured provider.
// Providers are plugged into notification.service; with none configured the
// attempt is logged as failed and a 501 is returned (never silently dropped).
export const notifyVoucher = asyncHandler(async (req, res) => {
  const voucher = await Voucher.findById(req.params.id).select('code originalValue expiryDate status');
  if (!voucher) throw ApiError.notFound('Voucher not found');
  if (['CANCELLED', 'EXPIRED'].includes(voucher.status)) {
    throw ApiError.badRequest(`Cannot send a ${voucher.status} voucher`);
  }
  const delivery = await dispatchNotification({
    voucher,
    channel: req.body.channel,
    recipient: req.body.recipient,
    actor: req.user,
  });
  audit({
    actor: req.user,
    action: 'voucher.notify',
    entity: 'NotificationDelivery',
    entityId: String(delivery._id),
    metadata: { code: voucher.code, channel: delivery.channel, recipient: delivery.recipient },
    req,
  });
  res.status(201).json({
    delivery: {
      id: String(delivery._id),
      channel: delivery.channel,
      recipient: delivery.recipient,
      status: delivery.status,
    },
  });
});

// GET /api/vouchers/:id/deliveries — attempt history for the voucher.
export const voucherDeliveries = asyncHandler(async (req, res) => {
  const voucher = await Voucher.findById(req.params.id).select('_id');
  if (!voucher) throw ApiError.notFound('Voucher not found');
  const items = await NotificationDelivery.find({ voucher: voucher._id }).sort({ createdAt: -1 }).limit(50).lean();
  res.json({
    items: items.map((d) => ({
      id: String(d._id),
      channel: d.channel,
      recipient: d.recipient,
      status: d.status,
      error: d.error || null,
      createdAt: d.createdAt,
    })),
  });
});

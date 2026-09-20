import mongoose from 'mongoose';

export const DELIVERY_CHANNELS = ['email', 'sms', 'whatsapp'];
export const DELIVERY_STATUSES = ['queued', 'sent', 'failed'];

// One row per delivery attempt — the audit trail for voucher distribution.
// The Voucher model itself is never touched by delivery.
const deliverySchema = new mongoose.Schema(
  {
    voucher: { type: mongoose.Schema.Types.ObjectId, ref: 'Voucher', default: null },
    voucherCode: { type: String, uppercase: true, trim: true, default: '' },
    channel: { type: String, enum: DELIVERY_CHANNELS, required: true, index: true },
    recipient: { type: String, required: true, trim: true },
    status: { type: String, enum: DELIVERY_STATUSES, default: 'queued', index: true },
    providerRef: { type: String, default: '' },
    error: { type: String, default: '' },
    sentBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
);

deliverySchema.index({ voucher: 1, createdAt: -1 });

const NotificationDelivery = mongoose.model('NotificationDelivery', deliverySchema);
export default NotificationDelivery;

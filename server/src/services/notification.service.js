import NotificationDelivery, { DELIVERY_CHANNELS } from '../models/NotificationDelivery.js';
import { ApiError } from '../utils/ApiError.js';

// ---------------------------------------------------------------------------
// Notification service abstraction.
//
// A channel is any object shaped like:
//   {
//     type: 'email' | 'sms' | 'whatsapp',
//     label: 'Email',
//     validateRecipient: (recipient) => true | 'error message',
//     send: async ({ to, subject, text, voucher }) => ({ providerRef: '...' }),
//   }
//
// Providers (SMTP, Africa's Talking, Twilio, WhatsApp Business API, …) are
// plugged in via registerChannel() — no provider is hardcoded or imported
// here, and nothing in this module changes when one is added.
// ---------------------------------------------------------------------------

const registry = new Map();

export function registerChannel(channel) {
  if (!channel?.type || !DELIVERY_CHANNELS.includes(channel.type)) {
    throw new Error('Channel must declare a valid type');
  }
  if (typeof channel.send !== 'function' || typeof channel.validateRecipient !== 'function') {
    throw new Error('Channel must implement send() and validateRecipient()');
  }
  registry.set(channel.type, channel);
}

export function availableChannels() {
  const labels = { email: 'Email', sms: 'SMS', whatsapp: 'WhatsApp' };
  return DELIVERY_CHANNELS.map((type) => ({
    channel: type,
    label: labels[type],
    configured: registry.has(type),
  }));
}

function defaultRecipientCheck(channel, recipient) {
  if (!recipient || !String(recipient).trim()) return 'Recipient is required';
  const value = String(recipient).trim();
  if (channel === 'email') {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) || 'Invalid email address';
  }
  // sms / whatsapp: international digits, e.g. +265991234567
  return /^\+?[0-9]{7,15}$/.test(value.replace(/[\s-]/g, '')) || 'Invalid phone number (use international format)';
}

export async function dispatchNotification({ voucher, channel, recipient, actor = null }) {
  return sendDirect({
    channel,
    recipient,
    subject: `Your Shopwise voucher ${voucher.code}`,
    text: `Shopwise Shopping Voucher ${voucher.code} worth K${Number(voucher.originalValue).toFixed(2)}, valid until ${new Date(voucher.expiryDate).toLocaleDateString('en-GB')}. Present this code at the till.`,
    actor,
    voucher,
  });
}

// Generic send for non-voucher messages (invites, alerts, …). Same registry,
// same logging, no provider hardcoded.
export async function sendDirect({ channel, recipient, subject, text, actor = null, voucher = null }) {
  if (!DELIVERY_CHANNELS.includes(channel)) {
    throw ApiError.badRequest(`Unknown channel. Use one of: ${DELIVERY_CHANNELS.join(', ')}`);
  }
  const to = String(recipient || '').trim();
  const provider = registry.get(channel);
  const formatOk = provider ? provider.validateRecipient(to) : defaultRecipientCheck(channel, to);
  if (formatOk !== true) throw ApiError.badRequest(formatOk || 'Invalid recipient');

  const delivery = await NotificationDelivery.create({
    voucher: voucher?._id ?? null,
    voucherCode: voucher?.code ?? '',
    channel,
    recipient: to,
    status: 'queued',
    sentBy: actor?._id ?? null,
  });

  if (!provider) {
    delivery.status = 'failed';
    delivery.error = `${channel} provider is not configured yet`;
    await delivery.save();
    throw ApiError.notImplemented(`${label(channel)} delivery is not configured yet — the attempt has been logged`);
  }

  try {
    const result = await provider.send({ to, subject, text, voucher });
    delivery.status = 'sent';
    delivery.providerRef = result?.providerRef ?? '';
    await delivery.save();
    return delivery;
  } catch (err) {
    delivery.status = 'failed';
    delivery.error = err?.message || 'Provider error';
    await delivery.save();
    throw ApiError.badGateway(`${label(channel)} delivery failed: ${delivery.error}`);
  }
}

function label(channel) {
  return { email: 'Email', sms: 'SMS', whatsapp: 'WhatsApp' }[channel] ?? channel;
}

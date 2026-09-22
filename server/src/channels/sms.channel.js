import { env } from '../config/env.js';
import { registerChannel } from '../services/notification.service.js';

// Africa's Talking SMS (pay-as-you-go, works with Airtel/TNM Malawi; the
// sandbox username is free for testing). No extra dependency — plain HTTPS.
// Registers nothing when AT_USERNAME/AT_API_KEY are unset; WhatsApp Cloud
// API can later plug in here as the near-free phone alternative.
export function registerSmsChannel() {
  if (!env.atUsername || !env.atApiKey) {
    console.log('[notify] SMS not configured (set AT_USERNAME + AT_API_KEY) — SMS alerts will be logged only');
    return;
  }
  registerChannel({
    type: 'sms',
    label: 'SMS',
    validateRecipient: (to) => /^\+?[0-9]{7,15}$/.test(String(to).replace(/[\s-]/g, '')) || 'Invalid phone number (use international format)',
    send: async ({ to, text }) => {
      const body = new URLSearchParams({
        username: env.atUsername,
        to,
        message: text,
        ...(env.atSender ? { from: env.atSender } : {}),
      });
      const res = await fetch('https://api.africastalking.com/version1/messaging', {
        method: 'POST',
        headers: { apiKey: env.atApiKey, 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
        body,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.SMSMessageData?.Message || `SMS provider rejected the request (${res.status})`);
      const recipient = data?.SMSMessageData?.Recipients?.[0];
      if (recipient && !['Success', 'Sent'].includes(recipient.status)) {
        throw new Error(`SMS not sent: ${recipient.status}`);
      }
      return { providerRef: recipient?.messageId || '' };
    },
  });
  console.log('[notify] SMS channel registered');
}

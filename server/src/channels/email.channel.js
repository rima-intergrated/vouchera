import nodemailer from 'nodemailer';
import { env } from '../config/env.js';
import { registerChannel } from '../services/notification.service.js';

// Free email delivery via any SMTP provider: Gmail (app password, ~500/day)
// or Brevo (free tier) cover a supermarket's notification volume at no cost.
// Registers nothing when SMTP_HOST is unset — delivery attempts are then
// logged as unconfigured instead of crashing the request.
export function registerEmailChannel() {
  if (!env.smtpHost) {
    console.log('[notify] email not configured (set SMTP_HOST) — email alerts will be logged only');
    return;
  }
  const transporter = nodemailer.createTransport({
    host: env.smtpHost,
    port: env.smtpPort,
    secure: env.smtpPort === 465,
    auth: env.smtpUser ? { user: env.smtpUser, pass: env.smtpPass } : undefined,
  });
  registerChannel({
    type: 'email',
    label: 'Email',
    validateRecipient: (to) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to) || 'Invalid email address',
    send: async ({ to, subject, text }) => {
      const info = await transporter.sendMail({ from: env.smtpFrom, to, subject, text });
      return { providerRef: info.messageId || '' };
    },
  });
  console.log('[notify] email channel registered');
}

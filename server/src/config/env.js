import dotenv from 'dotenv';

dotenv.config();

function required(name, fallback = undefined) {
  const value = process.env[name] ?? fallback;
  return value;
}

export const env = {
  port: parseInt(required('PORT', '5000'), 10),
  mongoUri: required('MONGO_URI', ''),
  jwtSecret: required('JWT_SECRET', ''),
  jwtExpiresIn: required('JWT_EXPIRES_IN', '8h'),
  corsOrigin: required('CORS_ORIGIN', 'http://localhost:5173'),
  clientUrl: required('CLIENT_URL', required('CORS_ORIGIN', 'http://localhost:5173')),
  nodeEnv: required('NODE_ENV', 'development'),
  // Free email via any SMTP provider (Gmail app password, Brevo, …). When
  // unset, email delivery attempts are logged as unconfigured — nothing breaks.
  smtpHost: required('SMTP_HOST', ''),
  smtpPort: parseInt(required('SMTP_PORT', '587'), 10),
  smtpUser: required('SMTP_USER', ''),
  smtpPass: required('SMTP_PASS', ''),
  smtpFrom: required('SMTP_FROM', required('SMTP_USER', 'Vouchera <no-reply@localhost>')),
  // Africa's Talking SMS (pay-as-you-go; sandbox works for testing). When
  // unset, SMS attempts are logged as unconfigured.
  atUsername: required('AT_USERNAME', ''),
  atApiKey: required('AT_API_KEY', ''),
  atSender: required('AT_SENDER', ''),
};

export function validateEnv({ strict = false } = {}) {
  // The JWT signing secret is ALWAYS fatal when missing: signing or
  // verifying tokens with an empty secret would let anyone forge sessions.
  if (!env.jwtSecret) {
    throw new Error('JWT_SECRET is required — refusing to start without a signing secret');
  }
  // In production a weak/guessable secret is as bad as none: fail fast
  // instead of running with sessions anyone could forge.
  if (env.nodeEnv === 'production') {
    const weak = new Set(['change-me-to-a-long-random-string', 'dev-only-secret-change-me-before-production', 'secret', 'password', '123456']);
    if (env.jwtSecret.length < 32 || weak.has(env.jwtSecret)) {
      throw new Error('JWT_SECRET is too weak for production — set a random string of at least 32 characters');
    }
  }
  const missing = [];
  if (!env.mongoUri) missing.push('MONGO_URI');
  if (missing.length && strict) {
    throw new Error(`Missing required env vars: ${missing.join(', ')}`);
  }
  if (missing.length) {
    console.warn(`[warn] Missing env vars: ${missing.join(', ')} — using limited dev mode`);
  }
}

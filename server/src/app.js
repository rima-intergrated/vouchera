import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import { env } from './config/env.js';
import authRoutes from './routes/auth.routes.js';
import storeRoutes from './routes/store.routes.js';
import reportRoutes from './routes/reports.routes.js';
import voucherRoutes from './routes/voucher.routes.js';
import redemptionRoutes from './routes/redemption.routes.js';
import customerRoutes from './routes/customer.routes.js';
import campaignRoutes from './routes/campaign.routes.js';
import auditRoutes from './routes/audit.routes.js';
import walletRoutes from './routes/wallet.routes.js';
import loyaltyRoutes from './routes/loyalty.routes.js';
import settingsRoutes from './routes/settings.routes.js';
import onlineRoutes from './routes/online.routes.js';
import { errorHandler, notFound } from './middleware/errorHandler.js';

const app = express();

// Behind Render's reverse proxy (TLS termination + X-Forwarded-For).
// Trust a single proxy hop so rate limiting sees real client IPs.
app.set('trust proxy', 1);

// Secure HTTP headers
app.use(helmet());

// Production HTTPS enforcement: sessions and PINs must never cross the wire
// in cleartext. Behind Render/Heroku-style TLS termination the proxy sets
// X-Forwarded-Proto, which trust-proxy (set above) exposes via req.secure.
if (env.nodeEnv === 'production') {
  app.use((req, res, next) => {
    const proto = req.headers['x-forwarded-proto'] || (req.secure ? 'https' : 'http');
    if (proto !== 'https') {
      return res.redirect(301, `https://${req.headers.host}${req.originalUrl}`);
    }
    next();
  });
}

// CORS — restrict to configured frontend origin
app.use(
  cors({
    origin: env.corsOrigin,
    credentials: true,
  })
);

app.use(express.json({ limit: '100kb' }));
if (env.nodeEnv === 'development') app.use(morgan('dev'));

// Global rate limit (conservative)
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api', globalLimiter);

// Stricter limit for auth (brute-force protection)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50,
  standardHeaders: true,
  legacyHeaders: false,
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', service: 'shopwise-voucher-api', time: new Date().toISOString() });
});

app.use('/api/auth', authLimiter, authRoutes);
app.use('/api/stores', storeRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/vouchers', voucherRoutes);
app.use('/api/redemptions', redemptionRoutes);
app.use('/api/customers', customerRoutes);
app.use('/api/campaigns', campaignRoutes);
app.use('/api/audit-logs', auditRoutes);
app.use('/api/wallets', walletRoutes);
app.use('/api/loyalty', loyaltyRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/online', onlineRoutes);

// All module routes mounted above.

app.use(notFound);
app.use(errorHandler);

export default app;

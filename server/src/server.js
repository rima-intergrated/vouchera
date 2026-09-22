import app from './app.js';
import { connectDB } from './config/db.js';
import { env, validateEnv } from './config/env.js';
import { registerEmailChannel } from './channels/email.channel.js';
import { registerSmsChannel } from './channels/sms.channel.js';

validateEnv({ strict: false });

// Notification providers plug in here — each is a no-op without its env
// config, so the API boots identically in dev and production.
try {
  registerEmailChannel();
} catch (err) {
  console.warn('[notify] email channel failed:', err.message);
}
try {
  registerSmsChannel();
} catch (err) {
  console.warn('[notify] SMS channel failed:', err.message);
}

const start = async () => {
  if (!env.mongoUri) {
    console.warn('[api] MONGO_URI not set — starting without DB (health check only). Set MONGO_URI in server/.env');
    app.listen(env.port, () => console.log(`[api] listening on :${env.port} (no DB)`));
    return;
  }
  try {
    await connectDB(env.mongoUri);
    console.log('[api] MongoDB connected');
    app.listen(env.port, () => console.log(`[api] listening on :${env.port}`));
  } catch (err) {
    console.error('[api] failed to start:', err.message);
    process.exit(1);
  }
};

start();

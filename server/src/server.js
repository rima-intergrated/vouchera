import app from './app.js';
import { connectDB } from './config/db.js';
import { env, validateEnv } from './config/env.js';

validateEnv({ strict: false });

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

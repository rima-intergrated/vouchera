import dotenv from 'dotenv';
import { connectDB } from '../config/db.js';
import Store from '../models/Store.js';
import User, { hashPassword } from '../models/User.js';
import Setting, { KNOWN_SETTINGS } from '../models/Setting.js';

dotenv.config();

const STORES = [
  { name: 'Mzuzu', code: 'MZU', location: 'Mzuzu' },
  { name: 'Lilongwe Area 4', code: 'LLW4', location: 'Lilongwe' },
  { name: 'Gateway Mall', code: 'GTWY', location: 'Lilongwe' },
  { name: 'Chichiri', code: 'CHI', location: 'Blantyre' },
  { name: 'Limbe', code: 'LIM', location: 'Blantyre' },
];

// Credentials come from env vars only — never hardcoded.
// Defaults are non-secret placeholders; a random password is generated
// when no SEED_*_PASSWORD is provided (printed once to console).
const { randomBytes } = await import('node:crypto');

function seedUserDef(role) {
  const prefix = `SEED_${role}`;
  return {
    role,
    name: process.env[`${prefix}_NAME`] || `Shopwise ${role.charAt(0) + role.slice(1).toLowerCase()}`,
    email: (process.env[`${prefix}_EMAIL`] || `${role.toLowerCase()}@shopwise.mw`).toLowerCase(),
    password: process.env[`${prefix}_PASSWORD`] || randomBytes(9).toString('base64url'),
    generated: !process.env[`${prefix}_PASSWORD`],
  };
}

const run = async () => {
  const uri = process.env.MONGO_URI;
  if (!uri) throw new Error('MONGO_URI not set (see server/.env.example)');
  await connectDB(uri);
  console.log('[seed] MongoDB connected');

  for (const s of STORES) {
    await Store.updateOne({ code: s.code }, { $setOnInsert: s }, { upsert: true });
  }
  console.log(`[seed] stores upserted: ${STORES.length}`);

  for (const [key, def] of Object.entries(KNOWN_SETTINGS)) {
    await Setting.updateOne(
      { key },
      { $setOnInsert: { key, value: def.default, description: def.description } },
      { upsert: true }
    );
  }
  console.log(`[seed] settings ensured: ${Object.keys(KNOWN_SETTINGS).length}`);

  // Cashiers are assigned to the first store so store-scoped flows work out of the box
  const defaultStore = await Store.findOne({ code: 'LLW4' });

  for (const role of ['ADMIN', 'MANAGER', 'CASHIER', 'AUDITOR']) {
    const def = seedUserDef(role);
    const exists = await User.findOne({ email: def.email });
    if (exists) {
      console.log(`[seed] ${role.toLowerCase()} exists: ${def.email}`);
      continue;
    }
    const passwordHash = await hashPassword(def.password);
    await User.create({
      name: def.name,
      email: def.email,
      passwordHash,
      role,
      store: role === 'CASHIER' || role === 'MANAGER' ? (defaultStore?._id ?? null) : null,
    });
    console.log(`[seed] ${role.toLowerCase()} created: ${def.email}`);
    if (def.generated) {
      console.log(`[seed]   generated password for ${def.email}: ${def.password}  (change after login)`);
    }
  }

  // Ensure indexes for all Phase-2 models exist (fails fast on index errors)
  const { default: Voucher } = await import('../models/Voucher.js');
  const { default: VoucherRedemption } = await import('../models/VoucherRedemption.js');
  const { default: Campaign } = await import('../models/Campaign.js');
  const { default: Customer } = await import('../models/Customer.js');
  const { default: AuditLog } = await import('../models/AuditLog.js');
  const { default: LoyaltyTransaction } = await import('../models/LoyaltyTransaction.js');
  const { default: WalletTransaction } = await import('../models/WalletTransaction.js');
  const { default: TopUpRequest } = await import('../models/TopUpRequest.js');
  const { default: Shift } = await import('../models/Shift.js');
  await Promise.all([
    Store.syncIndexes(),
    User.syncIndexes(),
    Voucher.syncIndexes(),
    VoucherRedemption.syncIndexes(),
    Campaign.syncIndexes(),
    Customer.syncIndexes(),
    AuditLog.syncIndexes(),
    Setting.syncIndexes(),
    LoyaltyTransaction.syncIndexes(),
    WalletTransaction.syncIndexes(),
    TopUpRequest.syncIndexes(),
    Shift.syncIndexes(),
  ]);
  console.log('[seed] indexes synced for all models');
  process.exit(0);
};

run().catch((err) => {
  console.error('[seed] failed:', err.message);
  process.exit(1);
});

// Local demo database (in-memory MongoDB on a fixed port).
// Run: node demo-db.mjs  (leave it running, then start the API + client)
import { MongoMemoryServer } from 'mongodb-memory-server';

const mongod = await MongoMemoryServer.create({
  instance: { port: 27018, dbName: 'shopwise_vouchers' },
});
console.log(`[demo-db] READY ${mongod.getUri('shopwise_vouchers')}`);
setInterval(() => {}, 10000);

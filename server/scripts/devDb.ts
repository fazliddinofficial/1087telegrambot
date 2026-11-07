// Docker bo'lmagan kompyuterda lokal sinov uchun vaqtinchalik MongoDB. Ma'lumot to'xtatilganda o'chadi.
import { MongoMemoryServer } from 'mongodb-memory-server';

const PORT = Number(process.env.DEV_DB_PORT ?? 27027);

MongoMemoryServer.create({ instance: { port: PORT, dbName: 'taxi_balans' } }).then((server) => {
  console.log(`Vaqtinchalik MongoDB: ${server.getUri()}`);
  process.once('SIGINT', () => server.stop().finally(() => process.exit(0)));
  process.once('SIGTERM', () => server.stop().finally(() => process.exit(0)));
});

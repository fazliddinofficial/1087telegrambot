// Lokal brauzer sinovi uchun: bitta operator, bitta haydovchi va karta yaratadi.
import mongoose from 'mongoose';
import { config } from '../src/config/env';
import { CardSetting } from '../src/models/Setting';
import { User } from '../src/models/User';

async function main() {
  if (config.NODE_ENV === 'production' || config.BOT_POLLING) {
    throw new Error('Bu skript faqat lokal sinov uchun (BOT_POLLING=false)');
  }
  if (!config.SUPER_ADMIN_IDS.length) throw new Error('Sinov uchun SUPER_ADMIN_IDS kerak');
  await mongoose.connect(config.MONGO_URI);
  await User.updateOne(
    { telegramId: 3001 },
    { $set: { role: 'operator', staffName: 'Olim Operator', staffPhone: '+998901112300', operatorJoinedAt: new Date() } },
    { upsert: true },
  );
  await User.updateOne(
    { telegramId: 2001 },
    { $set: { role: 'driver', taxiId: '1234', name: 'Ali Valiyev', phone: '+998901234567', carNumber: '01A123BC', registeredAt: new Date() } },
    { upsert: true },
  );
  const admin = await User.findOneAndUpdate(
    { telegramId: config.SUPER_ADMIN_IDS[0] },
    { $set: { role: 'superadmin', telegramName: 'Super Admin' } },
    { upsert: true, returnDocument: 'after' },
  );
  await CardSetting.updateOne(
    { key: 'card' },
    {
      $setOnInsert: {
        number: '8600123456789012',
        holder: 'Sinov Karta',
        history: [{ number: '8600123456789012', holder: 'Sinov Karta', changedBy: admin._id, changedByName: 'Super Admin', at: new Date() }],
      },
    },
    { upsert: true },
  );
  await mongoose.disconnect();
  console.log('Sinov ma\'lumotlari tayyor: driver=2001, operator=3001, superadmin=' + config.SUPER_ADMIN_IDS[0]);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

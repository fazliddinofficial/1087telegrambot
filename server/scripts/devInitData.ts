// Mini App'ni brauzerda sinash uchun imzolangan initData chiqaradi.
// Ishlatish: npm run dev:init-data -- <telegramId> [ism]
import { config } from '../src/config/env';
import { signInitData } from '../src/utils/telegramAuth';

const id = Number(process.argv[2]);
if (!Number.isSafeInteger(id) || id <= 0) {
  console.error('Ishlatish: npm run dev:init-data -- <telegramId> [ism]');
  process.exit(1);
}
console.log(signInitData({ id, first_name: process.argv[3] ?? 'Sinov' }, config.BOT_TOKEN));

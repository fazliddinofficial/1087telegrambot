// Boshqa modullardan oldin import qilinadi: config shu qiymatlarni o'qiydi.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

export const TEST_TOKEN = '123456:TEST_TOKEN_FAQAT_SINOV_UCHUN';
export const SUPER_ADMIN_ID = 1000;
export const SUPER_ADMIN_PHONE = '+998901119999';
export const SECOND_ADMIN_PHONE = '+998931118888';

Object.assign(process.env, {
  BOT_TOKEN: TEST_TOKEN,
  BOT_USERNAME: 'test_bot',
  SUPER_ADMIN_IDS: String(SUPER_ADMIN_ID),
  SUPER_ADMIN_PHONES: `${SUPER_ADMIN_PHONE}, ${SECOND_ADMIN_PHONE}`,
  WEBAPP_URL: 'https://example.test',
  MONGO_URI: 'mongodb://unused',
  BOT_POLLING: 'false',
  UPLOAD_DIR: mkdtempSync(path.join(tmpdir(), 'taxi-balans-test-')),
});

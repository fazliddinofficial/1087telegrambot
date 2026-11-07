import { TEST_TOKEN } from './helpers/env';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { withNetworkRetry } from '../src/bot/telegramRetry';
import { escapeHtml, formatMoney, startOfTodayTashkent, tashkentDayStart } from '../src/utils/format';
import { detectImageType, normalizeCardNumber, normalizeCarNumber, normalizePhone } from '../src/utils/normalize';
import { signInitData, verifyInitData } from '../src/utils/telegramAuth';

test('telefon raqami normallashadi', () => {
  assert.equal(normalizePhone('+998 90 123-45-67'), '+998901234567');
  assert.equal(normalizePhone('901234567'), '+998901234567');
  assert.equal(normalizePhone('998901234567'), '+998901234567');
  assert.equal(normalizePhone('12345'), null);
  assert.equal(normalizePhone('+7 901 234 56 78'), null);
});

test('mashina raqami normallashadi', () => {
  assert.equal(normalizeCarNumber('01 a 123 bc'), '01A123BC');
  assert.equal(normalizeCarNumber('01-123-abc'), '01123ABC');
  // Shakl tekshirilmaydi: chet el raqami va kirill harflari ham o'tadi.
  assert.equal(normalizeCarNumber('abc'), 'ABC');
  assert.equal(normalizeCarNumber('01A12BC'), '01A12BC');
  assert.equal(normalizeCarNumber('такси 77-б'), 'ТАКСИ77Б');
  assert.equal(normalizeCarNumber('   '), null);
  assert.equal(normalizeCarNumber('1'.repeat(21)), null);
});

test('karta raqami 16 ta raqam', () => {
  assert.equal(normalizeCardNumber('8600 1234 5678 9012'), '8600123456789012');
  assert.equal(normalizeCardNumber('8600'), null);
});

test('rasm turi baytlardan aniqlanadi', () => {
  assert.equal(detectImageType(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0]))?.mime, 'image/jpeg');
  assert.equal(detectImageType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))?.mime, 'image/png');
  assert.equal(detectImageType(Buffer.from('<html></html>')), null);
});

test('formatlash', () => {
  assert.equal(formatMoney(1234567), "1 234 567 so'm");
  assert.equal(formatMoney(500), "500 so'm");
  assert.equal(escapeHtml('<b>&'), '&lt;b&gt;&amp;');
});

test('Toshkent kuni UTC+5 bo\'yicha hisoblanadi', () => {
  assert.equal(tashkentDayStart('2026-11-06')?.toISOString(), '2026-11-05T19:00:00.000Z');
  assert.equal(tashkentDayStart('xato'), null);
  assert.equal(startOfTodayTashkent(new Date('2026-11-05T20:00:00Z')).toISOString(), '2026-11-05T19:00:00.000Z');
  assert.equal(startOfTodayTashkent(new Date('2026-11-05T18:00:00Z')).toISOString(), '2026-11-04T19:00:00.000Z');
});

test('initData: to\'g\'ri imzo qabul qilinadi', () => {
  const data = signInitData({ id: 42, first_name: 'Ali' }, TEST_TOKEN);
  assert.equal(verifyInitData(data, TEST_TOKEN)?.id, 42);
});

test('initData: boshqa token bilan imzolangani rad etiladi', () => {
  const data = signInitData({ id: 42 }, 'boshqa:token');
  assert.equal(verifyInitData(data, TEST_TOKEN), null);
});

test('initData: user.id o\'zgartirilsa rad etiladi', () => {
  const params = new URLSearchParams(signInitData({ id: 42 }, TEST_TOKEN));
  params.set('user', JSON.stringify({ id: 1000 }));
  assert.equal(verifyInitData(params.toString(), TEST_TOKEN), null);
});

test('initData: eskirgani va imzosizi rad etiladi', () => {
  const now = 2_000_000_000;
  const old = signInitData({ id: 42 }, TEST_TOKEN, now - 25 * 60 * 60);
  assert.equal(verifyInitData(old, TEST_TOKEN, now), null);
  assert.equal(verifyInitData('user=%7B%22id%22%3A1%7D', TEST_TOKEN), null);
  assert.equal(verifyInitData('', TEST_TOKEN), null);
});

test('Telegram tarmoq xatosida qayta urinadi, API xatosida urinmaydi', async () => {
  const networkError = Object.assign(new Error('read ECONNRESET'), { type: 'system', code: 'ECONNRESET' });
  let calls = 0;
  const result = await withNetworkRetry(async () => {
    calls++;
    if (calls < 3) throw networkError;
    return 'ok';
  }, [0, 0]);
  assert.equal(result, 'ok');
  assert.equal(calls, 3);

  calls = 0;
  await assert.rejects(
    withNetworkRetry(async () => {
      calls++;
      throw networkError;
    }, [0, 0]),
    /ECONNRESET/,
  );
  assert.equal(calls, 3);

  calls = 0;
  await assert.rejects(
    withNetworkRetry(async () => {
      calls++;
      throw new Error('400: Bad Request');
    }, [0, 0]),
    /400/,
  );
  assert.equal(calls, 1);
});

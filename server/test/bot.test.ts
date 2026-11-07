import { SECOND_ADMIN_PHONE, SUPER_ADMIN_ID, SUPER_ADMIN_PHONE } from './helpers/env';
import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { Telegraf, Telegram } from 'telegraf';
import { registerHandlers } from '../src/bot/handlers';
import { config } from '../src/config/env';
import { createTelegramNotifier } from '../src/bot/telegramNotifier';
import { Payment } from '../src/models/Payment';
import { User } from '../src/models/User';
import { setCard } from '../src/services/card.service';
import { createOperatorService } from '../src/services/operators.service';
import { createPaymentService } from '../src/services/payments.service';
import { resolveUser } from '../src/services/users.service';

// Haqiqiy Telegram o'rniga: barcha API chaqiruvlari shu yerda yoziladi.
interface ApiCall {
  method: string;
  payload: any;
}
const apiCalls: ApiCall[] = [];
let nextMessageId = 100;
let failNextSendMessage = false;
(Telegram.prototype as any).callApi = async function (method: string, payload: any) {
  apiCalls.push({ method, payload });
  if (failNextSendMessage && method === 'sendMessage') {
    failNextSendMessage = false;
    throw Object.assign(new Error('read ECONNRESET'), { type: 'system', code: 'ECONNRESET' });
  }
  if (method === 'sendPhoto') {
    return { message_id: nextMessageId++, photo: [{ file_id: 'small' }, { file_id: 'TG_FILE_ID' }] };
  }
  if (method === 'sendMessage') return { message_id: nextMessageId++ };
  return true;
};

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('bot-test')]);
const OP_A = 3101;
const OP_B = 3102;
const DRIVER = 2101;

let mongod: MongoMemoryServer;
let bot: Telegraf;
let payments: ReturnType<typeof createPaymentService>;
let operators: ReturnType<typeof createOperatorService>;
let updateId = 1;

const settle = () => sleep(80);
const callsOf = (method: string) => apiCalls.filter((c) => c.method === method);

function textUpdate(fromId: number, text: string) {
  const isCommand = text.startsWith('/');
  return bot.handleUpdate({
    update_id: updateId++,
    message: {
      message_id: updateId,
      date: 1,
      chat: { id: fromId, type: 'private', first_name: 'T' },
      from: { id: fromId, is_bot: false, first_name: 'T' },
      text,
      ...(isCommand ? { entities: [{ type: 'bot_command', offset: 0, length: text.split(' ')[0].length }] } : {}),
    },
  } as any);
}

function contactUpdate(fromId: number, phone: string, userId = fromId) {
  return bot.handleUpdate({
    update_id: updateId++,
    message: {
      message_id: updateId,
      date: 1,
      chat: { id: fromId, type: 'private', first_name: 'T' },
      from: { id: fromId, is_bot: false, first_name: 'T' },
      contact: { phone_number: phone, first_name: 'T', user_id: userId },
    },
  } as any);
}

function clickUpdate(fromId: number, data: string) {
  return bot.handleUpdate({
    update_id: updateId++,
    callback_query: {
      id: String(updateId),
      from: { id: fromId, is_bot: false, first_name: 'T' },
      chat_instance: '1',
      data,
      message: { message_id: 1, date: 1, chat: { id: fromId, type: 'private', first_name: 'T' } },
    },
  } as any);
}

async function newPayment(name = 'Ali Valiyev', suffix = String(Math.random())) {
  const driver = await resolveUser({ id: DRIVER });
  driver.taxiId = 'T777';
  driver.name = name;
  driver.phone = '+998901234567';
  driver.carNumber = '01A123BC';
  driver.registeredAt = new Date();
  await driver.save();
  const payment = await payments.create(driver, 50000, Buffer.concat([JPEG, Buffer.from(suffix)]));
  await settle();
  return payment;
}

before(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  await Promise.all([User.init(), Payment.init()]);

  bot = new Telegraf('123:TEST');
  bot.botInfo = { id: 1, is_bot: true, first_name: 'Test', username: 'test_bot' } as any;
  const notifier = createTelegramNotifier(bot.telegram);
  payments = createPaymentService(notifier);
  operators = createOperatorService(notifier, payments);
  registerHandlers(bot, payments, operators);

  const admin = await resolveUser({ id: SUPER_ADMIN_ID });
  await setCard(admin, '8600123456789012', 'Karta Egasi');
  for (const [id, phone] of [[OP_A, '+998901113101'], [OP_B, '+998901113102']] as const) {
    const { link } = await operators.createInvite(admin, `Op${id}`, phone);
    const user = await resolveUser({ id });
    await operators.beginInvite(user, new URL(link).searchParams.get('start')!.replace('inv_', ''));
    await operators.acceptContact(user, phone, id);
  }
  await settle();
}, { timeout: 300_000 });

beforeEach(() => {
  apiCalls.length = 0;
});

after(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

test('/start haydovchiga Mini App tugmasini beradi', async () => {
  await textUpdate(2190, '/start');
  const [call] = callsOf('sendMessage');
  assert.equal(call.payload.chat_id, 2190);
  assert.equal(call.payload.text, 'Salom Hurmatli Haydovchi Hisobni To’ldirish Uchun Ilovani Oching !');
  assert.equal(call.payload.reply_markup.inline_keyboard[0][0].web_app.url, 'https://example.test');
});

test('/start super adminga ham shu xabarni yuboradi', async () => {
  await textUpdate(SUPER_ADMIN_ID, '/start');
  const call = callsOf('sendMessage').at(-1)!;
  assert.equal(call.payload.text, 'Salom Hurmatli Haydovchi Hisobni To’ldirish Uchun Ilovani Oching !');
  assert.ok(call.payload.reply_markup.inline_keyboard[0][0].web_app);
});

test('guruhdagi xabarlarga bot javob bermaydi', async () => {
  await bot.handleUpdate({
    update_id: updateId++,
    message: {
      message_id: 1,
      date: 1,
      chat: { id: -100, type: 'supergroup', title: 'G' },
      from: { id: 2191, is_bot: false, first_name: 'T' },
      text: 'salom',
    },
  } as any);
  assert.equal(apiCalls.length, 0);
});

test('taklif havolasi bot orqali: boshqa raqam rad, to\'g\'ri raqam operator qiladi', async () => {
  const admin = await resolveUser({ id: SUPER_ADMIN_ID });
  const { link } = await operators.createInvite(admin, 'Yangi Op', '+998901113199');
  const payload = new URL(link).searchParams.get('start')!;
  assert.ok(payload.length <= 64, 'Telegram start parametri 64 belgidan oshmasligi kerak');
  assert.match(payload, /^[A-Za-z0-9_-]+$/);

  await textUpdate(3199, `/start ${payload}`);
  const asked = callsOf('sendMessage').at(-1)!;
  assert.equal(asked.payload.reply_markup.keyboard[0][0].request_contact, true);

  await contactUpdate(3199, '+998900000000');
  assert.equal((await User.findOne({ telegramId: 3199 }))?.role, 'driver');
  assert.match(callsOf('sendMessage').at(-1)!.payload.text, /mos kelmadi/);

  // Xato raqamdan keyin ham havola tugamaydi: egasi kira oladi.
  await contactUpdate(3199, '998901113199');
  assert.equal((await User.findOne({ telegramId: 3199 }))?.role, 'operator');
  await settle();
  const adminNote = callsOf('sendMessage').find((c) => c.payload.chat_id === SUPER_ADMIN_ID);
  assert.match(adminNote!.payload.text, /Yangi Op/);
  await operators.removeOperator(String((await User.findOne({ telegramId: 3199 }))!._id), admin);
});

test('/admin: boshqa kontakt va ro\'yxatda yo\'q raqam rol bermaydi, to\'g\'ri raqam super admin qiladi', async () => {
  const CLAIMER = 4001;

  // Kontakt yuborilgan, lekin /admin bosilmagan: rol berilmaydi.
  await contactUpdate(CLAIMER, SUPER_ADMIN_PHONE);
  assert.equal((await User.findOne({ telegramId: CLAIMER }))?.role, 'driver');

  await textUpdate(CLAIMER, '/admin');
  assert.equal(callsOf('sendMessage').at(-1)!.payload.reply_markup.keyboard[0][0].request_contact, true);

  // Admin raqamini boshqa odamning kontakti sifatida yuborish o'tmaydi.
  await contactUpdate(CLAIMER, SUPER_ADMIN_PHONE, 9999);
  assert.equal((await User.findOne({ telegramId: CLAIMER }))?.role, 'driver');
  assert.match(callsOf('sendMessage').at(-1)!.payload.text, /O'zingizning raqamingizni/);

  // Ro'yxatda yo'q raqam: rol berilmaydi va urinish yakunlanadi.
  await contactUpdate(CLAIMER, '+998900000000');
  assert.equal((await User.findOne({ telegramId: CLAIMER }))?.role, 'driver');
  assert.match(callsOf('sendMessage').at(-1)!.payload.text, /ro'yxatida yo'q/);
  await contactUpdate(CLAIMER, SUPER_ADMIN_PHONE);
  assert.equal((await User.findOne({ telegramId: CLAIMER }))?.role, 'driver');

  // To'g'ri raqam: Telegram ko'pincha + belgisisiz yuboradi.
  await textUpdate(CLAIMER, '/admin');
  apiCalls.length = 0;
  await contactUpdate(CLAIMER, SUPER_ADMIN_PHONE.replace('+', ''));
  await settle();
  const admin = await User.findOne({ telegramId: CLAIMER });
  assert.equal(admin?.role, 'superadmin');
  assert.equal(admin?.verifiedPhone, SUPER_ADMIN_PHONE);
  const note = callsOf('sendMessage').find((c) => c.payload.chat_id === SUPER_ADMIN_ID);
  assert.match(note!.payload.text, /super admin bo'ldi/);

  // Boshqa so'rovlarda ham rol saqlanadi, qayta /admin kerak emas.
  assert.equal((await resolveUser({ id: CLAIMER })).role, 'superadmin');
  apiCalls.length = 0;
  await textUpdate(CLAIMER, '/admin');
  assert.match(callsOf('sendMessage').at(-1)!.payload.text, /allaqachon super admin/);

  // Raqam sozlamadan olib tashlansa, huquq darhol yo'qoladi.
  const saved = config.SUPER_ADMIN_PHONES.splice(0);
  assert.equal((await resolveUser({ id: CLAIMER })).role, 'driver');
  config.SUPER_ADMIN_PHONES.push(...saved);
  await User.deleteOne({ telegramId: CLAIMER });
});

test('Ro\'yxatdagi ikkinchi raqam ham ishlaydi, faqat bittasi olib tashlansa ikkinchisi qoladi', async () => {
  const FIRST = 4003;
  const SECOND = 4004;
  await textUpdate(FIRST, '/admin');
  await contactUpdate(FIRST, SUPER_ADMIN_PHONE);
  await textUpdate(SECOND, '/admin');
  apiCalls.length = 0;
  await contactUpdate(SECOND, SECOND_ADMIN_PHONE);
  await settle();

  assert.equal((await User.findOne({ telegramId: FIRST }))?.role, 'superadmin');
  const second = await User.findOne({ telegramId: SECOND });
  assert.equal(second?.role, 'superadmin');
  assert.equal(second?.verifiedPhone, SECOND_ADMIN_PHONE);

  // Birinchi admin ikkinchisi qo'shilganidan xabar topadi.
  const note = callsOf('sendMessage').find((c) => c.payload.chat_id === FIRST);
  assert.match(note!.payload.text, /super admin bo'ldi/);

  // Yangi chek ikkala adminga ham boradi.
  await Payment.deleteMany({ status: { $in: ['new', 'in_progress'] } });
  apiCalls.length = 0;
  const payment = await newPayment();
  const receivers = callsOf('sendPhoto').map((c) => c.payload.chat_id);
  assert.ok(receivers.includes(FIRST) && receivers.includes(SECOND), receivers.join(','));
  await Payment.deleteOne({ _id: payment._id });

  // Birinchi raqam o'chirilsa, faqat u huquqini yo'qotadi.
  const index = config.SUPER_ADMIN_PHONES.indexOf(SUPER_ADMIN_PHONE);
  config.SUPER_ADMIN_PHONES.splice(index, 1);
  assert.equal((await resolveUser({ id: FIRST })).role, 'driver');
  assert.equal((await resolveUser({ id: SECOND })).role, 'superadmin');
  config.SUPER_ADMIN_PHONES.splice(index, 0, SUPER_ADMIN_PHONE);
  await User.deleteMany({ telegramId: { $in: [FIRST, SECOND] } });
});

test('Tasdiqlash xabari tarmoq sababli ketmasa ham rol saqlanadi va «Xatolik» deyilmaydi', async () => {
  const CLAIMER = 4002;
  await textUpdate(CLAIMER, '/admin');
  apiCalls.length = 0;
  failNextSendMessage = true;
  await contactUpdate(CLAIMER, SUPER_ADMIN_PHONE);
  await settle();

  assert.equal((await User.findOne({ telegramId: CLAIMER }))?.role, 'superadmin');
  const texts = callsOf('sendMessage').map((c) => String(c.payload.text));
  assert.ok(!texts.some((t) => t.includes('Xatolik')), texts.join(' | '));
  await User.deleteOne({ telegramId: CLAIMER });
});

test('Tugma bosilgach javob ketmasa ham to\'lov olingan bo\'ladi va ogohlantirish chiqmaydi', async () => {
  await Payment.deleteMany({ status: { $in: ['new', 'in_progress'] } });
  const payment = await newPayment();
  apiCalls.length = 0;
  const original = (Telegram.prototype as any).callApi;
  (Telegram.prototype as any).callApi = async function (method: string, payload: any) {
    if (method === 'answerCallbackQuery') {
      apiCalls.push({ method, payload });
      throw Object.assign(new Error('read ECONNRESET'), { type: 'system', code: 'ECONNRESET' });
    }
    return original.call(this, method, payload);
  };
  try {
    await clickUpdate(OP_A, `pay:take:${payment._id}`);
    await settle();
  } finally {
    (Telegram.prototype as any).callApi = original;
  }
  assert.equal((await Payment.findById(payment._id))?.status, 'in_progress');
  assert.equal(callsOf('answerCallbackQuery').length, 1);
  assert.ok(!callsOf('answerCallbackQuery')[0].payload.show_alert);
  await Payment.deleteOne({ _id: payment._id });
});

test('chek barcha xodimlarga yuboriladi, rasm bir marta yuklanadi, ism HTML sifatida xavfsiz', async () => {
  const payment = await newPayment('<b>Ali</b> & Co');
  const sent = callsOf('sendPhoto');
  assert.deepEqual(sent.map((c) => c.payload.chat_id).sort(), [SUPER_ADMIN_ID, OP_A, OP_B].sort());
  assert.ok(sent[0].payload.caption.includes('ID: <code>T777</code>'));
  assert.ok(sent[0].payload.caption.includes('&lt;b&gt;Ali&lt;/b&gt; &amp; Co'));
  assert.ok(!sent[0].payload.caption.includes('<b>Ali</b>'));
  assert.equal(sent[1].payload.photo, 'TG_FILE_ID');
  assert.equal(sent[0].payload.reply_markup.inline_keyboard[0][0].text, '📥 Oldim');

  const saved = await Payment.findById(payment._id);
  assert.equal(saved?.messages.length, 3);
  assert.equal(saved?.receipt.telegramFileId, 'TG_FILE_ID');
});

test('«Oldim»: tugmalar faqat olgan operatorda qoladi, ikkinchisiga ogohlantirish chiqadi', async () => {
  const payment = await newPayment();
  apiCalls.length = 0;
  await clickUpdate(OP_A, `pay:take:${payment._id}`);
  await settle();

  const edits = callsOf('editMessageCaption');
  assert.equal(edits.length, 3);
  const byChat = new Map(edits.map((e) => [e.payload.chat_id, e.payload]));
  const opAButtons = byChat.get(OP_A).reply_markup.inline_keyboard[0].map((b: any) => b.text);
  assert.deepEqual(opAButtons, ['✅ Tushirdim', '❌ Rad etish']);
  assert.deepEqual(byChat.get(OP_B).reply_markup.inline_keyboard, []);
  assert.deepEqual(byChat.get(SUPER_ADMIN_ID).reply_markup.inline_keyboard, []);
  assert.match(byChat.get(OP_B).caption, /Op3101 oldi/);

  apiCalls.length = 0;
  await clickUpdate(OP_B, `pay:take:${payment._id}`);
  const answer = callsOf('answerCallbackQuery').at(-1)!;
  assert.equal(answer.payload.show_alert, true);
  assert.match(answer.payload.text, /Op3101 olgan/);
});

test('«Tushirdim» haydovchiga xabar yuboradi va tugmalarni olib tashlaydi', async () => {
  const payment = await newPayment();
  await clickUpdate(OP_A, `pay:take:${payment._id}`);
  await settle();
  apiCalls.length = 0;
  await clickUpdate(OP_A, `pay:done:${payment._id}`);
  await settle();

  const toDriver = callsOf('sendMessage').find((c) => c.payload.chat_id === DRIVER);
  assert.match(toDriver!.payload.text, /50 000 so'm balansingizga tushirildi/);
  for (const edit of callsOf('editMessageCaption')) {
    assert.deepEqual(edit.payload.reply_markup.inline_keyboard, []);
    assert.match(edit.payload.caption, /Op3101 tushirdi/);
  }
});

test('Rad etish: tayyor sabab bilan', async () => {
  const payment = await newPayment();
  await clickUpdate(OP_A, `pay:take:${payment._id}`);
  await settle();
  apiCalls.length = 0;

  await clickUpdate(OP_A, `pay:rej:${payment._id}`);
  const markup = callsOf('editMessageReplyMarkup').at(-1)!.payload.reply_markup.inline_keyboard;
  assert.equal(markup.length, 5);
  for (const row of markup) {
    assert.ok(Buffer.byteLength(row[0].callback_data) <= 64, 'callback_data 64 baytdan oshmasligi kerak');
  }

  await clickUpdate(OP_A, markup[0][0].callback_data);
  await settle();
  const saved = await Payment.findById(payment._id);
  assert.equal(saved?.status, 'rejected');
  assert.equal(saved?.rejectionReason, 'Pul kartaga tushmagan');
  const toDriver = callsOf('sendMessage').find((c) => c.payload.chat_id === DRIVER);
  assert.match(toDriver!.payload.text, /Pul kartaga tushmagan/);
});

test('Rad etish: «Boshqa sabab» keyingi matnni oladi va faqat bir marta ishlaydi', async () => {
  const payment = await newPayment();
  await clickUpdate(OP_A, `pay:take:${payment._id}`);
  await settle();

  // Boshqa operator bu yo'l bilan rad eta olmaydi.
  await clickUpdate(OP_B, `pay:rejo:${payment._id}`);
  assert.equal((await User.findOne({ telegramId: OP_B }))?.pendingRejectPaymentId, undefined);

  await clickUpdate(OP_A, `pay:rejo:${payment._id}`);
  await textUpdate(OP_A, 'Karta raqami boshqa');
  await settle();
  const saved = await Payment.findById(payment._id);
  assert.equal(saved?.status, 'rejected');
  assert.equal(saved?.rejectionReason, 'Karta raqami boshqa');

  apiCalls.length = 0;
  await textUpdate(OP_A, 'oddiy xabar');
  assert.equal((await Payment.findById(payment._id))?.rejectionReason, 'Karta raqami boshqa');
  assert.ok(callsOf('sendMessage').at(-1)!.payload.reply_markup.inline_keyboard[0][0].web_app);
});

test('«Boshqa sabab» kutilayotganda to\'lov qaytarilsa, matn sabab bo\'lmaydi', async () => {
  const payment = await newPayment();
  await clickUpdate(OP_A, `pay:take:${payment._id}`);
  await settle();
  await clickUpdate(OP_A, `pay:rejo:${payment._id}`);
  const admin = await resolveUser({ id: SUPER_ADMIN_ID });
  await payments.release(String(payment._id), admin);
  await settle();

  await textUpdate(OP_A, 'kechikkan sabab');
  const saved = await Payment.findById(payment._id);
  assert.equal(saved?.status, 'new');
  assert.equal(saved?.rejectionReason, undefined);
  assert.equal((await User.findOne({ telegramId: OP_A }))?.pendingRejectPaymentId, undefined);
});

test('o\'chirilgan operator eski tugmani bossa ishlamaydi', async () => {
  // Oldingi testlardagi ochiq to'lovlar haydovchi chegarasini band qilmasin.
  await Payment.deleteMany({ status: { $in: ['new', 'in_progress'] } });
  const admin = await resolveUser({ id: SUPER_ADMIN_ID });
  const { link } = await operators.createInvite(admin, 'Ketgan', '+998901113150');
  const user = await resolveUser({ id: 3150 });
  await operators.beginInvite(user, new URL(link).searchParams.get('start')!.replace('inv_', ''));
  await operators.acceptContact(user, '+998901113150', 3150);
  const payment = await newPayment();
  await operators.removeOperator(String(user._id), admin);

  apiCalls.length = 0;
  await clickUpdate(3150, `pay:take:${payment._id}`);
  assert.equal(callsOf('answerCallbackQuery').at(-1)!.payload.show_alert, true);
  assert.equal((await Payment.findById(payment._id))?.status, 'new');
});

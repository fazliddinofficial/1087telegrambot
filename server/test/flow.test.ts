import { SUPER_ADMIN_ID, TEST_TOKEN } from './helpers/env';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, test } from 'node:test';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { createApp } from '../src/api/app';
import { runRemindersOnce } from '../src/jobs/reminders';
import { Invite } from '../src/models/Invite';
import { Payment } from '../src/models/Payment';
import { User } from '../src/models/User';
import type { Notifier } from '../src/services/notifier';
import { createOperatorService } from '../src/services/operators.service';
import { createPaymentService } from '../src/services/payments.service';
import { resolveUser } from '../src/services/users.service';
import { signInitData } from '../src/utils/telegramAuth';

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('sinov-chek-1')]);
const OTHER_JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('sinov-chek-2')]);

const calls: string[] = [];
const notifier: Notifier = {
  announce: async (p) => void calls.push(`announce:${p.number}`),
  sync: async (p) => void calls.push(`sync:${p.number}`),
  notifyDriver: async (p) => void calls.push(`driver:${p.number}:${p.status}`),
  remindNew: async (p) => void calls.push(`remindNew:${p.number}`),
  remindInProgress: async (p) => void calls.push(`remindInProgress:${p.number}`),
  operatorJoined: async (name) => void calls.push(`joined:${name}`),
  superAdminJoined: async (name) => void calls.push(`adminJoined:${name}`),
};

let mongod: MongoMemoryServer;
let server: Server;
let baseUrl: string;
let operators: ReturnType<typeof createOperatorService>;

async function call(telegramId: number, method: string, url: string, body?: unknown) {
  const initData = signInitData({ id: telegramId, first_name: `T${telegramId}` }, TEST_TOKEN);
  const res = await fetch(`${baseUrl}/api${url}`, {
    method,
    headers: { Authorization: `tma ${initData}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const isJson = res.headers.get('content-type')?.includes('json');
  return { status: res.status, data: (isJson ? await res.json() : await res.arrayBuffer()) as any };
}

async function pay(telegramId: number, amount: number, file: Buffer = JPEG) {
  const initData = signInitData({ id: telegramId }, TEST_TOKEN);
  const form = new FormData();
  form.set('amount', String(amount));
  form.set('receipt', new Blob([new Uint8Array(file)], { type: 'image/jpeg' }), 'chek.jpg');
  const res = await fetch(`${baseUrl}/api/payments`, {
    method: 'POST',
    headers: { Authorization: `tma ${initData}` },
    body: form,
  });
  return { status: res.status, data: (await res.json()) as any };
}

async function register(telegramId: number, phone: string, car = '01A123BC') {
  return call(telegramId, 'PUT', '/me/profile', { taxiId: `T${telegramId}`, name: `Haydovchi ${telegramId}`, phone, phoneConfirm: phone, carNumber: car });
}

/** Taklif havolasi orqali operator qiladi, xuddi botdagidek. */
async function makeOperator(telegramId: number, phone: string, name = `Operator ${telegramId}`) {
  const invite = await call(SUPER_ADMIN_ID, 'POST', '/admin/invites', { name, phone });
  assert.equal(invite.status, 201);
  const token = new URL(invite.data.link).searchParams.get('start')!.replace('inv_', '');
  const user = await resolveUser({ id: telegramId });
  await operators.beginInvite(user, token);
  await operators.acceptContact(user, phone, telegramId);
}

before(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  await Promise.all([User.init(), Payment.init(), Invite.init()]);
  const payments = createPaymentService(notifier);
  operators = createOperatorService(notifier, payments);
  server = createApp(payments, operators).listen(0);
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}, { timeout: 300_000 });

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await mongoose.disconnect();
  await mongod.stop();
});

test('imzosiz so\'rov rad etiladi', async () => {
  const res = await fetch(`${baseUrl}/api/me`);
  assert.equal(res.status, 401);
});

test('karta kiritilmaguncha to\'lov yuborib bo\'lmaydi, kartani faqat super admin o\'zgartiradi', async () => {
  await register(2001, '+998901112201');
  const blocked = await pay(2001, 50000);
  assert.equal(blocked.status, 409);
  assert.equal(blocked.data.code, 'NO_CARD');

  const asDriver = await call(2001, 'PUT', '/admin/card', { number: '8600123456789012', holder: 'Ali' });
  assert.equal(asDriver.status, 403);

  const bad = await call(SUPER_ADMIN_ID, 'PUT', '/admin/card', { number: '123', holder: 'Ali Valiyev' });
  assert.equal(bad.status, 400);

  const ok = await call(SUPER_ADMIN_ID, 'PUT', '/admin/card', { number: '8600 1234 5678 9012', holder: 'Ali Valiyev' });
  assert.equal(ok.status, 200);

  const seen = await call(2001, 'GET', '/card');
  assert.equal(seen.data.card.number, '8600123456789012');
});

test('ro\'yxatdan o\'tish tekshiruvlari', async () => {
  const mismatch = await call(2002, 'PUT', '/me/profile', {
    taxiId: 'V1', name: 'Vali', phone: '+998901112202', phoneConfirm: '+998901112209', carNumber: '01A123BC',
  });
  assert.equal(mismatch.data.code, 'PHONE_MISMATCH');
  const badCar = await call(2002, 'PUT', '/me/profile', {
    taxiId: 'V1', name: 'Vali', phone: '+998901112202', phoneConfirm: '+998901112202', carNumber: '1'.repeat(21),
  });
  assert.equal(badCar.data.code, 'BAD_CAR_NUMBER');
  const notRegistered = await pay(2002, 50000);
  assert.equal(notRegistered.data.code, 'NOT_REGISTERED');
});

test('super adminni ENV belgilaydi, oddiy foydalanuvchi admin yo\'liga kira olmaydi', async () => {
  const me = await call(SUPER_ADMIN_ID, 'GET', '/me');
  assert.equal(me.data.user.role, 'superadmin');
  const forbidden = await call(2001, 'GET', '/admin/payments');
  assert.equal(forbidden.status, 403);
});

test('taklif: boshqa raqam rol bermaydi, to\'g\'ri raqam beradi, havola qayta ishlamaydi', async () => {
  const invite = await call(SUPER_ADMIN_ID, 'POST', '/admin/invites', { name: 'Olim', phone: '+998901112300' });
  const token = new URL(invite.data.link).searchParams.get('start')!.replace('inv_', '');

  const stranger = await resolveUser({ id: 3999 });
  await operators.beginInvite(stranger, token);
  await assert.rejects(operators.acceptContact(stranger, '+998901112399', 3999), { code: 'PHONE_NOT_MATCH' });
  assert.equal((await User.findById(stranger._id))?.role, 'driver');

  const owner = await resolveUser({ id: 3001 });
  await operators.beginInvite(owner, token);
  // Boshqa birovning kontaktini yuborish ham o'tmaydi.
  await assert.rejects(operators.acceptContact(owner, '+998901112300', 7777), { code: 'FOREIGN_CONTACT' });
  await operators.acceptContact(owner, '998901112300', 3001);
  assert.equal((await User.findById(owner._id))?.role, 'operator');
  assert.ok(calls.includes('joined:Olim'));

  const late = await resolveUser({ id: 3998 });
  await assert.rejects(operators.beginInvite(late, token), { code: 'INVITE_INVALID' });
});

test('taklifni bekor qilish va yangi havola: eski havola ishlamaydi', async () => {
  const invite = await call(SUPER_ADMIN_ID, 'POST', '/admin/invites', { name: 'Karim', phone: '+998901112310' });
  const oldToken = new URL(invite.data.link).searchParams.get('start')!.replace('inv_', '');

  const dup = await call(SUPER_ADMIN_ID, 'POST', '/admin/invites', { name: 'Karim', phone: '+998901112310' });
  assert.equal(dup.data.code, 'INVITE_EXISTS');

  const reissued = await call(SUPER_ADMIN_ID, 'POST', `/admin/invites/${invite.data.id}/reissue`);
  assert.notEqual(reissued.data.link, invite.data.link);
  const someone = await resolveUser({ id: 3997 });
  await assert.rejects(operators.beginInvite(someone, oldToken), { code: 'INVITE_INVALID' });

  const revoked = await call(SUPER_ADMIN_ID, 'POST', `/admin/invites/${invite.data.id}/revoke`);
  assert.equal(revoked.status, 200);
  const newToken = new URL(reissued.data.link).searchParams.get('start')!.replace('inv_', '');
  await assert.rejects(operators.beginInvite(someone, newToken), { code: 'INVITE_INVALID' });
});

test('to\'liq oqim: to\'lov, poyga, tushirish, haydovchiga xabar', async () => {
  await makeOperator(3002, '+998901112302', 'Ikkinchi');
  const created = await pay(2001, 50000);
  assert.equal(created.status, 201);
  const id = created.data.payment.id;
  assert.ok(calls.includes(`announce:${created.data.payment.number}`));

  // Haydovchi xodim amalini bajara olmaydi va navbatni ko'ra olmaydi.
  assert.equal((await call(2001, 'POST', `/payments/${id}/take`)).status, 403);
  assert.equal((await call(2001, 'GET', '/payments/queue')).status, 403);

  // Ikki operator bir vaqtda bosadi: faqat bittasi oladi.
  const [a, b] = await Promise.all([
    call(3001, 'POST', `/payments/${id}/take`),
    call(3002, 'POST', `/payments/${id}/take`),
  ]);
  assert.deepEqual([a.status, b.status].sort(), [200, 409]);
  const winner = a.status === 200 ? 3001 : 3002;
  const loser = a.status === 200 ? 3002 : 3001;

  // Olmagan operator tushira olmaydi, super admin ham boshqa odamning to'lovini tushira olmaydi.
  assert.equal((await call(loser, 'POST', `/payments/${id}/complete`)).data.code, 'TAKEN_BY_OTHER');
  assert.equal((await call(SUPER_ADMIN_ID, 'POST', `/payments/${id}/complete`)).data.code, 'TAKEN_BY_OTHER');

  const done = await call(winner, 'POST', `/payments/${id}/complete`);
  assert.equal(done.status, 200);
  assert.equal(done.data.payment.status, 'completed');
  assert.ok(calls.includes(`driver:${done.data.payment.number}:completed`));

  // Ikki marta tushirib bo'lmaydi.
  assert.equal((await call(winner, 'POST', `/payments/${id}/complete`)).data.code, 'ALREADY_COMPLETED');

  // Haydovchi natijani ko'radi, lekin xodim ma'lumotini emas.
  const mine = await call(2001, 'GET', '/payments/mine');
  assert.equal(mine.data.items[0].status, 'completed');
  assert.equal(mine.data.items[0].finishedByName, undefined);
  assert.equal(mine.data.items[0].events, undefined);
});

test('rad etish sababsiz bo\'lmaydi, rad etilganda sabab haydovchiga ko\'rinadi', async () => {
  const created = await pay(2001, 60000, OTHER_JPEG);
  const id = created.data.payment.id;
  // Olmay turib rad etib bo'lmaydi.
  assert.equal((await call(3001, 'POST', `/payments/${id}/reject`, { reason: 'x' })).data.code, 'NOT_TAKEN');
  await call(3001, 'POST', `/payments/${id}/take`);
  assert.equal((await call(3001, 'POST', `/payments/${id}/reject`, { reason: '  ' })).status, 400);
  const rejected = await call(3001, 'POST', `/payments/${id}/reject`, { reason: 'Pul tushmagan' });
  assert.equal(rejected.data.payment.status, 'rejected');
  const mine = await call(2001, 'GET', '/payments/mine');
  assert.equal(mine.data.items[0].rejectionReason, 'Pul tushmagan');
});

test('bir xil chek qayta yuborilsa xodimga ogohlantirish chiqadi', async () => {
  const first = await Payment.findOne({ 'driverInfo.telegramId': 2001 }).sort({ number: 1 });
  const again = await pay(2001, 50000);
  const queue = await call(3001, 'GET', '/payments/queue');
  const item = queue.data.items.find((p: any) => p.id === again.data.payment.id);
  assert.equal(item.duplicateOfNumber, first?.number);
  await call(3001, 'POST', `/payments/${item.id}/take`);
  await call(3001, 'POST', `/payments/${item.id}/complete`);
});

test('noto\'g\'ri fayl, summa va ochiq so\'rovlar chegarasi', async () => {
  assert.equal((await pay(2001, 50000, Buffer.from('<script>alert(1)</script>'))).data.code, 'BAD_RECEIPT');
  assert.equal((await pay(2001, 10)).data.code, 'BAD_AMOUNT');
  assert.equal((await pay(2001, 1000.5)).data.code, 'BAD_AMOUNT');

  await register(2003, '+998901112203', '01B456CD');
  const opened = [];
  for (let i = 0; i < 3; i++) opened.push((await pay(2003, 10000 + i)).data.payment.id);
  assert.equal((await pay(2003, 20000)).data.code, 'TOO_MANY_OPEN');

  // Keyingi testlar uchun tozalash.
  for (const id of opened) {
    await call(3001, 'POST', `/payments/${id}/take`);
    await call(3001, 'POST', `/payments/${id}/reject`, { reason: 'Sinov' });
  }
});

test('chekni faqat egasi va xodimlar ko\'ra oladi', async () => {
  const created = await pay(2003, 15000);
  const id = created.data.payment.id;
  assert.equal((await call(2003, 'GET', `/payments/${id}/receipt`)).status, 200);
  assert.equal((await call(3001, 'GET', `/payments/${id}/receipt`)).status, 200);
  await register(2004, '+998901112204', '01C789EF');
  assert.equal((await call(2004, 'GET', `/payments/${id}/receipt`)).status, 404);
  await call(3001, 'POST', `/payments/${id}/take`);
  await call(3001, 'POST', `/payments/${id}/reject`, { reason: 'Sinov' });
});

test('operatorni o\'chirish: huquq darhol yo\'qoladi, to\'lov qaytadi, tarix qoladi', async () => {
  await makeOperator(3003, '+998901112303', 'Uchinchi');
  const completed = await pay(2004, 30000, Buffer.concat([JPEG, Buffer.from('c')]));
  await call(3003, 'POST', `/payments/${completed.data.payment.id}/take`);
  await call(3003, 'POST', `/payments/${completed.data.payment.id}/complete`);

  const held = await pay(2004, 40000, Buffer.concat([JPEG, Buffer.from('d')]));
  const heldId = held.data.payment.id;
  await call(3003, 'POST', `/payments/${heldId}/take`);

  const list = await call(SUPER_ADMIN_ID, 'GET', '/admin/operators');
  const entry = list.data.operators.find((o: any) => o.name === 'Uchinchi');
  assert.equal(entry.inProgress, 1);
  assert.equal(entry.completedCount, 1);
  assert.equal(entry.completedSum, 30000);
  assert.equal(entry.todayCount, 1);

  const removed = await call(SUPER_ADMIN_ID, 'DELETE', `/admin/operators/${entry.id}`);
  assert.equal(removed.data.released, 1);

  // Butunlay o'chadi: bazada ham, ro'yxatda ham qolmaydi.
  assert.equal(await User.exists({ telegramId: 3003 }), null);
  const after = await call(SUPER_ADMIN_ID, 'GET', '/admin/operators');
  assert.equal(after.data.operators.find((o: any) => o.name === 'Uchinchi'), undefined);

  // To'lovlar tarixida ism saqlanib qoladi.
  const history = await call(SUPER_ADMIN_ID, 'GET', `/admin/payments?q=${completed.data.payment.number}`);
  const old = history.data.items.find((p: any) => p.id === completed.data.payment.id);
  assert.equal(old.status, 'completed');
  assert.equal(old.finishedByName, 'Uchinchi');
  assert.ok(old.events.some((e: any) => e.action === 'completed' && e.actorName === 'Uchinchi'));

  assert.equal((await call(3003, 'GET', '/payments/queue')).status, 403);
  assert.equal((await call(3003, 'POST', `/payments/${heldId}/complete`)).status, 403);

  const queue = await call(3001, 'GET', '/payments/queue');
  const returned = queue.data.items.find((p: any) => p.id === heldId);
  assert.equal(returned.status, 'new');
  assert.equal(returned.takenByName, undefined);

  await call(3001, 'POST', `/payments/${heldId}/take`);
  await call(3001, 'POST', `/payments/${heldId}/reject`, { reason: 'Sinov' });
});

test('avval haydovchi bo\'lgan operator o\'chirilsa, haydovchi profili va to\'lovlari qoladi; qayta taklif ishlaydi', async () => {
  await register(2080, '+998901112280', '01D808DD');
  const paid = await pay(2080, 21000, Buffer.concat([JPEG, Buffer.from('op-driver')]));
  await call(3001, 'POST', `/payments/${paid.data.payment.id}/take`);
  await call(3001, 'POST', `/payments/${paid.data.payment.id}/complete`);

  await makeOperator(2080, '+998901112281', 'Sobiq Haydovchi');
  const list = await call(SUPER_ADMIN_ID, 'GET', '/admin/operators');
  const entry = list.data.operators.find((o: any) => o.name === 'Sobiq Haydovchi');
  await call(SUPER_ADMIN_ID, 'DELETE', `/admin/operators/${entry.id}`);

  const user = await User.findOne({ telegramId: 2080 });
  assert.equal(user?.role, 'driver');
  assert.equal(user?.phone, '+998901112280');
  assert.equal(user?.staffName, undefined);
  assert.equal(user?.staffPhone, undefined);
  assert.equal((await call(2080, 'GET', '/payments/mine')).data.items[0].status, 'completed');

  // Ro'yxatda ham, haydovchilar orasida ham to'g'ri ko'rinadi, ikkinchi marta o'chirib bo'lmaydi.
  const again = await call(SUPER_ADMIN_ID, 'GET', '/admin/operators');
  assert.equal(again.data.operators.find((o: any) => o.name === 'Sobiq Haydovchi'), undefined);
  assert.equal((await call(SUPER_ADMIN_ID, 'DELETE', `/admin/operators/${entry.id}`)).status, 404);

  // O'chirilgan raqamga yangi taklif yuborish mumkin.
  await makeOperator(2081, '+998901112281', 'Qaytgan Operator');
  const back = await call(SUPER_ADMIN_ID, 'GET', '/admin/operators');
  assert.ok(back.data.operators.some((o: any) => o.name === 'Qaytgan Operator'));
});

test('super admin to\'xtab qolgan to\'lovni qaytaradi va o\'zi tasdiqlay oladi', async () => {
  const created = await pay(2004, 45000, Buffer.concat([JPEG, Buffer.from('e')]));
  const id = created.data.payment.id;
  await call(3001, 'POST', `/payments/${id}/take`);
  assert.equal((await call(3001, 'POST', `/admin/payments/${id}/release`)).status, 403);

  const released = await call(SUPER_ADMIN_ID, 'POST', `/admin/payments/${id}/release`);
  assert.equal(released.data.payment.status, 'new');
  assert.equal((await call(SUPER_ADMIN_ID, 'POST', `/admin/payments/${id}/release`)).data.code, 'NOT_IN_PROGRESS');

  await call(SUPER_ADMIN_ID, 'POST', `/payments/${id}/take`);
  const done = await call(SUPER_ADMIN_ID, 'POST', `/payments/${id}/complete`);
  assert.equal(done.data.payment.status, 'completed');

  const actions = done.data.payment.events.map((e: any) => e.action);
  assert.deepEqual(actions, ['created', 'taken', 'released', 'taken', 'completed']);
});

test('hisobot: filtrlar va jami summalar', async () => {
  const all = await call(SUPER_ADMIN_ID, 'GET', '/admin/payments?limit=100');
  assert.ok(all.data.total >= 5);
  assert.ok(all.data.totals.completedSum > 0);

  const byCar = await call(SUPER_ADMIN_ID, 'GET', '/admin/payments?q=01C789');
  assert.ok(byCar.data.items.length > 0);
  assert.ok(byCar.data.items.every((p: any) => p.driverInfo.carNumber === '01C789EF'));

  const byPhone = await call(SUPER_ADMIN_ID, 'GET', `/admin/payments?q=${encodeURIComponent('+998 90 111 22 04')}`);
  assert.ok(byPhone.data.items.length > 0);
  assert.ok(byPhone.data.items.every((p: any) => p.driverInfo.phone === '+998901112204'));

  const rejected = await call(SUPER_ADMIN_ID, 'GET', '/admin/payments?status=rejected');
  assert.ok(rejected.data.items.every((p: any) => p.status === 'rejected'));

  const list = await call(SUPER_ADMIN_ID, 'GET', '/admin/operators');
  const op = list.data.operators.find((o: any) => o.name === 'Olim');
  const byOperator = await call(SUPER_ADMIN_ID, 'GET', `/admin/payments?operatorId=${op.id}&q=01C789`);
  assert.equal(byOperator.status, 200);

  const future = await call(SUPER_ADMIN_ID, 'GET', '/admin/payments?from=2099-01-01');
  assert.equal(future.data.total, 0);
  assert.equal((await call(SUPER_ADMIN_ID, 'GET', '/admin/payments?from=xato')).status, 400);

  // Regexp maxsus belgilari xato bermaydi.
  assert.equal((await call(SUPER_ADMIN_ID, 'GET', `/admin/payments?q=${encodeURIComponent('(.*')}`)).status, 200);
});

test('eslatma vaqti o\'tgan to\'lov uchun bir marta ketadi', async () => {
  const created = await pay(2004, 47000, Buffer.concat([JPEG, Buffer.from('f')]));
  const number = created.data.payment.number;
  await Payment.collection.updateOne({ number }, { $set: { createdAt: new Date(Date.now() - 11 * 60 * 1000) } });

  await runRemindersOnce(notifier);
  await runRemindersOnce(notifier);
  assert.equal(calls.filter((c) => c === `remindNew:${number}`).length, 1);

  const id = created.data.payment.id;
  await call(3001, 'POST', `/payments/${id}/take`);
  await Payment.updateOne({ number }, { $set: { lastReminderAt: new Date(Date.now() - 31 * 60 * 1000) } });
  await runRemindersOnce(notifier);
  assert.equal(calls.filter((c) => c === `remindInProgress:${number}`).length, 1);
});

test('haydovchi ID raqami: majburiy, saqlanadi, chekda ko\'rinadi va u orqali topiladi', async () => {
  // ID yo'q forma qabul qilinmaydi.
  const missing = await call(2050, 'PUT', '/me/profile', {
    name: 'Id Sinov', phone: '+998901112250', phoneConfirm: '+998901112250', carNumber: '01X111YY',
  });
  assert.equal(missing.status, 400);
  const tooLong = await call(2050, 'PUT', '/me/profile', {
    taxiId: '1'.repeat(21), name: 'Id Sinov', phone: '+998901112250', phoneConfirm: '+998901112250', carNumber: '01X111YY',
  });
  assert.equal(tooLong.data.code, 'BAD_TAXI_ID');

  const saved = await call(2050, 'PUT', '/me/profile', {
    taxiId: ' ab 77 ', name: 'Id Sinov', phone: '+998901112250', phoneConfirm: '+998901112250', carNumber: '01X111YY',
  });
  assert.equal(saved.data.user.taxiId, 'AB77');
  assert.equal(saved.data.user.registered, true);

  const created = await pay(2050, 51000, Buffer.concat([JPEG, Buffer.from('id')]));
  const queue = await call(3001, 'GET', '/payments/queue');
  const item = queue.data.items.find((p: any) => p.id === created.data.payment.id);
  assert.equal(item.driverInfo.taxiId, 'AB77');

  // Haydovchining o'ziga ichki ma'lumot baribir ko'rinmaydi.
  assert.equal(created.data.payment.driverInfo, undefined);

  const found = await call(SUPER_ADMIN_ID, 'GET', '/admin/payments?q=ab77');
  assert.equal(found.data.items[0].driverInfo.taxiId, 'AB77');

  // ID qo'shilishidan oldin yozilgan haydovchi: forma qayta chiqadi, to'lov yuborolmaydi.
  await call(2051, 'GET', '/me');
  await User.updateOne(
    { telegramId: 2051 },
    { $set: { name: 'Eski', phone: '+998901112251', carNumber: '01Z222ZZ', registeredAt: new Date() } },
  );
  assert.equal((await call(2051, 'GET', '/me')).data.user.registered, false);
  assert.equal((await pay(2051, 52000, Buffer.concat([JPEG, Buffer.from('eski')]))).data.code, 'NOT_REGISTERED');

  await call(3001, 'POST', `/payments/${item.id}/take`);
  await call(3001, 'POST', `/payments/${item.id}/complete`);
});

test('haydovchilar ro\'yxati: faqat super admin, faqat ro\'yxatdan o\'tganlar, ko\'rsatkichlar va qidiruv', async () => {
  assert.equal((await call(2001, 'GET', '/admin/drivers')).status, 403);
  assert.equal((await call(3001, 'GET', '/admin/drivers')).status, 403);

  // Faqat /me qilgan, ro'yxatdan o'tmagan foydalanuvchi chiqmaydi.
  await call(2070, 'GET', '/me');
  await call(2071, 'PUT', '/me/profile', {
    taxiId: 'dr71', name: 'Ro\'yxat Sinov', phone: '+998901112271', phoneConfirm: '+998901112271', carNumber: '01R777RR',
  });

  const paid = await pay(2071, 33000, Buffer.concat([JPEG, Buffer.from('dr1')]));
  await call(3001, 'POST', `/payments/${paid.data.payment.id}/take`);
  await call(3001, 'POST', `/payments/${paid.data.payment.id}/complete`);
  await pay(2071, 34000, Buffer.concat([JPEG, Buffer.from('dr2')]));

  const all = await call(SUPER_ADMIN_ID, 'GET', '/admin/drivers?limit=100');
  assert.equal(all.status, 200);
  const telegramIds = (await User.find({ _id: { $in: all.data.items.map((d: any) => d.id) } })).map((u) => u.telegramId);
  assert.ok(!telegramIds.includes(2070), "ro'yxatdan o'tmagan chiqmasligi kerak");
  assert.ok(!telegramIds.includes(3001), 'operator chiqmasligi kerak');
  assert.ok(!telegramIds.includes(SUPER_ADMIN_ID), 'super admin chiqmasligi kerak');

  const entry = all.data.items.find((d: any) => d.taxiId === 'DR71');
  assert.equal(entry.name, "Ro'yxat Sinov");
  assert.equal(entry.phone, '+998901112271');
  assert.equal(entry.carNumber, '01R777RR');
  assert.equal(entry.completedCount, 1);
  assert.equal(entry.completedSum, 33000);
  assert.equal(entry.openCount, 1);
  assert.ok(entry.lastPaymentAt);

  for (const q of ['dr71', '+998 90 111 22 71', '01r777', "Ro'yxat"]) {
    const found = await call(SUPER_ADMIN_ID, 'GET', `/admin/drivers?q=${encodeURIComponent(q)}`);
    assert.ok(found.data.items.some((d: any) => d.taxiId === 'DR71'), `topilmadi: ${q}`);
  }
  const none = await call(SUPER_ADMIN_ID, 'GET', '/admin/drivers?q=mavjud-emas-xyz');
  assert.equal(none.data.total, 0);
  assert.equal((await call(SUPER_ADMIN_ID, 'GET', `/admin/drivers?q=${encodeURIComponent('(.*')}`)).status, 200);

  const openId = (await call(3001, 'GET', '/payments/queue')).data.items.find((p: any) => p.driverInfo.taxiId === 'DR71').id;
  await call(3001, 'POST', `/payments/${openId}/take`);
  await call(3001, 'POST', `/payments/${openId}/reject`, { reason: 'Sinov' });
});

test('karta o\'zgarsa eski to\'lov eski kartani saqlaydi', async () => {
  const before = await pay(2004, 48000, Buffer.concat([JPEG, Buffer.from('g')]));
  await call(SUPER_ADMIN_ID, 'PUT', '/admin/card', { number: '9860123456789012', holder: 'Yangi Egasi' });
  const after = await pay(2004, 49000, Buffer.concat([JPEG, Buffer.from('h')]));
  assert.equal(before.data.payment.card.number, '8600123456789012');
  assert.equal(after.data.payment.card.number, '9860123456789012');
  const history = await call(SUPER_ADMIN_ID, 'GET', '/admin/card');
  assert.equal(history.data.history[0].number, '9860123456789012');
  assert.equal(history.data.history.length, 2);
});

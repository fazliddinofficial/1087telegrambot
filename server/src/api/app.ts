import { existsSync } from 'node:fs';
import path from 'node:path';
import express, { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { config } from '../config/env';
import { getCard, getCardHistory, setCard } from '../services/card.service';
import type { OperatorService } from '../services/operators.service';
import { REJECTION_REASON_MAX, PaymentService, receiptPath } from '../services/payments.service';
import { listDrivers, listHandledBy, listMine, listPayments, listQueue } from '../services/reports.service';
import { saveDriverProfile } from '../services/users.service';
import { AppError } from '../utils/errors';
import { authenticate, currentUser, errorHandler, requireRole } from './middleware';
import { serializePayment, serializeUser } from './serialize';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1 } });

const profileSchema = z.object({
  taxiId: z.string().trim().min(1, 'Haydovchi ID raqamingizni kiriting'),
  name: z.string().trim().min(2, 'Ismingizni kiriting').max(60, 'Ism juda uzun'),
  phone: z.string().trim().min(1, 'Telefon raqamini kiriting'),
  phoneConfirm: z.string().trim().min(1, 'Telefon raqamini qayta kiriting'),
  carNumber: z.string().trim().min(1, 'Mashina raqamini kiriting'),
});
const rejectSchema = z.object({
  reason: z.string().trim().min(1, 'Rad etish sababini yozing').max(REJECTION_REASON_MAX, 'Sabab juda uzun'),
});
const cardSchema = z.object({
  number: z.string().trim().min(1, 'Karta raqamini kiriting'),
  holder: z.string().trim().min(2, 'Karta egasining ismini kiriting').max(60, 'Ism juda uzun'),
});
const inviteSchema = z.object({
  name: z.string().trim().min(2, 'Operator ismini kiriting').max(60, 'Ism juda uzun'),
  phone: z.string().trim().min(1, 'Telefon raqamini kiriting'),
});
const reportSchema = z.object({
  status: z.enum(['new', 'in_progress', 'completed', 'rejected']).optional(),
  operatorId: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  q: z.string().max(60).optional(),
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().optional(),
});

function deviceFrom(userAgent = ''): string {
  if (/iPhone|iPad/i.test(userAgent)) return 'iOS';
  if (/Android/i.test(userAgent)) return 'Android';
  if (/Macintosh/i.test(userAgent)) return 'Mac';
  if (/Windows/i.test(userAgent)) return 'Windows';
  return 'boshqa';
}

const driversSchema = z.object({
  q: z.string().max(60).optional(),
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().optional(),
});

export function createApp(payments: PaymentService, operators: OperatorService, options: { logRequests?: boolean } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  // Muammoni qurilma bo'yicha aniqlash uchun. initData va boshqa maxfiy ma'lumot yozilmaydi.
  if (options.logRequests) {
    app.use((req, res, next) => {
      const startedAt = Date.now();
      const path = req.originalUrl.split('?')[0];
      res.on('finish', () => {
        console.log(`[so'rov] ${deviceFrom(req.headers['user-agent'])} ${req.method} ${path} ${res.statusCode} ${Date.now() - startedAt}ms`);
      });
      next();
    });
  }

  app.use(express.json({ limit: '32kb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

  const api = Router();
  api.use(authenticate);

  // --- Foydalanuvchi ---
  // Karta shu yerda birga beriladi: haydovchi sahifasi ochilishida alohida so'rov kutilmaydi.
  api.get('/me', async (_req, res) => {
    res.json({
      user: serializeUser(currentUser(res)),
      limits: { minAmount: config.MIN_AMOUNT, maxAmount: config.MAX_AMOUNT },
      card: await getCard(),
    });
  });

  api.put('/me/profile', async (req, res) => {
    const user = await saveDriverProfile(currentUser(res), profileSchema.parse(req.body));
    res.json({ user: serializeUser(user) });
  });

  api.get('/card', async (_req, res) => {
    res.json({ card: await getCard() });
  });

  // --- To'lovlar ---
  api.post('/payments', requireRole('driver'), upload.single('receipt'), async (req, res) => {
    const amount = Number(req.body?.amount);
    const payment = await payments.create(currentUser(res), amount, req.file?.buffer);
    res.status(201).json({ payment: serializePayment(payment, 'driver') });
  });

  api.get('/payments/mine', requireRole('driver'), async (_req, res) => {
    const items = await listMine(currentUser(res));
    res.json({ items: items.map((p) => serializePayment(p, 'driver')) });
  });

  api.get('/payments/queue', requireRole('operator', 'superadmin'), async (_req, res) => {
    const role = currentUser(res).role;
    const items = await listQueue();
    res.json({ items: items.map((p) => serializePayment(p, role)) });
  });

  api.get('/payments/handled', requireRole('operator', 'superadmin'), async (_req, res) => {
    const user = currentUser(res);
    const items = await listHandledBy(user);
    res.json({ items: items.map((p) => serializePayment(p, user.role)) });
  });

  api.get('/payments/:id/receipt', async (req, res) => {
    const payment = await payments.getForViewer(req.params.id, currentUser(res));
    const file = receiptPath(payment.receipt.fileName);
    if (!existsSync(file)) throw new AppError(404, 'RECEIPT_MISSING', 'Chek fayli topilmadi');
    res.set({
      'Content-Type': payment.receipt.mime,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, max-age=86400',
    });
    res.sendFile(file);
  });

  api.post('/payments/:id/take', requireRole('operator', 'superadmin'), async (req, res) => {
    const user = currentUser(res);
    res.json({ payment: serializePayment(await payments.take(req.params.id as string, user), user.role) });
  });

  api.post('/payments/:id/complete', requireRole('operator', 'superadmin'), async (req, res) => {
    const user = currentUser(res);
    res.json({ payment: serializePayment(await payments.complete(req.params.id as string, user), user.role) });
  });

  api.post('/payments/:id/reject', requireRole('operator', 'superadmin'), async (req, res) => {
    const user = currentUser(res);
    const { reason } = rejectSchema.parse(req.body);
    res.json({ payment: serializePayment(await payments.reject(req.params.id as string, user, reason), user.role) });
  });

  // --- Super admin ---
  const admin = Router();
  admin.use(requireRole('superadmin'));

  admin.post('/payments/:id/release', async (req, res) => {
    const user = currentUser(res);
    const payment = await payments.release(req.params.id as string, user);
    res.json({ payment: serializePayment(payment, user.role) });
  });

  admin.get('/payments', async (req, res) => {
    const result = await listPayments(reportSchema.parse(req.query));
    res.json({ ...result, items: result.items.map((p) => serializePayment(p, 'superadmin')) });
  });

  admin.get('/drivers', async (req, res) => {
    res.json(await listDrivers(driversSchema.parse(req.query)));
  });

  admin.get('/operators', async (_req, res) => {
    res.json(await operators.list());
  });

  admin.post('/invites', async (req, res) => {
    const { name, phone } = inviteSchema.parse(req.body);
    const { invite, link } = await operators.createInvite(currentUser(res), name, phone);
    res.status(201).json({ id: String(invite._id), link, expiresAt: invite.expiresAt });
  });

  admin.post('/invites/:id/reissue', async (req, res) => {
    const { invite, link } = await operators.reissueInvite(req.params.id as string);
    res.json({ id: String(invite._id), link, expiresAt: invite.expiresAt });
  });

  admin.post('/invites/:id/revoke', async (req, res) => {
    await operators.revokeInvite(req.params.id as string);
    res.json({ ok: true });
  });

  admin.delete('/operators/:id', async (req, res) => {
    const { released } = await operators.removeOperator(req.params.id as string, currentUser(res));
    res.json({ released });
  });

  admin.get('/card', async (_req, res) => {
    const [card, history] = await Promise.all([getCard(), getCardHistory()]);
    res.json({
      card,
      history: history.map((h) => ({
        number: h.number,
        holder: h.holder,
        changedByName: h.changedByName,
        at: h.at,
      })),
    });
  });

  admin.put('/card', async (req, res) => {
    const { number, holder } = cardSchema.parse(req.body);
    res.json({ card: await setCard(currentUser(res), number, holder) });
  });

  api.use('/admin', admin);
  app.use('/api', api);

  app.use('/api', (_req, _res) => {
    throw new AppError(404, 'NOT_FOUND', 'Manzil topilmadi');
  });

  // Mini App va API bitta manzildan xizmat qiladi.
  const webappDist = path.resolve(__dirname, '../../../webapp/dist');
  if (existsSync(webappDist)) {
    // Fayl nomida xesh bor, shuning uchun u o'zgarmaydi: qayta ochilganda telefon internetdan so'ramaydi.
    app.use('/assets', express.static(path.join(webappDist, 'assets'), { immutable: true, maxAge: '1y' }));
    // index.html esa har safar tekshiriladi: yangi versiya chiqqanda eski kod qolib ketmaydi.
    const noCacheHtml = { cacheControl: false, headers: { 'Cache-Control': 'no-cache' } };
    app.use(
      express.static(webappDist, {
        cacheControl: false,
        setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache'),
      }),
    );
    app.get(/.*/, (_req, res) => {
      res.sendFile(path.join(webappDist, 'index.html'), noCacheHtml);
    });
  }

  app.use(errorHandler);
  return app;
}

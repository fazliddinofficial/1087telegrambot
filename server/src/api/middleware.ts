import type { ErrorRequestHandler, NextFunction, Request, RequestHandler, Response } from 'express';
import multer from 'multer';
import { ZodError } from 'zod';
import { config } from '../config/env';
import type { Role, UserDoc } from '../models/User';
import { resolveUser } from '../services/users.service';
import { AppError } from '../utils/errors';
import { verifyInitData } from '../utils/telegramAuth';

export function currentUser(res: Response): UserDoc {
  return res.locals.user as UserDoc;
}

/** Har bir so'rovda imzo tekshiriladi va rol bazadan o'qiladi: o'chirilgan operator darhol huquqini yo'qotadi. */
export const authenticate: RequestHandler = async (req, res, next) => {
  const header = req.headers.authorization ?? '';
  const initData = header.startsWith('tma ') ? header.slice(4) : '';
  const identity = initData ? verifyInitData(initData, config.BOT_TOKEN) : null;
  if (!identity) {
    throw new AppError(401, 'UNAUTHORIZED', 'Ilovani Telegram ichidan qayta oching');
  }
  res.locals.user = await resolveUser(identity);
  next();
};

export function requireRole(...roles: Role[]): RequestHandler {
  return (_req: Request, res: Response, next: NextFunction) => {
    if (!roles.includes(currentUser(res).role)) {
      throw new AppError(403, 'FORBIDDEN', "Bu amal uchun ruxsat yo'q");
    }
    next();
  };
}

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof AppError) {
    res.status(err.status).json({ error: err.message, code: err.code });
    return;
  }
  if (err instanceof ZodError) {
    res.status(400).json({ error: err.issues[0]?.message ?? "Ma'lumot noto'g'ri", code: 'VALIDATION' });
    return;
  }
  if (err instanceof multer.MulterError) {
    const message = err.code === 'LIMIT_FILE_SIZE' ? 'Rasm hajmi 5 MB dan oshmasin' : 'Faylni yuklab bo\'lmadi';
    res.status(400).json({ error: message, code: 'UPLOAD_ERROR' });
    return;
  }
  console.error('[api]', err);
  res.status(500).json({ error: 'Serverda xatolik yuz berdi', code: 'INTERNAL' });
};

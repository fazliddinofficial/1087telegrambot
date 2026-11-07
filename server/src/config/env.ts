import { existsSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { normalizePhone } from '../utils/normalize';

// Lokal ishga tushirishda sozlamalar loyiha ildizidagi .env dan o'qiladi.
// Docker'da ular compose orqali keladi va fayl bo'lmaydi.
const envFile = path.resolve(__dirname, '../../../.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

const schema = z.object({
  NODE_ENV: z.string().default('development'),
  PORT: z.coerce.number().int().positive().default(4020),
  BOT_TOKEN: z.string().min(1, 'BOT_TOKEN kiritilmagan'),
  BOT_USERNAME: z.string().min(1, 'BOT_USERNAME kiritilmagan').transform((v) => v.replace(/^@/, '')),
  BOT_POLLING: z
    .string()
    .default('true')
    .transform((v) => v !== 'false'),
  SUPER_ADMIN_IDS: z
    .string()
    .default('')
    .transform((v) =>
      v
        .split(',')
        .map((s) => Number(s.trim()))
        .filter((n) => Number.isSafeInteger(n) && n > 0),
    ),
  SUPER_ADMIN_PHONES: z
    .string()
    .default('')
    .transform((v, ctx) => {
      const phones: string[] = [];
      for (const item of v.split(',').map((s) => s.trim()).filter(Boolean)) {
        const phone = normalizePhone(item);
        if (phone) phones.push(phone);
        else ctx.addIssue({ code: 'custom', message: `telefon raqami noto'g'ri: ${item}` });
      }
      return phones;
    }),
  WEBAPP_URL: z.string().url('WEBAPP_URL to\'g\'ri manzil emas'),
  MONGO_URI: z.string().min(1, 'MONGO_URI kiritilmagan'),
  UPLOAD_DIR: z.string().default(path.resolve(__dirname, '../../uploads')),
  MIN_AMOUNT: z.coerce.number().int().positive().default(1000),
  MAX_AMOUNT: z.coerce.number().int().positive().default(20_000_000),
  MAX_OPEN_PAYMENTS: z.coerce.number().int().positive().default(3),
  INVITE_TTL_HOURS: z.coerce.number().int().positive().default(24),
  REMIND_NEW_MINUTES: z.coerce.number().int().positive().default(10),
  REMIND_IN_PROGRESS_MINUTES: z.coerce.number().int().positive().default(30),
}).refine((env) => env.SUPER_ADMIN_IDS.length > 0 || env.SUPER_ADMIN_PHONES.length > 0, {
  path: ['SUPER_ADMIN_PHONES'],
  message: 'kamida bitta super admin telefoni yoki ID si kerak',
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  for (const issue of parsed.error.issues) {
    console.error(`Sozlama xatosi: ${issue.path.join('.')}: ${issue.message}`);
  }
  process.exit(1);
}

export const config = parsed.data;

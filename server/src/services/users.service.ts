import { config } from '../config/env';
import { User, UserDoc } from '../models/User';
import { AppError } from '../utils/errors';
import { CAR_NUMBER_MAX, TAXI_ID_MAX, normalizeCarNumber, normalizePhone, normalizeTaxiId } from '../utils/normalize';

export interface TelegramIdentity {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
}

/** Super admin faqat server sozlamasidan belgilanadi: ID yoki Telegram tasdiqlagan telefon raqami. */
function isConfiguredSuperAdmin(user: UserDoc): boolean {
  return (
    config.SUPER_ADMIN_IDS.includes(user.telegramId) ||
    (Boolean(user.verifiedPhone) && config.SUPER_ADMIN_PHONES.includes(user.verifiedPhone!))
  );
}

/**
 * Telegram foydalanuvchisini bazadan topadi yoki yaratadi.
 * Sozlamadagi ro'yxatdan chiqarilgan super admin huquqini darhol yo'qotadi.
 */
export async function resolveUser(identity: TelegramIdentity): Promise<UserDoc> {
  const telegramName = [identity.first_name, identity.last_name].filter(Boolean).join(' ') || undefined;

  const user = await User.findOneAndUpdate(
    { telegramId: identity.id },
    {
      $set: { telegramName, username: identity.username },
      $setOnInsert: { role: 'driver' },
    },
    { upsert: true, returnDocument: 'after' },
  );

  const isSuperAdmin = isConfiguredSuperAdmin(user);
  if (isSuperAdmin && user.role !== 'superadmin') {
    user.role = 'superadmin';
    await user.save();
  } else if (!isSuperAdmin && user.role === 'superadmin') {
    user.role = 'driver';
    await user.save();
  }
  return user;
}

export interface DriverProfileInput {
  taxiId: string;
  name: string;
  phone: string;
  phoneConfirm: string;
  carNumber: string;
}

/** Haydovchini ro'yxatdan o'tkazadi yoki profilini yangilaydi. */
export async function saveDriverProfile(user: UserDoc, input: DriverProfileInput): Promise<UserDoc> {
  if (user.role !== 'driver') {
    throw new AppError(403, 'NOT_DRIVER', 'Bu amal faqat haydovchilar uchun');
  }
  const taxiId = normalizeTaxiId(input.taxiId);
  if (!taxiId) throw new AppError(400, 'BAD_TAXI_ID', `Haydovchi ID raqamingizni kiriting (${TAXI_ID_MAX} belgigacha)`);
  const phone = normalizePhone(input.phone);
  if (!phone) throw new AppError(400, 'BAD_PHONE', "Telefon raqami noto'g'ri. Namuna: +998901234567");
  if (normalizePhone(input.phoneConfirm) !== phone) {
    throw new AppError(400, 'PHONE_MISMATCH', 'Telefon raqamlari bir xil emas');
  }
  const carNumber = normalizeCarNumber(input.carNumber);
  if (!carNumber) {
    throw new AppError(400, 'BAD_CAR_NUMBER', `Mashina raqamini kiriting (${CAR_NUMBER_MAX} belgigacha)`);
  }

  user.taxiId = taxiId;
  user.name = input.name;
  user.phone = phone;
  user.carNumber = carNumber;
  user.registeredAt ??= new Date();
  await user.save();
  return user;
}

/** To'lov xabarlarini oladigan barcha xodimlar. */
export function listStaff(): Promise<UserDoc[]> {
  return User.find({ role: { $in: ['operator', 'superadmin'] } });
}

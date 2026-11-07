import { HydratedDocument, Schema, Types, model } from 'mongoose';

export type Role = 'driver' | 'operator' | 'superadmin';

export interface IUser {
  telegramId: number;
  telegramName?: string;
  username?: string;
  role: Role;
  // Haydovchi ma'lumotlari: ID va telefon taksi dasturidagi qiymatlar, shuning uchun qo'lda kiritiladi.
  taxiId?: string;
  name?: string;
  phone?: string;
  carNumber?: string;
  registeredAt?: Date;
  // Operator ma'lumotlari: haydovchi profilini buzmaslik uchun alohida saqlanadi.
  staffName?: string;
  staffPhone?: string;
  operatorJoinedAt?: Date;
  // Telegram orqali tasdiqlangan raqam: super admin ro'yxati bilan shu solishtiriladi.
  verifiedPhone?: string;
  // Bot suhbatidagi kutilayotgan qadamlar: server qayta ishga tushsa ham yo'qolmaydi.
  pendingAdminClaim?: boolean;
  pendingInviteId?: Types.ObjectId;
  pendingRejectPaymentId?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

export type UserDoc = HydratedDocument<IUser>;

const userSchema = new Schema<IUser>(
  {
    telegramId: { type: Number, required: true, unique: true },
    telegramName: String,
    username: String,
    role: { type: String, enum: ['driver', 'operator', 'superadmin'], default: 'driver', index: true },
    taxiId: String,
    name: String,
    phone: String,
    carNumber: String,
    registeredAt: Date,
    staffName: String,
    staffPhone: String,
    operatorJoinedAt: Date,
    verifiedPhone: String,
    pendingAdminClaim: Boolean,
    pendingInviteId: Schema.Types.ObjectId,
    pendingRejectPaymentId: Schema.Types.ObjectId,
  },
  { timestamps: true },
);

export const User = model<IUser>('User', userSchema);

/** Amallar tarixida va xabarlarda ko'rinadigan ism. */
export function displayName(user: Pick<IUser, 'staffName' | 'name' | 'telegramName' | 'telegramId'>): string {
  return user.staffName || user.name || user.telegramName || String(user.telegramId);
}

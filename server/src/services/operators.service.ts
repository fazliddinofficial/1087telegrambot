import { createHash, randomBytes } from 'node:crypto';
import { isValidObjectId } from 'mongoose';
import { config } from '../config/env';
import { Invite, InviteDoc } from '../models/Invite';
import { Payment } from '../models/Payment';
import { User, UserDoc, displayName } from '../models/User';
import { AppError } from '../utils/errors';
import { startOfTodayTashkent } from '../utils/format';
import { normalizePhone } from '../utils/normalize';
import { Notifier, fireAndLog } from './notifier';
import type { PaymentService } from './payments.service';

export const INVITE_PREFIX = 'inv_';

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function issueToken(): { token: string; tokenHash: string; expiresAt: Date; link: string } {
  const token = randomBytes(24).toString('base64url');
  return {
    token,
    tokenHash: hashToken(token),
    expiresAt: new Date(Date.now() + config.INVITE_TTL_HOURS * 60 * 60 * 1000),
    link: `https://t.me/${config.BOT_USERNAME}?start=${INVITE_PREFIX}${token}`,
  };
}

function inviteUsable(invite: InviteDoc): boolean {
  return !invite.usedAt && !invite.revokedAt && invite.expiresAt > new Date();
}

export function createOperatorService(notifier: Notifier, payments: PaymentService) {
  return {
    async createInvite(actor: UserDoc, name: string, phoneInput: string) {
      const phone = normalizePhone(phoneInput);
      if (!phone) throw new AppError(400, 'BAD_PHONE', "Telefon raqami noto'g'ri. Namuna: +998901234567");

      const existing = await User.exists({ role: 'operator', staffPhone: phone });
      if (existing) throw new AppError(409, 'ALREADY_OPERATOR', 'Bu raqamli operator allaqachon mavjud');

      const pending = await Invite.exists({
        phone,
        usedAt: null,
        revokedAt: null,
        expiresAt: { $gt: new Date() },
      });
      if (pending) throw new AppError(409, 'INVITE_EXISTS', 'Bu raqamga faol taklif bor. Yangi havola oling');

      const { tokenHash, expiresAt, link } = issueToken();
      const invite = await Invite.create({ tokenHash, name, phone, createdBy: actor._id, expiresAt });
      return { invite, link };
    },

    /** Eski havola bekor bo'ladi va shu taklif uchun yangisi beriladi (havolaning o'zi saqlanmaydi). */
    async reissueInvite(id: string) {
      if (!isValidObjectId(id)) throw new AppError(404, 'NOT_FOUND', 'Taklif topilmadi');
      const { tokenHash, expiresAt, link } = issueToken();
      const invite = await Invite.findOneAndUpdate(
        { _id: id, usedAt: null, revokedAt: null },
        { $set: { tokenHash, expiresAt } },
        { returnDocument: 'after' },
      );
      if (!invite) throw new AppError(409, 'INVITE_CLOSED', 'Bu taklif ishlatilgan yoki bekor qilingan');
      return { invite, link };
    },

    async revokeInvite(id: string) {
      if (!isValidObjectId(id)) throw new AppError(404, 'NOT_FOUND', 'Taklif topilmadi');
      const invite = await Invite.findOneAndUpdate(
        { _id: id, usedAt: null, revokedAt: null },
        { $set: { revokedAt: new Date() } },
        { returnDocument: 'after' },
      );
      if (!invite) throw new AppError(409, 'INVITE_CLOSED', 'Bu taklif ishlatilgan yoki bekor qilingan');
      return invite;
    },

    /** 1-qadam: havola ochildi. Rol hali berilmaydi, raqam tekshiruvi kutiladi. */
    async beginInvite(user: UserDoc, token: string): Promise<InviteDoc> {
      if (user.role === 'superadmin') {
        throw new AppError(409, 'IS_SUPERADMIN', 'Siz super adminsiz, operator roli kerak emas');
      }
      if (user.role === 'operator') {
        throw new AppError(409, 'ALREADY_OPERATOR', 'Siz allaqachon operatorsiz');
      }
      const invite = await Invite.findOne({ tokenHash: hashToken(token) });
      if (!invite || !inviteUsable(invite)) {
        throw new AppError(410, 'INVITE_INVALID', "Bu havola eskirgan yoki ishlatilgan. Super admindan yangisini so'rang");
      }
      user.pendingInviteId = invite._id;
      user.pendingAdminClaim = undefined;
      await user.save();
      return invite;
    },

    /** /admin buyrug'i: rol hali berilmaydi, Telegram orqali raqam tekshiruvi kutiladi. */
    async beginAdminClaim(user: UserDoc): Promise<void> {
      if (user.role === 'superadmin') {
        throw new AppError(409, 'IS_SUPERADMIN', 'Siz allaqachon super adminsiz');
      }
      user.pendingAdminClaim = true;
      user.pendingInviteId = undefined;
      await user.save();
    },

    /**
     * Raqam faqat Telegram'ning o'zi tasdiqlagan kontaktdan olinadi:
     * kontakt shu foydalanuvchining hisobiga tegishli bo'lishi shart.
     */
    async claimAdmin(user: UserDoc, contactPhone: string, contactUserId: number | undefined): Promise<void> {
      if (!user.pendingAdminClaim) throw new AppError(409, 'NO_PENDING_CLAIM', 'Avval /admin buyrug\'ini yuboring');
      if (contactUserId !== user.telegramId) {
        throw new AppError(403, 'FOREIGN_CONTACT', "O'zingizning raqamingizni tugma orqali ulashing");
      }
      user.pendingAdminClaim = undefined;
      const phone = normalizePhone(contactPhone);
      if (!phone || !config.SUPER_ADMIN_PHONES.includes(phone)) {
        await user.save();
        throw new AppError(403, 'NOT_ADMIN_PHONE', "Bu raqam super adminlar ro'yxatida yo'q");
      }
      user.verifiedPhone = phone;
      user.role = 'superadmin';
      await user.save();
      fireAndLog(() => notifier.superAdminJoined(displayName(user), phone, user.telegramId), 'superAdminJoined');
    },

    /**
     * 2-qadam: operator Telegram orqali raqamini ulashdi.
     * Havola begona odamga tushsa, raqami mos kelmaydi va rol berilmaydi.
     */
    async acceptContact(user: UserDoc, contactPhone: string, contactUserId: number | undefined): Promise<void> {
      if (!user.pendingInviteId) throw new AppError(409, 'NO_PENDING_INVITE', 'Faol taklif topilmadi');
      if (contactUserId !== user.telegramId) {
        throw new AppError(403, 'FOREIGN_CONTACT', "O'zingizning raqamingizni tugma orqali ulashing");
      }
      const invite = await Invite.findById(user.pendingInviteId);
      if (!invite || !inviteUsable(invite)) {
        throw new AppError(410, 'INVITE_INVALID', "Bu havola eskirgan yoki ishlatilgan. Super admindan yangisini so'rang");
      }
      const phone = normalizePhone(contactPhone);
      if (phone !== invite.phone) {
        throw new AppError(403, 'PHONE_NOT_MATCH', "Raqamingiz taklifdagi raqamga mos kelmadi. Super adminga murojaat qiling");
      }
      const claimed = await Invite.findOneAndUpdate(
        { _id: invite._id, usedAt: null, revokedAt: null },
        { $set: { usedAt: new Date(), usedBy: user._id } },
      );
      if (!claimed) throw new AppError(410, 'INVITE_INVALID', 'Bu havola allaqachon ishlatilgan');

      user.role = 'operator';
      user.staffName = invite.name;
      user.staffPhone = invite.phone;
      user.operatorJoinedAt = new Date();
      user.pendingInviteId = undefined;
      await user.save();
      fireAndLog(() => notifier.operatorJoined(invite.name, invite.phone), 'operatorJoined');
    },

    /**
     * Operator butunlay o'chiriladi va ro'yxatda qolmaydi; qo'lidagi to'lovlar boshqalarga qaytadi.
     * To'lovlar tarixi o'zgarmaydi: u yerda ism alohida saqlangan. Avval haydovchi bo'lib
     * ro'yxatdan o'tgan odamning haydovchi profili esa qoladi, chunki unga to'lovlari bog'langan.
     */
    async removeOperator(id: string, actor: UserDoc) {
      if (!isValidObjectId(id)) throw new AppError(404, 'NOT_FOUND', 'Operator topilmadi');
      const operator = await User.findOneAndUpdate(
        { _id: id, role: 'operator' },
        {
          $set: { role: 'driver' },
          $unset: { staffName: 1, staffPhone: 1, operatorJoinedAt: 1, pendingRejectPaymentId: 1 },
        },
        { returnDocument: 'after' },
      );
      if (!operator) throw new AppError(404, 'NOT_FOUND', 'Operator topilmadi');
      const released = await payments.releaseAllTakenBy(operator, actor);
      if (!operator.registeredAt) await User.deleteOne({ _id: operator._id, role: 'driver' });
      return { released };
    },

    /** Operatorlar va ularning ko'rsatkichlari, hamda hali ishlatilmagan takliflar. */
    async list() {
      const [operators, invites] = await Promise.all([
        User.find({ role: 'operator' }).sort({ operatorJoinedAt: -1 }),
        Invite.find({ usedAt: null, revokedAt: null }).sort({ createdAt: -1 }),
      ]);
      const ids = operators.map((o) => o._id);
      const today = startOfTodayTashkent();
      const [finished, inProgress] = await Promise.all([
        Payment.aggregate<{
          _id: unknown;
          completedCount: number;
          completedSum: number;
          todayCount: number;
          todaySum: number;
          rejectedCount: number;
        }>([
          { $match: { finishedBy: { $in: ids } } },
          {
            $group: {
              _id: '$finishedBy',
              completedCount: { $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] } },
              completedSum: { $sum: { $cond: [{ $eq: ['$status', 'completed'] }, '$amount', 0] } },
              todayCount: {
                $sum: {
                  $cond: [{ $and: [{ $eq: ['$status', 'completed'] }, { $gte: ['$finishedAt', today] }] }, 1, 0],
                },
              },
              todaySum: {
                $sum: {
                  $cond: [{ $and: [{ $eq: ['$status', 'completed'] }, { $gte: ['$finishedAt', today] }] }, '$amount', 0],
                },
              },
              rejectedCount: { $sum: { $cond: [{ $eq: ['$status', 'rejected'] }, 1, 0] } },
            },
          },
        ]),
        Payment.aggregate<{ _id: unknown; count: number }>([
          { $match: { status: 'in_progress', takenBy: { $in: ids } } },
          { $group: { _id: '$takenBy', count: { $sum: 1 } } },
        ]),
      ]);
      const finishedById = new Map(finished.map((f) => [String(f._id), f]));
      const heldById = new Map(inProgress.map((h) => [String(h._id), h.count]));

      return {
        operators: operators.map((o) => {
          const stats = finishedById.get(String(o._id));
          return {
            id: String(o._id),
            name: o.staffName,
            phone: o.staffPhone,
            joinedAt: o.operatorJoinedAt,
            todayCount: stats?.todayCount ?? 0,
            todaySum: stats?.todaySum ?? 0,
            completedCount: stats?.completedCount ?? 0,
            completedSum: stats?.completedSum ?? 0,
            rejectedCount: stats?.rejectedCount ?? 0,
            inProgress: heldById.get(String(o._id)) ?? 0,
          };
        }),
        invites: invites.map((i) => ({
          id: String(i._id),
          name: i.name,
          phone: i.phone,
          createdAt: i.createdAt,
          expiresAt: i.expiresAt,
          expired: i.expiresAt <= new Date(),
        })),
      };
    },
  };
}

export type OperatorService = ReturnType<typeof createOperatorService>;

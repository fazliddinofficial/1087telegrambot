import { createHash, randomBytes } from 'node:crypto';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { isValidObjectId } from 'mongoose';
import { config } from '../config/env';
import { IPaymentEvent, Payment, PaymentAction, PaymentDoc } from '../models/Payment';
import { nextPaymentNumber } from '../models/Setting';
import { UserDoc, displayName } from '../models/User';
import { AppError } from '../utils/errors';
import { detectImageType } from '../utils/normalize';
import { getCard } from './card.service';
import { Notifier, fireAndLog } from './notifier';

export const REJECTION_REASON_MAX = 300;

function isStaff(user: UserDoc): boolean {
  return user.role === 'operator' || user.role === 'superadmin';
}

function assertStaff(user: UserDoc): void {
  if (!isStaff(user)) throw new AppError(403, 'FORBIDDEN', "Bu amal uchun ruxsat yo'q");
}

function assertId(id: string): void {
  if (!isValidObjectId(id)) throw new AppError(404, 'NOT_FOUND', "To'lov topilmadi");
}

function event(action: PaymentAction, actor: UserDoc, note?: string): IPaymentEvent {
  return { action, actorId: actor._id, actorName: displayName(actor), at: new Date(), note };
}

export function receiptPath(fileName: string): string {
  return path.join(config.UPLOAD_DIR, path.basename(fileName));
}

export function createPaymentService(notifier: Notifier) {
  /** Amal bajarilmagan bo'lsa, foydalanuvchiga aniq sababini aytadi. */
  async function explainConflict(id: string, actor: UserDoc): Promise<never> {
    const current = await Payment.findById(id);
    if (!current) throw new AppError(404, 'NOT_FOUND', "To'lov topilmadi");
    if (current.status === 'in_progress' && !current.takenBy?.equals(actor._id)) {
      throw new AppError(409, 'TAKEN_BY_OTHER', `Bu to'lovni ${current.takenByName} olgan`);
    }
    if (current.status === 'completed') {
      throw new AppError(409, 'ALREADY_COMPLETED', `Bu to'lov allaqachon tushirilgan (${current.finishedByName})`);
    }
    if (current.status === 'rejected') {
      throw new AppError(409, 'ALREADY_REJECTED', `Bu to'lov allaqachon rad etilgan (${current.finishedByName})`);
    }
    if (current.status === 'new') {
      throw new AppError(409, 'NOT_TAKEN', "Avval to'lovni oling");
    }
    throw new AppError(409, 'ALREADY_TAKEN', "Siz bu to'lovni allaqachon olgansiz");
  }

  return {
    async create(driver: UserDoc, amount: number, file: Buffer | undefined): Promise<PaymentDoc> {
      if (driver.role !== 'driver') {
        throw new AppError(403, 'NOT_DRIVER', "To'lovni faqat haydovchi yuboradi");
      }
      if (!driver.registeredAt || !driver.taxiId || !driver.name || !driver.phone || !driver.carNumber) {
        throw new AppError(400, 'NOT_REGISTERED', "Avval ro'yxatdan o'ting");
      }
      if (!Number.isInteger(amount) || amount < config.MIN_AMOUNT || amount > config.MAX_AMOUNT) {
        throw new AppError(
          400,
          'BAD_AMOUNT',
          `Summa ${config.MIN_AMOUNT} dan ${config.MAX_AMOUNT} so'mgacha butun son bo'lishi kerak`,
        );
      }
      if (!file) throw new AppError(400, 'NO_RECEIPT', 'Chek rasmini yuklang');
      const image = detectImageType(file);
      if (!image) throw new AppError(400, 'BAD_RECEIPT', 'Chek JPG yoki PNG rasm bo\'lishi kerak');

      const card = await getCard();
      if (!card) throw new AppError(409, 'NO_CARD', "To'lov kartasi hali kiritilmagan");

      const open = await Payment.countDocuments({ driver: driver._id, status: { $in: ['new', 'in_progress'] } });
      if (open >= config.MAX_OPEN_PAYMENTS) {
        throw new AppError(429, 'TOO_MANY_OPEN', "Oldingi to'lovlaringiz ko'rib chiqilishini kuting");
      }

      const sha256 = createHash('sha256').update(file).digest('hex');
      const duplicate = await Payment.findOne({ 'receipt.sha256': sha256 }).sort({ number: 1 });

      await mkdir(config.UPLOAD_DIR, { recursive: true });
      const fileName = `${randomBytes(16).toString('hex')}.${image.ext}`;
      await writeFile(receiptPath(fileName), file);

      let payment: PaymentDoc;
      try {
        payment = await Payment.create({
          number: await nextPaymentNumber(),
          driver: driver._id,
          driverInfo: {
            telegramId: driver.telegramId,
            taxiId: driver.taxiId,
            name: driver.name,
            phone: driver.phone,
            carNumber: driver.carNumber,
          },
          card,
          amount,
          receipt: { fileName, mime: image.mime, size: file.length, sha256 },
          duplicateOfNumber: duplicate?.number,
          events: [event('created', driver)],
        });
      } catch (err) {
        await unlink(receiptPath(fileName)).catch(() => undefined);
        throw err;
      }

      fireAndLog(() => notifier.announce(payment), `announce #${payment.number}`);
      return payment;
    },

    /** Atomik: bir vaqtda bosgan ikki operatordan faqat bittasi oladi. */
    async take(id: string, actor: UserDoc): Promise<PaymentDoc> {
      assertStaff(actor);
      assertId(id);
      const payment = await Payment.findOneAndUpdate(
        { _id: id, status: 'new' },
        {
          $set: {
            status: 'in_progress',
            takenBy: actor._id,
            takenByName: displayName(actor),
            takenByTelegramId: actor.telegramId,
            takenAt: new Date(),
            lastReminderAt: new Date(),
          },
          $push: { events: event('taken', actor) },
        },
        { returnDocument: 'after' },
      );
      if (!payment) return explainConflict(id, actor);
      fireAndLog(() => notifier.sync(payment), `sync #${payment.number}`);
      return payment;
    },

    /** Operator web dasturda balansni to'ldirgach bosadi. Faqat to'lovni olgan xodim bajaradi. */
    async complete(id: string, actor: UserDoc): Promise<PaymentDoc> {
      assertStaff(actor);
      assertId(id);
      const payment = await Payment.findOneAndUpdate(
        { _id: id, status: 'in_progress', takenBy: actor._id },
        {
          $set: {
            status: 'completed',
            finishedBy: actor._id,
            finishedByName: displayName(actor),
            finishedAt: new Date(),
          },
          $push: { events: event('completed', actor) },
        },
        { returnDocument: 'after' },
      );
      if (!payment) return explainConflict(id, actor);
      fireAndLog(() => notifier.sync(payment), `sync #${payment.number}`);
      fireAndLog(() => notifier.notifyDriver(payment), `driver #${payment.number}`);
      return payment;
    },

    async reject(id: string, actor: UserDoc, reasonInput: string): Promise<PaymentDoc> {
      assertStaff(actor);
      assertId(id);
      const reason = reasonInput.trim();
      if (!reason) throw new AppError(400, 'NO_REASON', 'Rad etish sababini yozing');
      if (reason.length > REJECTION_REASON_MAX) {
        throw new AppError(400, 'REASON_TOO_LONG', `Sabab ${REJECTION_REASON_MAX} belgidan oshmasin`);
      }
      const payment = await Payment.findOneAndUpdate(
        { _id: id, status: 'in_progress', takenBy: actor._id },
        {
          $set: {
            status: 'rejected',
            finishedBy: actor._id,
            finishedByName: displayName(actor),
            finishedAt: new Date(),
            rejectionReason: reason,
          },
          $push: { events: event('rejected', actor, reason) },
        },
        { returnDocument: 'after' },
      );
      if (!payment) return explainConflict(id, actor);
      fireAndLog(() => notifier.sync(payment), `sync #${payment.number}`);
      fireAndLog(() => notifier.notifyDriver(payment), `driver #${payment.number}`);
      return payment;
    },

    /** To'xtab qolgan to'lovni umumiy navbatga qaytaradi. */
    async release(id: string, actor: UserDoc, note?: string): Promise<PaymentDoc> {
      assertId(id);
      const payment = await Payment.findOneAndUpdate(
        { _id: id, status: 'in_progress' },
        {
          $set: { status: 'new', lastReminderAt: new Date() },
          $unset: { takenBy: 1, takenByName: 1, takenByTelegramId: 1, takenAt: 1 },
          $push: { events: event('released', actor, note) },
        },
        { returnDocument: 'after' },
      );
      if (!payment) {
        const exists = await Payment.exists({ _id: id });
        if (!exists) throw new AppError(404, 'NOT_FOUND', "To'lov topilmadi");
        throw new AppError(409, 'NOT_IN_PROGRESS', "Bu to'lov hozir hech kimda emas");
      }
      fireAndLog(async () => {
        await notifier.sync(payment);
        await notifier.announce(payment);
      }, `release #${payment.number}`);
      return payment;
    },

    /** Operator o'chirilganda uning qo'lidagi to'lovlar boshqalarga qaytadi. */
    async releaseAllTakenBy(operator: UserDoc, actor: UserDoc): Promise<number> {
      const held = await Payment.find({ status: 'in_progress', takenBy: operator._id }).select('_id');
      for (const { _id } of held) {
        await this.release(String(_id), actor, "Operator o'chirildi");
      }
      return held.length;
    },

    async getForViewer(id: string, viewer: UserDoc): Promise<PaymentDoc> {
      assertId(id);
      const payment = await Payment.findById(id);
      if (!payment || (!isStaff(viewer) && !payment.driver.equals(viewer._id))) {
        throw new AppError(404, 'NOT_FOUND', "To'lov topilmadi");
      }
      return payment;
    },
  };
}

export type PaymentService = ReturnType<typeof createPaymentService>;

import { readFile } from 'node:fs/promises';
import { Input, Markup, Telegram } from 'telegraf';
import { config } from '../config/env';
import { Payment, PaymentDoc } from '../models/Payment';
import { User } from '../models/User';
import type { Notifier } from '../services/notifier';
import { receiptPath } from '../services/payments.service';
import { listStaff } from '../services/users.service';
import { escapeHtml, formatDateTime, formatMoney, maskCard } from '../utils/format';

/** Xabardagi tugmalar uchun callback ma'lumotlari. */
export const CB = {
  take: 'pay:take',
  done: 'pay:done',
  reject: 'pay:rej',
} as const;

function statusLine(p: PaymentDoc): string {
  const name = escapeHtml(p.takenByName ?? p.finishedByName ?? '');
  switch (p.status) {
    case 'new':
      return '🆕 <b>Yangi, operator kutilmoqda</b>';
    case 'in_progress':
      return `⏳ <b>${name} oldi</b>`;
    case 'completed':
      return `✅ <b>${escapeHtml(p.finishedByName ?? '')} tushirdi</b> (${formatDateTime(p.finishedAt!)})`;
    case 'rejected':
      return `❌ <b>${escapeHtml(p.finishedByName ?? '')} rad etdi</b>: ${escapeHtml(p.rejectionReason ?? '')}`;
  }
}

export function paymentCaption(p: PaymentDoc): string {
  const lines = [
    `<b>To'lov #${p.number}</b>`,
    // Dispetcher haydovchini web dasturda shu ID orqali topadi, shuning uchun u birinchi turadi.
    ...(p.driverInfo.taxiId ? [`🆔 ID: <code>${escapeHtml(p.driverInfo.taxiId)}</code>`] : []),
    `👤 ${escapeHtml(p.driverInfo.name)}`,
    `📞 <code>${escapeHtml(p.driverInfo.phone)}</code>`,
    `🚗 <code>${escapeHtml(p.driverInfo.carNumber)}</code>`,
    `💰 <b>${formatMoney(p.amount)}</b>`,
    `💳 ${maskCard(p.card.number)}`,
    `🕒 ${formatDateTime(p.createdAt)}`,
  ];
  if (p.duplicateOfNumber) lines.push(`⚠️ <b>Bu chek avval #${p.duplicateOfNumber} to'lovda yuborilgan</b>`);
  lines.push('', statusLine(p));
  return lines.join('\n');
}

/** Tugmalar qabul qiluvchiga qarab farq qiladi: oxirgi ikki tugma faqat to'lovni olgan xodimda bo'ladi. */
export function paymentKeyboard(p: PaymentDoc, chatId: number, isActiveStaff: boolean) {
  const id = String(p._id);
  if (isActiveStaff && p.status === 'new') {
    return Markup.inlineKeyboard([[Markup.button.callback('📥 Oldim', `${CB.take}:${id}`)]]).reply_markup;
  }
  if (isActiveStaff && p.status === 'in_progress' && p.takenByTelegramId === chatId) {
    return Markup.inlineKeyboard([
      [
        Markup.button.callback('✅ Tushirdim', `${CB.done}:${id}`),
        Markup.button.callback('❌ Rad etish', `${CB.reject}:${id}`),
      ],
    ]).reply_markup;
  }
  return { inline_keyboard: [] };
}

function isNotModified(err: unknown): boolean {
  return err instanceof Error && err.message.includes('message is not modified');
}

export function createTelegramNotifier(telegram: Telegram): Notifier {
  async function sendReceipt(payment: PaymentDoc, chatId: number, keyboard: ReturnType<typeof paymentKeyboard>) {
    const extra = { caption: paymentCaption(payment), parse_mode: 'HTML' as const, reply_markup: keyboard };
    if (payment.receipt.telegramFileId) {
      return telegram.sendPhoto(chatId, payment.receipt.telegramFileId, extra);
    }
    const buffer = await readFile(receiptPath(payment.receipt.fileName));
    const input = Input.fromBuffer(buffer, payment.receipt.fileName);
    try {
      const sent = await telegram.sendPhoto(chatId, input, extra);
      const fileId = sent.photo.at(-1)?.file_id;
      if (fileId) {
        payment.receipt.telegramFileId = fileId;
        await Payment.updateOne({ _id: payment._id }, { $set: { 'receipt.telegramFileId': fileId } });
      }
      return sent;
    } catch {
      // Juda uzun skrinshotni Telegram rasm sifatida qabul qilmaydi, shuning uchun fayl qilib yuboriladi.
      return telegram.sendDocument(chatId, Input.fromBuffer(buffer, payment.receipt.fileName), extra);
    }
  }

  const notifier: Notifier = {
    async announce(payment) {
      const staff = await listStaff();
      const alreadySent = new Set(payment.messages.map((m) => m.chatId));
      for (const member of staff) {
        if (alreadySent.has(member.telegramId)) continue;
        try {
          const keyboard = paymentKeyboard(payment, member.telegramId, true);
          const sent = await sendReceipt(payment, member.telegramId, keyboard);
          const entry = { chatId: member.telegramId, messageId: sent.message_id };
          payment.messages.push(entry);
          await Payment.updateOne({ _id: payment._id }, { $push: { messages: entry } });
        } catch (err) {
          console.error(`[telegram] ${member.telegramId} ga yuborilmadi:`, err instanceof Error ? err.message : err);
        }
      }
      // Yuborish davomida kimdir to'lovni olgan bo'lsa, xabarlardagi eski tugmalar yangilanadi.
      const fresh = await Payment.findById(payment._id);
      if (fresh && fresh.status !== 'new') await notifier.sync(fresh);
    },

    async sync(payment) {
      const fresh = (await Payment.findById(payment._id)) ?? payment;
      const staff = await listStaff();
      const activeIds = new Set(staff.map((s) => s.telegramId));
      for (const { chatId, messageId } of fresh.messages) {
        try {
          await telegram.editMessageCaption(chatId, messageId, undefined, paymentCaption(fresh), {
            parse_mode: 'HTML',
            reply_markup: paymentKeyboard(fresh, chatId, activeIds.has(chatId)),
          });
        } catch (err) {
          if (!isNotModified(err)) {
            console.error(`[telegram] xabar ${chatId}/${messageId}:`, err instanceof Error ? err.message : err);
          }
        }
      }
    },

    async notifyDriver(payment) {
      const amount = formatMoney(payment.amount);
      const text =
        payment.status === 'completed'
          ? `✅ <b>To'lov #${payment.number}</b>: ${amount} balansingizga tushirildi.`
          : `❌ <b>To'lov #${payment.number}</b>: ${amount} rad etildi.\nSabab: ${escapeHtml(payment.rejectionReason ?? '')}`;
      await telegram.sendMessage(payment.driverInfo.telegramId, text, { parse_mode: 'HTML' });
    },

    async remindNew(payment) {
      const staff = await listStaff();
      const text = `⏰ To'lov #${payment.number} (${formatMoney(payment.amount)}) hali hech kim tomonidan olinmadi.`;
      for (const member of staff) {
        await telegram
          .sendMessage(member.telegramId, text)
          .catch((err) => console.error(`[telegram] eslatma ${member.telegramId}:`, err.message));
      }
    },

    async remindInProgress(payment) {
      const admins = await User.find({ role: 'superadmin' });
      const recipients = new Set(admins.map((a) => a.telegramId));
      if (payment.takenByTelegramId) recipients.add(payment.takenByTelegramId);
      const text = `⏰ To'lov #${payment.number} (${formatMoney(payment.amount)}) ${config.REMIND_IN_PROGRESS_MINUTES} daqiqadan beri ${payment.takenByName} qo'lida turibdi.`;
      for (const chatId of recipients) {
        await telegram
          .sendMessage(chatId, text)
          .catch((err) => console.error(`[telegram] eslatma ${chatId}:`, err.message));
      }
    },

    async operatorJoined(name, phone) {
      const admins = await User.find({ role: 'superadmin' });
      for (const admin of admins) {
        await telegram
          .sendMessage(admin.telegramId, `👤 ${name} (${phone}) operator bo'ldi.`)
          .catch((err) => console.error(`[telegram] ${admin.telegramId}:`, err.message));
      }
    },

    async superAdminJoined(name, phone, telegramId) {
      const admins = await User.find({ role: 'superadmin', telegramId: { $ne: telegramId } });
      for (const admin of admins) {
        await telegram
          .sendMessage(admin.telegramId, `🔐 ${name} (${phone}) super admin bo'ldi.`)
          .catch((err) => console.error(`[telegram] ${admin.telegramId}:`, err.message));
      }
    },
  };
  return notifier;
}

import { Context, Markup, Telegraf } from 'telegraf';
import { message } from 'telegraf/filters';
import { config } from '../config/env';
import { Payment } from '../models/Payment';
import { User, UserDoc } from '../models/User';
import { INVITE_PREFIX, OperatorService } from '../services/operators.service';
import { PaymentService } from '../services/payments.service';
import { resolveUser } from '../services/users.service';
import { AppError } from '../utils/errors';
import { CB, paymentKeyboard } from './telegramNotifier';

// Tez-tez uchraydigan sabablar: operator bir bosishda rad eta oladi.
const REJECT_REASONS: Record<string, string> = {
  nomoney: 'Pul kartaga tushmagan',
  amount: 'Summa mos kelmadi',
  receipt: "Chek noto'g'ri yoki o'qib bo'lmaydi",
};

function appButton(text: string) {
  return Markup.inlineKeyboard([Markup.button.webApp(text, config.WEBAPP_URL)]);
}

function welcomeText(user: UserDoc): string {
  if (user.role === 'operator') return "Salom! Yangi to'lovlar shu botga keladi. Barcha kutilayotganlar ilovada turadi.";
  return 'Salom Hurmatli Haydovchi Hisobni To’ldirish Uchun Ilovani Oching !';
}

function errorText(err: unknown): string {
  if (err instanceof AppError) return err.message;
  console.error('[bot]', err);
  return "Xatolik yuz berdi, qayta urinib ko'ring";
}

async function userFrom(ctx: Context): Promise<UserDoc> {
  return resolveUser(ctx.from!);
}

/** Tugma amali: xato faqat amalning o'zi bajarilmaganda ko'rsatiladi. */
async function runPaymentAction(ctx: Context, action: () => Promise<unknown>, successText: string): Promise<void> {
  try {
    await action();
  } catch (err) {
    await ctx.answerCbQuery(errorText(err), { show_alert: true });
    return;
  }
  await ctx.answerCbQuery(successText);
}

export function registerHandlers(bot: Telegraf, payments: PaymentService, operators: OperatorService): void {
  // Bot faqat shaxsiy suhbatda ishlaydi.
  bot.use(async (ctx, next) => {
    if (ctx.chat && ctx.chat.type !== 'private') return;
    if (!ctx.from || ctx.from.is_bot) return;
    await next();
  });

  bot.start(async (ctx) => {
    const user = await userFrom(ctx);
    const payload = ctx.payload ?? '';

    if (payload.startsWith(INVITE_PREFIX)) {
      let inviteName: string;
      try {
        inviteName = (await operators.beginInvite(user, payload.slice(INVITE_PREFIX.length))).name;
      } catch (err) {
        await ctx.reply(errorText(err));
        return;
      }
      await ctx.reply(
        `Salom, ${inviteName}! Operator bo'lish uchun pastdagi tugma orqali telefon raqamingizni ulashing.`,
        Markup.keyboard([[Markup.button.contactRequest('📱 Raqamni ulashish')]]).resize().oneTime(),
      );
      return;
    }
    await ctx.reply(welcomeText(user), appButton('🚖 Ilovani ochish'));
  });

  // Menyuda ko'rsatilmaydi: faqat super adminlar ro'yxatidagi raqam bilan natija beradi.
  bot.command('admin', async (ctx) => {
    const user = await userFrom(ctx);
    try {
      await operators.beginAdminClaim(user);
    } catch (err) {
      await ctx.reply(errorText(err), appButton('🚖 Ilovani ochish'));
      return;
    }
    await ctx.reply(
      'Super admin ekaningizni tasdiqlash uchun pastdagi tugma orqali telefon raqamingizni ulashing.',
      Markup.keyboard([[Markup.button.contactRequest('📱 Raqamni ulashish')]]).resize().oneTime(),
    );
  });

  // Amal bajarilgach xabar yuborilmay qolsa, foydalanuvchiga «xatolik» deyilmaydi: amal baribir saqlangan.
  bot.on(message('contact'), async (ctx) => {
    const user = await userFrom(ctx);
    const { phone_number: phone, user_id: contactUserId } = ctx.message.contact;
    const claim = Boolean(user.pendingAdminClaim);
    try {
      if (claim) await operators.claimAdmin(user, phone, contactUserId);
      else await operators.acceptContact(user, phone, contactUserId);
    } catch (err) {
      await ctx.reply(errorText(err), Markup.removeKeyboard());
      return;
    }
    await ctx.reply(
      claim ? "✅ Siz super adminsiz! To'lovlar shu botga keladi." : "✅ Siz operator bo'ldingiz! Yangi to'lovlar shu yerga keladi.",
      Markup.removeKeyboard(),
    );
    await ctx.reply(welcomeText(user), appButton('📋 Ilovani ochish'));
  });

  // "Boshqa sabab" tanlangandan keyingi matn, aks holda oddiy xabarga ilova havolasi.
  bot.on(message('text'), async (ctx) => {
    const user = await userFrom(ctx);
    if (!user.pendingRejectPaymentId) {
      await ctx.reply(welcomeText(user), appButton('🚖 Ilovani ochish'));
      return;
    }
    const paymentId = String(user.pendingRejectPaymentId);
    let paymentNumber: number;
    try {
      paymentNumber = (await payments.reject(paymentId, user, ctx.message.text)).number;
      await User.updateOne({ _id: user._id }, { $unset: { pendingRejectPaymentId: 1 } });
    } catch (err) {
      // Sabab juda uzun bo'lsa, operator qayta yoza oladi; boshqa holatlarda kutish bekor qilinadi.
      if (!(err instanceof AppError && err.code === 'REASON_TOO_LONG')) {
        await User.updateOne({ _id: user._id }, { $unset: { pendingRejectPaymentId: 1 } });
      }
      await ctx.reply(errorText(err));
      return;
    }
    await ctx.reply(`❌ To'lov #${paymentNumber} rad etildi.`);
  });

  bot.action(new RegExp(`^${CB.take}:([a-f0-9]{24})$`), async (ctx) => {
    const user = await userFrom(ctx);
    await runPaymentAction(ctx, () => payments.take(ctx.match[1], user), "To'lov sizga biriktirildi");
  });

  bot.action(new RegExp(`^${CB.done}:([a-f0-9]{24})$`), async (ctx) => {
    const user = await userFrom(ctx);
    await runPaymentAction(ctx, () => payments.complete(ctx.match[1], user), 'Haydovchiga xabar yuborildi');
  });

  // Rad etish sabablarini ko'rsatadi.
  bot.action(new RegExp(`^${CB.reject}:([a-f0-9]{24})$`), async (ctx) => {
    const id = ctx.match[1];
    await ctx.answerCbQuery();
    await ctx.editMessageReplyMarkup(
      Markup.inlineKeyboard([
        ...Object.entries(REJECT_REASONS).map(([code, label]) => [
          Markup.button.callback(label, `${CB.reject}r:${id}:${code}`),
        ]),
        [Markup.button.callback('✏️ Boshqa sabab', `${CB.reject}o:${id}`)],
        [Markup.button.callback('⬅️ Orqaga', `${CB.reject}b:${id}`)],
      ]).reply_markup,
    );
  });

  bot.action(new RegExp(`^${CB.reject}r:([a-f0-9]{24}):(\\w+)$`), async (ctx) => {
    const user = await userFrom(ctx);
    const reason = REJECT_REASONS[ctx.match[2]];
    await runPaymentAction(
      ctx,
      async () => {
        if (!reason) throw new AppError(400, 'NO_REASON', 'Sabab topilmadi');
        await payments.reject(ctx.match[1], user, reason);
      },
      'Rad etildi, haydovchiga xabar yuborildi',
    );
  });

  bot.action(new RegExp(`^${CB.reject}o:([a-f0-9]{24})$`), async (ctx) => {
    const user = await userFrom(ctx);
    const payment = await Payment.findById(ctx.match[1]);
    if (!payment || payment.status !== 'in_progress' || !payment.takenBy?.equals(user._id)) {
      await ctx.answerCbQuery("Bu to'lov sizda emas", { show_alert: true });
      return;
    }
    await User.updateOne({ _id: user._id }, { $set: { pendingRejectPaymentId: payment._id } });
    await ctx.answerCbQuery();
    await ctx.reply(`To'lov #${payment.number} uchun rad etish sababini yozing:`);
  });

  bot.action(new RegExp(`^${CB.reject}b:([a-f0-9]{24})$`), async (ctx) => {
    await ctx.answerCbQuery();
    const payment = await Payment.findById(ctx.match[1]);
    if (!payment) return;
    const user = await userFrom(ctx);
    const isStaff = user.role === 'operator' || user.role === 'superadmin';
    await ctx.editMessageReplyMarkup(paymentKeyboard(payment, user.telegramId, isStaff));
  });

  bot.catch((err) => {
    console.error('[bot]', err instanceof Error ? err.message : err);
  });
}

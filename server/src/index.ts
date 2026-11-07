import { mkdir } from 'node:fs/promises';
import mongoose from 'mongoose';
import { Telegraf } from 'telegraf';
import { createApp } from './api/app';
import { registerHandlers } from './bot/handlers';
import { createTelegramNotifier } from './bot/telegramNotifier';
import { installTelegramRetry } from './bot/telegramRetry';
import { config } from './config/env';
import { startReminders } from './jobs/reminders';
import { createOperatorService } from './services/operators.service';
import { createPaymentService } from './services/payments.service';

async function main(): Promise<void> {
  await mongoose.connect(config.MONGO_URI);
  await mkdir(config.UPLOAD_DIR, { recursive: true });

  installTelegramRetry();
  const bot = new Telegraf(config.BOT_TOKEN);
  const notifier = createTelegramNotifier(bot.telegram);
  const payments = createPaymentService(notifier);
  const operators = createOperatorService(notifier, payments);
  registerHandlers(bot, payments, operators);

  const server = createApp(payments, operators, { logRequests: true }).listen(config.PORT, () => {
    console.log(`API ishga tushdi: http://localhost:${config.PORT}`);
  });
  const reminders = startReminders(notifier);

  if (config.BOT_POLLING) {
    if (!config.WEBAPP_URL.startsWith('https://')) {
      console.warn('WEBAPP_URL https emas: Telegram Mini App tugmasini qabul qilmaydi.');
    }
    await bot.telegram.setChatMenuButton({
      menuButton: { type: 'web_app', text: 'Ilova', web_app: { url: config.WEBAPP_URL } },
    });
    bot.launch().catch((err) => {
      console.error('Bot ishga tushmadi:', err instanceof Error ? err.message : err);
      process.exit(1);
    });
    console.log(`Bot ishga tushdi: @${config.BOT_USERNAME}`);
  } else {
    console.log("BOT_POLLING=false: bot xabarlarni qabul qilmaydi (faqat lokal sinov uchun).");
  }

  const shutdown = (signal: string) => {
    console.log(`${signal}: to'xtatilmoqda`);
    clearInterval(reminders);
    if (config.BOT_POLLING) bot.stop(signal);
    server.close(() => {
      mongoose.disconnect().finally(() => process.exit(0));
    });
  };
  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error('Server ishga tushmadi:', err);
  process.exit(1);
});

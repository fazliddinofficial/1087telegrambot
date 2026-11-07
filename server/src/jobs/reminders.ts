import { config } from '../config/env';
import { Payment, PaymentDoc } from '../models/Payment';
import { Notifier } from '../services/notifier';

const MINUTE = 60 * 1000;

/** Vaqti o'tgan to'lovni atomik belgilaydi: bir to'lov uchun eslatma bir marta ketadi. */
async function claimOverdue(status: 'new' | 'in_progress', minutes: number): Promise<PaymentDoc | null> {
  const threshold = new Date(Date.now() - minutes * MINUTE);
  return Payment.findOneAndUpdate(
    {
      status,
      $or: [{ lastReminderAt: { $lte: threshold } }, { lastReminderAt: null, createdAt: { $lte: threshold } }],
    },
    { $set: { lastReminderAt: new Date() } },
    { returnDocument: 'after' },
  );
}

export async function runRemindersOnce(notifier: Notifier): Promise<void> {
  for (let p = await claimOverdue('new', config.REMIND_NEW_MINUTES); p; p = await claimOverdue('new', config.REMIND_NEW_MINUTES)) {
    await notifier.remindNew(p);
  }
  for (
    let p = await claimOverdue('in_progress', config.REMIND_IN_PROGRESS_MINUTES);
    p;
    p = await claimOverdue('in_progress', config.REMIND_IN_PROGRESS_MINUTES)
  ) {
    await notifier.remindInProgress(p);
  }
}

export function startReminders(notifier: Notifier): NodeJS.Timeout {
  return setInterval(() => {
    runRemindersOnce(notifier).catch((err) => console.error('[eslatma]', err));
  }, MINUTE);
}

import type { PaymentDoc } from '../models/Payment';

/** To'lov xizmati Telegram'ni shu interfeys orqali chaqiradi; testlarda soxtasi ishlatiladi. */
export interface Notifier {
  /** Hali xabar olmagan barcha operator va super adminlarga to'lovni yuboradi. */
  announce(payment: PaymentDoc): Promise<void>;
  /** Yuborilgan xabarlardagi matn va tugmalarni to'lov holatiga moslaydi. */
  sync(payment: PaymentDoc): Promise<void>;
  /** Haydovchiga yakuniy natijani yuboradi. */
  notifyDriver(payment: PaymentDoc): Promise<void>;
  remindNew(payment: PaymentDoc): Promise<void>;
  remindInProgress(payment: PaymentDoc): Promise<void>;
  operatorJoined(name: string, phone: string): Promise<void>;
  /** Boshqa super adminlarni ogohlantiradi: yangi admin paydo bo'lishini bilishlari kerak. */
  superAdminJoined(name: string, phone: string, telegramId: number): Promise<void>;
}

/**
 * Telegram xatosi yoki sekinligi to'lov amalini to'xtatmasligi kerak:
 * asosiy manba baza, xabarlar esa qo'shimcha.
 */
export function fireAndLog(task: () => Promise<void>, label: string): void {
  task().catch((err) => console.error(`[telegram] ${label}:`, err instanceof Error ? err.message : err));
}

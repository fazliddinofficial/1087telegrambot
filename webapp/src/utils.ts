import type { PaymentEvent, PaymentStatus } from './api';

export function groupDigits(value: number | string): string {
  return String(value).replace(/\D/g, '').replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

export function formatMoney(amount: number): string {
  return `${groupDigits(amount)} so'm`;
}

export function formatCard(number: string): string {
  return number.replace(/(\d{4})(?=\d)/g, '$1 ');
}

export function maskCard(number: string): string {
  return `${number.slice(0, 4)} •••• ${number.slice(-4)}`;
}

/** 01A123BC -> 01 A 123 BC, 01123ABC -> 01 123 ABC. Boshqa ko'rinishdagi raqam o'zgarishsiz qoladi. */
export function formatPlate(plate: string): string {
  if (/^\d{2}[A-Z]\d{3}[A-Z]{2}$/.test(plate)) {
    return `${plate.slice(0, 2)} ${plate[2]} ${plate.slice(3, 6)} ${plate.slice(6)}`;
  }
  if (/^\d{5}[A-Z]{3}$/.test(plate)) {
    return `${plate.slice(0, 2)} ${plate.slice(2, 5)} ${plate.slice(5)}`;
  }
  return plate;
}

/** +998901234567 -> +998 90 123 45 67 */
export function formatPhone(phone: string): string {
  const m = phone.match(/^\+998(\d{2})(\d{3})(\d{2})(\d{2})$/);
  return m ? `+998 ${m[1]} ${m[2]} ${m[3]} ${m[4]}` : phone;
}

/** Kiritilgan matndan +998 dan keyingi 9 ta raqamni ajratadi (to'liq raqam joylansa ham). */
export function localPhoneDigits(value: string): string {
  const digits = value.replace(/\D/g, '');
  const hasCode = value.trim().startsWith('+998') || (digits.length > 9 && digits.startsWith('998'));
  return (hasCode ? digits.slice(3) : digits).slice(0, 9);
}

/** 901234567 -> 90 123 45 67 */
export function formatLocalPhone(digits: string): string {
  return [digits.slice(0, 2), digits.slice(2, 5), digits.slice(5, 7), digits.slice(7, 9)].filter(Boolean).join(' ');
}

export function initials(name?: string): string {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  return (parts.slice(0, 2).map((p) => p[0]).join('') || '?').toUpperCase();
}

export function formatDateTime(value: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Tashkent',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(value));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('day')}.${get('month')}.${get('year')} ${get('hour')}:${get('minute')}`;
}

/** Dispetcher uchun: to'lov qancha vaqtdan beri kutayotgani. */
export function timeAgo(value: string, now = Date.now()): string {
  const minutes = Math.floor((now - new Date(value).getTime()) / 60_000);
  if (minutes < 1) return 'hozirgina';
  if (minutes < 60) return `${minutes} daqiqa oldin`;
  if (minutes < 24 * 60) return `${Math.floor(minutes / 60)} soat oldin`;
  return formatDateTime(value);
}

export const STATUS_LABEL: Record<PaymentStatus, string> = {
  new: 'Kutilmoqda',
  in_progress: 'Tekshirilmoqda',
  completed: 'Tushirildi',
  rejected: 'Rad etildi',
};

export const EVENT_LABEL: Record<PaymentEvent['action'], string> = {
  created: 'yubordi',
  taken: 'oldi',
  completed: 'tushirdi',
  rejected: 'rad etdi',
  released: 'navbatga qaytardi',
};

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Ba'zi Telegram brauzerlarida clipboard API ishlamaydi.
    const area = document.createElement('textarea');
    area.value = text;
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    area.remove();
    return ok;
  }
}

export function haptic(type: 'success' | 'error' | 'warning'): void {
  window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred(type);
}

/** Telegram'ning tasdiqlash oynasi, u bo'lmasa brauzernikini ishlatadi. */
export function confirmAction(message: string): Promise<boolean> {
  const webApp = window.Telegram?.WebApp;
  if (webApp?.initData && webApp.showConfirm && webApp.isVersionAtLeast?.('6.2')) {
    return new Promise((resolve) => webApp.showConfirm!(message, resolve));
  }
  return Promise.resolve(window.confirm(message));
}

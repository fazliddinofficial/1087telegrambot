const TZ = 'Asia/Tashkent';
const TASHKENT_OFFSET_MS = 5 * 60 * 60 * 1000;

export function formatMoney(amount: number): string {
  return `${String(amount).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} so'm`;
}

export function formatDateTime(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('day')}.${get('month')}.${get('year')} ${get('hour')}:${get('minute')}`;
}

export function maskCard(number: string): string {
  return `${number.slice(0, 4)} **** **** ${number.slice(-4)}`;
}

/** Telegram HTML xabariga foydalanuvchi matnini xavfsiz qo'yish uchun. */
export function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Toshkent vaqti bo'yicha YYYY-MM-DD kunining boshini qaytaradi. */
export function tashkentDayStart(day: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const utc = Date.parse(`${day}T00:00:00.000Z`);
  return Number.isNaN(utc) ? null : new Date(utc - TASHKENT_OFFSET_MS);
}

/** Hozirgi Toshkent kunining boshi. */
export function startOfTodayTashkent(now = new Date()): Date {
  const local = new Date(now.getTime() + TASHKENT_OFFSET_MS);
  local.setUTCHours(0, 0, 0, 0);
  return new Date(local.getTime() - TASHKENT_OFFSET_MS);
}

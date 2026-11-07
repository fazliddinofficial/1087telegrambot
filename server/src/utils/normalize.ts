/** Telefonni +998XXXXXXXXX ko'rinishiga keltiradi; noto'g'ri bo'lsa null qaytaradi. */
export function normalizePhone(input: string): string | null {
  const digits = input.replace(/\D/g, '');
  if (digits.length === 9) return `+998${digits}`;
  if (digits.length === 12 && digits.startsWith('998')) return `+${digits}`;
  return null;
}

export const CAR_NUMBER_MAX = 20;

/**
 * Mashina raqami erkin yoziladi, shakli tekshirilmaydi. Qidiruv oson bo'lishi uchun
 * bo'sh joy va chiziqchalar olib tashlanadi, harflar kattalashtiriladi.
 */
export function normalizeCarNumber(input: string): string | null {
  const value = input.replace(/[\s-]/g, '').toUpperCase();
  return value.length > 0 && value.length <= CAR_NUMBER_MAX ? value : null;
}

export const TAXI_ID_MAX = 20;

/** Haydovchining taksi dasturidagi ID raqami: shakli noma'lum, shuning uchun erkin yoziladi. */
export function normalizeTaxiId(input: string): string | null {
  const value = input.replace(/\s/g, '').toUpperCase();
  return value.length > 0 && value.length <= TAXI_ID_MAX ? value : null;
}

/** Karta raqami: bo'sh joylarsiz 16 ta raqam. */
export function normalizeCardNumber(input: string): string | null {
  const digits = input.replace(/[\s-]/g, '');
  return /^\d{16}$/.test(digits) ? digits : null;
}

/** Foydalanuvchi matnini qidiruv uchun xavfsiz regexp'ga aylantiradi. */
export function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Rasm turini fayl boshidagi baytlardan aniqlaydi (kengaytmaga ishonilmaydi). */
export function detectImageType(buffer: Buffer): { mime: string; ext: string } | null {
  if (buffer.length > 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { mime: 'image/jpeg', ext: 'jpg' };
  }
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (buffer.length > png.length && png.every((byte, i) => buffer[i] === byte)) {
    return { mime: 'image/png', ext: 'png' };
  }
  return null;
}

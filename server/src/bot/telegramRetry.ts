import { Telegram } from 'telegraf';

const RETRYABLE_CODES = new Set(['ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED', 'EPIPE', 'EAI_AGAIN', 'ENOTFOUND']);

/** Faqat tarmoq uzilishi: Telegram'ning o'zi qaytargan xato (masalan 400) qayta yuborilmaydi. */
export function isNetworkError(err: unknown): boolean {
  const { type, code } = (err ?? {}) as { type?: string; code?: string };
  return type === 'system' && RETRYABLE_CODES.has(code ?? '');
}

export async function withNetworkRetry<T>(task: () => Promise<T>, delaysMs = [300, 1000]): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await task();
    } catch (err) {
      if (attempt >= delaysMs.length || !isNetworkError(err)) throw err;
      await new Promise((resolve) => setTimeout(resolve, delaysMs[attempt]));
    }
  }
}

/**
 * Telegraf har bir xabar uchun yangi Telegram obyekti yaratadi, shuning uchun qayta urinish
 * prototipga o'rnatiladi. getUpdates o'zining qayta urinishiga ega.
 */
export function installTelegramRetry(): void {
  const proto = Telegram.prototype as unknown as {
    callApi: (this: unknown, method: string, ...rest: unknown[]) => Promise<unknown>;
  };
  const original = proto.callApi;
  proto.callApi = function (method, ...rest) {
    if (method === 'getUpdates') return original.call(this, method, ...rest);
    return withNetworkRetry(() => original.call(this, method, ...rest));
  };
}

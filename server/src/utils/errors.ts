/** Mijozga ko'rsatiladigan xato: matni va kodi javobga chiqadi. */
export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

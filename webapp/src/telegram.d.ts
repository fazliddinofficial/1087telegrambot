interface TelegramWebApp {
  initData: string;
  colorScheme?: 'light' | 'dark';
  ready(): void;
  expand(): void;
  openTelegramLink(url: string): void;
  showConfirm?(message: string, callback: (confirmed: boolean) => void): void;
  HapticFeedback?: { notificationOccurred(type: 'success' | 'error' | 'warning'): void };
  isVersionAtLeast?(version: string): boolean;
  setHeaderColor?(color: string): void;
  setBackgroundColor?(color: string): void;
  onEvent?(event: 'themeChanged', handler: () => void): void;
}

interface Window {
  Telegram?: { WebApp?: TelegramWebApp };
}

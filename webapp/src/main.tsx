import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';

/** Ilova mavzusi Telegram'nikiga ergashadi, tepa panel rangi ham sahifaga moslanadi. */
function applyTheme(webApp: TelegramWebApp): void {
  if (!webApp.initData || !webApp.colorScheme) return;
  document.documentElement.dataset.theme = webApp.colorScheme;
  if (webApp.isVersionAtLeast?.('6.1')) {
    const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
    webApp.setHeaderColor?.(bg);
    webApp.setBackgroundColor?.(bg);
  }
}

/** Telegram skripti ilovadan keyin yuklanishi mumkin: bu qulayliklar uni kutmasdan qo'shiladi. */
function setupTelegram(): void {
  const webApp = window.Telegram?.WebApp;
  if (!webApp) return;
  webApp.ready();
  webApp.expand();
  applyTheme(webApp);
  webApp.onEvent?.('themeChanged', () => applyTheme(webApp));
}

if (window.Telegram?.WebApp) setupTelegram();
else document.getElementById('telegram-sdk')?.addEventListener('load', setupTelegram);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

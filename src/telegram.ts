export interface TelegramInitDataUnsafe {
  start_param?: string;
}

export interface TelegramWebApp {
  initData: string;
  initDataUnsafe: TelegramInitDataUnsafe;
  ready: () => void;
  expand?: () => void;
  close?: () => void;
}

declare global {
  interface Window {
    Telegram?: {
      WebApp?: TelegramWebApp;
    };
  }
}

/**
 * Initializes the Telegram WebApp when the page is opened inside Telegram.
 * The app may still be rendered outside Telegram so that local development
 * and the error state remain usable.
 */
export function initializeTelegramWebApp(): TelegramWebApp | null {
  if (typeof window === "undefined") {
    return null;
  }

  const webApp = window.Telegram?.WebApp;
  if (!webApp) {
    return null;
  }

  webApp.ready();
  webApp.expand?.();
  return webApp;
}

/**
 * This value is read from initDataUnsafe only as launch context for the UI.
 * Authentication must always use webApp.initData, which is signed by Telegram.
 */
export function getStartParam(webApp: TelegramWebApp | null): string | null {
  const startParam = webApp?.initDataUnsafe?.start_param;
  return typeof startParam === "string" && startParam.length > 0
    ? startParam
    : null;
}

export function createIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    const values = new Uint32Array(4);
    crypto.getRandomValues(values);
    return Array.from(values, (value) => value.toString(16).padStart(8, "0")).join("-");
  }

  return `miniapp-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

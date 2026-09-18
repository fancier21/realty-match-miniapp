export interface TelegramInitDataUnsafe {
  start_param?: string;
  user?: {
    id: number;
    first_name?: string;
    last_name?: string;
    username?: string;
    language_code?: string;
  };
}

export interface TelegramBackButton {
  isVisible: boolean;
  show: () => void;
  hide: () => void;
  onClick: (callback: () => void) => void;
  offClick: (callback: () => void) => void;
}

export interface TelegramWebApp {
  initData: string;
  initDataUnsafe: TelegramInitDataUnsafe;
  ready: () => void;
  expand?: () => void;
  close?: () => void;
  enableClosingConfirmation?: () => void;
  disableClosingConfirmation?: () => void;
  BackButton?: TelegramBackButton;
  colorScheme?: "light" | "dark";
  themeParams?: Record<string, string>;
  setHeaderColor?: (color: string) => void;
  setBackgroundColor?: (color: string) => void;
  onEvent?: (eventType: string, eventHandler: () => void) => void;
  offEvent?: (eventType: string, eventHandler: () => void) => void;
}

declare global {
  interface Window {
    Telegram?: {
      WebApp?: TelegramWebApp;
    };
  }
}

/**
 * Detects the active colorScheme from Telegram WebApp or falls back to system preference.
 */
export function getTelegramColorScheme(webApp: TelegramWebApp | null): "light" | "dark" {
  if (webApp?.colorScheme === "dark" || webApp?.colorScheme === "light") {
    return webApp.colorScheme;
  }
  if (typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: dark)").matches) {
    return "dark";
  }
  return "light";
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
 * Returns the current Telegram WebApp instance from window if available.
 */
export function getTelegramWebApp(): TelegramWebApp | null {
  if (typeof window !== "undefined" && window.Telegram?.WebApp) {
    return window.Telegram.WebApp;
  }
  return null;
}

/**
 * Retrieves Telegram WebApp initData string.
 * Priority:
 * 1. webApp.initData (populated by Telegram client)
 * 2. URL hash `#tgWebAppData=...` (fallback if Telegram script didn't populate it)
 * 3. URL query `?tgWebAppData=...` (fallback for custom iframe wrappers)
 */
export function getInitData(webApp: TelegramWebApp | null): string {
  if (webApp?.initData && webApp.initData.trim().length > 0) {
    return webApp.initData.trim();
  }

  if (typeof window !== "undefined") {
    try {
      const hash = window.location.hash.startsWith("#")
        ? window.location.hash.slice(1)
        : window.location.hash;
      if (hash) {
        const hashParams = new URLSearchParams(hash);
        const fromHash = hashParams.get("tgWebAppData");
        if (fromHash && fromHash.trim().length > 0) {
          return fromHash.trim();
        }
      }

      const urlParams = new URLSearchParams(window.location.search);
      const fromQuery = urlParams.get("tgWebAppData");
      if (fromQuery && fromQuery.trim().length > 0) {
        return fromQuery.trim();
      }
    } catch {
      // Ignore URL parsing issues
    }
  }

  return "";
}

/**
 * This value is read from initDataUnsafe or URL parameters only as launch context for the UI.
 * Authentication must always use webApp.initData, which is signed by Telegram.
 */
export function getStartParam(webApp: TelegramWebApp | null): string | null {
  const startParam = webApp?.initDataUnsafe?.start_param;
  if (typeof startParam === "string" && startParam.length > 0) {
    return startParam;
  }

  if (typeof window !== "undefined") {
    try {
      const urlParams = new URLSearchParams(window.location.search);
      const fromQuery = urlParams.get("tgWebAppStartParam") || urlParams.get("startapp");
      if (fromQuery && fromQuery.length > 0) {
        return fromQuery;
      }

      const hash = window.location.hash.startsWith("#")
        ? window.location.hash.slice(1)
        : window.location.hash;
      if (hash) {
        const hashParams = new URLSearchParams(hash);
        const fromHash = hashParams.get("tgWebAppStartParam") || hashParams.get("startapp");
        if (fromHash && fromHash.length > 0) {
          return fromHash;
        }
      }
    } catch {
      // Silently ignore URL parsing issues
    }
  }

  return null;
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


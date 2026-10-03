export interface TelegramInitDataUnsafe {
  start_param?: string;
  chat_type?: "sender" | "private" | "group" | "supergroup" | "channel";
  chat_instance?: string;
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
  showConfirm?: (message: string, callback?: (confirmed: boolean) => void) => void;
  openTelegramLink?: (url: string) => void;
  openLink?: (url: string, options?: { try_instant_view?: boolean }) => void;
  BackButton?: TelegramBackButton;
  colorScheme?: "light" | "dark";
  themeParams?: Record<string, string>;
  setHeaderColor?: (color: string) => void;
  setBackgroundColor?: (color: string) => void;
  requestWriteAccess?: (
    callback?: (allowed: boolean) => void,
  ) => void;
  enableVerticalSwipes?: () => void;
  disableVerticalSwipes?: () => void;
  isExpanded?: boolean;
  isActive?: boolean;
  viewportHeight?: number;
  viewportStableHeight?: number;
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
 * Detect Telegram color scheme.
 */
export function getTelegramColorScheme(
  webApp: TelegramWebApp | null,
): "light" | "dark" {
  if (
    webApp?.colorScheme === "dark" ||
    webApp?.colorScheme === "light"
  ) {
    return webApp.colorScheme;
  }

  if (
    typeof window !== "undefined" &&
    window.matchMedia?.(
      "(prefers-color-scheme: dark)",
    ).matches
  ) {
    return "dark";
  }

  return "light";
}

/**
 * Initialize Telegram Mini App.
 *
 * IMPORTANT:
 * - ready() is called.
 * - enableVerticalSwipes() is enabled when available.
 * - expand() is NEVER called here.
 * - close() is NEVER called automatically.
 *
 * The final presentation mode is controlled by Telegram itself
 * according to the Mini App launch context and client.
 */
export function initializeTelegramWebApp(): TelegramWebApp | null {
  const webApp = window.Telegram?.WebApp;
  if (!webApp) {
    return null;
  }

  webApp.ready();
  webApp.enableVerticalSwipes?.();
  return webApp;
}
/**
 * Get current Telegram WebApp instance.
 */
export function getTelegramWebApp(): TelegramWebApp | null {
  if (
    typeof window !== "undefined" &&
    window.Telegram?.WebApp
  ) {
    return window.Telegram.WebApp;
  }

  return null;
}

/**
 * Get signed Telegram initData.
 *
 * Authentication must use webApp.initData.
 * initDataUnsafe must never be used as authentication proof.
 */
export function getInitData(
  webApp: TelegramWebApp | null,
): string {
  if (
    webApp?.initData &&
    webApp.initData.trim().length > 0
  ) {
    return webApp.initData.trim();
  }

  if (typeof window !== "undefined") {
    try {
      const hash = window.location.hash.startsWith("#")
        ? window.location.hash.slice(1)
        : window.location.hash;

      if (hash) {
        const hashParams = new URLSearchParams(hash);
        const fromHash =
          hashParams.get("tgWebAppData");

        if (
          fromHash &&
          fromHash.trim().length > 0
        ) {
          return fromHash.trim();
        }
      }

      const urlParams = new URLSearchParams(
        window.location.search,
      );

      const fromQuery =
        urlParams.get("tgWebAppData");

      if (
        fromQuery &&
        fromQuery.trim().length > 0
      ) {
        return fromQuery.trim();
      }
    } catch {
      // Ignore malformed URL data.
    }
  }

  return "";
}

/**
 * Get start parameter.
 *
 * This is launch context only.
 * It is NOT an authentication mechanism.
 */
export function getStartParam(
  webApp: TelegramWebApp | null,
): string | null {
  const startParam =
    webApp?.initDataUnsafe?.start_param;

  if (
    typeof startParam === "string" &&
    startParam.length > 0
  ) {
    return startParam;
  }

  if (typeof window !== "undefined") {
    try {
      const urlParams = new URLSearchParams(
        window.location.search,
      );

      const fromQuery =
        urlParams.get("tgWebAppStartParam") ||
        urlParams.get("startapp");

      if (
        fromQuery &&
        fromQuery.length > 0
      ) {
        return fromQuery;
      }

      const hash = window.location.hash.startsWith("#")
        ? window.location.hash.slice(1)
        : window.location.hash;

      if (hash) {
        const hashParams = new URLSearchParams(hash);

        const fromHash =
          hashParams.get("tgWebAppStartParam") ||
          hashParams.get("startapp");

        if (
          fromHash &&
          fromHash.length > 0
        ) {
          return fromHash;
        }
      }
    } catch {
      // Ignore malformed URL data.
    }
  }

  return null;
}

export function createIdempotencyKey(): string {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }

  if (
    typeof crypto !== "undefined" &&
    typeof crypto.getRandomValues === "function"
  ) {
    const values = new Uint32Array(4);

    crypto.getRandomValues(values);

    return Array.from(
      values,
      (value) =>
        value.toString(16).padStart(8, "0"),
    ).join("-");
  }

  return `miniapp-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2)}`;
}

/**
 * Open Telegram link.
 */
export function openTelegramLink(
  webApp: TelegramWebApp | null,
  url: string,
): void {
  if (
    webApp &&
    typeof webApp.openTelegramLink === "function"
  ) {
    webApp.openTelegramLink(url);
    return;
  }

  if (
    webApp &&
    typeof webApp.openLink === "function"
  ) {
    webApp.openLink(url);
    return;
  }

  if (typeof window !== "undefined") {
    window.open(
      url,
      "_blank",
      "noopener,noreferrer",
    );
  }
}

/**
 * Request permission for bot direct messages.
 */
export function requestTelegramWriteAccess(
  webApp: TelegramWebApp | null,
  timeoutMs = 10000,
): Promise<boolean> {
  if (
    !webApp ||
    typeof webApp.requestWriteAccess !== "function"
  ) {
    return Promise.resolve(false);
  }

  return new Promise((resolve) => {
    let settled = false;

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        resolve(false);
      }
    }, timeoutMs);

    try {
      webApp.requestWriteAccess?.((allowed) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve(Boolean(allowed));
        }
      });
    } catch {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolve(false);
      }
    }
  });
}

import {
  AlertCircle,
  ArrowRight,
  Bell,
  Calendar,
  Check,
  ChevronDown,
  ChevronLeft,
  ExternalLink,
  Heart,
  Home,
  MapPin,
  Search,
  ShieldCheck,
  Trash2,
  User,
} from "lucide-react";
import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type CSSProperties,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import {
  ApiError,
  checkSubscription,
  fetchMyApplications,
  getUserFacingApiError,
  submitPublishRequest,
  withdrawApplication,
  type ApiErrorKind,
  type ApplicationSummary,
  type DirectionHint,
} from "./api";
import { useKeyboardInset } from "./useKeyboardInset";
import {
  createIdempotencyKey,
  getInitData,
  getStartParam,
  getTelegramColorScheme,
  getTelegramWebApp,
  openTelegramLink,
  requestTelegramWriteAccess,
  type TelegramWebApp,
} from "./telegram";

const MIN_TEXT_LENGTH = 10;
const MAX_TEXT_LENGTH = 4000;
const DEFAULT_CHANNEL_URL = "https://t.me/RealtyMatch";

/** Skip-link target: the screen's content section, i.e. right after the header. */
const SCREEN_CONTENT_ID = "screen-content";

const APPS_TABS = ["active", "archive"] as const;
type AppsTab = (typeof APPS_TABS)[number];
const appsTabId = (tab: AppsTab) => `apps-tab-${tab}`;
const APPS_TABPANEL_ID = "apps-tabpanel";

function skipToContent(event: ReactMouseEvent<HTMLAnchorElement>) {
  // Never let the browser follow the "#..." link: Telegram keeps its launch
  // params (tgWebAppData, ...) in location.hash.
  event.preventDefault();
  document.getElementById(SCREEN_CONTENT_ID)?.focus();
}

type ColorScheme = "light" | "dark";

// Only used if the CSS variable can't be read (e.g. unsupported value format).
const THEME_FALLBACK_BG: Record<ColorScheme, string> = { light: "#f8f6f2", dark: "#0F131C" };

/**
 * The colour the page background is actually painted with (`--app-bg` is the
 * base layer of the body gradient). Telegram's header/background are set from
 * it so they can't drift from the CSS, nor from the user's Telegram theme.
 */
function readAppBackgroundColor(scheme: ColorScheme): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue("--app-bg").trim();
  return /^#[0-9a-f]{6}$/i.test(value) ? value : THEME_FALLBACK_BG[scheme];
}

const WITHDRAW_FALLBACK_ERROR = "Не удалось отписаться от заявки. Попробуйте ещё раз.";
// Only these error kinds have a message that makes sense for a withdraw action;
// everything else (e.g. request_failed) would read "не удалось отправить заявку".
const WITHDRAW_ERROR_KINDS_WITH_OWN_MESSAGE: ReadonlySet<ApiErrorKind> = new Set<ApiErrorKind>([
  "timeout",
  "network_error",
]);

function getWithdrawErrorMessage(error: unknown): string {
  return error instanceof ApiError && WITHDRAW_ERROR_KINDS_WITH_OWN_MESSAGE.has(error.kind)
    ? getUserFacingApiError(error)
    : WITHDRAW_FALLBACK_ERROR;
}

interface AppProps {
  webApp: TelegramWebApp | null;
}

type Screen =
  | "direction"
  | "form"
  | "submitting"
  | "success"
  | "error"
  | "account";

const batumiCardSrc = `${import.meta.env.BASE_URL}batumi-eu-square.jpeg`;
const batumiSkylineSrc = `${import.meta.env.BASE_URL}batumi-skyline.png`;

function countUnicodeCharacters(value: string): number {
  return Array.from(value).length;
}

function limitUnicodeCharacters(value: string, maxLength: number): string {
  return Array.from(value).slice(0, maxLength).join("");
}

function countTags(value: string): number {
  const hashtags = value.match(/#[\p{L}\p{N}_]+/gu);
  let count = hashtags ? hashtags.length : 0;
  const keywords = [
    "1+1",
    "2+1",
    "3+1",
    "студия",
    "батуми",
    "бульвар",
    "море",
    "аренда",
    "сдам",
    "сниму",
    "купить",
    "продам",
  ];
  const lower = value.toLowerCase();
  for (const kw of keywords) {
    if (lower.includes(kw)) {
      count++;
    }
  }
  return Math.min(count, 100);
}

function getValidationError(text: string): string | null {
  const contentLength = countUnicodeCharacters(text.trim());

  if (contentLength === 0) {
    return "Пожалуйста, опишите вашу заявку.";
  }

  if (contentLength < MIN_TEXT_LENGTH) {
    return "Опишите заявку подробнее (минимум 10 символов).";
  }

  if (countUnicodeCharacters(text) > MAX_TEXT_LENGTH) {
    return `Заявка не должна быть длиннее ${MAX_TEXT_LENGTH} символов.`;
  }

  return null;
}

function formatDate(dateString: string): string {
  try {
    const d = new Date(dateString);
    if (isNaN(d.getTime())) return "";
    const day = String(d.getDate()).padStart(2, "0");
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const year = d.getFullYear();
    return `${day}.${month}.${year}`;
  } catch {
    return "";
  }
}

type ApplicationsState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; items: ApplicationSummary[] };

// Stable reference so memoized selectors don't recompute while there is no data.
const EMPTY_APPLICATIONS: ApplicationSummary[] = [];

interface SubmitOptions {
  /** Idempotency key to use; defaults to the current one. */
  requestKey?: string;
  /**
   * Set when we are re-trying after `subscription_required`:
   *  - "manual": user tapped "Я подписался" (show the warning if still not subscribed)
   *  - "auto":   user returned to the Mini App (stay silent if still not subscribed)
   */
  recheck?: "manual" | "auto";
}

const KNOWN_STATUSES = ["active", "withdrawn", "expired", "archived", "in_progress"] as const;
type KnownStatus = (typeof KNOWN_STATUSES)[number];
type EffectiveStatus = KnownStatus | "unknown";

interface StatusMeta {
  label: string;
  className: string;
  tab: "active" | "archive";
  canWithdraw: boolean;
}

// Single source of truth for how an application is labelled, which tab it lives
// in and whether it can be withdrawn. Card and tabs must never disagree.
const STATUS_META: Record<EffectiveStatus, StatusMeta> = {
  active: { label: "Активна", className: "status-badge--active", tab: "active", canWithdraw: true },
  withdrawn: { label: "Отозвана", className: "status-badge--withdrawn", tab: "archive", canWithdraw: false },
  expired: { label: "Истекла", className: "status-badge--expired", tab: "archive", canWithdraw: false },
  archived: { label: "В архиве", className: "status-badge--archived", tab: "archive", canWithdraw: false },
  // NOTE: "in_progress" has always been shown in the archive tab; kept as is.
  in_progress: { label: "В работе", className: "status-badge--in_progress", tab: "archive", canWithdraw: false },
  // Unknown (e.g. newly introduced) statuses must not masquerade as "active".
  unknown: { label: "Статус неизвестен", className: "status-badge--archived", tab: "archive", canWithdraw: false },
};

function isKnownStatus(value: unknown): value is KnownStatus {
  return typeof value === "string" && (KNOWN_STATUSES as readonly string[]).includes(value);
}

function getEffectiveStatus(app: ApplicationSummary): EffectiveStatus {
  if (app.status) {
    return isKnownStatus(app.status) ? app.status : "unknown";
  }

  // Legacy payloads without `status`: derive it from leads. An application
  // with no leads yet is new, hence active; otherwise it is active while at
  // least one lead is. It is never dropped from both tabs.
  const leads = app.leads ?? [];
  const hasActiveLead = leads.some(
    (lead) => lead.status === "active" || lead.lifecycle_status === "active",
  );
  return leads.length === 0 || hasActiveLead ? "active" : "archived";
}

interface ApplicationCardProps {
  app: ApplicationSummary;
  isWithdrawing: boolean;
  onWithdraw: (submissionId: string) => void;
}

const ApplicationCard = memo(function ApplicationCard({
  app,
  isWithdrawing,
  onWithdraw,
}: ApplicationCardProps) {
  const dateStr = formatDate(app.created_at);
  const meta = STATUS_META[getEffectiveStatus(app)];

  return (
    <div role="listitem">
      <article className="application-card">
        <div className="application-card-header">
          <span className={`status-badge ${meta.className}`}>{meta.label}</span>
        </div>

        <p className="application-card-text">{app.text}</p>

        <div className="application-card-footer">
          <div className="application-card-date">
            <Calendar className="app-icon app-icon--xs" />
            <span>{dateStr}</span>
          </div>

          {meta.canWithdraw && (
            <button
              type="button"
              className="card-delete-btn"
              disabled={isWithdrawing}
              onClick={() => void onWithdraw(app.submission_id)}
              aria-label={
                isWithdrawing ? "Отписываемся от заявки…" : `Отписаться от заявки от ${dateStr}`
              }
            >
              <Trash2 className="app-icon app-icon--xs" />
              <span>{isWithdrawing ? "Отписываемся..." : "Отписаться"}</span>
            </button>
          )}
        </div>
      </article>
    </div>
  );
});

function App({ webApp: initialWebApp }: AppProps) {
  const [screen, setScreen] = useState<Screen>("direction");
  const [direction, setDirection] = useState<DirectionHint | null>(null);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [retryNeedsNewIdempotencyKey, setRetryNeedsNewIdempotencyKey] = useState(false);
  const [idempotencyKey, setIdempotencyKey] = useState(createIdempotencyKey);
  const [textTruncated, setTextTruncated] = useState(false);

  // My Applications state
  // Starts as "loading": entering the screen goes through openAccount(), which
  // also resets it, so the empty state is never flashed before the fetch starts.
  const [appsState, setAppsState] = useState<ApplicationsState>({ status: "loading" });
  const [appsReloadToken, setAppsReloadToken] = useState(0);
  const [activeTab, setActiveTab] = useState<AppsTab>("active");
  const [withdrawingId, setWithdrawingId] = useState<string | null>(null);
  const [accountError, setAccountError] = useState<string | null>(null);

  // Inline subscription banner state (replaces modal popup)
  const [subscriptionRequired, setSubscriptionRequired] = useState(false);
  const [subscriptionChannelUrl, setSubscriptionChannelUrl] = useState(DEFAULT_CHANNEL_URL);
  const [isCheckingSubscription, setIsCheckingSubscription] = useState(false);
  const [subscriptionCheckFailed, setSubscriptionCheckFailed] = useState(false);

  const submitInFlightRef = useRef(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const submitButtonRef = useRef<HTMLButtonElement | null>(null);
  const bottomAnchorRef = useRef<HTMLDivElement | null>(null);

  const activeWebApp = getTelegramWebApp() ?? initialWebApp;

  // Do not call webApp.expand() anywhere: Telegram should control the native
  // bottom sheet itself so the user can minimize it with a vertical swipe.
  const { isKeyboardOpen, keyboardHeight, handleTextareaFocus, handleTextareaBlur, dismissKeyboard } =
    useKeyboardInset({
      active: screen === "form",
      resetKey: screen,
      webApp: activeWebApp,
      textareaRef,
      submitButtonRef,
      bottomAnchorRef,
    });
  const initData = getInitData(activeWebApp);
  const isInsideTelegram = initData.length > 0;
  const startParam = getStartParam(activeWebApp);

  const charCount = countUnicodeCharacters(text);
  const tagCount = countTags(text);
  const isSubmitBusy = screen === "submitting" || isCheckingSubscription;

  // Detect whether the Mini App was opened from the channel itself
  const isFromChannel = activeWebApp?.initDataUnsafe?.chat_type === "channel";

  // Fetch applications when entering the My Applications screen (or on retry).
  // `cancelled` guards against stale responses after leaving the screen.
  useEffect(() => {
    if (screen !== "account") {
      return;
    }

    let cancelled = false;
    fetchMyApplications(initData)
      .then((res) => {
        if (cancelled) {
          return;
        }
        // fetchMyApplications never rejects: HTTP/network failures are reported
        // as { success: false }, which must not be shown as "no applications".
        setAppsState(
          res.success
            ? { status: "ready", items: res.applications ?? [] }
            : { status: "error" },
        );
      })
      .catch(() => {
        if (!cancelled) {
          setAppsState({ status: "error" });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [screen, initData, appsReloadToken]);

  const tgUser = useMemo(() => activeWebApp?.initDataUnsafe?.user, [activeWebApp]);
  const userName = useMemo(() => {
    if (!tgUser) return null;
    return tgUser.first_name
      ? `${tgUser.first_name}${tgUser.last_name ? ` ${tgUser.last_name}` : ""}`
      : tgUser.username
      ? `@${tgUser.username}`
      : null;
  }, [tgUser]);

  const applications = appsState.status === "ready" ? appsState.items : EMPTY_APPLICATIONS;

  const activeApps = useMemo(
    () => applications.filter((app) => STATUS_META[getEffectiveStatus(app)].tab === "active"),
    [applications],
  );

  const archivedApps = useMemo(
    () => applications.filter((app) => STATUS_META[getEffectiveStatus(app)].tab === "archive"),
    [applications],
  );

  const displayedApps = activeTab === "active" ? activeApps : archivedApps;

  const handleWithdraw = useCallback(async (submissionId: string) => {
    const confirmMsg = "Отписаться от этой заявки?\nВы больше не будете получать по ней предложения.";
    const doWithdraw = async () => {
      setAccountError(null);
      setWithdrawingId(submissionId);
      try {
        await withdrawApplication(initData, submissionId);
        setAppsState((prev) =>
          prev.status === "ready"
            ? {
                status: "ready",
                items: prev.items.map((item) =>
                  item.submission_id === submissionId
                    ? { ...item, status: "withdrawn" }
                    : item,
                ),
              }
            : prev,
        );
      } catch (err) {
        // `error` is only rendered on the form/error screens, so use a
        // dedicated message that is visible on the account screen.
        setAccountError(getWithdrawErrorMessage(err));
      } finally {
        setWithdrawingId(null);
      }
    };

    if (activeWebApp?.showConfirm) {
      activeWebApp.showConfirm(confirmMsg, (confirmed) => {
        if (confirmed) {
          void doWithdraw();
        }
      });
    } else {
      if (typeof window !== "undefined" && window.confirm(confirmMsg)) {
        void doWithdraw();
      }
    }
  }, [activeWebApp, initData]);

  // Sync theme with Telegram WebApp and system preference.
  // Layout effect: data-theme must be set before the first paint of React content.
  // The attribute is the single source of truth for CSS (no extra theme classes).
  useLayoutEffect(() => {
    const updateTheme = () => {
      const scheme = getTelegramColorScheme(activeWebApp);
      document.documentElement.dataset.theme = scheme;

      const color = readAppBackgroundColor(scheme);
      try {
        activeWebApp?.setHeaderColor?.(color);
        activeWebApp?.setBackgroundColor?.(color);
      } catch {
        // Ignore if Telegram API throws in unsupported client
      }
    };

    updateTheme();

    if (activeWebApp?.onEvent) {
      activeWebApp.onEvent("themeChanged", updateTheme);
    }

    const mediaQuery = typeof window !== "undefined" ? window.matchMedia?.("(prefers-color-scheme: dark)") : null;
    const handleMediaChange = () => {
      if (!activeWebApp?.colorScheme) {
        updateTheme();
      }
    };
    mediaQuery?.addEventListener?.("change", handleMediaChange);

    return () => {
      activeWebApp?.offEvent?.("themeChanged", updateTheme);
      mediaQuery?.removeEventListener?.("change", handleMediaChange);
    };
  }, [activeWebApp]);

  // Keyboard support for the tabs (WAI-ARIA tabs pattern, automatic activation).
  function handleTabKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    const current = APPS_TABS.indexOf(activeTab);
    let next: number;
    switch (event.key) {
      case "ArrowRight":
        next = (current + 1) % APPS_TABS.length;
        break;
      case "ArrowLeft":
        next = (current - 1 + APPS_TABS.length) % APPS_TABS.length;
        break;
      case "Home":
        next = 0;
        break;
      case "End":
        next = APPS_TABS.length - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    setActiveTab(APPS_TABS[next]);
    document.getElementById(appsTabId(APPS_TABS[next]))?.focus();
  }

  // Move focus to the new screen's heading, so screen-reader and keyboard users land
  // at the top of the new content instead of on a button that no longer exists.
  // Skipped on first render and while the form cycles form <-> submitting (the form stays
  // mounted there and the user's focus is on the submit button).
  const previousScreenRef = useRef<Screen>(screen);
  useEffect(() => {
    const previous = previousScreenRef.current;
    previousScreenRef.current = screen;
    if (previous === screen) {
      return;
    }
    const staysOnForm =
      (previous === "form" || previous === "submitting") &&
      (screen === "form" || screen === "submitting");
    if (staysOnForm) {
      return;
    }
    document.querySelector<HTMLElement>("main h1")?.focus({ preventScroll: true });
  }, [screen]);

  // Telegram Native BackButton integration
  useEffect(() => {
    const backButton = activeWebApp?.BackButton;
    if (!backButton) {
      return;
    }

    if (screen === "form" || screen === "account") {
      backButton.show();
      const onBack = () => {
        goBackToDirection();
      };
      backButton.onClick(onBack);
      return () => {
        backButton.offClick(onBack);
        backButton.hide();
      };
    } else {
      backButton.hide();
    }
  }, [screen, activeWebApp]);

  // Telegram Closing Confirmation
  useEffect(() => {
    if (!activeWebApp?.enableClosingConfirmation) {
      return;
    }

    if (text.trim().length > 0 && screen === "form") {
      activeWebApp.enableClosingConfirmation();
    } else {
      activeWebApp.disableClosingConfirmation?.();
    }
  }, [text, screen, activeWebApp]);

  function chooseDirection(nextDirection: DirectionHint) {
    if (direction !== null && direction !== nextDirection) {
      setText("");
      setTextTruncated(false);
    }
    setDirection(nextDirection);
    setScreen("form");
    setError(null);
    setRetryNeedsNewIdempotencyKey(false);
    setIdempotencyKey(createIdempotencyKey());
  }

  function handleSubmitButtonPress() {
    // aria-disabled (not `disabled`) keeps focus on the button, so the click itself must be guarded.
    if (isSubmitBusy) {
      return;
    }
    dismissKeyboard();
    void performSubmit({ recheck: subscriptionRequired ? "manual" : undefined });
  }

  function handleTextChange(event: ChangeEvent<HTMLTextAreaElement>) {
    const nextText = limitUnicodeCharacters(event.target.value, MAX_TEXT_LENGTH);
    setText(nextText);
    // Pasting/typing past the limit silently cuts the text; tell the user (and screen readers).
    setTextTruncated(nextText !== event.target.value);
    if (error) {
      setError(null);
    }
    setRetryNeedsNewIdempotencyKey(false);

    if (nextText !== text) {
      setIdempotencyKey(createIdempotencyKey());
    }
  }

  function openAccount() {
    setAccountError(null);
    setAppsState({ status: "loading" });
    setScreen("account");
  }

  function reloadApplications() {
    setAccountError(null);
    setAppsState({ status: "loading" });
    setAppsReloadToken((token) => token + 1);
  }

  function goBackToDirection() {
    if (screen === "submitting") {
      return;
    }

    setError(null);
    setAccountError(null);
    setSubscriptionRequired(false);
    setSubscriptionCheckFailed(false);
    setRetryNeedsNewIdempotencyKey(false);
    setScreen("direction");
  }

  function editSubmission() {
    setError(null);
    setRetryNeedsNewIdempotencyKey(false);
    setScreen("form");
  }

  function retrySubmission() {
    const requestKey = retryNeedsNewIdempotencyKey
      ? createIdempotencyKey()
      : idempotencyKey;
    if (requestKey !== idempotencyKey) {
      setIdempotencyKey(requestKey);
    }
    setRetryNeedsNewIdempotencyKey(false);
    void performSubmit({ requestKey });
  }

  // The one and only submit path (initial send, manual "Я подписался" and the
  // silent re-check on return from the channel), so validation and guards can't diverge.
  async function performSubmit({ requestKey = idempotencyKey, recheck }: SubmitOptions = {}) {
    if (submitInFlightRef.current) {
      return;
    }

    if (!direction) {
      if (!recheck) {
        setScreen("direction");
      }
      return;
    }

    // For the silent re-check we never surface validation problems: the user
    // will see them on the next explicit tap.
    const validationError = getValidationError(text);
    if (validationError) {
      if (recheck === "auto") {
        return;
      }
      setError(validationError);
      setScreen("form");
      return;
    }

    const currentInitData = getInitData(activeWebApp);
    if (!currentInitData) {
      if (recheck === "auto") {
        return;
      }
      setError("Откройте приложение через Telegram и попробуйте ещё раз.");
      setScreen("error");
      return;
    }

    // Telegram omits start_param when the Main Mini App is opened from the
    // bot profile/menu. The backend verifies initData and accepts that signed
    // launch path, while still rejecting an explicitly unexpected parameter.
    const effectiveStartParam = startParam ?? "publish";
    if (effectiveStartParam !== "publish") {
      if (recheck === "auto") {
        return;
      }
      setError("Откройте приложение через кнопку «Подать заявку».");
      setScreen("error");
      return;
    }

    submitInFlightRef.current = true;
    setError(null);
    if (recheck) {
      setIsCheckingSubscription(true);
      if (recheck === "manual") {
        setSubscriptionCheckFailed(false);
      }
    } else {
      setScreen("submitting");
    }

    try {
      if (recheck) {
        // Cheap, side-effect-free probe first. Re-POSTing the whole submission just to
        // learn that the user still hasn't subscribed would, on every return to the app,
        // hit the publish endpoint and re-open the write-access dialog.
        const subscription = await checkSubscription(currentInitData);
        if (subscription.success && !subscription.is_subscribed) {
          if (recheck === "manual") {
            setSubscriptionCheckFailed(true);
          }
          setSubscriptionChannelUrl(subscription.channel_url);
          return;
        }
        // Subscribed - or the probe itself failed (success: false). In both cases the
        // publish request below is authoritative and surfaces any real problem.
      }

      // Request write access so the bot can reliably send DM notifications.
      // If permission was already given, Telegram proceeds silently without any modal.
      // requestTelegramWriteAccess never rejects and settles within its own timeout (telegram.ts).
      await requestTelegramWriteAccess(activeWebApp);

      await submitPublishRequest(
        {
          init_data: currentInitData,
          direction_hint: direction,
          text,
          start_param: effectiveStartParam,
        },
        requestKey,
      );

      activeWebApp?.disableClosingConfirmation?.();
      setSubscriptionRequired(false);
      setSubscriptionCheckFailed(false);
      setScreen("success");
    } catch (requestError) {
      if (requestError instanceof ApiError && requestError.kind === "subscription_required") {
        if (recheck) {
          if (recheck === "manual") {
            setSubscriptionCheckFailed(true);
          }
        } else {
          setSubscriptionChannelUrl(requestError.channelUrl || DEFAULT_CHANNEL_URL);
          setSubscriptionRequired(true);
          setSubscriptionCheckFailed(false);
          setScreen("form");
        }
        return;
      }

      setSubscriptionRequired(false);
      setError(getUserFacingApiError(requestError));
      setRetryNeedsNewIdempotencyKey(
        requestError instanceof ApiError && requestError.kind === "idempotency_conflict",
      );
      setScreen("error");
    } finally {
      submitInFlightRef.current = false;
      if (recheck) {
        setIsCheckingSubscription(false);
      }
    }
  }

  // Always points at the latest performSubmit. Listeners registered once (like
  // visibilitychange below) go through it, so they can never submit stale
  // text / direction / idempotency key from an old render.
  const submitRef = useRef(performSubmit);
  useEffect(() => {
    submitRef.current = performSubmit;
  });

  // Auto-recheck subscription silently when user returns to the Mini App
  // (e.g. after swiping down to subscribe in the channel).
  // If still not subscribed, we stay quiet and do NOT show the warning message
  // until the user explicitly taps "Я подписался".
  useEffect(() => {
    if (!subscriptionRequired || screen !== "form") return;

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void submitRef.current({ recheck: "auto" });
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [subscriptionRequired, screen]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    handleSubmitButtonPress();
  }

  function closeApp() {
    activeWebApp?.disableClosingConfirmation?.();
    if (activeWebApp?.close) {
      activeWebApp.close();
      return;
    }

    setScreen("direction");
    setDirection(null);
    setText("");
    setError(null);
  }

  // =========================================================
  // Screen 3: Success Confirmation
  // =========================================================
  if (screen === "success") {
    return (
      <main id="main-content" className="app-shell" tabIndex={-1}>
        <section className="success-screen" aria-labelledby="success-heading-title">
          <div className="success-badge-circle" aria-hidden="true">
            <Check className="app-icon app-icon--xl" strokeWidth={2.8} />
          </div>

          <h1 id="success-heading-title" className="success-title" tabIndex={-1}>Заявка принята!</h1>

          <div className="success-description-block">
            <p>
              {direction === "offer"
                ? "Мы сохранили параметры объекта и подключаем поиск клиентов."
                : "Мы сохранили ваши критерии и уже ведём подбор."}
            </p>
            <p>
              Мы пришлём уведомление, как только появятся первые совпадения.
            </p>
          </div>

          <div className="batumi-skyline-wrapper">
            <img
              src={batumiSkylineSrc}
              alt="Панорама города Батуми"
              className="batumi-skyline-img"
            />
            <div className="location-city-capsule" aria-hidden="true">
              <MapPin className="app-icon app-icon--xs" />
              <span>Батуми</span>
              <ArrowRight className="app-icon app-icon--xs" />
            </div>
          </div>

          <button
            className="pill-cta-btn"
            type="button"
            onClick={closeApp}
            aria-label="Закрыть приложение"
          >
            Закрыть
          </button>
        </section>
      </main>
    );
  }

  // =========================================================
  // Screen 4: Error State
  // =========================================================
  if (screen === "error") {
    return (
      <main id="main-content" className="app-shell" tabIndex={-1}>
        <section className="error-screen" aria-labelledby="error-heading-title">
          <div className="error-badge-circle" aria-hidden="true">
            <AlertCircle className="app-icon app-icon--xl" />
          </div>

          <h1 id="error-heading-title" className="error-title" tabIndex={-1}>Не получилось отправить</h1>

          <p className="error-description">
            {error ?? "Попробуйте ещё раз."}
          </p>

          <div className="error-actions-group">
            <button
              className="pill-cta-btn"
              type="button"
              onClick={retrySubmission}
              aria-label="Повторить отправку заявки"
            >
              Повторить <ArrowRight className="app-icon app-icon--sm btn-arrow" />
            </button>
            <button
              className="secondary-pill-btn"
              type="button"
              onClick={editSubmission}
              aria-label="Вернуться к редактированию заявки"
            >
              Изменить заявку
            </button>
          </div>
        </section>
      </main>
    );
  }

  // =========================================================
  // Screen 5: Account ("Мой аккаунт")
  // =========================================================
  if (screen === "account") {
    return (
      <main id="main-content" className="app-shell" tabIndex={-1}>
        <a href={`#${SCREEN_CONTENT_ID}`} className="skip-link" onClick={skipToContent}>
          Перейти к основному содержимому
        </a>

        {/* Top Header */}
        <header className="app-header">
          <div className="brand-header-left">
            <button
              className="header-back-btn"
              type="button"
              onClick={goBackToDirection}
              aria-label="Назад к выбору роли"
            >
              <ChevronLeft className="app-icon app-icon--md" />
            </button>
            <div className="brand-logo-text">
              <span>REALTY</span>
              <span>MATCH</span>
            </div>
          </div>

          <div className="brand-header-right">
            <span className="location-selector-pill">
              <span className="visually-hidden">Регион: </span>
              <span>Батуми</span>
              {/*<ChevronDown className="app-icon app-icon--xs chevron-icon" />*/}
            </span>

            <button
              className="header-account-btn active"
              aria-current="page"
              type="button"
              onClick={goBackToDirection}
              aria-label="Мои заявки и аккаунт"
              title="Мои заявки"
            >
              <User className="app-icon app-icon--md" />
            </button>
          </div>
        </header>

        <section id={SCREEN_CONTENT_ID} tabIndex={-1} className="account-screen" aria-labelledby="my-apps-heading">
          <div className="my-apps-header-block">
            {userName && (
              <div className="user-profile-badge">
                <User className="app-icon app-icon--xs" />
                <span>{userName}</span>
              </div>
            )}
            <h1 id="my-apps-heading" className="my-apps-title" tabIndex={-1}>
              Мои заявки
            </h1>
          </div>

          {/* Segmented Control Tabs */}
          <div
            className="segmented-tab-row"
            role="tablist"
            aria-label="Фильтр заявок"
            onKeyDown={handleTabKeyDown}
          >
            <button
              type="button"
              role="tab"
              id={appsTabId("active")}
              aria-selected={activeTab === "active"}
              aria-controls={APPS_TABPANEL_ID}
              tabIndex={activeTab === "active" ? 0 : -1}
              className={`segmented-tab-item ${activeTab === "active" ? "active" : ""}`}
              onClick={() => setActiveTab("active")}
            >
              <span>Активные</span>
              {activeApps.length > 0 && (
                <span className="segmented-tab-count">({activeApps.length})</span>
              )}
            </button>
            <button
              type="button"
              role="tab"
              id={appsTabId("archive")}
              aria-selected={activeTab === "archive"}
              aria-controls={APPS_TABPANEL_ID}
              tabIndex={activeTab === "archive" ? 0 : -1}
              className={`segmented-tab-item ${activeTab === "archive" ? "active" : ""}`}
              onClick={() => setActiveTab("archive")}
            >
              <span>Архив</span>
              {archivedApps.length > 0 && (
                <span className="segmented-tab-count">({archivedApps.length})</span>
              )}
            </button>
          </div>

          {accountError && (
            <p className="account-error-text" role="alert">
              {accountError}
            </p>
          )}

          {/* Applications List */}
          <div
            role="tabpanel"
            id={APPS_TABPANEL_ID}
            aria-labelledby={appsTabId(activeTab)}
            tabIndex={0}
          >
            {appsState.status === "loading" ? (
              <div className="empty-applications-card" role="status">
                <p className="empty-applications-text">Загрузка ваших заявок...</p>
              </div>
            ) : appsState.status === "error" ? (
              <div className="empty-applications-card" role="alert">
                <div className="empty-applications-icon" aria-hidden="true">
                  <AlertCircle className="app-icon app-icon--lg" />
                </div>
                <h2 className="empty-applications-title">Не удалось загрузить заявки</h2>
                <p className="empty-applications-text">
                  Проверьте соединение и попробуйте ещё раз.
                </p>
                <button type="button" className="pill-cta-btn" onClick={reloadApplications}>
                  Повторить <ArrowRight className="app-icon app-icon--sm btn-arrow" />
                </button>
              </div>
            ) : displayedApps.length > 0 ? (
              <div className="applications-list" role="list">
                {displayedApps.map((app) => (
                  <ApplicationCard
                    key={app.submission_id}
                    app={app}
                    isWithdrawing={withdrawingId === app.submission_id}
                    onWithdraw={handleWithdraw}
                  />
                ))}
              </div>
            ) : (
              <div className="empty-applications-card">
                <div className="empty-applications-icon" aria-hidden="true">
                  <Search className="app-icon app-icon--lg" />
                </div>
                <h2 className="empty-applications-title">
                  {activeTab === "active" ? "Нет активных заявок" : "Архив пуст"}
                </h2>
                <p className="empty-applications-text">
                  {activeTab === "active"
                    ? "У вас пока нет активных заявок. Вы можете создать новую прямо сейчас."
                    : "У вас пока нет архивных заявок."}
                </p>
                {activeTab === "active" && (
                  <button
                    type="button"
                    className="pill-cta-btn"
                    onClick={() => setScreen("direction")}
                  >
                    Подать заявку <ArrowRight className="app-icon app-icon--sm btn-arrow" />
                  </button>
                )}
              </div>
            )}
          </div>
        </section>
      </main>
    );
  }

  // =========================================================
  // Screens 1 & 2
  // =========================================================
  return (
    <main id="main-content" className="app-shell" tabIndex={-1}>
      <a href={`#${SCREEN_CONTENT_ID}`} className="skip-link" onClick={skipToContent}>
        Перейти к основному содержимому
      </a>

      {/* Top Header */}
      <header className="app-header">
        <div className="brand-header-left">
          {screen === "form" && (
            <button
              className="header-back-btn"
              type="button"
              onClick={goBackToDirection}
              aria-label="Назад к выбору роли"
            >
              <ChevronLeft className="app-icon app-icon--md" />
            </button>
          )}
          <div className="brand-logo-text">
            <span>REALTY</span>
            <span>MATCH</span>
          </div>
        </div>

        <div className="brand-header-right">
          <span className="location-selector-pill">
            <span className="visually-hidden">Регион: </span>
            <span>Батуми</span>
            {/*<ChevronDown className="app-icon app-icon--xs chevron-icon" />*/}
          </span>

          <button
            className="header-account-btn"
            type="button"
            onClick={openAccount}
            aria-label="Мои заявки и аккаунт"
            title="Мои заявки"
          >
            <User className="app-icon app-icon--md" />
          </button>
        </div>
      </header>

      {/* Screen 1: Welcome & Role Selection */}
      {screen === "direction" ? (
        <section id={SCREEN_CONTENT_ID} tabIndex={-1} className="welcome-screen" aria-labelledby="welcome-hero-title">
          {/* Card Deck: Fan of multiple cards (top card slightly askew) */}
          <div className="card-deck-container">
            <div className="card-deck-fan">
              {/* Card 1: Bottom layer (rotated left) */}
              <div className="card-layer card-layer-1" aria-hidden="true">
                <img
                  src={batumiCardSrc}
                  alt=""
                  loading="eager"
                />
                <div className="card-layer-overlay" />
              </div>

              {/* Card 2: Middle layer (rotated slightly left) */}
              <div className="card-layer card-layer-2" aria-hidden="true">
                <img
                  src={batumiCardSrc}
                  alt=""
                  loading="eager"
                />
                <div className="card-layer-overlay" />
              </div>

              {/* Card 3: Top layer (already slightly askew with interactive heart) */}
              <div className="card-layer card-layer-top">
                <img
                  src={batumiCardSrc}
                  alt="Недвижимость Батуми у моря"
                  loading="eager"
                />
                <span
                  className="card-floating-heart"
                  aria-hidden="true"
                >
                  <Heart className="app-icon app-icon--md" fill="currentColor" />
                </span>
              </div>
            </div>
          </div>

          {/* Typography */}
          <h1 id="welcome-hero-title" className="hero-title" tabIndex={-1}>
            Найдите свою <br />
            недвижимость
          </h1>

          <p className="hero-subtitle">
            Уютные квартиры, стильные апартаменты,<br />
            дома у моря и многое другое.
          </p>

          {/* Actions: Roles */}
          <div className="role-actions-row">
            <button
              className="role-action-item"
              type="button"
              onClick={() => chooseDirection("demand")}
              aria-label="Ищу недвижимость, перейти к созданию заявки"
            >
              <div className="role-circle-btn" aria-hidden="true">
                <Search className="app-icon app-icon--lg" strokeWidth={2} />
              </div>
              <span className="role-action-label">
                <span>Ищу</span>
                <span>недвижимость</span>
              </span>
            </button>

            <button
              className="role-action-item"
              type="button"
              onClick={() => chooseDirection("offer")}
              aria-label="Предлагаю недвижимость, перейти к публикации объекта"
            >
              <div className="role-circle-btn" aria-hidden="true">
                <Home className="app-icon app-icon--lg" strokeWidth={1.9} />
              </div>
              <span className="role-action-label">
                <span>Предлагаю</span>
                <span>недвижимость</span>
              </span>
            </button>
          </div>
        </section>
      ) : (
        /* Screen 2: Request Form */
        <section
          id={SCREEN_CONTENT_ID}
          tabIndex={-1}
          className={`form-screen ${isKeyboardOpen ? "keyboard-open" : ""}`}
          style={{ "--keyboard-height": `${keyboardHeight}px` } as CSSProperties}
          aria-labelledby="form-heading-title"
        >
          <div className="form-header-block">
            <div className="form-role-icon" aria-hidden="true">
              {direction === "demand" ? (
                <Search className="app-icon app-icon--lg" strokeWidth={2} />
              ) : (
                <Home className="app-icon app-icon--lg" strokeWidth={1.9} />
              )}
            </div>
            <h1 id="form-heading-title" className="form-title" tabIndex={-1}>
              {direction === "demand" ? "Ищу недвижимость" : "Предлагаю недвижимость"}
            </h1>
            <p className="form-subtitle">
              {direction === "demand"
                ? "Расскажите, что именно вы ищете и в каких параметрах."
                : "Расскажите, что именно вы предлагаете и в каких параметрах."}
            </p>
          </div>

          {!isInsideTelegram && (
            <div className="context-notice-badge" role="status">
              Для отправки откройте приложение внутри Telegram.
            </div>
          )}

          <form onSubmit={handleSubmit} noValidate aria-label="Форма создания заявки">
            <div className="smart-textarea-card">
              <label htmlFor="application-text" className="visually-hidden">
                {direction === "demand"
                  ? "Опишите параметры поиска недвижимости"
                  : "Опишите параметры предлагаемой недвижимости"}
              </label>

              <textarea
                ref={textareaRef}
                id="application-text"
                name="text"
                value={text}
                onChange={handleTextChange}
                onFocus={handleTextareaFocus}
                onBlur={handleTextareaBlur}
                placeholder={
                  direction === "demand"
                    ? "Например:\nИщу квартиру 1+1 в Батуми до $500 в месяц."
                    : "Например:\nСдаю квартиру 1+1 в Батуми за $700 в месяц, светлая, с балконом."
                }
                rows={5}
                aria-required="true"
                aria-invalid={Boolean(error)}
                aria-describedby={error ? "form-error-msg text-counters" : "text-counters"}
                readOnly={screen === "submitting"}
              />

              {/* Not a live region: it would be re-announced on every keystroke. The text is read once,
                  as the textarea's description. aria-label on a plain <span> is ignored, hence the hidden text. */}
              <div id="text-counters" className="textarea-counters-row">
                <span id="text-count">
                  <span aria-hidden="true">
                    {charCount} / {MAX_TEXT_LENGTH}
                  </span>
                  <span className="visually-hidden">
                    Символов: {charCount} из {MAX_TEXT_LENGTH}.
                  </span>
                </span>
                <span id="text-tags">
                  <span aria-hidden="true">{tagCount} / 100</span>
                  <span className="visually-hidden">
                    Распознано ключевых параметров: {tagCount} из 100.
                  </span>
                </span>
              </div>
              <p className="textarea-limit-note" role="status">
                {textTruncated ? `Текст сокращён до ${MAX_TEXT_LENGTH} символов.` : ""}
              </p>
            </div>

            {error && (
              <p id="form-error-msg" className="form-error-text" role="alert">
                {error}
              </p>
            )}

            {/* Inline subscription banner (replaces modal popup) */}
            {subscriptionRequired && (
              <div className="subscription-inline-banner" role="alert">
                <div className="subscription-banner-header">
                  <Bell className="app-icon app-icon--sm subscription-banner-icon" />
                  <span className="subscription-banner-title">
                    Для отправки подпишитесь на канал <strong>@RealtyMatch</strong>
                  </span>
                </div>

                {isFromChannel ? (
                  <div className="subscription-banner-hint" role="note">
                    <div className="subscription-hint-arrow-wrap" aria-hidden="true">
                      <ChevronDown className="app-icon app-icon--sm subscription-hint-arrow" />
                    </div>
                    <span>
                      Свернуть и нажать <strong>«Подписаться»</strong> внизу канала.
                      После подписки вернитесь сюда — заявка отправится автоматически.
                    </span>
                  </div>
                ) : (
                  <button
                    type="button"
                    className="subscription-channel-link"
                    onClick={() => openTelegramLink(activeWebApp, subscriptionChannelUrl)}
                  >
                    Открыть канал @RealtyMatch
                    <ExternalLink className="app-icon app-icon--xs" />
                  </button>
                )}

                {subscriptionCheckFailed && (
                  <div className="subscription-banner-warning">
                    <AlertCircle className="app-icon app-icon--sm subscription-warning-icon" />
                    <span>
                      Подписка пока не найдена. Убедитесь, что вы нажали «Подписаться» в канале, и попробуйте снова.
                    </span>
                  </div>
                )}
              </div>
            )}

            <button
              ref={submitButtonRef}
              className="pill-cta-btn"
              type="button"
              aria-disabled={isSubmitBusy}
              aria-busy={isSubmitBusy}
              aria-label={
                isCheckingSubscription
                  ? "Проверяем подписку…"
                  : screen === "submitting"
                  ? "Отправляем заявку..."
                  : subscriptionRequired
                  ? "Я подписался, отправить"
                  : "Продолжить"
              }
              onClick={handleSubmitButtonPress}
            >
              {isCheckingSubscription ? (
                "Проверяем подписку…"
              ) : screen === "submitting" ? (
                "Отправляем…"
              ) : subscriptionRequired ? (
                <>
                  Я подписался, отправить <Check className="app-icon app-icon--sm btn-arrow" />
                </>
              ) : (
                <>
                  Продолжить <ArrowRight className="app-icon app-icon--sm btn-arrow" />
                </>
              )}
            </button>

            {/* Spacer anchor to ensure breathing room between the button and keyboard */}
            <div
              ref={bottomAnchorRef}
              className="keyboard-scroll-anchor"
              aria-hidden="true"
            />

            <div className="privacy-shield-badge">
              <ShieldCheck className="app-icon app-icon--sm" />
              <span>Ваша заявка будет обработана в приватном режиме</span>
            </div>
          </form>
        </section>
      )}
    </main>
  );
}

export default App;

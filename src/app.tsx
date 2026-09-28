import {
  AlertCircle,
  ArrowRight,
  Check,
  ChevronDown,
  ChevronLeft,
  Heart,
  Home,
  MapPin,
  Search,
  ShieldCheck,
} from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
} from "react";
import {
  ApiError,
  getUserFacingApiError,
  submitPublishRequest,
  type DirectionHint,
} from "./api";
import {
  createIdempotencyKey,
  getInitData,
  getStartParam,
  getTelegramColorScheme,
  getTelegramWebApp,
  type TelegramWebApp,
} from "./telegram";

const MIN_TEXT_LENGTH = 10;
const MAX_TEXT_LENGTH = 4000;

interface AppProps {
  webApp: TelegramWebApp | null;
}

type Screen = "direction" | "form" | "submitting" | "success" | "error";

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

function App({ webApp: initialWebApp }: AppProps) {
  const [screen, setScreen] = useState<Screen>("direction");
  const [direction, setDirection] = useState<DirectionHint | null>(null);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [retryNeedsNewIdempotencyKey, setRetryNeedsNewIdempotencyKey] = useState(false);
  const [idempotencyKey, setIdempotencyKey] = useState(createIdempotencyKey);
  const [isKeyboardOpen, setIsKeyboardOpen] = useState(false);
  const [keyboardHeight, setKeyboardHeight] = useState(0);

  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const submitButtonRef = useRef<HTMLButtonElement | null>(null);
  const bottomAnchorRef = useRef<HTMLDivElement | null>(null);
  const formScreenRef = useRef<HTMLElement | null>(null);

  const activeWebApp = getTelegramWebApp() ?? initialWebApp;
  const initData = getInitData(activeWebApp);
  const isInsideTelegram = initData.length > 0;
  const startParam = getStartParam(activeWebApp);

  const [theme, setTheme] = useState<"light" | "dark">(() =>
    getTelegramColorScheme(activeWebApp),
  );

  // Sync theme with Telegram WebApp and system preference
  useEffect(() => {
    const updateTheme = () => {
      const activeTheme = getTelegramColorScheme(activeWebApp);
      setTheme(activeTheme);
      document.documentElement.dataset.theme = activeTheme;
      if (activeTheme === "dark") {
        document.documentElement.classList.add("theme-dark");
        document.documentElement.classList.remove("theme-light");
        try {
          activeWebApp?.setHeaderColor?.("#0F131C");
          activeWebApp?.setBackgroundColor?.("#0F131C");
        } catch {
          // Ignore if Telegram API throws in unsupported client
        }
      } else {
        document.documentElement.classList.add("theme-light");
        document.documentElement.classList.remove("theme-dark");
        try {
          activeWebApp?.setHeaderColor?.("#f8f6f2");
          activeWebApp?.setBackgroundColor?.("#f8f6f2");
        } catch {
          // Ignore if Telegram API throws in unsupported client
        }
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

  // Smoothly scroll the page so the submit button is positioned nicely above the keyboard with bottom margin
  const scrollToSubmitButton = (immediate = false) => {
    const doScroll = () => {
      const target = bottomAnchorRef.current ?? submitButtonRef.current;
      if (target) {
        target.scrollIntoView({
          behavior: immediate ? "auto" : "smooth",
          block: "nearest",
        });
      }
    };

    if (immediate) {
      doScroll();
    } else {
      // Execute with staggered delays to follow the iOS keyboard animation
      setTimeout(doScroll, 80);
      setTimeout(doScroll, 200);
      setTimeout(doScroll, 350);
    }
  };

  // Telegram Native BackButton integration
  useEffect(() => {
    const backButton = activeWebApp?.BackButton;
    if (!backButton) {
      return;
    }

    if (screen === "form") {
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

  // Handle focus and viewport adjustments when entering the form screen
  useEffect(() => {
    if (screen === "form") {
      activeWebApp?.expand?.();

      // On iOS and mobile browsers, activate focus and lift form above keyboard
      const timer = setTimeout(() => {
        if (textareaRef.current) {
          textareaRef.current.focus({ preventScroll: true });
          syncKeyboardState();
          scrollToSubmitButton();
        }
      }, 70);

      return () => clearTimeout(timer);
    } else {
      setIsKeyboardOpen(false);
      setKeyboardHeight(0);
    }
  }, [screen, activeWebApp]);

  // Track window.visualViewport changes (essential for iOS Safari and Chrome mobile)
  useEffect(() => {
    if (typeof window === "undefined" || !window.visualViewport) {
      return;
    }

    const vv = window.visualViewport;
    const handleViewportChange = () => {
      if (screen !== "form") {
        return;
      }

      syncKeyboardState();
    };

    vv.addEventListener("resize", handleViewportChange);
    vv.addEventListener("scroll", handleViewportChange);
    handleViewportChange();
    return () => {
      vv.removeEventListener("resize", handleViewportChange);
      vv.removeEventListener("scroll", handleViewportChange);
    };
  }, [screen]);

  // Telegram native viewportChanged event listener
  useEffect(() => {
    if (!activeWebApp?.onEvent) {
      return;
    }

    const handleTgViewport = () => {
      if (screen === "form") {
        scrollToSubmitButton();
      }
    };

    activeWebApp.onEvent("viewportChanged", handleTgViewport);
    return () => {
      activeWebApp.offEvent?.("viewportChanged", handleTgViewport);
    };
  }, [screen, activeWebApp]);

  function chooseDirection(nextDirection: DirectionHint) {
    activeWebApp?.expand?.();
    if (direction !== null && direction !== nextDirection) {
      setText("");
    }
    setDirection(nextDirection);
    setScreen("form");
    setError(null);
    setRetryNeedsNewIdempotencyKey(false);
    setIdempotencyKey(createIdempotencyKey());
  }

  function syncKeyboardState() {
    if (typeof window === "undefined" || !window.visualViewport) {
      setIsKeyboardOpen(false);
      setKeyboardHeight(0);
      return;
    }

    const keyboardHeight = Math.max(0, window.innerHeight - window.visualViewport.height);
    const isKeyboardOpen = keyboardHeight > 80;
    setIsKeyboardOpen(isKeyboardOpen);
    setKeyboardHeight(isKeyboardOpen ? keyboardHeight : 0);

    if (isKeyboardOpen) {
      scrollToSubmitButton();
    }
  }

  function handleTextChange(event: ChangeEvent<HTMLTextAreaElement>) {
    const nextText = limitUnicodeCharacters(event.target.value, MAX_TEXT_LENGTH);
    setText(nextText);
    if (error) {
      setError(null);
    }
    setRetryNeedsNewIdempotencyKey(false);

    if (nextText !== text) {
      setIdempotencyKey(createIdempotencyKey());
    }
  }

  function goBackToDirection() {
    if (screen === "submitting") {
      return;
    }

    setError(null);
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
    void submitForm(requestKey);
  }

  async function submitForm(requestKey = idempotencyKey) {
    if (!direction) {
      setScreen("direction");
      return;
    }

    const validationError = getValidationError(text);
    if (validationError) {
      setError(validationError);
      setScreen("form");
      return;
    }

    const currentInitData = getInitData(activeWebApp);
    if (!currentInitData) {
      setError("Откройте приложение через Telegram и попробуйте ещё раз.");
      setScreen("error");
      return;
    }

    // Telegram omits start_param when the Main Mini App is opened from the
    // bot profile/menu. The backend verifies initData and accepts that signed
    // launch path, while still rejecting an explicitly unexpected parameter.
    const effectiveStartParam = startParam ?? "publish";
    if (effectiveStartParam !== "publish") {
      setError("Откройте приложение через кнопку «Подать заявку».");
      setScreen("error");
      return;
    }

    setError(null);
    setScreen("submitting");

    try {
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
      setScreen("success");
    } catch (requestError) {
      setError(getUserFacingApiError(requestError));
      setRetryNeedsNewIdempotencyKey(
        requestError instanceof ApiError && requestError.kind === "idempotency_conflict",
      );
      setScreen("error");
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void submitForm();
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
        <section className="success-screen" aria-live="polite" aria-labelledby="success-heading-title">
          <div className="success-badge-circle" aria-hidden="true">
            <Check className="app-icon app-icon--xl" strokeWidth={2.8} />
          </div>

          <h1 id="success-heading-title" className="success-title">Заявка принята!</h1>

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
        <section className="error-screen" role="alert" aria-live="assertive" aria-labelledby="error-heading-title">
          <div className="error-badge-circle" aria-hidden="true">
            <AlertCircle className="app-icon app-icon--xl" />
          </div>

          <h1 id="error-heading-title" className="error-title">Не получилось отправить</h1>

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
  // Screens 1 & 2
  // =========================================================
  return (
    <main id="main-content" className="app-shell" tabIndex={-1}>
      <a href="#main-content" className="skip-link">
        Перейти к основному содержимому
      </a>

      {/* Top Header */}
      <header className="app-header" role="banner">
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
          <div className="brand-logo-text" aria-label="REALTY MATCH">
            <span>REALTY</span>
            <span>MATCH</span>
          </div>
        </div>

        <span
          className="location-selector-pill"
          aria-label="Регион: Батуми, Грузия"
        >
          <span>Батуми</span>
          {/*<ChevronDown className="app-icon app-icon--xs chevron-icon" />*/}
        </span>
      </header>

      {/* Screen 1: Welcome & Role Selection */}
      {screen === "direction" ? (
        <section className="welcome-screen" aria-labelledby="welcome-hero-title">
          {/* Card Deck: Fan of multiple cards (top card slightly askew) */}
          <div
            className="card-deck-container"
            role="region"
            aria-label="Галерея недвижимости Батуми"
          >
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
          <h1 id="welcome-hero-title" className="hero-title">
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
          ref={formScreenRef}
          className={`form-screen ${isKeyboardOpen ? "keyboard-open" : ""}`}
          style={{
            ["--keyboard-height" as string]: `${keyboardHeight}px`,
          }}
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
            <h1 id="form-heading-title" className="form-title">
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
                onFocus={() => {
                  setTimeout(syncKeyboardState, 50);
                  scrollToSubmitButton();
                }}
                onBlur={() => {
                  setTimeout(() => {
                    if (
                      document.activeElement !== textareaRef.current &&
                      document.activeElement !== submitButtonRef.current
                    ) {
                      setIsKeyboardOpen(false);
                      setKeyboardHeight(0);
                    }
                  }, 200);
                }}
                placeholder={
                  direction === "demand"
                    ? "Например:\nИщу квартиру 1+1 в Батуми до $500 в месяц."
                    : "Например:\nСдаю квартиру 1+1 в Батуми за $700 в месяц, светлая, с балконом."
                }
                rows={isKeyboardOpen ? 4 : 5}
                aria-required="true"
                aria-invalid={Boolean(error)}
                aria-describedby={error ? "form-error-msg text-counters" : "text-counters"}
                readOnly={screen === "submitting"}
              />

              <div
                id="text-counters"
                className="textarea-counters-row"
                aria-live="polite"
                aria-atomic="true"
              >
                <span id="text-count" aria-label={`Символов: ${countUnicodeCharacters(text)} из ${MAX_TEXT_LENGTH}`}>
                  {countUnicodeCharacters(text)} / {MAX_TEXT_LENGTH}
                </span>
                <span id="text-tags" aria-label={`Распознано ключевых параметров: ${countTags(text)} из 100`}>
                  {countTags(text)} / 100
                </span>
              </div>
            </div>

            {error && (
              <p id="form-error-msg" className="form-error-text" role="alert" aria-live="assertive">
                {error}
              </p>
            )}

            <button
              ref={submitButtonRef}
              className="pill-cta-btn"
              type="submit"
              disabled={screen === "submitting"}
              aria-busy={screen === "submitting"}
              aria-label={screen === "submitting" ? "Отправляем заявку..." : "Продолжить"}
              onPointerDown={(e) => {
                if (screen !== "submitting") {
                  e.preventDefault();
                  void submitForm();
                }
              }}
            >
              {screen === "submitting" ? (
                "Отправляем…"
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

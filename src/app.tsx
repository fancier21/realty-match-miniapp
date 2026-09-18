import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
} from "react";
import {
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
          setIsKeyboardOpen(true);
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

      const diff = Math.max(0, window.innerHeight - vv.height);
      const isKb = diff > 80;
      setIsKeyboardOpen(isKb);
      setKeyboardHeight(isKb ? diff : 0);

      if (isKb) {
        scrollToSubmitButton();
      }
    };

    vv.addEventListener("resize", handleViewportChange);
    vv.addEventListener("scroll", handleViewportChange);
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
    setDirection(nextDirection);
    setScreen("form");
    setError(null);
    setIdempotencyKey(createIdempotencyKey());
    setIsKeyboardOpen(true);
  }

  function handleTextChange(event: ChangeEvent<HTMLTextAreaElement>) {
    const nextText = limitUnicodeCharacters(event.target.value, MAX_TEXT_LENGTH);
    setText(nextText);
    if (error) {
      setError(null);
    }

    if (nextText !== text) {
      setIdempotencyKey(createIdempotencyKey());
    }
  }

  function goBackToDirection() {
    if (screen === "submitting") {
      return;
    }

    setError(null);
    setScreen("direction");
  }

  function editSubmission() {
    setError(null);
    setScreen("form");
  }

  function retrySubmission() {
    if (error && error.includes("другим текстом")) {
      setIdempotencyKey(createIdempotencyKey());
    }
    void submitForm();
  }

  async function submitForm() {
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
        idempotencyKey,
      );

      activeWebApp?.disableClosingConfirmation?.();
      setScreen("success");
    } catch (requestError) {
      setError(getUserFacingApiError(requestError));
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
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true" focusable="false">
              <path
                d="M5 13l4 4L19 7"
                strokeWidth="2.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
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
              <span>📍 Батуми →</span>
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
            !
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
              Повторить <span className="btn-arrow" aria-hidden="true">→</span>
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
              <span aria-hidden="true">←</span>
            </button>
          )}
          <div className="brand-logo-text" aria-label="REALTY MATCH">
            <span>REALTY</span>
            <span>MATCH</span>
          </div>
        </div>

        <button
          className="location-selector-pill"
          type="button"
          aria-label="Текущий регион: Батуми, Грузия"
        >
          <span>Батуми</span>
        </button>
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
                <button
                  className="card-floating-heart"
                  type="button"
                  aria-label="Сохранить в избранное"
                >
                  <span aria-hidden="true">❤️</span>
                </button>
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
                <svg
                  width="26"
                  height="26"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  focusable="false"
                >
                  <circle cx="11" cy="11" r="8" />
                  <path d="m21 21-4.3-4.3" />
                </svg>
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
                <svg
                  width="26"
                  height="26"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.9"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  focusable="false"
                >
                  <path d="M3 10.5 12 3l9 7.5" />
                  <path d="M5 9.5V20a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9.5" />
                  <path d="M9 21v-6a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v6" />
                </svg>
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
                <svg
                  width="24"
                  height="24"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  focusable="false"
                >
                  <circle cx="11" cy="11" r="8" />
                  <path d="m21 21-4.3-4.3" />
                </svg>
              ) : (
                <svg
                  width="24"
                  height="24"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.9"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  focusable="false"
                >
                  <path d="M3 10.5 12 3l9 7.5" />
                  <path d="M5 9.5V20a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9.5" />
                  <path d="M9 21v-6a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v6" />
                </svg>
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
                  setIsKeyboardOpen(true);
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
                    ? "Например:\nИщу квартиру 1+1 в Батуми,\nс октября (посуточно)."
                    : "Например:\nСдаю квартиру 1+1 в Батуми,\nсветлая, с балконом (посуточно)."
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
                  Продолжить <span className="btn-arrow" aria-hidden="true">→</span>
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
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
                focusable="false"
              >
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
              </svg>
              <span>Ваша заявка будет обработана в приватном режиме</span>
            </div>
          </form>
        </section>
      )}
    </main>
  );
}

export default App;

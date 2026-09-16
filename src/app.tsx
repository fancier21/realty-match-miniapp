import { useState, type ChangeEvent, type FormEvent } from "react";
import {
  getUserFacingApiError,
  submitPublishRequest,
  type DirectionHint,
} from "./api";
import {
  createIdempotencyKey,
  getStartParam,
  type TelegramWebApp,
} from "./telegram";

const MIN_TEXT_LENGTH = 10;
const MAX_TEXT_LENGTH = 4000;

interface AppProps {
  webApp: TelegramWebApp | null;
}

type Screen = "direction" | "form" | "submitting" | "success" | "error";

const directionOptions: Array<{
  value: DirectionHint;
  title: string;
  description: string;
  eyebrow: string;
}> = [
  {
    value: "demand",
    title: "Ищу недвижимость",
    description: "Купить или арендовать подходящий объект",
    eyebrow: "01 / ПОИСК",
  },
  {
    value: "offer",
    title: "Предлагаю недвижимость",
    description: "Продать или сдать свой объект",
    eyebrow: "02 / ПРЕДЛОЖЕНИЕ",
  },
];

function DirectionIcon({ direction }: { direction: DirectionHint }) {
  if (direction === "demand") {
    return (
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="m4 11 8-6 8 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M6.5 10.5V19h11v-8.5M10 19v-4.5h4V19" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="17.5" cy="17.5" r="3.5" fill="currentColor" />
        <path d="m20 20-1.5-1.5" stroke="var(--app-surface)" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M5 20V7.5L12 4l7 3.5V20" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M8 20v-5h8v5M8 9h1M12 9h1M16 9h1M8 12h1M12 12h1M16 12h1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M3.5 20h17" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

const logoSrc = `${import.meta.env.BASE_URL}logo.png`;

function countUnicodeCharacters(value: string): number {
  return Array.from(value).length;
}

function limitUnicodeCharacters(value: string, maxLength: number): string {
  return Array.from(value).slice(0, maxLength).join("");
}

function getValidationError(text: string): string | null {
  const contentLength = countUnicodeCharacters(text.trim());

  if (contentLength === 0) {
    return "Пожалуйста, опишите вашу заявку.";
  }

  if (contentLength < MIN_TEXT_LENGTH) {
    return "Опишите заявку подробнее.";
  }

  if (countUnicodeCharacters(text) > MAX_TEXT_LENGTH) {
    return `Заявка не должна быть длиннее ${MAX_TEXT_LENGTH} символов.`;
  }

  return null;
}

function App({ webApp }: AppProps) {
  const [screen, setScreen] = useState<Screen>("direction");
  const [direction, setDirection] = useState<DirectionHint | null>(null);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [idempotencyKey, setIdempotencyKey] = useState(createIdempotencyKey);

  const startParam = getStartParam(webApp);

  function chooseDirection(nextDirection: DirectionHint) {
    setDirection(nextDirection);
    setScreen("form");
    setError(null);
    setIdempotencyKey(createIdempotencyKey());
  }

  function handleTextChange(event: ChangeEvent<HTMLTextAreaElement>) {
    const nextText = limitUnicodeCharacters(event.target.value, MAX_TEXT_LENGTH);
    setText(nextText);
    if (error) {
      setError(null);
    }

    // A changed payload is a new submission. Retries without edits keep the
    // same key so the backend can safely return the original result.
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

    if (!webApp?.initData) {
      setError("Откройте приложение через Telegram и попробуйте ещё раз.");
      setScreen("error");
      return;
    }

    if (startParam !== "publish") {
      setError("Откройте приложение через кнопку «Подать заявку».");
      setScreen("error");
      return;
    }

    setError(null);
    setScreen("submitting");

    try {
      const result = await submitPublishRequest(
        {
          init_data: webApp.initData,
          direction_hint: direction,
          text,
          start_param: startParam,
        },
        idempotencyKey,
      );

      if (result.status === "failed" || result.status === "ignored") {
        setError("Не удалось обработать заявку. Попробуйте изменить текст и отправить ещё раз.");
        setScreen("error");
        return;
      }

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
    if (webApp?.close) {
      webApp.close();
      return;
    }

    setScreen("direction");
    setDirection(null);
    setText("");
    setError(null);
  }

  if (screen === "success") {
    return (
      <main className="app-shell result-shell">
        <section className="app-card result-card" aria-live="polite">
          <div className="result-logo">
            <img src={logoSrc} alt="REALTY MATCH" />
          </div>
          <div className="result-icon success-icon" aria-hidden="true">
            ✓
          </div>
          <p className="result-eyebrow">ГОТОВО</p>
          <h1>Заявка принята</h1>
          <p className="result-description">
            Мы передали её в обработку. REALTY MATCH скоро займётся поиском подходящего варианта.
          </p>
          <button className="primary-button" type="button" onClick={closeApp}>
            Закрыть <span className="button-arrow" aria-hidden="true">↗</span>
          </button>
        </section>
      </main>
    );
  }

  if (screen === "error") {
    return (
      <main className="app-shell result-shell">
        <section className="app-card result-card" aria-live="assertive">
          <div className="result-logo">
            <img src={logoSrc} alt="REALTY MATCH" />
          </div>
          <div className="result-icon error-icon" aria-hidden="true">
            !
          </div>
          <p className="result-eyebrow error-eyebrow">НУЖНА ПОПЫТКА</p>
          <h1>Не получилось отправить</h1>
          <p className="result-description">{error ?? "Попробуйте ещё раз."}</p>
          <div className="result-actions">
            <button className="primary-button" type="button" onClick={() => void submitForm()}>
              Повторить <span className="button-arrow" aria-hidden="true">↗</span>
            </button>
            <button className="secondary-button" type="button" onClick={editSubmission}>
              Изменить заявку
            </button>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <section className="app-card">
        <header className="app-header">
          <div className="brand-lockup">
            <div className="logo-frame">
              <img src={logoSrc} alt="REALTY MATCH" />
            </div>
            <div className="brand-copy">
              <p className="eyebrow">REALTY MATCH</p>
              <p className="header-caption">Недвижимость в Батуми</p>
            </div>
          </div>
          <div className="location-pill">
            <span className="location-dot" aria-hidden="true" />
            BATUMI
          </div>
        </header>

        {screen === "direction" ? (
          <section className="intro-section" aria-labelledby="direction-title">
            <div className="hero-kicker">
              <span className="kicker-line" aria-hidden="true" /> НОВАЯ ЗАЯВКА
            </div>
            <h1 id="direction-title" className="hero-title">
              Найдём место,<br />
              <em>которое подходит.</em>
            </h1>
            <p className="section-description hero-description">
              Расскажите, что вам нужно. Система обработает заявку и передаст её в REALTY MATCH.
            </p>
            <div className="direction-list">
              {directionOptions.map((option) => (
                <button
                  className="direction-button"
                  key={option.value}
                  type="button"
                  onClick={() => chooseDirection(option.value)}
                >
                  <span className="direction-icon" aria-hidden="true">
                    <DirectionIcon direction={option.value} />
                  </span>
                  <span className="direction-copy">
                    <span className="option-eyebrow">{option.eyebrow}</span>
                    <strong>{option.title}</strong>
                    <small>{option.description}</small>
                  </span>
                  <span className="direction-arrow" aria-hidden="true">
                    ↗
                  </span>
                </button>
              ))}
            </div>
          </section>
        ) : (
          <section aria-labelledby="form-title">
            <button
              className="back-button"
              type="button"
              onClick={goBackToDirection}
              disabled={screen === "submitting"}
            >
              <span aria-hidden="true">←</span> Вернуться
            </button>
            <div className="form-heading">
              <div className="hero-kicker">
                <span className="kicker-line" aria-hidden="true" /> ШАГ 01 / ОПИСАНИЕ
              </div>
              <h1 id="form-title" className="hero-title">
                Расскажите<br />
                <em>подробнее.</em>
              </h1>
              <p className="section-description">
                {direction === "demand"
                  ? "Опишите, какую недвижимость вы ищете"
                  : "Опишите недвижимость, которую предлагаете"}
              </p>
            </div>

            {!webApp && (
              <p className="context-notice" role="status">
                Для отправки откройте приложение внутри Telegram.
              </p>
            )}

            <form onSubmit={handleSubmit} noValidate>
              <label className="textarea-label" htmlFor="application-text">
                Ваше описание
              </label>
              <textarea
                id="application-text"
                name="text"
                value={text}
                onChange={handleTextChange}
                placeholder={
                  direction === "demand"
                    ? "Ищу 1+1 в Батуми до $800 в месяц..."
                    : "Сдаю светлую квартиру 1+1 в центре Батуми..."
                }
                rows={7}
                aria-describedby="text-help text-count"
                aria-invalid={Boolean(error)}
                autoFocus
              />
              <div className="textarea-footer">
                <span id="text-help">Минимум {MIN_TEXT_LENGTH} символов</span>
                <span id="text-count">
                  {countUnicodeCharacters(text)} / {MAX_TEXT_LENGTH}
                </span>
              </div>

              {error && (
                <p className="form-error" role="alert">
                  {error}
                </p>
              )}

              <button
                className="primary-button submit-button"
                type="submit"
                disabled={screen === "submitting"}
              >
                {screen === "submitting" ? "Отправляем…" : "Отправить заявку"}
                <span className="button-arrow" aria-hidden="true">↗</span>
              </button>
            </form>
          </section>
        )}

        <footer className="app-footer">
          <span className="footer-mark" aria-hidden="true">✦</span>
          <span>Заявка обрабатывается через Telegram</span>
        </footer>
      </section>
    </main>
  );
}

export default App;

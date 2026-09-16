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
  icon: string;
  title: string;
  description: string;
}> = [
  {
    value: "demand",
    icon: "⌂",
    title: "Ищу недвижимость",
    description: "Расскажите, что хотите купить или арендовать",
  },
  {
    value: "offer",
    icon: "₾",
    title: "Предлагаю недвижимость",
    description: "Расскажите об объекте, который продаёте или сдаёте",
  },
];

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
      <main className="app-shell">
        <section className="app-card result-card" aria-live="polite">
          <div className="success-icon" aria-hidden="true">
            ✓
          </div>
          <h1>Заявка принята!</h1>
          <p>
            REALTY MATCH принял вашу заявку и передал её в обработку.
          </p>
          <button className="primary-button" type="button" onClick={closeApp}>
            Закрыть
          </button>
        </section>
      </main>
    );
  }

  if (screen === "error") {
    return (
      <main className="app-shell">
        <section className="app-card result-card" aria-live="assertive">
          <div className="error-icon" aria-hidden="true">
            !
          </div>
          <h1>Не удалось отправить</h1>
          <p>{error ?? "Попробуйте ещё раз."}</p>
          <div className="result-actions">
            <button className="primary-button" type="button" onClick={() => void submitForm()}>
              Повторить
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
          <div className="brand-mark" aria-hidden="true">
            RM
          </div>
          <div>
            <p className="eyebrow">REALTY MATCH</p>
            <p className="header-caption">Недвижимость в Батуми</p>
          </div>
        </header>

        {screen === "direction" ? (
          <section className="intro-section" aria-labelledby="direction-title">
            <div className="title-icon" aria-hidden="true">
              ↗
            </div>
            <h1 id="direction-title">Подать заявку</h1>
            <p className="section-description">Что вы хотите?</p>
            <div className="direction-list">
              {directionOptions.map((option) => (
                <button
                  className="direction-button"
                  key={option.value}
                  type="button"
                  onClick={() => chooseDirection(option.value)}
                >
                  <span className="direction-icon" aria-hidden="true">
                    {option.icon}
                  </span>
                  <span className="direction-copy">
                    <strong>{option.title}</strong>
                    <small>{option.description}</small>
                  </span>
                  <span className="direction-arrow" aria-hidden="true">
                    ›
                  </span>
                </button>
              ))}
            </div>
          </section>
        ) : (
          <section aria-labelledby="form-title">
            <button className="back-button" type="button" onClick={goBackToDirection}>
              <span aria-hidden="true">‹</span> Назад
            </button>
            <div className="form-heading">
              <div className="title-icon" aria-hidden="true">
                ✎
              </div>
              <h1 id="form-title">Ваша заявка</h1>
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
                Описание заявки
              </label>
              <textarea
                id="application-text"
                name="text"
                value={text}
                onChange={handleTextChange}
                placeholder={
                  direction === "demand"
                    ? "Например: Ищу 1+1 в Батуми до $800 в месяц..."
                    : "Например: Сдаю светлую квартиру 1+1 в центре Батуми..."
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
              </button>
            </form>
          </section>
        )}

        <footer className="app-footer">
          <span aria-hidden="true">●</span> Ваши данные обрабатываются через Telegram
        </footer>
      </section>
    </main>
  );
}

export default App;

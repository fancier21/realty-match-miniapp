import { Component, useEffect, useRef, type ErrorInfo, type ReactNode } from "react";
import { AlertCircle, RotateCw } from "lucide-react";
import type { TelegramWebApp } from "./telegram";

interface ErrorBoundaryProps {
  webApp: TelegramWebApp | null;
  children: ReactNode;
  /** Hook for error reporting / analytics; called once per caught render error. */
  onError?: (error: unknown, info: ErrorInfo) => void;
  /** Defaults to a full page reload (resets all state). Overridable for tests. */
  onReload?: () => void;
}

interface ErrorBoundaryState {
  hasError: boolean;
}

function reloadPage() {
  window.location.reload();
}

/**
 * Catches errors thrown while rendering the app. Without it, such an error unmounts the whole
 * tree and leaves a blank screen inside Telegram with no way out.
 *
 * Not caught here (React limitation): errors in event handlers, timers and promises; those do
 * not break rendering and are handled where they happen.
 *
 * Must be a class: React still has no hook equivalent of getDerivedStateFromError.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    // React 19 already logs caught errors to the console; this is only the reporting hook.
    this.props.onError?.(error, info);
  }

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }
    return <CrashScreen webApp={this.props.webApp} onReload={this.props.onReload ?? reloadPage} />;
  }
}

interface CrashScreenProps {
  webApp: TelegramWebApp | null;
  onReload: () => void;
}

// Deliberately self-contained: it must not depend on any app state that may be what broke.
// It reuses the error-screen styles, so it looks like the rest of the app in both themes.
function CrashScreen({ webApp, onReload }: CrashScreenProps) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const canClose = typeof webApp?.close === "function";

  useEffect(() => {
    // The screen that crashed may have left Telegram's native back button showing.
    try {
      webApp?.BackButton?.hide();
    } catch {
      // Unsupported on old clients; nothing to hide there anyway.
    }
    // Same as on every other screen change: land on the new screen's heading.
    headingRef.current?.focus({ preventScroll: true });
  }, [webApp]);

  function close() {
    // The form's closing confirmation has no cleanup of its own, so after a crash it could still be
    // armed and Telegram would ask "discard changes?" about a form that no longer exists.
    try {
      webApp?.disableClosingConfirmation?.();
    } catch {
      // ignore: the call is only an optimisation of the closing flow
    }
    webApp?.close?.();
  }

  return (
    <main id="main-content" className="app-shell" tabIndex={-1}>
      <section className="error-screen" aria-labelledby="crash-heading-title">
        <div className="error-badge-circle" aria-hidden="true">
          <AlertCircle className="app-icon app-icon--xl" />
        </div>
        <h1 id="crash-heading-title" ref={headingRef} className="error-title" tabIndex={-1}>
          Что-то пошло не так
        </h1>
        <p className="error-description">
          Приложение столкнулось с неожиданной ошибкой. Перезагрузите его; то, что вы не успели
          отправить, может не сохраниться.
        </p>
        <div className="error-actions-group">
          <button className="pill-cta-btn" type="button" onClick={onReload}>
            Перезагрузить <RotateCw className="app-icon app-icon--sm btn-arrow" />
          </button>
          {canClose && (
            <button
              className="secondary-pill-btn"
              type="button"
              onClick={close}
              aria-label="Закрыть приложение"
            >
              Закрыть
            </button>
          )}
        </div>
      </section>
    </main>
  );
}

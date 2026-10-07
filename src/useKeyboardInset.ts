import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type { TelegramWebApp } from "./telegram";

// Heights are in CSS px.
const KEYBOARD_CONFIRMED_OPEN_PX = 100; // above this we know the keyboard really opened
const KEYBOARD_CLOSED_PX = 50; // at or below this a previously open keyboard counts as dismissed
const KEYBOARD_HEIGHT_FALLBACK_PX = 320; // guess used right after focus, before the viewport has resized
const SCROLL_DELAY_MS = 100;
const BLUR_RESET_DELAY_MS = 150;

interface UseKeyboardInsetOptions {
  /** Viewport listeners are only attached while this is true (the form screen). */
  active: boolean;
  /** State is reset (and pending timers cleared) whenever this changes, e.g. the current screen. */
  resetKey: unknown;
  webApp: TelegramWebApp | null;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  submitButtonRef: RefObject<HTMLButtonElement | null>;
  bottomAnchorRef: RefObject<HTMLDivElement | null>;
}

/**
 * Tracks the on-screen keyboard so the form can switch to a compact layout and
 * reserve bottom space (see `.form-screen.keyboard-open` in index.css).
 *
 * Two signals are combined because clients differ: `window.visualViewport`
 * (keyboard overlays the layout viewport) and Telegram's own
 * `viewportHeight` / `viewportStableHeight` (the WebView itself gets resized).
 *
 * IMPORTANT: this must never call `webApp.expand()`. Telegram should control
 * the native bottom sheet so the user can still minimize it with a swipe.
 */
export function useKeyboardInset({
  active,
  resetKey,
  webApp,
  textareaRef,
  submitButtonRef,
  bottomAnchorRef,
}: UseKeyboardInsetOptions) {
  const [isKeyboardOpen, setIsKeyboardOpen] = useState(false);
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  // True once the keyboard has been *confirmed* open (measured > threshold).
  const wasOpenRef = useRef(false);
  const scrollTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const blurTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const reset = useCallback(() => {
    wasOpenRef.current = false;
    setIsKeyboardOpen(false);
    setKeyboardHeight(0);
  }, []);

  const measureKeyboardHeight = useCallback((): number => {
    if (typeof window === "undefined") {
      return 0;
    }

    let measured = 0;
    if (window.visualViewport) {
      measured = Math.max(0, window.innerHeight - window.visualViewport.height);
    }

    const stable = webApp?.viewportStableHeight;
    const current = webApp?.viewportHeight;
    if (typeof stable === "number" && typeof current === "number" && stable > current) {
      measured = Math.max(measured, stable - current);
    }

    return measured;
  }, [webApp]);

  const sync = useCallback(() => {
    if (typeof window === "undefined" || document.activeElement !== textareaRef.current) {
      reset();
      return;
    }

    // While the textarea is focused, compact mode is active.
    setIsKeyboardOpen(true);

    const measured = measureKeyboardHeight();
    if (measured > KEYBOARD_CONFIRMED_OPEN_PX) {
      wasOpenRef.current = true;
    }
    setKeyboardHeight(measured > KEYBOARD_CLOSED_PX ? measured : KEYBOARD_HEIGHT_FALLBACK_PX);
  }, [measureKeyboardHeight, reset, textareaRef]);

  // Reset when the screen changes; also drop timers scheduled on the previous
  // screen (and on unmount) so they can't fire into a stale/unmounted component.
  useEffect(() => {
    reset();
    return () => {
      clearTimeout(scrollTimerRef.current);
      clearTimeout(blurTimerRef.current);
    };
  }, [resetKey, reset]);

  // Single handler for both viewport signals (it used to be two identical copies).
  useEffect(() => {
    if (!active) {
      return;
    }

    let frame = 0;
    const handleViewportChange = () => {
      // The keyboard was confirmed open and the viewport has shrunk back:
      // the user dismissed it via gesture/back button.
      if (wasOpenRef.current && measureKeyboardHeight() <= KEYBOARD_CLOSED_PX) {
        textareaRef.current?.blur();
        reset();
        return;
      }
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(sync);
    };

    const viewport = window.visualViewport;
    viewport?.addEventListener("resize", handleViewportChange, { passive: true });
    webApp?.onEvent?.("viewportChanged", handleViewportChange);

    return () => {
      cancelAnimationFrame(frame);
      viewport?.removeEventListener("resize", handleViewportChange);
      webApp?.offEvent?.("viewportChanged", handleViewportChange);
    };
  }, [active, webApp, measureKeyboardHeight, reset, sync, textareaRef]);

  const handleTextareaFocus = useCallback(() => {
    sync();

    // Smoothly scroll so the textarea and submit button sit above the keyboard.
    clearTimeout(scrollTimerRef.current);
    scrollTimerRef.current = setTimeout(() => {
      const target = bottomAnchorRef.current ?? submitButtonRef.current;
      target?.scrollIntoView({ behavior: "smooth", block: "end" });
    }, SCROLL_DELAY_MS);
  }, [sync, bottomAnchorRef, submitButtonRef]);

  const handleTextareaBlur = useCallback(() => {
    clearTimeout(blurTimerRef.current);
    blurTimerRef.current = setTimeout(() => {
      // Focus moving to the submit button must not collapse the layout under the user's finger.
      const focused = document.activeElement;
      if (focused !== textareaRef.current && focused !== submitButtonRef.current) {
        reset();
      }
    }, BLUR_RESET_DELAY_MS);
  }, [reset, textareaRef, submitButtonRef]);

  /** Blur the textarea and leave compact mode right away (used before submitting). */
  const dismissKeyboard = useCallback(() => {
    const textarea = textareaRef.current;
    if (textarea && document.activeElement === textarea) {
      textarea.blur();
    }
    reset();
  }, [reset, textareaRef]);

  return { isKeyboardOpen, keyboardHeight, handleTextareaFocus, handleTextareaBlur, dismissKeyboard };
}

export type DirectionHint = "demand" | "offer";

export interface PublishRequest {
  init_data: string;
  direction_hint: DirectionHint;
  text: string;
  start_param: string;
}

export interface PublishSuccessResponse {
  success: true;
  status: "queued";
  submission_id?: string;
  source_event_id?: number | null;
  lead_ids?: number[];
  publication_status?: "pending" | "sent" | null;
}

export type ApiErrorKind =
  | "timeout"
  | "network_error"
  | "rate_limited"
  | "not_a_realty_request"
  | "text_too_short"
  | "text_too_long"
  | "text_required"
  | "idempotency_conflict"
  | "expired_session"
  | "invalid_session"
  | "invalid_start_param"
  | "request_too_large"
  | "processing_failed"
  | "request_failed"
  | "invalid_response";

export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  readonly code?: string;
  readonly statusCode?: number;

  constructor(kind: ApiErrorKind, code?: string, statusCode?: number) {
    super(code ? `${kind}: ${code}` : kind);
    this.name = "ApiError";
    this.kind = kind;
    this.code = code;
    this.statusCode = statusCode;
  }
}

const API_BASE_URL = (import.meta.env?.VITE_API_BASE_URL ?? "").replace(/\/+$/, "");
const REQUEST_TIMEOUT_MS = 20_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function endpointUrl(): string {
  return `${API_BASE_URL}/api/miniapp/publish`;
}

export async function submitPublishRequest(
  request: PublishRequest,
  idempotencyKey: string,
): Promise<PublishSuccessResponse> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(endpointUrl(), {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "Idempotency-Key": idempotencyKey,
      },
      credentials: "omit",
      body: JSON.stringify(request),
      signal: controller.signal,
    });

    let payload: Record<string, unknown> | null = null;
    try {
      const parsed: unknown = await response.json();
      if (isRecord(parsed)) {
        payload = parsed;
      }
    } catch {
      // Non-JSON response (e.g. proxy failure or gateway 502/504)
    }

    const code = typeof payload?.code === "string" ? payload.code : undefined;
    const status = typeof payload?.status === "string" ? payload.status : undefined;

    // Specific HTTP Status Codes & Error Codes mapping
    if (response.status === 429 || code === "RATE_LIMITED") {
      throw new ApiError("rate_limited", code, response.status);
    }

    if (response.status === 409 || code === "IDEMPOTENCY_CONFLICT") {
      throw new ApiError("idempotency_conflict", code, response.status);
    }

    if (code === "NOT_A_REALTY_REQUEST" || status === "ignored") {
      throw new ApiError("not_a_realty_request", code, response.status);
    }

    if (code === "TEXT_TOO_SHORT") {
      throw new ApiError("text_too_short", code, response.status);
    }

    if (code === "TEXT_TOO_LONG") {
      throw new ApiError("text_too_long", code, response.status);
    }

    if (code === "TEXT_REQUIRED") {
      throw new ApiError("text_required", code, response.status);
    }

    if (code === "EXPIRED_INIT_DATA") {
      throw new ApiError("expired_session", code, response.status);
    }

    if (code === "INVALID_INIT_DATA") {
      throw new ApiError("invalid_session", code, response.status);
    }

    if (code === "INVALID_START_PARAM") {
      throw new ApiError("invalid_start_param", code, response.status);
    }

    if (response.status === 413 || code === "REQUEST_TOO_LARGE") {
      throw new ApiError("request_too_large", code, response.status);
    }

    if (code === "PROCESSING_FAILED" || response.status >= 500) {
      throw new ApiError("processing_failed", code, response.status);
    }

    if (!response.ok) {
      throw new ApiError("request_failed", code, response.status);
    }

    // Success response validation
    if (!payload || payload.success !== true || payload.status !== "queued") {
      throw new ApiError("invalid_response", code, response.status);
    }

    return payload as unknown as PublishSuccessResponse;
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }

    if (error instanceof DOMException && error.name === "AbortError") {
      throw new ApiError("timeout");
    }

    throw new ApiError("network_error");
  } finally {
    clearTimeout(timeoutId);
  }
}

export function getUserFacingApiError(error: unknown): string {
  if (error instanceof ApiError) {
    switch (error.kind) {
      case "rate_limited":
        return "Слишком много попыток. Подождите немного и попробуйте снова.";
      case "timeout":
        return "Сервер отвечает слишком долго. Попробуйте ещё раз.";
      case "network_error":
        return "Не удалось связаться с сервером. Проверьте соединение и попробуйте ещё раз.";
      case "not_a_realty_request":
        return "Не удалось распознать заявку на недвижимость. Попробуйте подробнее описать объект или критерии поиска.";
      case "text_too_short":
        return "Опишите заявку подробнее (минимум 10 символов).";
      case "text_too_long":
        return "Заявка превышает максимальную длину (до 4000 символов).";
      case "text_required":
        return "Пожалуйста, опишите вашу заявку.";
      case "idempotency_conflict":
        return "Эта заявка уже была отправлена с другим текстом. Нажмите «Изменить заявку».";
      case "expired_session":
        return "Сессия Telegram устарела. Пожалуйста, закройте и откройте приложение снова.";
      case "invalid_session":
        return "Ошибка авторизации Telegram. Откройте приложение через официальный бот.";
      case "invalid_start_param":
        return "Неверный сценарий запуска. Откройте приложение через кнопку «Подать заявку».";
      case "request_too_large":
        return "Размер запроса превышает допустимый предел.";
      case "processing_failed":
        return "Не удалось обработать заявку. Попробуйте изменить текст и отправить ещё раз.";
      default:
        return "Не удалось отправить заявку. Попробуйте ещё раз.";
    }
  }

  return "Не удалось отправить заявку. Попробуйте ещё раз.";
}


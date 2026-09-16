export type DirectionHint = "demand" | "offer";

export interface PublishRequest {
  init_data: string;
  direction_hint: DirectionHint;
  text: string;
  start_param: string;
}

export interface PublishSuccessResponse {
  success: true;
  status?: "queued" | "ignored" | "failed";
  submission_id?: string;
  lead_ids?: number[];
  match_ids?: number[];
  publication_status?: "pending" | "sent" | null;
}

type ApiErrorKind = "timeout" | "rate_limited" | "request_failed" | "invalid_response";

export class ApiError extends Error {
  readonly kind: ApiErrorKind;

  constructor(kind: ApiErrorKind) {
    super(kind);
    this.name = "ApiError";
    this.kind = kind;
  }
}

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/+$/, "");
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
  const timeoutId = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

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

    let payload: unknown = null;
    try {
      payload = await response.json();
    } catch {
      // The response body is intentionally not exposed to the user.
    }

    if (response.status === 429) {
      throw new ApiError("rate_limited");
    }

    if (!response.ok) {
      throw new ApiError("request_failed");
    }

    if (!isRecord(payload) || payload.success !== true) {
      throw new ApiError("invalid_response");
    }

    return payload as unknown as PublishSuccessResponse;
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }

    if (error instanceof DOMException && error.name === "AbortError") {
      throw new ApiError("timeout");
    }

    throw new ApiError("request_failed");
  } finally {
    window.clearTimeout(timeoutId);
  }
}

export function getUserFacingApiError(error: unknown): string {
  if (error instanceof ApiError && error.kind === "rate_limited") {
    return "Слишком много попыток. Подождите немного и попробуйте снова.";
  }

  if (error instanceof ApiError && error.kind === "timeout") {
    return "Сервер отвечает слишком долго. Попробуйте ещё раз.";
  }

  return "Не удалось отправить заявку. Попробуйте ещё раз.";
}

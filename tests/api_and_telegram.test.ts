import test from "node:test";
import assert from "node:assert/strict";
import {
  ApiError,
  getUserFacingApiError,
  submitPublishRequest,
} from "../src/api.ts";
import {
  createIdempotencyKey,
  getInitData,
  getStartParam,
} from "../src/telegram.ts";

test("getUserFacingApiError formats all ApiError kinds properly", () => {
  assert.match(getUserFacingApiError(new ApiError("rate_limited")), /Слишком много попыток/);
  assert.match(getUserFacingApiError(new ApiError("timeout")), /Сервер отвечает слишком долго/);
  assert.match(getUserFacingApiError(new ApiError("network_error")), /Не удалось связаться с сервером/);
  assert.match(getUserFacingApiError(new ApiError("not_a_realty_request")), /Не удалось распознать заявку/);
  assert.match(getUserFacingApiError(new ApiError("text_too_short")), /минимум 10 символов/);
  assert.match(getUserFacingApiError(new ApiError("text_too_long")), /до 4000 символов/);
  assert.match(getUserFacingApiError(new ApiError("text_required")), /Пожалуйста, опишите вашу заявку/);
  assert.match(getUserFacingApiError(new ApiError("idempotency_conflict")), /другим текстом/);
  assert.match(getUserFacingApiError(new ApiError("expired_session")), /Сессия Telegram устарела/);
  assert.match(getUserFacingApiError(new ApiError("invalid_session")), /Ошибка авторизации Telegram/);
  assert.match(getUserFacingApiError(new ApiError("invalid_start_param")), /Неверный сценарий запуска/);
  assert.match(getUserFacingApiError(new ApiError("request_too_large")), /превышает допустимый предел/);
  assert.match(getUserFacingApiError(new ApiError("processing_failed")), /Не удалось обработать заявку/);
  assert.match(getUserFacingApiError(new Error("generic error")), /Не удалось отправить заявку/);
});

test("createIdempotencyKey generates unique, non-empty identifiers", () => {
  const k1 = createIdempotencyKey();
  const k2 = createIdempotencyKey();
  assert.ok(k1 && k1.length > 8);
  assert.ok(k2 && k2.length > 8);
  assert.notEqual(k1, k2);
});

test("getStartParam extracts start parameter correctly", () => {
  const mockWebApp = {
    initData: "valid_init_data",
    initDataUnsafe: { start_param: "publish" },
    ready: () => {},
  };
  assert.equal(getStartParam(mockWebApp), "publish");
  assert.equal(getStartParam({ initData: "", initDataUnsafe: {}, ready: () => {} }), null);
  assert.equal(getStartParam(null), null);
});

test("getInitData extracts initData correctly", () => {
  const mockWebApp = {
    initData: "query_id=123&user=%7B%7D",
    initDataUnsafe: {},
    ready: () => {},
  };
  assert.equal(getInitData(mockWebApp), "query_id=123&user=%7B%7D");
  assert.equal(getInitData({ initData: "  trimmed_data  ", initDataUnsafe: {}, ready: () => {} }), "trimmed_data");
  assert.equal(getInitData({ initData: "", initDataUnsafe: {}, ready: () => {} }), "");
  assert.equal(getInitData(null), "");
});

test("submitPublishRequest returns success on queued 200 response", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    return new Response(
      JSON.stringify({
        success: true,
        status: "queued",
        submission_id: "sub-123",
        source_event_id: 456,
        lead_ids: [789],
        publication_status: "pending",
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  };

  try {
    const result = await submitPublishRequest(
      {
        init_data: "test_data",
        direction_hint: "demand",
        text: "Ищу квартиру в Батуми 1+1 до 800$",
        start_param: "publish",
      },
      "idem-1",
    );
    assert.equal(result.success, true);
    assert.equal(result.status, "queued");
    assert.equal(result.submission_id, "sub-123");
    assert.equal(result.source_event_id, 456);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("submitPublishRequest maps NOT_A_REALTY_REQUEST to not_a_realty_request error", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    return new Response(
      JSON.stringify({
        success: false,
        status: "ignored",
        code: "NOT_A_REALTY_REQUEST",
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  };

  try {
    await assert.rejects(
      submitPublishRequest(
        {
          init_data: "test_data",
          direction_hint: "demand",
          text: "Продам старый велосипед",
          start_param: "publish",
        },
        "idem-2",
      ),
      (err: any) => {
        assert.equal(err.kind, "not_a_realty_request");
        assert.equal(err.code, "NOT_A_REALTY_REQUEST");
        return true;
      },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("submitPublishRequest maps 409 IDEMPOTENCY_CONFLICT", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    return new Response(
      JSON.stringify({
        success: false,
        status: "failed",
        code: "IDEMPOTENCY_CONFLICT",
      }),
      { status: 409, headers: { "Content-Type": "application/json" } },
    );
  };

  try {
    await assert.rejects(
      submitPublishRequest(
        {
          init_data: "test_data",
          direction_hint: "demand",
          text: "Другой текст с тем же ключом",
          start_param: "publish",
        },
        "idem-3",
      ),
      (err: any) => {
        assert.equal(err.kind, "idempotency_conflict");
        assert.equal(err.statusCode, 409);
        return true;
      },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("submitPublishRequest maps 429 RATE_LIMITED", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    return new Response(
      JSON.stringify({
        success: false,
        status: "failed",
        code: "RATE_LIMITED",
      }),
      { status: 429, headers: { "Content-Type": "application/json" } },
    );
  };

  try {
    await assert.rejects(
      submitPublishRequest(
        {
          init_data: "test_data",
          direction_hint: "demand",
          text: "Текст запроса",
          start_param: "publish",
        },
        "idem-4",
      ),
      (err: any) => {
        assert.equal(err.kind, "rate_limited");
        assert.equal(err.statusCode, 429);
        return true;
      },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("submitPublishRequest maps 400 TEXT_TOO_SHORT", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    return new Response(
      JSON.stringify({
        success: false,
        status: "failed",
        code: "TEXT_TOO_SHORT",
      }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  };

  try {
    await assert.rejects(
      submitPublishRequest(
        {
          init_data: "test_data",
          direction_hint: "demand",
          text: "коротко",
          start_param: "publish",
        },
        "idem-5",
      ),
      (err: any) => {
        assert.equal(err.kind, "text_too_short");
        assert.equal(err.statusCode, 400);
        return true;
      },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("submitPublishRequest maps network failure to network_error", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new TypeError("Failed to fetch");
  };

  try {
    await assert.rejects(
      submitPublishRequest(
        {
          init_data: "test_data",
          direction_hint: "demand",
          text: "Текст запроса",
          start_param: "publish",
        },
        "idem-6",
      ),
      (err: any) => {
        assert.equal(err.kind, "network_error");
        return true;
      },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

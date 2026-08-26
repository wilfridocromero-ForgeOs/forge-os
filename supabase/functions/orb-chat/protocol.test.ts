import {
  boundedInteger,
  buildLimitedHistory,
  classifyProviderError,
  classifyProviderStreamError,
  extractOpenAIResponseText,
  MAX_HISTORY_MESSAGES,
  MAX_MESSAGE_CHARS,
  orbEvent,
  parseOrbChatRequest,
  publicError,
  sanitizeErrorCode,
} from "./protocol.ts";

function assertEquals(actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `Expected ${JSON.stringify(expected)}, received ${
        JSON.stringify(actual)
      }`,
    );
  }
}

function assertThrows(callback: () => unknown) {
  try {
    callback();
  } catch {
    return;
  }
  throw new Error("Expected callback to throw");
}

const conversationId = "11111111-1111-4111-8111-111111111111";
const clientMessageId = "22222222-2222-4222-8222-222222222222";

Deno.test("accepts the minimal Orb payload and ignores model selection", () => {
  assertEquals(
    parseOrbChatRequest({
      conversation_id: conversationId,
      client_message_id: clientMessageId,
      message: "Hola Orb",
      model: "untrusted-model",
      organization_id: "untrusted-organization",
    }),
    {
      conversation_id: conversationId,
      client_message_id: clientMessageId,
      message: "Hola Orb",
      surface: null,
    },
  );
});

Deno.test("accepts only the known dashboard surface", () => {
  const base = {
    conversation_id: conversationId,
    client_message_id: clientMessageId,
    message: "Hola",
  };
  assertEquals(
    parseOrbChatRequest({
      ...base,
      surface: { module: "dashboard", route: "/" },
    }).surface,
    { module: "dashboard", route: "/" },
  );
  assertEquals(
    parseOrbChatRequest({
      ...base,
      surface: { module: "admin", route: "/configuracion" },
    }).surface,
    null,
  );
});

Deno.test("rejects invalid, empty, and oversized payloads", () => {
  assertThrows(() => parseOrbChatRequest(null));
  assertThrows(() =>
    parseOrbChatRequest({
      conversation_id: "bad",
      client_message_id: clientMessageId,
      message: "Hola",
    })
  );
  assertThrows(() =>
    parseOrbChatRequest({
      conversation_id: conversationId,
      client_message_id: clientMessageId,
      message: "   ",
    })
  );
  assertThrows(() =>
    parseOrbChatRequest({
      conversation_id: conversationId,
      client_message_id: clientMessageId,
      message: "x".repeat(MAX_MESSAGE_CHARS + 1),
    })
  );
});

Deno.test("limits history count and keeps chronological order", () => {
  const rows = Array.from({ length: MAX_HISTORY_MESSAGES + 5 }, (_, index) => ({
    id: String(index).padStart(3, "0"),
    role: index % 2 ? "assistant" : "user",
    content: `message-${index}`,
    created_at: new Date(2026, 0, 1, 0, index).toISOString(),
  }));
  const history = buildLimitedHistory(rows);
  assertEquals(history.length, MAX_HISTORY_MESSAGES);
  assertEquals(history[0].content, "message-5");
  assertEquals(history.at(-1)?.content, `message-${MAX_HISTORY_MESSAGES + 4}`);
});

Deno.test("sanitizes provider errors and emits only the Orb protocol", () => {
  assertEquals(sanitizeErrorCode("AI_TIMEOUT"), "AI_TIMEOUT");
  assertEquals(sanitizeErrorCode("secret: leaked"), "ORB_REQUEST_FAILED");
  assertEquals(publicError(new Error("sensitive detail")), {
    status: 500,
    code: "ORB_REQUEST_FAILED",
    message: "Orb could not complete the request.",
  });
  const event = orbEvent("delta", { delta: "hola" });
  assertEquals(event.includes("event: delta"), true);
  assertEquals(event.includes("orb-stream-v1"), true);
});

Deno.test("bounds backend-only cost controls", () => {
  assertEquals(boundedInteger("99999", 800, 128, 2000), 2000);
  assertEquals(boundedInteger("1", 800, 128, 2000), 128);
  assertEquals(boundedInteger(undefined, 800, 128, 2000), 800);
});

Deno.test("classifies provider failures without exposing provider messages", () => {
  assertEquals(
    classifyProviderError(401, "invalid_api_key"),
    "AI_AUTHENTICATION_FAILED",
  );
  assertEquals(
    classifyProviderError(403, "permission_denied"),
    "AI_ACCESS_DENIED",
  );
  assertEquals(
    classifyProviderError(404, "model_not_found"),
    "AI_MODEL_UNAVAILABLE",
  );
  assertEquals(
    classifyProviderError(429, "insufficient_quota"),
    "AI_QUOTA_EXCEEDED",
  );
  assertEquals(
    classifyProviderError(429, "billing_not_active"),
    "AI_BILLING_INACTIVE",
  );
  assertEquals(
    classifyProviderError(429, "rate_limit_exceeded"),
    "AI_RATE_LIMITED",
  );
  assertEquals(
    classifyProviderError(400, "invalid_request_error"),
    "AI_REQUEST_INVALID",
  );
  assertEquals(classifyProviderError(503, null), "AI_PROVIDER_UNAVAILABLE");
  assertEquals(
    classifyProviderStreamError(null, "You have insufficient quota."),
    "AI_QUOTA_EXCEEDED",
  );
  assertEquals(
    classifyProviderStreamError("model_not_found", null),
    "AI_MODEL_UNAVAILABLE",
  );
  assertEquals(
    classifyProviderStreamError(null, "Unrecognized provider failure"),
    "AI_STREAM_FAILED_UNCLASSIFIED",
  );
  assertEquals(
    classifyProviderStreamError(
      null,
      "The server encountered an error while processing your request.",
    ),
    "AI_PROVIDER_UNAVAILABLE",
  );
  assertEquals(
    classifyProviderStreamError(null, null),
    "AI_STREAM_FAILED_WITHOUT_DETAILS",
  );
});

Deno.test("extracts text from a non-streaming Responses API payload", () => {
  assertEquals(
    extractOpenAIResponseText({
      output: [
        { type: "reasoning", content: [] },
        {
          type: "message",
          content: [
            { type: "output_text", text: "Hola" },
            { type: "refusal", refusal: "ignored" },
            { type: "output_text", text: " desde Orb" },
          ],
        },
      ],
    }),
    "Hola desde Orb",
  );
  assertEquals(extractOpenAIResponseText(null), "");
});

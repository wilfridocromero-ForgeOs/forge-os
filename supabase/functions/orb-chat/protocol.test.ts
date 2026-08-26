import {
  boundedInteger,
  buildLimitedHistory,
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
    },
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

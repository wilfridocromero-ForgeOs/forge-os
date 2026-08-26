export const ORB_PROTOCOL_VERSION = "orb-stream-v1";
export const MAX_MESSAGE_CHARS = 8_000;
export const MAX_HISTORY_MESSAGES = 24;
export const MAX_HISTORY_CHARS = 30_000;

export type OrbChatRequest = {
  conversation_id: string;
  client_message_id: string;
  message: string;
};

export class OrbRequestError extends Error {
  constructor(public code: string, public status: number, message: string) {
    super(message);
  }
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SAFE_ERROR_PATTERN = /^[A-Z0-9_]{1,80}$/;

export function parseOrbChatRequest(value: unknown): OrbChatRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new OrbRequestError(
      "INVALID_PAYLOAD",
      400,
      "Invalid request payload.",
    );
  }
  const payload = value as Record<string, unknown>;
  const conversationId = typeof payload.conversation_id === "string"
    ? payload.conversation_id
    : "";
  const clientMessageId = typeof payload.client_message_id === "string"
    ? payload.client_message_id
    : "";
  const message = typeof payload.message === "string" ? payload.message : "";

  if (
    !UUID_PATTERN.test(conversationId) || !UUID_PATTERN.test(clientMessageId)
  ) {
    throw new OrbRequestError(
      "INVALID_PAYLOAD",
      400,
      "Valid conversation and client message IDs are required.",
    );
  }
  if (!message.trim()) {
    throw new OrbRequestError("EMPTY_MESSAGE", 400, "Message cannot be empty.");
  }
  if (message.length > MAX_MESSAGE_CHARS) {
    throw new OrbRequestError(
      "MESSAGE_TOO_LARGE",
      413,
      `Message cannot exceed ${MAX_MESSAGE_CHARS} characters.`,
    );
  }
  return {
    conversation_id: conversationId,
    client_message_id: clientMessageId,
    message,
  };
}

export function sanitizeErrorCode(
  value: unknown,
  fallback = "ORB_REQUEST_FAILED",
) {
  return typeof value === "string" && SAFE_ERROR_PATTERN.test(value)
    ? value
    : fallback;
}

export function orbEvent(
  type: "start" | "delta" | "completed" | "error",
  data: Record<string, unknown>,
) {
  return `event: ${type}\ndata: ${
    JSON.stringify({ protocol: ORB_PROTOCOL_VERSION, ...data })
  }\n\n`;
}

export function boundedInteger(
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
) {
  const parsed = Number.parseInt(value || "", 10);
  return Number.isFinite(parsed)
    ? Math.min(maximum, Math.max(minimum, parsed))
    : fallback;
}

export function buildLimitedHistory(
  rows: Array<
    { role: string; content: string; created_at: string; id: string }
  >,
) {
  const ordered = [...rows]
    .filter((row) =>
      (row.role === "user" || row.role === "assistant") &&
      Boolean(row.content?.trim())
    )
    .sort((left, right) =>
      left.created_at.localeCompare(right.created_at) ||
      left.id.localeCompare(right.id)
    )
    .slice(-MAX_HISTORY_MESSAGES);

  let usedCharacters = 0;
  const selected: Array<{ role: "user" | "assistant"; content: string }> = [];
  for (let index = ordered.length - 1; index >= 0; index -= 1) {
    const row = ordered[index];
    if (usedCharacters + row.content.length > MAX_HISTORY_CHARS) break;
    usedCharacters += row.content.length;
    selected.unshift({
      role: row.role as "user" | "assistant",
      content: row.content,
    });
  }
  return selected;
}

export function publicError(error: unknown) {
  if (error instanceof OrbRequestError) {
    return { status: error.status, code: error.code, message: error.message };
  }
  return {
    status: 500,
    code: "ORB_REQUEST_FAILED",
    message: "Orb could not complete the request.",
  };
}

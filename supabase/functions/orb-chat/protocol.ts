export const ORB_PROTOCOL_VERSION = "orb-stream-v1";
export const MAX_MESSAGE_CHARS = 8_000;
export const MAX_HISTORY_MESSAGES = 24;
export const MAX_HISTORY_CHARS = 30_000;

export type OrbChatRequest = {
  conversation_id: string;
  client_message_id: string;
  message: string;
  surface: { module: "dashboard"; route: "/" } | null;
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
  const surfaceValue = payload.surface;
  const surface = surfaceValue && typeof surfaceValue === "object" &&
      !Array.isArray(surfaceValue) &&
      (surfaceValue as Record<string, unknown>).module === "dashboard" &&
      (surfaceValue as Record<string, unknown>).route === "/"
    ? { module: "dashboard" as const, route: "/" as const }
    : null;

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
    surface,
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

export function classifyProviderError(status: number, providerCode: unknown) {
  const normalized = typeof providerCode === "string"
    ? providerCode.trim().toUpperCase().replace(/[^A-Z0-9_]/g, "_").slice(0, 80)
    : "";
  if (normalized === "BILLING_NOT_ACTIVE") return "AI_BILLING_INACTIVE";
  if (normalized === "INSUFFICIENT_QUOTA") return "AI_QUOTA_EXCEEDED";
  if (normalized === "RATE_LIMIT_EXCEEDED") return "AI_RATE_LIMITED";
  if (normalized === "MODEL_NOT_FOUND") return "AI_MODEL_UNAVAILABLE";
  if (status === 401) return "AI_AUTHENTICATION_FAILED";
  if (status === 403) return "AI_ACCESS_DENIED";
  if (status === 404) return "AI_MODEL_UNAVAILABLE";
  if (status === 429) return "AI_RATE_LIMITED";
  if (status === 400) return "AI_REQUEST_INVALID";
  if (status >= 500) return "AI_PROVIDER_UNAVAILABLE";
  return "AI_PROVIDER_ERROR";
}

export function classifyProviderStreamError(
  providerCode: unknown,
  providerMessage: unknown,
) {
  const code = typeof providerCode === "string"
    ? providerCode.trim().toLowerCase()
    : "";
  const message = typeof providerMessage === "string"
    ? providerMessage.trim().toLowerCase()
    : "";
  const detail = `${code} ${message}`;

  if (/invalid[_ ]api[_ ]key|incorrect api key|authentication/.test(detail)) {
    return "AI_AUTHENTICATION_FAILED";
  }
  if (/insufficient[_ ]quota|quota|billing|credit/.test(detail)) {
    return "AI_QUOTA_EXCEEDED";
  }
  if (/rate[_ ]limit|too many requests/.test(detail)) {
    return "AI_RATE_LIMITED";
  }
  if (
    /model[_ ]not[_ ]found|model.*(access|permission|available)/.test(detail)
  ) {
    return "AI_MODEL_UNAVAILABLE";
  }
  if (/permission|forbidden|access denied/.test(detail)) {
    return "AI_ACCESS_DENIED";
  }
  if (
    /server[_ ]error|internal error|temporarily unavailable|overloaded|server encountered|error (while|during) processing/
      .test(
        detail,
      )
  ) {
    return "AI_PROVIDER_UNAVAILABLE";
  }
  if (
    /invalid[_ ]request|invalid parameter|unsupported parameter/.test(detail)
  ) {
    return "AI_REQUEST_INVALID";
  }
  if (!code && !message) return "AI_STREAM_FAILED_WITHOUT_DETAILS";
  return "AI_STREAM_FAILED_UNCLASSIFIED";
}

export function extractOpenAIResponseText(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  const output = (value as { output?: unknown }).output;
  if (!Array.isArray(output)) return "";
  return output.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const content = (item as { content?: unknown }).content;
    if (!Array.isArray(content)) return [];
    return content.flatMap((part) => {
      if (!part || typeof part !== "object" || Array.isArray(part)) return [];
      const candidate = part as { type?: unknown; text?: unknown };
      return candidate.type === "output_text" &&
          typeof candidate.text === "string"
        ? [candidate.text]
        : [];
    });
  }).join("");
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

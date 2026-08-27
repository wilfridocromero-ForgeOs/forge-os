import {
  classifyProviderError,
  classifyProviderStreamError,
  OrbRequestError,
} from "./protocol.ts";

type ProviderError = {
  code?: unknown;
  type?: unknown;
  message?: unknown;
} | null;

type ProviderStreamEvent = {
  type?: unknown;
  delta?: unknown;
  code?: unknown;
  message?: unknown;
  error?: ProviderError;
  item?: Record<string, unknown>;
  response?: {
    id?: unknown;
    status?: unknown;
    error?: ProviderError;
  };
};

function providerFailure(error: ProviderError) {
  return new OrbRequestError(
    classifyProviderStreamError(
      error?.code || error?.type,
      error?.message,
    ),
    502,
    "Orb could not obtain a model response.",
  );
}

async function providerHttpFailure(response: Response) {
  let error: ProviderError = null;
  try {
    const payload = await response.json() as { error?: ProviderError };
    error = payload.error || null;
  } catch {
    // Provider details are optional and never exposed to the client.
  }
  return new OrbRequestError(
    classifyProviderError(
      response.status,
      error?.code || error?.type,
    ),
    502,
    "Orb could not obtain a model response.",
  );
}

function parseProviderEvent(block: string): ProviderStreamEvent | null {
  const data = block.split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart())
    .join("\n");
  if (!data || data === "[DONE]") return null;
  try {
    return JSON.parse(data) as ProviderStreamEvent;
  } catch {
    throw new OrbRequestError(
      "AI_RESPONSE_INVALID",
      502,
      "Orb received an invalid model stream.",
    );
  }
}

export async function consumeOpenAIResponseStream(
  response: Response,
  onDelta: (delta: string) => void,
  captureToolCalls = false,
) {
  if (!response.ok) throw await providerHttpFailure(response);
  if (!response.body) {
    throw new OrbRequestError(
      "AI_RESPONSE_INVALID",
      502,
      "Orb received an empty model stream.",
    );
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let output = "";
  let responseId = "";
  let completed = false;
  const outputItems: Record<string, unknown>[] = [];

  const consumeBlock = (block: string) => {
    const event = parseProviderEvent(block);
    if (!event) return;
    const type = typeof event.type === "string" ? event.type : "";

    if (
      (type === "response.created" || type === "response.in_progress") &&
      typeof event.response?.id === "string"
    ) {
      responseId = event.response.id;
      return;
    }
    if (
      (type === "response.output_text.delta" ||
        type === "response.refusal.delta") &&
      typeof event.delta === "string" && event.delta
    ) {
      output += event.delta;
      onDelta(event.delta);
      return;
    }
    if (type === "response.output_item.done" && event.item) {
      outputItems.push(event.item);
      return;
    }
    if (type === "response.completed") {
      if (typeof event.response?.id === "string") {
        responseId = event.response.id;
      }
      completed = true;
      return;
    }
    if (type === "response.incomplete") {
      throw new OrbRequestError(
        "AI_RESPONSE_INCOMPLETE",
        502,
        "Orb model response was incomplete.",
      );
    }
    if (type === "response.failed" || type === "error") {
      throw providerFailure(
        event.response?.error || event.error || {
          code: event.code,
          message: event.message,
        },
      );
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
    const blocks = buffer.split(/\r?\n\r?\n/);
    buffer = blocks.pop() || "";
    blocks.forEach(consumeBlock);
    if (done) break;
  }
  if (buffer.trim()) consumeBlock(buffer);

  if (!completed) {
    throw new OrbRequestError(
      "AI_STREAM_INTERRUPTED",
      502,
      "Orb model stream ended before completion.",
    );
  }
  const toolCalls = outputItems.filter((item) =>
    item.type === "function_call" && typeof item.name === "string" &&
    typeof item.call_id === "string" && typeof item.arguments === "string"
  );
  if (!output.trim() && toolCalls.length === 0) {
    throw new OrbRequestError(
      "EMPTY_AI_RESPONSE",
      502,
      "Orb returned an empty response.",
    );
  }
  return captureToolCalls
    ? { output, responseId, outputItems, toolCalls }
    : { output, responseId };
}

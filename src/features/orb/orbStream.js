const ORB_EVENTS = new Set(["start", "delta", "completed", "error"]);

function parseEventBlock(block) {
  let event = "message";
  const dataLines = [];
  block.split(/\r?\n/).forEach((line) => {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
  });
  if (!dataLines.length || !ORB_EVENTS.has(event)) return null;
  try {
    return { event, data: JSON.parse(dataLines.join("\n")) };
  } catch {
    return null;
  }
}

export function createOrbEventParser(onEvent) {
  let buffer = "";
  let terminalEvent = false;

  const consume = (block) => {
    const parsed = parseEventBlock(block);
    if (!parsed) return;
    if (parsed.event === "completed" || parsed.event === "error") {
      terminalEvent = true;
    }
    onEvent(parsed.event, parsed.data);
  };

  return {
    push(chunk) {
      buffer += chunk;
      const blocks = buffer.split(/\r?\n\r?\n/);
      buffer = blocks.pop() || "";
      blocks.forEach(consume);
    },
    finish() {
      if (buffer.trim()) consume(buffer);
      buffer = "";
      return terminalEvent;
    },
  };
}

export async function consumeOrbEventReader(reader, onEvent) {
  const decoder = new TextDecoder();
  let terminalError = null;
  const parser = createOrbEventParser((type, payload) => {
    if (type === "error") terminalError = payload;
    onEvent(type, payload);
  });

  try {
    while (!terminalError) {
      const { done, value } = await reader.read();
      parser.push(decoder.decode(value || new Uint8Array(), { stream: !done }));
      if (done) break;
    }
    const terminal = parser.finish();
    if (terminalError) return { error: terminalError };
    if (!terminal) throw new Error("La respuesta de Orb se interrumpió antes de terminar.");
    return { error: null };
  } finally {
    if (terminalError) await reader.cancel().catch(() => {});
  }
}

export function reconcileAssistantStart(messages, optimisticId, assistantId) {
  if (!assistantId || optimisticId === assistantId) return messages;
  const serverMessageExists = messages.some((message) =>
    message.id === assistantId
  );
  return messages.flatMap((message) => {
    if (message.id !== optimisticId) return [message];
    return serverMessageExists ? [] : [{ ...message, id: assistantId }];
  });
}

export function appendAssistantDelta(messages, assistantId, delta) {
  if (!assistantId || !delta) return messages;
  return messages.map((message) =>
    message.id === assistantId
      ? { ...message, content: `${message.content || ""}${delta}` }
      : message
  );
}

export function finishAssistantStream(messages, assistantId) {
  return messages.map((message) =>
    message.id === assistantId
      ? { ...message, displayStatus: "completed" }
      : message
  );
}

export function failAssistantStream(messages, assistantId, errorCode) {
  return messages.map((message) =>
    message.id === assistantId
      ? { ...message, displayStatus: "failed", error_code: errorCode || null }
      : message
  );
}

export function shouldFollowStreamGrowth(isFollowing) {
  return Boolean(isFollowing);
}

export function nextFollowState({
  isFollowing,
  previousScrollTop,
  currentScrollTop,
  upwardTolerance = 2,
}) {
  if (currentScrollTop < previousScrollTop - upwardTolerance) return false;
  return Boolean(isFollowing);
}

export function reactivateFollow() {
  return true;
}

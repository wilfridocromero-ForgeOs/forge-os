import assert from "node:assert/strict";
import test from "node:test";

import { consumeOrbEventReader } from "./orbStream.js";

function readerFor(chunks) {
  let index = 0;
  let cancelCount = 0;
  return {
    get cancelCount() { return cancelCount; },
    async read() {
      if (index >= chunks.length) return { done: true, value: undefined };
      return { done: false, value: new TextEncoder().encode(chunks[index++]) };
    },
    async cancel() { cancelCount += 1; },
  };
}

test("terminal SSE error stops reading, cancels once and reports once", async () => {
  const reader = readerFor([
    'event: start\ndata: {"assistant_message_id":"a1"}\n\n' +
      'event: error\ndata: {"code":"AI_REQUEST_INVALID"}\n\n',
    'event: delta\ndata: {"delta":"must not be read"}\n\n',
  ]);
  const events = [];
  const result = await consumeOrbEventReader(reader, (type, payload) => events.push([type, payload]));
  assert.deepEqual(result, { error: { code: "AI_REQUEST_INVALID" } });
  assert.equal(reader.cancelCount, 1);
  assert.deepEqual(events.map(([type]) => type), ["start", "error"]);
});

test("successful SSE completion remains unchanged and does not cancel", async () => {
  const reader = readerFor([
    'event: start\ndata: {"assistant_message_id":"a1"}\n\n' +
      'event: delta\ndata: {"delta":"Hola"}\n\n' +
      'event: completed\ndata: {"assistant_message_id":"a1"}\n\n',
  ]);
  const events = [];
  assert.deepEqual(
    await consumeOrbEventReader(reader, (type, payload) => events.push([type, payload])),
    { error: null },
  );
  assert.equal(reader.cancelCount, 0);
  assert.deepEqual(events.map(([type]) => type), ["start", "delta", "completed"]);
});

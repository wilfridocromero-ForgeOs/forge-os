import assert from "node:assert/strict";
import test from "node:test";
import { createLandingAutosave } from "./landingAutosave.js";

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

test("autosave debounces and persists only the newest pending document", async () => {
  let timer; const calls = [];
  const queue = createLandingAutosave({
    save: async (value) => { calls.push(value); return { revision: value.expectedRevision + 1 }; },
    onStatus() {}, onSaved() {}, onConflict() {}, onError() {},
    setTimer: (callback) => { timer = callback; return 1; }, clearTimer() {},
  });
  queue.initialize(2); queue.schedule({ value: 1 }); queue.schedule({ value: 2 }); timer(); await tick();
  assert.deepEqual(calls, [{ expectedRevision: 2, document: { value: 2 } }]);
});

test("autosave serializes writes and advances the expected revision", async () => {
  const resolvers = []; const calls = [];
  const queue = createLandingAutosave({ save: (value) => { calls.push(value); return new Promise((resolve) => resolvers.push(resolve)); }, onStatus() {}, onSaved() {}, onConflict() {}, onError() {}, setTimer: (callback) => { callback(); return 1; }, clearTimer() {} });
  queue.initialize(6); queue.schedule({ value: 1 }, 0); queue.schedule({ value: 2 }, 0);
  assert.equal(calls.length, 1); resolvers[0]({ revision: 7 }); await tick(); assert.equal(calls.length, 2); assert.equal(calls[1].expectedRevision, 7); resolvers[1]({ revision: 8 }); await queue.flush();
});

test("conflict blocks retries until reset and flush never hangs", async () => {
  const statuses = []; const conflict = new Error("conflict"); conflict.name = "BuilderDraftConflictError";
  const queue = createLandingAutosave({ save: async () => { throw conflict; }, onStatus: (value) => statuses.push(value), onSaved() {}, onConflict() {}, onError() {}, setTimer: (callback) => { callback(); return 1; }, clearTimer() {} });
  queue.initialize(1); queue.schedule({ value: 1 }, 0); await tick(); await queue.flush();
  assert.equal(statuses.at(-1), "conflict"); queue.reset(2); assert.equal(statuses.at(-1), "saved");
});

test("generic failures retain work for an explicit retry", async () => {
  let attempts = 0; let resolveRetry; const statuses = [];
  const queue = createLandingAutosave({ save: async () => { attempts += 1; if (attempts === 1) throw new Error("offline"); return { revision: 2 }; }, onStatus: (value) => statuses.push(value), onSaved: () => resolveRetry?.(), onConflict() {}, onError() {}, setTimer: (callback) => { callback(); return 1; }, clearTimer() {} });
  queue.initialize(1); queue.schedule({ value: 1 }, 0); await tick(); assert.equal(statuses.at(-1), "error");
  await new Promise((resolve) => { resolveRetry = resolve; queue.retry(); }); assert.equal(attempts, 2); assert.equal(statuses.at(-1), "saved");
});

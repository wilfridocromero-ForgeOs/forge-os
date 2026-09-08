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

test("rapid edits persist the latest snapshot once without overlapping requests", async () => {
  const resolvers = []; const calls = []; let concurrent = 0; let maximumConcurrent = 0;
  const queue = createLandingAutosave({
    save: (value) => { calls.push(value); concurrent += 1; maximumConcurrent = Math.max(maximumConcurrent, concurrent); return new Promise((resolve) => resolvers.push((result) => { concurrent -= 1; resolve(result); })); },
    onStatus() {}, onSaved() {}, onConflict() {}, onError() {}, setTimer: (callback) => { callback(); return 1; }, clearTimer() {},
  });
  queue.initialize(10);
  const first = { value: "A" }; const latest = { value: "C" };
  queue.schedule(first, 0); queue.schedule({ value: "B" }, 0); queue.schedule(latest, 0);
  resolvers[0]({ revision: 11 }); await tick();
  queue.schedule(latest, 0);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].document.value, "C");
  resolvers[1]({ revision: 12 });
  assert.equal(await queue.flush(), true);
  assert.equal(calls.length, 2);
  assert.equal(maximumConcurrent, 1);
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

test("flush resolves false on an active failure and retry persists the newest edit", async () => {
  let rejectFirst; const calls = []; const saved = [];
  const queue = createLandingAutosave({
    save: (value) => { calls.push(value); if (calls.length === 1) return new Promise((_, reject) => { rejectFirst = reject; }); return Promise.resolve({ revision: 4 }); },
    onStatus() {}, onSaved: (_, document) => saved.push(document), onConflict() {}, onError() {}, setTimer: (callback) => { callback(); return 1; }, clearTimer() {},
  });
  queue.initialize(3);
  queue.schedule({ value: "A" }, 0);
  const flushing = queue.flush();
  queue.schedule({ value: "C" }, 0);
  rejectFirst(new Error("offline"));
  assert.equal(await flushing, false);
  queue.retry(); await tick();
  assert.equal(calls.at(-1).document.value, "C");
  assert.equal(saved.at(-1).value, "C");
});

test("save and reload preserve a representative complete Builder document exactly", async () => {
  const document = {
    text: "Heading C", style: { spacing: "lg", appearance: { surface: "glass" } },
    header: { navigation: [{ label: "Inicio", target: { type: "section", anchor: "inicio" } }] },
    form: { asset_id: "form-1" }, pattern: { id: "features" }, responsive: { mobile: { align: "center" } },
    sections: [{ id: "section-1", blocks: [{ id: "heading-1" }, { id: "form-1" }] }],
  };
  let persisted = null;
  const queue = createLandingAutosave({ save: async ({ document: value }) => { persisted = structuredClone(value); return { revision: 2 }; }, onStatus() {}, onSaved() {}, onConflict() {}, onError() {}, setTimer: (callback) => { callback(); return 1; }, clearTimer() {} });
  queue.initialize(1); queue.schedule(document, 0); assert.equal(await queue.flush(), true);
  assert.deepEqual(structuredClone(persisted), document);
});

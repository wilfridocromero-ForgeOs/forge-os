import assert from "node:assert/strict";
import test from "node:test";

import {
  createVersionDiagnosticHistory,
  VERSION_DIAGNOSTIC_HISTORY_KEY,
} from "./versionDiagnostics.js";

function memoryStorage(initial = new Map()) {
  return {
    values: initial,
    getItem(key) { return initial.get(key) ?? null; },
    setItem(key, value) { initial.set(key, value); },
    removeItem(key) { initial.delete(key); },
  };
}

const diagnostic = (overrides = {}) => ({
  source: "initial",
  current: { version: "current-sha", builtAt: 1000 },
  remote: { version: "next-sha", builtAt: 2000 },
  stateBefore: "current",
  classification: "update_available",
  stateAfter: "update_available",
  reason: "different_newer_version",
  visibility: "visible",
  bannerEvent: "shown",
  ...overrides,
});

test("diagnostic history is bounded", () => {
  const storage = memoryStorage();
  let now = 1000;
  const history = createVersionDiagnosticHistory({ storage, tabId: "tab-a", maxEntries: 3, now: () => now++ });
  history.push(diagnostic());
  history.push(diagnostic({ source: "poll", classification: "current", stateBefore: "update_available", stateAfter: "update_available", bannerEvent: null }));
  history.push(diagnostic({ source: "focus", classification: "current", stateBefore: "update_available", stateAfter: "update_available", bannerEvent: null }));
  history.push(diagnostic({ source: "online", classification: "current", stateBefore: "update_available", stateAfter: "update_available", bannerEvent: null }));
  assert.equal(history.history().length, 3);
  assert.equal(history.history()[0].source, "poll");
  assert.equal(JSON.parse(storage.values.get(VERSION_DIAGNOSTIC_HISTORY_KEY)).length, 3);
});

test("a later current observation does not erase the event that showed the banner", () => {
  const storage = memoryStorage();
  let now = 1000;
  const history = createVersionDiagnosticHistory({ storage, tabId: "tab-a", now: () => now++ });
  history.push(diagnostic());
  history.push(diagnostic({
    source: "poll",
    classification: "current",
    stateBefore: "update_available",
    stateAfter: "update_available",
    bannerEvent: null,
  }));
  assert.equal(history.history()[0].bannerEvent, "shown");
  assert.equal(history.history()[1].classification, "current");
});

test("diagnostic history survives reload and sanitizes unknown or sensitive fields", () => {
  const storage = memoryStorage();
  const first = createVersionDiagnosticHistory({ storage, tabId: "tab-a", now: () => 1000 });
  first.push(diagnostic({
    source: "not-a-trigger",
    requestId: 7,
    pageshowPersisted: true,
    headers: { etag: "etag", age: "12", xVercelCache: "HIT", authorization: "secret" },
    prompt: "business data",
  }));
  const reloaded = createVersionDiagnosticHistory({ storage, tabId: "tab-b", now: () => 2000 });
  const [entry] = reloaded.history();
  assert.equal(entry.source, "unknown");
  assert.equal(entry.requestId, 7);
  assert.equal(entry.pageshowPersisted, true);
  assert.deepEqual(entry.headers, { etag: "etag", age: "12", xVercelCache: "HIT" });
  assert.equal("authorization" in entry.headers, false);
  assert.equal("prompt" in entry, false);
});

test("history returns copies and clear removes persisted diagnostics", () => {
  const storage = memoryStorage();
  const history = createVersionDiagnosticHistory({ storage, tabId: "tab-a", now: () => 1000 });
  history.push(diagnostic());
  const copy = history.history();
  copy[0].source = "poll";
  assert.equal(history.history()[0].source, "initial");
  history.clear();
  assert.deepEqual(history.history(), []);
  assert.equal(storage.values.has(VERSION_DIAGNOSTIC_HISTORY_KEY), false);
});

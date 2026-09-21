import assert from "node:assert/strict";
import test from "node:test";

import {
  appendAssistantDelta,
  createOrbEventParser,
  finishAssistantStream,
  nextFollowState,
  reactivateFollow,
  reconcileAssistantStart,
  shouldFollowStreamGrowth,
} from "./orbStream.js";

test("parses ordered chunks and one terminal completion", () => {
  const events = [];
  const parser = createOrbEventParser((event, data) => events.push([event, data]));
  parser.push('event: start\ndata: {"assistant_message_id":"a1"}\n\nevent: delta\ndata: {"delta":"Ho');
  parser.push('la"}\n\nevent: delta\ndata: {"delta":" Orb"}\n\nevent: completed\ndata: {}\n\n');
  assert.equal(parser.finish(), true);
  assert.deepEqual(events.map(([event]) => event), ["start", "delta", "delta", "completed"]);
  assert.equal(events.filter(([event]) => event === "completed").length, 1);
});

test("recognizes a terminal stream error", () => {
  const events = [];
  const parser = createOrbEventParser((event, data) => events.push([event, data]));
  parser.push('event: delta\ndata: {"delta":"Parcial"}\n\nevent: error\ndata: {"code":"AI_TIMEOUT"}\n\n');
  assert.equal(parser.finish(), true);
  assert.deepEqual(events.at(-1), ["error", { code: "AI_TIMEOUT" }]);
});

test("accumulates deltas without duplicating the assistant message", () => {
  const initial = [
    { id: "user-1", role: "user", content: "Hola" },
    { id: "local-assistant", role: "assistant", content: "", displayStatus: "streaming" },
  ];
  const started = reconcileAssistantStart(initial, "local-assistant", "assistant-1");
  const replayedStart = reconcileAssistantStart(started, "local-assistant", "assistant-1");
  const withText = appendAssistantDelta(
    appendAssistantDelta(replayedStart, "assistant-1", "Hola"),
    "assistant-1",
    " mundo",
  );
  const completed = finishAssistantStream(withText, "assistant-1");

  assert.equal(completed.filter((message) => message.role === "assistant").length, 1);
  assert.equal(completed.find((message) => message.id === "assistant-1").content, "Hola mundo");
  assert.equal(completed.find((message) => message.id === "assistant-1").displayStatus, "completed");
});

test("reuses the existing failed assistant message during retry", () => {
  const failed = [
    { id: "user-1", role: "user", client_message_id: "client-1" },
    { id: "assistant-1", role: "assistant", content: "", displayStatus: "streaming" },
  ];
  const started = reconcileAssistantStart(
    failed,
    "local-assistant-client-1",
    "assistant-1",
  );
  const retried = appendAssistantDelta(started, "assistant-1", "Respuesta");
  assert.equal(retried.length, 2);
  assert.equal(retried.filter((message) => message.role === "assistant").length, 1);
  assert.equal(retried[1].content, "Respuesta");
});

test("stops auto-follow on upward scroll and reactivates from the jump control", () => {
  assert.equal(shouldFollowStreamGrowth(true), true);
  assert.equal(nextFollowState({ isFollowing: true, previousScrollTop: 500, currentScrollTop: 430 }), false);
  assert.equal(nextFollowState({ isFollowing: false, previousScrollTop: 430, currentScrollTop: 520 }), false);
  assert.equal(reactivateFollow(), true);
  assert.equal(shouldFollowStreamGrowth(reactivateFollow()), true);
});

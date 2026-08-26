import assert from "node:assert/strict";
import test from "node:test";

import { normalizeOrbMessages } from "./orbMessageOrder.js";

test("places a user before the assistant that replies to it", () => {
  const createdAt = "2026-08-26T04:36:33.670821Z";
  const rows = [
    { id: "a-assistant", role: "assistant", status: "completed", reply_to_message_id: "z-user", created_at: createdAt },
    { id: "z-user", role: "user", status: "completed", created_at: createdAt },
  ];
  assert.deepEqual(normalizeOrbMessages(rows).map((message) => message.id), ["z-user", "a-assistant"]);
});

test("preserves chronological turn order and uses a stable role fallback", () => {
  const rows = [
    { id: "a2", role: "assistant", status: "completed", created_at: "2026-08-26T04:36:34Z" },
    { id: "a1", role: "assistant", status: "completed", created_at: "2026-08-26T04:36:33Z" },
    { id: "u1", role: "user", status: "completed", created_at: "2026-08-26T04:36:33Z" },
  ];
  assert.deepEqual(normalizeOrbMessages(rows).map((message) => message.id), ["u1", "a1", "a2"]);
});

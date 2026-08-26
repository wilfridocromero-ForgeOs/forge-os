import test from "node:test";
import assert from "node:assert/strict";

import { buildOrbNowBriefing } from "./dashboardViewModel.js";

const source = (value = {}) => ({ available: true, ...value });

test("builds Orb Now only from real structured metrics", () => {
  const result = buildOrbNowBriefing({
    tasks: source({ overdueCount: 2, today: [{}, {}] }),
    calendar: source({ today: [{}] }),
    discovery: source({ pendingCount: 1 }),
    projects: source({ count: 3 }), clients: source({ count: 2 }),
  });
  assert.equal(result.state, "ready");
  assert.match(result.text, /2 tareas vencidas/);
  assert.match(result.text, /1 evento hoy/);
});

test("handles empty, partial and unavailable dashboard snapshots", () => {
  assert.equal(buildOrbNowBriefing({ tasks: source({ overdueCount: 0, today: [] }), calendar: source({ today: [] }), discovery: source({ pendingCount: 0 }), projects: source({ count: 0 }), clients: source({ count: 0 }) }).state, "empty");
  assert.equal(buildOrbNowBriefing({ tasks: { available: false }, calendar: { available: false }, discovery: { available: false }, projects: { available: false } }).state, "unavailable");
  assert.equal(buildOrbNowBriefing({ tasks: { available: false }, calendar: source({ today: [] }), discovery: source({ pendingCount: 0 }), projects: source({ count: 1 }), clients: source({ count: 0 }) }).state, "ready");
});

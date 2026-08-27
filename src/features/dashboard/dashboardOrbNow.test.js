import test from "node:test";
import assert from "node:assert/strict";

import { buildOrbNowBriefing } from "./dashboardViewModel.js";

const source = (value = {}) => ({ available: true, ...value });

test("builds Orb Now only from real structured metrics", () => {
  const result = buildOrbNowBriefing({
    tasks: source({
      overdue: [
        { id: "task-1", title: "Resolver bloqueo", status: "blocked", priority: "high", dueAt: "2026-08-24T12:00:00.000Z" },
        { id: "task-2", title: "Cerrar entrega", status: "pending", priority: "medium", dueAt: "2026-08-25T12:00:00.000Z" },
      ],
      today: [{}, {}],
    }),
    calendar: source({ today: [{}] }),
    discovery: source({ pendingCount: 1 }),
    projects: source({ count: 3 }), clients: source({ count: 2 }),
  });
  assert.equal(result.state, "ready");
  assert.match(result.text, /2 tareas vencidas/);
  assert.match(result.text, /1 evento/);
});

test("handles empty, partial and unavailable dashboard snapshots", () => {
  assert.equal(buildOrbNowBriefing({ tasks: source({ overdueCount: 0, today: [] }), calendar: source({ today: [] }), discovery: source({ pendingCount: 0 }), projects: source({ count: 0 }), clients: source({ count: 0 }) }).state, "empty");
  assert.equal(buildOrbNowBriefing({ tasks: { available: false }, calendar: { available: false }, discovery: { available: false }, projects: { available: false } }).state, "unavailable");
  assert.equal(buildOrbNowBriefing({ tasks: { available: false }, calendar: source({ today: [] }), discovery: source({ pendingCount: 0 }), projects: source({ count: 1 }), clients: source({ count: 0 }) }).state, "ready");
});

test("distinguishes unavailable sources from available sources without activity", () => {
  const unavailable = buildOrbNowBriefing({ tasks: { available: false }, calendar: { available: false }, discovery: { available: false }, score: { available: false }, projects: { available: false }, clients: { available: false } });
  const empty = buildOrbNowBriefing({ tasks: source({ overdue: [], today: [] }), calendar: source({ today: [] }), discovery: source({ pendingCount: 0 }), score: source({ data: null }), projects: source({ count: 0 }), clients: source({ count: 0 }) });
  assert.equal(unavailable.state, "unavailable");
  assert.equal(empty.state, "empty");
});

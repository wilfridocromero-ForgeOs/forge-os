import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyBuild,
  createVersionUpdateController,
  normalizeAttempt,
} from "./versionUpdateCore.js";

const CURRENT = { version: "current-sha", builtAt: 1000 };
const NEXT = { version: "next-sha", built_at: 2000 };

function fixture({ attempt = null, navigate = () => {}, now = 3000 } = {}) {
  let stored = attempt;
  let replaced = null;
  const states = [];
  const controller = createVersionUpdateController({
    currentBuild: CURRENT,
    origin: "https://app.orvesen.com",
    getCurrentUrl: () => "/proyectos/123?tab=work#task",
    readAttempt: () => stored,
    writeAttempt: (value) => { stored = value; },
    clearAttempt: () => { stored = null; },
    navigate,
    replaceRoute: (value) => { replaced = value; },
    now: () => now,
    onState: (state) => states.push(state.status),
  });
  return { controller, getReplaced: () => replaced, getStored: () => stored, states };
}

test("current and stale manifests never become update_available", () => {
  assert.equal(classifyBuild(CURRENT, { version: "current-sha", built_at: 1000 }).status, "current");
  assert.equal(classifyBuild(CURRENT, { version: "old-sha", built_at: 999 }).status, "stale");
  assert.equal(classifyBuild(CURRENT, NEXT).status, "update_available");
});

test("a newer build becomes available and acceptance navigates exactly once", () => {
  const navigations = [];
  const value = fixture({ navigate: (url) => navigations.push(url) });
  value.controller.observeRemote(NEXT);
  assert.equal(value.controller.getState().status, "update_available");
  assert.equal(value.controller.acceptUpdate(), true);
  assert.equal(value.controller.acceptUpdate(), false);
  assert.equal(navigations.length, 1);
  assert.match(navigations[0], /_appv=next-sha/);
  assert.equal(value.controller.getState().status, "activating");
  assert.equal(value.getStored().returnTo, "/proyectos/123?tab=work#task");
});

test("completed bootstrap restores the route without touching auth storage", () => {
  const authValue = { access_token: "preserved" };
  const value = fixture({
    attempt: {
      from: "old-sha",
      target: CURRENT.version,
      targetBuiltAt: CURRENT.builtAt,
      returnTo: "/calendario?view=month",
      attempts: 1,
      attemptedAt: 2500,
      auth: authValue,
    },
  });
  assert.equal(value.controller.completeBootstrap(), true);
  assert.equal(value.getReplaced(), "/calendario?view=month");
  assert.equal(value.getStored(), null);
  assert.deepEqual(authValue, { access_token: "preserved" });
});

test("old persisted attempts are discarded and cannot create a false update", () => {
  assert.equal(normalizeAttempt({ target: "old", attempts: 1, attemptedAt: 1 }, 3000), null);
  const value = fixture({ attempt: { target: "legacy", attempts: 1, attemptedAt: 2500 } });
  assert.equal(value.controller.completeBootstrap(), false);
  assert.equal(value.getStored(), null);
  assert.equal(value.controller.getState().status, "current");
});

test("repeated update signals and navigation failure remain controlled", () => {
  let calls = 0;
  const value = fixture({ navigate: () => { calls += 1; throw new Error("blocked"); } });
  value.controller.observeRemote(NEXT);
  value.controller.observeRemote(NEXT);
  assert.equal(value.controller.acceptUpdate(), false);
  assert.equal(calls, 1);
  assert.equal(value.controller.getState().status, "error");
});

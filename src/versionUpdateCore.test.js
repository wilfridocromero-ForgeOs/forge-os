import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyBuild,
  createLatestRequestObserver,
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

test("canonical comparison prioritizes version identity before timestamps", () => {
  assert.equal(classifyBuild(CURRENT, { version: "current-sha", built_at: 1000 }).status, "current");
  assert.equal(classifyBuild(CURRENT, { version: "current-sha", built_at: 2000 }).status, "current");
  assert.equal(classifyBuild(CURRENT, { version: "old-sha", built_at: 999 }).status, "stale");
  assert.equal(classifyBuild(CURRENT, NEXT).status, "update_available");
  assert.equal(classifyBuild(CURRENT, { version: "", built_at: 2000 }).status, "invalid");
  assert.equal(classifyBuild(CURRENT, { version: "next-sha", built_at: "bad" }).status, "invalid");
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

test("repeated manifests do not republish the same update banner state", () => {
  const value = fixture();
  value.controller.observeRemote(NEXT, { source: "initial" });
  value.controller.observeRemote(NEXT, { source: "poll" });
  assert.deepEqual(value.states, ["update_available"]);
});

test("broadcast identities are compared instead of trusted as generic update signals", () => {
  const value = fixture();
  assert.equal(value.controller.observeRemote({ version: CURRENT.version, built_at: 5000 }, { source: "broadcast" }).status, "current");
  assert.equal(value.controller.getState().status, "current");
  assert.equal(value.controller.observeRemote({ version: "old-sha", built_at: 999 }, { source: "broadcast" }).status, "stale");
  assert.equal(value.controller.getState().status, "current");
  assert.equal(value.controller.observeRemote(NEXT, { source: "broadcast" }).status, "update_available");
  assert.equal(value.controller.getState().status, "update_available");
});

test("stale or invalid observations cannot resurrect or replace an observed newer target", () => {
  const value = fixture();
  value.controller.observeRemote({ version: "latest-sha", built_at: 3000 });
  value.controller.observeRemote({ version: "older-next-sha", built_at: 2000 });
  value.controller.observeRemote({ version: "old-sha", built_at: 999 });
  value.controller.observeRemote({ version: CURRENT.version, built_at: 5000 });
  value.controller.observeRemote({ version: "", built_at: 4000 });
  assert.equal(value.controller.getState().status, "update_available");
  assert.equal(value.controller.getState().target.version, "latest-sha");
  assert.deepEqual(value.states, ["update_available"]);
});

test("out-of-order HTTP responses cannot downgrade the latest observation", () => {
  const value = fixture();
  const decisions = [];
  const requests = createLatestRequestObserver(
    (build, context) => value.controller.observeRemote(build, context),
    (decision) => decisions.push(decision),
  );
  const completeA = requests.begin("poll");
  const completeB = requests.begin("focus");
  completeB(NEXT);
  completeA({ version: "old-sha", built_at: 999 });
  assert.equal(value.controller.getState().target.version, "next-sha");
  assert.equal(decisions[0].reason, "out_of_order_response");
});

test("latest request observer transports sanitized diagnostic context without changing classification", () => {
  const value = fixture();
  let receivedContext = null;
  const requests = createLatestRequestObserver(
    (build, context) => {
      receivedContext = context;
      return value.controller.observeRemote(build, context);
    },
  );
  requests.begin("pageshow", { pageshowPersisted: true })(NEXT, {
    headers: { etag: "manifest-etag" },
  });
  assert.deepEqual(receivedContext, {
    pageshowPersisted: true,
    headers: { etag: "manifest-etag" },
    source: "pageshow",
    request: 1,
  });
  assert.equal(value.controller.getState().status, "update_available");
});

test("a completed update is current even when its manifest timestamp differs", () => {
  const updated = createVersionUpdateController({
    currentBuild: { version: "next-sha", builtAt: 2000 },
    origin: "https://app.orvesen.com",
    getCurrentUrl: () => "/",
    readAttempt: () => null,
    writeAttempt: () => {},
    clearAttempt: () => {},
    navigate: () => {},
    replaceRoute: () => {},
  });
  assert.equal(updated.observeRemote({ version: "next-sha", built_at: 9000 }).status, "current");
  assert.equal(updated.getState().status, "current");
});

test("a stale update attempt from an older build is cleared during bootstrap", () => {
  const value = fixture({
    attempt: {
      from: "older-sha",
      target: "old-sha",
      targetBuiltAt: 999,
      returnTo: "/discovery",
      attempts: 1,
      attemptedAt: 2500,
    },
  });
  assert.equal(value.controller.completeBootstrap(), false);
  assert.equal(value.getStored(), null);
});

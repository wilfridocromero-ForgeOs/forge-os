import assert from "node:assert/strict";
import test from "node:test";
import { calculateAutoScrollVelocity, sameLandingDropTarget } from "./landingAutoScroll.js";

test("autoscroll is progressive at both edges and stops in the safe zone", () => {
  const frame = { top: 100, bottom: 900, edgeSize: 120 };
  assert.equal(calculateAutoScrollVelocity({ pointerY: 500, ...frame }), 0);
  assert.ok(calculateAutoScrollVelocity({ pointerY: 170, ...frame }) < 0);
  assert.ok(calculateAutoScrollVelocity({ pointerY: 105, ...frame }) < calculateAutoScrollVelocity({ pointerY: 170, ...frame }));
  assert.ok(calculateAutoScrollVelocity({ pointerY: 830, ...frame }) > 0);
  assert.ok(calculateAutoScrollVelocity({ pointerY: 895, ...frame }) > calculateAutoScrollVelocity({ pointerY: 830, ...frame }));
});

test("drop target equality avoids React updates for unchanged pointer positions", () => {
  const target = { kind: "block-before", blockId: "block", regionId: "region" };
  assert.equal(sameLandingDropTarget(target, { ...target }), true);
  assert.equal(sameLandingDropTarget(target, { ...target, kind: "block-after" }), false);
  assert.equal(sameLandingDropTarget(target, null), false);
});

import assert from "node:assert/strict";
import test from "node:test";
import { constrainFloatingPanel, getFloatingViewport, intersectFloatingViewport, placeFloatingPanel } from "./floatingPanelPosition.js";

const viewport = { left: 0, top: 0, width: 1000, height: 700 };
const panel = { width: 360, height: 420 };

test("floating panels remain visible at every viewport edge", () => {
  assert.deepEqual(constrainFloatingPanel({ x: -500, y: -300 }, panel, viewport), { x: 12, y: 12 });
  assert.deepEqual(constrainFloatingPanel({ x: 990, y: 690 }, panel, viewport), { x: 628, y: 268 });
  assert.deepEqual(constrainFloatingPanel({ x: 300, y: 120 }, panel, viewport), { x: 300, y: 120 });
});

test("visual viewport offsets and keyboard-reduced height constrain the panel", () => {
  const visual = getFloatingViewport({ offsetLeft: 20, offsetTop: 140, width: 390, height: 360 }, 1200, 800);
  assert.deepEqual(visual, { left: 20, top: 140, width: 390, height: 360 });
  assert.deepEqual(constrainFloatingPanel({ x: 800, y: 700 }, { width: 340, height: 280 }, visual), { x: 58, y: 208 });
});

test("oversized panels pin to the safe visible origin and use internal scroll", () => {
  assert.deepEqual(constrainFloatingPanel({ x: 100, y: 100 }, { width: 600, height: 900 }, { left: 5, top: 10, width: 390, height: 600 }), { x: 17, y: 22 });
});

test("editor containment excludes shell space while retaining visual viewport offsets", () => {
  const visual = { left: 20, top: 40, width: 1000, height: 700 };
  const editor = { left: 240, top: 72, right: 980, bottom: 710 };
  assert.deepEqual(intersectFloatingViewport(visual, editor), { left: 240, top: 72, width: 740, height: 638 });
});

test("anchor-aware placement flips at every edge then clamps inside the editor", () => {
  const bounds = { left: 220, top: 60, width: 760, height: 620 };
  const size = { width: 240, height: 220 };
  assert.deepEqual(placeFloatingPanel({ left: 230, right: 260, top: 100, bottom: 130 }, size, bounds), { x: 268, y: 138 });
  assert.deepEqual(placeFloatingPanel({ left: 940, right: 970, top: 620, bottom: 650 }, size, bounds), { x: 692, y: 392 });
  assert.deepEqual(placeFloatingPanel({ left: -500, right: -470, top: -500, bottom: -470 }, size, bounds), { x: 232, y: 72 });
});

test("keyboard-sized visual viewport reclamps a reopened panel from stale coordinates", () => {
  const visual = getFloatingViewport({ offsetLeft: 0, offsetTop: 280, width: 390, height: 300 }, 1200, 800);
  const bounds = intersectFloatingViewport(visual, { left: 0, top: 100, right: 390, bottom: 800 });
  assert.deepEqual(constrainFloatingPanel({ x: -900, y: 900 }, { width: 350, height: 260 }, bounds), { x: 12, y: 308 });
});

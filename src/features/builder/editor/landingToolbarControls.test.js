import assert from "node:assert/strict";
import test from "node:test";
import { getBlockToolbarControls, toolbarDeleteNeedsConfirmation } from "./landingToolbarControls.js";

test("contextual toolbar declares focused controls per block type", () => {
  assert.deepEqual(getBlockToolbarControls({ type: "spacer" }), ["variant", "move"]);
  assert.deepEqual(getBlockToolbarControls({ type: "form_reference" }), ["form", "fields", "appearance", "design", "layout"]);
  assert.ok(getBlockToolbarControls({ type: "heading" }).includes("typography"));
  assert.ok(getBlockToolbarControls({ type: "site_header" }).includes("navigation"));
});

test("only destructive Header removal requires the explicit content warning", () => {
  assert.equal(toolbarDeleteNeedsConfirmation({ type: "site_header" }), true);
  assert.equal(toolbarDeleteNeedsConfirmation({ type: "text" }), false);
});

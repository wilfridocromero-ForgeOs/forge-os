import assert from "node:assert/strict";
import test from "node:test";
import { APPEARANCE_PRESETS, appearanceData, validateVisualAppearance } from "./visualAppearance.js";

test("visual appearance presets are whitelisted and renderer-ready", () => {
  Object.values(APPEARANCE_PRESETS).forEach((preset) => assert.equal(validateVisualAppearance(preset), true));
  assert.equal(appearanceData(APPEARANCE_PRESETS.glass)["data-visual-surface"], "glass");
});

test("visual appearance rejects CSS and unknown gradient, shadow or glow values", () => {
  assert.equal(validateVisualAppearance({ preset: "clean", css: "position:fixed" }), false);
  assert.equal(validateVisualAppearance({ gradient: { type: "linear", preset: "javascript" } }), false);
  assert.equal(validateVisualAppearance({ shadow: { token: "0 0 99px red" } }), false);
  assert.equal(validateVisualAppearance({ glow: { token: "neon" } }), false);
});

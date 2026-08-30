import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const component = readFileSync(new URL("./OrbSphere.jsx", import.meta.url), "utf8");
const css = readFileSync(new URL("./OrbSphere.css", import.meta.url), "utf8");
const orbCss = readFileSync(new URL("../../app/Orb.css", import.meta.url), "utf8");
const orbGlobal = readFileSync(new URL("./OrbGlobal.jsx", import.meta.url), "utf8");
const orbExperience = readFileSync(new URL("../../app/Orb.jsx", import.meta.url), "utf8");

test("Crystal Orb reuses the official ORVESEN mark and exposes canonical visual states", () => {
  assert.match(component, /\/orvesen-mark\.png/);
  for (const state of ["resting", "listening", "thinking", "executing", "complete"]) assert.match(component, new RegExp(`"${state}"`));
  assert.match(component, /aria-hidden="true"/);
  assert.match(component, /orb-sphere-refraction/);
  assert.match(component, /orb-sphere-caustic/);
});

test("Crystal Orb remains monochrome, theme-aware and reduced-motion safe", () => {
  assert.doesNotMatch(css, /#d4af37|212,\s*175,\s*55/i);
  assert.match(css, /html\[data-theme="light"\]/);
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
  assert.match(css, /--orb-sphere-size/);
});

test("canonical runtime state reaches both the header Orb and launcher", () => {
  assert.match(orbExperience, /onVisualStateChange\?\.\(sending \? "thinking" : actionVisualState\)/);
  assert.match(orbGlobal, /<OrbSphere size=\{44\} state=\{visualState\}/);
  assert.match(orbGlobal, /<OrbSphere size=\{48\} state=\{visualState\}/);
  assert.match(orbGlobal, /visualState === "thinking" \? "Pensando…"/);
});

test("resting, thinking, executing and complete have explicit static state markers", () => {
  for (const state of ["resting", "thinking", "executing", "complete"]) {
    assert.match(css, new RegExp(`\\.orb-sphere\\.is-${state} \\.orb-sphere-`));
  }
  assert.match(css, /prefers-reduced-motion:reduce[^]*is-thinking[^]*is-executing[^]*is-complete/);
});

test("new-conversation composition keeps the larger sphere inside the available chat space", () => {
  assert.match(orbCss, /\.orb-chat\.is-empty\{[^}]*overflow:hidden/);
  assert.match(orbCss, /\.orb-chat\.is-empty \.orb-welcome\{[^}]*flex:1[^}]*overflow-y:auto/);
  assert.match(orbCss, /\.orb-welcome-sphere\{--orb-sphere-size:clamp\(96px,10vw,108px\)!important/);
});

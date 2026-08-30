import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  getScoreAnimationStart,
  getScoreRevealTransition,
  interpolateScoreValue,
  SCORE_REVEAL_DURATION,
} from "./scoreVisualAnimation.js";
import { getScorePoint, getScoreProgress } from "./scoreVisualGeometry.js";

const component = readFileSync(new URL("./IntelligentScoreVisual.jsx", import.meta.url), "utf8");
const css = readFileSync(new URL("./IntelligentScoreVisual.css", import.meta.url), "utf8");
const dashboard = readFileSync(new URL("./CompanyScoreOverview.jsx", import.meta.url), "utf8");
const scorePage = readFileSync(new URL("../../app/Score.jsx", import.meta.url), "utf8");

test("score geometry clamps 0, 1000 and intermediate values", () => {
  assert.equal(getScoreProgress(0, 1000), 0);
  assert.equal(getScoreProgress(768, 1000), 76.8);
  assert.equal(getScoreProgress(1000, 1000), 100);
  assert.equal(getScoreProgress(1200, 1000), 100);
  assert.equal(getScoreProgress(-1, 1000), 0);
  const top = getScorePoint(0);
  assert.ok(Math.abs(top.x - 110) < 0.0001);
  assert.ok(Math.abs(top.y - 18) < 0.0001);
});

test("entry reveal starts at zero and settles on the exact canonical score", () => {
  assert.equal(SCORE_REVEAL_DURATION, 1200);
  assert.equal(getScoreAnimationStart(768, false), 0);
  assert.equal(interpolateScoreValue(0, 1, 0), 0);
  assert.equal(interpolateScoreValue(0, 768, 1), 768);
  assert.equal(interpolateScoreValue(0, 999, 1), 999);
  assert.equal(interpolateScoreValue(0, 1000, 1), 1000);
});

test("mounted score changes continue from the current reading in either direction", () => {
  assert.equal(getScoreAnimationStart(768, true), 768);
  assert.ok(interpolateScoreValue(768, 812, .5) > 768);
  assert.ok(interpolateScoreValue(768, 710, .5) < 768);
  assert.equal(interpolateScoreValue(768, 812, 1), 812);
  assert.equal(interpolateScoreValue(768, 710, 1), 710);
});

test("async canonical Score arrival is the first reveal, not an initialized final state", () => {
  const unavailable = getScoreRevealTransition({
    hasScore: false,
    reduceMotion: false,
    currentScore: 0,
    hasRevealed: false,
    targetScore: 0,
    maxScore: 1000,
  });
  assert.equal(unavailable.mode, "reset");

  const firstRealScore = getScoreRevealTransition({
    hasScore: true,
    reduceMotion: false,
    currentScore: unavailable.fromScore,
    hasRevealed: false,
    targetScore: 768,
    maxScore: 1000,
  });
  assert.deepEqual(firstRealScore, { mode: "animate", fromScore: 0, fromProgress: 0 });
  assert.equal(interpolateScoreValue(firstRealScore.fromScore, 768, 0), 0);
  assert.ok(interpolateScoreValue(firstRealScore.fromScore, 768, .5) > 0);
  assert.equal(interpolateScoreValue(firstRealScore.fromScore, 768, 1), 768);

  const accessible = getScoreRevealTransition({
    hasScore: true,
    reduceMotion: true,
    currentScore: 0,
    hasRevealed: false,
    targetScore: 768,
    maxScore: 1000,
  });
  assert.deepEqual(accessible, { mode: "immediate", fromScore: 768, fromProgress: 76.8 });
});

test("visual exposes score semantics while keeping layers decorative", () => {
  assert.match(component, /role="img"/);
  assert.match(component, /aria-label=\{accessibleLabel\}/);
  assert.match(component, /aria-hidden="true"/);
  assert.match(component, /evaluatedAreas/);
  assert.match(component, /totalAreas/);
});

test("visual supports theme depth, responsive layout and reduced motion", () => {
  assert.match(css, /html\[data-theme="light"\]/);
  assert.match(css, /max-width:479px/);
  assert.match(css, /prefers-reduced-motion:reduce/);
  assert.doesNotMatch(css, /canvas|webgl|three/i);
  assert.match(component, /prefersReducedScoreMotion/);
  assert.match(component, /cancelAnimationFrame/);
});

test("animated progress drives both the radial geometry and endpoint", () => {
  assert.match(component, /"--score-progress": renderedProgress/);
  assert.match(component, /getScorePoint\(renderedProgress\)/);
  assert.match(component, /renderedProgress > 0/);
  assert.match(component, /requestAnimationFrame\(\(\) => \{/);
});

test("Dashboard and ORVESEN Score use the same canonical instrument", () => {
  assert.match(dashboard, /<IntelligentScoreVisual/);
  assert.match(scorePage, /<IntelligentScoreVisual/);
});

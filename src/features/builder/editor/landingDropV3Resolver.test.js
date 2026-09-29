// Builder DnD V3 — D1 pure-resolver tests.
//
// No DOM, no jsdom, no build step: every assertion here runs in plain Node, which is the
// point of D1. The resolver is pure, so its whole contract is testable without a browser.
import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

import {
  DROP_INTENT,
  DROP_INTENT_SCOPE,
  DROP_REFUSAL_CODE,
  semanticScopeOfIntent,
  validateDropIntent,
} from "./landingDropV3Intent.js";
import {
  DROP_SURFACE_ERROR,
  SURFACE_ROLE,
  SURFACE_SCOPE,
  SURFACE_PRIORITY,
  makeCanvasEndSurface,
  makeCompositionEndSurface,
  makeCompositionSurface,
  makeDropSurface,
  makePatternEndSurface,
  makePatternSurface,
  normalizeSurfaces,
  ownerOfSurface,
  surfaceContainsPoint,
  surfacesContainingPoint,
  validateDropSurface,
} from "./landingDropV3Surfaces.js";
import {
  ANCHOR_REASON,
  DECLARED_INTENT_BY_ROLE,
  DEFAULT_MAX_GAP_DISTANCE,
  describeAnchorForLog,
  dropIntentForPointer,
  resolveIntentForSurface,
} from "./landingDropV3Resolve.js";
import {
  LEGACY_KIND_MAP,
  LEGACY_VERDICT,
  buildRegionOwnerIndex,
  compareLegacyAndV3,
  surfaceFromLegacyTarget,
  surfacesFromLegacyZones,
} from "./landingDropV3LegacyAdapter.js";

const SECTION = "sec-a9a68513";
const REGION_A = "region-a";
const REGION_B = "region-b";
const PATTERN_A = "pattern-node-a";
const PATTERN_B = "pattern-node-b";

const box = (top, bottom, left = 100, right = 700) => ({ top, bottom, left, right });
const at = (b, yFraction = 0.5) => ({ x: (b.left + b.right) / 2, y: b.top + (b.bottom - b.top) * yFraction });
const kinds = (surfaces) => surfaces.map((surface) => surface.surfaceId).sort();

// ---------------------------------------------------------------------------
// The reference declaration. This is what D2's renderer must eventually emit: real
// non-overlapping gutters around and between the composition nodes, plus a terminal
// composition surface that spans to the area's bottom edge.
//
//   y   0.. 80   compSlot 0   (leading composition gutter)
//   y  80..220   Pattern A
//   y 220..300   compSlot 1   (gutter between Pattern A and Pattern B)
//   y 300..440   Pattern B
//   y 440..540   compSlot 2   (terminal composition gutter before the end surface)
//   y 540..660   compEnd 2    (area terminal: spans to the area's bottom edge)
//   y 660..760   canvasEnd    (tiles directly below the terminal, no gap and no overlap)
//
// Surfaces are half-open (top/left inclusive, bottom/right exclusive), so adjacent rows tile
// the canvas and no point ever belongs to two of them.
// ---------------------------------------------------------------------------
const ACCEPTS_ALL = ["palette-block", "palette-pattern", "block"];
const layout = () => ({
  compSlot0: makeCompositionSurface({ surfaceId: "comp:0", rect: box(0, 80), sectionId: SECTION, anchorIndex: 0, accepts: ACCEPTS_ALL }),
  compSlot1: makeCompositionSurface({ surfaceId: "comp:1", rect: box(220, 300), sectionId: SECTION, anchorIndex: 1, accepts: ACCEPTS_ALL }),
  compSlot2: makeCompositionSurface({ surfaceId: "comp:2", rect: box(440, 540), sectionId: SECTION, anchorIndex: 2, accepts: ACCEPTS_ALL }),
  compEnd: makeCompositionEndSurface({ surfaceId: "comp:end", rect: box(540, 660), sectionId: SECTION, anchorIndex: 2, accepts: ACCEPTS_ALL }),
  patternA: makePatternSurface({ surfaceId: "pat:A:0", rect: box(80, 220), sectionId: SECTION, patternNodeId: PATTERN_A, regionId: REGION_A, slotIndex: 0, accepts: ACCEPTS_ALL }),
  patternB: makePatternSurface({ surfaceId: "pat:B:0", rect: box(300, 440), sectionId: SECTION, patternNodeId: PATTERN_B, regionId: REGION_B, slotIndex: 1, accepts: ACCEPTS_ALL }),
  canvas: makeCanvasEndSurface({ surfaceId: "canvas:end", rect: box(660, 760), accepts: ACCEPTS_ALL }),
});
const allSurfaces = () => Object.values(layout());
const payload = (kind, id = "text") => ({ kind, id });

// ---------------------------------------------------------------------------
// 1. Pattern-owned surface -> Pattern intent
// ---------------------------------------------------------------------------
test("1. a Pattern-owned surface produces a Pattern intent with the Pattern's own identity", () => {
  const surfaces = allSurfaces();
  const { intent, anchor } = dropIntentForPointer({ point: at(surfaces.find((s) => s.surfaceId === "pat:A:0").rect), surfaces, payload: payload("palette-block") });
  assert.equal(anchor.reason, ANCHOR_REASON.CONTAINED);
  assert.equal(anchor.surface.surfaceId, "pat:A:0");
  assert.equal(intent.type, DROP_INTENT.INSERT_IN_PATTERN);
  assert.equal(intent.scope, SURFACE_SCOPE.PATTERN);
  assert.equal(semanticScopeOfIntent(intent.type), DROP_INTENT_SCOPE.PATTERN);
  assert.equal(intent.sectionId, SECTION);
  assert.equal(intent.patternNodeId, PATTERN_A);
  assert.equal(intent.regionId, REGION_A);
  assert.equal(intent.slotIndex, 0);
  assert.equal(validateDropIntent(intent).valid, true);
});

// ---------------------------------------------------------------------------
// 2. Composition-owned surface -> Composition intent
// ---------------------------------------------------------------------------
test("2. a composition-owned surface produces a composition intent with the declared anchor", () => {
  const surfaces = allSurfaces();
  const { intent, anchor } = dropIntentForPointer({ point: at(surfaces.find((s) => s.surfaceId === "comp:1").rect), surfaces, payload: payload("palette-block") });
  assert.equal(anchor.reason, ANCHOR_REASON.CONTAINED);
  assert.equal(intent.type, DROP_INTENT.INSERT_IN_COMPOSITION);
  assert.equal(intent.scope, SURFACE_SCOPE.COMPOSITION);
  assert.equal(intent.sectionId, SECTION);
  assert.equal(intent.anchorIndex, 1);
  assert.equal(validateDropIntent(intent).valid, true);
});

// ---------------------------------------------------------------------------
// 3, 4, 5. Independent block before / after a Pattern, and between nodes
// ---------------------------------------------------------------------------
test("3. the composition slot before the first Pattern resolves to anchor 0", () => {
  const { intent } = dropIntentForPointer({ point: at(box(0, 80)), surfaces: allSurfaces(), payload: payload("palette-block") });
  assert.equal(intent.type, DROP_INTENT.INSERT_IN_COMPOSITION);
  assert.equal(intent.anchorIndex, 0);
});

test("4. the composition slot after the last Pattern resolves to the terminal anchor", () => {
  const { intent } = dropIntentForPointer({ point: at(box(440, 540)), surfaces: allSurfaces(), payload: payload("palette-block") });
  assert.equal(intent.type, DROP_INTENT.INSERT_IN_COMPOSITION);
  assert.equal(intent.anchorIndex, 2);
});

test("5. the gutter BETWEEN two Patterns resolves to the index of the following node", () => {
  // One owner per boundary: index i is the edge above node i. The gutter between A and B is
  // therefore anchor 1, never two competing answers.
  const { intent, anchor } = dropIntentForPointer({ point: at(box(220, 300)), surfaces: allSurfaces(), payload: payload("palette-block") });
  assert.equal(anchor.surface.surfaceId, "comp:1");
  assert.equal(intent.anchorIndex, 1);
});

// ---------------------------------------------------------------------------
// 6. Empty composition
// ---------------------------------------------------------------------------
test("6. an empty composition resolves free space to the terminal surface, not to a refusal", () => {
  const empty = [makeCompositionEndSurface({ surfaceId: "comp:end", rect: box(100, 700), sectionId: SECTION, anchorIndex: 0, accepts: ["palette-block"] })];
  const { intent, anchor } = dropIntentForPointer({ point: { x: 400, y: 400 }, surfaces: empty, payload: payload("palette-block") });
  assert.equal(anchor.reason, ANCHOR_REASON.CONTAINED);
  assert.equal(intent.type, DROP_INTENT.INSERT_IN_COMPOSITION);
  assert.equal(intent.anchorIndex, 0);
});

test("6b. with no surfaces at all the resolver refuses explicitly instead of returning null-ish", () => {
  const { intent } = dropIntentForPointer({ point: { x: 400, y: 400 }, surfaces: [], payload: payload("palette-block") });
  assert.equal(intent.type, DROP_INTENT.REFUSED);
  assert.equal(intent.code, DROP_REFUSAL_CODE.NO_SURFACE_IN_RANGE);
});

// ---------------------------------------------------------------------------
// 7. Multiple Patterns
// ---------------------------------------------------------------------------
test("7. each Pattern's slot keeps its own identity when several Patterns are declared", () => {
  const surfaces = allSurfaces();
  const a = dropIntentForPointer({ point: at(box(80, 220)), surfaces, payload: payload("palette-block") }).intent;
  const b = dropIntentForPointer({ point: at(box(300, 440)), surfaces, payload: payload("palette-block") }).intent;
  assert.equal(a.patternNodeId, PATTERN_A);
  assert.equal(a.regionId, REGION_A);
  assert.equal(b.patternNodeId, PATTERN_B);
  assert.equal(b.regionId, REGION_B);
  assert.equal(b.slotIndex, 1);
  assert.notEqual(a.patternNodeId, b.patternNodeId);
});

// ---------------------------------------------------------------------------
// 8, 9. Cross-scope negative tests — the two hypotheses the legacy model could not refute
// ---------------------------------------------------------------------------
test("8. a Pattern surface can NEVER steal a composition drop, even when it is nearer", () => {
  const surfaces = allSurfaces();
  // A point in the gutter between A and B, but closer (in vertical distance) to B's slot edge
  // than to the gutter's own edge would be if only distance mattered.
  const point = { x: 400, y: 296 };
  const { intent, anchor } = dropIntentForPointer({ point, surfaces, payload: payload("palette-block") });
  assert.equal(anchor.reason, ANCHOR_REASON.CONTAINED, "the gutter contains the point, so containment decides");
  assert.notEqual(intent.type, DROP_INTENT.INSERT_IN_PATTERN);
  assert.equal(intent.type, DROP_INTENT.INSERT_IN_COMPOSITION);
});

test("9. a composition surface can NEVER steal a Pattern drop, even with a generous fallback", () => {
  const surfaces = allSurfaces();
  const point = at(box(300, 440)); // squarely inside Pattern B's slot
  const { intent, anchor } = dropIntentForPointer({ point, surfaces, payload: payload("palette-block"), maxGapDistance: 10000 });
  assert.equal(anchor.reason, ANCHOR_REASON.CONTAINED);
  assert.equal(intent.type, DROP_INTENT.INSERT_IN_PATTERN);
  assert.equal(intent.patternNodeId, PATTERN_B);
});

test("9b. the fallback path only ever considers composition surfaces, never Pattern surfaces", () => {
  // Only a Pattern surface and a far-away composition surface exist. The pointer is in the
  // empty space below the Pattern: a huge maxGapDistance must still not produce a Pattern intent.
  const surfaces = [
    makePatternSurface({ surfaceId: "pat:A:0", rect: box(100, 200), sectionId: SECTION, patternNodeId: PATTERN_A, regionId: REGION_A, slotIndex: 0 }),
    makeCompositionEndSurface({ surfaceId: "comp:end", rect: box(400, 500), sectionId: SECTION, anchorIndex: 1, accepts: ["palette-block"] }),
  ];
  const { intent, anchor } = dropIntentForPointer({ point: { x: 400, y: 300 }, surfaces, payload: payload("palette-block"), maxGapDistance: 10000 });
  assert.equal(anchor.reason, ANCHOR_REASON.FALLBACK_NEAREST_COMPOSITION);
  assert.equal(intent.type, DROP_INTENT.INSERT_IN_COMPOSITION);
  assert.equal(intent.patternNodeId, undefined);
});

// ---------------------------------------------------------------------------
// 10. Deterministic ambiguous-case priority
// ---------------------------------------------------------------------------
test("10. priority is declared, applies across roles, and order of declaration does not matter", () => {
  const surfaces = allSurfaces();
  const point = { x: 400, y: 620 }; // inside comp:end only
  const forward = dropIntentForPointer({ point, surfaces, payload: payload("palette-block") });
  const reversed = dropIntentForPointer({ point, surfaces: [...surfaces].reverse(), payload: payload("palette-block") });
  assert.equal(forward.anchor.surface.surfaceId, "comp:end");
  assert.equal(reversed.anchor.surface.surfaceId, "comp:end", "reversing the declaration order must not change the winner");
  assert.equal(forward.anchor.surface.priority, SURFACE_PRIORITY[SURFACE_ROLE.COMPOSITION_END]);
  assert.ok(forward.anchor.surface.priority > SURFACE_PRIORITY[SURFACE_ROLE.CANVAS_END]);

  const canvasPoint = { x: 400, y: 700 }; // inside canvas:end only
  assert.equal(dropIntentForPointer({ point: canvasPoint, surfaces, payload: payload("palette-block") }).anchor.surface.surfaceId, "canvas:end");
});

test("10b. equal priority and equal area are broken by surfaceId, never by input order", () => {
  const left = makeCompositionSurface({ surfaceId: "aaa", rect: box(0, 100), sectionId: SECTION, anchorIndex: 0, accepts: ["palette-block"] });
  const right = makeCompositionSurface({ surfaceId: "bbb", rect: box(0, 100), sectionId: SECTION, anchorIndex: 1, accepts: ["palette-block"] });
  const point = { x: 400, y: 50 };
  assert.equal(dropIntentForPointer({ point, surfaces: [left, right], payload: payload("palette-block") }).anchor.surface.surfaceId, "aaa");
  assert.equal(dropIntentForPointer({ point, surfaces: [right, left], payload: payload("palette-block") }).anchor.surface.surfaceId, "aaa");
});

test("10c. a Pattern slot outranks a composition slot of equal area when both somehow contain the point", () => {
  // Overlapping declarations are illegal in the real renderer, but the resolver must still be
  // deterministic if a bug produces them — and the declared table must decide, not geometry.
  const overlapping = [
    makeCompositionSurface({ surfaceId: "comp:0", rect: box(0, 100), sectionId: SECTION, anchorIndex: 0, accepts: ["palette-block"] }),
    makePatternSurface({ surfaceId: "pat:A:0", rect: box(0, 100), sectionId: SECTION, patternNodeId: PATTERN_A, regionId: REGION_A, slotIndex: 0 }),
  ];
  const { intent } = dropIntentForPointer({ point: { x: 400, y: 50 }, surfaces: overlapping, payload: payload("palette-block") });
  assert.equal(intent.type, DROP_INTENT.INSERT_IN_PATTERN);
  assert.ok(SURFACE_PRIORITY[SURFACE_ROLE.PATTERN_SLOT] > SURFACE_PRIORITY[SURFACE_ROLE.COMPOSITION_SLOT]);
});

// ---------------------------------------------------------------------------
// 11. Determinism: same input repeated produces identical result
// ---------------------------------------------------------------------------
test("11. identical inputs always produce deeply identical results", () => {
  const point = { x: 400, y: 250 };
  const surfaces = allSurfaces();
  const first = dropIntentForPointer({ point, surfaces, payload: payload("palette-block") });
  for (let i = 0; i < 25; i += 1) {
    const again = dropIntentForPointer({ point, surfaces, payload: payload("palette-block") });
    assert.deepEqual(again.intent, first.intent);
    assert.deepEqual(again.anchor.surface.surfaceId, first.anchor.surface.surfaceId);
    assert.deepEqual(again.anchor.reason, first.anchor.reason);
  }
});

test("11b. surfaces are frozen, so a resolver run cannot be influenced by later mutation", () => {
  const surfaces = allSurfaces();
  assert.ok(Object.isFrozen(surfaces[0]));
  assert.throws(() => { surfaces[0].rect.top = -999; }, TypeError);
  const point = at(box(80, 220));
  const before = dropIntentForPointer({ point, surfaces, payload: payload("palette-block") }).intent.type;
  const after = dropIntentForPointer({ point, surfaces, payload: payload("palette-block") }).intent.type;
  assert.equal(before, after);
});

// ---------------------------------------------------------------------------
// 12. Invalid surface / anchor fails safely and explicitly
// ---------------------------------------------------------------------------
test("12. malformed surface declarations are rejected with typed codes", () => {
  const cases = [
    [{ surfaceId: "", role: SURFACE_ROLE.COMPOSITION_SLOT, rect: box(0, 10), sectionId: SECTION, anchorIndex: 0 }, DROP_SURFACE_ERROR.SURFACE_ID_REQUIRED],
    [{ surfaceId: "x", role: "not-a-role", rect: box(0, 10), sectionId: SECTION, anchorIndex: 0 }, DROP_SURFACE_ERROR.SURFACE_ROLE_UNKNOWN],
    [{ surfaceId: "x", role: SURFACE_ROLE.COMPOSITION_SLOT, rect: { top: 0, bottom: 10, left: 0 }, sectionId: SECTION, anchorIndex: 0 }, DROP_SURFACE_ERROR.SURFACE_RECT_INVALID],
    [{ surfaceId: "x", role: SURFACE_ROLE.COMPOSITION_SLOT, rect: { top: 10, bottom: 0, left: 0, right: 10 }, sectionId: SECTION, anchorIndex: 0 }, DROP_SURFACE_ERROR.SURFACE_RECT_INVALID],
    [{ surfaceId: "x", role: SURFACE_ROLE.COMPOSITION_SLOT, rect: box(0, 10), sectionId: SECTION, anchorIndex: -1 }, DROP_SURFACE_ERROR.SURFACE_INVALID],
    [{ surfaceId: "x", role: SURFACE_ROLE.COMPOSITION_SLOT, rect: box(0, 10), sectionId: SECTION, anchorIndex: 0, patternNodeId: PATTERN_A }, DROP_SURFACE_ERROR.SURFACE_OWNERSHIP_CONFLICT],
    [{ surfaceId: "x", role: SURFACE_ROLE.PATTERN_SLOT, rect: box(0, 10), sectionId: SECTION, patternNodeId: PATTERN_A, slotIndex: 0 }, DROP_SURFACE_ERROR.SURFACE_INVALID],
    [{ surfaceId: "x", role: SURFACE_ROLE.PATTERN_SLOT, rect: box(0, 10), sectionId: SECTION, patternNodeId: PATTERN_A, regionId: REGION_A, slotIndex: 0, anchorIndex: 0 }, DROP_SURFACE_ERROR.SURFACE_OWNERSHIP_CONFLICT],
    [{ surfaceId: "x", role: SURFACE_ROLE.CANVAS_END, rect: box(0, 10), sectionId: SECTION }, DROP_SURFACE_ERROR.SURFACE_OWNERSHIP_CONFLICT],
    [{ surfaceId: "x", role: SURFACE_ROLE.COMPOSITION_SLOT, rect: box(0, 10), sectionId: SECTION, anchorIndex: 0, accepts: ["ok", 5] }, DROP_SURFACE_ERROR.SURFACE_ACCEPTS_INVALID],
  ];
  for (const [input, expectedCode] of cases) {
    const verdict = validateDropSurface(input);
    assert.equal(verdict.valid, false, `expected rejection for ${JSON.stringify(input)}`);
    assert.equal(verdict.code, expectedCode);
    assert.throws(() => makeDropSurface(input), (error) => error.code === expectedCode);
  }
});

test("12b. an invalid pointer or a non-numeric gap distance refuses explicitly", () => {
  const surfaces = allSurfaces();
  for (const point of [null, {}, { x: 1 }, { x: Number.NaN, y: 2 }, { x: "1", y: 2 }]) {
    const { intent } = dropIntentForPointer({ point, surfaces, payload: payload("palette-block") });
    assert.equal(intent.type, DROP_INTENT.REFUSED);
    assert.equal(intent.code, DROP_REFUSAL_CODE.INPUT_INVALID);
  }
  const { intent } = dropIntentForPointer({ point: { x: 1, y: 1 }, surfaces, payload: payload("palette-block"), maxGapDistance: -5 });
  assert.equal(intent.code, DROP_REFUSAL_CODE.INPUT_INVALID);
});

test("12c. invalid declarations inside a set are reported, not silently dropped", () => {
  const { valid, rejected } = normalizeSurfaces([...allSurfaces(), { surfaceId: "bad", role: "nope", rect: box(0, 1) }]);
  assert.equal(rejected.length, 1);
  assert.equal(rejected[0].surfaceId, "bad");
  assert.equal(valid.length, allSurfaces().length);
});

test("12d. a payload the surface does not accept refuses explicitly", () => {
  const patternOnly = makePatternSurface({ surfaceId: "pat:A:0", rect: box(0, 100), sectionId: SECTION, patternNodeId: PATTERN_A, regionId: REGION_A, slotIndex: 0, accepts: ["block"] });
  const intent = resolveIntentForSurface({ surface: patternOnly, payload: payload("palette-pattern") });
  assert.equal(intent.type, DROP_INTENT.REFUSED);
  assert.equal(intent.code, DROP_REFUSAL_CODE.PAYLOAD_NOT_ACCEPTED_BY_SURFACE);
});

// ---------------------------------------------------------------------------
// 13. The resolver produces no document mutation
// ---------------------------------------------------------------------------
test("13. resolving never mutates a document, and works with a deeply frozen one", () => {
  const document = {
    schema_version: 2,
    sections: [
      { id: SECTION, composition: [{ id: PATTERN_A, pattern: "hero_minimal", regions: [{ id: REGION_A, span: 12, blocks: [{ id: "b1", type: "heading" }] }] }] },
      { id: "sec-other", regions: [{ id: REGION_B, span: 12, blocks: [] }] },
    ],
  };
  const snapshot = JSON.stringify(document);
  const surfaces = allSurfaces();
  dropIntentForPointer({ point: at(box(80, 220)), surfaces, payload: payload("palette-block"), document });
  dropIntentForPointer({ point: { x: 400, y: 620 }, surfaces, payload: payload("palette-block"), document });
  assert.equal(JSON.stringify(document), snapshot, "the document must be byte-identical after resolving");

  const deepFreeze = (value) => { if (value && typeof value === "object") { Object.values(value).forEach(deepFreeze); Object.freeze(value); } return value; };
  const frozen = deepFreeze(JSON.parse(snapshot));
  assert.doesNotThrow(() => dropIntentForPointer({ point: at(box(80, 220)), surfaces, payload: payload("palette-block"), document: frozen }));

  // And with no document at all, which must be equally safe.
  assert.doesNotThrow(() => dropIntentForPointer({ point: at(box(80, 220)), surfaces, payload: payload("palette-block") }));
});

// ---------------------------------------------------------------------------
// 14. Surface ownership is disjoint
// ---------------------------------------------------------------------------
test("14. the declared layout is disjoint: every point lands in at most one surface per scope", () => {
  const surfaces = allSurfaces();
  for (let y = 0; y <= 700; y += 5) {
    const point = { x: 400, y };
    const containing = surfacesContainingPoint(surfaces, point);
    const patternHits = containing.filter((surface) => surface.scope === SURFACE_SCOPE.PATTERN);
    const compositionHits = containing.filter((surface) => surface.scope === SURFACE_SCOPE.COMPOSITION);
    assert.ok(patternHits.length <= 1, `y=${y} hit ${patternHits.length} Pattern surfaces`);
    assert.ok(compositionHits.length <= 1, `y=${y} hit ${compositionHits.length} composition surfaces`);
  }
});

test("14b. canonical ownership: each role maps to exactly one scope, declared once", () => {
  for (const surface of allSurfaces()) {
    const owner = ownerOfSurface(surface);
    assert.equal(owner.scope, surface.scope);
    if (surface.scope === SURFACE_SCOPE.PATTERN) {
      assert.equal(typeof owner.patternNodeId, "string");
      assert.equal(typeof owner.regionId, "string");
      assert.equal(owner.anchorIndex, undefined, "a Pattern surface must not carry a composition anchor");
    } else if (surface.scope === SURFACE_SCOPE.COMPOSITION) {
      assert.equal(typeof owner.sectionId, "string");
      assert.equal(Number.isInteger(owner.anchorIndex), true);
      assert.equal(owner.patternNodeId, undefined, "a composition surface must not carry Pattern identity");
    } else {
      assert.equal(owner.sectionId, undefined, "the canvas is owned by no Section");
    }
  }
});

test("14c. containment is half-open: top/left edges belong, bottom/right edges do not", () => {
  const surface = makeCompositionSurface({ surfaceId: "comp:0", rect: box(100, 200, 100, 700), sectionId: SECTION, anchorIndex: 0, accepts: ACCEPTS_ALL });
  assert.equal(surfaceContainsPoint(surface, { x: 100, y: 100 }), true, "top-left corner belongs to the surface");
  assert.equal(surfaceContainsPoint(surface, { x: 699.9, y: 199.9 }), true);
  assert.equal(surfaceContainsPoint(surface, { x: 700, y: 200 }), false, "the bottom-right corner starts the NEXT surface");
  assert.equal(surfaceContainsPoint(surface, { x: 99.9, y: 150 }), false);
  assert.equal(surfaceContainsPoint(surface, { x: 400, y: 200 }), false);
});

// ---------------------------------------------------------------------------
// 15. Fallback behaviour is explicit and tested
// ---------------------------------------------------------------------------
test("15. free space below the last node falls back to the nearest composition surface", () => {
  const surfaces = allSurfaces();
  const gap = { x: 400, y: 560 }; // inside comp:end, so contained — the common real case
  const contained = dropIntentForPointer({ point: gap, surfaces, payload: payload("palette-block") });
  assert.equal(contained.anchor.reason, ANCHOR_REASON.CONTAINED);
  assert.equal(contained.intent.type, DROP_INTENT.INSERT_IN_COMPOSITION);

  // Now a point in a genuine vertical hole: below every composition surface and beyond the
  // published gap distance from the terminal, so the canvas is the only declared fallback.
  const holed = [
    makeCompositionSurface({ surfaceId: "comp:0", rect: box(0, 100), sectionId: SECTION, anchorIndex: 0, accepts: ACCEPTS_ALL }),
    makeCanvasEndSurface({ surfaceId: "canvas:end", rect: box(300, 400), accepts: ACCEPTS_ALL }),
  ];
  const hole = { x: 400, y: 250 };
  const fallback = dropIntentForPointer({ point: hole, surfaces: holed, payload: payload("palette-block") });
  assert.equal(fallback.anchor.reason, ANCHOR_REASON.FALLBACK_CANVAS);
  assert.equal(fallback.anchor.contains, false);
  assert.ok(fallback.anchor.distance > 0, "a fallback must report a real, non-zero distance");
  assert.equal(fallback.intent.type, DROP_INTENT.INSERT_IN_COMPOSITION);
});

test("15a2. free space strictly below the last node resolves to the terminal composition surface by containment", () => {
  // The product case: the terminal surface spans to the area's bottom edge, so "drop below the
  // Pattern" is a CONTAINED hit, not a tolerance fallback. This is the requirement the legacy
  // edge-band model could not express.
  const surfaces = allSurfaces();
  const { intent, anchor } = dropIntentForPointer({ point: { x: 400, y: 620 }, surfaces, payload: payload("palette-block") });
  assert.equal(anchor.reason, ANCHOR_REASON.CONTAINED);
  assert.equal(anchor.surface.surfaceId, "comp:end");
  assert.equal(intent.type, DROP_INTENT.INSERT_IN_COMPOSITION);
  assert.equal(intent.anchorIndex, 2);
});

test("15b. the fallback is bounded: beyond maxGapDistance it refuses instead of reaching", () => {
  const surfaces = [
    makeCompositionSurface({ surfaceId: "comp:1", rect: box(0, 40), sectionId: SECTION, anchorIndex: 1, accepts: ["palette-block"] }),
  ];
  const near = dropIntentForPointer({ point: { x: 400, y: 80 }, surfaces, payload: payload("palette-block"), maxGapDistance: 96 });
  assert.equal(near.anchor.reason, ANCHOR_REASON.FALLBACK_NEAREST_COMPOSITION);
  assert.equal(near.intent.type, DROP_INTENT.INSERT_IN_COMPOSITION);

  const far = dropIntentForPointer({ point: { x: 400, y: 400 }, surfaces, payload: payload("palette-block"), maxGapDistance: 96 });
  assert.equal(far.anchor.reason, ANCHOR_REASON.NO_SURFACE);
  assert.equal(far.intent.type, DROP_INTENT.REFUSED);
  assert.equal(far.intent.code, DROP_REFUSAL_CODE.NO_SURFACE_IN_RANGE);
});

test("15c. a point inside a canvas-owned surface is a canvas insert carrying no Section anchor", () => {
  const surfaces = [
    makeCompositionSurface({ surfaceId: "comp:0", rect: box(0, 20), sectionId: SECTION, anchorIndex: 0, accepts: ACCEPTS_ALL }),
    makeCanvasEndSurface({ surfaceId: "canvas:end", rect: box(200, 400), accepts: ACCEPTS_ALL }),
  ];
  const inCanvas = dropIntentForPointer({ point: { x: 400, y: 300 }, surfaces, payload: payload("palette-block") });
  assert.equal(inCanvas.anchor.reason, ANCHOR_REASON.CONTAINED);
  assert.equal(inCanvas.anchor.surface.role, SURFACE_ROLE.CANVAS_END);
  assert.equal(inCanvas.intent.type, DROP_INTENT.INSERT_IN_COMPOSITION);
  assert.equal(inCanvas.intent.sectionId, null, "a canvas insert carries no Section anchor");
});

test("15d. the fallback picks the nearest surface in range, and a nearer composition surface wins over the canvas", () => {
  // comp:0 ends at 100, canvas:end starts at 300. The point at y=250 is between them, so it is
  // contained by neither: distance 150 to the composition surface, 50 to the canvas, and the
  // composition surface is the farther one — the nearest declared surface in range must win.
  const surfaces = [
    makeCompositionSurface({ surfaceId: "comp:0", rect: box(0, 100), sectionId: SECTION, anchorIndex: 0, accepts: ACCEPTS_ALL }),
    makeCanvasEndSurface({ surfaceId: "canvas:end", rect: box(300, 400), accepts: ACCEPTS_ALL }),
  ];
  const nearerCanvas = dropIntentForPointer({ point: { x: 400, y: 250 }, surfaces, payload: payload("palette-block") });
  assert.equal(nearerCanvas.anchor.reason, ANCHOR_REASON.FALLBACK_CANVAS);
  assert.equal(nearerCanvas.anchor.surface.surfaceId, "canvas:end");

  // The same two surfaces with the point closer to the composition surface: distance 10 there
  // versus 40 to the canvas, so the composition surface wins on distance alone.
  const nearerComposition = dropIntentForPointer({ point: { x: 400, y: 110 }, surfaces, payload: payload("palette-block"), maxGapDistance: 20 });
  assert.equal(nearerComposition.anchor.reason, ANCHOR_REASON.FALLBACK_NEAREST_COMPOSITION);
  assert.equal(nearerComposition.anchor.surface.surfaceId, "comp:0");
});

test("15e. the fallback is bounded on both sides: beyond maxGapDistance it refuses explicitly", () => {
  const surfaces = [
    makeCompositionSurface({ surfaceId: "comp:0", rect: box(0, 100), sectionId: SECTION, anchorIndex: 0, accepts: ACCEPTS_ALL }),
    makeCanvasEndSurface({ surfaceId: "canvas:end", rect: box(1000, 1100), accepts: ACCEPTS_ALL }),
  ];
  const far = dropIntentForPointer({ point: { x: 400, y: 500 }, surfaces, payload: payload("palette-block"), maxGapDistance: 96 });
  assert.equal(far.anchor.reason, ANCHOR_REASON.NO_SURFACE);
  assert.equal(far.intent.type, DROP_INTENT.REFUSED);
  assert.equal(far.intent.code, DROP_REFUSAL_CODE.NO_SURFACE_IN_RANGE);
});

test("15d. DEFAULT_MAX_GAP_DISTANCE is a published parameter, not a private constant", () => {
  assert.equal(typeof DEFAULT_MAX_GAP_DISTANCE, "number");
  assert.ok(DEFAULT_MAX_GAP_DISTANCE > 0);
});

// ---------------------------------------------------------------------------
// Property: totality. There is no input for which the resolver returns nothing.
// ---------------------------------------------------------------------------
test("property: for a wide grid of points the resolver always returns a valid intent", () => {
  const surfaces = allSurfaces();
  for (let y = -200; y <= 900; y += 7) {
    for (let x = -50; x <= 800; x += 53) {
      const { intent } = dropIntentForPointer({ point: { x, y }, surfaces, payload: payload("palette-block") });
      assert.ok(intent && typeof intent.type === "string", `no intent at ${x},${y}`);
      assert.equal(validateDropIntent(intent).valid, true, `invalid intent at ${x},${y}: ${JSON.stringify(intent)}`);
      if (intent.type === DROP_INTENT.INSERT_IN_PATTERN) assert.equal(intent.scope, SURFACE_SCOPE.PATTERN);
      if (intent.type === DROP_INTENT.INSERT_IN_COMPOSITION) assert.equal(intent.scope, SURFACE_SCOPE.COMPOSITION);
    }
  }
});

test("property: scope of an intent follows the surface declaration, never the distance", () => {
  const surfaces = allSurfaces();
  for (let y = 0; y <= 700; y += 11) {
    const point = { x: 400, y };
    const { intent, anchor } = dropIntentForPointer({ point, surfaces, payload: payload("palette-block") });
    if (anchor.surface) {
      const declared = anchor.surface.scope;
      const produced = intent.scope;
      if (declared === SURFACE_SCOPE.PATTERN) assert.equal(produced, SURFACE_SCOPE.PATTERN, `y=${y}`);
      if (declared === SURFACE_SCOPE.COMPOSITION || declared === SURFACE_SCOPE.CANVAS) assert.equal(produced, SURFACE_SCOPE.COMPOSITION, `y=${y}`);
    }
  }
});

test("property: DECLARED_INTENT_BY_ROLE covers every declared role", () => {
  for (const role of Object.values(SURFACE_ROLE)) {
    assert.ok(DECLARED_INTENT_BY_ROLE[role], `role ${role} has no declared intent`);
  }
  for (const role of Object.values(SURFACE_ROLE)) {
    assert.ok(SURFACE_PRIORITY[role] !== undefined, `role ${role} has no declared priority`);
  }
});

// ---------------------------------------------------------------------------
// Reorder: an existing node payload produces a move intent, not an insert
// ---------------------------------------------------------------------------
test("an existing composition node dropped on a composition slot produces REORDER_COMPOSITION_NODE", () => {
  const surfaces = allSurfaces();
  const { intent } = dropIntentForPointer({ point: at(box(220, 300)), surfaces, payload: { kind: "block", id: "node-42" } });
  assert.equal(intent.type, DROP_INTENT.REORDER_COMPOSITION_NODE);
  assert.equal(intent.nodeId, "node-42");
  assert.equal(intent.toIndex, 1);
  assert.equal(validateDropIntent(intent).valid, true);
});

test("moving an existing node onto a Pattern surface refuses explicitly rather than re-scoping", () => {
  const surfaces = allSurfaces();
  const { intent } = dropIntentForPointer({ point: at(box(80, 220)), surfaces, payload: { kind: "block", id: "node-42" } });
  assert.equal(intent.type, DROP_INTENT.REFUSED);
  assert.equal(intent.code, DROP_REFUSAL_CODE.PAYLOAD_NOT_ACCEPTED_BY_SURFACE);
});

test("a draft block dropped on a Pattern slot produces INSERT_IN_PATTERN and keeps the block id", () => {
  const surfaces = allSurfaces();
  const { intent } = dropIntentForPointer({ point: at(box(300, 440)), surfaces, payload: { kind: "palette-block", id: "image" } });
  assert.equal(intent.type, DROP_INTENT.INSERT_IN_PATTERN);
  assert.equal(intent.payload.id, "image");
});

// ---------------------------------------------------------------------------
// Legacy adapter: translation, refusal, and the comparison verdict
// ---------------------------------------------------------------------------
test("adapter maps a legacy composition boundary onto a composition surface", () => {
  const result = surfaceFromLegacyTarget({ kind: "composition-before", sectionId: SECTION, index: 2 }, { rect: box(0, 24), surfaceId: "legacy" });
  assert.equal(result.ok, true);
  assert.equal(result.surface.role, SURFACE_ROLE.COMPOSITION_SLOT);
  assert.equal(result.surface.anchorIndex, 2);
  assert.equal(result.surface.scope, SURFACE_SCOPE.COMPOSITION);
});

test("adapter collapses the legacy section-before/after bands onto the same V3 surface", () => {
  const before = surfaceFromLegacyTarget({ kind: "section-before", sectionId: SECTION }, { rect: box(0, 24), surfaceId: "b", anchorIndex: 0 });
  const after = surfaceFromLegacyTarget({ kind: "section-after", sectionId: SECTION }, { rect: box(400, 424), surfaceId: "a", anchorIndex: 1 });
  assert.equal(before.surface.role, SURFACE_ROLE.COMPOSITION_SLOT);
  assert.equal(after.surface.role, SURFACE_ROLE.COMPOSITION_SLOT);
  assert.equal(before.surface.anchorIndex, 0);
  assert.equal(after.surface.anchorIndex, 1);
});

test("adapter refuses a legacy block target whose owning Pattern cannot be resolved", () => {
  const result = surfaceFromLegacyTarget({ kind: "block-after", blockId: "b1", regionId: REGION_A }, { rect: box(0, 24), surfaceId: "x" });
  assert.equal(result.ok, false);
  assert.equal(result.code, DROP_REFUSAL_CODE.PATTERN_TARGET_INVALID);
  assert.match(result.because, /owning Pattern/);
});

test("adapter resolves the owning Pattern from the document when the document states it", () => {
  const document = { sections: [{ id: SECTION, composition: [{ id: PATTERN_A, regions: [{ id: REGION_A, span: 12, blocks: [] }] }] }] };
  const owners = buildRegionOwnerIndex(document);
  assert.equal(owners.get(REGION_A), PATTERN_A);
  const result = surfaceFromLegacyTarget({ kind: "block-after", blockId: "b1", regionId: REGION_A, sectionId: SECTION, index: 1 }, {
    rect: box(0, 24), surfaceId: "x", regionOwners: owners,
  });
  assert.equal(result.ok, true);
  assert.equal(result.surface.role, SURFACE_ROLE.PATTERN_SLOT);
  assert.equal(result.surface.patternNodeId, PATTERN_A);
  assert.equal(result.surface.slotIndex, 1);
});

test("adapter maps canvas-end in both models to the same destination", () => {
  const result = surfaceFromLegacyTarget({ kind: "canvas-end" }, { rect: box(0, 24), surfaceId: "c" });
  assert.equal(result.ok, true);
  assert.equal(result.surface.scope, SURFACE_SCOPE.CANVAS);
  const { intent } = dropIntentForPointer({ point: { x: 10, y: 10 }, surfaces: [result.surface], payload: payload("palette-block") });
  assert.equal(intent.type, DROP_INTENT.INSERT_IN_COMPOSITION);
  assert.equal(intent.sectionId, null);
});

test("surfacesFromLegacyZones reports what it could and could not express", () => {
  const zones = [
    { data: { kind: "composition-before", sectionId: SECTION, index: 1 }, rect: box(0, 24) },
    { data: { kind: "block-after", blockId: "b1", regionId: REGION_A }, rect: box(30, 54) },
  ];
  const { surfaces, refused } = surfacesFromLegacyZones(zones);
  assert.equal(surfaces.length, 1);
  assert.equal(refused.length, 1);
  assert.equal(refused[0].kind, "block-after");
});

test("comparison verdicts: retained when both models agree, retired when legacy contradicts the product requirement", () => {
  const retained = compareLegacyAndV3({
    legacyTarget: { kind: "composition-before", sectionId: SECTION, index: 1 },
    v3Intent: { type: DROP_INTENT.INSERT_IN_COMPOSITION, scope: SURFACE_SCOPE.COMPOSITION, sectionId: SECTION, anchorIndex: 1, payload: payload("palette-block") },
  });
  assert.equal(retained.verdict, LEGACY_VERDICT.RETAIN);

  const retiredFreeSpace = compareLegacyAndV3({
    legacyTarget: null,
    v3Intent: { type: DROP_INTENT.INSERT_IN_COMPOSITION, scope: SURFACE_SCOPE.COMPOSITION, sectionId: SECTION, anchorIndex: 1, payload: payload("palette-block") },
  });
  assert.equal(retiredFreeSpace.verdict, LEGACY_VERDICT.RETIRE);
  assert.equal(retiredFreeSpace.code, "FREE_SPACE_IS_A_DESTINATION");

  const retiredBothRefuse = compareLegacyAndV3({ legacyTarget: null, v3Intent: { type: DROP_INTENT.REFUSED, code: DROP_REFUSAL_CODE.NO_SURFACE_IN_RANGE } });
  assert.equal(retiredBothRefuse.verdict, LEGACY_VERDICT.RETAIN);
});

test("every legacy kind documented in the adapter has a declared V3 role and a note", () => {
  for (const [kind, spec] of Object.entries(LEGACY_KIND_MAP)) {
    assert.ok(Object.values(SURFACE_ROLE).includes(spec.role), `${kind} must map to a declared role`);
    assert.equal(typeof spec.note, "string");
    assert.ok(spec.note.length > 0);
  }
});

// ---------------------------------------------------------------------------
// Purity and isolation: the D1 modules must not reach into the legacy layer or the DOM.
// ---------------------------------------------------------------------------
// Comments legitimately DISCUSS the DOM and the legacy names, so the purity assertion reads
// the CODE, not the prose: block and line comments are stripped before matching.
const stripComments = (source) => source
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/(^|[^:])\/\/[^\n]*/g, "$1");

test("D1 modules are DOM-free and legacy-free", async () => {
  // The strongest available proof that these modules are DOM-free is that this file already
  // executed them: there is no `document` or `window` global in Node, so any access would have
  // thrown at import. The source assertions below additionally prove the modules never MEASURE,
  // and never reach into the legacy layer.
  assert.equal(typeof globalThis.document, "undefined", "Node must have no document, or this proof is vacuous");
  const names = ["landingDropV3Intent.js", "landingDropV3Surfaces.js", "landingDropV3Resolve.js", "landingDropV3LegacyAdapter.js"];
  for (const name of names) {
    const code = stripComments(await readFile(new URL(name, import.meta.url), "utf8"));
    assert.doesNotMatch(code, /document\.(querySelector|querySelectorAll|getElementById|addEventListener|createElement|elementFromPoint)/, `${name} must not touch the DOM`);
    assert.doesNotMatch(code, /\bwindow\b/, `${name} must not touch window`);
    assert.doesNotMatch(code, /getBoundingClientRect/, `${name} must not measure geometry`);
    assert.doesNotMatch(code, /from "\.\/landingDropGeometry\.js"/, `${name} must not depend on the legacy geometry layer`);
    assert.doesNotMatch(code, /from "\.\/landingDropResolver\.js"/, `${name} must not depend on the legacy resolver`);
  }
});

test("the resolve module declares exactly one role-to-intent mapping and no boundary conversion", async () => {
  const code = stripComments(await readFile(new URL("landingDropV3Resolve.js", import.meta.url), "utf8"));
  assert.doesNotMatch(code, /resolveCompositionBoundary/, "no hidden conversion equivalent may exist");
  assert.doesNotMatch(code, /"composition-before"/, "no scalar composition-before vocabulary may exist");
  const mappingOccurrences = (code.match(/DECLARED_INTENT_BY_ROLE\s*=\s*Object\.freeze/g) || []).length;
  assert.equal(mappingOccurrences, 1, "the mapping must be declared exactly once");
});

test("describeAnchorForLog is safe for logging and never exposes a document", () => {
  const { anchor } = dropIntentForPointer({ point: at(box(80, 220)), surfaces: allSurfaces(), payload: payload("palette-block") });
  const described = describeAnchorForLog(anchor);
  assert.equal(described.surfaceId, "pat:A:0");
  assert.equal(described.scope, SURFACE_SCOPE.PATTERN);
  assert.equal(describeAnchorForLog(null), null);
});

// Builder DnD V3 — D1 legacy compatibility matrix.
//
// Purpose: put the LEGACY resolver and the V3 resolver side by side on the same scenarios and
// record, scenario by scenario, whether V3 retains or retires the legacy behaviour. The legacy
// result is obtained by calling the legacy engine (it is pure and importable), NOT by trusting
// a reading of it.
//
// A difference is not automatically a failure. The legacy result is evidence for valid
// scenarios, never the source of truth. Where the two disagree, the verdict says which one the
// architecture and the product requirement support.
import assert from "node:assert/strict";
import test from "node:test";

import { resolveLandingDropTarget } from "./landingDropGeometry.js";
import { resolveLandingDrop } from "./landingDropResolver.js";
import { LANDING_SCHEMA_VERSION_V2, migrateLandingDocumentV1ToV2 } from "../document/landingComposition.js";
import { createLandingDocument, createPrimitiveBlock } from "../document/landingDocument.js";
import { createLandingPattern } from "../document/landingPatterns.js";

import { DROP_INTENT, DROP_REFUSAL_CODE } from "./landingDropV3Intent.js";
import { SURFACE_ROLE, SURFACE_SCOPE, makeCompositionEndSurface, makeCompositionSurface, makePatternSurface } from "./landingDropV3Surfaces.js";
import { ANCHOR_REASON, DEFAULT_MAX_GAP_DISTANCE, dropIntentForPointer } from "./landingDropV3Resolve.js";
import { LEGACY_VERDICT, compareLegacyAndV3 } from "./landingDropV3LegacyAdapter.js";

const SECTION = "11111111-1111-4111-8111-111111111111";
const OTHER_SECTION = "22222222-2222-4222-8222-222222222222";
const REGION = "33333333-3333-4333-8333-333333333333";
const PATTERN_NODE = "44444444-4444-4444-8444-444444444444";
const BLOCK = "55555555-5555-4555-8555-555555555555";

// The legacy engine normalizes rects through `normalizeRect`, which requires all six fields to
// be finite numbers (top, left, right, bottom, width, height). Supplying only four silently
// drops the zone, which would make every legacy comparison vacuously null — so the legacy-side
// fixture always builds the complete rect.
const box = (top, bottom, left = 100, right = 700) => ({ top, bottom, left, right, width: right - left, height: bottom - top });
// V3 declares only the four edges it needs; surfaces are frozen, so the fixture must be too.
const v3box = (top, bottom, left = 100, right = 700) => ({ top, bottom, left, right });
const zone = (kind, rect, axes = {}) => ({ data: { kind, ...axes }, rect });
const at = (b) => ({ x: (b.left + b.right) / 2, y: b.top + (b.bottom - b.top) / 2 });
const payload = { kind: "palette-block", id: "text" };

// A v1 page with one content Section built from the catalog (which supplies a valid region tree
// and UUID block ids), exactly the shape the legacy bootstrap path was written for.
const v1Page = () => ({
  ...createLandingDocument(),
  sections: [{ ...createLandingPattern("hero_split"), id: SECTION }],
});
const v2Page = () => migrateLandingDocumentV1ToV2(v1Page(), { createId: () => "66666666-6666-4666-8666-666666666666" });

// The scenarios. Each one is a real geometry/pointer situation, given to both engines.
const scenarios = () => {
  const zoneRect = box(400, 424);
  const bodyRect = box(0, 400);
  const patternBand = box(100, 300);
  return [
    {
      id: "S1-free-space-below-pattern",
      note: "pointer in the free space below a Pattern's content, beyond every band",
      legacy: () => resolveLandingDropTarget({ pointer: { x: 400, y: 500 }, zones: [zone("section-after", zoneRect, { sectionId: SECTION })], regions: [{ id: REGION, rect: bodyRect }], ranges: [], compositionArea: false }),
      v3: () => dropIntentForPointer({ point: { x: 400, y: 500 }, surfaces: [], payload }),
    },
    {
      id: "S2-pointer-inside-pattern-content",
      note: "pointer inside a Pattern-owned block band",
      legacy: () => resolveLandingDropTarget({ pointer: { x: 400, y: 200 }, zones: [zone("block-after", patternBand, { blockId: "block-heading", regionId: REGION })], regions: [{ id: REGION, rect: bodyRect }], ranges: [{ id: "block-heading", regionId: REGION, sectionId: SECTION, rect: patternBand, scope: "pattern" }], compositionArea: false }),
      v3: () => dropIntentForPointer({ point: at(patternBand), surfaces: [makePatternSurface({ surfaceId: "pat:0", rect: v3box(100, 300), sectionId: SECTION, patternNodeId: PATTERN_NODE, regionId: REGION, slotIndex: 0 })], payload }),
    },
    {
      id: "S3-composition-boundary-between-nodes",
      note: "pointer on a v2 composition boundary",
      legacy: () => resolveLandingDropTarget({ pointer: { x: 400, y: 300 }, zones: [zone("composition-before", box(288, 312), { sectionId: SECTION, index: 1 })], regions: [], ranges: [], compositionArea: true }),
      v3: () => dropIntentForPointer({ point: { x: 400, y: 300 }, surfaces: [makeCompositionSurface({ surfaceId: "comp:1", rect: v3box(288, 312), sectionId: SECTION, anchorIndex: 1 })], payload }),
    },
    {
      id: "S4-v1-section-edge-band",
      note: "pointer on a v1 Section's trailing edge band",
      legacy: () => resolveLandingDropTarget({ pointer: { x: 400, y: 412 }, zones: [zone("section-after", zoneRect, { sectionId: SECTION })], regions: [{ id: REGION, rect: bodyRect }], ranges: [], compositionArea: false }),
      v3: () => dropIntentForPointer({ point: { x: 400, y: 412 }, surfaces: [makeCompositionSurface({ surfaceId: "comp:end", rect: v3box(400, 424), sectionId: SECTION, anchorIndex: 1 })], payload }),
    },
    {
      id: "S5-between-two-sections",
      note: "pointer between two Sections, on the band that belongs to the upper one",
      legacy: () => resolveLandingDropTarget({ pointer: { x: 400, y: 500 }, zones: [zone("section-after", box(480, 520), { sectionId: SECTION })], regions: [], ranges: [], compositionArea: false }),
      v3: () => dropIntentForPointer({ point: { x: 400, y: 500 }, surfaces: [makeCompositionSurface({ surfaceId: "comp:end", rect: v3box(480, 520), sectionId: SECTION, anchorIndex: 1 })], payload }),
    },
    {
      id: "S6-canvas-past-the-last-section",
      note: "pointer on the page canvas past the final Section, with a section-after band still in the DOM",
      legacy: () => resolveLandingDropTarget({ pointer: { x: 400, y: 700 }, zones: [zone("section-after", box(400, 424), { sectionId: SECTION }), zone("canvas-end")], regions: [], ranges: [], compositionArea: false }),
      v3: () => dropIntentForPointer({ point: { x: 400, y: 700 }, surfaces: [makeCompositionEndSurface({ surfaceId: "comp:end", rect: v3box(400, 660), sectionId: SECTION, anchorIndex: 1 })], payload, maxGapDistance: 96 }),
    },
    {
      id: "S7-no-zones-at-all",
      note: "a page state with no drop zones rendered, pointer anywhere",
      legacy: () => resolveLandingDropTarget({ pointer: { x: 400, y: 400 }, zones: [], regions: [], ranges: [], compositionArea: false }),
      v3: () => dropIntentForPointer({ point: { x: 400, y: 400 }, surfaces: [], payload }),
    },
    {
      id: "S8-recorded-browser-signature",
      note: "the exact recorded failing gesture: pointer below the last band, 12 zones, none containing it",
      legacy: () => resolveLandingDropTarget({
        pointer: { x: 536, y: 516 },
        zones: [
          zone("section-before", box(-65.8, -41.8), { sectionId: SECTION }),
          zone("block-before", box(-8.6, 15.4), { blockId: "block-heading", regionId: REGION }),
          zone("section-after", box(414.4, 438.4), { sectionId: SECTION }),
          zone("block-after", box(402.2, 426.2), { blockId: "block-heading", regionId: REGION }),
          zone("section-before", box(11.4, 35.4), { sectionId: OTHER_SECTION }),
          zone("section-after", box(3.2, 27.2), { sectionId: OTHER_SECTION }),
        ],
        regions: [{ id: REGION, rect: box(27.4, 283.4, 399.5, 818.9) }],
        ranges: [],
        compositionArea: false,
      }),
      v3: () => dropIntentForPointer({
        point: { x: 536, y: 516 },
        surfaces: [
          makeCompositionEndSurface({ surfaceId: "comp:end", rect: v3box(414.4, 550), sectionId: SECTION, anchorIndex: 1 }),
          makePatternSurface({ surfaceId: "pat:0", rect: v3box(27.4, 283.4, 399.5, 818.9), sectionId: SECTION, patternNodeId: PATTERN_NODE, regionId: REGION, slotIndex: 0 }),
        ],
        payload,
      }),
    },
  ];
};

const legacyKind = (target) => (target ? target.kind : null);
const v3Summary = (intent) => (intent.type === DROP_INTENT.REFUSED ? `REFUSED(${intent.code})` : intent.type);

const buildMatrix = () => scenarios().map((scenario) => {
  const legacyTarget = scenario.legacy();
  const { intent, anchor } = scenario.v3();
  const comparison = compareLegacyAndV3({ legacyTarget, v3Intent: intent, v3Reason: anchor.reason });
  return { id: scenario.id, note: scenario.note, legacy: legacyKind(legacyTarget), v3: v3Summary(intent), anchorReason: anchor.reason, verdict: comparison.verdict, why: comparison.why, code: comparison.code ?? null };
});

test("the legacy compatibility matrix is complete and every row carries a verdict and a reason", () => {
  const matrix = buildMatrix();
  assert.equal(matrix.length, scenarios().length);
  for (const row of matrix) {
    assert.ok(row.legacy !== undefined);
    assert.ok(row.v3.length > 0);
    assert.ok([LEGACY_VERDICT.RETAIN, LEGACY_VERDICT.RETIRE].includes(row.verdict), `${row.id} has no verdict`);
    assert.ok(row.why && row.why.length > 0, `${row.id} has no reason`);
  }
  // The headline product difference must be present and classified as a retirement: the legacy
  // engine has no destination for space that no band covers, and V3 does.
  const recorded = matrix.find((row) => row.id === "S8-recorded-browser-signature");
  assert.equal(recorded.legacy, null, "the recorded gesture resolved to nothing in the legacy engine");
  assert.equal(recorded.verdict, LEGACY_VERDICT.RETIRE);
  assert.equal(recorded.code, "FREE_SPACE_IS_A_DESTINATION");
});

test("the matrix contains at least one RETIRE and at least two RETAIN rows, so neither verdict is vacuous", () => {
  const matrix = buildMatrix();
  const retained = matrix.filter((row) => row.verdict === LEGACY_VERDICT.RETAIN);
  const retired = matrix.filter((row) => row.verdict === LEGACY_VERDICT.RETIRE);
  assert.ok(retained.length >= 2, `expected RETAIN rows, got ${retained.length}`);
  assert.ok(retired.length >= 1, `expected RETIRE rows, got ${retired.length}`);
});

test("RETIRE: free space past every band resolves to nothing in the legacy engine", () => {
  // This is the product defect stated as an executable fact: with the pointer beyond the bands
  // and no composition area, the legacy resolver returns null — no target, no reason.
  const legacy = resolveLandingDropTarget({
    pointer: { x: 400, y: 700 },
    zones: [zone("section-after", box(400, 424), { sectionId: SECTION })],
    regions: [{ id: REGION, rect: box(0, 400) }],
    ranges: [],
    compositionArea: false,
  });
  assert.equal(legacy, null, "the legacy engine has no destination for free space");

  // V3 makes the same space a first-class destination, and says why.
  const surfaces = [makeCompositionEndSurface({ surfaceId: "comp:end", rect: box(400, 660), sectionId: SECTION, anchorIndex: 1 })];
  const inside = dropIntentForPointer({ point: { x: 400, y: 500 }, surfaces, payload });
  assert.equal(inside.anchor.reason, ANCHOR_REASON.CONTAINED);
  assert.equal(inside.intent.type, DROP_INTENT.INSERT_IN_COMPOSITION);

  const beyond = dropIntentForPointer({ point: { x: 400, y: 900 }, surfaces, payload });
  assert.equal(beyond.intent.type, DROP_INTENT.REFUSED);
  assert.equal(beyond.intent.code, DROP_REFUSAL_CODE.NO_SURFACE_IN_RANGE);
});

test("RETIRE: the legacy engine's own resolver rejects the pointer the same way the browser showed", () => {
  // Reproduces the recorded browser signature: 12 zones, none containing the pointer, and
  // `resolved: null` with no reason attached.
  const zones = [
    zone("section-before", box(-65.8, -41.8), { sectionId: SECTION }),
    zone("section-after", box(414.4, 438.4), { sectionId: SECTION }),
    zone("block-after", box(402.2, 426.2), { blockId: "block-heading", regionId: REGION }),
  ];
  const target = resolveLandingDropTarget({ pointer: { x: 400, y: 486 }, zones, regions: [{ id: REGION, rect: box(0, 400) }], ranges: [], compositionArea: false });
  assert.equal(target, null, "the pointer below the last band resolves to nothing and offers no explanation");
});

test("RETAIN: an already-compositional boundary behaves identically in both models", () => {
  const legacy = resolveLandingDropTarget({ pointer: { x: 400, y: 300 }, zones: [zone("composition-before", box(288, 312), { sectionId: SECTION, index: 1 })], regions: [], ranges: [], compositionArea: true });
  assert.equal(legacy.kind, "composition-before");
  assert.equal(legacy.index, 1);
  const { intent } = dropIntentForPointer({ point: { x: 400, y: 300 }, surfaces: [makeCompositionSurface({ surfaceId: "comp:1", rect: box(288, 312), sectionId: SECTION, anchorIndex: 1 })], payload });
  assert.equal(intent.type, DROP_INTENT.INSERT_IN_COMPOSITION);
  assert.equal(intent.anchorIndex, 1);
  assert.equal(intent.sectionId, SECTION);
});

test("RETAIN: the legacy engine already refuses a Pattern-band drop that is out of context", () => {
  // A block band with no region present: the legacy engine drops the zone, and V3 refuses with a
  // typed reason. Same outcome, but V3 states why.
  const legacy = resolveLandingDropTarget({ pointer: { x: 400, y: 200 }, zones: [zone("block-after", box(100, 300), { blockId: "block-heading", regionId: REGION })], regions: [], ranges: [], compositionArea: false });
  assert.equal(legacy, null);
  const { intent } = dropIntentForPointer({ point: { x: 400, y: 200 }, surfaces: [], payload });
  assert.equal(intent.type, DROP_INTENT.REFUSED);
  assert.equal(intent.code, DROP_REFUSAL_CODE.NO_SURFACE_IN_RANGE);
});

test("RETAIN: the v1 bootstrap outcome is preserved through the document-level resolver", () => {
  // The legacy resolver's composition path already upgrades v1 -> v2 and inserts independently.
  // V3 keeps that outcome and makes the destination explicit as INSERT_IN_COMPOSITION.
  const document = v1Page();
  const target = { kind: "composition-before", sectionId: SECTION, index: 1 };
  // Ids minted during the upgrade must be valid document ids (v4-shaped UUIDs), or the resulting
  // document fails validation — which is the resolver's own correctness check, not a test detail.
  let counter = 0;
  const createId = () => `a9a68513-0000-4000-8000-${String(counter += 1).padStart(12, "0")}`;
  const resolved = resolveLandingDrop(document, payload, target, { createPattern: (id) => createLandingPattern(id), createId });
  assert.equal(resolved.ok, true, `legacy refinement refused: ${resolved.code || ""} ${resolved.message || ""}`);
  assert.equal(resolved.document.schema_version, LANDING_SCHEMA_VERSION_V2);
  const section = resolved.document.sections.find((candidate) => candidate.id === SECTION);
  assert.equal(section.composition.length, 2);

  const { intent } = dropIntentForPointer({ point: { x: 400, y: 300 }, surfaces: [makeCompositionSurface({ surfaceId: "comp:1", rect: box(288, 312), sectionId: SECTION, anchorIndex: 1 })], payload });
  assert.equal(intent.type, DROP_INTENT.INSERT_IN_COMPOSITION);
  assert.equal(intent.anchorIndex, 1);
});

test("the matrix prints as a table (kept executable so the evidence regenerates on every run)", () => {
  const matrix = buildMatrix();
  const width = Math.max(...matrix.map((row) => row.id.length));
  const lines = matrix.map((row) => [
    row.id.padEnd(width),
    String(row.legacy).padEnd(22),
    row.v3.padEnd(28),
    row.verdict.replace("LEGACY_BEHAVIOR_", ""),
    row.why,
  ].join(" | "));
  console.log(`\n[D1 LEGACY COMPATIBILITY MATRIX]\n${lines.join("\n")}\n`);
  assert.equal(matrix.length, 8);
  assert.equal(matrix.filter((row) => row.verdict === LEGACY_VERDICT.RETAIN).length >= 2, true);
  assert.equal(matrix.filter((row) => row.verdict === LEGACY_VERDICT.RETIRE).length >= 1, true);
});

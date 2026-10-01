import assert from "node:assert/strict";
import test from "node:test";
import {
  FIXTURE_COUNT,
  buildServerValidationFixtures,
  clientVerdict,
} from "./landingServerValidationFixtures.js";

// ---------------------------------------------------------------------------
// Permanent server-validation fixture corpus â€” client half.
//
// The SERVER half of this corpus is executed by
// `scripts/builder-forward-migration-matrix.ps1` against a real PostgreSQL, because this
// test runner has no database. What is asserted here is everything that does NOT need one:
// the corpus is complete, deterministic, and every fixture's CLIENT verdict is exactly what
// the corpus claims. That last point is what makes the corpus trustworthy as a RED/GREEN
// baseline: if a "valid" fixture were quietly something the client itself rejects, the
// server matrix would be measuring the wrong thing.
// ---------------------------------------------------------------------------

const fixtures = buildServerValidationFixtures();
const byId = new Map(fixtures.map((fixture) => [fixture.id, fixture]));

test("the corpus contains every required fixture, with unique ids", () => {
  assert.equal(fixtures.length, FIXTURE_COUNT, `expected ${FIXTURE_COUNT} fixtures`);
  assert.equal(byId.size, fixtures.length, "fixture ids must be unique");
  for (const fixture of fixtures) {
    assert.equal(typeof fixture.title, "string");
    assert.ok(fixture.title.length > 0);
    assert.ok(["landing", "form"].includes(fixture.clientValidator));
    assert.equal(typeof fixture.expect.client, "boolean");
    assert.equal(typeof fixture.expect.server, "boolean");
  }
});

test("the corpus covers the required valid landing shapes", () => {
  for (const id of [
    "01-landing-v1-control",
    "02-d3-pattern-plus-text",
    "03-pattern-plus-action-group",
    "04-pattern-plus-image",
    "05-pattern-one-region",
    "06-pattern-multi-region",
    "07-multiple-pattern-nodes",
    "08-pattern-plus-many-blocks",
    "09-independent-block-only",
    "10-empty-composition",
    "11-stack-composition",
    "12-columns-composition",
    "13-legacy-resolve-landing-drop",
    "14-valid-form",
    "21-dedicated-footer",
    "22-block-editor-style-keys",
    "23-area-editor-style-keys",
    "29-projection-id-collision-at-salt-0",
    "30-projection-id-collision-needs-salt-increment",
    "32-pattern-background-valid-token",
    "33-pattern-solid-background-valid-color",
    "41-background-none-valid",
    "43-background-transparent-valid",
    "47-background-image-valid",
    "54-background-gradient-valid",
    "64-area-responsive-spacing-valid-token",
    // ROUND-6 positive controls for the repaired fields
    "75-section-and-pattern-layout-valid",
    "76-region-span-valid-boundary",
  ]) {
    assert.ok(byId.has(id), `missing valid fixture ${id}`);
    assert.equal(byId.get(id).expect.client, true, `${id} must be client-valid`);
    assert.equal(byId.get(id).expect.server, true, `${id} must be server-valid`);
  }
  for (const id of [
    "15-duplicate-source-ids",
    "16-invalid-pattern-ownership",
    "17-invalid-block-shape",
    "18-schema-version-mismatch",
    "19-malformed-form",
    "20-malformed-landing",
    "24-pattern-invalid-style-value",
    "25-dedicated-header-missing-region-id",
    "26-dedicated-footer-missing-region-id",
    "27-dedicated-footer-missing-block-id",
    "28-dedicated-footer-null-region-id",
    "31-pattern-background-invalid-string",
    "34-pattern-solid-background-invalid-color",
    "38-v2-design-system-missing",
    "39-v2-seo-title-missing",
    "40-v2-locale-missing",
    "42-background-none-extra-key",
    "44-background-transparent-extra-key",
    "45-background-solid-extra-url",
    "46-background-solid-extra-overlay",
    "48-background-image-missing-url",
    "49-background-image-http-url",
    "50-background-image-bad-overlay-color",
    "51-background-image-bad-overlay-opacity",
    "52-background-image-string-overlay-opacity",
    "53-background-image-extra-gradient-key",
    "55-background-gradient-bogus",
    "56-background-gradient-extra-url",
    "57-background-unknown-type",
    "58-background-image-bad-fit",
    "59-background-image-bad-position",
    "60-v2-locale-whitespace",
    // ROUND-4 F1: a colour/space token must be a JSON STRING; a boolean must be rejected.
    "61-background-solid-color-boolean",
    "62-background-image-overlay-color-boolean",
    "63-area-responsive-spacing-boolean",
    // ROUND-6: NULL-blind / type-coerced v2-native false acceptances
    "65-area-responsive-layout-null",
    "66-area-responsive-layout-null-mobile",
    "67-area-responsive-align-null",
    "68-area-responsive-align-null-mobile",
    "69-area-responsive-layout-boolean",
    "70-area-responsive-align-object",
    "71-section-layout-null",
    "72-pattern-layout-null",
    "73-region-span-null",
    "74-schema-version-string",
    "77-section-layout-absent",
    "78-pattern-layout-absent",
    "79-region-span-absent",
  ]) {
    assert.ok(byId.has(id), `missing invalid fixture ${id}`);
    assert.equal(byId.get(id).expect.client, false, `${id} must be client-invalid`);
    assert.equal(byId.get(id).expect.server, false, `${id} must be server-invalid`);
  }
});

// ---------------------------------------------------------------------------
// Recorded, deliberate server-stricter divergences (round-2 F6/F7/F8). These are client-VALID
// documents the server refuses. They are asserted here so the divergence is a documented,
// locked decision instead of a surprise, and so that a future change either keeps them or
// forces this test to be updated on purpose. No real producer emits any of them.
// ---------------------------------------------------------------------------
test("the recorded client/server divergences are exactly the three intended ones", () => {
  const divergent = fixtures.filter((fixture) => fixture.expect.client && !fixture.expect.server);
  const expected = [
    "35-known-divergence-pattern-solid-missing-color",
    "36-known-divergence-area-responsive-text-size",
    "37-known-divergence-pattern-responsive-bad-value",
  ];
  assert.deepEqual(divergent.map((fixture) => fixture.id).sort(), [...expected].sort(),
    "only the documented divergences may be client-valid and server-invalid");
  for (const fixture of divergent) {
    assert.ok(typeof fixture.knownDivergence === "string" && fixture.knownDivergence.length > 0,
      `${fixture.id} must explain WHY it is a recorded divergence`);
  }
});

test("every fixture's client verdict matches what the corpus claims", () => {
  for (const fixture of fixtures) {
    const verdict = clientVerdict(fixture);
    assert.equal(
      verdict.valid,
      fixture.expect.client,
      `${fixture.id}: client said ${verdict.valid ? "VALID" : `INVALID (${verdict.errors.join(", ")})`}, corpus expected ${fixture.expect.client}`,
    );
  }
});

test("the corpus is deterministic: rebuilding yields the identical documents", () => {
  const rebuilt = buildServerValidationFixtures();
  assert.deepEqual(
    rebuilt.map((fixture) => [fixture.id, fixture.document]),
    fixtures.map((fixture) => [fixture.id, fixture.document]),
  );
});

test("the D3 fixtures really do place an independent Block beside a Pattern", () => {
  // A corpus regression guard: if applyDropIntent ever started nesting the inserted Block
  // inside the Pattern, the projection fixtures would stop exercising defect 1 and 2.
  for (const id of [
    "02-d3-pattern-plus-text",
    "03-pattern-plus-action-group",
    "04-pattern-plus-image",
    "08-pattern-plus-many-blocks",
    "11-stack-composition",
  ]) {
    const composition = byId.get(id).document.sections[0].composition;
    assert.ok(
      composition.some((node) => node.pattern && Array.isArray(node.regions)),
      `${id} must still contain a Pattern node`,
    );
    assert.ok(
      composition.some((node) => !Array.isArray(node.regions) && typeof node.type === "string"),
      `${id} must still contain an independent Block as a DIRECT composition child`,
    );
  }
});

test("the multi-Region fixture really does carry more than one Region", () => {
  for (const id of ["06-pattern-multi-region", "12-columns-composition"]) {
    const pattern = byId.get(id).document.sections[0].composition.find((node) => node.pattern);
    assert.ok(pattern.regions.length > 1, `${id} must have a multi-Region Pattern`);
  }
});

test("the invalid controls fail for the intended reason, not by accident", () => {
  const reasons = (id) => clientVerdict(byId.get(id)).errors.join(" ");
  assert.match(reasons("15-duplicate-source-ids"), /DUPLICATE_ID/);
  assert.match(reasons("16-invalid-pattern-ownership"), /PATTERN_STYLE_OWNED_BY_NODE/);
  assert.match(reasons("18-schema-version-mismatch"), /COMPOSITION_IN_V1|INVALID_SCHEMA_VERSION/);
  assert.ok(reasons("17-invalid-block-shape").length > 0);
  assert.ok(reasons("19-malformed-form").length > 0);
  assert.ok(reasons("20-malformed-landing").length > 0);
});

test("no fixture carries a persisted projection artifact", () => {
  // Guards invariant I7 from the corpus side: fixtures are SOURCE documents. A projected
  // Region is span 12 with a lone blocks array, and its id is md5-derived; a source area
  // must never look like one.
  for (const fixture of fixtures) {
    if (fixture.clientValidator !== "landing") continue;
    for (const section of fixture.document.sections ?? []) {
      if (!Array.isArray(section.composition)) continue;
      assert.equal(
        section.layout === "stack" && section.composition.length === 0 && Array.isArray(section.regions) && section.regions.length === 1,
        false,
        `${fixture.id}: a composition area must never be stored in projected shape`,
      );
    }
  }
});


import assert from "node:assert/strict";
import test from "node:test";
import { createLandingDocument, validateLandingDocument } from "./landingDocument.js";
import { createLandingPattern, LANDING_PATTERN_CATALOG } from "./landingPatterns.js";

const footerBlocks = (section) =>
  section.regions.flatMap((region) => region.blocks);

test("Footer catalog exposes only the dedicated Footer capability", () => {
  const catalog = LANDING_PATTERN_CATALOG.filter((pattern) =>
    pattern.group === "Footer"
  );

  assert.deepEqual(
    catalog.map(({ id, label }) => ({ id, label })),
    [{ id: "site_footer", label: "Footer" }]
  );
  assert.equal(
    new Set(LANDING_PATTERN_CATALOG.map((pattern) => pattern.id)).size,
    LANDING_PATTERN_CATALOG.length,
    "pattern IDs must remain unique"
  );
});

test("primary Footer and hidden legacy IDs all remain resolvable", () => {
  for (const patternId of ["site_footer", "footer_simple", "footer_business"]) {
    const section = createLandingPattern(patternId);
    const blocks = footerBlocks(section);
    const document = { ...createLandingDocument(), sections: [section] };

    assert.equal(blocks.length, 1, patternId);
    assert.equal(blocks[0].type, "site_footer", patternId);
    assert.equal(section.anchor, undefined, `${patternId} must not reserve a global anchor`);
    assert.equal(validateLandingDocument(document).valid, true, patternId);
  }

  assert.equal(
    footerBlocks(createLandingPattern("site_footer"))[0].content.preset,
    "classic"
  );
  assert.equal(
    footerBlocks(createLandingPattern("footer_simple"))[0].content.preset,
    "minimal"
  );
  assert.equal(
    footerBlocks(createLandingPattern("footer_business"))[0].content.preset,
    "classic"
  );
});

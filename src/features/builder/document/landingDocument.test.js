import assert from "node:assert/strict";
import test from "node:test";
import { createLandingDocument, createPrimitiveBlock, validateLandingDocument } from "./landingDocument.js";
import { applyLandingOperation } from "./landingOperations.js";
import { createCtaPattern, createHeroPattern, createLeadCapturePattern } from "./landingPatterns.js";

const ids = ["11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222", "33333333-3333-4333-8333-333333333333"];
const documentWith = (block) => ({ ...createLandingDocument(), sections: [{ id: ids[0], layout: "stack", regions: [{ id: ids[1], span: 12, blocks: [block] }] }] });

test("accepts an empty canonical document", () => assert.equal(validateLandingDocument(createLandingDocument()).valid, true));
test("validates publication metadata without changing schema version", () => {
  const valid = createLandingDocument(); valid.settings.seo = { title: "Landing ORVESEN", description: "Una descripción pública controlada." };
  assert.equal(validateLandingDocument(valid).valid, true);
  for (const seo of [{ title: 42, description: "" }, { title: "x".repeat(121), description: "" }, { title: "", description: "x".repeat(301) }, { title: "", description: "", extra: true }]) {
    const document = createLandingDocument(); document.settings.seo = seo;
    assert.equal(validateLandingDocument(document).valid, false);
  }
});
test("rejects schema, type and unknown root keys", () => {
  for (const patch of [{ schema_version: 2 }, { document_type: "form" }, { surprise: true }]) assert.equal(validateLandingDocument({ ...createLandingDocument(), ...patch }).valid, false);
});
test("rejects duplicate IDs and invalid nesting", () => {
  const block = createPrimitiveBlock("heading", ids[0]);
  assert.equal(validateLandingDocument(documentWith(block)).errors.some((error) => error.code === "DUPLICATE_ID"), true);
  const nested = documentWith(createPrimitiveBlock("text", ids[2])); nested.sections[0].regions[0].blocks[0].sections = [];
  assert.equal(validateLandingDocument(nested).valid, false);
});
test("enforces maximum sections, blocks and serialized size", () => {
  const tooManySections = createLandingDocument(); tooManySections.sections = Array.from({ length: 51 }, (_, index) => ({ id: `${String(index).padStart(8, "0")}-1111-4111-8111-111111111111`, layout: "stack", regions: [] }));
  assert.equal(validateLandingDocument(tooManySections).errors.some((error) => error.code === "MAX_SECTIONS"), true);
  const huge = documentWith(createPrimitiveBlock("text", ids[2], { text: "x".repeat(524288) }));
  assert.equal(validateLandingDocument(huge).errors.some((error) => error.code === "MAX_DOCUMENT_SIZE"), true);
  const manyBlocks = createLandingDocument(); manyBlocks.sections = [{ id: ids[0], layout: "stack", regions: [{ id: ids[1], span: 12, blocks: Array.from({ length: 501 }, (_, index) => createPrimitiveBlock("text", `00000000-0000-4000-8000-${index.toString(16).padStart(12, "0")}`)) }] }];
  assert.equal(validateLandingDocument(manyBlocks).errors.some((error) => error.code === "MAX_BLOCKS"), true);
});
test("validates responsive overrides and tokens", () => {
  const document = documentWith(createPrimitiveBlock("text", ids[2])); document.sections[0].responsive = { desktop: { hidden: true } };
  assert.equal(validateLandingDocument(document).valid, false);
  document.sections[0].responsive = { mobile: { span: 13 } };
  assert.equal(validateLandingDocument(document).valid, false);
  document.sections[0].responsive = undefined; document.sections[0].style = { spacing: "bad token!" };
  assert.equal(validateLandingDocument(document).valid, false);
  const tokenDocument = createLandingDocument(); tokenDocument.settings.design_system.colors.brand = { raw: "#fff" };
  assert.equal(validateLandingDocument(tokenDocument).errors.some((error) => error.code === "INVALID_TOKEN_VALUE"), true);
});
test("image requires safe HTTPS and accessible alternative", () => {
  assert.equal(validateLandingDocument(documentWith(createPrimitiveBlock("image", ids[2], { source: { kind: "external", url: "http://unsafe.test/a.png" }, alt: "A", decorative: false }))).valid, false);
  assert.equal(validateLandingDocument(documentWith(createPrimitiveBlock("image", ids[2], { source: { kind: "external", url: "https://safe.test/a.png" }, alt: "A", decorative: false }))).valid, true);
  assert.equal(validateLandingDocument(documentWith(createPrimitiveBlock("image", ids[2], { source: { kind: "placeholder" }, alt: "", decorative: false }))).valid, false);
});
test("heading semantics and all primitive factories are canonical", () => {
  assert.equal(validateLandingDocument(documentWith(createPrimitiveBlock("heading", ids[2], { text: "Title", level: 7 }))).valid, false);
  for (const type of ["heading", "text", "image", "action_group", "form_reference"]) assert.equal(createPrimitiveBlock(type, ids[2]).type, type);
});
test("patterns expand to primitives and valid structure", () => {
  for (const factory of [createHeroPattern, createCtaPattern, createLeadCapturePattern]) {
    const document = createLandingDocument(); document.sections.push(factory());
    assert.equal(validateLandingDocument(document).valid, true);
    assert.equal(document.sections.some((section) => ["hero", "cta", "lead_capture"].includes(section.type)), false);
  }
});
test("operations are immutable and move blocks without changing identity", () => {
  const input = documentWith(createPrimitiveBlock("text", ids[2]));
  const secondRegion = { id: "44444444-4444-4444-8444-444444444444", span: 6, blocks: [] };
  input.sections[0].layout = "columns"; input.sections[0].regions[0].span = 6; input.sections[0].regions.push(secondRegion);
  const output = applyLandingOperation(input, { type: "move_block", block_id: ids[2], target_region_id: secondRegion.id, index: 0 });
  assert.equal(input.sections[0].regions[0].blocks.length, 1);
  assert.equal(output.sections[0].regions[1].blocks[0].id, ids[2]);
});

test("all canonical operations validate their resulting document", () => {
  const sectionId = ids[0]; const regionId = ids[1]; const blockId = ids[2];
  let document = createLandingDocument();
  document = applyLandingOperation(document, { type: "add_section", section: { id: sectionId, layout: "stack", regions: [{ id: regionId, span: 12, blocks: [] }] } });
  document = applyLandingOperation(document, { type: "add_block", region_id: regionId, block_type: "heading", block_id: blockId, content: { text: "Initial", level: 2 } });
  document = applyLandingOperation(document, { type: "update_block_content", block_id: blockId, changes: { text: "Updated" } });
  document = applyLandingOperation(document, { type: "update_block_style", block_id: blockId, changes: { color: "primary" } });
  document = applyLandingOperation(document, { type: "update_section", section_id: sectionId, changes: { style: { spacing: "large" } } });
  document = applyLandingOperation(document, { type: "update_page_tokens", changes: { colors: { primary: "#ffffff" } } });
  document = applyLandingOperation(document, { type: "remove_block", block_id: blockId });
  document = applyLandingOperation(document, { type: "remove_section", section_id: sectionId });
  assert.equal(validateLandingDocument(document).valid, true);
  assert.throws(() => applyLandingOperation(document, { type: "remove_section", section_id: sectionId }), /BUILDER_SECTION_NOT_FOUND/);
});

test("unknown blocks are rejected before rendering", () => {
  const document = documentWith({ id: ids[2], type: "script", schema_version: 1, content: {} });
  assert.equal(validateLandingDocument(document).errors.some((error) => error.code === "UNKNOWN_BLOCK"), true);
});

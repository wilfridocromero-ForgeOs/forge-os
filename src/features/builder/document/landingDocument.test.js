import assert from "node:assert/strict";
import test from "node:test";
import { createLandingDocument, createPrimitiveBlock, getDefaultBlockSpacing, validateLandingDocument } from "./landingDocument.js";
import { applyLandingOperation, sectionContainsSiteFooter } from "./landingOperations.js";
import { createCtaPattern, createHeroPattern, createLandingPattern, createLeadCapturePattern } from "./landingPatterns.js";

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
test("new standalone primitives receive centralized insertion spacing without rewriting existing blocks", () => {
  assert.deepEqual(getDefaultBlockSpacing("heading"), { padding_bottom: "sm" });
  assert.deepEqual(getDefaultBlockSpacing("text"), { padding_bottom: "md" });
  for (const type of ["image", "action_group", "form_reference"]) {
    assert.deepEqual(getDefaultBlockSpacing(type), { padding_top: "md", padding_bottom: "md" });
  }
  const created = createPrimitiveBlock("text", ids[2]);
  assert.equal(created.style.padding_bottom, "md");
  created.style.padding_bottom = "xl";
  assert.equal(validateLandingDocument(documentWith(created)).valid, true);
  assert.equal(created.style.padding_bottom, "xl");
  const legacy = { id: ids[2], type: "text", schema_version: 1, content: { text: "Legacy" } };
  assert.equal(validateLandingDocument(documentWith(legacy)).valid, true);
  assert.equal("style" in legacy, false);
});
test("Header Nav styling is optional, strict and backward-compatible", () => {
  const legacy = createPrimitiveBlock("site_header", ids[2]);
  assert.equal("nav_style" in legacy.content, false);
  assert.equal("style" in legacy.content.nav_items[0], false);
  assert.equal(validateLandingDocument(documentWith(legacy)).valid, true);

  const longestLegacyBrand = structuredClone(legacy);
  longestLegacyBrand.content.brand_name = "A".repeat(120);
  assert.equal(validateLandingDocument(documentWith(longestLegacyBrand)).valid, true);
  longestLegacyBrand.content.brand_name += "A";
  assert.equal(validateLandingDocument(documentWith(longestLegacyBrand)).valid, false);

  const styled = structuredClone(legacy);
  styled.content.preset = "floating_pill";
  styled.content.nav_style = {
    font_family: "sans",
    font_size: "lg",
    font_weight: "semibold",
    text_color: "text",
    gap: "md",
    padding_x: "sm",
    padding_y: "xs",
    background: "surface",
    border: "subtle",
    border_width: "thin",
    border_color: "muted",
    radius: "pill",
    hover_background: "primary",
    hover_text_color: "light",
    active_background: "dark",
    active_text_color: "light",
    alignment: "center",
  };
  styled.content.nav_items[0].style = { font_weight: "bold", background: "primary" };
  assert.equal(validateLandingDocument(documentWith(styled)).valid, true);

  const invalidGlobalKey = structuredClone(styled);
  invalidGlobalKey.content.nav_style.position = "absolute";
  assert.equal(validateLandingDocument(documentWith(invalidGlobalKey)).valid, false);
  const invalidGlobalToken = structuredClone(styled);
  invalidGlobalToken.content.nav_style.radius = "999px";
  assert.equal(validateLandingDocument(documentWith(invalidGlobalToken)).valid, false);
  const invalidItemKey = structuredClone(styled);
  invalidItemKey.content.nav_items[0].style.transform = "scale(2)";
  assert.equal(validateLandingDocument(documentWith(invalidItemKey)).valid, false);
  const invalidNullToken = structuredClone(styled);
  invalidNullToken.content.nav_style.font_size = null;
  assert.equal(validateLandingDocument(documentWith(invalidNullToken)).valid, false);
  const invalidItemToken = structuredClone(styled);
  invalidItemToken.content.nav_items[0].style.background = "url(https://example.com)";
  assert.equal(validateLandingDocument(documentWith(invalidItemToken)).valid, false);
  const invalidItemGeometry = structuredClone(styled);
  invalidItemGeometry.content.nav_items[0].style.gap = "lg";
  assert.equal(validateLandingDocument(documentWith(invalidItemGeometry)).valid, false);
});
test("site_footer defaults are strict, serializable and backward-compatible", () => {
  const footer = createPrimitiveBlock("site_footer", ids[2]);
  assert.equal(validateLandingDocument(documentWith(footer)).valid, true);
  assert.deepEqual(JSON.parse(JSON.stringify(footer)), footer);
  assert.equal(footer.content.social_enabled, false);
  assert.deepEqual(footer.content.social.links, []);

  for (const mutate of [
    (candidate) => { candidate.content.unknown = true; },
    (candidate) => { candidate.content.preset = "absolute"; },
    (candidate) => { candidate.content.brand.name = ""; candidate.content.brand.logo_url = ""; },
    (candidate) => { candidate.content.brand.logo_url = "https://example.com/logo file.svg"; },
    (candidate) => { candidate.content.link_groups[0].links[0].href = "javascript:alert(1)"; },
    (candidate) => { candidate.content.link_groups[0].links[1].id = candidate.content.link_groups[0].links[0].id; },
    (candidate) => { candidate.content.social.links = [{ provider:"unknown", url:"https://example.com", label:"X", enabled:true }]; },
  ]) {
    const invalid = structuredClone(footer);
    mutate(invalid);
    assert.equal(validateLandingDocument(documentWith(invalid)).valid, false);
  }

  const typed = structuredClone(footer);
  typed.content.link_groups[0].links[0] = {
    id: "servicios",
    label: "Servicios",
    target: { type:"section", anchor:"servicios" },
    enabled: true,
  };
  assert.equal(validateLandingDocument(documentWith(typed)).valid, true);

  const legacyFooter = documentWith(createPrimitiveBlock("social_links", ids[2]));
  assert.equal(validateLandingDocument(legacyFooter).valid, true);
});

test("structural operations keep one dedicated Footer at the absolute end", () => {
  let document = { ...createLandingDocument(), sections:[createHeroPattern()] };
  const footer = createLandingPattern("footer_simple");
  document = applyLandingOperation(document,{type:"add_section",section:footer,index:0});
  assert.equal(document.sections.at(-1).regions[0].blocks[0].type,"site_footer");

  const content = createHeroPattern();
  document = applyLandingOperation(document,{type:"add_section",section:content,index:document.sections.length});
  assert.equal(document.sections.at(-1).id,footer.id);
  assert.equal(document.sections.at(-2).id,content.id);
  assert.throws(()=>applyLandingOperation(document,{type:"add_section",section:createLandingPattern("footer_business")}),/BUILDER_SITE_FOOTER_ALREADY_EXISTS/);
  assert.throws(()=>applyLandingOperation(document,{type:"add_block",region_id:footer.regions[0].id,block_type:"heading",block_id:"77777777-7777-4777-8777-777777777777"}),/BUILDER_SITE_FOOTER_POSITION_LOCKED/);

  const emptySection = {id:"60000000-0000-4000-8000-000000000001",layout:"stack",regions:[{id:"60000000-0000-4000-8000-000000000002",span:12,blocks:[]}]};
  let direct = applyLandingOperation(createLandingDocument(),{type:"add_section",section:emptySection});
  direct = applyLandingOperation(direct,{type:"add_block",region_id:emptySection.regions[0].id,block_type:"site_footer",block_id:"60000000-0000-4000-8000-000000000003"});
  assert.equal(direct.sections.at(-1).regions[0].blocks[0].type,"site_footer");
  const directContent = createHeroPattern();
  direct = applyLandingOperation(direct,{type:"add_section",section:directContent});
  assert.throws(()=>applyLandingOperation(direct,{type:"move_block",block_id:"60000000-0000-4000-8000-000000000003",target_region_id:directContent.regions[0].id}),/BUILDER_SITE_FOOTER_POSITION_LOCKED/);

  const removed = applyLandingOperation(document,{type:"remove_block",block_id:footer.regions[0].blocks[0].id});
  assert.equal(removed.sections.some((section)=>section.id===footer.id),false);
  assert.equal(removed.sections.some((section)=>sectionContainsSiteFooter(section)),false);

  const mixedRegions = structuredClone(footer.regions);
  mixedRegions[0].blocks.push(createPrimitiveBlock("heading","60000000-0000-4000-8000-000000000004"));
  assert.throws(()=>applyLandingOperation(document,{type:"update_section",section_id:footer.id,changes:{regions:mixedRegions}}),/BUILDER_SITE_FOOTER_REQUIRES_DEDICATED_SECTION/);
});

test("legacy generic Footer compositions remain ordinary content", () => {
  const legacy = createHeroPattern();
  legacy.label = "Footer legacy";
  legacy.regions[0].blocks.push(createPrimitiveBlock("social_links","88888888-8888-4888-8888-888888888888"));
  let document = { ...createLandingDocument(), sections:[legacy] };
  const after = createHeroPattern();
  document = applyLandingOperation(document,{type:"add_section",section:after});
  assert.equal(document.sections.at(-1).id,after.id);
  assert.equal(document.sections.filter((section)=>section.regions.some((region)=>region.blocks.some((block)=>block.type==="site_footer"))).length,0);
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

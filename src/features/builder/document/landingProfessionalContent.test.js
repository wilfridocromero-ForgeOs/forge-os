import assert from "node:assert/strict";
import test from "node:test";
import { createLandingDocument, createPrimitiveBlock, LANDING_LIMITS, safeVideoEmbedUrl, validateLandingDocument } from "./landingDocument.js";
import { createLandingPattern, LANDING_PATTERN_CATALOG } from "./landingPatterns.js";
import { applyLandingOperation } from "./landingOperations.js";

const id = () => crypto.randomUUID();
const documentWith = (block) => ({ ...createLandingDocument(), sections: [{ id: id(), layout: "stack", regions: [{ id: id(), span: 12, blocks: [block] }] }] });
const professionalTypes = ["logo", "feature_item", "stat", "testimonial", "video", "pricing_card", "faq_item", "divider", "spacer", "social_links"];

test("all professional primitives have canonical defaults and validate", () => {
  for (const type of professionalTypes) assert.equal(validateLandingDocument(documentWith(createPrimitiveBlock(type, id()))).valid, true, type);
});

test("professional primitives reject malformed content", () => {
  for (const type of professionalTypes) {
    const block = createPrimitiveBlock(type, id());
    block.content = { unsafe: "<script>" };
    assert.equal(validateLandingDocument(documentWith(block)).valid, false, type);
  }
});

test("video parser permits only controlled YouTube and Vimeo HTTPS URLs", () => {
  assert.equal(safeVideoEmbedUrl("https://www.youtube.com/watch?v=abcdefghijk"), "https://www.youtube-nocookie.com/embed/abcdefghijk");
  assert.equal(safeVideoEmbedUrl("https://vimeo.com/123456789"), "https://player.vimeo.com/video/123456789");
  for (const value of ["http://youtube.com/watch?v=abcdefghijk", "https://evil.test/embed/x", "javascript:alert(1)", "https://youtube.com.evil.test/watch?v=abcdefghijk"]) assert.equal(safeVideoEmbedUrl(value), null);
});

test("public links accept only the approved V1 protocols", () => {
  for (const href of ["https://orvesen.com/start", "#contacto", "mailto:hola@orvesen.com", "tel:+591 700-00000"]) {
    const block = createPrimitiveBlock("action_group", id(), { actions: [{ label: "Contactar", href }] });
    assert.equal(validateLandingDocument(documentWith(block)).valid, true, href);
  }
  for (const href of ["javascript:alert(1)", "data:text/html,test", "ftp://orvesen.com", "mailto:test\nBcc:evil@example.com"]) {
    const block = createPrimitiveBlock("action_group", id(), { actions: [{ label: "No permitido", href }] });
    assert.equal(validateLandingDocument(documentWith(block)).valid, false, href);
  }
});

test("every professional pattern expands to valid primitives with unique identities", () => {
  for (const pattern of LANDING_PATTERN_CATALOG) {
    const section = createLandingPattern(pattern.id);
    const document = createLandingDocument(); document.sections.push(section);
    const identifiers = section.regions.flatMap((region) => [region.id, ...region.blocks.map((block) => block.id)]);
    assert.equal(validateLandingDocument(document).valid, true, pattern.id);
    assert.equal(new Set([section.id, ...identifiers]).size, identifiers.length + 1, pattern.id);
  }
});

test("a realistic professional page remains comfortably inside document limits", () => {
  const document = createLandingDocument();
  for (const patternId of ["hero_split", "logo_row", "features_3", "stats_row", "services", "testimonial_single", "video_feature", "pricing_3", "faq_list", "lead_split", "footer_business"]) document.sections.push(createLandingPattern(patternId));
  const bytes = new TextEncoder().encode(JSON.stringify(document)).length;
  assert.equal(validateLandingDocument(document).valid, true);
  assert.ok(bytes < LANDING_LIMITS.bytes * 0.2, `${bytes} bytes`);
});

test("pattern catalog provides a lightweight visual descriptor without changing insertion", () => {
  assert.equal(LANDING_PATTERN_CATALOG.length, 20);
  for (const pattern of LANDING_PATTERN_CATALOG) {
    assert.match(pattern.preview, /^(hero|split|logos|stats|cards|quotes|media|pricing|faq|cta|form|footer)$/);
    assert.equal(validateLandingDocument({ ...createLandingDocument(), sections: [createLandingPattern(pattern.id)] }).valid, true);
  }
});

test("controlled section backgrounds validate and unsafe values are rejected", () => {
  const validBackgrounds = [
    { type: "solid", color: "surface" },
    { type: "image", url: "https://example.com/background.jpg", fit: "cover", position: "center", overlay_color: "text", overlay_opacity: 40 },
    { type: "gradient", gradient: "aurora" },
    { type: "none" },
  ];
  for (const background of validBackgrounds) {
    const document = createLandingDocument(); const candidate = createLandingPattern("hero_minimal"); candidate.style.background = background; document.sections.push(candidate);
    assert.equal(validateLandingDocument(document).valid, true, background.type);
  }
  for (const background of [{ type: "image", url: "javascript:alert(1)" }, { type: "gradient", gradient: "raw-css" }, { type: "image", url: "https://example.com/x", overlay_opacity: 37 }, { type: "none", url: "https://example.com/unused" }]) {
    const document = createLandingDocument(); const candidate = createLandingPattern("hero_minimal"); candidate.style.background = background; document.sections.push(candidate);
    assert.equal(validateLandingDocument(document).valid, false);
  }
});

test("typography inherits, overrides locally and resets by removing differences", () => {
  const document = documentWith(createPrimitiveBlock("heading", id())); const blockId = document.sections[0].regions[0].blocks[0].id;
  const styled = applyLandingOperation(document, { type: "update_block_style", block_id: blockId, changes: { align: "center", text_size: "xl", text_weight: "bold", color: "primary", max_width: "narrow", spacing: "lg" } });
  assert.deepEqual(styled.sections[0].regions[0].blocks[0].style, { align: "center", text_size: "xl", text_weight: "bold", color: "primary", max_width: "narrow", spacing: "lg" });
  const reset = applyLandingOperation(styled, { type: "reset_block_style", block_id: blockId });
  assert.equal("style" in reset.sections[0].regions[0].blocks[0], false);
});

test("responsive overrides keep one tree and reset only their breakpoint", () => {
  const document = documentWith(createPrimitiveBlock("text", id())); const blockId = document.sections[0].regions[0].blocks[0].id;
  const tablet = applyLandingOperation(document, { type: "update_block_responsive", block_id: blockId, breakpoint: "tablet", changes: { align: "center", spacing: "lg" } });
  const mobile = applyLandingOperation(tablet, { type: "update_block_responsive", block_id: blockId, breakpoint: "mobile", changes: { hidden: true } });
  assert.equal(mobile.sections.length, 1); assert.equal(mobile.sections[0].regions[0].blocks.length, 1);
  assert.deepEqual(mobile.sections[0].regions[0].blocks[0].responsive, { tablet: { align: "center", spacing: "lg" }, mobile: { hidden: true } });
  const reset = applyLandingOperation(mobile, { type: "reset_block_responsive", block_id: blockId, breakpoint: "tablet" });
  assert.deepEqual(reset.sections[0].regions[0].blocks[0].responsive, { mobile: { hidden: true } });
});

test("empty heading and text remain valid canonical content", () => {
  for (const type of ["heading", "text"]) {
    const block = createPrimitiveBlock(type, id()); block.content.text = "";
    const document = documentWith(block);
    assert.equal(validateLandingDocument(document).valid, true, type);
    assert.equal(JSON.parse(JSON.stringify(document)).sections[0].regions[0].blocks[0].content.text, "");
  }
});

test("section surface presets inherit, override and reset cleanly", () => {
  const document = createLandingDocument(); const section = createLandingPattern("hero_minimal"); document.sections.push(section);
  const styled = applyLandingOperation(document, { type: "update_section_style", section_id: section.id, changes: { background: { type: "gradient", gradient: "graphite" }, border: "subtle", radius: "lg", shadow: "elevated", padding_top: "xl", padding_bottom: "lg" } });
  assert.equal(validateLandingDocument(styled).valid, true); assert.equal(styled.sections[0].style.shadow, "elevated");
  const reset = applyLandingOperation(styled, { type: "reset_section_style", section_id: section.id });
  assert.equal("style" in reset.sections[0], false);
});

test("action styles are controlled local differences and can reset to page defaults", () => {
  const action = createPrimitiveBlock("action_group", id());
  action.content.actions[0] = { ...action.content.actions[0], variant: "outline", size: "lg", width: "full", radius: "pill", shadow: "medium", border: "standard", background: "surface", text_color: "primary", border_color: "primary" };
  const document = documentWith(action); document.settings.design_system.buttons = { variant: "primary", size: "md", radius: "md", shadow: "subtle" };
  assert.equal(validateLandingDocument(document).valid, true);
  for (const [key, value] of [["variant","neon"],["size","giant"],["shadow","glow"],["background","#raw"]]) { const invalid = structuredClone(document); invalid.sections[0].regions[0].blocks[0].content.actions[0][key] = value; assert.equal(validateLandingDocument(invalid).valid, false, key); }
  const inherited = structuredClone(document); inherited.sections[0].regions[0].blocks[0].content.actions[0] = { label: "Comenzar", href: "#" };
  assert.equal(validateLandingDocument(inherited).valid, true); assert.deepEqual(inherited.settings.design_system.buttons, document.settings.design_system.buttons);
});

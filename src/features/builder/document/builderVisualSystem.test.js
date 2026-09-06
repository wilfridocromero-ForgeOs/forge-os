import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { createLandingDocument, createPrimitiveBlock, validateLandingDocument } from "./landingDocument.js";
import { APPEARANCE_PRESETS } from "./visualAppearance.js";

const uuid = (suffix) => `00000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;

test("complete premium document remains valid and backward compatible", () => {
  const document = createLandingDocument();
  const header = createPrimitiveBlock("site_header", uuid(3));
  header.content.nav_items = [{ id:"contacto", label:"Contacto", enabled:true, target:{type:"section",section_id:uuid(1),anchor:"contacto"} }];
  header.style = { appearance: structuredClone(APPEARANCE_PRESETS.glass) };
  const heading = createPrimitiveBlock("heading", uuid(4));
  heading.style = { line_height:"tight", letter_spacing:"wide", appearance:structuredClone(APPEARANCE_PRESETS.glow) };
  const form = createPrimitiveBlock("form_reference", uuid(5));
  const socials = createPrimitiveBlock("social_links", uuid(6));
  const actions = createPrimitiveBlock("action_group", uuid(7));
  actions.content.actions[0].variant = "gradient";
  document.sections = [{ id:uuid(1), label:"Contacto", anchor:"contacto", layout:"stack", style:{appearance:structuredClone(APPEARANCE_PRESETS.luxury)}, regions:[{id:uuid(2),span:12,blocks:[header,heading,form,socials,actions]}]}];
  assert.deepEqual(validateLandingDocument(document), { valid:true, errors:[] });
  const legacy = createLandingDocument();
  assert.equal(validateLandingDocument(legacy).valid, true);
});

test("pending SQL migration mirrors strict appearance and button contracts", async () => {
  const formSql = await readFile(new URL("../../../../supabase/migrations/20260904110000_builder_form_drafts_v1.sql", import.meta.url), "utf8");
  const landingSql = await readFile(new URL("../../../../supabase/migrations/20260905120000_builder_header_socials_v1.sql", import.meta.url), "utf8");
  for (const token of ["builder_visual_appearance_v1_is_valid","premium_dark","metallic","floating","ambient","texture","appearance"]) assert.match(`${formSql}\n${landingSql}`,new RegExp(token));
  for (const variant of ["gradient","glass","soft","elevated"]) assert.match(landingSql,new RegExp(variant));
  assert.doesNotMatch(`${formSql}\n${landingSql}`,/custom_css|style_css|css_text/);
});

test("floating panels are fixed, session-scoped and become a mobile sheet", async () => {
  const editor = await readFile(new URL("../editor/LandingPageEditor.jsx", import.meta.url), "utf8");
  const css = await readFile(new URL("../editor/BuilderContextToolbarV12.css", import.meta.url), "utf8");
  assert.match(editor,/sessionStorage\.setItem/);
  assert.match(editor,/pointermove/);
  assert.match(editor,/event\.key === "Escape"/);
  assert.match(css,/\.landing-floating-panel\{position:fixed/);
  assert.match(css,/@media\(max-width:720px\).*bottom:0!important/);
  assert.match(css,/\.landing-floating-panel\{[^}]*overflow:hidden!important/);
  assert.match(css,/@media\(max-width:900px\).*\.landing-element-toolbar-v3\{[^}]*overflow-x:auto!important/s);
});

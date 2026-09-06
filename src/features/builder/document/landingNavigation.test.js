import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { createLandingDocument, createPrimitiveBlock, validateLandingDocument } from "./landingDocument.js";

const uuid = (suffix) => `00000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;

test("LandingDocument accepts stable section anchors and typed Header navigation", () => {
  const document = createLandingDocument();
  document.sections = [{ id:uuid(1), label:"Contacto", anchor:"contacto", layout:"stack", regions:[{ id:uuid(2), span:12, blocks:[createPrimitiveBlock("site_header",uuid(3))] }] }];
  const header = document.sections[0].regions[0].blocks[0];
  header.content.nav_items = [
    { id:"contacto", label:"Contacto", enabled:true, target:{type:"section",section_id:uuid(1),anchor:"contacto"} },
    { id:"otra-pagina", label:"Servicios", enabled:true, target:{type:"page",asset_id:uuid(4)} },
    { id:"externo", label:"Blog", enabled:true, target:{type:"url",url:"https://example.com"} },
  ];
  assert.deepEqual(validateLandingDocument(document), { valid:true, errors:[] });
});

test("SQL validator explicitly allowlists navigation targets without arbitrary CSS", async () => {
  const sql = await readFile(new URL("../../../../supabase/migrations/20260905120000_builder_header_socials_v1.sql", import.meta.url), "utf8");
  for (const value of ["section_id","asset_id","email","phone","line_height","letter_spacing"]) assert.match(sql,new RegExp(value));
  assert.doesNotMatch(sql,/style\s*->>\s*'css'|custom_css/);
});

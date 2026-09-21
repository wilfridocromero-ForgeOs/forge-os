import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { createLandingDocument, createPrimitiveBlock, HEADER_NAV_STYLE_OPTIONS, validateLandingDocument } from "./landingDocument.js";
import { applyHeaderLayoutPreset, updateHeaderNavItemStyle, updateHeaderNavStyle } from "../editor/landingHeaderEditing.js";

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
  const baseSql = await readFile(new URL("../../../../supabase/migrations/20260905120000_builder_header_socials_v1.sql", import.meta.url), "utf8");
  const sql = await readFile(new URL("../../../../supabase/migrations/20260909214636_builder_header_composer_nav_styles_v1.sql", import.meta.url), "utf8");
  for (const value of ["section_id","asset_id","email","phone","nav_style","hover_background","active_text_color","alignment"]) assert.match(sql,new RegExp(value));
  assert.match(baseSql, /builder_landing_header_social_block_v1_is_valid/);
  assert.match(sql, /create or replace function private\.builder_landing_header_social_block_v1_is_valid/);
  assert.match(sql, /private\.builder_header_nav_style_v1_is_valid\(item->'style'\)/);
  assert.match(sql, /key = any\(array\['gap','alignment'\]\)/);
  assert.match(sql, /key <> all\(array\['id','label','href','target','enabled','style'\]\)/);
  assert.match(sql, /'classic','boxed','floating_pill','minimal','centered','split','glass','custom'/);
  for (const key of Object.keys(HEADER_NAV_STYLE_OPTIONS)) {
    assert.match(sql, new RegExp(`jsonb_typeof\\(value->'${key}'\\) is distinct from 'string'`));
  }
  assert.doesNotMatch(sql,/style\s*->>\s*'css'|custom_css/);
});

test("Header Composer payload rejected by the previous SQL contract is covered by the incremental validator", async () => {
  const document = createLandingDocument();
  const header = createPrimitiveBlock("site_header", uuid(3));
  header.content = applyHeaderLayoutPreset(header.content, "classic");
  header.content = updateHeaderNavStyle(header.content, {
    font_size: "lg",
    radius: "pill",
  });
  header.content = updateHeaderNavItemStyle(header.content, "nav-contacto", {
    font_weight: "bold",
  });
  document.sections = [{
    id: uuid(1),
    layout: "stack",
    regions: [{ id: uuid(2), span: 12, blocks: [header] }],
  }];

  assert.deepEqual(validateLandingDocument(document), { valid: true, errors: [] });
  assert.equal(header.content.preset, "classic");
  assert.deepEqual(header.content.nav_style, { font_size: "lg", radius: "pill" });
  assert.deepEqual(header.content.nav_items.find((item) => item.id === "nav-contacto").style, { font_weight: "bold" });

  const previousSql = await readFile(new URL("../../../../supabase/migrations/20260905120000_builder_header_socials_v1.sql", import.meta.url), "utf8");
  const incrementalSql = await readFile(new URL("../../../../supabase/migrations/20260909214636_builder_header_composer_nav_styles_v1.sql", import.meta.url), "utf8");
  const previousHeaderValidator = previousSql.slice(
    previousSql.indexOf("create function private.builder_landing_header_social_block_v1_is_valid"),
    previousSql.indexOf("alter function private.builder_landing_header_social_block_v1_is_valid"),
  );
  const incrementalHeaderValidator = incrementalSql.slice(
    incrementalSql.indexOf("create or replace function private.builder_landing_header_social_block_v1_is_valid"),
    incrementalSql.indexOf("alter function private.builder_landing_header_social_block_v1_is_valid"),
  );

  assert.doesNotMatch(previousHeaderValidator, /'classic'/);
  assert.doesNotMatch(previousHeaderValidator, /'nav_style'/);
  assert.match(previousHeaderValidator, /'id','label','href','target','enabled'\]\)/);
  assert.doesNotMatch(previousHeaderValidator, /'id','label','href','target','enabled','style'\]\)/);
  assert.match(incrementalHeaderValidator, /'classic','boxed','floating_pill','minimal','centered','split','glass','custom'/);
  assert.match(incrementalHeaderValidator, /'nav_items','nav_style','cta'/);
  assert.match(incrementalHeaderValidator, /'id','label','href','target','enabled','style'/);
  assert.match(incrementalHeaderValidator, /private\.builder_header_nav_style_v1_is_valid\(item->'style'\)/);
  assert.match(incrementalHeaderValidator, /key <> all\(array\['preset','logo_url','brand_name','logo_size','nav_items','nav_style'/);
});

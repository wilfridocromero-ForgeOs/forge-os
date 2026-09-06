import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { createFormDocument, validateFormDocument } from "./formDocument.js";

const legacy = {
  schema_version:1,
  document_type:"form",
  settings:{ layout:"stack", card_style:"soft", submit_label:"Enviar", success_message:"Gracias." },
  fields:[{ id:"00000000-0000-4000-8000-000000000001", type:"text", label:"Nombre", width:"full", required:false, placeholder:"Tu nombre" }],
};

test("production legacy FormDocument remains valid without appearance", () => {
  assert.equal(validateFormDocument(legacy).valid, true);
});

test("modern FormDocument with appearance remains valid", () => {
  assert.equal(validateFormDocument(createFormDocument()).valid, true);
});

test("legacy and modern FormDocument shapes reject unknown settings", () => {
  assert.equal(validateFormDocument({...legacy,settings:{...legacy.settings,css:"display:none"}}).valid, false);
  const modern=createFormDocument(); modern.settings.unknown_property=true;
  assert.equal(validateFormDocument(modern).valid, false);
});

test("pending SQL validator preserves the exact legacy settings branch", async () => {
  const sql=await readFile(new URL("../../../../supabase/migrations/20260905120000_builder_header_socials_v1.sql",import.meta.url),"utf8");
  assert.match(sql,/rename to builder_form_document_v1_is_valid_before_visual/);
  assert.match(sql,/if private\.builder_form_document_v1_is_valid_before_visual\(candidate\) then return true/);
  assert.match(sql,/array\['submit_label','success_message','layout','style_preset'/);
  assert.match(sql,/drop constraint builder_asset_drafts_publication_metadata_check/);
  assert.match(sql,/document_type' = 'form' and private\.builder_form_document_v1_is_valid\(document\)/);
  assert.doesNotMatch(sql,/custom_css|style_css|css_text/);
});

import assert from "node:assert/strict";
import test from "node:test";
import { readFile, readdir } from "node:fs/promises";
import {
  createLandingDocument,
  createPrimitiveBlock,
  validateLandingDocument,
} from "./landingDocument.js";

const uuid = (suffix) =>
  `00000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;

const readFooterMigration = async () => {
  const migrationsDirectory = new URL(
    "../../../../supabase/migrations/",
    import.meta.url,
  );
  const matches = (await readdir(migrationsDirectory)).filter((name) =>
    name.endsWith("_builder_footer_v1.sql"),
  );
  assert.equal(matches.length, 1, "Footer V1 must have one incremental migration");
  return readFile(new URL(matches[0], migrationsDirectory), "utf8");
};

test("Footer V1 document contract accepts canonical content and rejects unknown keys", () => {
  const document = createLandingDocument();
  const footer = createPrimitiveBlock("site_footer", uuid(3));
  document.sections = [{
    id: uuid(1),
    layout: "stack",
    regions: [{ id: uuid(2), span: 12, blocks: [footer] }],
  }];

  assert.deepEqual(validateLandingDocument(document), { valid: true, errors: [] });

  footer.content.custom_css = "display:none";
  assert.equal(validateLandingDocument(document).valid, false);
});

test("Footer V1 migration extends the validator without replacing legacy contracts", async () => {
  const sql = await readFooterMigration();

  assert.match(
    sql,
    /create or replace function private\.builder_landing_footer_block_v1_is_valid\(block jsonb\)/i,
  );
  assert.match(
    sql,
    /create or replace function private\.builder_landing_document_v1_is_valid\(candidate jsonb\)/i,
  );
  assert.match(sql, /block->>'type'\s*=\s*'site_footer'/i);
  assert.match(sql, /private\.builder_landing_footer_block_v1_is_valid\(block\)/i);
  assert.match(sql, /block->>'type'\s+in\s*\('site_header','social_links'\)/i);
  assert.match(
    sql,
    /private\.builder_landing_document_v1_is_valid_before_header\(normalized\)/i,
  );
  assert.doesNotMatch(
    sql,
    /create or replace function private\.builder_landing_header_social_block_v1_is_valid/i,
  );
  assert.match(sql, /security invoker/i);
  assert.match(
    sql,
    /revoke all on function private\.builder_landing_footer_block_v1_is_valid\(jsonb\) from public, anon, authenticated/i,
  );
});

test("Footer V1 migration remains strict and does not alter data or table constraints", async () => {
  const sql = await readFooterMigration();

  for (const key of [
    "preset",
    "brand",
    "link_groups",
    "social_enabled",
    "social",
    "copyright",
    "legal_links",
    "surface",
    "text_color",
    "border",
    "spacing",
    "gap",
    "alignment",
  ]) {
    assert.match(sql, new RegExp(`'${key}'`));
  }
  for (const preset of ["classic", "centered", "columns", "minimal", "split", "custom"]) {
    assert.match(sql, new RegExp(`'${preset}'`));
  }
  assert.doesNotMatch(sql, /custom_css|style_css|css_text/i);
  assert.doesNotMatch(sql, /\balter\s+table\b|\bdrop\b|\btruncate\b/i);
  assert.doesNotMatch(sql, /\binsert\s+into\b|\bupdate\s+public\b|\bdelete\s+from\b/i);
});

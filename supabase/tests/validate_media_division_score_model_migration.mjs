import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL(
  "../migrations/20260828025626_configure_orvesen_media_division_score_model.sql",
  import.meta.url,
);
const sql = await readFile(migrationUrl, "utf8");

test("Media model migration is scoped to the canonical organization, division and template", () => {
  assert.match(sql, /7070c469-2b6a-427c-bc33-bfec8b493201/);
  assert.match(sql, /ddd1cec5-06b5-4998-ab10-3c6c9cc3a43f/);
  assert.match(sql, /ORVESEN Media/);
  assert.match(sql, /f53b9037-b1a2-4b81-9ab5-115319137332/);
  assert.match(sql, /template\.status = 'published'/);
  assert.match(sql, /published_template_count <> 1/);
});

test("Media follows the canonical single-template Division Score contract", () => {
  assert.match(sql, /'Score de ORVESEN Media'/);
  assert.match(sql, /'draft'/);
  assert.match(sql, /component\.weight = 100/);
  assert.match(sql, /\n\s+100,\n\s+true/);
  assert.match(sql, /stale_after_days/);
  assert.match(sql, /\n\s+90\n/);
  assert.match(sql, /set status = 'published'/);
});

test("migration is idempotent and fails closed on incompatible existing configuration", () => {
  assert.match(sql, /pg_advisory_xact_lock/);
  assert.match(sql, /if published_model_count = 1 then/);
  assert.match(sql, /active_component_count <> 1 or compatible_component_count <> 1/);
  assert.match(sql, /else\n\s+select coalesce\(max\(model\.version\), 0\) \+ 1/);
});

test("migration does not bypass the score chain or synthesize business results", () => {
  assert.doesNotMatch(sql, /finalize_discovery/i);
  assert.doesNotMatch(sql, /discovery_assessments/i);
  assert.doesNotMatch(sql, /score_template_results/i);
  assert.doesNotMatch(sql, /handle_score_template_result_score_chain/i);
  assert.doesNotMatch(sql, /disable\s+trigger/i);
  assert.doesNotMatch(sql, /9112dd39-b632-4803-8def-84f1810dff98/i);
  assert.doesNotMatch(sql, /ORVESEN Studio/i);
});

test("the existing score-chain contract continues to fail closed when a required model is absent", async () => {
  const scoreChain = await readFile(new URL(
    "../migrations/20260821144709_repair_discovery_score_chain_configuration.sql",
    import.meta.url,
  ), "utf8");
  assert.match(scoreChain, /if division_model_id is null then/);
  assert.match(scoreChain, /Published company model division % lacks a Division Score model for template %/);
  assert.match(scoreChain, /raise exception/);
});

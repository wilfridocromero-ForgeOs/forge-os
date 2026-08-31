import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const migration = fs.readFileSync(new URL("../../../supabase/migrations/20260831052721_safe_delete_in_progress_discovery_assessment.sql", import.meta.url), "utf8");
const hardeningMigration = fs.readFileSync(new URL("../../../supabase/migrations/20260831053555_harden_discovery_assessment_delete_rpc.sql", import.meta.url), "utf8");
const service = fs.readFileSync(new URL("./services/discoveryExecutionService.js", import.meta.url), "utf8");
const screen = fs.readFileSync(new URL("../../app/DiscoveryExecution.jsx", import.meta.url), "utf8");

test("delete is a single server-authorized RPC and direct table deletion is closed", () => {
  assert.match(migration, /delete_in_progress_discovery_assessment/);
  assert.match(migration, /security definer/i);
  assert.match(migration, /set search_path = ''/i);
  assert.match(migration, /revoke delete on table public\.discovery_assessments from public, anon, authenticated/i);
  assert.match(migration, /can_manage_organization\(assessment_row\.organization_id\)/);
  assert.match(service, /rpc\("delete_in_progress_discovery_assessment"/);
  assert.match(hardeningMigration, /set schema private/i);
  assert.match(hardeningMigration, /language sql\s+security invoker/i);
  assert.match(hardeningMigration, /revoke all on function public\.delete_in_progress_discovery_assessment\(uuid\)\s+from public, anon/i);
});

test("canonical state, organization and result protections are checked under lock", () => {
  assert.match(migration, /where assessment\.id = target_assessment_id\s+for update/i);
  assert.match(migration, /assessment_row\.organization_id <> active_organization_id/);
  assert.match(migration, /status not in \('draft', 'in_progress'\)/i);
  assert.match(migration, /discovery_category_results/);
  assert.match(migration, /discovery_recommendations/);
  assert.match(migration, /score_template_results/);
});

test("owned children cascade without deleting shared definitions", () => {
  assert.doesNotMatch(migration, /delete from public\.(discovery_templates|discovery_questions|discovery_sections|divisions|organizations|clients|score_templates)/i);
  assert.match(migration, /delete from public\.discovery_assessments/);
});

test("historical template division drift is not part of deletion authorization", () => {
  assert.doesNotMatch(migration, /discovery_templates/);
  assert.doesNotMatch(migration, /division_id\s*=/);
  assert.doesNotMatch(migration, /enforce_discovery_assessment_scope/);
});

test("UI requires confirmation, permits cancellation and removes canonical local state", () => {
  assert.match(screen, /role="alertdialog"/);
  assert.match(screen, /Esta acción no se puede deshacer/);
  assert.match(screen, /Cancelar/);
  assert.match(screen, /assessments:\s*current\.assessments\.filter/);
  assert.match(screen, /navigate\("\/discovery", \{ replace: true \}\)/);
  assert.match(screen, /canManageUsers &&/);
});

test("concurrent finalization is surfaced and canonical state is refreshed", () => {
  assert.match(screen, /DISCOVERY_ASSESSMENT_NOT_DELETABLE/);
  assert.match(screen, /await load\(\)/);
  assert.match(screen, /await hydrate\(\)/);
});

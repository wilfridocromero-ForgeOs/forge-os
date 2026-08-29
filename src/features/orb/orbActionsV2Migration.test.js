import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const sql = readFileSync(new URL("../../../supabase/migrations/20260829042134_orb_actions_v2_task_actions_core.sql", import.meta.url), "utf8");

test("Actions V2 migration extends V1 without create_project", () => {
  assert.match(sql, /'create_project_task',[\s\S]*'update_project_task',[\s\S]*'change_project_task_status'/);
  assert.doesNotMatch(sql, /'create_project'/);
  assert.match(sql, /on conflict \(user_id, user_message_id, action_type, arguments_hash\)/);
  assert.match(sql, /now\(\) \+ interval '15 minutes'/);
});

test("task update is a narrow patch with a reconstructed canonical target", () => {
  for (const field of ["title", "instructions", "assignee_id", "priority", "due_at"]) {
    assert.match(sql, new RegExp(`changes \\? '${field}'`));
  }
  for (const forbidden of ["recurrence_schedule_id =", "work_type =", "project_id = case", "created_by = case", "status = case"]) {
    assert.doesNotMatch(sql, new RegExp(forbidden));
  }
  assert.match(sql, /target_values <> jsonb_build_object/);
  assert.match(sql, /Stored action target is invalid/);
});

test("task actions reject recurrence templates and updates reject materialized occurrences", () => {
  assert.match(sql, /task_row\.is_recurrence_template or task_row\.recurrence_schedule_id is not null/);
  assert.match(sql, /if task_row\.is_recurrence_template then\s+raise exception 'Recurring task templates do not have an operational status'/);
});

test("confirmation locks proposal and task and rejects stale material state", () => {
  assert.match(sql, /where item\.id = target_proposal_id for update/);
  assert.match(sql, /for update of task/);
  assert.match(sql, /task_row\.updated_at is distinct from/);
  assert.match(sql, /STALE_ENTITY_STATE/g);
  assert.match(sql, /task_row\.title is distinct from/);
  assert.match(sql, /task_row\.assigned_to is distinct from/);
  assert.match(sql, /task_row\.priority is distinct from/);
  assert.match(sql, /task_row\.due_at is distinct from/);
});

test("status changes preserve canonical completion and evidence triggers", () => {
  assert.match(sql, /set status = args->>'target_status'/);
  assert.doesNotMatch(sql, /disable trigger|session_replication_role/);
  assert.match(sql, /Required evidence is incomplete/);
  assert.match(sql, /EVIDENCE_REQUIRED/);
  assert.match(sql, /completed.*pending/s);
});

test("privileged functions have empty search path and narrow grants", () => {
  const functions = [
    "private.can_change_project_task_status",
    "public.prepare_orb_update_project_task_proposal",
    "public.prepare_orb_task_status_proposal",
    "public.confirm_orb_action_proposal",
  ];
  for (const name of functions) assert.match(sql, new RegExp(`function ${name.replace(".", "\\.")}`));
  assert.match(sql, /security definer/g);
  assert.match(sql, /set search_path = ''/g);
  assert.match(sql, /revoke all on function public\.prepare_orb_update_project_task_proposal[\s\S]*from public, anon, authenticated/);
  assert.match(sql, /grant execute on function public\.prepare_orb_update_project_task_proposal[\s\S]*to authenticated/);
  assert.doesNotMatch(sql, /service_role/);
});

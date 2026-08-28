import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const sql = readFileSync(resolve(here, "../migrations/20260828032216_orb_actions_v1.sql"), "utf8").toLowerCase();
const canonicalTaskSql = readFileSync(resolve(here, "../migrations/20260820223846_fix_project_task_activity_and_creation.sql"), "utf8").toLowerCase();

for (const fragment of [
  "create table public.orb_action_proposals",
  "create extension if not exists pgcrypto with schema extensions",
  "alter table public.orb_action_proposals enable row level security",
  "unique index orb_action_proposals_turn_idempotency_key",
  "security definer",
  "set search_path = ''",
  "public.current_user_organization_id()",
  "for update",
  "proposal.expires_at <= now()",
  "expected_arguments_hash <> proposal.arguments_hash",
  "public.create_project_task_with_configuration(",
  "grant select on table public.orb_action_proposals to authenticated",
  "revoke all on function public.confirm_orb_action_proposal",
  "grant execute on function public.confirm_orb_action_proposal(uuid,text) to authenticated",
]) assert.ok(sql.includes(fragment), `Missing Actions V1 contract: ${fragment}`);

for (const fragment of [
  "user_message_id uuid not null",
  "on public.orb_action_proposals (user_id, user_message_id, action_type, arguments_hash)",
  "project_row.status not in ('planned','active','blocked')",
  "pm.role in ('owner','member')",
  "proposal.status = 'completed'",
  "return jsonb_build_object('status','completed','proposal_id',proposal.id,'task_id',proposal.result_entity_id)",
]) assert.ok(sql.includes(fragment), `Missing idempotency/authorization invariant: ${fragment}`);

const replayPosition = sql.indexOf("if proposal.status = 'completed'");
const executorPosition = sql.indexOf("from public.create_project_task_with_configuration(");
assert.ok(replayPosition > 0 && executorPosition > replayPosition, "Completed replay must return before executor");

for (const type of [
  "target_project_id uuid", "requested_title text", "requested_description text",
  "requested_assigned_to uuid", "requested_priority text", "requested_work_type text",
  "requested_starts_at timestamptz", "requested_due_at timestamptz",
  "requested_evidence_requirements jsonb", "requested_schedule_active boolean",
  "requested_unit text", "requested_interval integer", "requested_weekday integer",
  "requested_day_of_month integer", "requested_first_run timestamp", "requested_timezone text",
]) assert.ok(canonicalTaskSql.includes(type), `Canonical task RPC signature drift: ${type}`);

assert.equal(/grant\s+(insert|update|delete|all)[^;]*orb_action_proposals\s+to authenticated/.test(sql), false);
assert.equal(/grant\s+(insert|update|delete|all)[^;]*orb_action_proposals\s+to service_role/.test(sql), false);
assert.equal(sql.includes("grant execute on function public.confirm_orb_action_proposal(uuid,text) to anon"), false);
assert.equal(sql.includes("insert into public.project_tasks"), false);
assert.equal(sql.includes("'[]'::jsonb, false"), true);
console.log("Orb Actions V1 SQL security and canonical-task contract validated.");

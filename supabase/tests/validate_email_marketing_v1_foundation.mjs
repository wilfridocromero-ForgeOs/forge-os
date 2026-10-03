// Static contract validation for Email Marketing V1 — Increment 1.
// Run: node supabase/tests/validate_email_marketing_v1_foundation.mjs

import assert from "node:assert/strict";
import test from "node:test";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { INC1, STAGING_HISTORY, emailOrderViolation, isEmailMarketingName, readText } from "./email_marketing_v1_migration_order.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = resolve(here, "../migrations");
const MIGRATION = "20260926160000_email_marketing_v1_foundation.sql";
const raw = readText(resolve(migrationsDir, MIGRATION));
const sql = raw.toLowerCase();
// Comment-free SQL so documentation cannot satisfy or violate a contract.
const code = sql.replace(/--[^\n]*/g, "");

const TABLES = ["email_audit_log", "email_contacts", "email_contact_consents", "email_suppressions"];
const RPCS = [
  "email_create_contact",
  "email_update_contact",
  "email_archive_contact",
  "email_record_consent",
  "email_revoke_consent",
  "email_add_suppression",
  "email_lift_suppression",
];

function functionBlocks() {
  const pattern = /create or replace function ([a-z_]+\.[a-z_]+)\(([\s\S]*?)\)\s*returns([\s\S]*?)\nas \$\$([\s\S]*?)\$\$;/g;
  return [...code.matchAll(pattern)].map((m) => ({ name: m[1], args: m[2], header: m[3], body: m[4] }));
}

test("ordering: Increment 1 follows the shared Email Marketing ordering rules and Codex's latest known migration", () => {
  const version = MIGRATION.split("_")[0];
  // Shared Email Marketing ordering rules (email_marketing_v1_migration_order.mjs):
  // Increment 1 exists once and no other Email migration precedes it. Earlier
  // baseline/Builder/Codex migrations and any later migration are legitimate.
  assert.equal(emailOrderViolation(readdirSync(migrationsDir), [INC1]), null);
  const stagingBefore = STAGING_HISTORY.rows.filter((r) => r.version < version);
  assert.ok(stagingBefore.length > 0 && stagingBefore.every((r) => !isEmailMarketingName(r.name)),
    "on Staging, every migration recorded before Increment 1 is non-email");
  assert.ok(version > "20260924145451", "must sort after codex/orb-goal-engine migrations");
});

test("scope: no dependency on shared or other-agent objects", () => {
  for (const forbidden of [
    "is_platform_owner", "member_module_access", "has_active_module_access", "handle_new_user",
    "orb_action_proposals", "goal_engine", "public.clients", "public.users", "builder_",
    "can_manage_organization", "pg_net", "net.http", "cron.schedule", "vault.",
  ]) {
    assert.ok(!code.includes(forbidden), `must not reference ${forbidden}`);
  }
  const alteredTables = [...code.matchAll(/alter table ([a-z_.]+)/g)].map((m) => m[1]);
  for (const table of alteredTables) assert.ok(table.startsWith("public.email_"), `alters non-email table ${table}`);
  const createdTables = [...code.matchAll(/create table ([a-z_.]+)/g)].map((m) => m[1]).sort();
  assert.deepEqual(createdTables, TABLES.map((t) => `public.${t}`).sort());
});

test("no provider integration, secrets or sending", () => {
  for (const forbidden of ["api_key", "apikey", "password", "secret", "smtp", "resend", "brevo", "sendgrid", "mailgun", "http://", "https://"]) {
    assert.ok(!code.includes(forbidden), `unexpected ${forbidden}`);
  }
});

test("every table has RLS enabled, tenant ownership and select-only policies", () => {
  for (const table of TABLES) {
    assert.ok(code.includes(`alter table public.${table} enable row level security`), `${table} RLS`);
    assert.ok(code.includes(`create policy ${table}_select on public.${table}\nfor select to authenticated`), `${table} select policy`);
  }
  assert.equal((code.match(/create policy/g) || []).length, TABLES.length, "only the four SELECT policies");
  const policyBodies = [...code.matchAll(/create policy [\s\S]*?\);/g)].map((m) => m[0]);
  for (const body of policyBodies) {
    assert.ok(!/\nfor (insert|update|delete|all)\b/.test(body), `write policy: ${body}`);
    assert.ok(body.includes("organization_id = (select public.current_user_organization_id())"), body);
    assert.ok(body.includes("(select private.email_can('read'))"), body);
  }
  for (const table of ["email_contact_consents", "email_suppressions"]) {
    assert.ok(code.includes(`references public.email_contacts (organization_id, id) on delete restrict`), table);
  }
  assert.ok(code.includes("unique (organization_id, email_normalized)"));
  assert.ok(code.includes("create unique index email_suppressions_active_address_key"));
});

test("grants: API roles get SELECT only; no anon access; DML revoked", () => {
  assert.ok(code.includes(`revoke all on table public.email_audit_log, public.email_contacts,\n  public.email_contact_consents, public.email_suppressions\n  from public, anon, authenticated, service_role;`));
  assert.ok(code.includes(`grant select on table public.email_audit_log, public.email_contacts,\n  public.email_contact_consents, public.email_suppressions\n  to authenticated, service_role;`));
  assert.ok(!/grant (insert|update|delete|truncate|all)[^;]*on (table )?public\.email_/.test(code));
  assert.ok(!/grant [^;]* to [^;]*\banon\b/.test(code), "nothing granted to anon");
});

test("functions: SECURITY DEFINER pinned search_path, ownership and explicit revokes", () => {
  const blocks = functionBlocks();
  const names = blocks.map((b) => b.name);
  for (const rpc of RPCS) assert.ok(names.includes(`public.${rpc}`), `missing RPC ${rpc}`);
  for (const helper of ["private.email_can", "private.email_normalize_address", "private.email_is_sendable", "private.email_require", "private.email_write_audit"]) {
    assert.ok(names.includes(helper), `missing helper ${helper}`);
  }
  for (const block of blocks) {
    assert.ok(block.header.includes("set search_path = ''"), `${block.name} must pin search_path`);
    const signature = block.name.replace(".", "\\.");
    assert.ok(new RegExp(`alter function ${signature}\\([^)]*\\) owner to postgres;`).test(code), `${block.name} owner`);
    assert.ok(new RegExp(`revoke all on function ${signature}\\([^)]*\\) from public, anon, authenticated, service_role;`).test(code), `${block.name} revoke`);
  }
  const definers = blocks.filter((b) => b.header.includes("security definer")).map((b) => b.name).sort();
  assert.deepEqual(definers, [
    "private.email_can", "private.email_is_sendable", "private.email_require", "private.email_write_audit",
    ...RPCS.map((r) => `public.${r}`),
  ].sort());
  const grants = [...code.matchAll(/grant execute on function ([a-z_.]+)\([^)]*\) to ([a-z_, ]+);/g)].map((m) => `${m[1]}:${m[2]}`).sort();
  assert.deepEqual(grants, [
    "private.email_can:authenticated",
    ...RPCS.map((r) => `public.${r}:authenticated`),
  ].sort());
});

test("RPCs derive organization and actor server-side", () => {
  for (const block of functionBlocks().filter((b) => b.name.startsWith("public."))) {
    assert.ok(!/organization|actor|user_id|recorded_by|created_by/.test(block.args), `${block.name} accepts identity input`);
    assert.ok(/private\.email_require\('[a-z_]+'\)/.test(block.body), `${block.name} must authorize first`);
    assert.ok(block.body.indexOf("private.email_require(") < block.body.indexOf("begin"), `${block.name} authorizes in declare`);
  }
  const canBody = functionBlocks().find((b) => b.name === "private.email_can").body;
  assert.ok(canBody.includes("membership.role in ('founder', 'admin')"), "Increment 1 is founder/admin only");
  assert.ok(canBody.includes("public.current_user_organization_id()"));
  const auditBody = functionBlocks().find((b) => b.name === "private.email_write_audit").body;
  assert.ok(auditBody.includes("actor uuid := (select auth.uid());"), "audit actor from auth.uid()");
});

test("append-only, immutability and lifecycle guards are present", () => {
  for (const fragment of [
    "create trigger email_audit_log_immutable\nbefore update or delete on public.email_audit_log",
    "create trigger email_audit_log_no_truncate\nbefore truncate on public.email_audit_log",
    "create trigger email_contact_consents_append_only\nbefore update or delete on public.email_contact_consents",
    "create trigger email_contact_consents_no_truncate",
    "create trigger email_contacts_no_truncate",
    "create trigger email_suppressions_no_truncate",
    "create trigger email_contacts_guard\nbefore insert or update or delete on public.email_contacts",
    "create trigger email_suppressions_guard\nbefore insert or update or delete on public.email_suppressions",
    "create trigger email_contact_consents_guard\nbefore insert on public.email_contact_consents",
    "email_contact_identity_immutable",
    "email_contact_invalid_transition",
    "email_suppression_already_lifted",
    "email_consent_address_mismatch",
  ]) {
    assert.ok(code.includes(fragment), `missing guard: ${fragment}`);
  }
});

test("consent evidence and fail-closed sendability contracts", () => {
  assert.ok(code.includes("and source is not null\n      and consent_text is not null\n      and consent_text_version is not null"), "grant requires evidence");
  const sendable = functionBlocks().find((b) => b.name === "private.email_is_sendable").body;
  const order = ["'contact_not_found'", "'contact_not_active'", "'address_invalid'", "'suppressed'", "'consent_missing'", "'consent_revoked'", "'consent_evidence_incomplete'", "'sendable'"];
  let last = -1;
  for (const code_ of order) {
    const at = sendable.indexOf(code_);
    assert.ok(at > last, `sendability check order: ${code_}`);
    last = at;
  }
  assert.ok(sendable.includes("order by consent.ledger_position desc"), "latest event by ledger order");
  assert.ok(code.includes("email_consent_predates_revocation"), "backdated re-consent is rejected");
  assert.ok(code.includes("email_suppression_requires_new_consent"));
  assert.ok(code.includes("email_suppression_not_liftable"));
  assert.ok(raw.includes("does not by itself establish legal compliance"), "legal disclaimer in schema comments");
});

test("idempotency contracts", () => {
  assert.ok(code.includes("on conflict (organization_id, email_normalized) do nothing"));
  assert.ok(code.includes("on conflict (organization_id, idempotency_key) do nothing"));
  assert.ok(code.includes("on conflict (organization_id, email_normalized) where lifted_at is null do nothing"));
  assert.ok(code.includes("email_idempotency_conflict"));
  assert.ok(code.includes("extract(epoch from p_occurred_at)"), "hash must be timezone independent");
});

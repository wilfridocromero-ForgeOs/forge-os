// Static contract validation for Email Marketing V1 - Increment 2 (audiences).
// Run: node supabase/tests/validate_email_marketing_v1_audiences.mjs

import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = resolve(here, "../migrations");
const INC1 = "20260926160000_email_marketing_v1_foundation.sql";
const INC2 = "20260927120000_email_marketing_v1_audiences.sql";
const inc1Raw = readFileSync(resolve(migrationsDir, INC1));
const raw = readFileSync(resolve(migrationsDir, INC2), "utf8");
const code = raw.toLowerCase().replace(/--[^\n]*/g, "");

const TABLES = [
  "email_lists", "email_list_members", "email_tags", "email_contact_tags",
  "email_custom_field_definitions", "email_contact_field_values", "email_segments", "email_contact_crm_links",
];
const RPCS = [
  "email_create_list", "email_archive_list", "email_add_list_members", "email_remove_list_members",
  "email_create_tag", "email_archive_tag", "email_add_contact_tags", "email_remove_contact_tags",
  "email_create_custom_field", "email_archive_custom_field", "email_set_contact_fields",
  "email_create_segment", "email_update_segment", "email_archive_segment",
  "email_preview_audience", "email_preview_segment", "email_import_contacts_from_crm",
];
const INC1_FUNCTIONS = [
  "email_normalize_address", "email_address_hash", "email_can", "email_require", "email_reject_mutation",
  "email_contacts_guard", "email_contact_consents_guard", "email_suppressions_guard", "email_write_audit",
  "email_is_sendable", "email_clean_name", "email_clean_locale", "email_clean_timezone", "email_request_hash",
  "email_create_contact", "email_update_contact", "email_archive_contact", "email_record_consent",
  "email_revoke_consent", "email_add_suppression", "email_lift_suppression",
];

function functionBlocks() {
  const pattern = /create or replace function ([a-z_]+\.[a-z_]+)\(([\s\S]*?)\)\s*returns([\s\S]*?)\nas \$\$([\s\S]*?)\$\$;/g;
  return [...code.matchAll(pattern)].map((m) => ({ name: m[1], args: m[2], header: m[3], body: m[4] }));
}

test("Increment 1 migration is byte-identical to the version validated on Staging", () => {
  assert.equal(createHash("md5").update(inc1Raw).digest("hex"), "dbc4208d3b3df5f35248042a7cfe1113");
});

test("ordering: sorts after Increment 1 and every non-email migration", () => {
  const version = INC2.split("_")[0];
  const all = readdirSync(migrationsDir).filter((f) => f.endsWith(".sql"));
  assert.ok(all.filter((f) => f !== INC2).every((f) => f.split("_")[0] < version));
  assert.ok(version > "20260924145451", "after codex/orb-goal-engine's latest known migration");
});

test("scope: additive, no redefinition of Increment 1 objects, no foreign dependencies", () => {
  for (const name of INC1_FUNCTIONS) {
    assert.ok(!new RegExp(`create or replace function (private|public)\\.${name}\\(`).test(code), `redefines ${name}`);
  }
  for (const forbidden of [
    "is_platform_owner", "member_module_access", "has_active_module_access", "handle_new_user",
    "orb_action_proposals", "goal_engine", "builder_", "can_manage_organization", "pg_net", "net.http",
    "cron.schedule", "vault.", "references public.clients", "alter table public.clients",
  ]) {
    assert.ok(!code.includes(forbidden), `must not reference ${forbidden}`);
  }
  const codeWithoutStrings = code.replace(/'(?:[^']|'')*'/g, "''");
  assert.equal((codeWithoutStrings.match(/public\.clients/g) || []).length, 1, "clients is referenced exactly once in SQL");
  assert.equal((codeWithoutStrings.match(/from public\.clients as client/g) || []).length, 1, "and only as a read (CRM import)");
  const created = [...code.matchAll(/create table ([a-z_.]+)/g)].map((m) => m[1]).sort();
  assert.deepEqual(created, TABLES.map((t) => `public.${t}`).sort());
  const altered = [...code.matchAll(/alter table ([a-z_.]+)/g)].map((m) => m[1]);
  for (const table of altered) {
    assert.ok(table === "public.email_audit_log" || TABLES.includes(table.replace("public.", "")), `alters ${table}`);
  }
  assert.ok(code.includes("drop constraint email_audit_log_entity_type_check,\n  add constraint email_audit_log_entity_type_check check (entity_type in ("));
  for (const type of ["contact", "consent", "suppression", "list", "tag", "custom_field", "segment", "crm_import"]) {
    assert.ok(code.includes(`'${type}'`), `audit entity type ${type}`);
  }
  assert.ok(!/\bexecute\s+(format|'|\$|[a-z_]+\s*;)/.test(code), "no dynamic SQL");
  for (const forbidden of ["api_key", "password", "secret", "smtp", "http://", "https://"]) {
    assert.ok(!code.includes(forbidden), forbidden);
  }
});

test("RLS: enabled everywhere, SELECT-only, tenant + email_can('read')", () => {
  for (const table of TABLES) {
    assert.ok(code.includes(`alter table public.${table} enable row level security`), table);
    assert.ok(code.includes(`create policy ${table}_select on public.${table}\nfor select to authenticated`), table);
  }
  const policies = [...code.matchAll(/create policy [\s\S]*?\);/g)].map((m) => m[0]);
  assert.equal(policies.length, TABLES.length);
  for (const policy of policies) {
    assert.ok(!/\nfor (insert|update|delete|all)\b/.test(policy));
    assert.ok(policy.includes("organization_id = (select public.current_user_organization_id())"));
    assert.ok(policy.includes("(select private.email_can('read'))"));
  }
});

test("tenant-consistent foreign keys", () => {
  for (const [child, parent] of [
    ["email_list_members", "email_lists"], ["email_list_members", "email_contacts"],
    ["email_contact_tags", "email_tags"], ["email_contact_tags", "email_contacts"],
    ["email_contact_field_values", "email_custom_field_definitions"], ["email_contact_field_values", "email_contacts"],
    ["email_contact_crm_links", "email_contacts"],
  ]) {
    const block = code.slice(code.indexOf(`create table public.${child}`), code.indexOf(");\n", code.indexOf(`create table public.${child}`)));
    assert.ok(new RegExp(`references public\\.${parent} \\(organization_id, id\\) on delete restrict`).test(block), `${child} -> ${parent}`);
  }
});

test("grants: SELECT only for authenticated/service_role; nothing for anon", () => {
  assert.ok(!/grant (insert|update|delete|truncate|all)[^;]*on (table )?public\.email_/.test(code));
  assert.ok(!/grant [^;]* to [^;]*\banon\b/.test(code));
  assert.ok(code.includes("from public, anon, authenticated, service_role;\ngrant select on table public.email_lists"));
});

test("functions: pinned search_path, owner, explicit revokes, minimal grants", () => {
  const blocks = functionBlocks();
  const names = blocks.map((b) => b.name);
  for (const rpc of RPCS) assert.ok(names.includes(`public.${rpc}`), rpc);
  for (const block of blocks) {
    assert.ok(block.header.includes("set search_path = ''"), `${block.name} search_path`);
    const escaped = block.name.replace(".", "\\.");
    assert.ok(new RegExp(`alter function ${escaped}\\([^)]*\\) owner to postgres;`).test(code), `${block.name} owner`);
    assert.ok(new RegExp(`revoke all on function ${escaped}\\([^)]*\\) from public, anon, authenticated, service_role;`).test(code), `${block.name} revoke`);
  }
  const definers = blocks.filter((b) => b.header.includes("security definer")).map((b) => b.name).sort();
  assert.deepEqual(definers, RPCS.map((r) => `public.${r}`).sort(), "only the RPCs are SECURITY DEFINER");
  const grants = [...code.matchAll(/grant execute on function ([a-z_.]+)\([^)]*\) to ([a-z_, ]+);/g)].map((m) => `${m[1]}:${m[2]}`).sort();
  assert.deepEqual(grants, RPCS.map((r) => `public.${r}:authenticated`).sort());
});

test("RPCs authorize first and derive organization/actor server-side", () => {
  for (const block of functionBlocks().filter((b) => b.name.startsWith("public."))) {
    assert.ok(!/organization|actor|user_id|created_by/.test(block.args), `${block.name} identity arg`);
    const auth = block.body.match(/private\.email_require\('([a-z_]+)'\)/);
    assert.ok(auth && block.body.indexOf(auth[0]) < block.body.indexOf("\nbegin"), `${block.name} authorizes in declare`);
    assert.ok(["read", "manage_contacts"].includes(auth[1]), `${block.name} uses an existing email_can action`);
    if (block.name.includes("preview")) assert.equal(auth[1], "read");
    else assert.equal(auth[1], "manage_contacts");
  }
});

test("invariants: catalog guard, versioning, append-only links, typed values, fail-closed import", () => {
  for (const fragment of [
    "create trigger email_lists_guard\nbefore insert or update or delete on public.email_lists",
    "create trigger email_tags_guard\nbefore insert or update or delete on public.email_tags",
    "create trigger email_custom_field_definitions_guard\nbefore insert or update or delete on public.email_custom_field_definitions",
    "create trigger email_segments_guard\nbefore insert or update or delete on public.email_segments",
    "create trigger email_segments_versioning\nbefore update on public.email_segments",
    "create trigger email_contact_crm_links_append_only\nbefore update or delete on public.email_contact_crm_links",
    "create trigger email_contact_field_values_guard\nbefore insert or update on public.email_contact_field_values",
    "coalesce(tg_argv, array[]::text[])",
    "'consent_recorded', false",
  ]) assert.ok(code.includes(fragment), fragment);
  const importBody = functionBlocks().find((b) => b.name === "public.email_import_contacts_from_crm").body;
  assert.ok(!importBody.includes("email_record_consent") && !importBody.includes("email_contact_consents"), "import never records consent");
  assert.ok(importBody.includes("where client.organization_id = organization"), "import is tenant-scoped");
  const preview = functionBlocks().find((b) => b.name === "private.email_preview").body;
  assert.ok(preview.includes("private.email_is_sendable(target_organization_id, matched.id, 'marketing')"), "preview uses fail-closed sendability");
  assert.ok(preview.includes("contact.status = 'active'"));
});

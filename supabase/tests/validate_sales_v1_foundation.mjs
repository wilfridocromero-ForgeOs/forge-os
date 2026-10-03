// Sales V1 Increment 1 - static validator (no database, no dependencies).
//   node supabase/tests/validate_sales_v1_foundation.mjs
//
// Checks the migration and rollback text against the hand-written spec in
// sales_v1_foundation.expected.mjs and the Increment 1 safety rules.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as EXPECTED from "./sales_v1_foundation.expected.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const migrationsDir = resolve(here, "../migrations");
const migration = readFileSync(resolve(migrationsDir, EXPECTED.MIGRATION_FILE), "utf8");
const rollback = readFileSync(resolve(here, "rollback/sales_v1_foundation_rollback.sql"), "utf8");

const results = [];
function check(name, fn) {
  try {
    fn();
    results.push([name, true]);
  } catch (error) {
    results.push([name, false, error.message]);
  }
}

// SQL without comments, lower-cased, whitespace collapsed (for pattern checks).
const stripComments = (sql) => sql.replace(/--[^\n]*/g, "");
const code = stripComments(migration);
const flat = code.toLowerCase().replace(/\s+/g, " ");
const normalizeArgs = (args) => args
  .split(",")
  .map((arg) => arg.trim().replace(/\s+default\s+.*$/i, "").split(/\s+/).slice(1).join(" "))
  .filter(Boolean)
  .join(",");

// Function blocks: header up to the body opener.
const functionBlocks = [...code.matchAll(/create function ([a-z_]+\.[a-z_]+)\(([\s\S]*?)\)\s*\n\s*returns([\s\S]*?)\bas \$\$/gi)]
  .map((match) => ({ name: match[1], sig: `${match[1]}(${normalizeArgs(match[2])})`, header: match[3].toLowerCase() }));

check("ASCII only (migration and rollback)", () => {
  for (const [label, text] of [["migration", migration], ["rollback", rollback]]) {
    const offenders = [...text].map((char, index) => [char, index]).filter(([char]) => char.charCodeAt(0) > 127);
    assert.equal(offenders.length, 0, `${label} has non-ASCII at offsets ${offenders.slice(0, 5).map(([, index]) => index)}`);
  }
});

check("no IF NOT EXISTS / OR REPLACE / CASCADE / DROP / explicit transaction control in the migration", () => {
  // DDL "IF [NOT] EXISTS" only; PL/pgSQL "if not exists (select ...)" is fine.
  const ddlIfExists = /\b(table|index|schema|function|trigger|policy|sequence|type|extension|column|constraint|view)\s+if (not )?exists\b/;
  for (const pattern of [ddlIfExists, /\bor replace\b/, /\bcascade\b/, /\bdrop\s/, /(^|;)\s*(begin|commit|rollback)\s*;/]) {
    assert.ok(!pattern.test(flat), `forbidden pattern ${pattern}`);
  }
});

check("the migration only creates Sales objects and alters nothing else", () => {
  const created = [...flat.matchAll(/create (?:unique )?(?:table|index|function|trigger|constraint trigger|policy) ([a-z_.]+)/g)].map((match) => match[1]);
  assert.ok(created.length > 20);
  for (const name of created) assert.match(name, /^(public\.|private\.)?sales_/, `non-Sales object ${name}`);
  for (const match of flat.matchAll(/alter (table|function) ([a-z_.]+)/g)) {
    assert.match(match[2], /^(public|private)\.sales_/, `alter on ${match[2]}`);
  }
  const alterTables = [...flat.matchAll(/alter table ([^;]+);/g)].map((match) => match[1].trim());
  for (const statement of alterTables) assert.match(statement, /^public\.sales_[a-z_]+ enable row level security$/);
  assert.ok(!/\b(insert into|update|delete from)\s+public\.(organizations|organization_memberships|user_active_organizations|users)\b/.test(flat));
});

check("tables match the spec, each with RLS enabled", () => {
  const tables = [...flat.matchAll(/create table ([a-z_.]+)/g)].map((match) => match[1]).sort();
  assert.deepEqual(tables, Object.keys(EXPECTED.TABLES).sort());
  for (const table of tables) assert.ok(flat.includes(`alter table ${table} enable row level security;`), `${table} RLS`);
});

check("functions match the spec exactly", () => {
  assert.deepEqual(functionBlocks.map((block) => block.sig).sort(), EXPECTED.FUNCTIONS.map((fn) => fn.sig).sort());
});

check("every function sets search_path = '' and SECURITY DEFINER matches the spec", () => {
  for (const block of functionBlocks) {
    assert.ok(block.header.includes("set search_path = ''"), `${block.sig} search_path`);
    const spec = EXPECTED.FUNCTIONS.find((fn) => fn.sig === block.sig);
    assert.equal(block.header.includes("security definer"), spec.secdef, `${block.sig} security definer`);
  }
});

check("every function: owner postgres, revoked from PUBLIC/anon/authenticated/service_role, grants match the spec", () => {
  const spaced = (sig) => sig.replace(/,/g, ", ");
  for (const fn of EXPECTED.FUNCTIONS) {
    const sig = spaced(fn.sig);
    assert.ok(flat.includes(`alter function ${sig} owner to postgres;`), `${sig} owner`);
    assert.ok(flat.includes(`revoke all on function ${sig} from public, anon, authenticated, service_role;`), `${sig} revoke`);
    const grants = [...flat.matchAll(new RegExp(`grant execute on function ${sig.replace(/[()[\]]/g, "\\$&")} to ([a-z_, ]+);`, "g"))]
      .flatMap((match) => match[1].split(",").map((role) => role.trim()));
    assert.deepEqual(grants.sort(), [...fn.execute].sort(), `${sig} grants`);
  }
});

check("tables: everything revoked; only SELECT granted, only to authenticated", () => {
  assert.ok(flat.includes("revoke all on table public.sales_audit_log, public.sales_pipelines, public.sales_pipeline_stages from public, anon, authenticated, service_role;"));
  assert.ok(flat.includes("revoke all on sequence public.sales_audit_log_id_seq from public, anon, authenticated, service_role;"));
  const tableGrants = [...flat.matchAll(/grant ([a-z, ]+) on table ([^;]+) to ([a-z_, ]+);/g)];
  assert.equal(tableGrants.length, 1);
  assert.equal(tableGrants[0][1].trim(), "select");
  assert.equal(tableGrants[0][3].trim(), "authenticated");
  assert.ok(!/grant [a-z, ]+ on sequence/.test(flat));
  assert.ok(!/grant [a-z, ]*(insert|update|delete|truncate|all)[a-z, ]* on (table )?public\.sales_/.test(flat));
});

check("policies: SELECT only, authenticated only, organization predicate plus sales_can('read')", () => {
  const policies = [...code.matchAll(/create policy (\w+) on (public\.\w+)\s+for (\w+) to (\w+)\s+using \(([\s\S]*?)\);/gi)];
  assert.deepEqual(policies.map((match) => match[1]).sort(), EXPECTED.POLICIES.map((policy) => policy.name).sort());
  for (const [, name, table, command, role, using] of policies) {
    assert.equal(command.toLowerCase(), "select", `${name} command`);
    assert.equal(role.toLowerCase(), "authenticated", `${name} role`);
    assert.ok(using.includes("organization_id = (select public.current_user_organization_id())"), `${name} org predicate`);
    assert.ok(using.includes("(select private.sales_can('read'))"), `${name} sales_can`);
    assert.ok(EXPECTED.POLICIES.some((policy) => policy.name === name && policy.table === table));
  }
  assert.ok(!/create policy[^;]+for (insert|update|delete|all)/.test(flat));
});

check("every public RPC authorizes first through private.sales_require('manage_pipeline')", () => {
  for (const match of code.matchAll(/create function (public\.sales_\w+)\([\s\S]*?\bdeclare\s+organization uuid := private\.sales_require\('(\w+)'\);/gi)) {
    assert.equal(match[2], "manage_pipeline", `${match[1]}`);
  }
  const rpcs = EXPECTED.FUNCTIONS.filter((fn) => fn.sig.startsWith("public.")).length;
  const guarded = [...code.matchAll(/declare\s+organization uuid := private\.sales_require\('manage_pipeline'\);/gi)].length;
  assert.equal(guarded, rpcs);
});

check("sales_can: closed action list, founder/admin only, no platform-owner bypass", () => {
  assert.ok(flat.includes("requested_action in ('read', 'manage_pipeline')"));
  assert.ok(flat.includes("membership.role in ('founder', 'admin')"));
  assert.ok(!flat.includes("is_platform_owner"));
});

check("invariant enforcement objects are present", () => {
  for (const fragment of [
    "create unique index sales_pipeline_stages_one_active_won_idx on public.sales_pipeline_stages (pipeline_id) where kind = 'won' and status = 'active';",
    "create unique index sales_pipelines_one_default_idx on public.sales_pipelines (organization_id) where is_default;",
    "unique (pipeline_id, position) deferrable initially deferred",
    "create constraint trigger sales_pipeline_stages_check_structure after insert or update on public.sales_pipeline_stages deferrable initially deferred",
    "create constraint trigger sales_pipelines_check_structure after insert on public.sales_pipelines deferrable initially deferred",
    "create trigger sales_pipeline_stages_bump_structure after insert or update of status, position on public.sales_pipeline_stages",
    "create trigger sales_audit_log_reject_mutation before update or delete on public.sales_audit_log",
    "create trigger sales_audit_log_reject_truncate before truncate on public.sales_audit_log",
    "on conflict (organization_id) where is_default do nothing",
    "if current_stage.version <> p_expected_version then",
  ]) {
    assert.ok(flat.includes(fragment), `missing: ${fragment}`);
  }
});

check("error codes: every raised SALES_* code is in the spec and every spec code is raised", () => {
  const raised = new Set([...code.matchAll(/message = '(SALES_[A-Z_]+)'/g)].map((match) => match[1]));
  assert.deepEqual([...raised].sort(), [...EXPECTED.ERROR_CODES].sort());
});

check("no references to other workstreams (clients, Email, Builder, Orb/Goal Engine, Codex permissions)", () => {
  for (const reference of EXPECTED.FORBIDDEN_REFERENCES) {
    assert.ok(!flat.includes(reference.toLowerCase()), `references ${reference}`);
  }
});

check("migration version is unique and newer than every existing local migration", () => {
  const versions = readdirSync(migrationsDir).filter((file) => file.endsWith(".sql")).map((file) => file.split("_")[0]);
  assert.equal(versions.filter((version) => version === EXPECTED.MIGRATION_VERSION).length, 1);
  for (const version of versions) {
    if (version !== EXPECTED.MIGRATION_VERSION) assert.ok(version < EXPECTED.MIGRATION_VERSION, `${version} sorts after Sales`);
  }
});

check("no tracked file modified; no existing migration changed", () => {
  let output;
  try {
    output = execFileSync("git", ["status", "--porcelain", "--untracked-files=all"], { cwd: root, encoding: "utf8" });
  } catch {
    return; // not a git checkout: nothing to compare
  }
  const lines = output.split("\n").filter(Boolean);
  const modified = lines.filter((line) => !line.startsWith("??"));
  assert.deepEqual(modified, [], "tracked files modified");
  const allowed = [
    "docs/sales/",
    `supabase/migrations/${EXPECTED.MIGRATION_FILE}`,
    "supabase/tests/sales_v1_foundation.",
    "supabase/tests/validate_sales_v1_foundation.mjs",
    "supabase/tests/rollback/sales_v1_foundation_rollback.sql",
  ];
  for (const line of lines) {
    const path = line.slice(3).trim();
    assert.ok(allowed.some((prefix) => path.startsWith(prefix)), `unexpected new file ${path}`);
  }
});

check("rollback: single transaction, guarded, no CASCADE, drops exactly the spec objects, postflight", () => {
  const rollbackFlat = stripComments(rollback).toLowerCase().replace(/\s+/g, " ");
  assert.ok(/^\s*begin;/.test(rollbackFlat) && /commit;\s*$/.test(rollbackFlat), "begin/commit");
  assert.ok(!/\bcascade\b/.test(rollbackFlat));
  assert.ok(rollbackFlat.includes("sales_rollback_blocked") && rollbackFlat.includes("sales_rollback_incomplete"));
  assert.ok(rollbackFlat.includes("destroy_sales_v1_inc1_data"));
  const dropped = [...rollbackFlat.matchAll(/drop function ([a-z_.]+\([^)]*\));/g)].map((match) => match[1].replace(/, /g, ","));
  assert.deepEqual(dropped.sort(), EXPECTED.FUNCTIONS.map((fn) => fn.sig).sort());
  const droppedTables = [...rollbackFlat.matchAll(/drop table ([a-z_.]+);/g)].map((match) => match[1]);
  assert.deepEqual(droppedTables.sort(), Object.keys(EXPECTED.TABLES).sort());
  const listed = [...rollback.matchAll(/'((?:public|private)\.sales_[a-z_]+\([^)]*\))'/g)].map((match) => match[1]);
  assert.deepEqual(listed.sort(), EXPECTED.FUNCTIONS.map((fn) => fn.sig).sort(), "rollback expected_functions list");
  assert.ok(rollbackFlat.indexOf("drop function public.sales_archive_stage") < rollbackFlat.indexOf("drop table public.sales_pipeline_stages"),
    "RPCs returning the stage row type are dropped before the table");
  assert.ok(rollbackFlat.indexOf("drop table public.sales_pipeline_stages") < rollbackFlat.indexOf("drop function private.sales_clean_name"),
    "tables are dropped before helpers used by CHECK constraints");
});

let failed = 0;
for (const [name, ok, message] of results) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `\n      ${message}`}`);
  if (!ok) failed += 1;
}
console.log(`\nStatic: ${results.length - failed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);

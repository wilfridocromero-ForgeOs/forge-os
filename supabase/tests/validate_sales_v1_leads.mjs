// Sales V1 Increment 2 - cumulative static validator (no database, no dependencies).
//   node supabase/tests/validate_sales_v1_leads.mjs
//
// Approved decision D3: the Increment 1 validator stays frozen as evidence of
// the closed Increment 1 state (it would now report Increment 2 as drift). This
// validator covers the cumulative state instead:
// * Increment 1 artifacts are byte-identical to the closed increment;
// * Increment 2 is the newest Sales migration and its files are all present;
// * the Increment 2 migration and rollback follow the safety rules and match the
//   hand-written spec (sales_v1_leads.expected.mjs);
// * no unrelated workstream file is touched.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as EXPECTED from "./sales_v1_leads.expected.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const migrationsDir = resolve(here, "../migrations");
const read = (relative) => readFileSync(resolve(root, relative), "utf8");
const lf = (text) => text.replace(/\r\n/g, "\n");
const sha256 = (text) => createHash("sha256").update(text).digest("hex");

const migration = lf(read(`supabase/migrations/${EXPECTED.MIGRATION_FILE}`));
const inc1Migration = lf(read(`supabase/migrations/${EXPECTED.INC1_MIGRATION_FILE}`));
const rollback = lf(read("supabase/tests/rollback/sales_v1_leads_attribution_rollback.sql"));
const stripComments = (sql) => sql.replace(/--[^\n]*/g, "");
const code = stripComments(migration);
const flat = code.toLowerCase().replace(/\s+/g, " ");
const rollbackFlat = stripComments(rollback).toLowerCase().replace(/\s+/g, " ");
const compact = (sig) => sig.replace(/\s+/g, "");
const normalizeArgs = (args) => args.split(",")
  .map((arg) => arg.trim().replace(/\s+default\s+.*$/i, "").split(/\s+/).slice(1).join(" "))
  .filter(Boolean).join(",");
const functionBlocks = [...code.matchAll(/create (?:or replace )?function ([a-z_]+\.[a-z_]+)\(([\s\S]*?)\)\s*\n\s*returns([\s\S]*?)\bas \$\$/gi)]
  .map((match) => ({ sig: `${match[1]}(${normalizeArgs(match[2])})`, header: match[3].toLowerCase() }));
const bodyOf = (text, start) => {
  const at = text.indexOf(start);
  assert.ok(at >= 0, `missing ${start}`);
  const open = text.indexOf("as $$", at) + 5;
  return text.slice(open, text.indexOf("$$;", open));
};

// Working-tree / index gate. Parses `git status --porcelain` v1 lines by their
// exact two-character XY status (X = index, Y = work tree), never by substring:
// * the 8 new Increment 2 files: "??" (untracked) or "A " (staged-added, work
//   tree identical to the index); anything else (AM, M, D, R, ...) fails;
// * docs/sales/ARCHITECTURE.md (the one tracked file Increment 2 updates):
//   " M" (unstaged) or "M " (staged, work tree identical to the index) only;
// * any other path - including the already committed M1 fix files, other docs
//   and frozen Increment 1 artifacts - and any rename/copy or unparseable line: fails.
const SALES_DOC = "docs/sales/ARCHITECTURE.md";
export function statusViolations(lines) {
  const violations = [];
  for (const line of lines) {
    const match = /^([ MTADRCU?!])([ MTADRCU?!]) (\S.*)$/.exec(line);
    if (!match) {
      violations.push(`unparseable status line: ${JSON.stringify(line)}`);
      continue;
    }
    const xy = match[1] + match[2];
    const path = match[3];
    if (xy[0] === "R" || xy[0] === "C" || xy[1] === "R" || xy[1] === "C" || path.includes(" -> ")) {
      violations.push(`rename/copy not allowed: ${line}`);
    } else if (EXPECTED.INC2_FILES.includes(path)) {
      if (xy !== "??" && xy !== "A ") violations.push(`Increment 2 file must be untracked (??) or staged-added (A ): ${line}`);
    } else if (path === SALES_DOC) {
      if (xy !== " M" && xy !== "M ") violations.push(`Sales doc must be a plain modification ( M or M ): ${line}`);
    } else {
      violations.push(`unexpected change: ${line}`);
    }
  }
  return violations;
}

if (process.argv.includes("--self-test-status")) {
  const MIG = `supabase/migrations/${EXPECTED.MIGRATION_FILE}`;
  const SUITE = "supabase/tests/sales_v1_leads.suite.mjs";
  const cases = [
    ["approved Increment 2 path untracked (??)", [`?? ${MIG}`], true],
    ["approved Increment 2 path staged-added (A )", [`A  ${MIG}`], true],
    ["full staged candidate (8 x A  + doc M )", [...EXPECTED.INC2_FILES.map((p) => `A  ${p}`), `M  ${SALES_DOC}`], true],
    ["full untracked candidate (8 x ?? + doc  M)", [...EXPECTED.INC2_FILES.map((p) => `?? ${p}`), ` M ${SALES_DOC}`], true],
    ["approved new-only path as modified (M  /  M)", [`M  ${MIG}`, ` M ${SUITE}`], false],
    ["approved path staged then modified (AM)", [`AM ${MIG}`], false],
    ["unexpected staged path (A )", ["A  src/app/Sales.jsx"], false],
    ["committed M1 fix file reappearing (A )", [`A  ${EXPECTED.FIX_FILES[0]}`], false],
    ["committed M1 fix file modified ( M)", [` M ${EXPECTED.FIX_FILES[0]}`], false],
    ["frozen Increment 1 artifact modified ( M)", [" M supabase/migrations/20261002120000_sales_v1_foundation.sql"], false],
    ["unexpected modified tracked path (M )", ["M  package.json"], false],
    ["deleted approved path (D )", [`D  ${MIG}`], false],
    ["deleted tracked path ( D)", [" D supabase/tests/validate_sales_v1_foundation.mjs"], false],
    ["rename onto an approved path (R )", [`R  old.sql -> ${MIG}`], false],
    ["Sales doc expected modification ( M)", [` M ${SALES_DOC}`], true],
    ["Sales doc expected modification staged (M )", [`M  ${SALES_DOC}`], true],
    ["Sales doc staged then modified again (MM)", [`MM ${SALES_DOC}`], false],
    ["Sales doc deleted (D )", [`D  ${SALES_DOC}`], false],
    ["unrelated doc modified ( M)", [" M docs/email-marketing/ARCHITECTURE.md"], false],
    ["unrelated doc modified (M )", ["M  docs/design/README.md"], false],
    ["path that merely contains an approved path", [`?? ${MIG}.bak`], false],
    ["unrelated untracked file", ["?? notes.txt"], false],
    ["malformed one-character status", [`A ${MIG}`], false],
  ];
  let bad = 0;
  for (const [label, lines, expected] of cases) {
    const ok = statusViolations(lines).length === 0;
    if (ok !== expected) bad += 1;
    console.log(`${ok === expected ? "PASS" : "FAIL"}  status parser: ${label} -> ${ok ? "accepted" : "rejected"} (expected ${expected ? "accepted" : "rejected"})`);
  }
  console.log(`\nStatus parser self-test: ${cases.length - bad} passed, ${bad} failed`);
  process.exit(bad === 0 ? 0 : 1);
}

const results = [];
const check = (name, fn) => {
  try {
    fn();
    results.push([name, true]);
  } catch (error) {
    results.push([name, false, error.message]);
  }
};

check("Increment 1 artifacts are byte-identical to the closed increment (LF-normalized sha256)", () => {
  for (const [path, expected] of Object.entries(EXPECTED.INC1_ARTIFACTS)) {
    assert.equal(sha256(lf(read(path))), expected, `drift in ${path}`);
  }
});

check("Increment 2 file inventory is complete", () => {
  for (const path of EXPECTED.INC2_FILES) assert.ok(existsSync(resolve(root, path)), `missing ${path}`);
});

check("Increment 2 is the newest migration; Sales migrations are exactly Inc1, fix M1, Inc2", () => {
  const files = readdirSync(migrationsDir).filter((file) => file.endsWith(".sql")).sort();
  const versions = files.map((file) => file.split("_")[0]);
  assert.equal(versions.filter((version) => version === EXPECTED.MIGRATION_VERSION).length, 1);
  assert.equal(files[files.length - 1], EXPECTED.MIGRATION_FILE, "Increment 2 sorts last");
  assert.equal(files[files.length - 2], EXPECTED.FIX_MIGRATION_FILE, "fix M1 sorts just before");
  assert.equal(files[files.length - 3], EXPECTED.INC1_MIGRATION_FILE, "Increment 1 before the fix");
  assert.deepEqual(files.filter((file) => /sales/i.test(file)),
    [EXPECTED.INC1_MIGRATION_FILE, EXPECTED.FIX_MIGRATION_FILE, EXPECTED.MIGRATION_FILE]);
});

check("ASCII only (Increment 2 migration and rollback)", () => {
  for (const [label, text] of [["migration", migration], ["rollback", rollback]]) {
    assert.equal([...text].filter((char) => char.charCodeAt(0) > 127).length, 0, `${label} has non-ASCII`);
  }
});

check("no CASCADE, no DDL IF [NOT] EXISTS, no explicit transaction control in the migration", () => {
  assert.ok(!/\bcascade\b/.test(flat));
  assert.ok(!/\b(table|index|schema|function|trigger|policy|sequence|type|extension|column|constraint|view)\s+if (not )?exists\b/.test(flat));
  assert.ok(!/(^|;)\s*(begin|commit|rollback)\s*;/.test(flat));
});

check("changes to Increment 1 objects are exactly the approved D1/D2 changes, after the guard", () => {
  assert.deepEqual([...flat.matchAll(/create or replace function ([a-z_.]+)/g)].map((m) => m[1]), ["private.sales_can"], "only sales_can is replaced");
  assert.deepEqual([...flat.matchAll(/\bdrop ([a-z ]+?) ([a-z_.]+)/g)].map((m) => `${m[1]} ${m[2]}`),
    ["constraint sales_audit_log_action_check", "constraint sales_audit_log_entity_type_check"], "only the two widened CHECKs are dropped");
  const alters = [...flat.matchAll(/alter table ([a-z_.]+) ([^;]+);/g)].map((m) => `${m[1]} ${m[2].split(" ").slice(0, 3).join(" ")}`);
  for (const statement of alters) {
    assert.ok(/^public\.sales_audit_log (drop constraint sales_audit_log_(action|entity_type)_check|add constraint sales_audit_log_(action_check|entity_type_check|lead_entity_check))/.test(statement)
      || /^public\.sales_(leads|lead_touches) enable row level/.test(statement), `unexpected alter: ${statement}`);
  }
  const guardAt = flat.indexOf("sales_migration_drift");
  const lockAt = flat.indexOf("lock table public.sales_audit_log in access exclusive mode;");
  assert.ok(lockAt >= 0 && lockAt < guardAt, "audit log locked before the guard");
  assert.ok(guardAt < flat.indexOf("create or replace function private.sales_can"), "guard before the sales_can replace");
  assert.ok(guardAt < flat.indexOf("drop constraint sales_audit_log_action_check"), "guard before the CHECK changes");
  assert.ok(migration.includes(`'${EXPECTED.INC1_SALES_CAN_MD5}'`), "guard checks the Increment 1 sales_can fingerprint");
  for (const definition of EXPECTED.INC1_AUDIT_CONSTRAINTS) {
    assert.ok(migration.includes(`$c$${definition}$c$`), `guard checks ${definition.split(" =>")[0]}`);
  }
});

check("only Sales objects are created; no write to non-Sales tables", () => {
  const created = [...flat.matchAll(/create (?:unique )?(?:table|index|function|trigger|policy|view) ([a-z_.]+)/g)].map((m) => m[1]);
  for (const name of created) assert.match(name, /^(public\.|private\.)?sales_/, `non-Sales object ${name}`);
  assert.ok(!/\b(insert into|update|delete from)\s+public\.(?!sales_)[a-z_]+/.test(flat), "writes outside Sales");
});

check("function inventory matches the spec (Inc2 functions + the replaced sales_can)", () => {
  assert.deepEqual(functionBlocks.map((block) => block.sig).sort(),
    [...EXPECTED.INC2_FUNCTION_SIGNATURES, "private.sales_can(text)"].sort());
});

check("every function sets search_path = '', security definer as specified, owner/revoke/grant as specified", () => {
  for (const block of functionBlocks) {
    const spec = EXPECTED.FUNCTIONS.find((fn) => fn.sig === block.sig);
    assert.ok(spec, `no spec for ${block.sig}`);
    assert.ok(block.header.includes("set search_path = ''"), `${block.sig} search_path`);
    assert.equal(block.header.includes("security definer"), spec.secdef, `${block.sig} security definer`);
    const sigs = (statement) => [...flat.matchAll(new RegExp(`${statement} ([a-z_.]+\\([^)]*\\))`, "g"))].map((m) => compact(m[1]));
    assert.ok(sigs("alter function").includes(block.sig), `${block.sig} owner`);
    assert.ok(sigs("revoke all on function").includes(block.sig), `${block.sig} revoke`);
    const grants = [...flat.matchAll(/grant execute on function ([a-z_.]+\([^)]*\)) to ([a-z_, ]+);/g)]
      .filter((m) => compact(m[1]) === block.sig).flatMap((m) => m[2].split(",").map((role) => role.trim()));
    assert.deepEqual(grants.sort(), [...spec.execute].sort(), `${block.sig} grants`);
  }
  for (const fn of EXPECTED.FUNCTIONS.filter((item) => EXPECTED.INC2_FUNCTION_SIGNATURES.includes(item.sig))) {
    assert.ok(flat.includes(`revoke all on function ${fn.sig.replace(/,/g, ", ")} from public, anon, authenticated, service_role;`), `${fn.sig} revoke from all API roles`);
  }
});

check("tables and view: RLS enabled, everything revoked, SELECT only to authenticated, view is security invoker", () => {
  for (const table of ["public.sales_leads", "public.sales_lead_touches"]) {
    assert.ok(flat.includes(`alter table ${table} enable row level security;`), `${table} RLS`);
  }
  assert.ok(flat.includes("revoke all on table public.sales_leads, public.sales_lead_touches, public.sales_lead_attribution from public, anon, authenticated, service_role;"));
  const grants = [...flat.matchAll(/grant ([a-z, ]+) on table ([^;]+) to ([a-z_, ]+);/g)];
  assert.equal(grants.length, 1);
  assert.equal(grants[0][1].trim(), "select");
  assert.equal(grants[0][3].trim(), "authenticated");
  assert.ok(flat.includes("create view public.sales_lead_attribution with (security_invoker = true) as"));
});

check("policies: SELECT only, authenticated only, organization predicate plus sales_can('read')", () => {
  const policies = [...code.matchAll(/create policy (\w+) on (public\.\w+)\s+for (\w+) to (\w+)\s+using \(([\s\S]*?)\);/gi)];
  assert.deepEqual(policies.map((m) => m[1]).sort(), ["sales_lead_touches_select", "sales_leads_select"]);
  for (const [, name, , command, role, using] of policies) {
    assert.equal(command.toLowerCase(), "select", name);
    assert.equal(role.toLowerCase(), "authenticated", name);
    assert.ok(using.includes("organization_id = (select public.current_user_organization_id())"), `${name} org predicate`);
    assert.ok(using.includes("(select private.sales_can('read'))"), `${name} sales_can`);
  }
});

check("every public lead RPC authorizes first through private.sales_require('manage_leads')", () => {
  const rpcs = EXPECTED.INC2_FUNCTION_SIGNATURES.filter((sig) => sig.startsWith("public."));
  const guarded = [...code.matchAll(/declare\s+organization uuid := private\.sales_require\('manage_leads'\);/gi)].length;
  assert.equal(guarded, rpcs.length);
  assert.ok(!/sales_require\('manage_pipeline'\)/.test(code), "no lead RPC reuses manage_pipeline");
  assert.ok(flat.includes("requested_action in ('read', 'manage_pipeline', 'manage_leads')"));
  assert.ok(flat.includes("membership.role in ('founder', 'admin')"));
});

check("RPCs never accept an organization id; lookups filter by the caller's organization", () => {
  for (const match of code.matchAll(/create function public\.(sales_\w+)\(([\s\S]*?)\)\s*\n\s*returns/gi)) {
    assert.ok(!/organization/i.test(match[2]), `${match[1]} takes an organization parameter`);
  }
  assert.ok((code.match(/lead\.organization_id = (organization|p_organization_id)/g) || []).length >= 6);
});

check("invariant enforcement objects are present", () => {
  for (const fragment of [
    "create unique index sales_leads_active_email_idx on public.sales_leads (organization_id, email_normalized) where email_normalized is not null and status <> 'archived';",
    "create unique index sales_leads_active_external_idx on public.sales_leads (organization_id, external_source, external_id) where external_id is not null and status <> 'archived';",
    "create unique index sales_lead_touches_idempotency_idx on public.sales_lead_touches (organization_id, idempotency_key) where idempotency_key is not null;",
    "touch_count integer not null default 0 check (touch_count between 0 and 1000)",
    "check (email_normalized is not null or phone_normalized is not null or external_id is not null)",
    "create trigger sales_lead_touches_guard before insert or update or delete on public.sales_lead_touches",
    "create trigger sales_lead_touches_reject_truncate before truncate on public.sales_lead_touches",
    "create trigger sales_leads_guard before insert or update or delete on public.sales_leads",
    "pg_advisory_xact_lock(hashtextextended('orvesen.sales.leads:' || p_organization_id::text, 0))",
    "if v_id is not null and v_hash is distinct from p_request_hash then",
    "foreign key (organization_id, lead_id) references public.sales_leads(organization_id, id)",
  ]) assert.ok(flat.includes(fragment), `missing: ${fragment}`);
  assert.ok(!/first_touch_id uuid|last_touch_id uuid/.test(flat.split("create view")[0]), "no stored first/last pointers");
});

check("error codes: every raised SALES_* code is known", () => {
  const raised = new Set([...code.matchAll(/message = '(SALES_[A-Z_]+)'/g)].map((m) => m[1]));
  assert.deepEqual([...raised].sort(), [...EXPECTED.INC2_ERROR_CODES].sort());
});

check("no references to other workstreams (clients, Email, Builder, Orb/Goal Engine, Codex permissions)", () => {
  for (const reference of EXPECTED.FORBIDDEN_REFERENCES) assert.ok(!flat.includes(reference.toLowerCase()), `references ${reference}`);
});

check("rollback: one transaction, locks first, guarded, no CASCADE, exact restores, postflight", () => {
  assert.ok(/^\s*begin;\s*lock table public\.sales_audit_log, public\.sales_leads, public\.sales_lead_touches in access exclusive mode;/.test(rollbackFlat), "ACCESS EXCLUSIVE locks first");
  assert.ok(/commit;\s*$/.test(rollbackFlat));
  assert.ok(!/\bcascade\b/.test(rollbackFlat));
  assert.ok(rollbackFlat.includes("sales_rollback_blocked") && rollbackFlat.includes("sales_rollback_incomplete"));
  assert.ok(!rollbackFlat.includes("sales_rollback_confirm"), "no destructive override");
  assert.ok(rollback.includes(`'${EXPECTED.INC2_SALES_CAN_MD5}'`), "guards the Increment 2 sales_can");
  assert.ok(rollback.includes(`'${EXPECTED.INC1_SALES_CAN_MD5}'`), "verifies the restored Increment 1 sales_can");
  assert.equal(bodyOf(rollback, "create or replace function private.sales_can"), bodyOf(inc1Migration, "create function private.sales_can"),
    "restored sales_can body is byte-identical to Increment 1");
  for (const definition of [...EXPECTED.INC2_AUDIT_CONSTRAINTS, ...EXPECTED.INC1_AUDIT_CONSTRAINTS]) {
    assert.ok(rollback.includes(`$c$${definition}$c$`), `rollback checks ${definition.slice(0, 50)}`);
  }
  const dropped = [...rollbackFlat.matchAll(/drop function ([a-z_.]+\([^)]*\));/g)].map((m) => compact(m[1]));
  assert.deepEqual(dropped.sort(), [...EXPECTED.INC2_FUNCTION_SIGNATURES].sort());
  assert.deepEqual([...rollbackFlat.matchAll(/drop table ([a-z_.]+);/g)].map((m) => m[1]).sort(), ["public.sales_lead_touches", "public.sales_leads"]);
  assert.ok(rollbackFlat.includes("drop view public.sales_lead_attribution;"));
  const listed = [...rollback.split("expected_functions text[] := array[")[1].split("];")[0].matchAll(/'([^']+)'/g)].map((m) => m[1]);
  assert.deepEqual(listed, EXPECTED.FUNCTIONS.map((fn) => fn.sig).sort(), "rollback function inventory = spec");
  assert.ok(rollbackFlat.indexOf("drop function public.sales_archive_lead") < rollbackFlat.indexOf("drop table public.sales_leads"),
    "functions returning the lead row type are dropped before the table");
  assert.ok(rollbackFlat.indexOf("drop table public.sales_leads") < rollbackFlat.indexOf("drop function private.sales_normalize_email"),
    "tables are dropped before helpers used by CHECK constraints");
});

check("working tree / index: only the Increment 2 files (?? or A ) and the Sales doc ( M or M )", () => {
  let output;
  try {
    output = execFileSync("git", ["status", "--porcelain", "--untracked-files=all"], { cwd: root, encoding: "utf8" });
  } catch {
    return;
  }
  assert.deepEqual(statusViolations(output.split("\n").filter(Boolean)), []);
});

let failed = 0;
for (const [name, ok, message] of results) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `\n      ${message}`}`);
  if (!ok) failed += 1;
}
console.log(`\nStatic (cumulative Inc2): ${results.length - failed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);

// Sales V1 forward fix M1 - static validator (no database, no dependencies).
//   node supabase/tests/validate_sales_v1_default_pipeline_lock.mjs
//
// Proves from source text that the fix changes exactly one thing: the body of
// public.sales_ensure_default_pipeline equals the Increment 1 body plus the
// advisory-lock block, behind a guard on the exact Increment 1 fingerprint.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const lf = (text) => text.replace(/\r\n/g, "\n");
const read = (relative) => lf(readFileSync(resolve(root, relative), "utf8"));
const md5 = (text) => createHash("md5").update(text).digest("hex");
const sha256 = (text) => createHash("sha256").update(text).digest("hex");

const INC1_FILE = "20261002120000_sales_v1_foundation.sql";
const FIX_FILE = "20261002130000_sales_v1_default_pipeline_lock.sql";
const FIX_FILES = [
  `supabase/migrations/${FIX_FILE}`,
  "supabase/tests/rollback/sales_v1_default_pipeline_lock_rollback.sql",
  "supabase/tests/sales_v1_default_pipeline_lock.postgres.mjs",
  "supabase/tests/validate_sales_v1_default_pipeline_lock.mjs",
];
// Closed Increment 1 artifacts (LF-normalized sha256, commits 8394c45 / 6a49fbc).
const INC1_ARTIFACTS = {
  "supabase/migrations/20261002120000_sales_v1_foundation.sql": "da1bc22619036249f36a67ff71641e7c4d54107dc10e5d0158349cefec0e73b2",
  "supabase/tests/rollback/sales_v1_foundation_rollback.sql": "cb934086c045131912318221b38663338f2b80358f90c842492db57f9cbc5b8f",
  "supabase/tests/sales_v1_foundation.expected.mjs": "4ac9d43d4ee14e2b9caf915537ae4e26d12d11322a4753b4c6aa70d2a90bb4ba",
  "supabase/tests/sales_v1_foundation.suite.mjs": "967d811d53d3befae440716efee6bb0587e984f1c54bf383fc10cbee07fe10f2",
  "supabase/tests/sales_v1_foundation.integration.mjs": "5026ff0cc708e3e2d8b675e098c288d63f47f726910192f54b0b37a5d58512f0",
  "supabase/tests/sales_v1_foundation.postgres.mjs": "a9ff707cbdac726f229c91dd47c76d6b2df38fffc1eb528a9f063e34059d2143",
  "supabase/tests/sales_v1_foundation.sabotage.mjs": "4596b735b71085b0989d9697530fec2a78a9314e490a59aa3cfa07097d1061d0",
  "supabase/tests/sales_v1_foundation.staging_acceptance.sql": "c597ae2927713d33c1f751660a5ed6df4976f87608bcdb0c0ae1dd1eeaa7e240",
  "supabase/tests/validate_sales_v1_foundation.mjs": "b563a4950e9264d0957d42f24447f96ffd419ed1b7e00eb9643f057a22e51505",
};
const LOCK_BLOCK = "\n  if pipeline.id is null then\n    -- M1: serialize first creation per organization, then re-check under the lock.\n    perform pg_advisory_xact_lock(hashtextextended('orvesen.sales.pipelines:' || organization::text, 0));\n    select * into pipeline\n    from public.sales_pipelines as existing\n    where existing.organization_id = organization and existing.is_default;\n  end if;\n";

const inc1 = read(`supabase/migrations/${INC1_FILE}`);
const fix = read(`supabase/migrations/${FIX_FILE}`);
const rollback = read("supabase/tests/rollback/sales_v1_default_pipeline_lock_rollback.sql");
const bodyOf = (text, start) => {
  const at = text.indexOf(start);
  assert.ok(at >= 0, `missing ${start}`);
  const open = text.indexOf("as $$", at) + 5;
  return text.slice(open, text.indexOf("$$;", open));
};
const strip = (sql) => sql.replace(/--[^\n]*/g, "").toLowerCase().replace(/\s+/g, " ");
const inc1Body = bodyOf(inc1, "create function public.sales_ensure_default_pipeline()");
const fixBody = bodyOf(fix, "create or replace function public.sales_ensure_default_pipeline()");

const results = [];
const check = (name, fn) => {
  try { fn(); results.push([name, true]); } catch (error) { results.push([name, false, error.message]); }
};

check("Increment 1 artifacts are byte-identical to the closed increment", () => {
  for (const [path, expected] of Object.entries(INC1_ARTIFACTS)) assert.equal(sha256(read(path)), expected, `drift in ${path}`);
});
check("fix body = Increment 1 body + the advisory-lock block, nothing else", () => {
  assert.equal(fixBody.split(LOCK_BLOCK).length - 1, 1, "lock block present exactly once");
  assert.equal(fixBody.replace(LOCK_BLOCK, ""), inc1Body);
});
check("guard checks the exact Increment 1 fingerprint before the replace and fails closed", () => {
  const flat = strip(fix);
  assert.ok(fix.includes(`'${md5(inc1Body)}'`), "guard md5 = Increment 1 body md5");
  assert.ok(flat.indexOf("sales_migration_drift") < flat.indexOf("create or replace function public.sales_ensure_default_pipeline"));
  for (const fragment of ["current_row.prosecdef is distinct from true", "current_row.config is distinct from array['search_path=\"\"']",
    "current_row.owner is distinct from 'postgres'", "current_row.result is distinct from 'jsonb'"]) {
    assert.ok(flat.includes(fragment), fragment);
  }
});
check("only public.sales_ensure_default_pipeline changes; signature, grants and owner re-asserted", () => {
  const flat = strip(fix);
  assert.deepEqual([...flat.matchAll(/create (?:or replace )?(?:function|table|view|index|trigger|policy) ([a-z_.]+)/g)].map((m) => m[1]),
    ["public.sales_ensure_default_pipeline"]);
  assert.ok(!/\b(drop|cascade|alter table|insert into|update |delete from|truncate)\b/.test(flat.replace(/'[^']*'/g, "''").split("create or replace")[0] + flat.split("$$;").pop()));
  assert.ok(!/\bcascade\b/.test(flat));
  assert.ok(flat.includes("create or replace function public.sales_ensure_default_pipeline() returns jsonb language plpgsql volatile security definer set search_path = '' as $$"));
  assert.ok(flat.includes("alter function public.sales_ensure_default_pipeline() owner to postgres;"));
  assert.ok(flat.includes("revoke all on function public.sales_ensure_default_pipeline() from public, anon, authenticated, service_role;"));
  assert.ok(flat.includes("grant execute on function public.sales_ensure_default_pipeline() to authenticated;"));
  assert.equal([...flat.matchAll(/grant /g)].length, 1, "no other grant");
});
check("ASCII only (fix and rollback)", () => {
  for (const text of [fix, rollback]) assert.equal([...text].filter((c) => c.charCodeAt(0) > 127).length, 0);
});
check("migration order: Increment 1, then the fix, then any later Sales increment", () => {
  const files = readdirSync(resolve(root, "supabase/migrations")).filter((f) => f.endsWith(".sql")).sort();
  const sales = files.filter((f) => /sales/.test(f));
  assert.equal(sales[0], INC1_FILE);
  assert.equal(sales[1], FIX_FILE);
  const others = files.filter((f) => !/sales/.test(f));
  assert.ok(others.every((f) => f < INC1_FILE), "no non-Sales migration sorts after Sales");
});
check("rollback restores the Increment 1 body byte-exact behind a guard on the fix fingerprint", () => {
  assert.equal(bodyOf(rollback, "create or replace function public.sales_ensure_default_pipeline()"), inc1Body);
  assert.ok(rollback.includes(`'${md5(fixBody)}'`), "rollback guard = fix body md5");
  assert.ok(rollback.includes(`'${md5(inc1Body)}'`), "rollback postflight = Increment 1 body md5");
  const flat = strip(rollback);
  assert.ok(/^\s*begin;/.test(flat) && /commit;\s*$/.test(flat));
  assert.ok(!/\bcascade\b/.test(flat));
  assert.ok(flat.includes("delete from supabase_migrations.schema_migrations where version = '20261002130000';"));
});
// Working-tree / index gate. Parses `git status --porcelain` v1 lines by their
// exact two-character XY status (X = index, Y = work tree), never by substring:
// * forward-fix files: "??" (untracked, before staging) or "A " (staged-added,
//   work tree identical to the index); anything else (AM, M, D, R, ...) fails;
// * Increment 2 candidate files: "??" only (never staged in the fix commit);
// * docs/sales/ARCHITECTURE.md: " M" only (unstaged; not part of the fix commit);
// * any other path, any rename/copy, any unparseable line: fails.
const INC2_CANDIDATE = /^supabase\/(migrations\/20261003120000_sales_v1_leads_attribution\.sql|tests\/(rollback\/sales_v1_leads_attribution_rollback\.sql|sales_v1_leads\.(expected|suite|integration|postgres|sabotage)\.mjs|validate_sales_v1_leads\.mjs))$/;
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
    } else if (FIX_FILES.includes(path)) {
      if (xy !== "??" && xy !== "A ") violations.push(`forward-fix file must be untracked (??) or staged-added (A ): ${line}`);
    } else if (INC2_CANDIDATE.test(path)) {
      if (xy !== "??") violations.push(`Increment 2 file must stay untracked: ${line}`);
    } else if (path === "docs/sales/ARCHITECTURE.md") {
      if (xy !== " M") violations.push(`Sales doc may only carry unstaged modifications: ${line}`);
    } else {
      violations.push(`unexpected change: ${line}`);
    }
  }
  return violations;
}

if (process.argv.includes("--self-test-status")) {
  const FIX = "supabase/tests/sales_v1_default_pipeline_lock.postgres.mjs";
  const MIG = "supabase/migrations/20261002130000_sales_v1_default_pipeline_lock.sql";
  const cases = [
    ["allowed fix file untracked", [`?? ${FIX}`], true],
    ["same fix file staged-added", [`A  ${FIX}`], true],
    ["all four fix files staged + Inc2 untracked + doc unstaged",
      [...FIX_FILES.map((p) => `A  ${p}`), "?? supabase/migrations/20261003120000_sales_v1_leads_attribution.sql", " M docs/sales/ARCHITECTURE.md"], true],
    ["fix file staged then modified in work tree (AM)", [`AM ${MIG}`], false],
    ["fix file modified (M  / ' M')", [`M  ${MIG}`, ` M ${MIG}`], false],
    ["unexpected staged Increment 2 file", ["A  supabase/migrations/20261003120000_sales_v1_leads_attribution.sql"], false],
    ["unexpected staged unrelated file", ["A  src/app/Sales.jsx"], false],
    ["unexpected modification of a frozen Increment 1 file", [" M supabase/migrations/20261002120000_sales_v1_foundation.sql"], false],
    ["unexpected modification of an unrelated tracked file", [" M src/App.jsx"], false],
    ["deleted fix file (D )", [`D  ${MIG}`], false],
    ["deleted tracked file ( D)", [" D supabase/tests/validate_sales_v1_foundation.mjs"], false],
    ["renamed onto a fix path (R )", [`R  old.sql -> ${MIG}`], false],
    ["Sales doc staged (M ) is outside the fix commit", ["M  docs/sales/ARCHITECTURE.md"], false],
    ["Sales doc unstaged ( M) is tolerated", [" M docs/sales/ARCHITECTURE.md"], true],
    ["path that merely contains an allowed path", [`?? ${FIX}.bak`], false],
    ["unrelated untracked file", ["?? notes.txt"], false],
    ["malformed one-character status", [`A ${FIX}`], false],
  ];
  let bad = 0;
  for (const [label, lines, expected] of cases) {
    const ok = statusViolations(lines).length === 0;
    const pass = ok === expected;
    if (!pass) bad += 1;
    console.log(`${pass ? "PASS" : "FAIL"}  status parser: ${label} -> ${ok ? "accepted" : "rejected"} (expected ${expected ? "accepted" : "rejected"})`);
  }
  console.log(`\nStatus parser self-test: ${cases.length - bad} passed, ${bad} failed`);
  process.exit(bad === 0 ? 0 : 1);
}

check("working tree / index: only the forward-fix files (?? or A ), untracked Increment 2 files and the unstaged Sales doc", () => {
  let output;
  try { output = execFileSync("git", ["status", "--porcelain", "--untracked-files=all"], { cwd: root, encoding: "utf8" }); } catch { return; }
  const violations = statusViolations(output.split("\n").filter(Boolean));
  assert.deepEqual(violations, []);
});

let failed = 0;
for (const [name, ok, message] of results) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `\n      ${message}`}`);
  if (!ok) failed += 1;
}
console.log(`\nStatic (M1 fix): ${results.length - failed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);

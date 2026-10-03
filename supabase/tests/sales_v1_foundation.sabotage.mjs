// Sales V1 Increment 1 - mutation / sabotage runner (real PostgreSQL).
//
// Each mutation removes or weakens one protection in an IN-MEMORY copy of the
// migration (or rollback) and re-runs the full suite. A mutation is "killed"
// when at least one of its target tests fails. Every mutation must be killed.
// The canonical files are hashed before and after to prove they were not
// touched.
//
//   SALES_PG_URL=postgres://postgres@localhost:55432/postgres \
//     npx -y -p pg@8 node supabase/tests/sales_v1_foundation.sabotage.mjs [mutation-id ...]

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  MIGRATION_PATH, ROLLBACK_PATH, postgresDriver, readMigration, readRollback, runSuite, TEST_NAMES,
} from "./sales_v1_foundation.suite.mjs";

const url = process.env.SALES_PG_URL;
if (!url) {
  console.error("BLOCKED: SALES_PG_URL is not set.");
  process.exit(2);
}
const parsed = new URL(url);
if (!["localhost", "127.0.0.1"].includes(parsed.hostname) || (parsed.port || "5432") === "5432") {
  console.error("BLOCKED: use a throwaway local cluster on a non-default port.");
  process.exit(2);
}

const T = {
  catalog: "catalog: inventory, columns, keys, triggers, policies, functions match the hand-written spec",
  authzMatrix: "authz: sales_can matrix (founder/admin only, unknown and null fail closed)",
  grantsExec: "grants: anon and service_role cannot execute RPCs; nobody can call private helpers",
  rls: "rls: organizations never see each other's rows",
  directWrites: "grants: direct table writes are denied for authenticated, anon and service_role",
  crossOrg: "isolation: cross-organization ids are rejected by every RPC without side effects",
  defaultPipeline: "default pipeline: canonical stages, idempotent, one audit row",
  rpcTerminal: "terminal stages: RPC refuses to archive the won stage and the last lost stage",
  dbTerminal: "terminal stages: database enforces invariants even when RPCs are bypassed",
  auditImmutable: "audit: append-only for every role, including the table owner",
  locking: "optimistic locking: expected_version, conflicts, no-ops and validation",
  reorder: "reorder: exact active set, deterministic order, compaction after archive",
  rollback: "rollback: apply, verify, blocked cases, rollback, zero objects, reapply, verify",
  cEnsureInterleaved: "concurrency: interleaved first calls - the second waits and returns the first pipeline",
  cLostRpc: "concurrency: two RPC archives of different lost stages cannot remove both",
  cWriteSkew: "concurrency: write skew on lost stages is impossible even when RPCs are bypassed",
  cWon: "concurrency: at most one active won stage under concurrent owner writes",
  cVersion: "concurrency: concurrent updates with the same expected_version - one wins, one conflicts",
};
for (const name of Object.values(T)) {
  if (!TEST_NAMES.includes(name)) throw new Error(`unknown test name: ${name}`);
}

const policy = (table) => ({
  find: `create policy ${table}_select on public.${table}
for select to authenticated
using (
  organization_id = (select public.current_user_organization_id())
  and (select private.sales_can('read'))
);`,
  replace: `create policy ${table}_select on public.${table}
for select to authenticated
using (
  (select private.sales_can('read'))
);`,
});

const MUTATIONS = [
  { id: "rls-org-predicate-pipelines", what: "RLS organization predicate removed (pipelines)", ...policy("sales_pipelines"), kills: [T.rls] },
  { id: "rls-org-predicate-stages", what: "RLS organization predicate removed (stages)", ...policy("sales_pipeline_stages"), kills: [T.rls] },
  { id: "rls-org-predicate-audit", what: "RLS organization predicate removed (audit log)", ...policy("sales_audit_log"), kills: [T.rls] },
  {
    id: "authenticated-write-revoke",
    what: "authenticated granted ALL instead of SELECT on Sales tables",
    find: "grant select on table public.sales_audit_log, public.sales_pipelines, public.sales_pipeline_stages\n  to authenticated;",
    replace: "grant all on table public.sales_audit_log, public.sales_pipelines, public.sales_pipeline_stages\n  to authenticated;",
    kills: [T.directWrites],
  },
  {
    id: "anon-execute",
    what: "anon granted EXECUTE on an RPC",
    find: "grant execute on function public.sales_ensure_default_pipeline() to authenticated;",
    replace: "grant execute on function public.sales_ensure_default_pipeline() to authenticated, anon;",
    kills: [T.grantsExec],
  },
  {
    id: "won-unique-index",
    what: "partial unique index on the active won stage removed",
    find: "create unique index sales_pipeline_stages_one_active_won_idx\n  on public.sales_pipeline_stages (pipeline_id)\n  where kind = 'won' and status = 'active';",
    replace: "",
    kills: [T.dbTerminal, T.cWon],
  },
  {
    id: "last-lost-rpc-guard",
    what: "RPC last-lost-stage guard removed",
    find: `  if current_stage.kind = 'lost' and (
    select count(*) from public.sales_pipeline_stages as other
    where other.pipeline_id = current_stage.pipeline_id
      and other.status = 'active'
      and other.kind = 'lost'
  ) <= 1 then
    raise exception using errcode = '23514', message = 'SALES_LAST_LOST_STAGE';
  end if;`,
    replace: "",
    kills: [T.rpcTerminal, T.cLostRpc],
  },
  {
    id: "deferred-invariant-trigger",
    what: "commit-time terminal/position invariant trigger on stages removed",
    find: `create constraint trigger sales_pipeline_stages_check_structure
after insert or update on public.sales_pipeline_stages
deferrable initially deferred
for each row execute function private.sales_check_pipeline_structure();`,
    replace: "",
    kills: [T.dbTerminal, T.cWriteSkew],
  },
  {
    id: "invariant-lost-count",
    what: "invariant check weakened: lost stages no longer required",
    find: "  if won_count <> 1 or lost_count < 1 then",
    replace: "  if won_count <> 1 then",
    kills: [T.dbTerminal, T.cWriteSkew],
  },
  {
    id: "structure-bump-trigger",
    what: "per-pipeline serialization (structure_version bump) removed",
    find: `create trigger sales_pipeline_stages_bump_structure
after insert or update of status, position on public.sales_pipeline_stages
for each row execute function private.sales_bump_pipeline_structure();`,
    replace: "",
    kills: [T.cWriteSkew],
  },
  {
    id: "expected-version-check",
    what: "expected_version check removed",
    find: `  if current_stage.version <> p_expected_version then
    raise exception using errcode = 'P0001', message = 'SALES_VERSION_CONFLICT',
      detail = format('expected %s, current %s', p_expected_version, current_stage.version);
  end if;`,
    replace: "",
    kills: [T.locking, T.cVersion],
  },
  {
    id: "audit-row-immutability",
    what: "audit UPDATE/DELETE rejection trigger removed",
    find: "create trigger sales_audit_log_reject_mutation\nbefore update or delete on public.sales_audit_log\nfor each row execute function private.sales_reject_mutation();",
    replace: "",
    kills: [T.auditImmutable],
  },
  {
    id: "audit-truncate-immutability",
    what: "audit TRUNCATE rejection trigger removed",
    find: "create trigger sales_audit_log_reject_truncate\nbefore truncate on public.sales_audit_log\nfor each statement execute function private.sales_reject_mutation();",
    replace: "",
    kills: [T.auditImmutable],
  },
  {
    id: "default-pipeline-unique-index",
    what: "one-default-per-organization unique index removed",
    find: "create unique index sales_pipelines_one_default_idx\n  on public.sales_pipelines (organization_id)\n  where is_default;",
    replace: "",
    kills: [T.defaultPipeline, T.cEnsureInterleaved],
  },
  {
    id: "default-pipeline-race",
    what: "default-pipeline uniqueness removed (index and ON CONFLICT): naive check-then-insert",
    find: "create unique index sales_pipelines_one_default_idx\n  on public.sales_pipelines (organization_id)\n  where is_default;",
    replace: "",
    also: [{ find: "    on conflict (organization_id) where is_default do nothing\n", replace: "" }],
    kills: [T.cEnsureInterleaved],
  },
  {
    id: "sales-can-member",
    what: "sales_can widened to the member role",
    find: "membership.role in ('founder', 'admin')",
    replace: "membership.role in ('founder', 'admin', 'member')",
    kills: [T.authzMatrix],
  },
  {
    id: "sales-can-unknown-action",
    what: "sales_can accepts any non-null action",
    find: "requested_action in ('read', 'manage_pipeline')",
    replace: "requested_action is not null",
    kills: [T.authzMatrix],
  },
  {
    id: "reorder-duplicate-check",
    what: "reorder duplicate-id check removed",
    find: `     or (select count(distinct requested) from unnest(p_stage_ids) as requested)
        <> cardinality(p_stage_ids)
`,
    replace: "",
    kills: [T.reorder],
  },
  {
    id: "reorder-set-check",
    what: "reorder foreign/archived/unknown-id check removed",
    find: `     or exists (
       select requested from unnest(p_stage_ids) as requested
       except
       select existing from unnest(current_ids) as existing
     ) then`,
    replace: "     then",
    kills: [T.reorder, T.crossOrg],
  },
  {
    id: "rpc-org-filter",
    what: "organization filter removed from stage lookups in update/archive",
    find: "  where existing.id = p_stage_id and existing.organization_id = organization;\n  if current_stage.id is null then",
    replace: "  where existing.id = p_stage_id;\n  if current_stage.id is null then",
    all: true,
    kills: [T.crossOrg],
  },
  {
    id: "search-path-removed",
    what: "search_path pin removed from sales_write_audit",
    find: "  p_details jsonb\n)\nreturns void\nlanguage plpgsql\nsecurity definer\nset search_path = ''\n",
    replace: "  p_details jsonb\n)\nreturns void\nlanguage plpgsql\nsecurity definer\n",
    kills: [T.catalog],
  },
  {
    id: "rollback-incomplete",
    target: "rollback",
    what: "rollback script forgets to drop one function",
    find: "drop function private.sales_clean_name(text);\n",
    replace: "",
    kills: [T.rollback],
  },
  {
    id: "rollback-no-data-guard",
    target: "rollback",
    what: "rollback destruction confirmation guard removed",
    find: "  if has_rows and coalesce(current_setting('orvesen.sales_rollback_confirm', true), '')\n                  <> 'DESTROY_SALES_V1_INC1_DATA' then",
    replace: "  if false then",
    kills: [T.rollback],
  },
];

function applyMutation(text, { find, replace, all, also = [] }) {
  const count = text.split(find).length - 1;
  if (count === 0 || (!all && count !== 1)) throw new Error(`mutation anchor found ${count} times`);
  let mutated = text.split(find).join(replace);
  for (const extra of also) mutated = applyMutation(mutated, extra);
  if (mutated === text) throw new Error("mutation produced identical text");
  return mutated;
}

const sha = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");
const canonicalBefore = { migration: sha(MIGRATION_PATH), rollback: sha(ROLLBACK_PATH) };
const canonicalMigration = readMigration().replace(/\r\n/g, "\n");
const canonicalRollback = readRollback().replace(/\r\n/g, "\n");

const selected = process.argv.slice(2);
const mutations = selected.length ? MUTATIONS.filter((mutation) => selected.includes(mutation.id)) : MUTATIONS;

const driver = await postgresDriver(url);
const report = [];
try {
  // Baseline: the canonical files must pass completely.
  const baseline = await runSuite({ driver, migrationSql: canonicalMigration, rollbackSql: canonicalRollback });
  const baselineFailures = baseline.filter((result) => result.status !== "PASS");
  console.log(`baseline: ${baseline.length - baselineFailures.length}/${baseline.length} passed`);
  if (baselineFailures.length) {
    for (const failure of baselineFailures) console.log(`  ${failure.status} ${failure.name}: ${failure.error}`);
    throw new Error("baseline is not green; sabotage results would be meaningless");
  }

  for (const mutation of mutations) {
    let migrationSql = canonicalMigration;
    let rollbackSql = canonicalRollback;
    try {
      if (mutation.target === "rollback") rollbackSql = applyMutation(rollbackSql, mutation);
      else migrationSql = applyMutation(migrationSql, mutation);
    } catch (error) {
      report.push({ id: mutation.id, killed: false, note: `INVALID MUTATION: ${error.message}` });
      console.log(`INVALID  ${mutation.id}: ${error.message}`);
      continue;
    }
    const results = await runSuite({ driver, migrationSql, rollbackSql });
    const failed = results.filter((result) => result.status === "FAIL").map((result) => result.name);
    const killedBy = mutation.kills.filter((name) => failed.includes(name));
    const killed = killedBy.length > 0;
    report.push({ id: mutation.id, killed, killedBy, failedCount: failed.length });
    console.log(`${killed ? "KILLED  " : "SURVIVED"} ${mutation.id} - ${mutation.what}`);
    console.log(`         target tests failed: ${killedBy.length}/${mutation.kills.length}; total failing tests: ${failed.length}`);
    for (const name of killedBy) {
      const detail = results.find((result) => result.name === name).error.split("\n")[0].slice(0, 160);
      console.log(`         - ${name}\n           ${detail}`);
    }
  }
} finally {
  await driver.close();
}

const canonicalAfter = { migration: sha(MIGRATION_PATH), rollback: sha(ROLLBACK_PATH) };
const untouched = canonicalAfter.migration === canonicalBefore.migration && canonicalAfter.rollback === canonicalBefore.rollback;
console.log(`\ncanonical migration sha256 ${canonicalAfter.migration} (${untouched ? "unchanged" : "CHANGED"})`);
const survivors = report.filter((item) => !item.killed);
console.log(`Sabotage: ${report.length - survivors.length}/${report.length} mutations killed`);
process.exit(survivors.length === 0 && untouched && report.length === mutations.length ? 0 : 1);

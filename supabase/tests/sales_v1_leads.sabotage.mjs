// Sales V1 Increment 2 - mutation / sabotage runner (real PostgreSQL).
//
// Each mutation removes or weakens one protection in an IN-MEMORY copy of the
// Increment 2 migration (or rollback). For each mutation the runner:
//   1. runs the discriminator tests on the mutated copy: they must go RED with
//      an error matching the intended reason;
//   2. runs the same discriminator tests on the canonical bytes: they must be GREEN;
//   3. verifies the canonical files on disk are byte-identical (sha256).
//
//   SALES_PG_URL=postgres://postgres@localhost:55432/postgres \
//     npx -y -p pg@8 node supabase/tests/sales_v1_leads.sabotage.mjs [mutation-id ...]

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { postgresDriver } from "./sales_v1_foundation.suite.mjs";
import { MIGRATION_PATH, ROLLBACK_PATH, readMigration, readRollback, runSuite, TEST_NAMES } from "./sales_v1_leads.suite.mjs";

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
  authz: "authz: sales_can matrix including manage_leads",
  guard: "migration guard: drifted sales_can or audit CHECKs abort the whole Increment 2 migration",
  isolationRead: "isolation: organizations never see each other's leads, touches or attribution",
  isolationIds: "isolation: cross-organization lead ids behave exactly like missing ids",
  grants: "grants: direct writes on leads, touches and the view are denied for every API role",
  backstop: "identity: database uniqueness backstop for active email and external key",
  idempotency: "idempotency: exact replay returns the original; a different payload conflicts; nothing is duplicated",
  appendOnly: "attribution: touches are append-only for every role, including the owner",
  cap: "attribution: 1000-touch cap per lead (RPC and database)",
  dbLifecycle: "lifecycle: the database rejects invalid transitions and identity changes even for the owner",
  auditImmutable: "audit: still append-only after the CHECK widening, and lead actions bind to lead entity types",
  rollbackExact: "rollback: unused Inc2 rolls back to the exact Inc1 state, Inc1 rollback then works, and Inc2 reapplies",
  rollbackBlocked: "rollback: blocked once Increment 2 has real data, and when an unknown Sales object exists",
};
for (const name of Object.values(T)) if (!TEST_NAMES.includes(name)) throw new Error(`unknown test: ${name}`);

const SUCCEEDED = /but call succeeded/;
const MUTATIONS = [
  {
    id: "active-email-uniqueness-removed",
    find: "create unique index sales_leads_active_email_idx\n  on public.sales_leads (organization_id, email_normalized)\n  where email_normalized is not null and status <> 'archived';",
    replace: "",
    kills: [[T.backstop, /expected error sales_leads_active_email_idx, but call succeeded/]],
  },
  {
    id: "touch-immutability-removed",
    find: "  if tg_op <> 'INSERT' then\n    raise exception using errcode = '55000', message = 'SALES_IMMUTABLE',\n      detail = 'Attribution touches are append-only evidence';\n  end if;\n",
    replace: "  if tg_op <> 'INSERT' then\n    return coalesce(new, old);\n  end if;\n",
    kills: [[T.appendOnly, /expected error SALES_IMMUTABLE, but call succeeded/]],
  },
  {
    id: "rls-org-predicate-removed-leads",
    find: "create policy sales_leads_select on public.sales_leads\nfor select to authenticated\nusing (\n  organization_id = (select public.current_user_organization_id())\n  and (select private.sales_can('read'))\n);",
    replace: "create policy sales_leads_select on public.sales_leads\nfor select to authenticated\nusing (\n  (select private.sales_can('read'))\n);",
    kills: [[T.isolationRead, /strictly deep-equal/]],
  },
  {
    id: "rls-org-predicate-removed-touches",
    find: "create policy sales_lead_touches_select on public.sales_lead_touches\nfor select to authenticated\nusing (\n  organization_id = (select public.current_user_organization_id())\n  and (select private.sales_can('read'))\n);",
    replace: "create policy sales_lead_touches_select on public.sales_lead_touches\nfor select to authenticated\nusing (\n  (select private.sales_can('read'))\n);",
    kills: [[T.isolationRead, /strictly deep-equal/]],
  },
  {
    id: "view-security-invoker-removed",
    find: "create view public.sales_lead_attribution\nwith (security_invoker = true)\nas",
    replace: "create view public.sales_lead_attribution\nas",
    kills: [[T.isolationRead, /strictly deep-equal/]],
  },
  {
    id: "rpc-org-filter-removed",
    find: "  where lead.id = p_lead_id and lead.organization_id = p_organization_id\n  for update;",
    replace: "  where lead.id = p_lead_id\n  for update;",
    kills: [[T.isolationIds, /expected error SALES_NOT_FOUND, but call succeeded/]],
  },
  {
    id: "idempotency-hash-check-removed",
    find: "  if v_id is not null and v_hash is distinct from p_request_hash then\n    raise exception using errcode = '23505', message = 'SALES_IDEMPOTENCY_CONFLICT';\n  end if;\n",
    replace: "",
    kills: [[T.idempotency, /expected error SALES_IDEMPOTENCY_CONFLICT, but call succeeded/]],
  },
  {
    id: "lifecycle-guard-removed",
    find: "  if new.status is distinct from old.status and not (\n       (old.status = 'new' and new.status in ('qualified', 'disqualified', 'archived'))\n    or (old.status = 'qualified' and new.status in ('disqualified', 'archived'))\n    or (old.status = 'disqualified' and new.status in ('qualified', 'archived'))\n  ) then",
    replace: "  if false then",
    kills: [[T.dbLifecycle, /expected error SALES_INVALID_TRANSITION, but call succeeded/]],
  },
  {
    id: "audit-immutability-weakened",
    find: "-- ---------------------------------------------------------------------------\n-- Pure helpers",
    replace: "drop trigger sales_audit_log_reject_mutation on public.sales_audit_log;\n\n-- ---------------------------------------------------------------------------\n-- Pure helpers",
    kills: [[T.auditImmutable, /expected error SALES_IMMUTABLE, but call succeeded/]],
  },
  {
    id: "direct-dml-granted",
    find: "grant select on table public.sales_leads, public.sales_lead_touches, public.sales_lead_attribution\n  to authenticated;",
    replace: "grant all on table public.sales_leads, public.sales_lead_touches, public.sales_lead_attribution\n  to authenticated;",
    kills: [[T.grants, /expected error .*permission denied.*(got: new row violates|but call succeeded)/]],
  },
  {
    id: "manage-leads-widened-to-member",
    find: "        and membership.role in ('founder', 'admin')\n    ),\n    false\n  );\n$$;\n\n-- ---------------------------------------------------------------------------\n-- D2",
    replace: "        and membership.role in ('founder', 'admin', 'member')\n    ),\n    false\n  );\n$$;\n\n-- ---------------------------------------------------------------------------\n-- D2",
    kills: [[T.authz, /member manage_leads|member read|member manage_pipeline/]],
  },
  {
    id: "migration-guard-fingerprint-removed",
    find: "  if can_row.body_md5 is distinct from '2f61c4f2f9c52c0ab2e7a19495652a33'\n     or can_row.prosecdef",
    replace: "  if can_row.prosecdef",
    kills: [[T.guard, /expected error SALES_MIGRATION_DRIFT, but call succeeded/]],
  },
  {
    id: "touch-cap-check-removed",
    find: "touch_count integer not null default 0 check (touch_count between 0 and 1000),",
    replace: "touch_count integer not null default 0 check (touch_count >= 0),",
    kills: [[T.cap, /expected error sales_leads_touch_count_check, but call succeeded/]],
  },
  {
    id: "rollback-forgets-a-function",
    target: "rollback",
    find: "drop function private.sales_request_hash(jsonb);\n",
    replace: "",
    kills: [[T.rollbackExact, /SALES_ROLLBACK_INCOMPLETE/]],
  },
  {
    id: "rollback-usage-guard-removed",
    target: "rollback",
    find: "  if used then\n",
    replace: "  if false then\n",
    kills: [[T.rollbackBlocked, /expected error SALES_ROLLBACK_BLOCKED, but call succeeded/]],
  },
];

function applyMutation(text, { find, replace }) {
  const count = text.split(find).length - 1;
  if (count !== 1) throw new Error(`anchor found ${count} times`);
  // Literal replacement: String.replace would interpret "$$" in SQL as "$".
  const mutated = text.split(find).join(replace);
  if (mutated === text) throw new Error("mutation produced identical text");
  return mutated;
}

const sha = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");
const canonicalHashes = () => ({ migration: sha(MIGRATION_PATH), rollback: sha(ROLLBACK_PATH) });
const startHashes = canonicalHashes();
const canonicalMigration = readMigration().replace(/\r\n/g, "\n");
const canonicalRollback = readRollback().replace(/\r\n/g, "\n");

const selected = process.argv.slice(2);
const mutations = selected.length ? MUTATIONS.filter((m) => selected.includes(m.id)) : MUTATIONS;
const driver = await postgresDriver(url);
const report = [];
try {
  const baseline = await runSuite({ driver, migrationSql: canonicalMigration, rollbackSql: canonicalRollback });
  const baselineBad = baseline.filter((r) => r.status !== "PASS");
  console.log(`baseline: ${baseline.length - baselineBad.length}/${baseline.length} passed`);
  if (baselineBad.length) throw new Error(`baseline not green: ${baselineBad.map((r) => r.name).join("; ")}`);

  for (const mutation of mutations) {
    const entry = { id: mutation.id, red: false, reason: false, green: false, bytes: false };
    let migrationSql = canonicalMigration;
    let rollbackSql = canonicalRollback;
    try {
      if (mutation.target === "rollback") rollbackSql = applyMutation(rollbackSql, mutation);
      else migrationSql = applyMutation(migrationSql, mutation);
    } catch (error) {
      console.log(`INVALID  ${mutation.id}: ${error.message}`);
      report.push(entry);
      continue;
    }
    const only = mutation.kills.map(([name]) => name);
    const mutated = await runSuite({ driver, migrationSql, rollbackSql, only });
    const outcomes = mutation.kills.map(([name, reason]) => {
      const result = mutated.find((r) => r.name === name);
      return { name, red: result?.status === "FAIL", reason: result?.status === "FAIL" && reason.test(result.error || ""), error: result?.error };
    });
    entry.red = outcomes.every((o) => o.red);
    entry.reason = outcomes.every((o) => o.reason);
    const green = await runSuite({ driver, migrationSql: canonicalMigration, rollbackSql: canonicalRollback, only });
    entry.green = green.length === only.length && green.every((r) => r.status === "PASS");
    const now = canonicalHashes();
    entry.bytes = now.migration === startHashes.migration && now.rollback === startHashes.rollback;
    report.push(entry);
    const killed = entry.red && entry.reason && entry.green && entry.bytes;
    console.log(`${killed ? "KILLED  " : "SURVIVED"} ${mutation.id}  red=${entry.red} intended_reason=${entry.reason} green_after=${entry.green} canonical_bytes=${entry.bytes}`);
    for (const outcome of outcomes) {
      console.log(`         - ${outcome.name}\n           ${(outcome.error || "(passed)").split("\n")[0].slice(0, 170)}`);
    }
  }
} finally {
  await driver.close();
}
const endHashes = canonicalHashes();
const untouched = endHashes.migration === startHashes.migration && endHashes.rollback === startHashes.rollback;
const killed = report.filter((e) => e.red && e.reason && e.green && e.bytes).length;
console.log(`\ncanonical migration sha256 ${endHashes.migration} (${untouched ? "unchanged" : "CHANGED"})`);
console.log(`Sabotage (Inc2): ${killed}/${report.length} mutations killed`);
process.exit(killed === mutations.length && untouched ? 0 : 1);

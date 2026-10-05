// Sales V1 forward fix M1 - real PostgreSQL regression for the first-creation
// race in public.sales_ensure_default_pipeline.
//
//   SALES_PG_URL=postgres://postgres@localhost:55432/postgres \
//     npx -y -p pg@8 node supabase/tests/sales_v1_default_pipeline_lock.postgres.mjs [rounds]
//
// Proves on a throwaway PostgreSQL 17 cluster:
// * guard: the fix applies only over the exact Increment 1 definition;
// * race: R rounds x 8 simultaneous first calls -> zero 23505, zero deadlocks,
//   one default pipeline, one logical pipeline for every caller, 6 stages,
//   one audit row, bounded latency (no starvation);
// * the first-creation path really holds the per-organization advisory lock;
// * the frozen Increment 1 suite passes completely on Increment 1 + fix;
// * rollback restores the Increment 1 body byte-exact, then the fix reapplies;
// * sabotage: with the lock removed (in memory), the same race goes RED.

import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DATABASE_SQL, postgresDriver, runSuite as runInc1Suite } from "./sales_v1_foundation.suite.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const INC1_PATH = resolve(here, "../migrations/20261002120000_sales_v1_foundation.sql");
const FIX_PATH = resolve(here, "../migrations/20261002130000_sales_v1_default_pipeline_lock.sql");
const ROLLBACK_PATH = resolve(here, "rollback/sales_v1_default_pipeline_lock_rollback.sql");
const INC1_BODY_MD5 = "12c3ea7d7a2c4f27dc67baab17104058";
const FIX_BODY_MD5 = "71eabecb4cade2f2dd3ff651e8b18199";
const LOCK_BLOCK = "\n  if pipeline.id is null then\n    -- M1: serialize first creation per organization, then re-check under the lock.\n    perform pg_advisory_xact_lock(hashtextextended('orvesen.sales.pipelines:' || organization::text, 0));\n    select * into pipeline\n    from public.sales_pipelines as existing\n    where existing.organization_id = organization and existing.is_default;\n  end if;\n";

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
const ROUNDS = Math.max(20, Number(process.argv[2] || 25));
const lf = (text) => text.replace(/\r\n/g, "\n");
const sha = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");
const inc1Sql = lf(readFileSync(INC1_PATH, "utf8"));
const fixSql = lf(readFileSync(FIX_PATH, "utf8"));
const rollbackSql = lf(readFileSync(ROLLBACK_PATH, "utf8"));
const startHashes = { fix: sha(FIX_PATH), rollback: sha(ROLLBACK_PATH) };

const driver = await postgresDriver(url);
const results = [];
const record = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `\n      ${detail}` : ""}`);
};

async function freshDatabase({ fix = true, sql = fixSql } = {}) {
  const db = await driver.newDatabase();
  const s = await db.session();
  await s.exec(DATABASE_SQL);
  await s.exec(`begin;\n${inc1Sql}\ncommit;`);
  if (fix) await s.exec(`begin;\n${sql}\ncommit;`);
  return { db, s };
}
async function apply(s, sql) {
  try {
    await s.exec(`begin;\n${sql}\ncommit;`);
  } catch (error) {
    await s.exec("rollback").catch(() => {});
    throw error;
  }
}
const bodyMd5 = async (s) => (await s.query(
  "select md5(replace(prosrc, chr(13), '')) as m from pg_proc where oid = 'public.sales_ensure_default_pipeline()'::regprocedure"))[0].m;
async function tenant(s) {
  const t = { org: randomUUID(), founder: randomUUID(), admin: randomUUID() };
  await s.exec(`insert into auth.users(id) values ('${t.founder}'), ('${t.admin}');
    insert into public.organizations(id, name) values ('${t.org}', 'Race ${t.org.slice(0, 8)}');
    insert into public.organization_memberships(user_id, organization_id, role) values ('${t.founder}', '${t.org}', 'founder'), ('${t.admin}', '${t.org}', 'admin');
    insert into public.user_active_organizations(user_id, organization_id) values ('${t.founder}', '${t.org}'), ('${t.admin}', '${t.org}');`);
  return t;
}
const withTimeout = (promise, ms) => Promise.race([
  promise, new Promise((_, reject) => setTimeout(() => reject(new Error(`TIMEOUT after ${ms} ms`)), ms))]);

// One round: 8 sessions call ensure for a fresh organization at the same moment.
async function raceRound(db, s, sessions) {
  const t = await tenant(s);
  await Promise.all(sessions.map((x, i) => x.exec(
    `select set_config('request.jwt.claim.sub', '${i % 2 ? t.admin : t.founder}', false); set role authenticated;`)));
  const started = Date.now();
  const outcomes = await Promise.all(sessions.map((x) => withTimeout(
    x.query("select public.sales_ensure_default_pipeline() as r").then((rows) => ({ ok: true, value: rows[0].r, ms: Date.now() - started })),
    15000).catch((error) => ({ ok: false, error, ms: Date.now() - started }))));
  await Promise.all(sessions.map((x) => x.exec("reset role").catch(() => {})));
  const stats = (await s.query(`select
      (select count(*)::int from public.sales_pipelines where organization_id = $1 and is_default) as defaults,
      (select count(*)::int from public.sales_pipelines where organization_id = $1) as pipelines,
      (select count(*)::int from public.sales_pipeline_stages where organization_id = $1) as stages,
      (select count(*)::int from public.sales_audit_log where organization_id = $1 and action = 'sales.pipeline.created') as audits`, [t.org]))[0];
  return {
    errors: outcomes.filter((o) => !o.ok).map((o) => `${o.error.code || ""} ${o.error.message}`),
    raw23505: outcomes.filter((o) => !o.ok && o.error.code === "23505").length,
    deadlocks: outcomes.filter((o) => !o.ok && o.error.code === "40P01").length,
    timeouts: outcomes.filter((o) => !o.ok && /TIMEOUT/.test(o.error.message)).length,
    ids: new Set(outcomes.filter((o) => o.ok).map((o) => o.value.pipeline.id)),
    created: outcomes.filter((o) => o.ok && o.value.was_created).length,
    maxMs: Math.max(...outcomes.map((o) => o.ms)),
    stats,
  };
}

async function race(sql, rounds, { stopOnFailure = false } = {}) {
  const { db, s } = await freshDatabase({ sql });
  const sessions = await Promise.all(Array.from({ length: 8 }, () => db.session()));
  const summary = { rounds: 0, raw23505: 0, deadlocks: 0, timeouts: 0, otherErrors: [], badRounds: 0, maxMs: 0 };
  for (let round = 0; round < rounds; round += 1) {
    const r = await raceRound(db, s, sessions);
    summary.rounds += 1;
    summary.raw23505 += r.raw23505;
    summary.deadlocks += r.deadlocks;
    summary.timeouts += r.timeouts;
    summary.maxMs = Math.max(summary.maxMs, r.maxMs);
    summary.otherErrors.push(...r.errors.filter((e) => !/^(23505|40P01) /.test(e) && !/TIMEOUT/.test(e)));
    const good = r.errors.length === 0 && r.ids.size === 1 && r.created === 1
      && r.stats.defaults === 1 && r.stats.pipelines === 1 && r.stats.stages === 6 && r.stats.audits === 1;
    if (!good) summary.badRounds += 1;
    if (!good && stopOnFailure) break;
  }
  await db.drop();
  return summary;
}

try {
  // 1. Guard.
  {
    const { db, s } = await freshDatabase({ fix: false });
    assert.equal(await bodyMd5(s), INC1_BODY_MD5, "Increment 1 body fingerprint");
    await s.exec(`create or replace function public.sales_ensure_default_pipeline() returns jsonb language plpgsql volatile security definer set search_path = '' as $$ begin return '{}'::jsonb; end $$;`);
    let error = null;
    try { await apply(s, fixSql); } catch (e) { error = e; }
    record("guard: drifted definition aborts the fix (SALES_MIGRATION_DRIFT), function left untouched",
      error?.message === "SALES_MIGRATION_DRIFT" && (await bodyMd5(s)) === md5(" begin return '{}'::jsonb; end "));
    await apply(s, `create or replace function public.sales_ensure_default_pipeline() returns jsonb language plpgsql volatile security definer set search_path = '' as $$${bodyOf(inc1Sql)}$$;`);
    await apply(s, fixSql);
    const fixed = await bodyMd5(s);
    const fn = (await s.query(`select prosecdef, proconfig, pg_get_userbyid(proowner)::text as owner, pg_get_function_result(oid) as result,
        has_function_privilege('authenticated', oid, 'EXECUTE') as auth, has_function_privilege('anon', oid, 'EXECUTE') as anon,
        has_function_privilege('service_role', oid, 'EXECUTE') as service,
        (proacl is null or exists (select 1 from aclexplode(proacl) a where a.grantee = 0)) as public_exec
      from pg_proc where oid = 'public.sales_ensure_default_pipeline()'::regprocedure`))[0];
    record("guard: exact Increment 1 definition is replaced by the fix; signature, owner, search_path and grants unchanged",
      fixed === FIX_BODY_MD5 && fn.prosecdef && fn.proconfig.join() === 'search_path=""' && fn.owner === "postgres"
      && fn.result === "jsonb" && fn.auth && !fn.anon && !fn.service && !fn.public_exec, JSON.stringify(fn));
    error = null;
    try { await apply(s, fixSql); } catch (e) { error = e; }
    record("guard: re-applying the fix fails closed", error?.message === "SALES_MIGRATION_DRIFT");
    await db.drop();
  }

  // 2. Lock usage: the first-creation path holds the per-organization advisory lock; the fast path does not.
  {
    const { db, s } = await freshDatabase();
    const t = await tenant(s);
    const one = await db.session();
    await one.exec(`select set_config('request.jwt.claim.sub', '${t.founder}', false)`);
    await one.exec("begin; set local role authenticated;");
    await one.query("select public.sales_ensure_default_pipeline()");
    const locksCreate = Number((await s.query("select count(*) from pg_locks where locktype = 'advisory' and pid = $1 and granted", [one.pid]))[0].count);
    await one.exec("commit");
    await one.exec("begin; set local role authenticated;");
    await one.query("select public.sales_ensure_default_pipeline()");
    const locksFast = Number((await s.query("select count(*) from pg_locks where locktype = 'advisory' and pid = $1", [one.pid]))[0].count);
    await one.exec("commit");
    record("lock: first creation holds exactly one advisory lock; the fast path takes none", locksCreate === 1 && locksFast === 0,
      `create=${locksCreate} fast=${locksFast}`);
    await db.drop();
  }

  // 3. Race regression.
  {
    const summary = await race(fixSql, ROUNDS);
    record(`race: ${summary.rounds} rounds x 8 simultaneous first calls`,
      summary.raw23505 === 0 && summary.deadlocks === 0 && summary.timeouts === 0 && summary.otherErrors.length === 0 && summary.badRounds === 0,
      `raw23505=${summary.raw23505} deadlocks=${summary.deadlocks} timeouts=${summary.timeouts} other=${summary.otherErrors.length} bad_rounds=${summary.badRounds} max_latency_ms=${summary.maxMs}`);
    results.raceSummary = summary;
  }

  // 4. Frozen Increment 1 suite on Increment 1 + fix (run 3 times; the race test is now stable).
  {
    let failures = [];
    for (let run = 0; run < 3; run += 1) {
      const inc1 = await runInc1Suite({ driver, migrationSql: `${inc1Sql}\n;\n${fixSql}` });
      failures = failures.concat(inc1.filter((r) => r.status !== "PASS").map((r) => `${run}: ${r.name}: ${r.error}`));
    }
    record("Increment 1 frozen suite on Increment 1 + fix: 3 x 31/31", failures.length === 0, failures.join(" || ").slice(0, 400));
  }

  // 5. Rollback and reapply.
  {
    const { db, s } = await freshDatabase();
    await s.exec("insert into supabase_migrations.schema_migrations(version, name) values ('20261002120000', 'sales_v1_foundation'), ('20261002130000', 'sales_v1_default_pipeline_lock')");
    await s.exec(rollbackSql);
    const restored = await bodyMd5(s);
    const history = Number((await s.query("select count(*) from supabase_migrations.schema_migrations where version = '20261002130000'"))[0].count);
    let blocked = null;
    try { await s.exec(rollbackSql); } catch (e) { blocked = e; await s.exec("rollback").catch(() => {}); }
    await apply(s, fixSql);
    record("rollback: restores the Increment 1 body byte-exact, removes the history row, refuses a second run; the fix reapplies",
      restored === INC1_BODY_MD5 && history === 0 && blocked?.message === "SALES_ROLLBACK_BLOCKED" && (await bodyMd5(s)) === FIX_BODY_MD5);
    await db.drop();
  }

  // 6. Sabotage: the same race without the lock (in-memory mutation) must go RED.
  {
    assert.equal(fixSql.split(LOCK_BLOCK).length - 1, 1, "lock block anchor");
    const sabotaged = fixSql.split(LOCK_BLOCK).join("\n");
    const summary = await race(sabotaged, 80, { stopOnFailure: true });
    const red = summary.badRounds > 0 && summary.raw23505 > 0;
    record("sabotage: lock removed -> race goes RED (raw 23505 observed)", red,
      `rounds_until_red=${summary.rounds} raw23505=${summary.raw23505}`);
    const green = await race(fixSql, 5);
    record("sabotage: canonical fix back to GREEN (5 rounds)", green.badRounds === 0 && green.raw23505 === 0);
  }
} finally {
  await driver.close();
}

const endHashes = { fix: sha(FIX_PATH), rollback: sha(ROLLBACK_PATH) };
record("canonical fix and rollback bytes unchanged by the run", JSON.stringify(endHashes) === JSON.stringify(startHashes), endHashes.fix);
const failed = results.filter((r) => !r.ok).length;
console.log(`\nM1 fix (real PostgreSQL): ${results.length - failed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);

function md5(text) {
  return createHash("md5").update(text).digest("hex");
}
function bodyOf(text) {
  const at = text.indexOf("create function public.sales_ensure_default_pipeline()");
  const open = text.indexOf("as $$", at) + 5;
  return text.slice(open, text.indexOf("$$;", open));
}

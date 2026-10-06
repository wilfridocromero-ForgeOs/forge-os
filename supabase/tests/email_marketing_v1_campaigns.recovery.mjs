// Email Marketing V1 - Increment 3c: Staging recovery rehearsal (PGlite).
//
//   Inc1-3a -> snapshot -> apply Inc3c -> run the recovery artifact
//   -> every Inc1-3a object is restored exactly; Inc3c re-applies cleanly.
//
// Run: npx -y -p @electric-sql/pglite node --test supabase/tests/email_marketing_v1_campaigns.recovery.mjs
//
// The pre-check, sequence-token and single-destructive-statement design is the
// hardened Increment 3a recovery design; the helpers below are copied from its
// suite (a node:test file cannot be imported without running its tests).

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  A_FOUNDER, EXPECTED_INC1_FP_AFTER_INC3A, INC1_NAMES, INC2_NAMES, MIGRATIONS, ORG_A, RECOVERY_INC3A, STAGING_INC2_FP,
  createDatabase, readSql, snapshots,
} from "./email_marketing_v1_harness.mjs";
import { RECOVERY_BASELINE, baselineVersions } from "./email_marketing_v1_recovery_baseline.mjs";

const path = (relative) => fileURLToPath(new URL(relative, import.meta.url));
const migrationSql = readSql(path("../migrations/20261005160000_email_marketing_v1_campaigns.sql"));
const recoverySql = readSql(path("../recovery/20261005160000_email_marketing_v1_campaigns.down.sql"));
const recovery3aSql = readSql(RECOVERY_INC3A);
const TOKEN = "orvesen.email_inc3c_recovery";
const GUARD_REFUSAL = "EMAIL_RECOVERY_REFUSED_INCOMPLETE_PRECONDITIONS";

async function inc3aDatabase() {
  const db = await createDatabase();
  for (const p of [MIGRATIONS.inc1, MIGRATIONS.inc2, MIGRATIONS.inc3a]) await db.exec(readSql(p));
  return db;
}
async function inc3cDatabase() {
  const db = await inc3aDatabase();
  await db.exec(migrationSql);
  return db;
}
async function withSupabaseHistory(db, versions) {
  await db.exec(`create schema supabase_migrations;
    create table supabase_migrations.schema_migrations (version text primary key, statements text[], name text);`);
  for (const version of versions) {
    await db.query("insert into supabase_migrations.schema_migrations (version, name) values ($1, $2)", [version, `m${version}`]);
  }
}
const HISTORY = ["20260926160000", "20260927120000", "20261004150000", "20261005160000"];
async function fullSnapshot(db) {
  const s = snapshots(db);
  return {
    inc1Fp: await s.fp(INC1_NAMES), inc2Fp: await s.fp(INC2_NAMES), functions: await s.functions(), policies: await s.policies(),
    tableAcl: await s.tableAcl(), tables: await s.tables(), constraints: await s.constraints(), triggers: await s.triggers(), indexes: await s.indexes(),
  };
}
async function dataState(db) {
  const n = async (sql) => (await db.query(sql)).rows[0].n;
  const exists = (await db.query("select to_regclass('public.email_campaigns') is not null as e")).rows[0].e;
  return {
    campaigns: exists ? await n("select count(*)::int as n from public.email_campaigns") : "dropped",
    auditRows: await n("select count(*)::int as n from public.email_audit_log"),
    auditCheck: (await db.query("select pg_get_constraintdef(oid) as d from pg_constraint where conname = 'email_audit_log_entity_type_check'")).rows[0].d,
    history: (await db.query("select version from supabase_migrations.schema_migrations order by 1")).rows.map((r) => r.version),
  };
}
async function refuses(db, sql, message, label) {
  await assert.rejects(db.exec(sql), (error) => {
    assert.equal(error.message, message, label);
    return true;
  });
  await db.exec("rollback");
}

// --- helpers copied from the Increment 3a recovery suite ---------------------
const THIS_SESSION = "pg_catalog.pg_backend_pid()";
const PRECHECK_START = "-- Concurrent schema-activity check (";
function precheckBlocks(sql) {
  const blocks = [];
  let from = 0;
  for (;;) {
    const start = sql.indexOf(PRECHECK_START, from);
    if (start < 0) break;
    const end = sql.indexOf("end;\n$$;", start) + "end;\n$$;".length;
    blocks.push({ start, end, text: sql.slice(start, end) });
    from = end;
  }
  return blocks;
}
function selfAsForeign(sql, which) {
  const blocks = precheckBlocks(sql);
  assert.equal(blocks.length, 2, "two pre-check blocks");
  const block = blocks[which === "before locks" ? 0 : 1];
  assert.equal(block.text.split(THIS_SESSION).length - 1, 4);
  return sql.slice(0, block.start) + block.text.split(THIS_SESSION).join("-1") + sql.slice(block.end);
}
function topLevelStatements(sql) {
  const statements = [];
  let start = 0;
  let i = 0;
  const push = (text) => {
    const code = text.replace(/--[^\n]*/g, "").trim();
    if (code) statements.push({ text, code: code.toLowerCase() });
  };
  while (i < sql.length) {
    if (sql.startsWith("--", i)) {
      const nl = sql.indexOf("\n", i);
      i = nl < 0 ? sql.length : nl + 1;
      continue;
    }
    if (sql[i] === "'") {
      i += 1;
      while (i < sql.length && !(sql[i] === "'" && sql[i + 1] !== "'")) i += sql[i] === "'" ? 2 : 1;
      i += 1;
      continue;
    }
    const tag = /^\$[A-Za-z_]*\$/.exec(sql.slice(i, i + 40));
    if (tag) {
      const close = sql.indexOf(tag[0], i + tag[0].length);
      assert.ok(close > 0, `unterminated ${tag[0]}`);
      i = close + tag[0].length;
      continue;
    }
    if (sql[i] === ";") {
      push(sql.slice(start, i + 1));
      start = i + 1;
    }
    i += 1;
  }
  push(sql.slice(start));
  return statements;
}
async function runContinuing(db, sql, { transaction = true } = {}) {
  const errors = [];
  for (const statement of topLevelStatements(sql)) {
    if (statement.code === "begin;" || statement.code === "commit;") {
      if (transaction) await db.exec(statement.text);
      continue;
    }
    if (!transaction) {
      try { await db.exec(statement.text); } catch (error) { errors.push(error.message); }
      continue;
    }
    await db.exec("savepoint zz_on_error_rollback");
    try {
      await db.exec(statement.text);
      await db.exec("release savepoint zz_on_error_rollback");
    } catch (error) {
      errors.push(error.message);
      await db.exec("rollback to savepoint zz_on_error_rollback");
    }
  }
  return errors;
}
function replaceOnce(sql, from, to) {
  assert.equal(sql.split(from).length - 1, 1, `anchor occurs once: ${from.slice(0, 60)}`);
  return sql.split(from).join(to);
}

// --- static ---------------------------------------------------------------------

test("static: one transaction, ASCII, no CASCADE, drops exactly what the migration creates, refusals documented", () => {
  assert.ok([...Buffer.from(recoverySql, "utf8")].every((byte) => byte < 128), "ASCII only");
  const code = recoverySql.toLowerCase().replace(/--[^\n]*/g, "");
  assert.ok(code.trimStart().startsWith("begin;") && code.trimEnd().endsWith("commit;"));
  assert.ok(!/\bcascade\b/.test(code) && !/drop (table|function) if exists/.test(code));
  const migration = migrationSql.toLowerCase().replace(/--[^\n]*/g, "");
  const created = [...migration.matchAll(/alter function ([a-z_.]+\([^)]*\)) owner to postgres;/g)].map((m) => m[1].replace(/\s+/g, "")).sort();
  const dropped = [...code.matchAll(/drop function ([a-z_.]+\([^)]*\));/g)].map((m) => m[1].replace(/\s+/g, "")).sort();
  assert.deepEqual(dropped, created, "every Increment 3c function is dropped, nothing else");
  assert.deepEqual([...code.matchAll(/drop table (public\.[a-z_]+);/g)].map((m) => m[1]), ["public.email_campaigns"]);
  assert.ok(code.includes("delete from supabase_migrations.schema_migrations where version = '20261005160000'"));
  assert.ok(!code.includes("private.email_can(") || !/create or replace function private\.email_can/.test(code), "email_can is never redefined");
  const raised = [...new Set([...code.matchAll(/message = '(email_recovery_[a-z_]+)'/g)].map((m) => m[1]))].sort();
  const documented = [...new Set([...recoverySql.toLowerCase().matchAll(/^-- \* (email_recovery_[a-z_]+)/gm)].map((m) => m[1]))].sort();
  assert.deepEqual(documented, raised, "header documents exactly the refusal reasons");
  assert.deepEqual(raised, ["email_recovery_refused_concurrent_activity", "email_recovery_refused_data_present",
    "email_recovery_refused_incomplete_preconditions", "email_recovery_refused_later_migration",
    "email_recovery_refused_unexpected_state", "email_recovery_refused_unknown_migration"]);
});

test("static: the pre-checks are byte for byte the hardened Increment 3a pre-check (only the token name differs)", () => {
  const ours = precheckBlocks(recoverySql);
  const theirs = precheckBlocks(recovery3aSql);
  assert.equal(ours.length, 2);
  for (const index of [0, 1]) {
    assert.equal(ours[index].text, theirs[index].text.split("orvesen.email_inc3a_recovery").join(TOKEN), `pre-check ${index + 1}`);
  }
  for (const signal of ["pg_stat_clear_snapshot()", "'<insufficient privilege>'", "'autovacuum worker'", "pg_prepared_xacts"]) {
    assert.ok(ours[0].text.includes(signal), signal);
  }
});

test("static: lock order with ACCESS EXCLUSIVE on email_audit_log up front; sequence token; one guarded destructive statement", () => {
  const statements = topLevelStatements(recoverySql);
  const kinds = statements.map(({ code }) => {
    if (code === "begin;" || code === "commit;") return code;
    if (code.startsWith("set local ")) return "set local";
    if (code.startsWith("lock table ")) return code.replace(/\s+/g, " ");
    if (code.startsWith("do $recovery$")) return "destructive";
    if (code.startsWith("do $$")) return "do";
    return `UNEXPECTED: ${code.slice(0, 60)}`;
  });
  assert.deepEqual(kinds, ["begin;", "set local", "set local", "do", "do",
    "lock table public.email_campaigns in access exclusive mode;", "lock table public.email_audit_log in access exclusive mode;",
    "do", "do", "do", "destructive", "commit;"]);
  assert.equal(statements[1].code, "set local lock_timeout = '10s';");
  assert.equal(statements[2].code, `set local ${TOKEN} = '';`);
  assert.ok(statements[4].code.includes("lock table supabase_migrations.schema_migrations in exclusive mode;"));
  const destructive = statements[10].text.toLowerCase();
  assert.ok(destructive.indexOf("is distinct from 'precheck/precheck/state/dependencies/'") < destructive.indexOf("drop "));
  for (const lock of ["('public.email_campaigns', 'accessexclusivelock')", "('public.email_audit_log', 'accessexclusivelock')",
    "('supabase_migrations.schema_migrations', 'exclusivelock')"]) {
    assert.ok(destructive.includes(lock), `destructive phase verifies ${lock}`);
  }
  assert.ok(!/lock table public\.email_audit_log in (exclusive|share)/.test(recoverySql.toLowerCase()), "no weaker audit-log lock anywhere");
});

test("static: the accepted history is the frozen Increment 3a baseline + 3a + the (empty) reviewed 3c window + 3c", () => {
  const start = recoverySql.indexOf("-- BEGIN REVIEWED RECOVERY BASELINE");
  const end = recoverySql.indexOf("-- END REVIEWED RECOVERY BASELINE");
  const versions = [...recoverySql.slice(start, end).matchAll(/'([0-9]+)'/g)].map((m) => m[1]).sort();
  assert.deepEqual(versions, [...baselineVersions(RECOVERY_BASELINE), "20261004150000"].sort(), "Increment 3a baseline + 3a, verbatim");
  const allow = recoverySql.slice(start, recoverySql.indexOf("]::text[])", start));
  assert.ok(allow.includes("'20261005160000'"), "Increment 3c itself");
  const window = recoverySql.slice(recoverySql.indexOf("-- BEGIN REVIEWED INC3C WINDOW"), recoverySql.indexOf("-- END REVIEWED INC3C WINDOW"));
  assert.deepEqual([...window.matchAll(/'([0-9]+)'/g)], [], "the window is empty at build time");
  // Adjacent literals separated only by whitespace/comments are CONCATENATED by
  // PostgreSQL ('a'\n'b' = 'ab'): every list element must be comma-separated.
  const listStart = recoverySql.indexOf("history.version <> all (array[");
  const lists = recoverySql.slice(listStart, recoverySql.indexOf("EMAIL_RECOVERY_REFUSED_UNKNOWN_MIGRATION", listStart));
  assert.ok(listStart > 0 && lists.includes("'20261004150000'") && lists.includes("'20261005160000'"), "the accepted-history lists were found");
  assert.ok(!/'\s*(--[^\n]*\n\s*)*'/.test(lists), "no implicit string-literal concatenation in the accepted history");
});

// --- behavior ------------------------------------------------------------------

test("rehearsal: apply 3c, recover, Increment 3a state restored exactly; re-apply works; then the 3a recovery works too", async () => {
  const db = await inc3aDatabase();
  await withSupabaseHistory(db, HISTORY.slice(0, 3));
  const baseline = await fullSnapshot(db);
  await db.exec(migrationSql);
  await db.query("insert into supabase_migrations.schema_migrations (version, name) values ('20261005160000', 'email_marketing_v1_campaigns')");
  // The Increment 3a recovery refuses while Increment 3c is present.
  await refuses(db, recovery3aSql, "EMAIL_RECOVERY_REFUSED_LATER_MIGRATION", "3a recovery before 3c recovery");
  await db.exec(recoverySql);
  const recovered = await fullSnapshot(db);
  for (const key of Object.keys(baseline)) assert.deepEqual(recovered[key], baseline[key], `${key} restored`);
  assert.equal(recovered.inc1Fp, EXPECTED_INC1_FP_AFTER_INC3A);
  assert.equal(recovered.inc2Fp, STAGING_INC2_FP);
  assert.deepEqual((await dataState(db)).history, HISTORY.slice(0, 3), "only the 3c history row is removed");
  await db.exec(migrationSql);
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${A_FOUNDER}', false);`);
  assert.equal((await db.query("select * from public.email_create_campaign('Otra vez')")).rows[0].was_created, true, "re-applied 3c works");
  await db.exec("reset role");
  // Without Supabase history the 3a recovery still refuses while 3c objects exist.
  const plain = await inc3cDatabase();
  await refuses(plain, recovery3aSql, "EMAIL_RECOVERY_REFUSED_UNEXPECTED_STATE", "3a recovery sees 3c objects");
  await plain.exec(recoverySql);
  await plain.exec(recovery3aSql);
  assert.equal((await fullSnapshot(plain)).tables.length, 12, "3c then 3a recovery returns to Increment 2");
});

test("M-1: on the confirmed 80-row Staging history: apply 3a, apply 3c, recover 3c, recover 3a -> exact Increment 2 state; re-apply; refusals", async () => {
  const staging = JSON.parse(readFileSync(new URL("./fixtures/email_marketing_v1_staging_history.json", import.meta.url), "utf8"))
    .rows.map((row) => row.version);
  assert.equal(staging.length, 80);
  const record = (db, version) => db.query("insert into supabase_migrations.schema_migrations (version, name) values ($1, $2)", [version, `m${version}`]);
  const db = await createDatabase();
  for (const p of [MIGRATIONS.inc1, MIGRATIONS.inc2]) await db.exec(readSql(p));
  await withSupabaseHistory(db, staging);
  const inc2 = [await fullSnapshot(db), await dataState(db)];
  await db.exec(readSql(MIGRATIONS.inc3a));
  await record(db, "20261004150000");
  await db.exec(migrationSql);
  await record(db, "20261005160000");
  await refuses(db, recovery3aSql, "EMAIL_RECOVERY_REFUSED_LATER_MIGRATION", "3a recovery while 3c is recorded");
  await db.exec(recoverySql);
  await db.exec(recovery3aSql);
  assert.deepEqual([await fullSnapshot(db), await dataState(db)], inc2, "exact Increment 2 state and 80-row history restored");
  await db.exec(readSql(MIGRATIONS.inc3a));
  await record(db, "20261004150000");
  await db.exec(migrationSql);
  await record(db, "20261005160000");
  assert.deepEqual((await dataState(db)).history, [...staging, "20261004150000", "20261005160000"], "both re-applied");
  // Refusals: a later version, and a backdated unknown version below 3a.
  for (const [extra, message] of [["20261006000000", "EMAIL_RECOVERY_REFUSED_LATER_MIGRATION"],
    ["20261003130000", "EMAIL_RECOVERY_REFUSED_UNKNOWN_MIGRATION"]]) {
    await record(db, extra);
    const before = [await fullSnapshot(db), await dataState(db)];
    await refuses(db, recoverySql, message, `3c recovery with ${extra}`);
    await refuses(db, recovery3aSql, message === "EMAIL_RECOVERY_REFUSED_UNKNOWN_MIGRATION" ? "EMAIL_RECOVERY_REFUSED_LATER_MIGRATION" : message,
      `3a recovery with ${extra} (3c still recorded)`);
    assert.deepEqual([await fullSnapshot(db), await dataState(db)], before, `${extra}: nothing changed`);
    await db.query("delete from supabase_migrations.schema_migrations where version = $1", [extra]);
  }
});

test("DATA_PRESENT: a campaign row, or an audit row of entity type 'campaign', refuses and changes nothing", async () => {
  for (const [label, arrange] of [
    ["campaign row", async (db) => {
      await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${A_FOUNDER}', false);`);
      await db.query("select * from public.email_create_campaign('Con datos')");
      await db.exec("reset role");
    }],
    ["campaign audit row only", async (db) => {
      await db.exec(`insert into public.email_audit_log (organization_id, actor_type, action, entity_type, entity_id)
        values ('${ORG_A}', 'system', 'email.campaign.created', 'campaign', gen_random_uuid())`);
    }],
  ]) {
    const db = await inc3cDatabase();
    await withSupabaseHistory(db, HISTORY);
    await arrange(db);
    const before = [await fullSnapshot(db), await dataState(db)];
    await refuses(db, recoverySql, "EMAIL_RECOVERY_REFUSED_DATA_PRESENT", label);
    assert.deepEqual([await fullSnapshot(db), await dataState(db)], before, `${label}: nothing changed`);
  }
});

test("LATER_MIGRATION / UNKNOWN_MIGRATION: later versions and unreviewed versions in the 3c window refuse; a reviewed window version is accepted", async () => {
  let db = await inc3cDatabase();
  await withSupabaseHistory(db, [...HISTORY, "20261006000000"]);
  let before = await dataState(db);
  await refuses(db, recoverySql, "EMAIL_RECOVERY_REFUSED_LATER_MIGRATION");
  assert.deepEqual(await dataState(db), before);
  // M-1: the applied Sales migrations (20261002120000, 20261002130000, 20261003120000) are reviewed
  // predecessors in the Increment 3a baseline, so the shipped recovery accepts them as-is.
  db = await inc3cDatabase();
  await withSupabaseHistory(db, [...HISTORY, "20261002120000", "20261002130000", "20261003120000"]);
  await db.exec(recoverySql);
  assert.deepEqual((await dataState(db)).history,
    [...HISTORY.slice(0, 2), "20261002120000", "20261002130000", "20261003120000", HISTORY[2]], "Sales predecessors accepted");
  // An unreviewed migration recorded between 3a and 3c refuses until it is reviewed into the window.
  db = await inc3cDatabase();
  await withSupabaseHistory(db, [...HISTORY, "20261005000000"]);
  before = await dataState(db);
  await refuses(db, recoverySql, "EMAIL_RECOVERY_REFUSED_UNKNOWN_MIGRATION", "unreviewed migration between 3a and 3c");
  assert.deepEqual(await dataState(db), before);
  const reviewed = replaceOnce(recoverySql, "        -- BEGIN REVIEWED INC3C WINDOW\n", "        -- BEGIN REVIEWED INC3C WINDOW\n        '20261005000000'\n");
  await db.exec(reviewed);
  assert.deepEqual((await dataState(db)).history, [...HISTORY.slice(0, 3), "20261005000000"], "accepted once reviewed");
});

test("UNEXPECTED_STATE: evolved schema, foreign references and dependents refuse and change nothing", async () => {
  const cases = [
    ["extra column on email_campaigns", "alter table public.email_campaigns add column zz int"],
    ["extra index on email_campaigns", "create index zz_idx on public.email_campaigns (name)"],
    ["foreign function referencing email_campaigns", "create function public.zz_f() returns bigint language sql as 'select count(*) from public.email_campaigns'"],
    ["foreign function calling a 3c function", "create function private.zz_g() returns jsonb language sql as 'select private.email_preview_footer()'"],
    ["view depending on email_campaigns (pg_depend)", "create view public.zz_v as select id from public.email_campaigns"],
    ["audit CHECK evolved", `alter table public.email_audit_log drop constraint email_audit_log_entity_type_check,
      add constraint email_audit_log_entity_type_check check (entity_type in ('contact', 'consent', 'suppression', 'list', 'tag',
      'custom_field', 'segment', 'crm_import', 'sender_domain', 'sender_identity', 'template', 'template_version', 'campaign', 'later'))`],
    ["email_can redefined", null],
  ];
  for (const [label, ddl] of cases) {
    const db = await inc3cDatabase();
    await withSupabaseHistory(db, HISTORY);
    if (ddl) await db.exec(ddl);
    else {
      const current = (await db.query("select pg_get_functiondef('private.email_can(text)'::regprocedure) as d")).rows[0].d;
      await db.exec(current.replace("'manage_campaigns'", "'manage_campaigns',\n      'manage_later'"));
    }
    const before = [await fullSnapshot(db), await dataState(db)];
    await refuses(db, recoverySql, "EMAIL_RECOVERY_REFUSED_UNEXPECTED_STATE", label);
    assert.deepEqual([await fullSnapshot(db), await dataState(db)], before, `${label}: nothing changed`);
  }
});

test("lock mode: email_audit_log is held ACCESS EXCLUSIVE before any check that precedes the destructive statement", async () => {
  const db = await inc3cDatabase();
  await withSupabaseHistory(db, HISTORY);
  const statements = topLevelStatements(recoverySql);
  const upToLocks = statements.slice(0, 7).map((s) => s.text).join("\n");
  await db.exec(upToLocks);
  const held = (await db.query(`select c.relname as rel, l.mode from pg_locks l join pg_class c on c.oid = l.relation
    where l.pid = pg_backend_pid() and l.granted and c.relname in ('email_audit_log', 'email_campaigns', 'schema_migrations')
    and l.mode in ('ExclusiveLock', 'AccessExclusiveLock') order by 1, 2`)).rows;
  assert.deepEqual(held, [{ rel: "email_audit_log", mode: "AccessExclusiveLock" }, { rel: "email_campaigns", mode: "AccessExclusiveLock" },
    { rel: "schema_migrations", mode: "ExclusiveLock" }]);
  await db.exec("rollback");
});

test("concurrent activity: an in-flight DDL lock before the locks, and the re-check with every lock held, refuse and change nothing", async () => {
  let db = await inc3cDatabase();
  let before = await fullSnapshot(db);
  await db.exec("begin; create table public.zz_inflight (id int);");
  await refuses(db, selfAsForeign(recoverySql, "before locks"), "EMAIL_RECOVERY_REFUSED_CONCURRENT_ACTIVITY", "in-flight DDL");
  assert.deepEqual(await fullSnapshot(db), before);
  db = await inc3cDatabase();
  before = await fullSnapshot(db);
  await refuses(db, selfAsForeign(recoverySql, "with locks held"), "EMAIL_RECOVERY_REFUSED_CONCURRENT_ACTIVITY", "post-lock re-check");
  assert.deepEqual(await fullSnapshot(db), before);
});

test("continue-after-error client (ON_ERROR_ROLLBACK semantics): every refusal still changes nothing; control recovers", async () => {
  const lockFailure = (anchor) => replaceOnce(recoverySql, anchor, anchor.replace(/lock table [a-z_.]+ in/, "lock table public.zz_not_a_table in"));
  const scenarios = [
    ["campaign data present", async (db) => {
      await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${A_FOUNDER}', false);`);
      await db.query("select * from public.email_create_campaign('Con datos')");
      await db.exec("reset role");
    }, recoverySql, /^EMAIL_RECOVERY_REFUSED_DATA_PRESENT$/],
    ["later migration recorded", async (db) => {
      await db.query("insert into supabase_migrations.schema_migrations (version, name) values ('20261006000000', 'later')");
    }, recoverySql, /^EMAIL_RECOVERY_REFUSED_LATER_MIGRATION$/],
    ["concurrent activity in the post-lock re-check", async () => {}, selfAsForeign(recoverySql, "with locks held"), /^EMAIL_RECOVERY_REFUSED_CONCURRENT_ACTIVITY$/],
    ["campaigns lock not obtained", async () => {}, lockFailure("lock table public.email_campaigns in access exclusive mode;"), /zz_not_a_table/],
    ["audit-log lock not obtained", async () => {}, lockFailure("lock table public.email_audit_log in access exclusive mode;"), /zz_not_a_table/],
  ];
  for (const [label, arrange, sql, first] of scenarios) {
    const db = await inc3cDatabase();
    await withSupabaseHistory(db, HISTORY);
    await arrange(db);
    const before = [await fullSnapshot(db), await dataState(db)];
    const errors = await runContinuing(db, sql);
    assert.deepEqual([await fullSnapshot(db), await dataState(db)], before, `${label}: nothing changed`);
    assert.match(errors[0] ?? "", first, `${label}: original refusal first`);
    assert.equal(errors.at(-1), GUARD_REFUSAL, `${label}: the destructive statement refuses as well`);
  }
  // Stale prefix that would stand in for a refused second pre-check, and autocommit.
  let db = await inc3cDatabase();
  await withSupabaseHistory(db, HISTORY);
  let before = [await fullSnapshot(db), await dataState(db)];
  await db.exec(`begin; set local ${TOKEN} = 'precheck/';`);
  let errors = await runContinuing(db, selfAsForeign(recoverySql, "with locks held"));
  assert.deepEqual([await fullSnapshot(db), await dataState(db)], before, "stale prefix: nothing changed");
  assert.equal(errors.at(-1), GUARD_REFUSAL);
  db = await inc3cDatabase();
  await withSupabaseHistory(db, HISTORY);
  before = [await fullSnapshot(db), await dataState(db)];
  errors = await runContinuing(db, recoverySql, { transaction: false });
  assert.deepEqual([await fullSnapshot(db), await dataState(db)], before, "autocommit: nothing changed");
  assert.equal(errors.at(-1), GUARD_REFUSAL);
  db = await inc3cDatabase();
  await withSupabaseHistory(db, HISTORY);
  assert.deepEqual(await runContinuing(db, recoverySql), [], "control: no statement fails");
  assert.equal((await dataState(db)).campaigns, "dropped");
  assert.deepEqual((await dataState(db)).history, HISTORY.slice(0, 3));
});

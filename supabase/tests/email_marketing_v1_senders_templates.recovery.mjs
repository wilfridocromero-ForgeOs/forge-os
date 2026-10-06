// Email Marketing V1 - Increment 3a: Staging recovery rehearsal (PGlite).
//
//   Inc1 + Inc2 -> snapshot -> apply Inc3a -> run the recovery artifact
//   -> every Inc1/Inc2 contract and runner fingerprint is restored exactly.
//
// Run: npx -y -p @electric-sql/pglite node --test supabase/tests/email_marketing_v1_senders_templates.recovery.mjs
//
// The recovery artifact is for controlled Staging recovery only; Production is
// forward-fix.

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  A_FOUNDER, EXPECTED_INC1_FP_AFTER_INC3A, INC1_NAMES, INC2_NAMES, MIGRATIONS, NEW_TABLES, RECOVERY_INC3A,
  STAGING_INC1_FP, STAGING_INC2_FP, createDatabase, readSql, snapshots,
} from "./email_marketing_v1_harness.mjs";

const recoverySql = readSql(RECOVERY_INC3A);
const migrationSql = readSql(MIGRATIONS.inc3a);

async function fullSnapshot(db) {
  const snap = snapshots(db);
  return {
    inc1Fp: await snap.fp(INC1_NAMES), inc2Fp: await snap.fp(INC2_NAMES),
    functions: await snap.functions(), policies: await snap.policies(), tableAcl: await snap.tableAcl(),
    tables: await snap.tables(), constraints: await snap.constraints(), triggers: await snap.triggers(),
    indexes: await snap.indexes(),
  };
}
async function asFounder(db, callback) {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${A_FOUNDER}', false);`);
  try {
    return await callback();
  } finally {
    await db.exec("reset role; select set_config('request.jwt.claim.sub', '', false);");
  }
}

test("static: recovery drops exactly what the migration creates, in one transaction, ASCII only", () => {
  assert.ok([...Buffer.from(recoverySql, "utf8")].every((byte) => byte < 128), "ASCII only (SQL Editor paste safety)");
  const code = recoverySql.toLowerCase().replace(/--[^\n]*/g, "");
  assert.ok(code.trimStart().startsWith("begin;") && code.trimEnd().endsWith("commit;"), "single explicit transaction");
  assert.ok(code.indexOf("email_recovery_refused_data_present") < code.indexOf("drop "), "precondition runs before any drop");
  assert.ok(!/\bcascade\b/.test(code), "no CASCADE: nothing outside Increment 3a can be dropped");
  assert.ok(!/drop (table|function) if exists/.test(code), "fails loudly if an expected object is missing");

  const migration = migrationSql.toLowerCase().replace(/--[^\n]*/g, "");
  const createdTables = [...migration.matchAll(/create table (public\.[a-z_]+)/g)].map((m) => m[1]).sort();
  const droppedTables = [...code.matchAll(/drop table (public\.[a-z_]+);/g)].map((m) => m[1]).sort();
  assert.deepEqual(droppedTables, createdTables);
  const signature = (s) => s.replace(/\s+/g, "");
  const createdFunctions = [...migration.matchAll(/alter function ([a-z_.]+\([^)]*\)) owner to postgres;/g)]
    .map((m) => signature(m[1])).filter((f) => f !== "private.email_can(text)").sort();
  const droppedFunctions = [...code.matchAll(/drop function ([a-z_.]+\([^)]*\));/g)].map((m) => signature(m[1])).sort();
  assert.deepEqual(droppedFunctions, createdFunctions, "every Increment 3a function is dropped, nothing else");
  assert.ok(code.includes("delete from supabase_migrations.schema_migrations where version = '20261004150000'"));
  // The "no foreign function references Increment 3a tables" allowlist is
  // exactly the set of functions the migration creates.
  const allowAnchor = "(n.nspname || '.' || p.proname) <> all (array[";
  const allowBlock = code.slice(code.indexOf(allowAnchor) + allowAnchor.length, code.indexOf("]::text[])", code.indexOf(allowAnchor)));
  const allowed = [...allowBlock.matchAll(/'([a-z_.]+)'/g)].map((m) => m[1]).sort();
  const created = createdFunctions.map((f) => f.replace(/\(.*$/, ""));
  assert.deepEqual(allowed, [...created, "private.email_can"].sort(), "exactly the Increment 3a functions plus email_can");
  // Refusal reasons in the header match the ones the code can raise.
  const raised = [...new Set([...code.matchAll(/message = '(email_recovery_[a-z_]+)'/g)].map((m) => m[1]))].sort();
  const documented = [...new Set([...recoverySql.toLowerCase().matchAll(/^-- \* (email_recovery_[a-z_]+)/gm)].map((m) => m[1]))].sort();
  assert.deepEqual(documented, raised, "header documents exactly the refusal reasons");
});

test("rehearsal: apply Inc3a, recover, and every Inc1/Inc2 contract is restored exactly; re-apply works", async () => {
  const db = await createDatabase();
  await db.exec(readSql(MIGRATIONS.inc1));
  await db.exec(readSql(MIGRATIONS.inc2));
  const baseline = await fullSnapshot(db);
  assert.equal(baseline.inc1Fp, STAGING_INC1_FP);
  assert.equal(baseline.inc2Fp, STAGING_INC2_FP);

  await db.exec(migrationSql);
  const applied = await fullSnapshot(db);
  assert.equal(applied.inc1Fp, EXPECTED_INC1_FP_AFTER_INC3A);
  assert.equal(applied.tables.length, 16);

  await db.exec(recoverySql);
  const recovered = await fullSnapshot(db);
  for (const key of Object.keys(baseline)) assert.deepEqual(recovered[key], baseline[key], `${key} restored`);
  assert.equal(recovered.inc1Fp, STAGING_INC1_FP, "runner ENV-06 back to the Staging value");
  assert.equal(recovered.inc2Fp, STAGING_INC2_FP, "runner ENV-07 unchanged");

  // Increment 1-2 behavior after recovery.
  await asFounder(db, async () => {
    const contact = (await db.query("select * from public.email_create_contact('ana@alpha.test')")).rows[0].contact_id;
    await db.query("select * from public.email_record_consent($1, 'written', 'Form', 'Acepto', 'v1', '2026-09-01T10:00:00Z')", [contact]);
    const list = (await db.query("select * from public.email_create_list('VIP')")).rows[0].list_id;
    await db.query("select public.email_add_list_members($1, $2::uuid[])", [list, [contact]]);
    const preview = (await db.query("select public.email_preview_audience($1::jsonb, 10) as r",
      [JSON.stringify({ version: "segment.v1", match: "all", rules: [{ type: "list", op: "in", list_id: list }] })])).rows[0].r;
    assert.equal(preview.sendable, 1);
    await assert.rejects(db.query("select * from public.email_create_template('x')"), /does not exist/);
  });
  assert.equal((await db.query("select private.email_can('manage_content') as v")).rows[0].v, false, "new actions are gone");

  // Forward path after recovery: the migration applies again cleanly.
  await db.exec(migrationSql);
  assert.equal((await fullSnapshot(db)).inc1Fp, EXPECTED_INC1_FP_AFTER_INC3A);
  await asFounder(db, async () => {
    assert.equal((await db.query("select * from public.email_create_template('Otra vez')")).rows[0].was_created, true);
  });
});

test("recovery refuses (and changes nothing) when email_can is not in its exact Increment 3a state", async () => {
  const db = await createDatabase();
  for (const path of [MIGRATIONS.inc1, MIGRATIONS.inc2, MIGRATIONS.inc3a]) await db.exec(readSql(path));
  // Simulates a later migration that redefined email_can (e.g. a further action).
  const current = (await db.query("select pg_get_functiondef('private.email_can(text)'::regprocedure) as d")).rows[0].d;
  await db.exec(current.replace("'manage_campaigns'", "'manage_campaigns',\n      'manage_later_increment'"));
  const beforeAttempt = await fullSnapshot(db);
  await assert.rejects(db.exec(recoverySql), (error) => {
    assert.equal(error.message, "EMAIL_RECOVERY_REFUSED_UNEXPECTED_STATE");
    return true;
  });
  await db.exec("rollback");
  assert.deepEqual(await fullSnapshot(db), beforeAttempt, "nothing was dropped or restored");
});

async function withSupabaseHistory(db, versions) {
  await db.exec(`create schema supabase_migrations;
    create table supabase_migrations.schema_migrations (version text primary key, statements text[], name text);`);
  for (const version of versions) {
    await db.query("insert into supabase_migrations.schema_migrations (version, name) values ($1, $2)", [version, `m${version}`]);
  }
}

test("recovery refuses (and changes nothing) when any migration after Increment 3a is recorded", async () => {
  const db = await createDatabase();
  for (const path of [MIGRATIONS.inc1, MIGRATIONS.inc2, MIGRATIONS.inc3a]) await db.exec(readSql(path));
  // A synthetic later migration (e.g. Inc3b) that may depend on Increment 3a objects.
  await withSupabaseHistory(db, ["20260926160000", "20260927120000", "20261004150000", "20261006000000"]);
  const beforeAttempt = await fullSnapshot(db);
  await assert.rejects(db.exec(recoverySql), (error) => {
    assert.equal(error.message, "EMAIL_RECOVERY_REFUSED_LATER_MIGRATION");
    return true;
  });
  await db.exec("rollback");
  assert.deepEqual(await fullSnapshot(db), beforeAttempt, "nothing was dropped or restored");
  const history = (await db.query("select version from supabase_migrations.schema_migrations order by 1")).rows.map((r) => r.version);
  assert.deepEqual(history, ["20260926160000", "20260927120000", "20261004150000", "20261006000000"], "history untouched");
});

test("recovery with Supabase history: removes exactly the Increment 3a history row", async () => {
  const db = await createDatabase();
  for (const path of [MIGRATIONS.inc1, MIGRATIONS.inc2, MIGRATIONS.inc3a]) await db.exec(readSql(path));
  await withSupabaseHistory(db, ["20260926160000", "20260927120000", "20261004150000"]);
  await db.exec(recoverySql);
  const history = (await db.query("select version from supabase_migrations.schema_migrations order by 1")).rows.map((r) => r.version);
  assert.deepEqual(history, ["20260926160000", "20260927120000"]);
  assert.equal((await fullSnapshot(db)).inc1Fp, STAGING_INC1_FP);
});

test("M-1: on the confirmed 80-row Staging history the shipped recovery removes only the Inc3a row; later and backdated versions refuse", async () => {
  const staging = JSON.parse(readFileSync(new URL("./fixtures/email_marketing_v1_staging_history.json", import.meta.url), "utf8"))
    .rows.map((row) => row.version);
  assert.equal(staging.length, 80);
  for (const sales of ["20261002120000", "20261002130000", "20261003120000"]) assert.ok(staging.includes(sales), `Sales predecessor ${sales}`);
  const inc3aWithHistory = async (history) => {
    const db = await createDatabase();
    for (const path of [MIGRATIONS.inc1, MIGRATIONS.inc2, MIGRATIONS.inc3a]) await db.exec(readSql(path));
    await withSupabaseHistory(db, history);
    return db;
  };
  const versions = async (db) => (await db.query("select version from supabase_migrations.schema_migrations order by 1")).rows.map((r) => r.version);
  let db = await inc3aWithHistory([...staging, "20261004150000"]);
  await db.exec(recoverySql);
  assert.deepEqual(await versions(db), staging, "only the Inc3a row is removed");
  assert.equal((await fullSnapshot(db)).inc1Fp, STAGING_INC1_FP);
  for (const [extra, message] of [["20261004150001", "EMAIL_RECOVERY_REFUSED_LATER_MIGRATION"],
    ["20261003130000", "EMAIL_RECOVERY_REFUSED_UNKNOWN_MIGRATION"]]) {
    db = await inc3aWithHistory([...staging, extra, "20261004150000"]);
    const beforeAttempt = await fullSnapshot(db);
    await assert.rejects(db.exec(recoverySql), (error) => {
      assert.equal(error.message, message, extra);
      return true;
    });
    await db.exec("rollback");
    assert.deepEqual(await fullSnapshot(db), beforeAttempt, `${extra}: nothing changed`);
    assert.deepEqual(await versions(db), [...staging, extra, "20261004150000"].sort(), `${extra}: history untouched`);
  }
});

test("recovery refuses (and changes nothing) for every evolved or unexpected schema state", async () => {
  const evolutions = {
    "audit entity-type CHECK gained a later type": `alter table public.email_audit_log drop constraint email_audit_log_entity_type_check,
      add constraint email_audit_log_entity_type_check check (entity_type in ('contact','consent','suppression','list','tag','custom_field',
      'segment','crm_import','sender_domain','sender_identity','template','template_version','campaign'))`,
    "a later column on an Increment 3a table": "alter table public.email_templates add column category text",
    "an extra email function": "create function private.email_campaign_helper() returns int language sql as 'select 1'",
    "an extra email table": "create table public.email_campaigns (id uuid primary key)",
    "a foreign function that reads an Increment 3a table": `create function public.zz_report_templates() returns bigint language sql
      as 'select count(*) from public.email_templates'`,
    "a later trigger on an Increment 3a table": `create function public.zz_noop() returns trigger language plpgsql as 'begin return new; end';
      create trigger zz_later after insert on public.email_template_versions for each row execute function public.zz_noop()`,
    "a later policy on an Increment 3a table": "create policy zz_later on public.email_templates for select to service_role using (true)",
    "a later index on an Increment 3a table": "create index zz_later_idx on public.email_template_versions (created_at)",
  };
  for (const [label, ddl] of Object.entries(evolutions)) {
    const db = await createDatabase();
    for (const path of [MIGRATIONS.inc1, MIGRATIONS.inc2, MIGRATIONS.inc3a]) await db.exec(readSql(path));
    await db.exec(ddl);
    const beforeAttempt = await fullSnapshot(db);
    await assert.rejects(db.exec(recoverySql), (error) => {
      assert.equal(error.message, "EMAIL_RECOVERY_REFUSED_UNEXPECTED_STATE", label);
      return true;
    });
    await db.exec("rollback");
    assert.deepEqual(await fullSnapshot(db), beforeAttempt, `${label}: nothing was dropped or restored`);
  }
});

test("recovery refuses (and changes nothing) when history holds a migration unknown at Increment 3a apply time", async () => {
  // A pending Codex migration (lower version than Inc3a) applied afterwards,
  // e.g. with --include-all: a plain "version > Inc3a" check would miss it.
  const db = await createDatabase();
  for (const path of [MIGRATIONS.inc1, MIGRATIONS.inc2, MIGRATIONS.inc3a]) await db.exec(readSql(path));
  await withSupabaseHistory(db, ["20260926160000", "20260927120000", "20261004150000", "20260921055617"]);
  const beforeAttempt = await fullSnapshot(db);
  await assert.rejects(db.exec(recoverySql), (error) => {
    assert.equal(error.message, "EMAIL_RECOVERY_REFUSED_UNKNOWN_MIGRATION");
    return true;
  });
  await db.exec("rollback");
  assert.deepEqual(await fullSnapshot(db), beforeAttempt);
});

test("recovery refuses (and changes nothing) when a foreign function calls an Increment 3a function", async () => {
  const db = await createDatabase();
  for (const path of [MIGRATIONS.inc1, MIGRATIONS.inc2, MIGRATIONS.inc3a]) await db.exec(readSql(path));
  // Names no Increment 3a table, only an Increment 3a function.
  await db.exec(`create function public.zz_orb_preview(p_subject text) returns text[] language sql
    as 'select private.email_content_validate(null::uuid, p_subject, null, null::jsonb)'`);
  const beforeAttempt = await fullSnapshot(db);
  await assert.rejects(db.exec(recoverySql), (error) => {
    assert.equal(error.message, "EMAIL_RECOVERY_REFUSED_UNEXPECTED_STATE");
    return true;
  });
  await db.exec("rollback");
  assert.deepEqual(await fullSnapshot(db), beforeAttempt);
});

test("recovery: lock_timeout first; accepted history = the reviewed recovery baseline + Inc3a", async () => {
  const { baselineVersions, RECOVERY_BASELINE, recoveryBaselineInSql } = await import("./email_marketing_v1_recovery_baseline.mjs");
  const code = recoverySql.toLowerCase().replace(/--[^\n]*/g, "");
  const timeout = code.indexOf("set local lock_timeout = '10s';");
  assert.ok(timeout > 0 && timeout < code.indexOf("lock table"), "lock_timeout is set before any lock is requested");
  assert.deepEqual(recoveryBaselineInSql(recoverySql), [...baselineVersions(RECOVERY_BASELINE), "20261004150000"].sort(),
    "the recovery allowlist is exactly the reviewed baseline plus Inc3a (regenerate with the baseline tool)");
});

test("M3 (pass 6): stale build-time baseline refuses a legitimate parallel migration; a refreshed reviewed baseline accepts it", async () => {
  const { baselineVersions, recoverySqlWithBaseline, RECOVERY_BASELINE } = await import("./email_marketing_v1_recovery_baseline.mjs");
  const parallel = "20260928090000"; // legitimate: dated before Inc3a, applied on the target before Inc3a
  const history = ["20260926160000", "20260927120000", parallel, "20261004150000"];
  // Build-time baseline (as reviewed when Inc3a was built): the parallel migration is unknown.
  let db = await createDatabase();
  for (const path of [MIGRATIONS.inc1, MIGRATIONS.inc2, MIGRATIONS.inc3a]) await db.exec(readSql(path));
  await withSupabaseHistory(db, history);
  const beforeAttempt = await fullSnapshot(db);
  await assert.rejects(db.exec(recoverySql), (error) => {
    assert.equal(error.message, "EMAIL_RECOVERY_REFUSED_UNKNOWN_MIGRATION");
    return true;
  });
  await db.exec("rollback");
  assert.deepEqual(await fullSnapshot(db), beforeAttempt, "stale baseline: refuses and changes nothing");
  // Refreshed baseline = the reviewed export of the target taken right before applying Inc3a.
  const refreshed = recoverySqlWithBaseline(recoverySql, [...baselineVersions(RECOVERY_BASELINE), parallel]);
  assert.notEqual(refreshed, recoverySql);
  db = await createDatabase();
  for (const path of [MIGRATIONS.inc1, MIGRATIONS.inc2, MIGRATIONS.inc3a]) await db.exec(readSql(path));
  await withSupabaseHistory(db, history);
  await db.exec(refreshed);
  assert.deepEqual((await db.query("select version from supabase_migrations.schema_migrations order by 1")).rows.map((r) => r.version),
    ["20260926160000", "20260927120000", parallel], "refreshed baseline: recovery accepts and removes only the Inc3a row");
  // Unknown-migration refusal is not weakened: a version outside the refreshed baseline still refuses.
  db = await createDatabase();
  for (const path of [MIGRATIONS.inc1, MIGRATIONS.inc2, MIGRATIONS.inc3a]) await db.exec(readSql(path));
  await withSupabaseHistory(db, [...history, "20260921055617"]);
  await assert.rejects(db.exec(refreshed), (error) => {
    assert.equal(error.message, "EMAIL_RECOVERY_REFUSED_UNKNOWN_MIGRATION");
    return true;
  });
});

test("LOW 6 (pass 6): surviving functions or policies that use the new email_can actions make recovery refuse", async () => {
  const cases = {
    "function using manage_content": "create function public.zz_can_edit() returns boolean language sql as $f$ select private.email_can('manage_content') $f$",
    "function using manage_campaigns": "create function public.zz_can_send() returns boolean language sql as $f$ select private.email_can('manage_campaigns') $f$",
    "policy using manage_senders": "create policy zz_senders_only on public.email_contacts for select to authenticated using ((select private.email_can('manage_senders')))",
    "policy WITH CHECK using manage_content": "create table public.zz_notes (id int primary key); alter table public.zz_notes enable row level security; create policy zz_notes_write on public.zz_notes for insert to authenticated with check ((select private.email_can('manage_content')))",
  };
  for (const [label, ddl] of Object.entries(cases)) {
    const db = await createDatabase();
    for (const path of [MIGRATIONS.inc1, MIGRATIONS.inc2, MIGRATIONS.inc3a]) await db.exec(readSql(path));
    await db.exec(ddl);
    const beforeAttempt = await fullSnapshot(db);
    await assert.rejects(db.exec(recoverySql), (error) => {
      assert.equal(error.message, "EMAIL_RECOVERY_REFUSED_UNEXPECTED_STATE", label);
      return true;
    });
    await db.exec("rollback");
    assert.deepEqual(await fullSnapshot(db), beforeAttempt, `${label}: nothing changed`);
  }
  // Positive: dependencies on the Increment 1 'read' action survive recovery unaffected.
  const db = await createDatabase();
  for (const path of [MIGRATIONS.inc1, MIGRATIONS.inc2, MIGRATIONS.inc3a]) await db.exec(readSql(path));
  await db.exec(`create function public.zz_can_read() returns boolean language sql as $f$ select private.email_can('read') $f$;
    create table public.zz_reports (id int primary key); alter table public.zz_reports enable row level security;
    create policy zz_reports_read on public.zz_reports for select to authenticated using ((select private.email_can('read')));`);
  await db.exec(recoverySql);
  assert.equal((await fullSnapshot(db)).inc1Fp, STAGING_INC1_FP, "recovery completed");
  assert.equal((await db.query("select public.zz_can_read() as v")).rows[0].v, false, "the surviving 'read' dependency still works");
});

test("LOW 5 (pass 6): migration history is locked first, then Increment 3a tables, then the audit log", () => {
  const code = recoverySql.toLowerCase().replace(/--[^\n]*/g, "");
  const at = (text) => code.indexOf(text);
  const timeout = at("set local lock_timeout = '10s';");
  const history = at("lock table supabase_migrations.schema_migrations in exclusive mode;");
  const tables = at("lock table public.email_sender_domains, public.email_sender_identities, public.email_templates,");
  const audit = at("lock table public.email_audit_log in exclusive mode;");
  // The concurrent-activity pre-check (pass 7) deliberately runs before the
  // locks too; every other precondition runs with the locks held.
  const firstCheck = code.search(/email_recovery_refused_(?!concurrent_activity)/);
  assert.ok(timeout > 0 && history > timeout && tables > history && audit > tables && firstCheck > audit,
    "lock_timeout -> schema_migrations (EXCLUSIVE) -> Inc3a tables (ACCESS EXCLUSIVE) -> email_audit_log (EXCLUSIVE) -> checks");
  assert.ok(code.slice(code.lastIndexOf("do $$", history), history).includes("if to_regclass('supabase_migrations.schema_migrations') is not null then"),
    "the history lock is conditional on the table existing (absent outside Supabase)");
  assert.ok(/-- Lock order[\s\S]*?schema_migrations[\s\S]*?ACCESS EXCLUSIVE[\s\S]*?email_audit_log/.test(recoverySql),
    "the header documents the lock order");
});

test("recovery takes explicit locks before checking its preconditions", () => {
  const code = recoverySql.toLowerCase().replace(/--[^\n]*/g, "");
  const lock = code.indexOf("lock table public.email_sender_domains, public.email_sender_identities, public.email_templates,\n  public.email_template_versions in access exclusive mode;");
  const auditLock = code.indexOf("lock table public.email_audit_log in exclusive mode;");
  assert.ok(lock > 0 && auditLock > 0, "Increment 3a tables and the audit log are locked");
  const precondition = code.search(/email_recovery_refused_(?!concurrent_activity)/);
  assert.ok(lock < precondition && auditLock < precondition, "locks are taken before the preconditions are evaluated");
});

// ---------------------------------------------------------------------------
// Pass 7 B / Pass 8 M1: concurrent migration / DDL. PGlite has one backend, so
// another session is simulated by letting the pre-check treat THIS session as
// foreign: only its own-pid identity is replaced (every other filter stays
// live), so whatever this session holds or shows stands for a concurrent
// session. This is PostgreSQL 18 behavior in a single backend, not a
// multi-session proof.
const THIS_SESSION = "pg_catalog.pg_backend_pid()";
const VISIBILITY_CONDITION = "(coalesce(a.query, '<insufficient privilege>') = '<insufficient privilege>' or a.backend_type is null)";
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
function selfAsForeign(sql, which, { skipVisibility = false } = {}) {
  const blocks = precheckBlocks(sql);
  assert.equal(blocks.length, 2, "two pre-check blocks");
  const block = blocks[which === "before locks" ? 0 : 1];
  assert.equal(block.text.split(THIS_SESSION).length - 1, 4, "every session-based check excludes only this session's pid");
  let text = block.text.split(THIS_SESSION).join("-1");
  if (skipVisibility) {
    // Test-only: isolates the lock checks from the visibility check.
    assert.equal(text.split(VISIBILITY_CONDITION).length - 1, 1);
    text = text.split(VISIBILITY_CONDITION).join("false");
  }
  return sql.slice(0, block.start) + text + sql.slice(block.end);
}
async function inc3aDatabase() {
  const db = await createDatabase();
  for (const path of [MIGRATIONS.inc1, MIGRATIONS.inc2, MIGRATIONS.inc3a]) await db.exec(readSql(path));
  return db;
}
async function refusesConcurrent(db, sql, detailPattern, label) {
  await assert.rejects(db.exec(sql), (error) => {
    assert.equal(error.message, "EMAIL_RECOVERY_REFUSED_CONCURRENT_ACTIVITY", label);
    assert.match(String(error.detail), detailPattern, label);
    return true;
  });
  await db.exec("rollback");
}

test("B (pass 7): migration/DDL freeze is an explicit precondition; the pre-check runs before locking and again with every lock held", () => {
  const code = recoverySql.toLowerCase().replace(/--[^\n]*/g, "");
  const header = recoverySql.slice(0, recoverySql.indexOf("begin;"));
  assert.ok(header.includes("OPERATIONAL PRECONDITION: EMAIL INC3A RECOVERY REQUIRES A MIGRATION/DDL FREEZE."));
  for (const rule of ["no migration may be running", "schema-changing DDL may be running", "SQL Editor",
    "automation", "operational freeze + technical pre-check + recovery locks",
    "RESIDUAL LIMITATION: SQL cannot completely detect or serialize against", "arbitrary uncommitted DDL already executing in another session"]) {
    assert.ok(header.replace(/\n--\s*/g, " ").includes(rule), `header states: ${rule}`);
  }
  const blocks = precheckBlocks(recoverySql);
  assert.equal(blocks.length, 2);
  const strip = (text) => text.slice(text.indexOf("do $$"));
  assert.equal(strip(blocks[0].text), strip(blocks[1].text), "both pre-checks are identical");
  const at = (text) => recoverySql.indexOf(text);
  assert.ok(at("set local lock_timeout = '10s';") < blocks[0].start
    && blocks[0].end < at("lock table supabase_migrations.schema_migrations in exclusive mode;"), "first pre-check: after lock_timeout, before any lock");
  assert.ok(at("lock table public.email_audit_log in exclusive mode;") < blocks[1].start
    && blocks[1].end < at("begin;") + recoverySql.slice(at("begin;")).search(/EMAIL_RECOVERY_REFUSED_(?!CONCURRENT_ACTIVITY)/),
  "second pre-check: all locks held, before every other check");
  const check = blocks[0].text.toLowerCase();
  for (const signal of ["pg_prepared_xacts", "to_regclass('supabase_migrations.schema_migrations')", "'shareupdateexclusivelock'",
    "'accessexclusivelock'", "'<insufficient privilege>'", "'idle in transaction'", "create|alter|drop"]) {
    assert.ok(check.includes(signal), `pre-check covers ${signal}`);
  }
  assert.ok(!/pg_terminate_backend|pg_cancel_backend/.test(code), "never terminates or cancels other sessions");
  const architecture = readFileSync(new URL("../../docs/email-marketing/ARCHITECTURE.md", import.meta.url), "utf8").replace(/\s+/g, " ");
  assert.ok(architecture.includes("MIGRATION/DDL FREEZE") && architecture.includes("EMAIL_RECOVERY_REFUSED_CONCURRENT_ACTIVITY")
    && architecture.includes("no puede detectar ni serializar por completo"), "ARCHITECTURE states the freeze, the refusal and the residual limitation");
});

test("B (pass 7): concurrent schema activity makes recovery refuse and change nothing (simulated second session)", async () => {
  // Another session holds a schema-level lock (uncommitted CREATE TABLE).
  let db = await inc3aDatabase();
  let before = await fullSnapshot(db);
  await db.exec("begin; create table public.zz_inflight_ddl (id int);");
  await refusesConcurrent(db, selfAsForeign(recoverySql, "before locks"), /schema-level table lock/, "in-flight DDL lock");
  assert.deepEqual(await fullSnapshot(db), before, "in-flight DDL: nothing changed");
  // Another session is writing the migration history (a migration recording itself).
  db = await inc3aDatabase();
  await withSupabaseHistory(db, ["20260926160000", "20260927120000", "20261004150000"]);
  before = await fullSnapshot(db);
  await db.exec("begin; insert into supabase_migrations.schema_migrations (version, name) values ('20260928000000', 'inflight');");
  await refusesConcurrent(db, selfAsForeign(recoverySql, "before locks"), /migration history/, "history write in progress");
  assert.deepEqual(await fullSnapshot(db), before, "history write: nothing changed");
  assert.deepEqual((await db.query("select version from supabase_migrations.schema_migrations order by 1")).rows.map((r) => r.version),
    ["20260926160000", "20260927120000", "20261004150000"]);
  // Another session in a transaction running schema-changing SQL without a
  // table lock (e.g. CREATE FUNCTION): this session's query text is the whole
  // submitted batch truncated to track_activity_query_size (1024 bytes, all
  // header comments for the recovery script), so it cannot stand in for another
  // session; the statement-text predicate is evaluated by PostgreSQL itself,
  // exactly as written in the pre-check.
  const block = precheckBlocks(recoverySql)[0].text;
  const exprStart = block.indexOf("regexp_replace(a.query");
  const predicate = block.slice(exprStart, block.indexOf("\n  ) then", exprStart)).trimEnd().split("a.query").join("$1::text");
  db = await createDatabase();
  const isDdl = async (text) => (await db.query(`select (${predicate}) as hit`, [text])).rows[0].hit;
  for (const text of ["create or replace function public.f() returns int language sql as 'select 1'",
    "-- migration header\nALTER TABLE public.email_templates ADD COLUMN x int", "begin; drop view public.v",
    "/* note */ grant select on public.t to authenticated", "comment on table public.t is 'x'",
    "select 1; create policy p on public.t using (true)", "  REFRESH MATERIALIZED VIEW public.mv"]) {
    assert.equal(await isDdl(text), true, `schema-changing: ${text}`);
  }
  for (const text of ["select comment from public.notes", "update public.t set dropped = true where id = 1",
    "insert into public.notes (body) values ('create table later')", "select private.email_can('manage_content')", "commit"]) {
    assert.equal(await isDdl(text), false, `not schema-changing: ${text}`);
  }
  // Activity that appears only after the first check is caught by the second
  // one, which runs with every recovery lock held.
  db = await inc3aDatabase();
  before = await fullSnapshot(db);
  await refusesConcurrent(db, selfAsForeign(recoverySql, "with locks held"), /schema-level table lock/, "post-lock re-check");
  assert.deepEqual(await fullSnapshot(db), before, "post-lock re-check: nothing changed");
  // Without concurrent activity (the real filter) recovery proceeds.
  db = await inc3aDatabase();
  await db.exec(recoverySql);
  assert.equal((await fullSnapshot(db)).inc1Fp, STAGING_INC1_FP, "no concurrent activity: recovery completes");
});

test("M1 (pass 8): sessions this role cannot fully see make recovery refuse; visibility is checked before any state/backend_type filter", async () => {
  // A role without pg_read_all_stats sees another role's session as
  // backend_type NULL, state NULL, query '<insufficient privilege>'. SET ROLE
  // makes this session exactly such a row (BEHAVIORAL, PostgreSQL 18 engine).
  const hidden = "create role zz_restricted_viewer nologin; grant create on schema public to zz_restricted_viewer;";
  // 1. Fully visible, harmless "other" session: behavior preserved (recovery completes).
  let db = await inc3aDatabase();
  await db.exec(selfAsForeign(recoverySql, "before locks"));
  assert.equal((await fullSnapshot(db)).inc1Fp, STAGING_INC1_FP, "1: visible harmless session does not block recovery");
  // 2. Fully visible, conflicting session: refuses (in-flight DDL lock).
  db = await inc3aDatabase();
  let before = await fullSnapshot(db);
  await db.exec("begin; create table public.zz_visible_ddl (id int);");
  await refusesConcurrent(db, selfAsForeign(recoverySql, "before locks"), /schema-level table lock/, "2: visible conflicting session");
  assert.deepEqual(await fullSnapshot(db), before, "2: nothing changed");
  // 3 + 4. The restricted representation, and that it is refused rather than filtered out.
  db = await inc3aDatabase();
  await db.exec(hidden);
  before = await fullSnapshot(db);
  await db.exec("set role zz_restricted_viewer");
  const seen = (await db.query("select backend_type, state, query from pg_catalog.pg_stat_activity")).rows;
  assert.deepEqual(seen.map((r) => ({ ...r })), [{ backend_type: null, state: null, query: "<insufficient privilege>" }],
    "3: an invisible session is reported with NULL backend_type/state and '<insufficient privilege>'");
  assert.equal((await db.query(`select count(*)::int as n from pg_catalog.pg_stat_activity as a
    where a.backend_type = 'client backend' and a.state in ('active', 'idle in transaction')`)).rows[0].n, 0,
    "4: the pre-pass-8 filters (backend_type/state) would have discarded it");
  await assert.rejects(db.exec(selfAsForeign(recoverySql, "before locks")), (error) => {
    assert.equal(error.message, "EMAIL_RECOVERY_REFUSED_CONCURRENT_ACTIVITY");
    assert.match(String(error.detail), /not fully visible to this role/);
    return true;
  });
  await db.exec("rollback; reset role;");
  assert.deepEqual(await fullSnapshot(db), before, "3/4: invisible session refused, nothing changed");
  // 5. A lock held by a session whose metadata cannot be inspected counts even
  //    with the visibility check disabled (test-only): no pg_stat_activity
  //    filter can discard it.
  db = await inc3aDatabase();
  await db.exec(hidden);
  before = await fullSnapshot(db);
  await db.exec("set role zz_restricted_viewer; begin; create table public.zz_hidden_ddl (id int);");
  await assert.rejects(db.exec(selfAsForeign(recoverySql, "before locks", { skipVisibility: true })), (error) => {
    assert.equal(error.message, "EMAIL_RECOVERY_REFUSED_CONCURRENT_ACTIVITY");
    assert.match(String(error.detail), /schema-level table lock/);
    return true;
  });
  await db.exec("rollback; reset role;");
  assert.deepEqual(await fullSnapshot(db), before, "5: lock of an uninspectable session refused, nothing changed");
  // 6. Normal recovery (real pid filter) stays GREEN.
  db = await inc3aDatabase();
  await db.exec(recoverySql);
  assert.equal((await fullSnapshot(db)).inc1Fp, STAGING_INC1_FP, "6: normal recovery completes");
});

test("M1 (pass 8): structure - visibility check first, locks independent of pg_stat_activity visibility, only visible autovacuum exempt", () => {
  for (const block of precheckBlocks(recoverySql)) {
    const text = block.text;
    const visibility = text.indexOf(VISIBILITY_CONDITION);
    assert.ok(visibility > 0, "the visibility check exists");
    for (const later of ["to_regclass('supabase_migrations.schema_migrations')", "'ShareUpdateExclusiveLock'", "regexp_replace(a.query"]) {
      assert.ok(visibility < text.indexOf(later), `visibility is checked before ${later}`);
    }
    const visibilityQuery = text.slice(text.lastIndexOf("select 1 from pg_catalog.pg_stat_activity", visibility), visibility);
    assert.ok(!/backend_type =|a\.state/.test(visibilityQuery), "no state/backend_type filter can discard an invisible row");
    assert.ok(!/join pg_catalog\.pg_stat_activity/.test(text), "lock checks never join pg_stat_activity (which hides metadata)");
    assert.equal(text.split("l.pid is distinct from pg_catalog.pg_backend_pid()").length - 1, 2, "locks by any other pid count, including NULL pids");
    assert.equal(text.split("and a.backend_type = 'autovacuum worker')").length - 1, 2, "only a positively visible autovacuum worker is exempt");
    assert.ok(!text.includes("'client backend'"), "no client-backend filter remains");
  }
  const header = recoverySql.slice(0, recoverySql.indexOf("begin;")).replace(/\n--\s*/g, " ");
  assert.ok(header.includes("FIRST, any other session in this database that this role cannot fully see")
    && header.includes("pg_read_all_stats"), "header documents visibility-first refusal and the role requirement");
});

test("M1b (pass 8): each pre-check discards the cached pg_stat_activity snapshot, so the re-check with locks held reads current activity", async () => {
  // Engine behavior: within one transaction pg_stat_activity is cached on first
  // access; pg_stat_clear_snapshot() discards that copy.
  let db = await createDatabase();
  await db.exec("begin");
  const own = async (marker) => (await db.query(`select query as q /* ${marker} */ from pg_catalog.pg_stat_activity where pid = pg_catalog.pg_backend_pid()`)).rows[0].q;
  assert.match(await own("FIRST"), /FIRST/);
  assert.match(await own("SECOND"), /FIRST/, "a second read in the same transaction returns the cached (stale) copy");
  await db.query("select pg_catalog.pg_stat_clear_snapshot()");
  assert.match(await own("THIRD"), /THIRD/, "after pg_stat_clear_snapshot() the read is current");
  await db.exec("rollback");
  // Recovery: the first pre-check caches a harmless view of this session; only
  // a FRESH read in the second pre-check can see that this session (treated as
  // foreign, lock checks disabled - test-only) now runs schema-changing SQL.
  const blocks = precheckBlocks(recoverySql);
  let second = blocks[1].text.split(THIS_SESSION).join("-1");
  const lockModes = "and l.mode in ('ShareUpdateExclusiveLock', 'ShareLock', 'ShareRowExclusiveLock', 'ExclusiveLock', 'AccessExclusiveLock')";
  assert.equal(second.split(lockModes).length - 1, 1);
  assert.equal(second.split("      and l.mode <> 'AccessShareLock'").length - 1, 1);
  second = second.split(lockModes).join("and false").split("      and l.mode <> 'AccessShareLock'").join("      and false");
  // "...; drop ..." is what the statement-text check recognizes (DDL at the start
  // or after ";"); injected right after "begin" so it falls within the first
  // 1024 bytes of query text that pg_stat_activity keeps.
  const anchor = "current_database());\nbegin\n";
  assert.equal(second.split(anchor).length - 1, 1);
  second = second.split(anchor).join(anchor + "  if false then\n    perform 1;\n    drop table if exists public.zz_never_created;\n  end if;\n");
  // Two statement batches in ONE transaction: the session's query text changes
  // between the pre-checks only if the second one reads current activity.
  const part1 = recoverySql.slice(0, blocks[1].start);
  const part2 = second + recoverySql.slice(blocks[1].end);
  db = await inc3aDatabase();
  const before = await fullSnapshot(db);
  await db.exec(part1);
  await refusesConcurrent(db, part2, /schema-changing SQL/, "fresh activity in the post-lock re-check");
  assert.deepEqual(await fullSnapshot(db), before, "nothing changed");
  // Structure: in both blocks the snapshot is cleared before pg_stat_activity is read.
  for (const block of blocks) {
    const clear = block.text.indexOf("perform pg_catalog.pg_stat_clear_snapshot();");
    assert.ok(clear > 0 && clear < block.text.indexOf("from pg_catalog.pg_stat_activity"), "snapshot cleared before the first activity read");
  }
  const header = recoverySql.slice(0, recoverySql.indexOf("begin;")).replace(/\n--\s*/g, " ");
  assert.ok(header.includes("pg_stat_clear_snapshot(), so the second run reads current activity, still only at that instant"),
    "header states the fresh re-check without overclaiming");
});

test("M2 (pass 8): dependents that use new actions through private.email_require refuse; controls and removal proceed", async () => {
  const db = await inc3aDatabase();
  const cases = [
    ["view via email_require", "create view public.zz_rv as select private.email_require('manage_content') as org", "drop view public.zz_rv"],
    ["materialized view (WITH NO DATA) via email_require",
      "create materialized view public.zz_rmv as select private.email_require('manage_senders') as org with no data", "drop materialized view public.zz_rmv"],
    ["rule via email_require", `create table public.zz_rr (id int);
      create rule zz_rrule as on insert to public.zz_rr where private.email_require('manage_campaigns') is not null do instead nothing`,
      "drop table public.zz_rr"],
    ["column default via email_require", "create table public.zz_rd (id int, org uuid default private.email_require('manage_content'))", "drop table public.zz_rd"],
    ["CHECK via email_require", "create table public.zz_rc (id int check (private.email_require('manage_senders') is not null or id > 0))", "drop table public.zz_rc"],
    ["trigger WHEN via email_require", `create table public.zz_rt (id int);
      create function public.zz_rtf() returns trigger language plpgsql as $f$ begin return new; end $f$;
      create trigger zz_rtr before insert on public.zz_rt for each row when (private.email_require('manage_campaigns') is not null)
      execute function public.zz_rtf()`, "drop table public.zz_rt; drop function public.zz_rtf()"],
    ["SQL function via email_require", "create function public.zz_rsf() returns uuid language sql as $f$ select private.email_require('manage_content') $f$",
      "drop function public.zz_rsf()"],
    ["BEGIN ATOMIC function via email_require",
      "create function public.zz_raf() returns uuid language sql begin atomic select private.email_require('manage_senders'); end", "drop function public.zz_raf()"],
  ];
  for (const [label, create, drop] of cases) {
    await db.exec(create);
    const before = await fullSnapshot(db);
    await assert.rejects(db.exec(recoverySql), (error) => {
      assert.equal(error.message, "EMAIL_RECOVERY_REFUSED_UNEXPECTED_STATE", label);
      return true;
    });
    await db.exec("rollback");
    assert.deepEqual(await fullSnapshot(db), before, `${label}: nothing changed`);
    await db.exec(drop);
  }
  assert.equal((await db.query("select prosrc from pg_catalog.pg_proc where proname = 'zz_raf'")).rows.length, 0, "cleanup");
  // Positive controls: the same object kinds using the Increment 1 'read' action through email_require.
  await db.exec(`create view public.zz_rok_v as select private.email_require('read') as org;
    create table public.zz_rok (id int check (private.email_require('read') is not null or id > 0),
      org uuid default private.email_require('read'));
    create function public.zz_rok_tf() returns trigger language plpgsql as $f$ begin return new; end $f$;
    create trigger zz_rok_tr before insert on public.zz_rok for each row when (private.email_require('read') is not null)
      execute function public.zz_rok_tf();
    create function public.zz_rok_sf() returns uuid language sql as $f$ select private.email_require('read') $f$;
    create function public.zz_rok_af() returns uuid language sql begin atomic select private.email_require('read'); end;`);
  // After every refusing dependent was removed, recovery proceeds and the controls survive.
  await db.exec(recoverySql);
  assert.equal((await fullSnapshot(db)).inc1Fp, STAGING_INC1_FP, "recovery completed");
  assert.equal((await db.query(`select count(*)::int as n from pg_catalog.pg_proc
    where proname in ('zz_rok_tf', 'zz_rok_sf', 'zz_rok_af')`)).rows[0].n, 3, "controls survive");
});

// ---------------------------------------------------------------------------
// Pass 7 C: manage_* and Increment 3a dependency completeness (pg_depend).
test("C (pass 7): every dependent object kind on new email_can actions or Inc3a objects refuses; controls and removal proceed", async () => {
  const db = await inc3aDatabase();
  const cases = [
    ["view using manage_content", "create view public.zz_v as select private.email_can('manage_content') as can", "drop view public.zz_v"],
    ["materialized view using manage_senders", "create materialized view public.zz_mv as select 1 as x where private.email_can('manage_senders')",
      "drop materialized view public.zz_mv"],
    ["column default using manage_campaigns", "create table public.zz_d (id int, can boolean default private.email_can('manage_campaigns'))",
      "drop table public.zz_d"],
    ["CHECK constraint using manage_content", "create table public.zz_c (id int check (private.email_can('manage_content') or id > 0))",
      "drop table public.zz_c"],
    ["trigger WHEN using manage_senders", `create table public.zz_t (id int);
      create function public.zz_tf() returns trigger language plpgsql as $f$ begin return new; end $f$;
      create trigger zz_tr before insert on public.zz_t for each row when (private.email_can('manage_senders')) execute function public.zz_tf()`,
      "drop table public.zz_t; drop function public.zz_tf()"],
    ["rule using manage_content", `create table public.zz_r (id int);
      create rule zz_rule as on insert to public.zz_r where private.email_can('manage_content') do instead nothing`, "drop table public.zz_r"],
    ["atomic function using manage_campaigns", "create function public.zz_af() returns boolean language sql begin atomic select private.email_can('manage_campaigns'); end",
      "drop function public.zz_af()"],
    ["view over an Increment 3a table", "create view public.zz_tv as select id from public.email_templates", "drop view public.zz_tv"],
    ["foreign key to an Increment 3a table", "create table public.zz_fk (template_id uuid references public.email_templates (id))", "drop table public.zz_fk"],
    ["atomic function reading an Increment 3a table", "create function public.zz_atf() returns bigint language sql begin atomic select count(*) from public.email_template_versions; end",
      "drop function public.zz_atf()"],
    ["function taking an Increment 3a row type", "create function public.zz_rt(t public.email_templates) returns uuid language sql as 'select $1.id'",
      "drop function public.zz_rt(public.email_templates)"],
    ["policy on another table reading an Increment 3a table", `create table public.zz_p (id uuid); alter table public.zz_p enable row level security;
      create policy zz_p_read on public.zz_p for select using (exists (select 1 from public.email_templates as t where t.id = zz_p.id))`,
      "drop table public.zz_p"],
  ];
  for (const [label, create, drop] of cases) {
    await db.exec(create);
    const before = await fullSnapshot(db);
    await assert.rejects(db.exec(recoverySql), (error) => {
      assert.equal(error.message, "EMAIL_RECOVERY_REFUSED_UNEXPECTED_STATE", label);
      return true;
    });
    await db.exec("rollback");
    assert.deepEqual(await fullSnapshot(db), before, `${label}: nothing changed`);
    await db.exec(drop);
  }
  // Positive controls: the Increment 1 'read' action and unrelated objects.
  await db.exec(`create view public.zz_ok_v as select private.email_can('read') as can, (select count(*) from public.email_contacts) as n;
    create table public.zz_ok (id int check (private.email_can('read') or id > 0), can boolean default private.email_can('read'));
    create function public.zz_ok_tf() returns trigger language plpgsql as $f$ begin return new; end $f$;
    create trigger zz_ok_tr before insert on public.zz_ok for each row when (private.email_can('read')) execute function public.zz_ok_tf();
    create function public.zz_ok_af() returns boolean language sql begin atomic select private.email_can('read'); end;`);
  // After every refusing dependency was removed, recovery proceeds.
  await db.exec(recoverySql);
  assert.equal((await fullSnapshot(db)).inc1Fp, STAGING_INC1_FP, "recovery completed");
  assert.equal((await db.query("select count(*)::int as n from pg_catalog.pg_class where relname in ('zz_ok_v', 'zz_ok')")).rows[0].n, 2,
    "unrelated objects survive");
  assert.equal((await db.query("select can from public.zz_ok_v")).rows[0].can, false, "the surviving 'read' view still works");
});

test("C (pass 7): dependency checks use pg_depend with an explicit list of dependent kinds; limitations are documented", () => {
  const code = recoverySql.toLowerCase().replace(/--[^\n]*/g, "");
  for (const kind of ["pg_rewrite", "pg_attrdef", "pg_constraint", "pg_trigger", "pg_policy", "pg_proc"]) {
    assert.ok(code.includes(`when d.classid = 'pg_catalog.${kind}'::regclass`), `email_can dependents of kind ${kind} are deparsed`);
  }
  assert.equal(code.split("d.refobjid in ('private.email_can(text)'::regprocedure, 'private.email_require(text)'::regprocedure)").length - 1, 2,
    "both checks cover email_can and email_require (pass 8)");
  assert.ok(code.includes("d.classid not in ("), "unknown dependent kinds refuse");
  assert.ok(code.includes("d.refobjid = any (inc3a_tables)") && code.includes("d.refobjid = any (inc3a_types)")
    && code.includes("d.refobjid = any (inc3a_functions)"), "dependencies on Inc3a tables, row types and functions refuse");
  const header = recoverySql.slice(0, recoverySql.indexOf("begin;")).replace(/\n--\s*/g, " ");
  assert.ok(header.includes("index expressions and generated columns cannot call email_can")
    && header.includes("cannot be detected"), "header documents what cannot be detected");
});

test("recovery refuses (and changes nothing) while Increment 3a data exists", async () => {
  const db = await createDatabase();
  for (const path of [MIGRATIONS.inc1, MIGRATIONS.inc2, MIGRATIONS.inc3a]) await db.exec(readSql(path));
  await asFounder(db, () => db.query("select * from public.email_create_template('Con datos')"));
  const beforeAttempt = await fullSnapshot(db);
  await assert.rejects(db.exec(recoverySql), (error) => {
    assert.equal(error.message, "EMAIL_RECOVERY_REFUSED_DATA_PRESENT");
    return true;
  });
  await db.exec("rollback");
  assert.deepEqual(await fullSnapshot(db), beforeAttempt, "nothing was dropped or restored");
  for (const table of NEW_TABLES) assert.ok((await db.query(`select to_regclass('public.${table}') as t`)).rows[0].t, table);
  assert.equal((await db.query("select count(*)::int as n from public.email_templates")).rows[0].n, 1);
});

// ---------------------------------------------------------------------------
// HIGH-1 (pass 10): a client that rolls back only the failing statement and
// keeps going (psql ON_ERROR_ROLLBACK=on/interactive, GUIs with "rollback to
// savepoint on error") must still change nothing after any refusal. The
// runner below reproduces that client exactly: each top-level statement runs
// in its own savepoint, a failing one is rolled back, and execution continues.
const GUARD_REFUSAL = "EMAIL_RECOVERY_REFUSED_INCOMPLETE_PRECONDITIONS";
const DESTRUCTIVE_START = "do $recovery$";
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
async function dataState(db) {
  const n = async (sql) => (await db.query(sql)).rows[0].n;
  const state = {};
  for (const table of NEW_TABLES) {
    const exists = (await db.query(`select to_regclass('public.${table}') is not null as e`)).rows[0].e;
    state[table] = exists ? await n(`select count(*)::int as n from public.${table}`) : "dropped";
  }
  state.auditRows = await n("select count(*)::int as n from public.email_audit_log");
  state.auditCheck = (await db.query(`select pg_get_constraintdef(c.oid) as d from pg_constraint as c
    where c.conname = 'email_audit_log_entity_type_check'`)).rows.map((r) => r.d);
  state.emailCan = (await db.query("select md5(prosrc) as m from pg_proc where oid = 'private.email_can(text)'::regprocedure")).rows[0].m;
  state.history = (await db.query("select version from supabase_migrations.schema_migrations order by 1")).rows.map((r) => r.version);
  return state;
}
async function recoveryTarget({ data = false } = {}) {
  const db = await inc3aDatabase();
  await withSupabaseHistory(db, ["20260926160000", "20260927120000", "20261004150000"]);
  if (data) {
    await asFounder(db, async () => {
      await db.query("select * from public.email_create_template('Con datos')");
      await db.query("select * from public.email_create_sender_domain('alpha.test')");
    });
  }
  return db;
}
function replaceOnce(sql, from, to) {
  assert.equal(sql.split(from).length - 1, 1, `anchor occurs once: ${from.slice(0, 60)}`);
  return sql.split(from).join(to);
}

test("HIGH-1 (pass 10): a client that rolls back only the failing statement and continues still changes nothing after any refusal", async () => {
  const lockFailure = (anchor) => replaceOnce(recoverySql, anchor, anchor.replace(/lock table [a-z_.]+(, [\s\S]*?)? in/, "lock table public.zz_not_a_table in"));
  const scenarios = [
    ["Increment 3a data present", { data: true }, async () => {}, recoverySql, /^EMAIL_RECOVERY_REFUSED_DATA_PRESENT$/],
    ["a later migration is recorded", {}, async (db) => {
      await db.query("insert into supabase_migrations.schema_migrations (version, name) values ('20261006000000', 'later')");
    }, recoverySql, /^EMAIL_RECOVERY_REFUSED_LATER_MIGRATION$/],
    ["email_can was redefined", {}, async (db) => {
      const current = (await db.query("select pg_get_functiondef('private.email_can(text)'::regprocedure) as d")).rows[0].d;
      await db.exec(current.replace("'manage_campaigns'", "'manage_campaigns',\n      'manage_later_increment'"));
    }, recoverySql, /^EMAIL_RECOVERY_REFUSED_UNEXPECTED_STATE$/],
    ["concurrent activity in the post-lock re-check (simulated)", {}, async () => {},
      selfAsForeign(recoverySql, "with locks held"), /^EMAIL_RECOVERY_REFUSED_CONCURRENT_ACTIVITY$/],
    ["the migration-history lock is not obtained (simulated)", {}, async () => {},
      lockFailure("lock table supabase_migrations.schema_migrations in exclusive mode;"), /zz_not_a_table/],
    ["the Increment 3a table lock is not obtained (simulated)", {}, async () => {},
      lockFailure("lock table public.email_sender_domains, public.email_sender_identities, public.email_templates,\n  public.email_template_versions in access exclusive mode;"), /zz_not_a_table/],
    ["the audit-log lock is not obtained (simulated)", {}, async () => {},
      lockFailure("lock table public.email_audit_log in exclusive mode;"), /zz_not_a_table/],
  ];
  for (const [label, options, arrange, sql, firstRefusal] of scenarios) {
    const db = await recoveryTarget(options);
    await arrange(db);
    const schemaBefore = await fullSnapshot(db);
    const dataBefore = await dataState(db);
    const errors = await runContinuing(db, sql);
    assert.deepEqual(await dataState(db), dataBefore, `${label}: data, audit log, audit CHECK, email_can and history unchanged`);
    assert.deepEqual(await fullSnapshot(db), schemaBefore, `${label}: schema unchanged`);
    assert.match(errors[0] ?? "", firstRefusal, `${label}: the original refusal is raised first`);
    assert.equal(errors.at(-1), GUARD_REFUSAL, `${label}: the destructive phase refuses as well`);
  }
});

test("HIGH-1 (pass 10): the destructive phase is one statement, so a failure inside it undoes all of it even when the client continues", async () => {
  // Test-only: the data-present refusal is disabled, so the destructive phase
  // itself fails (the Increment 2 audit CHECK cannot be restored around
  // Increment 3a audit rows) after it has already dropped tables.
  const sql = replaceOnce(recoverySql,
    "    raise exception using errcode = '55000', message = 'EMAIL_RECOVERY_REFUSED_DATA_PRESENT',\n      detail = 'Increment 3a data exists; recovery of this database needs an explicit decision.';",
    "    null;");
  for (const mode of ["continuing client", "whole file at once"]) {
    const db = await recoveryTarget({ data: true });
    const schemaBefore = await fullSnapshot(db);
    const dataBefore = await dataState(db);
    if (mode === "continuing client") {
      const errors = await runContinuing(db, sql);
      assert.deepEqual(await dataState(db), dataBefore, `${mode}: nothing dropped, nothing restored`);
      assert.equal(errors.length, 1, `${mode}: only the destructive statement failed`);
      assert.match(errors[0], /email_audit_log_entity_type_check/);
    } else {
      await assert.rejects(db.exec(sql), /email_audit_log_entity_type_check/);
      await db.exec("rollback");
      assert.deepEqual(await dataState(db), dataBefore, `${mode}: nothing dropped, nothing restored`);
    }
    assert.deepEqual(await fullSnapshot(db), schemaBefore, `${mode}: schema unchanged`);
  }
});

test("HIGH-1 (pass 10): the destructive phase runs only after the complete check sequence of THIS transaction", async () => {
  const destructive = recoverySql.slice(recoverySql.indexOf(DESTRUCTIVE_START), recoverySql.lastIndexOf("commit;"));
  assert.ok(recoverySql.indexOf(DESTRUCTIVE_START) > 0, "the guarded destructive statement exists");
  const locks = "lock table public.email_sender_domains, public.email_sender_identities, public.email_templates,\n  public.email_template_versions in access exclusive mode;\nlock table public.email_audit_log in exclusive mode;\nlock table supabase_migrations.schema_migrations in exclusive mode;\n";
  const attempts = [
    ["destructive phase alone, every lock held", `begin;\n${locks}${destructive}`],
    ["forged incomplete sequence (second pre-check missing)", `begin;\n${locks}set local orvesen.email_inc3a_recovery = 'precheck/state/dependencies/';\n${destructive}`],
    ["forged complete sequence without the locks", `begin;\nset local orvesen.email_inc3a_recovery = 'precheck/precheck/state/dependencies/';\n${destructive}`],
  ];
  for (const [label, sql] of attempts) {
    const db = await recoveryTarget();
    const before = [await fullSnapshot(db), await dataState(db)];
    await assert.rejects(db.exec(sql), (error) => {
      assert.equal(error.message, GUARD_REFUSAL, label);
      return true;
    });
    await db.exec("rollback");
    assert.deepEqual([await fullSnapshot(db), await dataState(db)], before, `${label}: nothing changed`);
  }
  // A stale complete sequence (e.g. a role/database default or an earlier run
  // in the same transaction) is discarded by the reset at the start.
  let db = await recoveryTarget({ data: true });
  let before = [await fullSnapshot(db), await dataState(db)];
  await db.exec("begin; set local orvesen.email_inc3a_recovery = 'precheck/precheck/state/dependencies/';");
  const errors = await runContinuing(db, recoverySql);
  assert.deepEqual([await fullSnapshot(db), await dataState(db)], before, "stale sequence: nothing changed");
  assert.equal(errors[0], "EMAIL_RECOVERY_REFUSED_DATA_PRESENT");
  assert.equal(errors.at(-1), GUARD_REFUSAL, "stale sequence: the destructive phase refuses");
  // The dangerous stale value is a PREFIX that stands in for the refused check:
  // a stale 'precheck/' plus a refused second pre-check would otherwise add up
  // to the exact complete sequence.
  db = await recoveryTarget();
  before = [await fullSnapshot(db), await dataState(db)];
  await db.exec("begin; set local orvesen.email_inc3a_recovery = 'precheck/';");
  const prefixErrors = await runContinuing(db, selfAsForeign(recoverySql, "with locks held"));
  assert.deepEqual([await fullSnapshot(db), await dataState(db)], before, "stale prefix: nothing changed");
  assert.equal(prefixErrors[0], "EMAIL_RECOVERY_REFUSED_CONCURRENT_ACTIVITY");
  assert.equal(prefixErrors.at(-1), GUARD_REFUSAL, "stale prefix: the destructive phase refuses");
  // Without a transaction block (autocommit) a transaction-local sequence never
  // reaches the destructive statement.
  db = await recoveryTarget();
  before = [await fullSnapshot(db), await dataState(db)];
  const autocommitErrors = await runContinuing(db, recoverySql, { transaction: false });
  assert.deepEqual([await fullSnapshot(db), await dataState(db)], before, "autocommit: nothing changed");
  assert.equal(autocommitErrors.at(-1), GUARD_REFUSAL, "autocommit: the destructive phase refuses");
  // Control: the continuing client with nothing to refuse recovers exactly
  // like the whole file sent at once, and the sequence does not outlive it.
  db = await recoveryTarget();
  assert.deepEqual(await runContinuing(db, recoverySql), [], "control: no statement fails");
  assert.equal((await fullSnapshot(db)).inc1Fp, STAGING_INC1_FP, "control: recovery completed");
  assert.deepEqual((await dataState(db)).history, ["20260926160000", "20260927120000"], "control: Increment 3a history row removed");
  assert.equal((await db.query("select coalesce(current_setting('orvesen.email_inc3a_recovery', true), '') as g")).rows[0].g, "",
    "control: the sequence is transaction-local");
});

test("HIGH-1 (pass 10): structure - checks record their success last; every destructive step is inside the one guarded statement", () => {
  const statements = topLevelStatements(recoverySql);
  const kinds = statements.map(({ code }) => {
    if (code === "begin;" || code === "commit;") return code;
    if (code.startsWith("set local ")) return "set local";
    if (code.startsWith("lock table ")) return "lock";
    if (code.startsWith(DESTRUCTIVE_START)) return "destructive";
    if (code.startsWith("do $$")) return "do";
    return `UNEXPECTED: ${code.slice(0, 60)}`;
  });
  assert.deepEqual(kinds, ["begin;", "set local", "set local", "do", "do", "lock", "lock", "do", "do", "do", "destructive", "commit;"],
    "no destructive statement exists outside the guarded statement");
  assert.equal(statements[2].code, "set local orvesen.email_inc3a_recovery = '';", "the sequence is reset before the first check");
  const record = (token) => `  perform pg_catalog.set_config('orvesen.email_inc3a_recovery',\n    coalesce(pg_catalog.current_setting('orvesen.email_inc3a_recovery', true), '') || '${token}/', true);\nend;\n$$;`;
  const checks = [3, 7, 8, 9].map((index) => statements[index].text);
  ["precheck", "precheck", "state", "dependencies"].forEach((token, index) => {
    assert.ok(checks[index].trimEnd().endsWith(record(token)), `check ${index + 1} records '${token}' as its last statement`);
  });
  assert.ok(!statements[4].text.includes("orvesen.email_inc3a_recovery"), "the lock statement does not record anything (locks are verified directly)");
  const code = statements[10].text.toLowerCase().replace(/--[^\n]*/g, "");
  const guard = code.indexOf("is distinct from 'precheck/precheck/state/dependencies/'");
  const lockCheck = code.indexOf("from pg_catalog.pg_locks as l");
  assert.ok(guard > 0 && lockCheck > guard && lockCheck < code.indexOf("drop "), "the sequence and then the locks are verified before the first drop");
  for (const relation of ["public.email_sender_domains', 'accessexclusivelock", "public.email_sender_identities', 'accessexclusivelock",
    "public.email_templates', 'accessexclusivelock", "public.email_template_versions', 'accessexclusivelock",
    "public.email_audit_log', 'exclusivelock", "supabase_migrations.schema_migrations', 'exclusivelock"]) {
    assert.ok(code.includes(relation), `lock verified: ${relation}`);
  }
  assert.ok(code.trimEnd().endsWith("perform pg_catalog.set_config('orvesen.email_inc3a_recovery', '', true);\nend;\n$recovery$;"),
    "the sequence is consumed as the last destructive step");
  const header = recoverySql.slice(0, recoverySql.indexOf("begin;")).replace(/\n--\s*/g, " ");
  assert.ok(header.includes("does not depend on the client stopping at the first error") && header.includes("ON_ERROR_STOP=1"),
    "header states the client-independent guarantee and the psql defense in depth");
});

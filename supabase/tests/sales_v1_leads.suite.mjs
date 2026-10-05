// Sales V1 Increment 2 - shared test suite (Leads + Attribution).
//
// Reuses the drivers and the Supabase-like bootstrap exported by the frozen
// Increment 1 suite (imported, not modified). Every database gets the
// Increment 1 migration and then the Increment 2 migration, exactly as on
// Staging. Concurrency tests run only on real PostgreSQL.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { DATABASE_SQL, rejects } from "./sales_v1_foundation.suite.mjs";
import * as EXPECTED from "./sales_v1_leads.expected.mjs";

const here = dirname(fileURLToPath(import.meta.url));
export const INC1_MIGRATION_PATH = resolve(here, "../migrations", EXPECTED.INC1_MIGRATION_FILE);
export const MIGRATION_PATH = resolve(here, "../migrations", EXPECTED.MIGRATION_FILE);
export const ROLLBACK_PATH = resolve(here, "rollback/sales_v1_leads_attribution_rollback.sql");
export const INC1_ROLLBACK_PATH = resolve(here, "rollback/sales_v1_foundation_rollback.sql");
export const readInc1Migration = () => readFileSync(INC1_MIGRATION_PATH, "utf8");
export const FIX_MIGRATION_PATH = resolve(here, "../migrations", EXPECTED.FIX_MIGRATION_FILE);
export const readFixMigration = () => readFileSync(FIX_MIGRATION_PATH, "utf8");
export const readMigration = () => readFileSync(MIGRATION_PATH, "utf8");
export const readRollback = () => readFileSync(ROLLBACK_PATH, "utf8");
export const readInc1Rollback = () => readFileSync(INC1_ROLLBACK_PATH, "utf8");

// Email Marketing V1 normalizer (supabase/migrations/20260926160000_email_marketing_v1_foundation.sql,
// commit 0b64966, function private.email_normalize_address), copied verbatim as
// a TEST FIXTURE only, to prove Sales normalization parity. Not runtime code.
const EMAIL_NORMALIZER_FIXTURE = String.raw`
create schema parity;
create function parity.email_normalize_address(raw_address text)
returns text
language plpgsql
immutable
strict
set search_path = ''
as $$
declare
  candidate text := lower(btrim(raw_address, E' \t\r\n'));
  local_part text;
  domain_part text;
begin
  if candidate = '' or char_length(candidate) > 254 then
    return null;
  end if;
  if candidate !~ '^[a-z0-9!#$%&''*+/=?^_${"`"}{|}~.-]+@[a-z0-9.-]+$' then
    return null;
  end if;
  local_part := split_part(candidate, '@', 1);
  domain_part := split_part(candidate, '@', 2);
  if char_length(local_part) not between 1 and 64
     or local_part like '.%' or local_part like '%.' or local_part like '%..%' then
    return null;
  end if;
  if char_length(domain_part) > 253
     or domain_part !~ '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]([a-z0-9-]{0,61}[a-z0-9])?$' then
    return null;
  end if;
  return candidate;
end;
$$;`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const errorText = (error) => [error?.message, error?.code, error?.detail, error?.constraint].filter(Boolean).join(" | ");
const settle = (promise) => promise.then((value) => ({ ok: true, value }), (error) => ({ ok: false, error }));
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

async function waitForBlocked(observer, pid, pending, timeoutMs = 8000) {
  let settled = false;
  pending.then(() => { settled = true; }, () => { settled = true; });
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (settled) return "settled";
    const rows = await observer.query("select wait_event_type from pg_stat_activity where pid = $1", [pid]);
    if (rows[0]?.wait_event_type === "Lock") return "blocked";
    await sleep(15);
  }
  return settled ? "settled" : "timeout";
}

async function as(session, userId, callback, role = "authenticated") {
  await session.exec(`select set_config('request.jwt.claim.sub', '${userId ?? ""}', false); set role ${role};`);
  try {
    return await callback();
  } finally {
    await session.exec("reset role; select set_config('request.jwt.claim.sub', '', false);");
  }
}

async function beginAs(session, userId, isolation = "read committed") {
  await session.exec(`select set_config('request.jwt.claim.sub', '${userId}', false)`);
  await session.exec(`begin isolation level ${isolation}; set local role authenticated;`);
}

// JS null/undefined -> SQL NULL (not the JSON literal 'null', which the RPCs reject).
const J = (value) => (value === undefined || value === null ? null : JSON.stringify(value));
const SQL = {
  ingest: "select public.sales_ingest_lead($1::jsonb, $2::jsonb, $3::text) as r",
  addTouch: "select public.sales_add_lead_touch($1::uuid, $2::jsonb, $3::text) as r",
  update: "select to_jsonb(s) as r from public.sales_update_lead($1::uuid, $2::jsonb, $3::bigint) s",
  qualify: "select to_jsonb(s) as r from public.sales_qualify_lead($1::uuid, $2::text, $3::text, $4::bigint) s",
  disqualify: "select to_jsonb(s) as r from public.sales_disqualify_lead($1::uuid, $2::text, $3::text, $4::bigint) s",
  archive: "select to_jsonb(s) as r from public.sales_archive_lead($1::uuid, $2::text, $3::bigint) s",
};
const rpc = {
  ingest: (s, u, lead, touch = null, key = null) =>
    as(s, u, async () => (await s.query(SQL.ingest, [J(lead), J(touch), key]))[0].r),
  addTouch: (s, u, leadId, touch = {}, key = null) =>
    as(s, u, async () => (await s.query(SQL.addTouch, [leadId, J(touch), key]))[0].r),
  update: (s, u, id, changes, version) =>
    as(s, u, async () => (await s.query(SQL.update, [id, J(changes), version]))[0].r),
  qualify: (s, u, id, reason, note, version) =>
    as(s, u, async () => (await s.query(SQL.qualify, [id, reason, note, version]))[0].r),
  disqualify: (s, u, id, reason, note, version) =>
    as(s, u, async () => (await s.query(SQL.disqualify, [id, reason, note, version]))[0].r),
  archive: (s, u, id, reason, version) =>
    as(s, u, async () => (await s.query(SQL.archive, [id, reason, version]))[0].r),
};

async function createTenant(s) {
  const t = { org: randomUUID(), founder: randomUUID(), admin: randomUUID(), lead: randomUUID(), member: randomUUID() };
  const users = [t.founder, t.admin, t.lead, t.member];
  await s.exec(`
    insert into auth.users(id) values ${users.map((id) => `('${id}')`).join(", ")};
    insert into public.organizations(id, name) values ('${t.org}', 'Org ${t.org.slice(0, 8)}');
    insert into public.organization_memberships(user_id, organization_id, role) values
      ('${t.founder}', '${t.org}', 'founder'), ('${t.admin}', '${t.org}', 'admin'),
      ('${t.lead}', '${t.org}', 'area_lead'), ('${t.member}', '${t.org}', 'member');
    insert into public.user_active_organizations(user_id, organization_id) values
      ${users.map((id) => `('${id}', '${t.org}')`).join(", ")};`);
  return t;
}

async function createUser(s, memberships = [], active = null) {
  const id = randomUUID();
  await s.exec(`insert into auth.users(id) values ('${id}')`);
  for (const [org, role] of memberships) {
    await s.exec(`insert into public.organization_memberships(user_id, organization_id, role) values ('${id}', '${org}', '${role}')`);
  }
  if (active) await s.exec(`insert into public.user_active_organizations(user_id, organization_id) values ('${id}', '${active}')`);
  return id;
}

const countOf = async (s, sql, params = []) => Number((await s.query(sql, params))[0].count);
const leadRow = async (s, id) => (await s.query("select * from public.sales_leads where id = $1", [id]))[0];
const auditRows = (s, org) => s.query(
  "select id, actor_user_id, action, entity_type, entity_id, details from public.sales_audit_log where organization_id = $1 order by id", [org]);
const attribution = async (s, id) => (await s.query("select * from public.sales_lead_attribution where lead_id = $1", [id]))[0];

async function applySql(s, sql) {
  try {
    await s.exec(`begin;\n${sql}\ncommit;`);
  } catch (error) {
    await s.exec("rollback").catch(() => {});
    throw error;
  }
}
async function ownerTx(s, sql) {
  try {
    await s.exec(`begin;\n${sql};\ncommit;`);
  } catch (error) {
    await s.exec("rollback").catch(() => {});
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Catalog inspection (search_path '' for deterministic rendering)
// ---------------------------------------------------------------------------

async function withEmptyPath(s, callback) {
  await s.exec("set search_path = ''");
  try {
    return await callback();
  } finally {
    await s.exec("reset search_path");
  }
}

async function catalog(s) {
  return withEmptyPath(s, async () => ({
    relations: await s.query(`
      select namespace.nspname || '.' || relation.relname as name, relation.relkind::text as kind,
             relation.relrowsecurity as rls, coalesce(relation.reloptions, '{}') as options
      from pg_catalog.pg_class as relation
      join pg_catalog.pg_namespace as namespace on namespace.oid = relation.relnamespace
      where relation.relname like 'sales\\_%' and namespace.nspname not in ('pg_catalog', 'information_schema', 'pg_toast')`),
    columns: await s.query(`
      select namespace.nspname || '.' || relation.relname as table_name, attribute.attname as name,
             pg_catalog.format_type(attribute.atttypid, attribute.atttypmod) as type, attribute.attnotnull as not_null
      from pg_catalog.pg_attribute as attribute
      join pg_catalog.pg_class as relation on relation.oid = attribute.attrelid
      join pg_catalog.pg_namespace as namespace on namespace.oid = relation.relnamespace
      where relation.relname like 'sales\\_%' and relation.relkind = 'r' and attribute.attnum > 0 and not attribute.attisdropped
      order by 1, attribute.attnum`),
    constraints: await s.query(`
      select namespace.nspname || '.' || relation.relname as table_name, con.conname as name, con.contype::text as type,
             con.condeferrable as deferrable, con.condeferred as deferred, pg_catalog.pg_get_constraintdef(con.oid) as definition,
             coalesce((select array_agg(attribute.attname::text order by key.ordinality)
                       from unnest(con.conkey) with ordinality as key(attnum, ordinality)
                       join pg_catalog.pg_attribute as attribute on attribute.attrelid = con.conrelid and attribute.attnum = key.attnum), '{}') as columns
      from pg_catalog.pg_constraint as con
      join pg_catalog.pg_class as relation on relation.oid = con.conrelid
      join pg_catalog.pg_namespace as namespace on namespace.oid = relation.relnamespace
      where relation.relname like 'sales\\_%' order by 1, 2`),
    indexes: await s.query(`
      select index_class.relname as name, namespace.nspname || '.' || table_class.relname as table_name, idx.indisunique as unique,
             coalesce(pg_catalog.pg_get_expr(idx.indpred, idx.indrelid), '') as predicate,
             exists (select 1 from pg_catalog.pg_constraint as con where con.conindid = idx.indexrelid) as backs_constraint
      from pg_catalog.pg_index as idx
      join pg_catalog.pg_class as index_class on index_class.oid = idx.indexrelid
      join pg_catalog.pg_class as table_class on table_class.oid = idx.indrelid
      join pg_catalog.pg_namespace as namespace on namespace.oid = table_class.relnamespace
      where table_class.relname like 'sales\\_%'`),
    triggers: await s.query(`
      select namespace.nspname || '.' || relation.relname as table_name, trigger.tgname as name, trigger.tgtype::int as type,
             trigger.tgfoid::regprocedure::text as fn, trigger.tgconstraint <> 0 as is_constraint,
             trigger.tgdeferrable as deferrable, trigger.tginitdeferred as deferred,
             coalesce((select array_agg(attribute.attname::text order by attribute.attname::text)
                       from unnest(trigger.tgattr::int2[]) as key(attnum)
                       join pg_catalog.pg_attribute as attribute on attribute.attrelid = trigger.tgrelid and attribute.attnum = key.attnum), '{}') as columns
      from pg_catalog.pg_trigger as trigger
      join pg_catalog.pg_class as relation on relation.oid = trigger.tgrelid
      join pg_catalog.pg_namespace as namespace on namespace.oid = relation.relnamespace
      where relation.relname like 'sales\\_%' and not trigger.tgisinternal`),
    policies: await s.query(`
      select namespace.nspname || '.' || relation.relname as table_name, policy.polname as name, policy.polcmd::text as cmd,
             policy.polpermissive as permissive,
             coalesce((select string_agg(role.rolname::text, ',' order by role.rolname) from pg_catalog.pg_roles as role
                       where role.oid = any(policy.polroles)), 'PUBLIC') as roles,
             coalesce(pg_catalog.pg_get_expr(policy.polqual, policy.polrelid), '') as qual
      from pg_catalog.pg_policy as policy
      join pg_catalog.pg_class as relation on relation.oid = policy.polrelid
      join pg_catalog.pg_namespace as namespace on namespace.oid = relation.relnamespace
      where relation.relname like 'sales\\_%'`),
    functions: await s.query(`
      select proc.oid::pg_catalog.regprocedure::text as sig, proc.prosecdef as secdef, proc.provolatile::text as volatility,
             pg_catalog.pg_get_function_result(proc.oid) as result, pg_catalog.pg_get_userbyid(proc.proowner)::text as owner,
             coalesce(proc.proconfig, '{}') as config,
             (proc.proacl is null or exists (select 1 from pg_catalog.aclexplode(proc.proacl) as acl
                                             where acl.grantee = 0 and acl.privilege_type = 'EXECUTE')) as public_execute,
             pg_catalog.has_function_privilege('anon', proc.oid, 'EXECUTE') as anon,
             pg_catalog.has_function_privilege('authenticated', proc.oid, 'EXECUTE') as authenticated,
             pg_catalog.has_function_privilege('service_role', proc.oid, 'EXECUTE') as service_role
      from pg_catalog.pg_proc as proc
      join pg_catalog.pg_namespace as namespace on namespace.oid = proc.pronamespace
      where proc.proname like 'sales\\_%' and namespace.nspname not in ('pg_catalog', 'information_schema')`),
    privileges: await s.query(`
      select namespace.nspname || '.' || relation.relname as table_name, role.name as role, privilege.name as privilege,
             case when role.name = 'PUBLIC'
               then exists (select 1 from pg_catalog.aclexplode(coalesce(relation.relacl, pg_catalog.acldefault('r', relation.relowner))) as acl
                            where acl.grantee = 0 and acl.privilege_type = privilege.name)
               else pg_catalog.has_table_privilege(role.name, relation.oid, privilege.name) end as granted
      from pg_catalog.pg_class as relation
      join pg_catalog.pg_namespace as namespace on namespace.oid = relation.relnamespace
      cross join (values ('anon'), ('authenticated'), ('service_role'), ('PUBLIC')) as role(name)
      cross join (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')) as privilege(name)
      where relation.relname like 'sales\\_%' and relation.relkind in ('r', 'v')`),
    auditConstraints: (await s.query(`
      select con.conname || ' => ' || pg_catalog.pg_get_constraintdef(con.oid) as item
      from pg_catalog.pg_constraint as con
      where con.conrelid = 'public.sales_audit_log'::regclass and con.contype = 'c' order by con.conname`)).map((row) => row.item),
    salesCanMd5: (await s.query(`select pg_catalog.md5(replace(prosrc, chr(13), '')) as md5 from pg_catalog.pg_proc
      where oid = 'private.sales_can(text)'::regprocedure`))[0].md5,
  }));
}

async function nonSalesSnapshot(s) {
  return withEmptyPath(s, async () => (await s.query(`
    select pg_catalog.md5(coalesce(string_agg(item, E'\\n' order by item collate "C"), '')) as digest, count(*)::int as items
    from (
      select 'proc:' || proc.oid::regprocedure::text || ':' || pg_catalog.md5(pg_catalog.pg_get_functiondef(proc.oid))
             || ':' || coalesce(proc.proacl::text, '') || ':' || proc.prosecdef::text as item
      from pg_catalog.pg_proc as proc join pg_catalog.pg_namespace as namespace on namespace.oid = proc.pronamespace
      where namespace.nspname in ('public', 'private', 'auth', 'supabase_migrations') and proc.proname not like 'sales\\_%' and proc.prokind = 'f'
      union all
      select 'rel:' || namespace.nspname || '.' || relation.relname || ':' || relation.relkind::text || ':'
             || coalesce(relation.relacl::text, '') || ':' || relation.relrowsecurity::text
      from pg_catalog.pg_class as relation join pg_catalog.pg_namespace as namespace on namespace.oid = relation.relnamespace
      where namespace.nspname in ('public', 'private', 'auth', 'supabase_migrations') and relation.relname not like 'sales\\_%'
      union all
      select 'con:' || con.conrelid::regclass::text || ':' || con.conname || ':' || pg_catalog.pg_get_constraintdef(con.oid)
      from pg_catalog.pg_constraint as con join pg_catalog.pg_class as relation on relation.oid = con.conrelid
      join pg_catalog.pg_namespace as namespace on namespace.oid = relation.relnamespace
      where namespace.nspname in ('public', 'private', 'auth', 'supabase_migrations') and relation.relname not like 'sales\\_%'
      union all
      select 'pol:' || policy.polrelid::regclass::text || ':' || policy.polname from pg_catalog.pg_policy as policy where policy.polname not like 'sales\\_%'
      union all
      select 'trg:' || trigger.tgrelid::regclass::text || ':' || trigger.tgname from pg_catalog.pg_trigger as trigger
      where not trigger.tgisinternal and trigger.tgname not like 'sales\\_%'
      union all
      select 'ns:' || namespace.nspname || ':' || coalesce(namespace.nspacl::text, '') from pg_catalog.pg_namespace as namespace
      where namespace.nspname in ('public', 'private', 'auth', 'supabase_migrations')
      union all
      select 'defacl:' || coalesce(acl.defaclacl::text, '') || ':' || acl.defaclobjtype::text from pg_catalog.pg_default_acl as acl
    ) as items`))[0]);
}

const TRIGGER_EVENTS = [[4, "INSERT"], [8, "DELETE"], [16, "UPDATE"], [32, "TRUNCATE"]];
const decodeTrigger = (row) => ({
  table: row.table_name, name: row.name, timing: row.type & 2 ? "BEFORE" : "AFTER", level: row.type & 1 ? "ROW" : "STATEMENT",
  events: TRIGGER_EVENTS.filter(([bit]) => row.type & bit).map(([, name]) => name).sort(),
  columns: [...row.columns].sort(), fn: row.fn, constraint: row.is_constraint,
  ...(row.is_constraint ? { deferrable: row.deferrable, deferred: row.deferred } : {}),
});

async function verifyCatalog(s) {
  const actual = await catalog(s);
  const expectedRelations = [
    ...Object.keys(EXPECTED.TABLES).map((name) => `${name}:r`),
    ...EXPECTED.VIEWS.map((name) => `${name}:v`),
    ...EXPECTED.SEQUENCES.map((name) => `${name}:S`),
    ...EXPECTED.INDEXES.map((index) => `public.${index.name}:i`),
    ...Object.values(EXPECTED.TABLES).flatMap((table) => table.keys.filter((key) => key.type !== "f").map((key) => `public.${key.name}:i`)),
  ].sort();
  assert.deepEqual(actual.relations.map((row) => `${row.name}:${row.kind}`).sort(), expectedRelations, "relation inventory");

  for (const [table, spec] of Object.entries(EXPECTED.TABLES)) {
    assert.equal(actual.relations.find((row) => row.name === table).rls, true, `${table} RLS`);
    assert.deepEqual(actual.columns.filter((row) => row.table_name === table).map((row) => [row.name, row.type, row.not_null]),
      spec.columns, `${table} columns`);
    const constraints = actual.constraints.filter((row) => row.table_name === table);
    assert.equal(constraints.filter((row) => row.type === "c").length, spec.checkConstraints, `${table} check count`);
    const keys = constraints.filter((row) => ["p", "u", "f"].includes(row.type)).map((row) => ({
      name: row.name, type: row.type, columns: [...row.columns],
      ...(row.type === "f" ? { references: row.definition.match(/REFERENCES (\S+\(.*?\))/)[1] } : {}),
      ...(row.deferrable ? { deferrable: true, deferred: row.deferred } : {}),
    }));
    assert.deepEqual(keys.sort((a, b) => a.name.localeCompare(b.name)), [...spec.keys].sort((a, b) => a.name.localeCompare(b.name)), `${table} keys`);
  }
  const view = actual.relations.find((row) => row.name === "public.sales_lead_attribution");
  assert.ok([...view.options].includes("security_invoker=true"), "view is security_invoker");

  for (const index of EXPECTED.INDEXES) {
    const row = actual.indexes.find((item) => item.name === index.name);
    assert.ok(row, `index ${index.name}`);
    assert.equal(row.table_name, index.table);
    assert.equal(row.unique, index.unique, `${index.name} unique`);
    assert.equal(row.backs_constraint, false);
    if (index.predicate.length === 0) assert.equal(row.predicate, "", `${index.name} not partial`);
    for (const fragment of index.predicate) assert.ok(row.predicate.includes(fragment), `${index.name} predicate ${fragment}: ${row.predicate}`);
  }

  assert.deepEqual(actual.triggers.map(decodeTrigger).sort((a, b) => a.name.localeCompare(b.name)),
    EXPECTED.TRIGGERS.map((t) => ({ ...t, columns: [...t.columns].sort() })).sort((a, b) => a.name.localeCompare(b.name)), "triggers");

  assert.equal(actual.policies.length, EXPECTED.POLICIES.length, "policy count");
  for (const policy of EXPECTED.POLICIES) {
    const row = actual.policies.find((item) => item.name === policy.name);
    assert.ok(row, `policy ${policy.name}`);
    assert.equal(row.table_name, policy.table);
    assert.equal(row.cmd, "r");
    assert.equal(row.permissive, true);
    assert.equal(row.roles, policy.roles);
    for (const fragment of policy.mustContain) assert.ok(row.qual.includes(fragment), `${policy.name}: ${fragment}`);
  }

  assert.deepEqual(actual.functions.map((row) => row.sig).sort(), EXPECTED.FUNCTIONS.map((fn) => fn.sig).sort(), "function inventory");
  for (const fn of EXPECTED.FUNCTIONS) {
    const row = actual.functions.find((item) => item.sig === fn.sig);
    assert.equal(row.secdef, fn.secdef, `${fn.sig} secdef`);
    assert.equal(row.volatility, fn.volatility, `${fn.sig} volatility`);
    assert.equal(row.result, fn.result, `${fn.sig} result`);
    assert.equal(row.owner, EXPECTED.FUNCTION_OWNER, `${fn.sig} owner`);
    assert.deepEqual([...row.config], EXPECTED.FUNCTION_CONFIG, `${fn.sig} search_path`);
    assert.equal(row.public_execute, false, `${fn.sig} PUBLIC execute`);
    for (const role of ["anon", "authenticated", "service_role"]) {
      assert.equal(row[role], fn.execute.includes(role), `${fn.sig} EXECUTE ${role}`);
    }
  }
  for (const row of actual.privileges) {
    assert.equal(row.granted, EXPECTED.TABLE_PRIVILEGES[row.role].includes(row.privilege), `${row.table_name} ${row.privilege} ${row.role}`);
  }
  assert.deepEqual(actual.auditConstraints, EXPECTED.INC2_AUDIT_CONSTRAINTS, "audit constraints (Inc2)");
  assert.equal(actual.salesCanMd5, EXPECTED.INC2_SALES_CAN_MD5, "sales_can body (Inc2)");
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

const TESTS = [];
const test = (name, options, fn) => {
  if (typeof options === "function") TESTS.push({ name, fn: options });
  else TESTS.push({ name, ...options, fn });
};

const LEAD = (email, extra = {}) => ({ email, ...extra });

test("catalog: cumulative inventory, columns, keys, triggers, policies, functions, grants, audit CHECKs and sales_can match the spec", async ({ s }) => {
  await verifyCatalog(s);
});

test("catalog: Increment 2 changed nothing outside Sales", async ({ s, afterInc1 }) => {
  assert.deepEqual(await nonSalesSnapshot(s), afterInc1);
});

test("migration guard: drifted sales_can or audit CHECKs abort the whole Increment 2 migration", { isolatedDb: true, inc1Only: true }, async ({ s, migrationSql }) => {
  const salesObjects = async () => countOf(s, "select count(*) from pg_class where relname like 'sales\\_lead%'");
  // Drift 1: sales_can body differs.
  await s.exec(`create or replace function private.sales_can(requested_action text) returns boolean language sql stable security definer set search_path = '' as $$ select false $$;`);
  await rejects(applySql(s, migrationSql), "SALES_MIGRATION_DRIFT");
  assert.equal(await salesObjects(), 0);
  assert.equal((await s.query("select md5(replace(prosrc, chr(13), '')) m from pg_proc where oid = 'private.sales_can(text)'::regprocedure"))[0].m,
    (await s.query("select md5($1) m", [" select false "]))[0].m, "sales_can left as it was");
  // Restore exact Inc1 body, then drift 2: an audit CHECK differs.
  await s.exec(readFileSync(INC1_MIGRATION_PATH, "utf8").match(/create function private\.sales_can[\s\S]*?\$\$;/)[0].replace("create function", "create or replace function"));
  await s.exec("alter table public.sales_audit_log drop constraint sales_audit_log_entity_type_check; alter table public.sales_audit_log add constraint sales_audit_log_entity_type_check check (entity_type in ('pipeline', 'stage', 'other'))");
  await rejects(applySql(s, migrationSql), "SALES_MIGRATION_DRIFT");
  assert.equal(await salesObjects(), 0);
  // Restore and apply cleanly; re-applying fails loudly.
  await s.exec("alter table public.sales_audit_log drop constraint sales_audit_log_entity_type_check; alter table public.sales_audit_log add constraint sales_audit_log_entity_type_check check (entity_type in ('pipeline', 'stage'))");
  await applySql(s, migrationSql);
  await verifyCatalog(s);
  await rejects(applySql(s, migrationSql), "SALES_MIGRATION_DRIFT");
});

test("authz: sales_can matrix including manage_leads", async ({ s, tenant }) => {
  const t = await tenant();
  const other = await tenant();
  const noOrg = await createUser(s);
  const multi = await createUser(s, [[t.org, "member"], [other.org, "founder"]], t.org);
  const can = (user, action) => as(s, user, async () => (await s.query("select private.sales_can($1) as ok", [action]))[0].ok);
  for (const action of ["read", "manage_pipeline", "manage_leads"]) {
    assert.equal(await can(t.founder, action), true, `founder ${action}`);
    assert.equal(await can(t.admin, action), true, `admin ${action}`);
    for (const [label, user] of [["area_lead", t.lead], ["member", t.member], ["no org", noOrg], ["no uid", null], ["multi member", multi]]) {
      assert.equal(await can(user, action), false, `${label} ${action}`);
    }
  }
  for (const action of ["manage_lead", "MANAGE_LEADS", "manage_leads ", "", null, "leads"]) {
    assert.equal(await can(t.founder, action), false, `unknown ${JSON.stringify(action)}`);
  }
});

test("authz: every lead RPC denied for area_lead, member, ghost, missing JWT, anon and service_role", async ({ s, tenant }) => {
  const t = await tenant();
  const { lead } = await rpc.ingest(s, t.founder, LEAD("authz@example.com"));
  const noOrg = await createUser(s);
  const calls = (user, role = "authenticated") => [
    () => as(s, user, () => s.query(SQL.ingest, [J(LEAD("x@example.com")), null, null]), role),
    () => as(s, user, () => s.query(SQL.addTouch, [lead.id, J({}), null]), role),
    () => as(s, user, () => s.query(SQL.update, [lead.id, J({ full_name: "X" }), 1]), role),
    () => as(s, user, () => s.query(SQL.qualify, [lead.id, "fit", null, 1]), role),
    () => as(s, user, () => s.query(SQL.disqualify, [lead.id, "no_fit", null, 1]), role),
    () => as(s, user, () => s.query(SQL.archive, [lead.id, "test", 1]), role),
  ];
  for (const user of [t.lead, t.member]) for (const call of calls(user)) await rejects(call(), "SALES_FORBIDDEN");
  for (const call of calls(null)) await rejects(call(), "SALES_AUTH_REQUIRED");
  for (const call of calls(noOrg)) await rejects(call(), "SALES_NO_ACTIVE_ORGANIZATION");
  for (const role of ["anon", "service_role"]) for (const call of calls(null, role)) await rejects(call(), /permission denied for function/);
  const after = await leadRow(s, lead.id);
  assert.equal(Number(after.version), 1);
  assert.equal(after.touch_count, 1);
  assert.equal((await auditRows(s, t.org)).length, 1);
});

test("authz: private lead helpers are not callable by API roles", async ({ s, tenant }) => {
  const t = await tenant();
  for (const sql of [
    `select private.sales_ingest_lead_core('${t.org}', '{"email":"a@b.co"}', '{}', null, array['manual'])`,
    `select private.sales_transition_lead('${t.org}', gen_random_uuid(), 'qualified', 'fit', null, 1)`,
    `select private.sales_insert_touch('${t.org}', gen_random_uuid(), '{}', null, repeat('a', 64))`,
    `select private.sales_lock_organization_leads('${t.org}')`,
    "select private.sales_normalize_email('a@b.co')",
    "select private.sales_clean_touch('{}', array['manual'])",
  ]) {
    await rejects(as(s, t.founder, () => s.query(sql)), /permission denied for function/);
  }
});

test("isolation: organizations never see each other's leads, touches or attribution", async ({ s, tenant }) => {
  const a = await tenant();
  const b = await tenant();
  await rpc.ingest(s, a.founder, LEAD("shared@example.com"), { utm_source: "a-source" });
  await rpc.ingest(s, b.founder, LEAD("shared@example.com"), { utm_source: "b-source" });
  const seen = (user) => as(s, user, async () => ({
    leads: (await s.query("select organization_id from public.sales_leads")).map((row) => row.organization_id),
    touches: (await s.query("select organization_id, utm_source from public.sales_lead_touches")).map((row) => `${row.organization_id}:${row.utm_source}`),
    view: (await s.query("select organization_id, first_utm_source from public.sales_lead_attribution")).map((row) => `${row.organization_id}:${row.first_utm_source}`),
  }));
  assert.deepEqual(await seen(a.founder), { leads: [a.org], touches: [`${a.org}:a-source`], view: [`${a.org}:a-source`] });
  assert.deepEqual(await seen(b.admin), { leads: [b.org], touches: [`${b.org}:b-source`], view: [`${b.org}:b-source`] });
  for (const user of [a.lead, a.member, await createUser(s), null]) {
    assert.deepEqual(await seen(user), { leads: [], touches: [], view: [] }, "non-admin sees nothing");
  }
  for (const table of ["sales_leads", "sales_lead_touches", "sales_lead_attribution"]) {
    await rejects(as(s, null, () => s.query(`select * from public.${table}`), "anon"), /permission denied/);
    await rejects(as(s, null, () => s.query(`select * from public.${table}`), "service_role"), /permission denied/);
  }
});

test("isolation: cross-organization lead ids behave exactly like missing ids", async ({ s, tenant }) => {
  const a = await tenant();
  const b = await tenant();
  const { lead: bLead } = await rpc.ingest(s, b.founder, LEAD("b@example.com"));
  const missing = randomUUID();
  for (const id of [bLead.id, missing]) {
    await rejects(rpc.addTouch(s, a.founder, id, {}), "SALES_NOT_FOUND");
    await rejects(rpc.update(s, a.founder, id, { full_name: "Owned" }, 1), "SALES_NOT_FOUND");
    await rejects(rpc.qualify(s, a.founder, id, "fit", null, 1), "SALES_NOT_FOUND");
    await rejects(rpc.disqualify(s, a.founder, id, "no_fit", null, 1), "SALES_NOT_FOUND");
    await rejects(rpc.archive(s, a.founder, id, "test", 1), "SALES_NOT_FOUND");
  }
  const after = await leadRow(s, bLead.id);
  assert.equal(Number(after.version), 1);
  assert.equal(after.status, "new");
  assert.equal(after.touch_count, 1);
  assert.equal((await auditRows(s, a.org)).length, 0);
  assert.equal((await auditRows(s, b.org)).length, 1);
});

test("isolation: composite foreign key prevents a touch linking to another organization's lead", async ({ s, tenant }) => {
  const a = await tenant();
  const b = await tenant();
  const { lead: bLead } = await rpc.ingest(s, b.founder, LEAD("fk@example.com"));
  await rejects(ownerTx(s, `insert into public.sales_lead_touches (organization_id, lead_id, occurred_at, ingestion_channel, request_hash, actor_type, created_by)
    values ('${a.org}', '${bLead.id}', now(), 'manual', repeat('a', 64), 'user', '${a.founder}')`), "sales_lead_touches_lead_fkey");
  await rejects(ownerTx(s, `update public.sales_leads set organization_id = '${a.org}' where id = '${bLead.id}'`), "SALES_IMMUTABLE");
});

test("grants: direct writes on leads, touches and the view are denied for every API role", async ({ s, tenant }) => {
  const t = await tenant();
  const { lead, touch } = await rpc.ingest(s, t.founder, LEAD("dml@example.com"));
  const statements = [
    `insert into public.sales_leads (organization_id, email, email_normalized, created_via, actor_type, created_by) values ('${t.org}', 'z@z.co', 'z@z.co', 'manual', 'user', '${t.founder}')`,
    `update public.sales_leads set full_name = 'Hacked' where id = '${lead.id}'`,
    `delete from public.sales_leads where id = '${lead.id}'`,
    "truncate public.sales_leads cascade",
    `insert into public.sales_lead_touches (organization_id, lead_id, occurred_at, ingestion_channel, request_hash, actor_type, created_by) values ('${t.org}', '${lead.id}', now(), 'manual', repeat('a', 64), 'user', '${t.founder}')`,
    `update public.sales_lead_touches set utm_source = 'x' where id = '${touch.id}'`,
    `delete from public.sales_lead_touches where id = '${touch.id}'`,
    "truncate public.sales_lead_touches",
    "delete from public.sales_lead_attribution",
  ];
  for (const [role, user] of [["authenticated", t.founder], ["anon", null], ["service_role", null]]) {
    for (const sql of statements) await rejects(as(s, user, () => s.query(sql), role), /permission denied|cannot delete from view/);
  }
  assert.equal((await leadRow(s, lead.id)).full_name, null);
  assert.equal(await countOf(s, "select count(*) from public.sales_lead_touches where lead_id = $1", [lead.id]), 1);
});

test("identity: email normalization matches the Email Marketing normalizer (parity vectors)", async ({ s }) => {
  await s.exec(EMAIL_NORMALIZER_FIXTURE);
  const vectors = [
    "a@b.co", "  Ana.Perez+promo@Example.COM  ", "ANA@EXAMPLE.COM", "first.last@sub.example.org", "x@y", "no-at-sign",
    "@example.com", "a@", ".a@example.com", "a.@example.com", "a..b@example.com", "a@-example.com", "a@example..com",
    "a b@example.com", "a@exa mple.com", "user@xn--bcher-kva.example", "u@1.2.3.4", "o'neil@example.ie", "a!#$%&'*+/=?^_`{|}~-@example.com",
    `${"a".repeat(64)}@example.com`, `${"a".repeat(65)}@example.com`, `a@${"b".repeat(63)}.com`, `a@${"b".repeat(64)}.com`,
    `${"a".repeat(64)}@${"b".repeat(60)}.${"c".repeat(60)}.${"d".repeat(60)}.com`, "\tTab@Example.com\n", "", " ",
    "ñandu@example.com", "a@example.c", "a@example.co1", "a@ex_ample.com", "a@@example.com", "a@b@c.com",
  ];
  const rows = await s.query(`select v, private.sales_normalize_email(v) as sales, parity.email_normalize_address(v) as email
    from unnest($1::text[]) as v`, [vectors]);
  for (const row of rows) assert.equal(row.sales, row.email, `parity for ${JSON.stringify(row.v)}`);
  assert.equal(rows.find((row) => row.v.includes("Ana.Perez")).sales, "ana.perez+promo@example.com", "no dot/+tag stripping");
  assert.ok(rows.filter((row) => row.sales === null).length > 10, "invalid vectors rejected");
  await s.exec("drop schema parity cascade");
});

test("identity: phone normalization is formatting-only and never infers a country", async ({ s }) => {
  const cases = [
    ["+1 (787) 555-0101", "+17875550101"], ["787.555.0101", "7875550101"], ["787-555-0101", "7875550101"],
    ["  +34 600 123 456 ", "+34600123456"], ["5550101", "5550101"], ["123456", null], ["+1234567890123456", null],
    ["787 555 0101 ext 2", null], ["+1+787", null], ["787/555/0101", null], ["", null], ["phone", null], ["+", null],
    ["123456789012345", "123456789012345"], ["\t7875550101\n", "7875550101"], ["78755501O1", null],
  ];
  const rows = await s.query("select v, private.sales_normalize_phone(v) as n from unnest($1::text[]) as v", [cases.map(([value]) => value)]);
  rows.forEach((row, index) => assert.equal(row.n, cases[index][1], `phone ${JSON.stringify(row.v)}`));
});

test("identity: minimum identity, validation and boundary lengths", async ({ s, tenant }) => {
  const t = await tenant();
  const ok = async (lead) => (await rpc.ingest(s, t.founder, lead)).lead;
  const emailOnly = await ok({ email: " Solo@Example.com " });
  assert.equal(emailOnly.email, "Solo@Example.com");
  assert.equal(emailOnly.email_normalized, "solo@example.com");
  const phoneOnly = await ok({ phone: "+1 (787) 555-0199" });
  assert.equal(phoneOnly.phone_normalized, "+17875550199");
  const externalOnly = await ok({ external_source: "meta_lead_ads", external_id: "lead-001" });
  assert.equal(externalOnly.created_via, "manual");
  const full = await ok({ email: "full@example.com", full_name: `  ${"N".repeat(200)} `, company_name: "C".repeat(200) });
  assert.equal(full.full_name.length, 200);
  const invalid = [
    [{ full_name: "Only A Name" }, "lead.identity"],
    [{}, "lead.identity"],
    [{ email: "   ", phone: "" }, "lead.identity"],
    [{ email: "not-an-email" }, "lead.email"],
    [{ email: `${"a".repeat(250)}@x.co` }, "lead.email"],
    [{ phone: "123" }, "lead.phone"],
    [{ email: "ok@example.com", full_name: "N".repeat(201) }, "lead.full_name"],
    [{ email: "ok@example.com", company_name: "bad\u0001name" }, "lead.company_name"],
    [{ external_source: "meta_lead_ads" }, "lead.external"],
    [{ external_id: "x" }, "lead.external"],
    [{ external_source: "Bad Source", external_id: "x" }, "lead.external"],
    [{ external_source: "src", external_id: "has space" }, "lead.external"],
    [{ external_source: "src", external_id: "x".repeat(201) }, "lead.external"],
    [{ email: "ok@example.com", organization_id: t.org }, "lead.organization_id"],
    [{ email: 42 }, "lead.email"],
    [[], "lead"],
    [null, "lead"],
  ];
  for (const [lead, field] of invalid) {
    const error = await rejects(rpc.ingest(s, t.founder, lead), "SALES_INVALID_INPUT");
    assert.ok(errorText(error).includes(field), `${JSON.stringify(lead)} -> ${field}: ${errorText(error)}`);
  }
  assert.equal(await countOf(s, "select count(*) from public.sales_leads where organization_id = $1", [t.org]), 4);
  assert.equal((await auditRows(s, t.org)).length, 4);
});

test("identity: matching order external > email > phone, archived never matched, no cross-org dedupe", async ({ s, tenant }) => {
  const t = await tenant();
  const other = await tenant();
  const byEmail = await rpc.ingest(s, t.founder, { email: "match@example.com", phone: "7875550001" });
  const byExternal = await rpc.ingest(s, t.founder, { external_source: "crm_x", external_id: "E-1", email: "ext@example.com" });
  const byPhone = await rpc.ingest(s, t.founder, { phone: "787-555-0002" });
  assert.equal(byEmail.lead_created && byExternal.lead_created && byPhone.lead_created, true);

  // External key wins even when the email points at another lead.
  const r1 = await rpc.ingest(s, t.founder, { external_source: "crm_x", external_id: "E-1", email: "match@example.com" });
  assert.equal(r1.lead.id, byExternal.lead.id);
  assert.equal(r1.lead_created, false);
  // Email (normalized) matches regardless of case and spacing.
  const r2 = await rpc.ingest(s, t.founder, { email: "  MATCH@example.COM ", phone: "7875550002" });
  assert.equal(r2.lead.id, byEmail.lead.id, "email beats phone");
  // Phone is used only when no email is supplied.
  const r3 = await rpc.ingest(s, t.founder, { phone: "(787) 555 0002" });
  assert.equal(r3.lead.id, byPhone.lead.id);
  const r4 = await rpc.ingest(s, t.founder, { phone: "7875550002", email: "different@example.com" });
  assert.notEqual(r4.lead.id, byPhone.lead.id, "an email-bearing submission does not match by phone");
  assert.equal(r4.lead_created, true);

  // Archived leads are not matched: the same email creates a new lead.
  await rpc.archive(s, t.founder, byEmail.lead.id, "duplicate", Number((await leadRow(s, byEmail.lead.id)).version));
  const r5 = await rpc.ingest(s, t.founder, { email: "match@example.com" });
  assert.notEqual(r5.lead.id, byEmail.lead.id);
  assert.equal(r5.lead_created, true);
  // Same email in another organization is a different lead.
  const r6 = await rpc.ingest(s, other.founder, { email: "match@example.com" });
  assert.equal(r6.lead_created, true);
  assert.equal(r6.lead.organization_id, other.org);

  const audit = await auditRows(s, t.org);
  assert.deepEqual(audit.filter((row) => row.action === "sales.lead.touch_added").map((row) => row.details.matched_by), ["external", "email", "phone"]);
});

test("identity: database uniqueness backstop for active email and external key", async ({ s, tenant }) => {
  const t = await tenant();
  await rpc.ingest(s, t.founder, { email: "dup@example.com", external_source: "src", external_id: "K1" });
  await rejects(ownerTx(s, `insert into public.sales_leads (organization_id, email, email_normalized, created_via, actor_type, created_by)
    values ('${t.org}', 'DUP@example.com', 'dup@example.com', 'manual', 'user', '${t.founder}')`), "sales_leads_active_email_idx");
  await rejects(ownerTx(s, `insert into public.sales_leads (organization_id, phone, phone_normalized, external_source, external_id, created_via, actor_type, created_by)
    values ('${t.org}', '7875550000', '7875550000', 'src', 'K1', 'manual', 'user', '${t.founder}')`), "sales_leads_active_external_idx");
  await rejects(ownerTx(s, `insert into public.sales_leads (organization_id, full_name, created_via, actor_type, created_by)
    values ('${t.org}', 'Name Only', 'manual', 'user', '${t.founder}')`), /check constraint/);
});

test("idempotency: exact replay returns the original; a different payload conflicts; nothing is duplicated", async ({ s, tenant }) => {
  const t = await tenant();
  const lead = { email: "idem@example.com", full_name: "Idem" };
  const touch = { utm_source: "Google", channel: "paid_search" };
  const first = await rpc.ingest(s, t.founder, lead, touch, "idem-key-0001");
  const replay = await rpc.ingest(s, t.admin, lead, touch, "idem-key-0001");
  assert.equal(replay.replayed, true);
  assert.equal(replay.touch.id, first.touch.id);
  assert.equal(replay.lead.id, first.lead.id);
  assert.equal(replay.lead_created, true, "replay reports the original outcome");
  await rejects(rpc.ingest(s, t.founder, lead, { ...touch, utm_source: "bing" }, "idem-key-0001"), "SALES_IDEMPOTENCY_CONFLICT");
  await rejects(rpc.ingest(s, t.founder, { email: "other@example.com" }, touch, "idem-key-0001"), "SALES_IDEMPOTENCY_CONFLICT");
  await rejects(rpc.addTouch(s, t.founder, first.lead.id, touch, "idem-key-0001"), "SALES_IDEMPOTENCY_CONFLICT");
  // External event ids dedupe the same way.
  const event = { event_source: "meta", external_event_id: "evt-1" };
  const e1 = await rpc.addTouch(s, t.founder, first.lead.id, event);
  const e2 = await rpc.addTouch(s, t.founder, first.lead.id, event);
  assert.equal(e2.replayed, true);
  assert.equal(e2.touch.id, e1.touch.id);
  await rejects(rpc.addTouch(s, t.founder, first.lead.id, { ...event, utm_source: "x" }), "SALES_IDEMPOTENCY_CONFLICT");
  // Add-touch with its own key.
  const k1 = await rpc.addTouch(s, t.founder, first.lead.id, { utm_campaign: "fall" }, "touch-key-0001");
  const k2 = await rpc.addTouch(s, t.founder, first.lead.id, { utm_campaign: "fall" }, "touch-key-0001");
  assert.equal(k2.touch.id, k1.touch.id);
  for (const bad of ["short", "has space key", "x".repeat(129), "bad/char*"]) {
    await rejects(rpc.ingest(s, t.founder, lead, touch, bad), "SALES_INVALID_INPUT");
  }
  assert.equal(await countOf(s, "select count(*) from public.sales_lead_touches where organization_id = $1", [t.org]), 3);
  assert.equal((await leadRow(s, first.lead.id)).touch_count, 3);
  assert.deepEqual((await auditRows(s, t.org)).map((row) => row.action),
    ["sales.lead.created", "sales.lead.touch_added", "sales.lead.touch_added"]);
});

test("attribution: normalized fields, raw evidence and click ids are stored as captured", async ({ s, tenant }) => {
  const t = await tenant();
  const assetId = randomUUID();
  const funnelId = randomUUID();
  const { touch } = await rpc.ingest(s, t.founder, { email: "attr@example.com" }, {
    ingestion_channel: "import", channel: "paid_social", occurred_at: "2026-09-01T10:00:00Z",
    utm_source: "  Facebook ", utm_medium: "CPC", utm_campaign: "Fall_Sale", utm_term: "", utm_content: null,
    referrer_url: "https://l.facebook.com/", landing_url: "https://example.com/landing?utm_source=Facebook#top",
    landing_asset_id: assetId, funnel_id: funnelId, campaign_ref: "email:campaign/42",
    click_ids: { fbclid: "IwAR0abc", gclid: "Cj0KCQ" }, raw: { utm_source: "  Facebook ", form: "contact" },
  });
  assert.equal(touch.ingestion_channel, "import");
  assert.equal(touch.channel, "paid_social");
  assert.equal(touch.utm_source, "facebook");
  assert.equal(touch.utm_medium, "cpc");
  assert.equal(touch.utm_campaign, "fall_sale");
  assert.equal(touch.utm_term, null);
  assert.equal(touch.utm_content, null);
  assert.equal(touch.landing_asset_id, assetId);
  assert.equal(touch.funnel_id, funnelId);
  assert.deepEqual(touch.click_ids, { fbclid: "IwAR0abc", gclid: "Cj0KCQ" });
  assert.deepEqual(touch.raw, { utm_source: "  Facebook ", form: "contact" });
  assert.equal(new Date(touch.occurred_at).toISOString(), "2026-09-01T10:00:00.000Z");
  const defaults = (await rpc.ingest(s, t.founder, { email: "defaults@example.com" })).touch;
  assert.equal(defaults.ingestion_channel, "manual");
  assert.equal(defaults.channel, "unknown");
  assert.deepEqual(defaults.click_ids, {});
  assert.ok(Math.abs(new Date(defaults.occurred_at) - new Date(defaults.received_at)) < 5000);
});

test("attribution: first/last touch derived deterministically, back-fill becomes first, ties by received order", async ({ s, tenant }) => {
  const t = await tenant();
  const created = await rpc.ingest(s, t.founder, { email: "order@example.com" }, { occurred_at: "2026-09-10T00:00:00Z", utm_source: "first" });
  const id = created.lead.id;
  let view = await attribution(s, id);
  assert.equal(view.first_touch_id, created.touch.id);
  assert.equal(view.last_touch_id, created.touch.id);
  const later = await rpc.addTouch(s, t.founder, id, { occurred_at: "2026-09-20T00:00:00Z", utm_source: "later" });
  view = await attribution(s, id);
  assert.equal(view.first_touch_id, created.touch.id, "a later touch never changes first touch");
  assert.equal(view.last_touch_id, later.touch.id);
  assert.equal(view.last_utm_source, "later");
  const backfill = await rpc.addTouch(s, t.founder, id, { occurred_at: "2026-09-01T00:00:00Z", utm_source: "backfill", ingestion_channel: "import" });
  view = await attribution(s, id);
  assert.equal(view.first_touch_id, backfill.touch.id, "an earlier back-filled touch becomes first");
  assert.equal(view.first_utm_source, "backfill");
  assert.equal(view.last_touch_id, later.touch.id);
  // Equal occurred_at: received order decides (first = earlier received, last = later received).
  const tieA = await rpc.addTouch(s, t.founder, id, { occurred_at: "2026-09-25T00:00:00Z", utm_source: "tie-a" });
  const tieB = await rpc.addTouch(s, t.founder, id, { occurred_at: "2026-09-25T00:00:00Z", utm_source: "tie-b" });
  view = await attribution(s, id);
  assert.equal(view.last_touch_id, tieB.touch.id);
  assert.equal(view.touch_count, 5);
  assert.equal((await leadRow(s, id)).touch_count, 5);
  // Repeated reads are identical.
  for (let index = 0; index < 3; index += 1) assert.deepEqual(await attribution(s, id), view);
  assert.ok(tieA.touch.received_at <= tieB.touch.received_at);
});

test("attribution: malformed, oversized and out-of-range evidence is rejected with the field name", async ({ s, tenant }) => {
  const t = await tenant();
  const { lead } = await rpc.ingest(s, t.founder, { email: "bad@example.com" });
  const big = Object.fromEntries(Array.from({ length: 51 }, (_, i) => [`k${i}`, "v"]));
  const heavy = Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`k${i}`, "x".repeat(1000)]));
  const future = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  const cases = [
    [{ referrer_url: "ftp://example.com/" }, "touch.referrer_url"],
    [{ landing_url: "javascript:alert(1)" }, "touch.landing_url"],
    [{ landing_url: "https://user:pass@example.com/" }, "touch.landing_url"],
    [{ landing_url: "https://exa mple.com/" }, "touch.landing_url"],
    [{ landing_url: `https://example.com/${"a".repeat(2040)}` }, "touch.landing_url"],
    [{ utm_source: "bad\u0007value" }, "touch.utm_source"],
    [{ utm_campaign: "c".repeat(201) }, "touch.utm_campaign"],
    [{ utm_medium: 5 }, "touch.utm_medium"],
    [{ click_ids: { evil: "x" } }, "touch.click_ids"],
    [{ click_ids: { gclid: "has space" } }, "touch.click_ids"],
    [{ click_ids: { gclid: "x".repeat(513) } }, "touch.click_ids"],
    [{ click_ids: ["gclid"] }, "touch.click_ids"],
    [{ raw: { nested: { a: 1 } } }, "touch.raw"],
    [{ raw: big }, "touch.raw"],
    [{ raw: { k: "x".repeat(1025) } }, "touch.raw"],
    [{ raw: heavy }, "touch.raw"],
    [{ raw: { "bad key": "v" } }, "touch.raw"],
    [{ occurred_at: future }, "touch.occurred_at"],
    [{ occurred_at: "2026-09-01 10:00:00" }, "touch.occurred_at"],
    [{ occurred_at: "1999-12-31T23:59:59Z" }, "touch.occurred_at"],
    [{ occurred_at: "2026-02-30T10:00:00Z" }, "touch.occurred_at"],
    [{ landing_asset_id: "not-a-uuid" }, "touch.landing_asset_id"],
    [{ funnel_id: "1234" }, "touch.funnel_id"],
    [{ campaign_ref: "bad ref" }, "touch.campaign_ref"],
    [{ channel: "tv" }, "touch.channel"],
    [{ ingestion_channel: "landing_page" }, "touch.ingestion_channel"],
    [{ ingestion_channel: "webhook" }, "touch.ingestion_channel"],
    [{ event_source: "meta" }, "touch.external_event"],
    [{ event_source: "Meta", external_event_id: "1" }, "touch.external_event"],
    [{ event_source: "meta", external_event_id: "has space" }, "touch.external_event"],
    [{ organization_id: t.org }, "touch.organization_id"],
    [{ received_at: "2026-01-01T00:00:00Z" }, "touch.received_at"],
  ];
  for (const [touch, field] of cases) {
    const error = await rejects(rpc.addTouch(s, t.founder, lead.id, touch), "SALES_INVALID_INPUT");
    assert.ok(errorText(error).includes(field), `${JSON.stringify(touch).slice(0, 80)} -> ${field}: ${errorText(error)}`);
  }
  // Boundaries that are accepted.
  const max = Object.fromEntries(Array.from({ length: 50 }, (_, i) => [`k${i}`, "v"]));
  await rpc.addTouch(s, t.founder, lead.id, { raw: max, utm_campaign: "c".repeat(200), landing_url: `https://example.com/${"a".repeat(2000)}`,
    occurred_at: new Date(Date.now() + 60 * 1000).toISOString(), click_ids: { li_fat_id: "x".repeat(512) } });
  assert.equal((await leadRow(s, lead.id)).touch_count, 2);
  assert.equal((await auditRows(s, t.org)).length, 2);
});

test("attribution: touches are append-only for every role, including the owner", async ({ s, tenant }) => {
  const t = await tenant();
  const { touch } = await rpc.ingest(s, t.founder, { email: "immutable@example.com" }, { utm_source: "orig" });
  await rejects(ownerTx(s, `update public.sales_lead_touches set utm_source = 'forged' where id = '${touch.id}'`), "SALES_IMMUTABLE");
  await rejects(ownerTx(s, `delete from public.sales_lead_touches where id = '${touch.id}'`), "SALES_IMMUTABLE");
  await rejects(ownerTx(s, "truncate public.sales_lead_touches"), "SALES_IMMUTABLE");
  await rejects(ownerTx(s, "truncate public.sales_leads, public.sales_lead_touches"), "SALES_IMMUTABLE");
  await rejects(ownerTx(s, `delete from public.sales_leads where id = '${touch.lead_id}'`), "SALES_IMMUTABLE");
  assert.equal((await s.query("select utm_source from public.sales_lead_touches where id = $1", [touch.id]))[0].utm_source, "orig");
});

test("attribution: 1000-touch cap per lead (RPC and database)", async ({ s, tenant }) => {
  const t = await tenant();
  const { lead } = await rpc.ingest(s, t.founder, { email: "cap@example.com" });
  await ownerTx(s, `insert into public.sales_lead_touches (organization_id, lead_id, occurred_at, ingestion_channel, request_hash, actor_type, created_by)
    select '${t.org}', '${lead.id}', now(), 'import', repeat('a', 64), 'user', '${t.founder}' from generate_series(1, 998)`);
  assert.equal((await leadRow(s, lead.id)).touch_count, 999);
  await rpc.addTouch(s, t.founder, lead.id, { utm_source: "1000th" });
  assert.equal((await leadRow(s, lead.id)).touch_count, 1000);
  await rejects(rpc.addTouch(s, t.founder, lead.id, {}), "SALES_TOUCH_LIMIT");
  await rejects(rpc.ingest(s, t.founder, { email: "cap@example.com" }), "SALES_TOUCH_LIMIT");
  await rejects(ownerTx(s, `insert into public.sales_lead_touches (organization_id, lead_id, occurred_at, ingestion_channel, request_hash, actor_type, created_by)
    values ('${t.org}', '${lead.id}', now(), 'import', repeat('a', 64), 'user', '${t.founder}')`), "sales_leads_touch_count_check");
  await rejects(ownerTx(s, `update public.sales_leads set touch_count = 0 where id = '${lead.id}'`), "SALES_IMMUTABLE");
  assert.equal(await countOf(s, "select count(*) from public.sales_lead_touches where lead_id = $1", [lead.id]), 1000);
});

test("lifecycle: qualify, disqualify, requalify, archive with reason, note, actor, timestamp and version", async ({ s, tenant }) => {
  const t = await tenant();
  const { lead } = await rpc.ingest(s, t.founder, { email: "life@example.com" });
  const q = await rpc.qualify(s, t.admin, lead.id, "fit", "  Good fit, budget confirmed  ", 1);
  assert.equal(q.status, "qualified");
  assert.equal(q.qualification_reason, "fit");
  assert.equal(q.qualification_note, "Good fit, budget confirmed");
  assert.equal(q.qualification_decided_by, t.admin);
  assert.ok(q.qualification_decided_at);
  assert.equal(Number(q.version), 2);
  const d = await rpc.disqualify(s, t.founder, lead.id, "no_budget", null, 2);
  assert.equal(d.status, "disqualified");
  assert.equal(d.qualification_reason, "no_budget");
  assert.equal(d.qualification_note, null);
  assert.equal(d.qualification_decided_by, t.founder);
  const r = await rpc.qualify(s, t.founder, lead.id, "timing", null, 3);
  assert.equal(r.status, "qualified");
  const a = await rpc.archive(s, t.founder, lead.id, "not_interested", 4);
  assert.equal(a.status, "archived");
  assert.equal(a.archive_reason, "not_interested");
  assert.equal(a.archived_by, t.founder);
  assert.equal(a.qualification_reason, "timing", "archive keeps the last decision");
  assert.equal(Number(a.version), 5);
  const again = await rpc.archive(s, t.admin, lead.id, "spam", 1);
  assert.equal(Number(again.version), 5, "re-archive is a no-op");
  for (const call of [
    () => rpc.qualify(s, t.founder, lead.id, "fit", null, 5),
    () => rpc.disqualify(s, t.founder, lead.id, "spam", null, 5),
    () => rpc.update(s, t.founder, lead.id, { full_name: "X" }, 5),
    () => rpc.addTouch(s, t.founder, lead.id, {}),
  ]) await rejects(call(), "SALES_LEAD_ARCHIVED");
  await rejects(ownerTx(s, `insert into public.sales_lead_touches (organization_id, lead_id, occurred_at, ingestion_channel, request_hash, actor_type, created_by)
    values ('${t.org}', '${lead.id}', now(), 'manual', repeat('a', 64), 'user', '${t.founder}')`), "SALES_LEAD_ARCHIVED");
  assert.deepEqual((await auditRows(s, t.org)).map((row) => row.action), [
    "sales.lead.created", "sales.lead.qualified", "sales.lead.disqualified", "sales.lead.qualified", "sales.lead.archived"]);
});

test("lifecycle: reason codes, notes, version conflicts, no-ops and invalid transitions", async ({ s, tenant }) => {
  const t = await tenant();
  const { lead } = await rpc.ingest(s, t.founder, { email: "rules@example.com" });
  for (const [call, label] of [
    [() => rpc.qualify(s, t.founder, lead.id, "no_fit", null, 1), "qualify with a disqualify reason"],
    [() => rpc.disqualify(s, t.founder, lead.id, "fit", null, 1), "disqualify with a qualify reason"],
    [() => rpc.archive(s, t.founder, lead.id, "fit", 1), "archive with a qualify reason"],
    [() => rpc.qualify(s, t.founder, lead.id, null, null, 1), "null reason"],
    [() => rpc.qualify(s, t.founder, lead.id, "fit", "n".repeat(501), 1), "note too long"],
    [() => rpc.qualify(s, t.founder, lead.id, "fit", "bad\u0001note", 1), "control character"],
    [() => rpc.qualify(s, t.founder, lead.id, "fit", null, null), "null version"],
  ]) {
    await rejects(call(), "SALES_INVALID_INPUT").catch((error) => { throw new Error(`${label}: ${error.message}`); });
  }
  await rejects(rpc.qualify(s, t.founder, lead.id, "fit", null, 7), "SALES_VERSION_CONFLICT");
  const q = await rpc.qualify(s, t.founder, lead.id, "fit", "note", 1);
  await rejects(rpc.qualify(s, t.admin, lead.id, "fit", "note", 1), "SALES_VERSION_CONFLICT");
  const noop = await rpc.qualify(s, t.admin, lead.id, "fit", " note ", 2);
  assert.equal(Number(noop.version), 2, "same decision again is a no-op");
  await rejects(rpc.qualify(s, t.admin, lead.id, "budget", null, 2), "SALES_INVALID_TRANSITION");
  await rejects(rpc.disqualify(s, t.admin, lead.id, "spam", null, 1), "SALES_VERSION_CONFLICT");
  await rejects(rpc.archive(s, t.admin, lead.id, "test", 1), "SALES_VERSION_CONFLICT");
  assert.equal(Number((await leadRow(s, lead.id)).version), Number(q.version));
  assert.equal((await auditRows(s, t.org)).length, 2, "failures and no-ops wrote nothing");
});

test("lifecycle: the database rejects invalid transitions and identity changes even for the owner", async ({ s, tenant }) => {
  const t = await tenant();
  const { lead } = await rpc.ingest(s, t.founder, { email: "guard@example.com", external_source: "src", external_id: "G1" });
  await rpc.qualify(s, t.founder, lead.id, "fit", null, 1);
  await rejects(ownerTx(s, `update public.sales_leads set status = 'new', qualification_reason = null, qualification_decided_at = null,
    qualification_decided_by = null where id = '${lead.id}'`), "SALES_INVALID_TRANSITION");
  for (const sql of [
    `update public.sales_leads set external_id = 'G2' where id = '${lead.id}'`,
    `update public.sales_leads set created_via = 'api' where id = '${lead.id}'`,
    `update public.sales_leads set created_by = gen_random_uuid() where id = '${lead.id}'`,
    `update public.sales_leads set touch_count = touch_count + 2 where id = '${lead.id}'`,
    `delete from public.sales_leads where id = '${lead.id}'`,
  ]) await rejects(ownerTx(s, sql), "SALES_IMMUTABLE");
  await ownerTx(s, `update public.sales_leads set full_name = 'Owner Edit', version = 1 where id = '${lead.id}'`);
  assert.equal(Number((await leadRow(s, lead.id)).version), 3, "version is always derived");
  await ownerTx(s, `update public.sales_leads set version = 99 where id = '${lead.id}'`);
  assert.equal(Number((await leadRow(s, lead.id)).version), 3);
  await rpc.archive(s, t.founder, lead.id, "test", 3);
  await rejects(ownerTx(s, `update public.sales_leads set full_name = 'After archive' where id = '${lead.id}'`), "SALES_IMMUTABLE");
  await rejects(ownerTx(s, `update public.sales_leads set status = 'qualified', archive_reason = null, archived_at = null, archived_by = null where id = '${lead.id}'`), "SALES_IMMUTABLE");
});

test("update: identity edits keep minimum identity and email uniqueness; audit lists field names only", async ({ s, tenant }) => {
  const t = await tenant();
  const { lead } = await rpc.ingest(s, t.founder, { email: "edit@example.com" });
  await rpc.ingest(s, t.founder, { email: "taken@example.com" });
  const u1 = await rpc.update(s, t.admin, lead.id, { full_name: "Maria Lopez", phone: "787 555 0300", company_name: "Panaderia" }, 1);
  assert.equal(u1.full_name, "Maria Lopez");
  assert.equal(u1.phone_normalized, "7875550300");
  assert.equal(Number(u1.version), 2);
  const noop = await rpc.update(s, t.admin, lead.id, { full_name: "  Maria Lopez " }, 2);
  assert.equal(Number(noop.version), 2);
  await rejects(rpc.update(s, t.admin, lead.id, { email: "TAKEN@example.com" }, 2), "SALES_LEAD_EMAIL_EXISTS");
  const caseOnly = await rpc.update(s, t.admin, lead.id, { email: "Edit@Example.com" }, 2);
  assert.equal(caseOnly.email_normalized, "edit@example.com");
  await rejects(rpc.update(s, t.admin, lead.id, { email: null, phone: null }, 3), "SALES_INVALID_INPUT");
  const cleared = await rpc.update(s, t.admin, lead.id, { email: null }, 3);
  assert.equal(cleared.email, null);
  assert.equal(cleared.phone_normalized, "7875550300");
  for (const changes of [{ external_id: "x" }, { status: "qualified" }, {}, [], { email: 5 }, { full_name: "x".repeat(201) }]) {
    await rejects(rpc.update(s, t.admin, lead.id, changes, 4), "SALES_INVALID_INPUT");
  }
  await rejects(rpc.update(s, t.admin, lead.id, { full_name: "Stale" }, 1), "SALES_VERSION_CONFLICT");
  const updates = (await auditRows(s, t.org)).filter((row) => row.action === "sales.lead.updated");
  assert.deepEqual(updates.map((row) => row.details.fields), [["phone", "full_name", "company_name"], ["email"], ["email"]]);
});

test("audit: one row per mutation, none on failure or no-op, and no personal data in details", async ({ s, tenant }) => {
  const t = await tenant();
  const pii = { email: "pii.person@example.com", phone: "+1 787 555 0400", full_name: "Persona Privada", company_name: "Empresa Secreta" };
  const { lead } = await rpc.ingest(s, t.founder, pii, { utm_source: "newsletter", utm_campaign: "otono" });
  await rpc.addTouch(s, t.founder, lead.id, { utm_source: "ads" });
  await rpc.ingest(s, t.founder, { email: "PII.Person@example.com" }, { channel: "email" });
  await rpc.update(s, t.founder, lead.id, { full_name: "Nombre Nuevo Privado" }, 1);
  await rpc.qualify(s, t.founder, lead.id, "fit", "Nota con dato privado 555-0400", 2);
  await rpc.disqualify(s, t.founder, lead.id, "spam", "otra nota privada", 3);
  await rpc.archive(s, t.founder, lead.id, "spam", 4);
  const audit = await auditRows(s, t.org);
  assert.deepEqual(audit.map((row) => [row.action, row.entity_type]), [
    ["sales.lead.created", "lead"], ["sales.lead.touch_added", "lead_touch"], ["sales.lead.touch_added", "lead_touch"],
    ["sales.lead.updated", "lead"], ["sales.lead.qualified", "lead"], ["sales.lead.disqualified", "lead"], ["sales.lead.archived", "lead"]]);
  assert.ok(audit.every((row) => row.actor_user_id === t.founder));
  const text = JSON.stringify(audit.map((row) => row.details)).toLowerCase();
  // Substrings that cannot occur inside the UUIDs legitimately present in details.
  for (const secret of ["pii.person", "example.com", "+1787", "+1 787", "555 0400", "persona", "privada", "empresa", "secreta",
    "nombre nuevo", "nota con", "otra nota"]) {
    assert.ok(!text.includes(secret), `audit details leak ${secret}`);
  }
  assert.equal(audit[0].details.has_email, true);
  assert.equal(audit[4].details.has_note, true);
});

test("audit: still append-only after the CHECK widening, and lead actions bind to lead entity types", async ({ s, tenant }) => {
  const t = await tenant();
  const { lead } = await rpc.ingest(s, t.founder, { email: "auditlock@example.com" });
  await rejects(ownerTx(s, `update public.sales_audit_log set details = '{"forged": true}' where organization_id = '${t.org}'`), "SALES_IMMUTABLE");
  await rejects(ownerTx(s, `delete from public.sales_audit_log where organization_id = '${t.org}'`), "SALES_IMMUTABLE");
  await rejects(ownerTx(s, "truncate public.sales_audit_log"), "SALES_IMMUTABLE");
  for (const [action, entity] of [["sales.lead.created", "stage"], ["sales.lead.touch_added", "lead"], ["sales.stage.created", "lead"], ["sales.lead.created", "lead_touch"], ["sales.lead.unknown", "lead"]]) {
    await rejects(ownerTx(s, `insert into public.sales_audit_log (organization_id, actor_user_id, action, entity_type, entity_id)
      values ('${t.org}', '${t.founder}', '${action}', '${entity}', '${lead.id}')`), /check constraint/);
  }
  assert.equal((await auditRows(s, t.org)).length, 1);
});

test("rollback: unused Inc2 rolls back to the exact Inc1 state, Inc1 rollback then works, and Inc2 reapplies", { isolatedDb: true }, async ({ s, migrationSql, rollbackSql, inc1Sql, fixSql, afterInc1 }) => {
  await verifyCatalog(s);
  await s.exec("insert into supabase_migrations.schema_migrations(version, name) values ('20261002120000', 'sales_v1_foundation'), ('20261003120000', 'sales_v1_leads_attribution')");
  // Inc1 data does not block the Inc2 rollback.
  const t = await createTenant(s);
  await as(s, t.founder, () => s.query("select public.sales_ensure_default_pipeline()"));
  await s.exec(rollbackSql);
  const state = await catalog(s);
  assert.equal(state.salesCanMd5, EXPECTED.INC1_SALES_CAN_MD5, "sales_can restored byte-exact");
  assert.deepEqual(state.auditConstraints, EXPECTED.INC1_AUDIT_CONSTRAINTS, "audit CHECKs restored exactly");
  assert.equal(state.relations.filter((row) => row.name.includes("sales_lead")).length, 0);
  assert.equal(state.functions.length, 14);
  assert.deepEqual(await nonSalesSnapshot(s), afterInc1);
  assert.equal(await countOf(s, "select count(*) from supabase_migrations.schema_migrations where version = '20261003120000'"), 0);
  assert.equal(await countOf(s, "select count(*) from supabase_migrations.schema_migrations where version = '20261002120000'"), 1);
  // Rolling back again fails closed.
  await rejects(s.exec(rollbackSql), /SALES_ROLLBACK_BLOCKED|does not exist/);
  await s.exec("rollback").catch(() => {});
  // The frozen Inc1 rollback accepts the restored state (proves byte-exact Inc1 inventory).
  await s.exec(readInc1Rollback().replace("begin;", "begin;\nselect set_config('orvesen.sales_rollback_confirm', 'DESTROY_SALES_V1_INC1_DATA', true);"));
  assert.equal(await countOf(s, "select count(*) from pg_class where relname like 'sales\\_%'"), 0);
  // Reapply both increments and verify.
  await applySql(s, inc1Sql);
  await applySql(s, fixSql);
  await applySql(s, migrationSql);
  await verifyCatalog(s);
  const t2 = await createTenant(s);
  assert.equal((await rpc.ingest(s, t2.founder, { email: "reapplied@example.com" })).lead_created, true);
});

test("rollback: blocked once Increment 2 has real data, and when an unknown Sales object exists", { isolatedDb: true }, async ({ s, rollbackSql }) => {
  const before = await catalog(s);
  // The frozen Increment 1 rollback refuses to run while Increment 2 exists.
  await rejects(s.exec(readInc1Rollback().replace("begin;",
    "begin;\nselect set_config('orvesen.sales_rollback_confirm', 'DESTROY_SALES_V1_INC1_DATA', true);")), "SALES_ROLLBACK_BLOCKED");
  await s.exec("rollback").catch(() => {});
  await s.exec("create table public.sales_lead_unexpected (id int)");
  await rejects(s.exec(rollbackSql), "SALES_ROLLBACK_BLOCKED");
  await s.exec("rollback").catch(() => {});
  await s.exec("drop table public.sales_lead_unexpected");
  const t = await createTenant(s);
  // A lead without any lead audit row (owner-level insert) still blocks: the
  // usage guard, not only the CHECK restore, protects lead data.
  await ownerTx(s, `insert into public.sales_leads (organization_id, email, email_normalized, created_via, actor_type, created_by)
    values ('${t.org}', 'owner@example.com', 'owner@example.com', 'manual', 'user', '${t.founder}')`);
  assert.equal(await countOf(s, "select count(*) from public.sales_audit_log where action like 'sales.lead.%'"), 0);
  await rejects(s.exec(rollbackSql), "SALES_ROLLBACK_BLOCKED");
  await s.exec("rollback").catch(() => {});
  assert.equal(await countOf(s, "select count(*) from public.sales_leads"), 1);
  // Normal use (lead + audit rows) blocks too.
  await rpc.ingest(s, t.founder, { email: "used@example.com" });
  await rejects(s.exec(rollbackSql), "SALES_ROLLBACK_BLOCKED");
  await s.exec("rollback").catch(() => {});
  assert.deepEqual((await catalog(s)).functions.map((row) => row.sig).sort(), before.functions.map((row) => row.sig).sort());
  assert.equal(await countOf(s, "select count(*) from public.sales_leads"), 2);
});

// ---------------------------------------------------------------------------
// Concurrency (real PostgreSQL only)
// ---------------------------------------------------------------------------

test("concurrency: 8 parallel ingestions of one email create one lead and 8 touches", { concurrency: true }, async ({ s, db, tenant }) => {
  const t = await tenant();
  const sessions = await Promise.all(Array.from({ length: 8 }, () => db.session()));
  await Promise.all(sessions.map((x, i) => x.exec(`select set_config('request.jwt.claim.sub', '${i % 2 ? t.admin : t.founder}', false); set role authenticated;`)));
  const results = await Promise.all(sessions.map((x, i) => settle(x.query(SQL.ingest, [J({ email: "race@example.com" }), J({ utm_content: `n${i}` }), null]))));
  for (const r of results) assert.ok(r.ok, r.error?.message);
  const values = results.map((r) => r.value[0].r);
  assert.equal(new Set(values.map((v) => v.lead.id)).size, 1);
  assert.equal(values.filter((v) => v.lead_created).length, 1);
  assert.equal(await countOf(s, "select count(*) from public.sales_leads where organization_id = $1", [t.org]), 1);
  assert.equal(await countOf(s, "select count(*) from public.sales_lead_touches where organization_id = $1", [t.org]), 8);
  assert.equal((await leadRow(s, values[0].lead.id)).touch_count, 8);
  const audit = await auditRows(s, t.org);
  assert.equal(audit.filter((row) => row.action === "sales.lead.created").length, 1);
  assert.equal(audit.filter((row) => row.action === "sales.lead.touch_added").length, 7);
  await Promise.all(sessions.map((x) => x.close()));
});

test("concurrency: 8 parallel requests with one idempotency key record one touch", { concurrency: true }, async ({ s, db, tenant }) => {
  const t = await tenant();
  const sessions = await Promise.all(Array.from({ length: 8 }, () => db.session()));
  await Promise.all(sessions.map((x) => x.exec(`select set_config('request.jwt.claim.sub', '${t.founder}', false); set role authenticated;`)));
  const results = await Promise.all(sessions.map((x) => settle(x.query(SQL.ingest, [J({ email: "key@example.com" }), J({ utm_source: "s" }), "same-key-0001"]))));
  for (const r of results) assert.ok(r.ok, r.error?.message);
  const values = results.map((r) => r.value[0].r);
  assert.equal(new Set(values.map((v) => v.touch.id)).size, 1);
  assert.equal(values.filter((v) => !v.replayed).length, 1);
  assert.equal(await countOf(s, "select count(*) from public.sales_lead_touches where organization_id = $1", [t.org]), 1);
  assert.equal((await auditRows(s, t.org)).length, 1);
  await Promise.all(sessions.map((x) => x.close()));
});

test("concurrency: interleaved ingestion waits on the organization lock and matches the committed lead", { concurrency: true }, async ({ s, db, tenant }) => {
  const t = await tenant();
  const one = await db.session();
  const two = await db.session();
  await beginAs(one, t.founder);
  const created = (await one.query(SQL.ingest, [J({ email: "wait@example.com" }), null, null]))[0].r;
  await beginAs(two, t.admin);
  const pending = settle(two.query(SQL.ingest, [J({ email: "WAIT@example.com" }), J({ utm_source: "second" }), null]));
  const state = await waitForBlocked(s, two.pid, pending);
  await one.exec("commit");
  const second = await pending;
  await two.exec(second.ok ? "commit" : "rollback");
  assert.equal(state, "blocked");
  assert.ok(second.ok, second.error?.message);
  assert.equal(second.value[0].r.lead.id, created.lead.id);
  assert.equal(second.value[0].r.lead_created, false);
  assert.equal(await countOf(s, "select count(*) from public.sales_leads where organization_id = $1", [t.org]), 1);
  // An identity update racing an ingestion of the new email: the ingestion waits and matches.
  await beginAs(one, t.founder);
  await one.query(SQL.update, [created.lead.id, J({ email: "moved@example.com" }), 1]);
  await beginAs(two, t.admin);
  const racing = settle(two.query(SQL.ingest, [J({ email: "moved@example.com" }), null, null]));
  assert.equal(await waitForBlocked(s, two.pid, racing), "blocked");
  await one.exec("commit");
  const matched = await racing;
  await two.exec(matched.ok ? "commit" : "rollback");
  assert.ok(matched.ok, matched.error?.message);
  assert.equal(matched.value[0].r.lead.id, created.lead.id);
  await one.close();
  await two.close();
});

test("concurrency: qualify and disqualify on the same version produce exactly one winner", { concurrency: true }, async ({ s, db, tenant }) => {
  const t = await tenant();
  const { lead } = await rpc.ingest(s, t.founder, { email: "duel@example.com" });
  const one = await db.session();
  const two = await db.session();
  await beginAs(one, t.founder);
  await one.query(SQL.qualify, [lead.id, "fit", null, 1]);
  await beginAs(two, t.admin);
  const pending = settle(two.query(SQL.disqualify, [lead.id, "no_fit", null, 1]));
  assert.equal(await waitForBlocked(s, two.pid, pending), "blocked");
  await one.exec("commit");
  const second = await pending;
  await two.exec(second.ok ? "commit" : "rollback");
  assert.equal(second.ok, false);
  assert.equal(second.error.message, "SALES_VERSION_CONFLICT");
  const final = await leadRow(s, lead.id);
  assert.equal(final.status, "qualified");
  assert.equal(Number(final.version), 2);
  assert.equal((await auditRows(s, t.org)).length, 2);
  await one.close();
  await two.close();
});

test("concurrency: two touches racing for the last slot under the cap - one wins", { concurrency: true }, async ({ s, db, tenant }) => {
  const t = await tenant();
  const { lead } = await rpc.ingest(s, t.founder, { email: "lastslot@example.com" });
  await ownerTx(s, `insert into public.sales_lead_touches (organization_id, lead_id, occurred_at, ingestion_channel, request_hash, actor_type, created_by)
    select '${t.org}', '${lead.id}', now(), 'import', repeat('a', 64), 'user', '${t.founder}' from generate_series(1, 998)`);
  const one = await db.session();
  const two = await db.session();
  await beginAs(one, t.founder);
  await one.query(SQL.addTouch, [lead.id, J({ utm_source: "one" }), null]);
  await beginAs(two, t.admin);
  const pending = settle(two.query(SQL.addTouch, [lead.id, J({ utm_source: "two" }), null]));
  assert.equal(await waitForBlocked(s, two.pid, pending), "blocked");
  await one.exec("commit");
  const second = await pending;
  await two.exec(second.ok ? "commit" : "rollback");
  assert.equal(second.ok, false);
  assert.equal(second.error.message, "SALES_TOUCH_LIMIT");
  assert.equal((await leadRow(s, lead.id)).touch_count, 1000);
  assert.equal(await countOf(s, "select count(*) from public.sales_lead_touches where lead_id = $1", [lead.id]), 1000);
  await one.close();
  await two.close();
});

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

export const TEST_NAMES = TESTS.map((item) => item.name);

export async function runSuite({ driver, inc1Sql = readInc1Migration(), fixSql = readFixMigration(), migrationSql = readMigration(), rollbackSql = readRollback(), only = null, log = () => {} }) {
  const results = [];
  const record = (name, status, error) => {
    results.push({ name, status, error });
    log(`${status === "PASS" ? "PASS" : status === "SKIP" ? "SKIP" : "FAIL"}  ${name}${error ? `\n      ${error}` : ""}`);
  };
  const prepare = async (database, { inc2 = true } = {}) => {
    const session = await database.session();
    await session.exec(DATABASE_SQL);
    await applySql(session, inc1Sql);
    await applySql(session, fixSql);
    const afterInc1 = await nonSalesSnapshot(session);
    if (inc2) await applySql(session, migrationSql);
    return { session, afterInc1 };
  };

  let shared;
  try {
    const database = await driver.newDatabase();
    shared = { database, ...(await prepare(database)) };
  } catch (error) {
    record("setup: bootstrap, Increment 1 and Increment 2 migrations", "FAIL", error.message);
    for (const item of TESTS) record(item.name, "FAIL", "setup failed");
    return results;
  }

  for (const item of TESTS) {
    if (only && !only.includes(item.name)) continue;
    if (item.concurrency && !driver.concurrency) {
      record(item.name, "SKIP", null);
      continue;
    }
    let database = shared.database;
    let session = shared.session;
    let afterInc1 = shared.afterInc1;
    let isolated = null;
    try {
      if (item.isolatedDb) {
        isolated = await driver.newDatabase();
        database = isolated;
        ({ session, afterInc1 } = await prepare(isolated, { inc2: !item.inc1Only }));
      }
      await item.fn({
        s: session, db: database, afterInc1, migrationSql, rollbackSql, inc1Sql, fixSql,
        tenant: () => createTenant(session),
      });
      record(item.name, "PASS");
    } catch (error) {
      record(item.name, "FAIL", error?.message || String(error));
      await session.exec("rollback").catch(() => {});
      await session.exec("reset role; reset search_path; select set_config('request.jwt.claim.sub', '', false);").catch(() => {});
    } finally {
      if (isolated) await isolated.drop().catch(() => {});
    }
  }
  await shared.database.drop().catch(() => {});
  return results;
}

export function summarize(results) {
  const counts = { PASS: 0, FAIL: 0, SKIP: 0 };
  for (const result of results) counts[result.status] += 1;
  return counts;
}

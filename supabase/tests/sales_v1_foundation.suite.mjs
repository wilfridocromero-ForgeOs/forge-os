// Sales V1 Increment 1 - shared test suite.
//
// The same assertions run against two drivers:
// * PGlite (in-process PostgreSQL, single connection): everything except the
//   concurrency tests.
// * Real PostgreSQL (separate server, many connections): everything, including
//   the adversarial concurrency tests. This is the authoritative layer for RLS,
//   SECURITY DEFINER, GRANT/REVOKE and concurrent invariant enforcement.
//
// Neither driver is a project dependency. Entry points load them from an
// ephemeral npx install (see sales_v1_foundation.integration.mjs and
// sales_v1_foundation.postgres.mjs).

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import * as EXPECTED from "./sales_v1_foundation.expected.mjs";

const here = dirname(fileURLToPath(import.meta.url));
export const MIGRATION_PATH = resolve(here, "../migrations", EXPECTED.MIGRATION_FILE);
export const ROLLBACK_PATH = resolve(here, "rollback/sales_v1_foundation_rollback.sql");
export const readMigration = () => readFileSync(MIGRATION_PATH, "utf8");
export const readRollback = () => readFileSync(ROLLBACK_PATH, "utf8");

export async function loadModule(name) {
  try {
    return await import(name);
  } catch {
    for (const dir of (process.env.PATH || "").split(delimiter)) {
      if (!dir.includes("_npx")) continue;
      try {
        const require = createRequire(join(dir, "..", "noop.js"));
        return await import(pathToFileURL(require.resolve(name)).href);
      } catch {
        // try the next PATH entry
      }
    }
  }
  throw new Error(`${name} not found. Run through: npx -y -p pg@8 -p @electric-sql/pglite node <entry>`);
}

// ---------------------------------------------------------------------------
// Supabase-like environment
// ---------------------------------------------------------------------------

// Cluster-level roles (real PostgreSQL only; PGlite runs it per database).
export const CLUSTER_SQL = `
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
end
$$;
`;

// Mirrors the production contracts Sales depends on. Default privileges mirror
// Supabase (everything granted to API roles on new public objects), so the
// migration must revoke explicitly. USAGE on schema private for authenticated
// mirrors main (20260831053555_harden_discovery_assessment_delete_rpc.sql).
export const DATABASE_SQL = `
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;

create schema auth;
create schema private;
grant usage on schema auth to anon, authenticated, service_role;
grant usage on schema private to authenticated;

create table auth.users (id uuid primary key);
create function auth.uid() returns uuid language sql stable as $fn$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$fn$;
grant execute on function auth.uid() to anon, authenticated, service_role;

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.organization_memberships (
  user_id uuid not null references auth.users(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  role text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, organization_id),
  constraint organization_memberships_role_check
    check (role in ('founder', 'admin', 'area_lead', 'member'))
);
create table public.user_active_organizations (
  user_id uuid primary key references auth.users(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  updated_at timestamptz not null default now(),
  constraint user_active_organizations_membership_fkey
    foreign key (user_id, organization_id)
    references public.organization_memberships(user_id, organization_id)
    on delete cascade
);
alter table public.organizations enable row level security;
alter table public.organization_memberships enable row level security;
alter table public.user_active_organizations enable row level security;
revoke all on public.organizations, public.organization_memberships, public.user_active_organizations
  from anon, authenticated, service_role;

-- Same definition as production (20260816120000).
create function public.current_user_organization_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $fn$
  select active.organization_id
  from public.user_active_organizations as active
  join public.organization_memberships as membership
    on membership.user_id = active.user_id
   and membership.organization_id = active.organization_id
  where active.user_id = (select auth.uid());
$fn$;
revoke all on function public.current_user_organization_id() from public, anon, authenticated, service_role;
grant execute on function public.current_user_organization_id() to authenticated;

create schema supabase_migrations;
create table supabase_migrations.schema_migrations (
  version text primary key,
  name text,
  statements text[]
);
`;

// ---------------------------------------------------------------------------
// Drivers
// ---------------------------------------------------------------------------

export async function pgliteDriver() {
  const { PGlite } = await loadModule("@electric-sql/pglite");
  return {
    name: "pglite",
    concurrency: false,
    async newDatabase() {
      const db = new PGlite();
      await db.waitReady;
      await db.exec(CLUSTER_SQL);
      const session = {
        pid: null,
        query: async (sql, params = []) => (await db.query(sql, params)).rows,
        exec: async (sql) => {
          await db.exec(sql);
        },
        close: async () => {},
      };
      return { session: async () => session, drop: async () => db.close() };
    },
    async close() {},
  };
}

export async function postgresDriver(connectionString) {
  const pgModule = await loadModule("pg");
  const { Client, types } = pgModule.default ?? pgModule;
  // Return int8 as JS numbers (values in these tests are small).
  types.setTypeParser(20, (value) => Number(value));
  const admin = new Client({ connectionString });
  await admin.connect();
  await admin.query(CLUSTER_SQL);
  return {
    name: "postgres",
    concurrency: true,
    async newDatabase() {
      const name = `sales_v1_t_${randomUUID().replaceAll("-", "").slice(0, 16)}`;
      await admin.query(`create database ${name}`);
      const url = new URL(connectionString);
      url.pathname = `/${name}`;
      const sessions = [];
      return {
        async session() {
          const client = new Client({ connectionString: url.toString() });
          client.on("error", () => {});
          await client.connect();
          const pid = (await client.query("select pg_backend_pid() as pid")).rows[0].pid;
          const session = {
            pid,
            query: async (sql, params = []) => (await client.query(sql, params)).rows,
            exec: async (sql) => {
              await client.query(sql);
            },
            close: async () => client.end(),
          };
          sessions.push(session);
          return session;
        },
        async drop() {
          for (const session of sessions) await session.close().catch(() => {});
          await admin.query(`drop database ${name} with (force)`);
        },
      };
    },
    async close() {
      await admin.end();
    },
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function errorText(error) {
  return [error?.message, error?.code, error?.detail, error?.constraint]
    .filter(Boolean)
    .join(" | ");
}

export async function rejects(promise, matcher) {
  let value;
  try {
    value = await promise;
  } catch (error) {
    const text = errorText(error);
    const ok = matcher instanceof RegExp ? matcher.test(text) : text.includes(matcher);
    if (!ok) throw new Error(`expected error ${matcher}, got: ${text}`);
    return error;
  }
  throw new Error(`expected error ${matcher}, but call succeeded: ${JSON.stringify(value)?.slice(0, 200)}`);
}

const settle = (promise) =>
  promise.then((value) => ({ ok: true, value }), (error) => ({ ok: false, error }));

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

// Returns 'blocked' if the backend waits on a lock before `pending` settles.
async function waitForBlocked(observer, pid, pending, timeoutMs = 8000) {
  let settled = false;
  pending.then(() => { settled = true; }, () => { settled = true; });
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (settled) return "settled";
    const rows = await observer.query(
      "select wait_event_type from pg_stat_activity where pid = $1",
      [pid],
    );
    if (rows[0]?.wait_event_type === "Lock") return "blocked";
    await sleep(15);
  }
  return settled ? "settled" : "timeout";
}

async function as(session, userId, callback, role = "authenticated") {
  await session.exec(
    `select set_config('request.jwt.claim.sub', '${userId ?? ""}', false); set role ${role};`,
  );
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

const rpc = {
  ensure: (s, user) =>
    as(s, user, async () => (await s.query("select public.sales_ensure_default_pipeline() as r"))[0].r),
  create: (s, user, pipelineId, key, name, kind, probability = null) =>
    as(s, user, async () => (await s.query(
      "select * from public.sales_create_stage($1::uuid, $2::text, $3::text, $4::text, $5::integer)",
      [pipelineId, key, name, kind, probability],
    ))[0]),
  update: (s, user, stageId, changes, expectedVersion) =>
    as(s, user, async () => (await s.query(
      "select * from public.sales_update_stage($1::uuid, $2::jsonb, $3::bigint)",
      [stageId, changes === null ? null : JSON.stringify(changes), expectedVersion],
    ))[0]),
  reorder: (s, user, pipelineId, ids) =>
    as(s, user, async () => s.query(
      "select * from public.sales_reorder_stages($1::uuid, $2::uuid[])",
      [pipelineId, Array.isArray(ids) ? `{${ids.join(",")}}` : ids],
    )),
  archive: (s, user, stageId) =>
    as(s, user, async () => (await s.query(
      "select * from public.sales_archive_stage($1::uuid)",
      [stageId],
    ))[0]),
};

async function createTenant(s) {
  const tenant = {
    org: randomUUID(),
    founder: randomUUID(),
    admin: randomUUID(),
    lead: randomUUID(),
    member: randomUUID(),
  };
  const users = [tenant.founder, tenant.admin, tenant.lead, tenant.member];
  await s.exec(`
    insert into auth.users(id) values ${users.map((id) => `('${id}')`).join(", ")};
    insert into public.organizations(id, name) values ('${tenant.org}', 'Org ${tenant.org.slice(0, 8)}');
    insert into public.organization_memberships(user_id, organization_id, role) values
      ('${tenant.founder}', '${tenant.org}', 'founder'),
      ('${tenant.admin}', '${tenant.org}', 'admin'),
      ('${tenant.lead}', '${tenant.org}', 'area_lead'),
      ('${tenant.member}', '${tenant.org}', 'member');
    insert into public.user_active_organizations(user_id, organization_id) values
      ${users.map((id) => `('${id}', '${tenant.org}')`).join(", ")};
  `);
  return tenant;
}

async function createUser(s, memberships = [], active = null) {
  const id = randomUUID();
  await s.exec(`insert into auth.users(id) values ('${id}')`);
  for (const [org, role] of memberships) {
    await s.exec(`insert into public.organization_memberships(user_id, organization_id, role)
                  values ('${id}', '${org}', '${role}')`);
  }
  if (active) {
    await s.exec(`insert into public.user_active_organizations(user_id, organization_id)
                  values ('${id}', '${active}')`);
  }
  return id;
}

const activeStages = (s, pipelineId) =>
  s.query(
    `select id, key, name, kind, default_probability_bps as probability, position, version
     from public.sales_pipeline_stages
     where pipeline_id = $1 and status = 'active'
     order by position`,
    [pipelineId],
  );

const stageByKey = async (s, pipelineId, key) =>
  (await s.query(
    "select * from public.sales_pipeline_stages where pipeline_id = $1 and key = $2",
    [pipelineId, key],
  ))[0];

const auditRows = (s, org) =>
  s.query(
    `select id, actor_user_id, action, entity_type, entity_id, details
     from public.sales_audit_log where organization_id = $1 order by id`,
    [org],
  );

const countOf = async (s, sql, params = []) => Number((await s.query(sql, params))[0].count);

async function assertStructure(s, pipelineId) {
  const stages = await activeStages(s, pipelineId);
  assert.deepEqual(stages.map((stage) => stage.position), stages.map((_, index) => index + 1),
    "active positions must be contiguous 1..n");
  assert.equal(stages.filter((stage) => stage.kind === "won").length, 1, "exactly one active won stage");
  assert.ok(stages.filter((stage) => stage.kind === "lost").length >= 1, "at least one active lost stage");
  return stages;
}

async function applySql(s, sql) {
  try {
    await s.exec(`begin;\n${sql}\ncommit;`);
  } catch (error) {
    await s.exec("rollback").catch(() => {});
    throw error;
  }
}

// Owner-level transaction for invariant tests that bypass the RPCs.
async function ownerTx(s, sql) {
  try {
    await s.exec(`begin;\n${sql};\ncommit;`);
  } catch (error) {
    await s.exec("rollback").catch(() => {});
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Catalog inspection
// ---------------------------------------------------------------------------

async function catalog(s) {
  await s.exec("set search_path = ''");
  try {
    const relations = await s.query(`
      select namespace.nspname || '.' || relation.relname as name, relation.relkind::text as kind,
             relation.relrowsecurity as rls, relation.relforcerowsecurity as force_rls
      from pg_catalog.pg_class as relation
      join pg_catalog.pg_namespace as namespace on namespace.oid = relation.relnamespace
      where relation.relname like 'sales\\_%'
        and namespace.nspname not in ('pg_catalog', 'information_schema', 'pg_toast')
      order by 1`);
    const columns = await s.query(`
      select namespace.nspname || '.' || relation.relname as table_name, attribute.attname as name,
             pg_catalog.format_type(attribute.atttypid, attribute.atttypmod) as type,
             attribute.attnotnull as not_null
      from pg_catalog.pg_attribute as attribute
      join pg_catalog.pg_class as relation on relation.oid = attribute.attrelid
      join pg_catalog.pg_namespace as namespace on namespace.oid = relation.relnamespace
      where relation.relname like 'sales\\_%' and relation.relkind = 'r'
        and attribute.attnum > 0 and not attribute.attisdropped
      order by 1, attribute.attnum`);
    const constraints = await s.query(`
      select namespace.nspname || '.' || relation.relname as table_name, con.conname as name,
             con.contype::text as type, con.condeferrable as deferrable, con.condeferred as deferred,
             pg_catalog.pg_get_constraintdef(con.oid) as definition,
             coalesce((select array_agg(attribute.attname::text order by key.ordinality)
                       from unnest(con.conkey) with ordinality as key(attnum, ordinality)
                       join pg_catalog.pg_attribute as attribute
                         on attribute.attrelid = con.conrelid and attribute.attnum = key.attnum), '{}') as columns
      from pg_catalog.pg_constraint as con
      join pg_catalog.pg_class as relation on relation.oid = con.conrelid
      join pg_catalog.pg_namespace as namespace on namespace.oid = relation.relnamespace
      where relation.relname like 'sales\\_%'
      order by 1, 2`);
    const indexes = await s.query(`
      select index_class.relname as name, namespace.nspname || '.' || table_class.relname as table_name,
             idx.indisunique as unique, coalesce(pg_catalog.pg_get_expr(idx.indpred, idx.indrelid), '') as predicate,
             exists (select 1 from pg_catalog.pg_constraint as con where con.conindid = idx.indexrelid) as backs_constraint
      from pg_catalog.pg_index as idx
      join pg_catalog.pg_class as index_class on index_class.oid = idx.indexrelid
      join pg_catalog.pg_class as table_class on table_class.oid = idx.indrelid
      join pg_catalog.pg_namespace as namespace on namespace.oid = table_class.relnamespace
      where table_class.relname like 'sales\\_%'
      order by 1`);
    const triggers = await s.query(`
      select namespace.nspname || '.' || relation.relname as table_name, trigger.tgname as name,
             trigger.tgtype::int as type, trigger.tgfoid::regprocedure::text as fn,
             trigger.tgconstraint <> 0 as is_constraint, trigger.tgdeferrable as deferrable,
             trigger.tginitdeferred as deferred,
             coalesce((select array_agg(attribute.attname::text order by attribute.attname::text)
                       from unnest(trigger.tgattr::int2[]) as key(attnum)
                       join pg_catalog.pg_attribute as attribute
                         on attribute.attrelid = trigger.tgrelid and attribute.attnum = key.attnum), '{}') as columns
      from pg_catalog.pg_trigger as trigger
      join pg_catalog.pg_class as relation on relation.oid = trigger.tgrelid
      join pg_catalog.pg_namespace as namespace on namespace.oid = relation.relnamespace
      where relation.relname like 'sales\\_%' and not trigger.tgisinternal
      order by 2`);
    const policies = await s.query(`
      select namespace.nspname || '.' || relation.relname as table_name, policy.polname as name,
             policy.polcmd::text as cmd, policy.polpermissive as permissive,
             coalesce((select string_agg(role.rolname::text, ',' order by role.rolname)
                       from pg_catalog.pg_roles as role where role.oid = any(policy.polroles)), 'PUBLIC') as roles,
             coalesce(pg_catalog.pg_get_expr(policy.polqual, policy.polrelid), '') as qual,
             coalesce(pg_catalog.pg_get_expr(policy.polwithcheck, policy.polrelid), '') as with_check
      from pg_catalog.pg_policy as policy
      join pg_catalog.pg_class as relation on relation.oid = policy.polrelid
      join pg_catalog.pg_namespace as namespace on namespace.oid = relation.relnamespace
      where relation.relname like 'sales\\_%'
      order by 2`);
    const functions = await s.query(`
      select proc.oid::pg_catalog.regprocedure::text as sig,
             proc.prosecdef as secdef, proc.provolatile::text as volatility,
             pg_catalog.pg_get_function_result(proc.oid) as result,
             pg_catalog.pg_get_userbyid(proc.proowner)::text as owner,
             coalesce(proc.proconfig, '{}') as config,
             (proc.proacl is null or exists (
               select 1 from pg_catalog.aclexplode(proc.proacl) as acl
               where acl.grantee = 0 and acl.privilege_type = 'EXECUTE')) as public_execute,
             pg_catalog.has_function_privilege('anon', proc.oid, 'EXECUTE') as anon,
             pg_catalog.has_function_privilege('authenticated', proc.oid, 'EXECUTE') as authenticated,
             pg_catalog.has_function_privilege('service_role', proc.oid, 'EXECUTE') as service_role
      from pg_catalog.pg_proc as proc
      join pg_catalog.pg_namespace as namespace on namespace.oid = proc.pronamespace
      where proc.proname like 'sales\\_%'
        and namespace.nspname not in ('pg_catalog', 'information_schema')
      order by 1`);
    const tablePrivileges = await s.query(`
      select namespace.nspname || '.' || relation.relname as table_name, role.name as role, privilege.name as privilege,
             case when role.name = 'PUBLIC'
               then exists (select 1 from pg_catalog.aclexplode(coalesce(relation.relacl, pg_catalog.acldefault('r', relation.relowner))) as acl
                            where acl.grantee = 0 and acl.privilege_type = privilege.name)
               else pg_catalog.has_table_privilege(role.name, relation.oid, privilege.name) end as granted
      from pg_catalog.pg_class as relation
      join pg_catalog.pg_namespace as namespace on namespace.oid = relation.relnamespace
      cross join (values ('anon'), ('authenticated'), ('service_role'), ('PUBLIC')) as role(name)
      cross join (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')) as privilege(name)
      where relation.relname like 'sales\\_%' and relation.relkind = 'r'
      order by 1, 2, 3`);
    const sequencePrivileges = await s.query(`
      select namespace.nspname || '.' || relation.relname as name, role.name as role,
             pg_catalog.has_sequence_privilege(role.name, relation.oid, 'USAGE')
               or pg_catalog.has_sequence_privilege(role.name, relation.oid, 'SELECT')
               or pg_catalog.has_sequence_privilege(role.name, relation.oid, 'UPDATE') as granted
      from pg_catalog.pg_class as relation
      join pg_catalog.pg_namespace as namespace on namespace.oid = relation.relnamespace
      cross join (values ('anon'), ('authenticated'), ('service_role')) as role(name)
      where relation.relname like 'sales\\_%' and relation.relkind = 'S'`);
    return { relations, columns, constraints, indexes, triggers, policies, functions, tablePrivileges, sequencePrivileges };
  } finally {
    await s.exec("reset search_path");
  }
}

// Digest of everything outside Sales that the migration could have touched.
async function nonSalesSnapshot(s) {
  await s.exec("set search_path = ''");
  try {
    const rows = await s.query(`
      select pg_catalog.md5(coalesce(string_agg(item, E'\\n' order by item collate "C"), '')) as digest,
             count(*)::int as items
      from (
        select 'proc:' || proc.oid::regprocedure::text || ':' || pg_catalog.md5(pg_catalog.pg_get_functiondef(proc.oid))
               || ':' || coalesce(proc.proacl::text, '') || ':' || proc.prosecdef::text as item
        from pg_catalog.pg_proc as proc
        join pg_catalog.pg_namespace as namespace on namespace.oid = proc.pronamespace
        where namespace.nspname in ('public', 'private', 'auth', 'supabase_migrations')
          and proc.proname not like 'sales\\_%' and proc.prokind = 'f'
        union all
        select 'rel:' || namespace.nspname || '.' || relation.relname || ':' || relation.relkind::text || ':'
               || coalesce(relation.relacl::text, '') || ':' || relation.relrowsecurity::text
        from pg_catalog.pg_class as relation
        join pg_catalog.pg_namespace as namespace on namespace.oid = relation.relnamespace
        where namespace.nspname in ('public', 'private', 'auth', 'supabase_migrations')
          and relation.relname not like 'sales\\_%'
        union all
        select 'col:' || relation.oid::regclass::text || '.' || attribute.attname || ':'
               || pg_catalog.format_type(attribute.atttypid, attribute.atttypmod) || ':' || attribute.attnotnull::text
        from pg_catalog.pg_attribute as attribute
        join pg_catalog.pg_class as relation on relation.oid = attribute.attrelid
        join pg_catalog.pg_namespace as namespace on namespace.oid = relation.relnamespace
        where namespace.nspname in ('public', 'private', 'auth', 'supabase_migrations')
          and relation.relname not like 'sales\\_%' and attribute.attnum > 0 and not attribute.attisdropped
        union all
        select 'con:' || con.conrelid::regclass::text || ':' || con.conname || ':' || pg_catalog.pg_get_constraintdef(con.oid)
        from pg_catalog.pg_constraint as con
        join pg_catalog.pg_class as relation on relation.oid = con.conrelid
        join pg_catalog.pg_namespace as namespace on namespace.oid = relation.relnamespace
        where namespace.nspname in ('public', 'private', 'auth', 'supabase_migrations')
          and relation.relname not like 'sales\\_%'
        union all
        select 'pol:' || policy.polrelid::regclass::text || ':' || policy.polname
        from pg_catalog.pg_policy as policy where policy.polname not like 'sales\\_%'
        union all
        select 'trg:' || trigger.tgrelid::regclass::text || ':' || trigger.tgname
        from pg_catalog.pg_trigger as trigger
        where not trigger.tgisinternal and trigger.tgname not like 'sales\\_%'
        union all
        select 'ns:' || namespace.nspname || ':' || coalesce(namespace.nspacl::text, '')
        from pg_catalog.pg_namespace as namespace
        where namespace.nspname in ('public', 'private', 'auth', 'supabase_migrations')
        union all
        select 'defacl:' || coalesce(acl.defaclacl::text, '') || ':' || acl.defaclobjtype::text
        from pg_catalog.pg_default_acl as acl
      ) as items`);
    return rows[0];
  } finally {
    await s.exec("reset search_path");
  }
}

const TRIGGER_EVENTS = [[4, "INSERT"], [8, "DELETE"], [16, "UPDATE"], [32, "TRUNCATE"]];

function decodeTrigger(row) {
  return {
    table: row.table_name,
    name: row.name,
    timing: row.type & 2 ? "BEFORE" : "AFTER",
    level: row.type & 1 ? "ROW" : "STATEMENT",
    events: TRIGGER_EVENTS.filter(([bit]) => row.type & bit).map(([, name]) => name).sort(),
    columns: [...row.columns].sort(),
    fn: row.fn,
    constraint: row.is_constraint,
    ...(row.is_constraint ? { deferrable: row.deferrable, deferred: row.deferred } : {}),
  };
}

const salesObjectCount = async (s) =>
  countOf(s, `
    select count(*) from (
      select relname::text from pg_catalog.pg_class where relname like 'sales\\_%'
      union all select proname::text from pg_catalog.pg_proc where proname like 'sales\\_%'
      union all select typname::text from pg_catalog.pg_type where typname like 'sales\\_%' or typname like '\\_sales\\_%'
      union all select polname::text from pg_catalog.pg_policy where polname like 'sales\\_%'
      union all select tgname::text from pg_catalog.pg_trigger where tgname like 'sales\\_%'
    ) as objects`);

async function verifyCatalog(s) {
  const actual = await catalog(s);

  // Relations: exactly the expected tables, sequences and indexes.
  const expectedRelations = [
    ...Object.keys(EXPECTED.TABLES).map((name) => `${name}:r`),
    ...EXPECTED.SEQUENCES.map((name) => `${name}:S`),
    ...EXPECTED.INDEXES.map((index) => `public.${index.name}:i`),
    ...Object.values(EXPECTED.TABLES).flatMap((table) =>
      table.keys.filter((key) => key.type !== "f").map((key) => `public.${key.name}:i`)),
  ].sort();
  assert.deepEqual(actual.relations.map((row) => `${row.name}:${row.kind}`).sort(), expectedRelations,
    "relation inventory");

  for (const [table, spec] of Object.entries(EXPECTED.TABLES)) {
    const relation = actual.relations.find((row) => row.name === table);
    assert.equal(relation.rls, true, `${table} RLS enabled`);
    assert.deepEqual(
      actual.columns.filter((row) => row.table_name === table).map((row) => [row.name, row.type, row.not_null]),
      spec.columns, `${table} columns`);
    const tableConstraints = actual.constraints.filter((row) => row.table_name === table);
    assert.equal(tableConstraints.filter((row) => row.type === "c").length, spec.checkConstraints,
      `${table} check constraint count`);
    // 'n' = catalogued NOT NULL (newer PostgreSQL/PGlite); nullability is verified with the columns.
    assert.deepEqual(tableConstraints.filter((row) => !["p", "u", "f", "c", "t", "n"].includes(row.type)), [],
      `${table} has no unexpected constraint types`);
    assert.deepEqual(tableConstraints.filter((row) => row.type === "t").map((row) => row.name).sort(),
      EXPECTED.TRIGGERS.filter((trigger) => trigger.table === table && trigger.constraint).map((trigger) => trigger.name).sort(),
      `${table} constraint-trigger entries`);
    const keys = tableConstraints.filter((row) => ["p", "u", "f"].includes(row.type)).map((row) => ({
      name: row.name,
      type: row.type,
      columns: [...row.columns],
      ...(row.type === "f" ? { references: row.definition.match(/REFERENCES (\S+\(.*?\))/)[1] } : {}),
      ...(row.deferrable ? { deferrable: true, deferred: row.deferred } : {}),
    }));
    assert.deepEqual(
      keys.sort((a, b) => a.name.localeCompare(b.name)),
      [...spec.keys].sort((a, b) => a.name.localeCompare(b.name)),
      `${table} keys`);
  }

  for (const index of EXPECTED.INDEXES) {
    const row = actual.indexes.find((item) => item.name === index.name);
    assert.ok(row, `index ${index.name} exists`);
    assert.equal(row.table_name, index.table, `${index.name} table`);
    assert.equal(row.unique, index.unique, `${index.name} unique`);
    assert.equal(row.backs_constraint, false, `${index.name} is a plain index`);
    if (index.predicate.length === 0) assert.equal(row.predicate, "", `${index.name} not partial`);
    for (const fragment of index.predicate) {
      assert.ok(row.predicate.includes(fragment), `${index.name} predicate contains ${fragment}: ${row.predicate}`);
    }
  }

  assert.deepEqual(
    actual.triggers.map(decodeTrigger).sort((a, b) => a.name.localeCompare(b.name)),
    [...EXPECTED.TRIGGERS].map((trigger) => ({ ...trigger, columns: [...trigger.columns].sort() }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    "triggers");

  assert.equal(actual.policies.length, EXPECTED.POLICIES.length, "policy count");
  for (const policy of EXPECTED.POLICIES) {
    const row = actual.policies.find((item) => item.name === policy.name);
    assert.ok(row, `policy ${policy.name}`);
    assert.equal(row.table_name, policy.table);
    assert.equal(row.cmd, "r", `${policy.name} is SELECT`);
    assert.equal(row.permissive, true);
    assert.equal(row.roles, policy.roles, `${policy.name} roles`);
    for (const fragment of policy.mustContain) {
      assert.ok(row.qual.includes(fragment), `${policy.name} qual contains ${fragment}: ${row.qual}`);
    }
  }

  assert.deepEqual(actual.functions.map((row) => row.sig).sort(), EXPECTED.FUNCTIONS.map((fn) => fn.sig).sort(),
    "function inventory");
  for (const fn of EXPECTED.FUNCTIONS) {
    const row = actual.functions.find((item) => item.sig === fn.sig);
    assert.equal(row.secdef, fn.secdef, `${fn.sig} security definer`);
    assert.equal(row.volatility, fn.volatility, `${fn.sig} volatility`);
    assert.equal(row.result, fn.result, `${fn.sig} result`);
    assert.equal(row.owner, EXPECTED.FUNCTION_OWNER, `${fn.sig} owner`);
    assert.deepEqual([...row.config], EXPECTED.FUNCTION_CONFIG, `${fn.sig} search_path`);
    assert.equal(row.public_execute, false, `${fn.sig} PUBLIC execute`);
    for (const role of ["anon", "authenticated", "service_role"]) {
      assert.equal(row[role], fn.execute.includes(role), `${fn.sig} EXECUTE for ${role}`);
    }
  }

  for (const row of actual.tablePrivileges) {
    assert.equal(row.granted, EXPECTED.TABLE_PRIVILEGES[row.role].includes(row.privilege),
      `${row.table_name} ${row.privilege} for ${row.role}`);
  }
  assert.equal(actual.sequencePrivileges.length, 3, "sequence privilege rows");
  for (const row of actual.sequencePrivileges) {
    assert.equal(row.granted, false, `${row.name} privileges for ${row.role}`);
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

const TESTS = [];
const test = (name, options, fn) => {
  if (typeof options === "function") TESTS.push({ name, fn: options });
  else TESTS.push({ name, ...options, fn });
};

test("catalog: inventory, columns, keys, triggers, policies, functions match the hand-written spec", async ({ s }) => {
  await verifyCatalog(s);
});

test("catalog: migration did not modify any pre-existing object", async ({ s, before }) => {
  const after = await nonSalesSnapshot(s);
  assert.ok(before.items > 20, "snapshot covers the bootstrap objects");
  assert.deepEqual(after, before);
});

test("authz: sales_can matrix (founder/admin only, unknown and null fail closed)", async ({ s, tenant }) => {
  const t = await tenant();
  const other = await tenant();
  const noOrg = await createUser(s);
  const multi = await createUser(s, [[t.org, "member"], [other.org, "founder"]], t.org);
  const canAs = (user, action) =>
    as(s, user, async () => (await s.query("select private.sales_can($1) as ok", [action]))[0].ok);

  for (const action of ["read", "manage_pipeline"]) {
    assert.equal(await canAs(t.founder, action), true, `founder ${action}`);
    assert.equal(await canAs(t.admin, action), true, `admin ${action}`);
    assert.equal(await canAs(t.lead, action), false, `area_lead ${action}`);
    assert.equal(await canAs(t.member, action), false, `member ${action}`);
    assert.equal(await canAs(noOrg, action), false, `no org ${action}`);
    assert.equal(await canAs(null, action), false, `no uid ${action}`);
    assert.equal(await canAs(multi, action), false, `multi-org member (active org) ${action}`);
  }
  for (const action of ["manage", "admin", "READ", "read ", "", "manage_members", null]) {
    assert.equal(await canAs(t.founder, action), false, `unknown action ${JSON.stringify(action)}`);
  }
  await s.exec(`update public.user_active_organizations set organization_id = '${other.org}' where user_id = '${multi}'`);
  assert.equal(await canAs(multi, "manage_pipeline"), true, "multi-org founder after switching active org");
});

test("authz: RPC denial for non-admin roles, missing identity and missing active org", async ({ s, tenant }) => {
  const t = await tenant();
  const { pipeline, stages } = await rpc.ensure(s, t.founder);
  const stage = stages.find((item) => item.key === "proposal");
  const ids = stages.map((item) => item.id);
  const noOrg = await createUser(s);
  const calls = (user) => [
    () => rpc.ensure(s, user),
    () => rpc.create(s, user, pipeline.id, "x_stage", "X", "open"),
    () => rpc.update(s, user, stage.id, { name: "Z" }, stage.version),
    () => rpc.reorder(s, user, pipeline.id, ids),
    () => rpc.archive(s, user, stage.id),
  ];
  for (const user of [t.lead, t.member]) {
    for (const call of calls(user)) await rejects(call(), "SALES_FORBIDDEN");
  }
  for (const call of calls(null)) await rejects(call(), "SALES_AUTH_REQUIRED");
  for (const call of calls(noOrg)) await rejects(call(), "SALES_NO_ACTIVE_ORGANIZATION");
  const after = await activeStages(s, pipeline.id);
  assert.deepEqual(after.map((row) => [row.id, row.name, row.version]), stages.map((row) => [row.id, row.name, row.version]));
  assert.equal((await auditRows(s, t.org)).length, 1, "only the ensure audit row exists");
});

test("grants: anon and service_role cannot execute RPCs; nobody can call private helpers", async ({ s, tenant }) => {
  const t = await tenant();
  for (const role of ["anon", "service_role"]) {
    await rejects(as(s, null, () => s.query("select public.sales_ensure_default_pipeline()"), role),
      /permission denied for function/);
    await rejects(as(s, null, () => s.query("select private.sales_can('read')"), role), /permission denied/);
  }
  const privateCalls = [
    `select private.sales_require('read')`,
    `select private.sales_write_audit('${t.org}', 'sales.stage.created', 'stage', gen_random_uuid(), '{}')`,
    `select private.sales_clean_name('x')`,
  ];
  for (const sql of privateCalls) {
    await rejects(as(s, t.founder, () => s.query(sql)), /permission denied for function/);
  }
  assert.equal((await auditRows(s, t.org)).length, 0, "no forged audit rows");
});

test("rls: organizations never see each other's rows", async ({ s, tenant }) => {
  const a = await tenant();
  const b = await tenant();
  const pa = await rpc.ensure(s, a.founder);
  const pb = await rpc.ensure(s, b.founder);
  const visible = (user) => as(s, user, async () => ({
    pipelines: (await s.query("select id, organization_id from public.sales_pipelines")).map((row) => row.organization_id),
    stages: (await s.query("select organization_id from public.sales_pipeline_stages")).map((row) => row.organization_id),
    audit: (await s.query("select organization_id from public.sales_audit_log")).map((row) => row.organization_id),
  }));
  const seenA = await visible(a.founder);
  assert.deepEqual([...new Set(seenA.pipelines)], [a.org]);
  assert.equal(seenA.stages.length, 6);
  assert.deepEqual([...new Set(seenA.stages)], [a.org]);
  assert.deepEqual([...new Set(seenA.audit)], [a.org]);
  const seenB = await visible(b.admin);
  assert.deepEqual([...new Set(seenB.pipelines)], [b.org]);
  assert.deepEqual([...new Set(seenB.stages)], [b.org]);
  for (const user of [a.lead, a.member, await createUser(s), null]) {
    const seen = await visible(user);
    assert.deepEqual(seen, { pipelines: [], stages: [], audit: [] }, "non-admin sees nothing");
  }
  // Targeted reads of the other organization's ids return nothing.
  const leaked = await as(s, a.founder, () => s.query(
    "select id from public.sales_pipelines where id = $1 union all select id from public.sales_pipeline_stages where pipeline_id = $1",
    [pb.pipeline.id]));
  assert.equal(leaked.length, 0);
  await rejects(as(s, null, () => s.query("select * from public.sales_pipelines"), "anon"), /permission denied for table/);
  assert.ok(pa.pipeline.id !== pb.pipeline.id);
});

test("rls: active-organization switch changes visibility", async ({ s, tenant }) => {
  const a = await tenant();
  const b = await tenant();
  await rpc.ensure(s, a.founder);
  await rpc.ensure(s, b.founder);
  const multi = await createUser(s, [[a.org, "admin"], [b.org, "founder"]], a.org);
  const orgs = async () => as(s, multi, async () =>
    [...new Set((await s.query("select organization_id from public.sales_pipeline_stages")).map((row) => row.organization_id))]);
  assert.deepEqual(await orgs(), [a.org]);
  await s.exec(`update public.user_active_organizations set organization_id = '${b.org}' where user_id = '${multi}'`);
  assert.deepEqual(await orgs(), [b.org]);
});

test("grants: direct table writes are denied for authenticated, anon and service_role", async ({ s, tenant }) => {
  const t = await tenant();
  const { pipeline, stages } = await rpc.ensure(s, t.founder);
  const statements = [
    `insert into public.sales_pipelines (organization_id, name, created_by) values ('${t.org}', 'Direct', '${t.founder}')`,
    `update public.sales_pipelines set name = 'Hacked' where id = '${pipeline.id}'`,
    `delete from public.sales_pipelines where id = '${pipeline.id}'`,
    `insert into public.sales_pipeline_stages (organization_id, pipeline_id, key, name, kind, default_probability_bps, position, created_by)
       values ('${t.org}', '${pipeline.id}', 'direct', 'Direct', 'open', 0, 7, '${t.founder}')`,
    `update public.sales_pipeline_stages set name = 'Hacked' where id = '${stages[0].id}'`,
    `delete from public.sales_pipeline_stages where id = '${stages[0].id}'`,
    `insert into public.sales_audit_log (organization_id, actor_user_id, action, entity_type, entity_id)
       values ('${t.org}', '${t.founder}', 'sales.stage.created', 'stage', gen_random_uuid())`,
    `update public.sales_audit_log set details = '{}'`,
    `delete from public.sales_audit_log`,
    `truncate public.sales_audit_log`,
    `truncate public.sales_pipeline_stages`,
    `truncate public.sales_pipelines`,
  ];
  for (const [role, user] of [["authenticated", t.founder], ["anon", null], ["service_role", null]]) {
    for (const sql of statements) {
      await rejects(as(s, user, () => s.query(sql), role), /permission denied for table/);
    }
  }
  assert.equal((await stageByKey(s, pipeline.id, "new")).name, "Nuevo");
  assert.equal((await auditRows(s, t.org)).length, 1);
});

test("isolation: cross-organization ids are rejected by every RPC without side effects", async ({ s, tenant }) => {
  const a = await tenant();
  const b = await tenant();
  const pa = await rpc.ensure(s, a.founder);
  const pb = await rpc.ensure(s, b.founder);
  const bStage = pb.stages.find((stage) => stage.key === "proposal");
  const bLost = pb.stages.find((stage) => stage.key === "lost");
  await rejects(rpc.create(s, a.founder, pb.pipeline.id, "intruder", "Intruder", "open"), "SALES_NOT_FOUND");
  await rejects(rpc.update(s, a.founder, bStage.id, { name: "Owned" }, bStage.version), "SALES_NOT_FOUND");
  await rejects(rpc.archive(s, a.founder, bStage.id), "SALES_NOT_FOUND");
  await rejects(rpc.archive(s, a.founder, bLost.id), "SALES_NOT_FOUND");
  await rejects(rpc.reorder(s, a.founder, pb.pipeline.id, pb.stages.map((stage) => stage.id)), "SALES_NOT_FOUND");
  const mixed = pa.stages.map((stage) => stage.id);
  mixed[2] = bStage.id;
  await rejects(rpc.reorder(s, a.founder, pa.pipeline.id, mixed), "SALES_INVALID_STAGE_SET");
  await rejects(rpc.reorder(s, a.founder, pa.pipeline.id, [...pa.stages.map((stage) => stage.id), bStage.id]),
    "SALES_INVALID_STAGE_SET");
  const bAfter = await activeStages(s, pb.pipeline.id);
  assert.deepEqual(bAfter.map((row) => [row.id, row.name, row.position, row.version]),
    pb.stages.map((row) => [row.id, row.name, row.position, row.version]));
  assert.equal((await auditRows(s, a.org)).length, 1);
  assert.equal((await auditRows(s, b.org)).length, 1);
});

test("isolation: composite foreign key blocks cross-organization stage rows even for the owner", async ({ s, tenant }) => {
  const a = await tenant();
  const b = await tenant();
  await rpc.ensure(s, a.founder);
  const pb = await rpc.ensure(s, b.founder);
  await rejects(ownerTx(s, `
    insert into public.sales_pipeline_stages (organization_id, pipeline_id, key, name, kind, default_probability_bps, position, created_by)
    values ('${a.org}', '${pb.pipeline.id}', 'smuggled', 'Smuggled', 'open', 0, 7, '${a.founder}')`),
  /sales_pipeline_stages_pipeline_fkey|SALES_IMMUTABLE/);
  await rejects(ownerTx(s, `update public.sales_pipeline_stages set organization_id = '${a.org}' where pipeline_id = '${pb.pipeline.id}' and key = 'new'`),
    "SALES_IMMUTABLE");
});

test("default pipeline: canonical stages, idempotent, one audit row", async ({ s, tenant }) => {
  const t = await tenant();
  const first = await rpc.ensure(s, t.founder);
  assert.equal(first.was_created, true);
  assert.equal(first.pipeline.name, EXPECTED.CANONICAL_DEFAULT_PIPELINE.name);
  assert.equal(first.pipeline.is_default, true);
  assert.equal(first.pipeline.organization_id, t.org);
  assert.equal(first.pipeline.created_by, t.founder);
  assert.deepEqual(
    first.stages.map((stage) => ({ key: stage.key, name: stage.name, kind: stage.kind, probability: stage.default_probability_bps, position: stage.position })),
    EXPECTED.CANONICAL_DEFAULT_PIPELINE.stages);
  for (let index = 0; index < 3; index += 1) {
    const again = await rpc.ensure(s, index % 2 ? t.founder : t.admin);
    assert.equal(again.was_created, false);
    assert.equal(again.pipeline.id, first.pipeline.id);
    assert.deepEqual(again.stages.map((stage) => stage.id), first.stages.map((stage) => stage.id));
  }
  assert.equal(await countOf(s, "select count(*) from public.sales_pipelines where organization_id = $1", [t.org]), 1);
  assert.equal(await countOf(s, "select count(*) from public.sales_pipeline_stages where organization_id = $1", [t.org]), 6);
  const audit = await auditRows(s, t.org);
  assert.equal(audit.length, 1);
  assert.equal(audit[0].action, "sales.pipeline.created");
  assert.equal(audit[0].entity_type, "pipeline");
  assert.equal(audit[0].entity_id, first.pipeline.id);
  assert.equal(audit[0].actor_user_id, t.founder);
  assert.deepEqual(audit[0].details.stages.map((stage) => stage.key), EXPECTED.CANONICAL_DEFAULT_PIPELINE.stages.map((stage) => stage.key));
});

test("stages: create appends, validates input and enforces uniqueness", async ({ s, tenant }) => {
  const t = await tenant();
  const { pipeline } = await rpc.ensure(s, t.founder);
  const created = await rpc.create(s, t.admin, pipeline.id, "follow_up", "  Seguimiento  ", "open", 6000);
  assert.equal(created.position, 7);
  assert.equal(created.name, "Seguimiento");
  assert.equal(Number(created.version), 1);
  assert.equal(created.organization_id, t.org);
  const lostTwo = await rpc.create(s, t.founder, pipeline.id, "lost_no_budget", "Sin presupuesto", "lost");
  assert.equal(lostTwo.default_probability_bps, 0);
  await rejects(rpc.create(s, t.founder, pipeline.id, "follow_up", "Otro", "open"), "SALES_STAGE_KEY_EXISTS");
  await rejects(rpc.create(s, t.founder, pipeline.id, "other_key", "seguimiento", "open"), "SALES_STAGE_NAME_EXISTS");
  await rejects(rpc.create(s, t.founder, pipeline.id, "won_two", "Ganado 2", "won"), "SALES_WON_STAGE_EXISTS");
  const invalid = [
    [pipeline.id, "Bad-Key", "Name", "open", null],
    [pipeline.id, "1starts_digit", "Name", "open", null],
    [pipeline.id, "a".repeat(41), "Name", "open", null],
    [pipeline.id, "ok_key", "   ", "open", null],
    [pipeline.id, "ok_key", "x".repeat(81), "open", null],
    [pipeline.id, "ok_key", "Tab\there", "open", null],
    [pipeline.id, "ok_key", "Name", "closed", null],
    [pipeline.id, "ok_key", "Name", "won", 5000],
    [pipeline.id, "ok_key", "Name", "lost", 10],
    [pipeline.id, "ok_key", "Name", "open", 10001],
    [pipeline.id, "ok_key", "Name", "open", -1],
    [null, "ok_key", "Name", "open", null],
    [pipeline.id, null, "Name", "open", null],
  ];
  for (const args of invalid) await rejects(rpc.create(s, t.founder, ...args), "SALES_INVALID_INPUT");
  await rejects(rpc.create(s, t.founder, randomUUID(), "ok_key", "Name", "open"), "SALES_NOT_FOUND");
  // Keys stay reserved after archive.
  await rpc.archive(s, t.founder, created.id);
  await rejects(rpc.create(s, t.founder, pipeline.id, "follow_up", "Seguimiento", "open"), "SALES_STAGE_KEY_EXISTS");
  // Names are only unique among active stages.
  const reused = await rpc.create(s, t.founder, pipeline.id, "follow_up_2", "Seguimiento", "open");
  assert.equal(reused.name, "Seguimiento");
  await assertStructure(s, pipeline.id);
  const audit = await auditRows(s, t.org);
  assert.deepEqual(audit.map((row) => row.action), [
    "sales.pipeline.created", "sales.stage.created", "sales.stage.created", "sales.stage.archived", "sales.stage.created",
  ]);
  assert.deepEqual(audit[1].details, {
    pipeline_id: pipeline.id, key: "follow_up", name: "Seguimiento", kind: "open", default_probability_bps: 6000, position: 7,
  });
});

test("stages: 50 active stages is the hard limit", async ({ s, tenant }) => {
  const t = await tenant();
  const { pipeline } = await rpc.ensure(s, t.founder);
  for (let index = 7; index <= 50; index += 1) {
    await rpc.create(s, t.founder, pipeline.id, `extra_${index}`, `Extra ${index}`, "open");
  }
  await rejects(rpc.create(s, t.founder, pipeline.id, "extra_51", "Extra 51", "open"), "SALES_STAGE_LIMIT");
  const stages = await assertStructure(s, pipeline.id);
  assert.equal(stages.length, 50);
});

test("terminal stages: RPC refuses to archive the won stage and the last lost stage", async ({ s, tenant }) => {
  const t = await tenant();
  const { pipeline, stages } = await rpc.ensure(s, t.founder);
  const won = stages.find((stage) => stage.kind === "won");
  const lost = stages.find((stage) => stage.kind === "lost");
  await rejects(rpc.archive(s, t.founder, won.id), "SALES_LAST_WON_STAGE");
  await rejects(rpc.archive(s, t.founder, lost.id), "SALES_LAST_LOST_STAGE");
  const lostTwo = await rpc.create(s, t.founder, pipeline.id, "lost_two", "Perdido 2", "lost");
  const archived = await rpc.archive(s, t.admin, lost.id);
  assert.equal(archived.status, "archived");
  assert.equal(archived.position, null);
  assert.equal(archived.archived_by, t.admin);
  await rejects(rpc.archive(s, t.founder, lostTwo.id), "SALES_LAST_LOST_STAGE");
  const again = await rpc.archive(s, t.founder, lost.id);
  assert.equal(Number(again.version), Number(archived.version), "re-archive is a no-op");
  await rejects(rpc.update(s, t.founder, lost.id, { name: "X" }, archived.version), "SALES_STAGE_ARCHIVED");
  const final = await assertStructure(s, pipeline.id);
  assert.deepEqual(final.map((stage) => stage.key), ["new", "qualified", "proposal", "negotiation", "won", "lost_two"]);
  const audit = await auditRows(s, t.org);
  assert.equal(audit.filter((row) => row.action === "sales.stage.archived").length, 1);
});

test("terminal stages: database enforces invariants even when RPCs are bypassed", async ({ s, tenant }) => {
  const t = await tenant();
  const { pipeline, stages } = await rpc.ensure(s, t.founder);
  const won = stages.find((stage) => stage.kind === "won");
  const lost = stages.find((stage) => stage.kind === "lost");
  const archiveSql = (id) => `update public.sales_pipeline_stages
    set status = 'archived', position = null, archived_at = now(), archived_by = '${t.founder}' where id = '${id}';`;
  // Archive won and close the position gap: only the terminal invariant is violated.
  await rejects(ownerTx(s, `${archiveSql(won.id)}
    update public.sales_pipeline_stages set position = 5 where id = '${lost.id}';`), "SALES_TERMINAL_STAGE_INVARIANT");
  // Archive the only lost stage (last position): only the terminal invariant is violated.
  await rejects(ownerTx(s, archiveSql(lost.id)), "SALES_TERMINAL_STAGE_INVARIANT");
  // A second active won stage is rejected immediately by the partial unique index.
  const secondWon = rejects(ownerTx(s, `
    insert into public.sales_pipeline_stages (organization_id, pipeline_id, key, name, kind, default_probability_bps, position, created_by)
    values ('${t.org}', '${pipeline.id}', 'won_two', 'Ganado 2', 'won', 10000, 7, '${t.founder}');`),
  "sales_pipeline_stages_one_active_won_idx");
  await secondWon;
  // A pipeline without stages cannot commit.
  await rejects(ownerTx(s, `insert into public.sales_pipelines (organization_id, name, created_by)
    values ('${t.org}', 'Empty', '${t.founder}');`), "SALES_TERMINAL_STAGE_INVARIANT");
  // Position gaps and duplicates cannot commit.
  await rejects(ownerTx(s, `update public.sales_pipeline_stages set position = 9 where id = '${lost.id}';`),
    "SALES_STAGE_POSITION_INVARIANT");
  await rejects(ownerTx(s, `update public.sales_pipeline_stages set position = 1 where id = '${lost.id}';`),
    /sales_pipeline_stages_pipeline_position_key|SALES_STAGE_POSITION_INVARIANT/);
  await assertStructure(s, pipeline.id);
});

test("immutability: identity columns, restore, deletes and version rewinds are rejected for the owner", async ({ s, tenant }) => {
  const t = await tenant();
  const { pipeline, stages } = await rpc.ensure(s, t.founder);
  const stage = stages.find((item) => item.key === "proposal");
  const pb = await rpc.ensure(s, (await tenant()).founder);
  const attempts = [
    `update public.sales_pipeline_stages set key = 'renamed' where id = '${stage.id}'`,
    `update public.sales_pipeline_stages set kind = 'lost', default_probability_bps = 0 where id = '${stage.id}'`,
    `update public.sales_pipeline_stages set pipeline_id = '${pb.pipeline.id}' where id = '${stage.id}'`,
    `update public.sales_pipeline_stages set created_by = gen_random_uuid() where id = '${stage.id}'`,
    `delete from public.sales_pipeline_stages where id = '${stage.id}'`,
    `update public.sales_pipelines set is_default = false where id = '${pipeline.id}'`,
    `update public.sales_pipelines set organization_id = '${pb.pipeline.organization_id}' where id = '${pipeline.id}'`,
    `update public.sales_pipelines set structure_version = 1 where id = '${pipeline.id}'`,
    `delete from public.sales_pipelines where id = '${pipeline.id}'`,
    `truncate public.sales_pipeline_stages`,
    `truncate public.sales_pipelines, public.sales_pipeline_stages`,
    `truncate public.sales_pipelines cascade`,
  ];
  for (const sql of attempts) await rejects(ownerTx(s, sql), "SALES_IMMUTABLE");
  // A plain truncate of the parent is already stopped by the foreign key.
  await rejects(ownerTx(s, "truncate public.sales_pipelines"), /SALES_IMMUTABLE|cannot truncate a table referenced/);
  assert.equal(await countOf(s, "select count(*) from public.sales_pipeline_stages where pipeline_id = $1", [pipeline.id]), 6);
  const extra = await rpc.create(s, t.founder, pipeline.id, "extra", "Extra", "open");
  const archived = await rpc.archive(s, t.founder, extra.id);
  await rejects(ownerTx(s, `update public.sales_pipeline_stages set status = 'active', position = 7, archived_at = null, archived_by = null
    where id = '${archived.id}'`), "SALES_IMMUTABLE");
  // The owner cannot rewind or freeze a version: the guard always derives it.
  await ownerTx(s, `update public.sales_pipeline_stages set name = 'Propuesta X', version = 1 where id = '${stage.id}'`);
  assert.equal(Number((await stageByKey(s, pipeline.id, "proposal")).version), Number(stage.version) + 1);
  await ownerTx(s, `update public.sales_pipeline_stages set version = 999 where id = '${stage.id}'`);
  assert.equal(Number((await stageByKey(s, pipeline.id, "proposal")).version), Number(stage.version) + 1);
});

test("audit: append-only for every role, including the table owner", async ({ s, tenant }) => {
  const t = await tenant();
  await rpc.ensure(s, t.founder);
  const before = await auditRows(s, t.org);
  assert.equal(before.length, 1);
  await rejects(ownerTx(s, `update public.sales_audit_log set details = '{"forged": true}' where organization_id = '${t.org}'`), "SALES_IMMUTABLE");
  await rejects(ownerTx(s, `delete from public.sales_audit_log where organization_id = '${t.org}'`), "SALES_IMMUTABLE");
  await rejects(ownerTx(s, "truncate public.sales_audit_log"), "SALES_IMMUTABLE");
  for (const role of ["authenticated", "service_role", "anon"]) {
    await rejects(as(s, t.founder, () => s.query(`update public.sales_audit_log set details = '{}'`), role), /permission denied/);
    await rejects(as(s, t.founder, () => s.query("delete from public.sales_audit_log"), role), /permission denied/);
  }
  assert.deepEqual(await auditRows(s, t.org), before);
});

test("audit: each successful mutation writes exactly one entry; failures and no-ops write none", async ({ s, tenant }) => {
  const t = await tenant();
  const { pipeline, stages } = await rpc.ensure(s, t.founder);
  const proposal = stages.find((stage) => stage.key === "proposal");
  const won = stages.find((stage) => stage.kind === "won");
  const lost = stages.find((stage) => stage.kind === "lost");
  const expectAudit = async (count, label) =>
    assert.equal((await auditRows(s, t.org)).length, count, label);
  await expectAudit(1, "ensure");

  // Failures leave no residue.
  await rejects(rpc.create(s, t.founder, pipeline.id, "won_two", "Ganado 2", "won"), "SALES_WON_STAGE_EXISTS");
  await rejects(rpc.archive(s, t.founder, won.id), "SALES_LAST_WON_STAGE");
  await rejects(rpc.archive(s, t.founder, lost.id), "SALES_LAST_LOST_STAGE");
  await rejects(rpc.update(s, t.founder, proposal.id, { name: "X" }, 99), "SALES_VERSION_CONFLICT");
  await rejects(rpc.reorder(s, t.founder, pipeline.id, stages.slice(1).map((stage) => stage.id)), "SALES_INVALID_STAGE_SET");
  await rejects(rpc.create(s, t.lead, pipeline.id, "x_key", "X", "open"), "SALES_FORBIDDEN");
  await expectAudit(1, "after failures");

  // No-ops write nothing.
  await rpc.ensure(s, t.admin);
  await rpc.update(s, t.founder, proposal.id, { name: "Propuesta", default_probability_bps: 5000 }, proposal.version);
  await rpc.reorder(s, t.founder, pipeline.id, stages.map((stage) => stage.id));
  await expectAudit(1, "after no-ops");

  const created = await rpc.create(s, t.admin, pipeline.id, "demo", "Demo", "open", 3000);
  await expectAudit(2, "create");
  const updated = await rpc.update(s, t.founder, created.id, { name: "Demo 2" }, created.version);
  await expectAudit(3, "update");
  const order = [created.id, ...stages.map((stage) => stage.id)];
  await rpc.reorder(s, t.founder, pipeline.id, order);
  await expectAudit(4, "reorder");
  const current = await stageByKey(s, pipeline.id, "demo");
  await rpc.archive(s, t.admin, current.id);
  const audit = await auditRows(s, t.org);
  assert.deepEqual(audit.map((row) => [row.action, row.entity_type, row.entity_id, row.actor_user_id]), [
    ["sales.pipeline.created", "pipeline", pipeline.id, t.founder],
    ["sales.stage.created", "stage", created.id, t.admin],
    ["sales.stage.updated", "stage", created.id, t.founder],
    ["sales.stages.reordered", "pipeline", pipeline.id, t.founder],
    ["sales.stage.archived", "stage", created.id, t.admin],
  ]);
  assert.deepEqual(audit[2].details, {
    pipeline_id: pipeline.id, version_from: 1, version_to: Number(updated.version),
    changes: { name: { from: "Demo", to: "Demo 2" } },
  });
  assert.deepEqual(audit[3].details.before, [...stages.map((stage) => stage.id), created.id]);
  assert.deepEqual(audit[3].details.after, order);
  assert.equal(audit[4].details.previous_position, 1);
});

test("optimistic locking: expected_version, conflicts, no-ops and validation", async ({ s, tenant }) => {
  const t = await tenant();
  const { stages } = await rpc.ensure(s, t.founder);
  const proposal = stages.find((stage) => stage.key === "proposal");
  const won = stages.find((stage) => stage.kind === "won");
  const lost = stages.find((stage) => stage.kind === "lost");
  const v1 = Number(proposal.version);

  const updated = await rpc.update(s, t.founder, proposal.id, { name: "Propuesta enviada", default_probability_bps: 5500 }, v1);
  assert.equal(Number(updated.version), v1 + 1);
  assert.equal(updated.name, "Propuesta enviada");
  assert.equal(updated.default_probability_bps, 5500);

  await rejects(rpc.update(s, t.admin, proposal.id, { name: "Stale" }, v1), "SALES_VERSION_CONFLICT");
  await rejects(rpc.update(s, t.admin, proposal.id, { name: "Propuesta enviada" }, v1), "SALES_VERSION_CONFLICT");
  await rejects(rpc.update(s, t.admin, proposal.id, { name: "Future" }, v1 + 5), "SALES_VERSION_CONFLICT");
  const noop = await rpc.update(s, t.admin, proposal.id, { name: "  Propuesta enviada " }, v1 + 1);
  assert.equal(Number(noop.version), v1 + 1, "no-op does not bump version");

  const invalid = [
    [{ key: "renamed" }], [{ kind: "lost" }], [{ position: 1 }], [{ status: "archived" }], [{ version: 9 }],
    [{}], [[]], ["text"], [null],
    [{ name: "" }], [{ name: 42 }], [{ name: "x".repeat(81) }], [{ name: "a\u0007b" }],
    [{ default_probability_bps: 12.5 }], [{ default_probability_bps: "5000" }], [{ default_probability_bps: 10001 }],
    [{ default_probability_bps: -1 }], [{ default_probability_bps: null }],
  ];
  for (const [changes] of invalid) {
    await rejects(rpc.update(s, t.founder, proposal.id, changes, v1 + 1), "SALES_INVALID_INPUT");
  }
  await rejects(rpc.update(s, t.founder, proposal.id, { name: "x" }, null), "SALES_INVALID_INPUT");
  await rejects(rpc.update(s, t.founder, won.id, { default_probability_bps: 9000 }, won.version), "SALES_INVALID_INPUT");
  await rejects(rpc.update(s, t.founder, lost.id, { default_probability_bps: 100 }, lost.version), "SALES_INVALID_INPUT");
  const renamedWon = await rpc.update(s, t.founder, won.id, { name: "Cerrado ganado", default_probability_bps: 10000 }, won.version);
  assert.equal(renamedWon.name, "Cerrado ganado");
  await rejects(rpc.update(s, t.founder, proposal.id, { name: "NUEVO" }, v1 + 1), "SALES_STAGE_NAME_EXISTS");
  await rejects(rpc.update(s, t.founder, randomUUID(), { name: "x" }, 1), "SALES_NOT_FOUND");
  const final = await stageByKey(s, proposal.pipeline_id, "proposal");
  assert.equal(Number(final.version), v1 + 1);
  assert.equal(final.name, "Propuesta enviada");
});

test("reorder: exact active set, deterministic order, compaction after archive", async ({ s, tenant }) => {
  const t = await tenant();
  const { pipeline, stages } = await rpc.ensure(s, t.founder);
  const ids = stages.map((stage) => stage.id);
  const reversed = [...ids].reverse();
  const result = await rpc.reorder(s, t.founder, pipeline.id, reversed);
  assert.deepEqual(result.map((stage) => stage.id), reversed, "returned in requested order");
  assert.deepEqual(result.map((stage) => stage.position), [1, 2, 3, 4, 5, 6]);
  assert.deepEqual((await activeStages(s, pipeline.id)).map((stage) => stage.id), reversed, "persisted order");

  const archivedStage = await rpc.archive(s, t.founder, reversed[2]);
  const afterArchive = await assertStructure(s, pipeline.id);
  assert.deepEqual(afterArchive.map((stage) => stage.id), reversed.filter((id) => id !== reversed[2]));

  const active = afterArchive.map((stage) => stage.id);
  const bad = [
    ["missing id", active.slice(1)],
    ["duplicate id", [active[0], ...active.slice(0, -1)]],
    ["unknown id", [...active.slice(0, -1), randomUUID()]],
    ["extra id", [...active, randomUUID()]],
    ["archived id", [...active.slice(0, -1), archivedStage.id]],
    ["archived id appended", [...active, archivedStage.id]],
  ];
  for (const [label, list] of bad) {
    await rejects(rpc.reorder(s, t.founder, pipeline.id, list), "SALES_INVALID_STAGE_SET").catch((error) => {
      throw new Error(`${label}: ${error.message}`);
    });
  }
  await rejects(rpc.reorder(s, t.founder, pipeline.id, `{${active.slice(0, -1).join(",")},NULL}`), "SALES_INVALID_STAGE_SET");
  await rejects(rpc.reorder(s, t.founder, pipeline.id, "{}"), "SALES_INVALID_INPUT");
  await rejects(rpc.reorder(s, t.founder, pipeline.id, null), "SALES_INVALID_INPUT");
  await rejects(rpc.reorder(s, t.founder, pipeline.id, `{{${active[0]}},{${active[1]}}}`), "SALES_INVALID_INPUT");
  await rejects(rpc.reorder(s, t.founder, randomUUID(), active), "SALES_NOT_FOUND");
  assert.deepEqual((await activeStages(s, pipeline.id)).map((stage) => stage.id), active, "failed reorders change nothing");

  // Identical order: no-op, no version bumps.
  const versions = (await activeStages(s, pipeline.id)).map((stage) => Number(stage.version));
  await rpc.reorder(s, t.founder, pipeline.id, active);
  assert.deepEqual((await activeStages(s, pipeline.id)).map((stage) => Number(stage.version)), versions);
  // Repeated reads are stable.
  for (let index = 0; index < 3; index += 1) {
    assert.deepEqual((await activeStages(s, pipeline.id)).map((stage) => stage.id), active);
  }
});

test("migration: re-applying fails loudly and leaves the database unchanged", async ({ s, migrationSql }) => {
  const before = await catalog(s);
  await rejects(applySql(s, migrationSql), /already exists/);
  assert.deepEqual(await catalog(s), before);
});

test("migration: drift (pre-existing sales object) aborts the whole migration atomically", { isolatedDb: true }, async ({ s, migrationSql }) => {
  await s.exec("create table public.sales_pipelines (id uuid primary key)");
  await rejects(applySql(s, migrationSql), /already exists/);
  const relations = await s.query("select relname::text as relname from pg_class where relname like 'sales\\_%' order by relname");
  assert.deepEqual(relations.map((row) => row.relname), ["sales_pipelines", "sales_pipelines_pkey"],
    "only the drift table exists");
  assert.equal(await countOf(s, "select count(*) from pg_proc where proname like 'sales\\_%'"), 0);
  assert.equal(await countOf(s, "select count(*) from pg_policy where polname like 'sales\\_%'"), 0);
});

test("rollback: apply, verify, blocked cases, rollback, zero objects, reapply, verify", { isolatedDb: true }, async ({ s, migrationSql, rollbackSql, tenantIn }) => {
  const pristine = await nonSalesSnapshot(s);
  await applySql(s, migrationSql);
  await s.exec(`insert into supabase_migrations.schema_migrations(version, name) values ('${EXPECTED.MIGRATION_VERSION}', 'sales_v1_foundation')`);
  await verifyCatalog(s);
  const t = await tenantIn(s);
  await rpc.ensure(s, t.founder);

  // Blocked: rows exist and no confirmation.
  await rejects(s.exec(rollbackSql), "SALES_ROLLBACK_BLOCKED");
  await s.exec("rollback").catch(() => {});
  await verifyCatalog(s);
  assert.equal(await countOf(s, "select count(*) from public.sales_audit_log"), 1);

  const confirmed = rollbackSql.replace("begin;",
    "begin;\nselect set_config('orvesen.sales_rollback_confirm', 'DESTROY_SALES_V1_INC1_DATA', true);");
  assert.notEqual(confirmed, rollbackSql);

  // Blocked: an unknown sales object exists (later increment or drift).
  await s.exec("create table public.sales_unexpected (id int)");
  await rejects(s.exec(confirmed), "SALES_ROLLBACK_BLOCKED");
  await s.exec("rollback").catch(() => {});
  await s.exec("drop table public.sales_unexpected");
  await verifyCatalog(s);

  // Blocked: a foreign dependent object (no CASCADE).
  await s.exec("create view public.depends_on_sales as select id from public.sales_pipelines");
  await rejects(s.exec(confirmed), /depends on|cannot drop/);
  await s.exec("rollback").catch(() => {});
  await s.exec("drop view public.depends_on_sales");
  await verifyCatalog(s);

  // Blocked: a missing expected object (partial / unknown state).
  await s.exec("begin; drop index public.sales_audit_log_entity_idx;");
  await rejects(s.exec(confirmed.replace("begin;", "")), "SALES_ROLLBACK_BLOCKED");
  await s.exec("rollback").catch(() => {});
  await verifyCatalog(s);

  // Confirmed rollback.
  await s.exec(confirmed);
  assert.equal(await salesObjectCount(s), 0, "zero Sales objects remain");
  assert.equal(await countOf(s, "select count(*) from supabase_migrations.schema_migrations where version = $1", [EXPECTED.MIGRATION_VERSION]), 0);
  assert.deepEqual(await nonSalesSnapshot(s), pristine, "non-Sales catalog identical to before the migration");

  // Rollback on an already rolled-back database fails closed.
  await rejects(s.exec(confirmed), "SALES_ROLLBACK_BLOCKED");
  await s.exec("rollback").catch(() => {});

  // Reapply and verify again, including behaviour.
  await applySql(s, migrationSql);
  await verifyCatalog(s);
  const again = await rpc.ensure(s, t.founder);
  assert.equal(again.was_created, true);
  await assertStructure(s, again.pipeline.id);
});

// ---------------------------------------------------------------------------
// Concurrency tests (real PostgreSQL only)
// ---------------------------------------------------------------------------

test("concurrency: 8 simultaneous first calls create exactly one default pipeline", { concurrency: true }, async ({ s, db, tenant }) => {
  const t = await tenant();
  const sessions = await Promise.all(Array.from({ length: 8 }, () => db.session()));
  await Promise.all(sessions.map((session, index) => session.exec(
    `select set_config('request.jwt.claim.sub', '${index % 2 ? t.admin : t.founder}', false); set role authenticated;`)));
  const results = await Promise.all(sessions.map((session) => settle(
    session.query("select public.sales_ensure_default_pipeline() as r").then((rows) => rows[0].r))));
  for (const result of results) assert.ok(result.ok, result.error?.message);
  const values = results.map((result) => result.value);
  assert.equal(new Set(values.map((value) => value.pipeline.id)).size, 1, "one pipeline id");
  assert.equal(values.filter((value) => value.was_created).length, 1, "exactly one creator");
  assert.equal(await countOf(s, "select count(*) from public.sales_pipelines where organization_id = $1", [t.org]), 1);
  assert.equal(await countOf(s, "select count(*) from public.sales_pipeline_stages where organization_id = $1", [t.org]), 6);
  assert.equal((await auditRows(s, t.org)).length, 1);
  await Promise.all(sessions.map((session) => session.close()));
});

test("concurrency: interleaved first calls - the second waits and returns the first pipeline", { concurrency: true }, async ({ s, db, tenant }) => {
  const t = await tenant();
  const one = await db.session();
  const two = await db.session();
  await beginAs(one, t.founder);
  const created = (await one.query("select public.sales_ensure_default_pipeline() as r"))[0].r;
  assert.equal(created.was_created, true);
  await beginAs(two, t.admin);
  const pending = settle(two.query("select public.sales_ensure_default_pipeline() as r").then((rows) => rows[0].r));
  const state = await waitForBlocked(s, two.pid, pending);
  await one.exec("commit");
  const second = await pending;
  if (second.ok) await two.exec("commit"); else await two.exec("rollback");
  assert.equal(state, "blocked", "second caller must wait for the first");
  assert.ok(second.ok, second.error?.message);
  assert.equal(second.value.was_created, false);
  assert.equal(second.value.pipeline.id, created.pipeline.id);
  assert.equal(await countOf(s, "select count(*) from public.sales_pipelines where organization_id = $1 and is_default", [t.org]), 1);
  assert.equal(await countOf(s, "select count(*) from public.sales_pipeline_stages where organization_id = $1", [t.org]), 6);
  await one.close();
  await two.close();
});

test("concurrency: two RPC archives of different lost stages cannot remove both", { concurrency: true }, async ({ s, db, tenant }) => {
  for (const isolation of ["read committed", "repeatable read", "serializable"]) {
    const t = await tenant();
    const { pipeline, stages } = await rpc.ensure(s, t.founder);
    const lostA = stages.find((stage) => stage.kind === "lost");
    const lostB = await rpc.create(s, t.founder, pipeline.id, "lost_b", "Perdido B", "lost");
    const one = await db.session();
    const two = await db.session();
    await beginAs(one, t.founder, isolation);
    await one.query("select * from public.sales_archive_stage($1::uuid)", [lostA.id]);
    await beginAs(two, t.admin, isolation);
    const pending = settle(two.query("select * from public.sales_archive_stage($1::uuid)", [lostB.id]));
    const state = await waitForBlocked(s, two.pid, pending);
    await one.exec("commit");
    const second = await pending;
    const commit = second.ok ? await settle(two.exec("commit")) : (await two.exec("rollback"), { ok: false });
    assert.equal(state, "blocked", `${isolation}: second archive waits`);
    assert.equal(second.ok && commit.ok, false, `${isolation}: second archive must fail`);
    if (isolation === "read committed") {
      assert.equal(second.error.message, "SALES_LAST_LOST_STAGE", `${isolation}: friendly error`);
    } else {
      assert.match(errorText(second.error), /SALES_LAST_LOST_STAGE|could not serialize/);
    }
    const final = await assertStructure(s, pipeline.id);
    assert.deepEqual(final.filter((stage) => stage.kind === "lost").map((stage) => stage.id), [lostB.id]);
    await one.close();
    await two.close();
  }
});

test("concurrency: write skew on lost stages is impossible even when RPCs are bypassed", { concurrency: true }, async ({ s, db, tenant }) => {
  for (const isolation of ["read committed", "repeatable read"]) {
    const t = await tenant();
    const { pipeline, stages } = await rpc.ensure(s, t.founder);
    const lostA = stages.find((stage) => stage.kind === "lost"); // position 6
    const extra = await rpc.create(s, t.founder, pipeline.id, "extra", "Extra", "open"); // position 7
    const lostB = await rpc.create(s, t.founder, pipeline.id, "lost_b", "Perdido B", "lost"); // position 8
    const archive = (id) => `update public.sales_pipeline_stages
      set status = 'archived', position = null, archived_at = now(), archived_by = '${t.founder}' where id = '${id}';`;
    const one = await db.session();
    const two = await db.session();
    // Each transaction is valid on its own; together they would leave zero lost stages.
    await one.exec(`begin isolation level ${isolation}; select 1;`);
    await two.exec(`begin isolation level ${isolation}; select count(*) from public.sales_pipeline_stages;`);
    await one.exec(archive(lostB.id));
    const pending = settle(two.exec(`${archive(lostA.id)}
      update public.sales_pipeline_stages set position = 6 where id = '${extra.id}';`));
    const state = await waitForBlocked(s, two.pid, pending);
    await one.exec("commit");
    const second = await pending;
    const commit = second.ok ? await settle(two.exec("commit")) : (await two.exec("rollback"), { ok: false, error: second.error });
    const final = await activeStages(s, pipeline.id);
    assert.equal(final.filter((stage) => stage.kind === "lost").length, 1, `${isolation}: one lost stage survives`);
    assert.equal(commit.ok, false, `${isolation}: second transaction must fail`);
    assert.match(errorText(commit.error ?? second.error), /SALES_TERMINAL_STAGE_INVARIANT|could not serialize/);
    assert.equal(state, "blocked", `${isolation}: structural writes serialize on the pipeline row`);
    await assertStructure(s, pipeline.id);
    await one.close();
    await two.close();
  }
});

test("concurrency: at most one active won stage under concurrent owner writes", { concurrency: true }, async ({ s, db, tenant }) => {
  const t = await tenant();
  const { pipeline, stages } = await rpc.ensure(s, t.founder);
  const won = stages.find((stage) => stage.kind === "won"); // position 5
  const lost = stages.find((stage) => stage.kind === "lost"); // position 6
  const insertWon = (key, position) => `insert into public.sales_pipeline_stages
    (organization_id, pipeline_id, key, name, kind, default_probability_bps, position, created_by)
    values ('${t.org}', '${pipeline.id}', '${key}', '${key}', 'won', 10000, ${position}, '${t.founder}');`;
  const one = await db.session();
  const two = await db.session();
  // One: replace the won stage (valid on its own).
  await one.exec(`begin;
    update public.sales_pipeline_stages set status = 'archived', position = null, archived_at = now(), archived_by = '${t.founder}' where id = '${won.id}';
    update public.sales_pipeline_stages set position = 5 where id = '${lost.id}';
    ${insertWon("won_new", 6)}`);
  // Two: add another won stage at the same time.
  await two.exec("begin;");
  const pending = settle(two.exec(insertWon("won_other", 7)));
  const state = await waitForBlocked(s, two.pid, pending);
  await one.exec("commit");
  const second = await pending;
  const commit = second.ok ? await settle(two.exec("commit")) : (await two.exec("rollback"), { ok: false, error: second.error });
  assert.equal(commit.ok, false, "second won stage must be rejected");
  assert.match(errorText(commit.error), /sales_pipeline_stages_one_active_won_idx/);
  assert.equal(state, "blocked");
  const final = await assertStructure(s, pipeline.id);
  assert.deepEqual(final.filter((stage) => stage.kind === "won").map((stage) => stage.key), ["won_new"]);
  await one.close();
  await two.close();
});

test("concurrency: concurrent updates with the same expected_version - one wins, one conflicts", { concurrency: true }, async ({ s, db, tenant }) => {
  const t = await tenant();
  const { stages } = await rpc.ensure(s, t.founder);
  const stage = stages.find((item) => item.key === "qualified");
  const one = await db.session();
  const two = await db.session();
  await beginAs(one, t.founder);
  await one.query("select * from public.sales_update_stage($1::uuid, $2::jsonb, $3::bigint)",
    [stage.id, JSON.stringify({ name: "Calificado A" }), stage.version]);
  await beginAs(two, t.admin);
  const pending = settle(two.query("select * from public.sales_update_stage($1::uuid, $2::jsonb, $3::bigint)",
    [stage.id, JSON.stringify({ default_probability_bps: 3000 }), stage.version]));
  const state = await waitForBlocked(s, two.pid, pending);
  await one.exec("commit");
  const second = await pending;
  if (second.ok) await two.exec("commit"); else await two.exec("rollback");
  assert.equal(state, "blocked");
  assert.equal(second.ok, false, "stale writer must fail");
  assert.equal(second.error.message, "SALES_VERSION_CONFLICT");
  const final = await stageByKey(s, stage.pipeline_id, "qualified");
  assert.equal(final.name, "Calificado A");
  assert.equal(final.default_probability_bps, 2500);
  assert.equal(Number(final.version), Number(stage.version) + 1);
  assert.equal((await auditRows(s, t.org)).filter((row) => row.action === "sales.stage.updated").length, 1);
  await one.close();
  await two.close();
});

test("concurrency: concurrent stage creation keeps keys unique and positions contiguous", { concurrency: true }, async ({ s, db, tenant }) => {
  const t = await tenant();
  const { pipeline } = await rpc.ensure(s, t.founder);
  const createSql = "select * from public.sales_create_stage($1::uuid, $2::text, $3::text, 'open', null)";
  const one = await db.session();
  const two = await db.session();
  await beginAs(one, t.founder);
  await one.query(createSql, [pipeline.id, "demo", "Demo A"]);
  await beginAs(two, t.admin);
  const sameKey = settle(two.query(createSql, [pipeline.id, "demo", "Demo B"]));
  assert.equal(await waitForBlocked(s, two.pid, sameKey), "blocked");
  await one.exec("commit");
  const duplicate = await sameKey;
  await two.exec(duplicate.ok ? "commit" : "rollback");
  assert.equal(duplicate.ok, false);
  assert.equal(duplicate.error.message, "SALES_STAGE_KEY_EXISTS");

  await beginAs(one, t.founder);
  await one.query(createSql, [pipeline.id, "alpha", "Alpha"]);
  await beginAs(two, t.admin);
  const other = settle(two.query(createSql, [pipeline.id, "beta", "Beta"]));
  assert.equal(await waitForBlocked(s, two.pid, other), "blocked");
  await one.exec("commit");
  const second = await other;
  assert.ok(second.ok, second.error?.message);
  await two.exec("commit");
  const final = await assertStructure(s, pipeline.id);
  assert.deepEqual(final.slice(6).map((stage) => [stage.key, stage.position]), [["demo", 7], ["alpha", 8], ["beta", 9]]);
  await one.close();
  await two.close();
});

test("concurrency: reorder and archive serialize without corrupting positions", { concurrency: true }, async ({ s, db, tenant }) => {
  const t = await tenant();
  const { pipeline, stages } = await rpc.ensure(s, t.founder);
  const ids = stages.map((stage) => stage.id);
  const proposal = stages.find((stage) => stage.key === "proposal");
  const one = await db.session();
  const two = await db.session();

  // Archive first; a reorder built from the stale set must be rejected.
  await beginAs(one, t.founder);
  await one.query("select * from public.sales_archive_stage($1::uuid)", [proposal.id]);
  await beginAs(two, t.admin);
  const stale = settle(two.query("select * from public.sales_reorder_stages($1::uuid, $2::uuid[])",
    [pipeline.id, `{${[...ids].reverse().join(",")}}`]));
  assert.equal(await waitForBlocked(s, two.pid, stale), "blocked");
  await one.exec("commit");
  const staleResult = await stale;
  await two.exec(staleResult.ok ? "commit" : "rollback");
  assert.equal(staleResult.ok, false);
  assert.equal(staleResult.error.message, "SALES_INVALID_STAGE_SET");
  const afterArchive = await assertStructure(s, pipeline.id);

  // Reorder first; a concurrent archive then compacts the new order.
  const reversed = afterArchive.map((stage) => stage.id).reverse();
  const qualified = stages.find((stage) => stage.key === "qualified");
  await beginAs(one, t.founder);
  await one.query("select * from public.sales_reorder_stages($1::uuid, $2::uuid[])", [pipeline.id, `{${reversed.join(",")}}`]);
  await beginAs(two, t.admin);
  const archiveAfter = settle(two.query("select * from public.sales_archive_stage($1::uuid)", [qualified.id]));
  assert.equal(await waitForBlocked(s, two.pid, archiveAfter), "blocked");
  await one.exec("commit");
  const archived = await archiveAfter;
  assert.ok(archived.ok, archived.error?.message);
  await two.exec("commit");
  const final = await assertStructure(s, pipeline.id);
  assert.deepEqual(final.map((stage) => stage.id), reversed.filter((id) => id !== qualified.id));
  await one.close();
  await two.close();
});

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

export const TEST_NAMES = TESTS.map((item) => item.name);

export async function runSuite({ driver, migrationSql = readMigration(), rollbackSql = readRollback(), log = () => {} }) {
  const results = [];
  const record = (name, status, error) => {
    results.push({ name, status, error });
    log(`${status === "PASS" ? "PASS" : status === "SKIP" ? "SKIP" : "FAIL"}  ${name}${error ? `\n      ${error}` : ""}`);
  };

  const prepare = async (database, { apply = true } = {}) => {
    const session = await database.session();
    await session.exec(DATABASE_SQL);
    const before = await nonSalesSnapshot(session);
    if (apply) await applySql(session, migrationSql);
    return { session, before };
  };

  let shared;
  try {
    const database = await driver.newDatabase();
    shared = { database, ...(await prepare(database)) };
  } catch (error) {
    record("setup: bootstrap and apply migration", "FAIL", error.message);
    for (const item of TESTS) record(item.name, "FAIL", "setup failed");
    return results;
  }

  for (const item of TESTS) {
    if (item.concurrency && !driver.concurrency) {
      record(item.name, "SKIP", null);
      continue;
    }
    let database = shared.database;
    let session = shared.session;
    let before = shared.before;
    let isolated = null;
    try {
      if (item.isolatedDb) {
        isolated = await driver.newDatabase();
        database = isolated;
        const prepared = await prepare(isolated, { apply: false });
        session = prepared.session;
        before = prepared.before;
      }
      await item.fn({
        s: session,
        db: database,
        before,
        migrationSql,
        rollbackSql,
        tenant: () => createTenant(session),
        tenantIn: (target) => createTenant(target),
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

import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

const migrationUrl = new URL(
  "../migrations/20260915184800_builder_multipage_v1_pages_core.sql",
  import.meta.url,
);
const migration = await readFile(migrationUrl, "utf8");

const organizationA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const organizationB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const userA = "11111111-1111-4111-8111-111111111111";
const userB = "22222222-2222-4222-8222-222222222222";
const activeLandingA = "33333333-3333-4333-8333-333333333333";
const activeLandingB = "44444444-4444-4444-8444-444444444444";
const archivedLanding = "55555555-5555-4555-8555-555555555555";
const formAsset = "66666666-6666-4666-8666-666666666666";

async function rejectsWith(action, code) {
  await assert.rejects(action, (error) => String(error?.message || error).includes(code));
}

test("Multipage V1 migration compiles and preserves its invariants in PostgreSQL", async () => {
  const db = new PGlite();

  await db.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin bypassrls;
    grant authenticated, service_role to current_user;

    create schema auth;
    create schema private;

    create function auth.uid()
    returns uuid
    language sql
    stable
    as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;

    create table public.organizations (
      id uuid primary key,
      name text not null
    );

    create table public.users (
      id uuid primary key
    );

    create table public.member_module_access (
      user_id uuid not null,
      module_key text not null,
      enabled boolean not null default false,
      primary key (user_id, module_key)
    );
    grant select on public.member_module_access to authenticated;

    create function public.current_user_organization_id()
    returns uuid
    language sql
    stable
    security definer
    set search_path = ''
    as $$
      select nullif(current_setting('app.current_org', true), '')::uuid
    $$;

    create function public.can_manage_organization(target_organization_id uuid)
    returns boolean
    language sql
    stable
    security definer
    set search_path = ''
    as $$
      select target_organization_id = public.current_user_organization_id()
        and coalesce(nullif(current_setting('app.can_manage', true), ''), 'true') = 'true'
    $$;

    create table public.builder_assets (
      id uuid primary key default gen_random_uuid(),
      organization_id uuid not null references public.organizations(id) on delete cascade,
      asset_type text not null check (asset_type in ('landing_page', 'form')),
      name text not null check (char_length(btrim(name)) between 1 and 120),
      lifecycle text not null default 'draft' check (lifecycle in ('draft', 'archived')),
      created_by uuid not null references public.users(id),
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      archived_at timestamptz,
      unique (organization_id, id),
      check (
        (lifecycle = 'archived' and archived_at is not null)
        or (lifecycle = 'draft' and archived_at is null)
      )
    );

    create table public.builder_asset_drafts (
      asset_id uuid primary key,
      organization_id uuid not null,
      schema_version integer not null default 1,
      revision bigint not null default 0,
      document jsonb not null default '{"schema_version":1}'::jsonb,
      updated_by uuid not null references public.users(id),
      updated_at timestamptz not null default now(),
      unique (organization_id, asset_id),
      foreign key (organization_id, asset_id)
        references public.builder_assets(organization_id, id)
        on delete cascade
    );

    create table public.builder_asset_dependencies (
      organization_id uuid not null,
      source_asset_id uuid not null,
      target_asset_id uuid not null,
      dependency_type text not null,
      primary key (organization_id, source_asset_id, target_asset_id, dependency_type)
    );

    create function public.builder_test_create_draft()
    returns trigger
    language plpgsql
    security invoker
    set search_path = ''
    as $$
    begin
      insert into public.builder_asset_drafts (
        asset_id, organization_id, schema_version, revision, document, updated_by
      ) values (
        new.id, new.organization_id, 1, 0, '{"schema_version":1}'::jsonb, new.created_by
      );
      return new;
    end;
    $$;

    create trigger builder_assets_create_initial_draft
    after insert on public.builder_assets
    for each row execute function public.builder_test_create_draft();

    insert into public.organizations (id, name) values
      ('${organizationA}', 'Organization A'),
      ('${organizationB}', 'Organization B');
    insert into public.users (id) values ('${userA}'), ('${userB}');

    insert into public.builder_assets (
      id, organization_id, asset_type, name, lifecycle, created_by, created_at, updated_at, archived_at
    ) values
      ('${activeLandingA}', '${organizationA}', 'landing_page', 'Inicio A', 'draft', '${userA}', '2026-01-01', '2026-01-01', null),
      ('${activeLandingB}', '${organizationB}', 'landing_page', 'Inicio B', 'draft', '${userB}', '2026-01-02', '2026-01-02', null),
      ('${archivedLanding}', '${organizationA}', 'landing_page', 'Landing archivada', 'archived', '${userA}', '2026-01-03', '2026-01-03', '2026-01-04'),
      ('${formAsset}', '${organizationA}', 'form', 'Formulario', 'draft', '${userA}', '2026-01-04', '2026-01-04', null);
  `);

  await db.exec(migration);

  const { rows: backfilledAssets } = await db.query(`
    select asset.id, asset.lifecycle, page.site_id, page.slug, page.is_home, page.position
    from public.builder_assets asset
    left join public.builder_site_pages page on page.page_asset_id = asset.id
    where asset.id in ('${activeLandingA}', '${activeLandingB}', '${archivedLanding}', '${formAsset}')
    order by asset.id
  `);
  const byId = new Map(backfilledAssets.map((row) => [row.id, row]));
  const siteA = byId.get(activeLandingA).site_id;
  const siteB = byId.get(activeLandingB).site_id;
  assert.equal(byId.get(activeLandingA).slug, "/");
  assert.equal(byId.get(activeLandingA).is_home, true);
  assert.equal(byId.get(activeLandingA).position, 1);
  assert.equal(byId.get(activeLandingB).slug, "/");
  assert.equal(byId.get(archivedLanding).site_id, null);
  assert.equal(byId.get(archivedLanding).lifecycle, "archived");
  assert.equal(byId.get(formAsset).site_id, null);

  const backfillStart = migration.indexOf("do $$");
  const backfillEnd = migration.indexOf(
    "create or replace function private.builder_bootstrap_site_for_landing_asset",
    backfillStart,
  );
  const backfill = migration.slice(backfillStart, backfillEnd);
  const { rows: siteCountBefore } = await db.query("select count(*)::integer as count from public.builder_sites");
  await db.exec(backfill);
  const { rows: siteCountAfter } = await db.query("select count(*)::integer as count from public.builder_sites");
  assert.equal(siteCountAfter[0].count, siteCountBefore[0].count);

  await rejectsWith(
    () => db.query(
      "select public.create_builder_site_page($1::uuid, $2::text, $3::text)",
      [siteA, "Sin sesión", "/sin-sesion"],
    ),
    "BUILDER_ACCESS_DENIED",
  );

  await db.exec(`
    select set_config('request.jwt.claim.sub', '${userA}', false);
    select set_config('app.current_org', '${organizationA}', false);
    select set_config('app.can_manage', 'true', false);
  `);

  const { rows: createdA } = await db.query(
    "select public.create_builder_site_page($1::uuid, $2::text, $3::text) as page",
    [siteA, "Servicios", "/servicios"],
  );
  const servicePageA = createdA[0].page;
  assert.equal(servicePageA.slug, "/servicios");
  assert.equal(servicePageA.is_home, false);

  await rejectsWith(
    () => db.query(
      "select public.create_builder_site_page($1::uuid, $2::text, $3::text)",
      [siteA, "Duplicada", "/servicios"],
    ),
    "BUILDER_PAGE_SLUG_CONFLICT",
  );
  await rejectsWith(
    () => db.query(
      "select public.create_builder_site_page($1::uuid, $2::text, $3::text)",
      [siteA, "Inválida", "//servicios"],
    ),
    "BUILDER_PAGE_SLUG_INVALID",
  );

  await db.exec(`select set_config('app.current_org', '${organizationB}', false)`);
  const { rows: createdB } = await db.query(
    "select public.create_builder_site_page($1::uuid, $2::text, $3::text) as page",
    [siteB, "Servicios", "/servicios"],
  );
  assert.equal(createdB[0].page.slug, "/servicios");

  await db.exec(`select set_config('app.current_org', '${organizationA}', false)`);
  await db.exec(`
    begin;
    update public.builder_site_pages
    set is_home = false, slug = '/inicio-a'
    where page_asset_id = '${activeLandingA}';
    update public.builder_site_pages
    set is_home = true, slug = '/'
    where page_asset_id = '${servicePageA.page_asset_id}';
    commit;
  `);
  const { rows: swappedHome } = await db.query(
    "select page_asset_id from public.builder_site_pages where site_id = $1::uuid and is_home",
    [siteA],
  );
  assert.equal(swappedHome[0].page_asset_id, servicePageA.page_asset_id);

  await db.query("select public.set_builder_site_home($1::uuid)", [activeLandingA]);
  await rejectsWith(
    () => db.exec(`
      begin;
      update public.builder_site_pages
      set is_home = false, slug = '/sin-home'
      where page_asset_id = '${activeLandingA}';
      commit;
    `),
    "BUILDER_SITE_HOME_REQUIRED",
  );
  await db.exec("rollback");

  await rejectsWith(
    () => db.query(
      "update public.builder_site_pages set is_home = true, slug = '/' where page_asset_id = $1::uuid",
      [servicePageA.page_asset_id],
    ),
    "duplicate key value",
  );
  await rejectsWith(
    () => db.query(
      "update public.builder_site_pages set slug = '' where page_asset_id = $1::uuid",
      [servicePageA.page_asset_id],
    ),
    "builder_site_pages_slug_check",
  );

  const { rows: duplicated } = await db.query(
    "select public.duplicate_builder_site_page($1::uuid, null, null) as page",
    [servicePageA.page_asset_id],
  );
  assert.equal(duplicated[0].page.slug, "/servicios-copia");
  const duplicatePageId = duplicated[0].page.page_asset_id;
  const { rows: updatedDuplicate } = await db.query(
    "select public.update_builder_site_page($1::uuid, $2::text, $3::text) as page",
    [duplicatePageId, "Contacto", "/contacto"],
  );
  assert.equal(updatedDuplicate[0].page.name, "Contacto");
  assert.equal(updatedDuplicate[0].page.slug, "/contacto");
  await rejectsWith(
    () => db.query(
      "select public.update_builder_site_page($1::uuid, null, $2::text)",
      [duplicatePageId, "//contacto"],
    ),
    "BUILDER_PAGE_SLUG_INVALID",
  );
  await rejectsWith(
    () => db.query(
      "select public.duplicate_builder_site_page($1::uuid, null, $2::text)",
      [servicePageA.page_asset_id, "//servicios"],
    ),
    "BUILDER_PAGE_SLUG_INVALID",
  );

  await rejectsWith(
    () => db.query(
      "select public.create_builder_site_page($1::uuid, $2::text, $3::text)",
      [siteB, "Fuera de organización", "/fuera"],
    ),
    "BUILDER_ACCESS_DENIED",
  );
  await db.exec("select set_config('app.can_manage', 'false', false)");
  await rejectsWith(
    () => db.query(
      "select public.create_builder_site_page($1::uuid, $2::text, $3::text)",
      [siteA, "Sin permiso", "/sin-permiso"],
    ),
    "BUILDER_ACCESS_DENIED",
  );
  await db.exec("select set_config('app.can_manage', 'true', false)");

  const { rows: definerFunctions } = await db.query(`
    select proname, prosecdef, proconfig
    from pg_proc
    where pronamespace = 'public'::regnamespace
      and proname in (
        'create_builder_site_page',
        'update_builder_site_page',
        'duplicate_builder_site_page',
        'set_builder_site_home',
        'delete_builder_site_page'
      )
    order by proname
  `);
  assert.equal(definerFunctions.length, 5);
  for (const fn of definerFunctions) {
    assert.equal(fn.prosecdef, true);
    assert.match(String(fn.proconfig), /search_path=(?:""|)/);
  }

  const { rows: privileges } = await db.query(`
    select
      has_table_privilege('authenticated', 'public.builder_sites', 'select') as site_select,
      has_table_privilege('authenticated', 'public.builder_sites', 'insert') as site_insert,
      has_table_privilege('anon', 'public.builder_sites', 'select') as anon_select,
      has_function_privilege(
        'authenticated',
        'public.create_builder_site_page(uuid,text,text)',
        'execute'
      ) as rpc_execute
  `);
  assert.deepEqual(privileges[0], {
    site_select: true,
    site_insert: false,
    anon_select: false,
    rpc_execute: true,
  });

  await db.exec("set role authenticated");
  const { rows: visibleSites } = await db.query(
    "select count(*)::integer as count, min(organization_id::text) as organization_id from public.builder_sites",
  );
  assert.equal(visibleSites[0].count, 1);
  assert.equal(visibleSites[0].organization_id, organizationA);
  await rejectsWith(
    () => db.query(
      "insert into public.builder_sites (organization_id, created_by) values ($1::uuid, $2::uuid)",
      [organizationA, userA],
    ),
    "permission denied",
  );
  await db.exec("reset role");

  const { rows: draftBeforeDelete } = await db.query(
    "select count(*)::integer as count from public.builder_asset_drafts where asset_id = $1::uuid",
    [servicePageA.page_asset_id],
  );
  assert.equal(draftBeforeDelete[0].count, 1);
  await db.query("select public.delete_builder_site_page($1::uuid)", [servicePageA.page_asset_id]);
  const { rows: archivedPage } = await db.query(
    "select lifecycle, archived_at is not null as archived, (select count(*) from public.builder_asset_drafts where asset_id = $1::uuid)::integer as drafts from public.builder_assets where id = $1::uuid",
    [servicePageA.page_asset_id],
  );
  assert.deepEqual(archivedPage[0], { lifecycle: "archived", archived: true, drafts: 1 });

  const { rows: siteBAssetsBefore } = await db.query(
    "select count(*)::integer as assets, (select count(*) from public.builder_asset_drafts draft join public.builder_assets asset on asset.id = draft.asset_id where asset.organization_id = $1::uuid)::integer as drafts from public.builder_assets where organization_id = $1::uuid",
    [organizationB],
  );
  await db.query("delete from public.builder_sites where id = $1::uuid", [siteB]);
  const { rows: siteBAssetsAfter } = await db.query(
    "select count(*)::integer as assets, (select count(*) from public.builder_asset_drafts draft join public.builder_assets asset on asset.id = draft.asset_id where asset.organization_id = $1::uuid)::integer as drafts from public.builder_assets where organization_id = $1::uuid",
    [organizationB],
  );
  assert.deepEqual(siteBAssetsAfter[0], siteBAssetsBefore[0]);

  const { rows: protectedBeforeAssetDelete } = await db.query(
    "select count(*)::integer as assets, (select count(*) from public.builder_asset_drafts where asset_id in ($1::uuid, $2::uuid))::integer as drafts from public.builder_assets where id in ($1::uuid, $2::uuid)",
    [activeLandingA, duplicatePageId],
  );
  assert.deepEqual(protectedBeforeAssetDelete[0], { assets: 2, drafts: 2 });
  await db.query("delete from public.builder_assets where id = $1::uuid", [duplicatePageId]);
  const { rows: protectedAfterAssetDelete } = await db.query(
    "select count(*)::integer as assets, (select count(*) from public.builder_asset_drafts where asset_id = $1::uuid)::integer as drafts, (select count(*) from public.builder_site_pages where page_asset_id = $2::uuid)::integer as removed_memberships from public.builder_assets where id = $1::uuid",
    [activeLandingA, duplicatePageId],
  );
  assert.deepEqual(protectedAfterAssetDelete[0], { assets: 1, drafts: 1, removed_memberships: 0 });

  await db.close();
});

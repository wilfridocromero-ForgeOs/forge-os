-- Builder Phase 2: canonical, version-ready assets that nodes may reference.

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

create table public.builder_asset_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  asset_id uuid not null,
  version_number integer not null check (version_number > 0),
  state text not null default 'draft' check (state = 'draft'),
  schema_version integer not null default 1 check (schema_version = 1),
  document jsonb not null default '{"schema_version":1}'::jsonb,
  created_by uuid not null references public.users(id),
  created_at timestamptz not null default now(),
  unique (asset_id, version_number),
  unique (organization_id, asset_id, id),
  foreign key (organization_id, asset_id)
    references public.builder_assets(organization_id, id)
    on delete cascade,
  check (
    jsonb_typeof(document) = 'object'
    and jsonb_typeof(document -> 'schema_version') = 'number'
    and (document ->> 'schema_version')::integer = schema_version
  )
);

alter table public.growth_system_nodes
  add column asset_id uuid;

alter table public.growth_system_nodes
  add constraint growth_system_nodes_builder_asset_fkey
  foreign key (organization_id, asset_id)
  references public.builder_assets(organization_id, id)
  on delete restrict;

create index builder_assets_org_type_lifecycle_idx
  on public.builder_assets(organization_id, asset_type, lifecycle, updated_at desc);

create index builder_assets_created_by_idx
  on public.builder_assets(created_by);

create index builder_asset_versions_asset_idx
  on public.builder_asset_versions(organization_id, asset_id, version_number desc);

create index builder_asset_versions_created_by_idx
  on public.builder_asset_versions(created_by);

create index growth_system_nodes_asset_idx
  on public.growth_system_nodes(organization_id, asset_id)
  where asset_id is not null;

create or replace function public.builder_assets_touch_and_protect()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.organization_id is distinct from old.organization_id
     or new.asset_type is distinct from old.asset_type
     or new.created_by is distinct from old.created_by then
    raise exception using errcode = '23514', message = 'BUILDER_ASSET_IDENTITY_IMMUTABLE';
  end if;

  new.updated_at = now();
  return new;
end;
$$;

create trigger builder_assets_touch_and_protect
before update on public.builder_assets
for each row execute function public.builder_assets_touch_and_protect();

create or replace function public.builder_create_initial_asset_version()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  insert into public.builder_asset_versions (
    organization_id,
    asset_id,
    version_number,
    schema_version,
    document,
    created_by
  ) values (
    new.organization_id,
    new.id,
    1,
    1,
    '{"schema_version":1}'::jsonb,
    new.created_by
  );
  return new;
end;
$$;

create trigger builder_assets_create_initial_version
after insert on public.builder_assets
for each row execute function public.builder_create_initial_asset_version();

create or replace function public.builder_validate_node_asset_binding()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  target_asset public.builder_assets;
begin
  if new.asset_id is null then
    return new;
  end if;

  select asset.*
  into target_asset
  from public.builder_assets as asset
  where asset.id = new.asset_id
    and asset.organization_id = new.organization_id;

  if target_asset.id is null
     or target_asset.lifecycle <> 'draft'
     or target_asset.asset_type <> new.node_type
     or new.node_type not in ('landing_page', 'form') then
    raise exception using errcode = '23514', message = 'BUILDER_ASSET_BINDING_INVALID';
  end if;

  return new;
end;
$$;

create trigger growth_system_nodes_validate_asset_binding
before insert or update of asset_id, node_type, organization_id
on public.growth_system_nodes
for each row execute function public.builder_validate_node_asset_binding();

alter table public.builder_assets enable row level security;
alter table public.builder_asset_versions enable row level security;

create policy builder_assets_select
on public.builder_assets
for select
to authenticated
using (
  organization_id = (select public.current_user_organization_id())
  and (
    (select public.can_manage_organization(organization_id))
    or exists (
      select 1
      from public.member_module_access as access
      where access.user_id = (select auth.uid())
        and access.module_key = 'builder'
        and access.enabled
    )
  )
);

create policy builder_assets_insert
on public.builder_assets
for insert
to authenticated
with check (
  organization_id = (select public.current_user_organization_id())
  and (select public.can_manage_organization(organization_id))
  and created_by = (select auth.uid())
);

create policy builder_assets_update
on public.builder_assets
for update
to authenticated
using ((select public.can_manage_organization(organization_id)))
with check (
  organization_id = (select public.current_user_organization_id())
  and (select public.can_manage_organization(organization_id))
);

create policy builder_asset_versions_select
on public.builder_asset_versions
for select
to authenticated
using (
  exists (
    select 1
    from public.builder_assets as asset
    where asset.id = builder_asset_versions.asset_id
      and asset.organization_id = builder_asset_versions.organization_id
  )
);

create policy builder_asset_versions_insert
on public.builder_asset_versions
for insert
to authenticated
with check (
  organization_id = (select public.current_user_organization_id())
  and created_by = (select auth.uid())
  and (select public.can_manage_organization(organization_id))
  and exists (
    select 1
    from public.builder_assets as asset
    where asset.id = builder_asset_versions.asset_id
      and asset.organization_id = builder_asset_versions.organization_id
      and asset.lifecycle = 'draft'
  )
);

grant select, insert, update on public.builder_assets to authenticated;
grant select, insert on public.builder_asset_versions to authenticated;
revoke all on public.builder_assets, public.builder_asset_versions from public, anon;

revoke execute on function public.builder_assets_touch_and_protect() from public, anon, authenticated;
revoke execute on function public.builder_create_initial_asset_version() from public, anon, authenticated;
revoke execute on function public.builder_validate_node_asset_binding() from public, anon, authenticated;

create or replace function public.create_builder_asset(
  asset_name text,
  requested_asset_type text,
  target_node_id uuid default null
)
returns public.builder_assets
language plpgsql
security invoker
set search_path = ''
as $$
declare
  org_id uuid := public.current_user_organization_id();
  caller_id uuid := (select auth.uid());
  target_node public.growth_system_nodes;
  created_asset public.builder_assets;
begin
  if caller_id is null
     or org_id is null
     or not public.can_manage_organization(org_id) then
    raise exception using errcode = '42501', message = 'BUILDER_ACCESS_DENIED';
  end if;

  if requested_asset_type not in ('landing_page', 'form')
     or char_length(btrim(asset_name)) not between 1 and 120 then
    raise exception using errcode = '22023', message = 'BUILDER_ASSET_INVALID';
  end if;

  if target_node_id is not null then
    select node.*
    into target_node
    from public.growth_system_nodes as node
    join public.growth_system_revisions as revision
      on revision.id = node.revision_id
     and revision.organization_id = node.organization_id
     and revision.system_id = node.system_id
    where node.id = target_node_id
      and node.organization_id = org_id
      and revision.state = 'draft'
    for update of node;

    if target_node.id is null or target_node.node_type <> requested_asset_type then
      raise exception using errcode = '23514', message = 'BUILDER_ASSET_BINDING_INVALID';
    end if;
  end if;

  insert into public.builder_assets (
    organization_id,
    asset_type,
    name,
    created_by
  ) values (
    org_id,
    requested_asset_type,
    btrim(asset_name),
    caller_id
  )
  returning * into created_asset;

  if target_node_id is not null then
    update public.growth_system_nodes
    set asset_id = created_asset.id,
        updated_at = now()
    where id = target_node.id;
  end if;

  return created_asset;
end;
$$;

revoke all on function public.create_builder_asset(text, text, uuid) from public, anon;
grant execute on function public.create_builder_asset(text, text, uuid) to authenticated;

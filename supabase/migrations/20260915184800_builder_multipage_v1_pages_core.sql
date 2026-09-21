-- ORVESEN Builder Multipage V1 / Phase 1.
-- Sites group independent landing_page assets without changing LandingDocument V1.

create table public.builder_sites (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  created_by uuid not null references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id)
);

create table public.builder_site_pages (
  site_id uuid not null,
  organization_id uuid not null,
  page_asset_id uuid primary key,
  slug text not null,
  is_home boolean not null default false,
  position integer not null check (position > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, site_id, page_asset_id),
  constraint builder_site_pages_site_fkey
    foreign key (organization_id, site_id)
    references public.builder_sites(organization_id, id)
    on delete cascade,
  constraint builder_site_pages_asset_fkey
    foreign key (organization_id, page_asset_id)
    references public.builder_assets(organization_id, id)
    on delete cascade,
  constraint builder_site_pages_slug_check check (
    slug = '/'
    or (
      char_length(slug) between 2 and 121
      and slug ~ '^/[a-z0-9]+(-[a-z0-9]+)*$'
    )
  ),
  constraint builder_site_pages_home_slug_check check (
    (is_home and slug = '/')
    or (not is_home and slug <> '/')
  )
);

create unique index builder_site_pages_site_slug_key
  on public.builder_site_pages(site_id, slug);

create unique index builder_site_pages_one_home_key
  on public.builder_site_pages(site_id)
  where is_home;

create unique index builder_site_pages_site_position_key
  on public.builder_site_pages(site_id, position);

create index builder_sites_organization_idx
  on public.builder_sites(organization_id, updated_at desc);

create index builder_site_pages_organization_site_idx
  on public.builder_site_pages(organization_id, site_id, position);

create or replace function private.builder_normalize_site_page_slug(candidate text)
returns text
language sql
immutable
security invoker
set search_path = ''
as $$
  select case
    when btrim(coalesce(candidate, '')) ~ '^//' then null
    when normalized.value = '' then null
    else '/' || normalized.value
  end
  from (
    select trim(both '-' from regexp_replace(
      translate(
        lower(btrim(coalesce(candidate, ''))),
        'áàäâãåéèëêíìïîóòöôõúùüûñç',
        'aaaaaaeeeeiiiiooooouuuunc'
      ),
      '[^a-z0-9]+',
      '-',
      'g'
    )) as value
  ) normalized;
$$;

create or replace function private.builder_next_site_page_slug(
  target_site_id uuid,
  requested_slug text,
  excluded_page_asset_id uuid default null
)
returns text
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  base_slug text := private.builder_normalize_site_page_slug(requested_slug);
  available_slug text;
  suffix_number integer := 1;
begin
  if base_slug is null or base_slug = '/' then
    base_slug := '/pagina';
  end if;
  base_slug := rtrim(left(base_slug, 121), '-');

  available_slug := base_slug;
  while exists (
    select 1
    from public.builder_site_pages page
    where page.site_id = target_site_id
      and page.slug = available_slug
      and (excluded_page_asset_id is null or page.page_asset_id <> excluded_page_asset_id)
  ) loop
    suffix_number := suffix_number + 1;
    available_slug := rtrim(
      left(base_slug, 120 - char_length(suffix_number::text)),
      '-'
    ) || '-' || suffix_number::text;
  end loop;

  return available_slug;
end;
$$;

create or replace function private.builder_site_page_payload(target_page_asset_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'site_id', page.site_id,
    'page_asset_id', page.page_asset_id,
    'name', asset.name,
    'slug', page.slug,
    'is_home', page.is_home,
    'position', page.position,
    'created_at', page.created_at,
    'updated_at', page.updated_at,
    'asset_updated_at', asset.updated_at,
    'draft_revision', draft.revision
  )
  from public.builder_site_pages page
  join public.builder_assets asset
    on asset.id = page.page_asset_id
   and asset.organization_id = page.organization_id
  join public.builder_asset_drafts draft
    on draft.asset_id = page.page_asset_id
   and draft.organization_id = page.organization_id
  where page.page_asset_id = target_page_asset_id;
$$;

create or replace function private.builder_site_page_membership_validate()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  target_asset public.builder_assets;
begin
  if tg_op = 'UPDATE'
     and (
       new.organization_id is distinct from old.organization_id
       or new.site_id is distinct from old.site_id
       or new.page_asset_id is distinct from old.page_asset_id
       or new.created_at is distinct from old.created_at
     ) then
    raise exception using errcode = '23514', message = 'BUILDER_SITE_PAGE_IDENTITY_IMMUTABLE';
  end if;

  select asset.*
  into target_asset
  from public.builder_assets asset
  where asset.id = new.page_asset_id
    and asset.organization_id = new.organization_id;

  if target_asset.id is null or target_asset.asset_type <> 'landing_page' then
    raise exception using errcode = '23514', message = 'BUILDER_SITE_PAGE_ASSET_INVALID';
  end if;

  new.updated_at := now();
  return new;
end;
$$;

create trigger builder_site_pages_validate_membership
before insert or update on public.builder_site_pages
for each row execute function private.builder_site_page_membership_validate();

create or replace function private.builder_site_pages_require_home()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  affected_site_id uuid;
begin
  affected_site_id := case when tg_op = 'DELETE' then old.site_id else new.site_id end;

  if exists (
    select 1 from public.builder_sites site where site.id = affected_site_id
  ) and not exists (
    select 1
    from public.builder_site_pages page
    where page.site_id = affected_site_id and page.is_home
  ) then
    raise exception using errcode = '23514', message = 'BUILDER_SITE_HOME_REQUIRED';
  end if;

  return null;
end;
$$;

create constraint trigger builder_site_pages_require_home
after insert or update or delete on public.builder_site_pages
deferrable initially deferred
for each row execute function private.builder_site_pages_require_home();

alter table public.builder_sites enable row level security;
alter table public.builder_site_pages enable row level security;

create policy builder_sites_select
on public.builder_sites
for select
to authenticated
using (
  organization_id = (select public.current_user_organization_id())
  and (
    (select public.can_manage_organization(organization_id))
    or exists (
      select 1
      from public.member_module_access access
      where access.user_id = (select auth.uid())
        and access.module_key = 'builder'
        and access.enabled
    )
  )
);

create policy builder_site_pages_select
on public.builder_site_pages
for select
to authenticated
using (
  organization_id = (select public.current_user_organization_id())
  and (
    (select public.can_manage_organization(organization_id))
    or exists (
      select 1
      from public.member_module_access access
      where access.user_id = (select auth.uid())
        and access.module_key = 'builder'
        and access.enabled
    )
  )
);

revoke all on public.builder_sites from public, anon, authenticated;
revoke all on public.builder_site_pages from public, anon, authenticated;
grant select on public.builder_sites to authenticated;
grant select on public.builder_site_pages to authenticated;

do $$
declare
  landing_asset record;
  created_site_id uuid;
begin
  for landing_asset in
    select asset.id, asset.organization_id, asset.created_by, asset.created_at, asset.updated_at
    from public.builder_assets asset
    where asset.asset_type = 'landing_page'
      and asset.lifecycle = 'draft'
      and asset.archived_at is null
      and not exists (
        select 1
        from public.builder_site_pages page
        where page.page_asset_id = asset.id
      )
    order by asset.created_at, asset.id
  loop
    created_site_id := gen_random_uuid();
    insert into public.builder_sites (
      id, organization_id, created_by, created_at, updated_at
    ) values (
      created_site_id,
      landing_asset.organization_id,
      landing_asset.created_by,
      landing_asset.created_at,
      landing_asset.updated_at
    );

    insert into public.builder_site_pages (
      site_id, organization_id, page_asset_id, slug, is_home, position,
      created_at, updated_at
    ) values (
      created_site_id,
      landing_asset.organization_id,
      landing_asset.id,
      '/',
      true,
      1,
      landing_asset.created_at,
      landing_asset.updated_at
    );
  end loop;
end;
$$;

create or replace function private.builder_bootstrap_site_for_landing_asset()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  created_site_id uuid;
begin
  if new.asset_type <> 'landing_page' then
    return new;
  end if;

  created_site_id := gen_random_uuid();
  insert into public.builder_sites (
    id, organization_id, created_by, created_at, updated_at
  ) values (
    created_site_id,
    new.organization_id,
    new.created_by,
    new.created_at,
    new.updated_at
  );

  insert into public.builder_site_pages (
    site_id, organization_id, page_asset_id, slug, is_home, position,
    created_at, updated_at
  ) values (
    created_site_id,
    new.organization_id,
    new.id,
    '/',
    true,
    1,
    new.created_at,
    new.updated_at
  );

  return new;
end;
$$;

create trigger builder_assets_bootstrap_site
after insert on public.builder_assets
for each row execute function private.builder_bootstrap_site_for_landing_asset();

create or replace function public.create_builder_site_page(
  target_site_id uuid,
  page_name text,
  requested_slug text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  caller_organization_id uuid := public.current_user_organization_id();
  target_site public.builder_sites;
  normalized_name text := btrim(coalesce(page_name, ''));
  normalized_slug text;
  next_position integer;
  created_asset public.builder_assets;
  bootstrap_site_id uuid;
begin
  if caller_id is null or caller_organization_id is null then
    raise exception using errcode = '42501', message = 'BUILDER_ACCESS_DENIED';
  end if;

  select site.*
  into target_site
  from public.builder_sites site
  where site.id = target_site_id
    and site.organization_id = caller_organization_id
  for update;

  if target_site.id is null
     or not public.can_manage_organization(target_site.organization_id) then
    raise exception using errcode = '42501', message = 'BUILDER_ACCESS_DENIED';
  end if;

  if char_length(normalized_name) not between 1 and 120 then
    raise exception using errcode = '22023', message = 'BUILDER_PAGE_NAME_INVALID';
  end if;

  normalized_slug := private.builder_normalize_site_page_slug(
    coalesce(nullif(btrim(requested_slug), ''), normalized_name)
  );
  if normalized_slug is null
     or normalized_slug = '/'
     or char_length(normalized_slug) > 121 then
    raise exception using errcode = '22023', message = 'BUILDER_PAGE_SLUG_INVALID';
  end if;
  if exists (
    select 1 from public.builder_site_pages page
    where page.site_id = target_site.id and page.slug = normalized_slug
  ) then
    raise exception using errcode = '23505', message = 'BUILDER_PAGE_SLUG_CONFLICT';
  end if;

  select coalesce(max(page.position), 0) + 1
  into next_position
  from public.builder_site_pages page
  where page.site_id = target_site.id;

  insert into public.builder_assets (
    organization_id, asset_type, name, created_by
  ) values (
    target_site.organization_id, 'landing_page', normalized_name, caller_id
  ) returning * into created_asset;

  select page.site_id
  into bootstrap_site_id
  from public.builder_site_pages page
  where page.page_asset_id = created_asset.id;

  delete from public.builder_site_pages page
  where page.page_asset_id = created_asset.id;
  delete from public.builder_sites site
  where site.id = bootstrap_site_id;

  insert into public.builder_site_pages (
    site_id, organization_id, page_asset_id, slug, is_home, position
  ) values (
    target_site.id,
    target_site.organization_id,
    created_asset.id,
    normalized_slug,
    false,
    next_position
  );

  update public.builder_sites site
  set updated_at = now()
  where site.id = target_site.id;

  return private.builder_site_page_payload(created_asset.id);
exception
  when unique_violation then
    raise exception using errcode = '23505', message = 'BUILDER_PAGE_SLUG_CONFLICT';
end;
$$;

create or replace function public.update_builder_site_page(
  target_page_asset_id uuid,
  page_name text default null,
  requested_slug text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  caller_organization_id uuid := public.current_user_organization_id();
  target_site public.builder_sites;
  target_page public.builder_site_pages;
  located_site_id uuid;
  normalized_name text;
  normalized_slug text;
begin
  if caller_id is null or caller_organization_id is null then
    raise exception using errcode = '42501', message = 'BUILDER_ACCESS_DENIED';
  end if;

  select page.site_id
  into located_site_id
  from public.builder_site_pages page
  where page.page_asset_id = target_page_asset_id
    and page.organization_id = caller_organization_id;

  select site.*
  into target_site
  from public.builder_sites site
  where site.id = located_site_id
    and site.organization_id = caller_organization_id
  for update;

  if target_site.id is null
     or not public.can_manage_organization(target_site.organization_id) then
    raise exception using errcode = '42501', message = 'BUILDER_ACCESS_DENIED';
  end if;

  select page.*
  into target_page
  from public.builder_site_pages page
  where page.page_asset_id = target_page_asset_id
    and page.site_id = target_site.id;
  if target_page.page_asset_id is null then
    raise exception using errcode = 'P0002', message = 'BUILDER_PAGE_NOT_FOUND';
  end if;

  if page_name is not null then
    normalized_name := btrim(page_name);
    if char_length(normalized_name) not between 1 and 120 then
      raise exception using errcode = '22023', message = 'BUILDER_PAGE_NAME_INVALID';
    end if;
    update public.builder_assets asset
    set name = normalized_name
    where asset.id = target_page.page_asset_id
      and asset.organization_id = target_page.organization_id;
  end if;

  if requested_slug is not null then
    if target_page.is_home then
      if btrim(requested_slug) <> '/' then
        raise exception using errcode = '23514', message = 'BUILDER_HOME_SLUG_IMMUTABLE';
      end if;
    else
      normalized_slug := private.builder_normalize_site_page_slug(requested_slug);
      if normalized_slug is null
         or normalized_slug = '/'
         or char_length(normalized_slug) > 121 then
        raise exception using errcode = '22023', message = 'BUILDER_PAGE_SLUG_INVALID';
      end if;
      if exists (
        select 1 from public.builder_site_pages page
        where page.site_id = target_site.id
          and page.slug = normalized_slug
          and page.page_asset_id <> target_page.page_asset_id
      ) then
        raise exception using errcode = '23505', message = 'BUILDER_PAGE_SLUG_CONFLICT';
      end if;
      update public.builder_site_pages page
      set slug = normalized_slug
      where page.page_asset_id = target_page.page_asset_id;
    end if;
  end if;

  update public.builder_sites site
  set updated_at = now()
  where site.id = target_site.id;

  return private.builder_site_page_payload(target_page.page_asset_id);
exception
  when unique_violation then
    raise exception using errcode = '23505', message = 'BUILDER_PAGE_SLUG_CONFLICT';
end;
$$;

create or replace function public.duplicate_builder_site_page(
  source_page_asset_id uuid,
  page_name text default null,
  requested_slug text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  caller_organization_id uuid := public.current_user_organization_id();
  target_site public.builder_sites;
  source_page public.builder_site_pages;
  source_asset public.builder_assets;
  source_draft public.builder_asset_drafts;
  created_asset public.builder_assets;
  normalized_name text;
  normalized_slug text;
  next_position integer;
  bootstrap_site_id uuid;
begin
  if caller_id is null or caller_organization_id is null then
    raise exception using errcode = '42501', message = 'BUILDER_ACCESS_DENIED';
  end if;

  select page.*
  into source_page
  from public.builder_site_pages page
  where page.page_asset_id = source_page_asset_id
    and page.organization_id = caller_organization_id;

  select site.*
  into target_site
  from public.builder_sites site
  where site.id = source_page.site_id
    and site.organization_id = caller_organization_id
  for update;

  if target_site.id is null
     or not public.can_manage_organization(target_site.organization_id) then
    raise exception using errcode = '42501', message = 'BUILDER_ACCESS_DENIED';
  end if;

  select asset.*
  into source_asset
  from public.builder_assets asset
  where asset.id = source_page.page_asset_id
    and asset.organization_id = target_site.organization_id
    and asset.asset_type = 'landing_page'
    and asset.lifecycle = 'draft';

  select draft.*
  into source_draft
  from public.builder_asset_drafts draft
  where draft.asset_id = source_page.page_asset_id
    and draft.organization_id = target_site.organization_id;

  if source_asset.id is null or source_draft.asset_id is null then
    raise exception using errcode = 'P0002', message = 'BUILDER_PAGE_NOT_FOUND';
  end if;

  normalized_name := coalesce(
    nullif(btrim(page_name), ''),
    left(source_asset.name, 114) || ' copia'
  );
  if char_length(normalized_name) not between 1 and 120 then
    raise exception using errcode = '22023', message = 'BUILDER_PAGE_NAME_INVALID';
  end if;

  if requested_slug is not null and btrim(requested_slug) ~ '^//' then
    raise exception using errcode = '22023', message = 'BUILDER_PAGE_SLUG_INVALID';
  end if;

  normalized_slug := private.builder_next_site_page_slug(
    target_site.id,
    coalesce(
      nullif(btrim(requested_slug), ''),
      case
        when source_page.is_home then source_asset.name || '-copia'
        else source_page.slug || '-copia'
      end
    )
  );

  select coalesce(max(page.position), 0) + 1
  into next_position
  from public.builder_site_pages page
  where page.site_id = target_site.id;

  insert into public.builder_assets (
    organization_id, asset_type, name, created_by
  ) values (
    target_site.organization_id, 'landing_page', normalized_name, caller_id
  ) returning * into created_asset;

  select page.site_id
  into bootstrap_site_id
  from public.builder_site_pages page
  where page.page_asset_id = created_asset.id;
  delete from public.builder_site_pages page
  where page.page_asset_id = created_asset.id;
  delete from public.builder_sites site
  where site.id = bootstrap_site_id;

  update public.builder_asset_drafts draft
  set document = source_draft.document,
      schema_version = source_draft.schema_version,
      revision = 1,
      updated_by = caller_id,
      updated_at = now()
  where draft.asset_id = created_asset.id
    and draft.organization_id = target_site.organization_id;

  insert into public.builder_asset_dependencies (
    organization_id, source_asset_id, target_asset_id, dependency_type
  )
  select dependency.organization_id, created_asset.id,
    dependency.target_asset_id, dependency.dependency_type
  from public.builder_asset_dependencies dependency
  where dependency.organization_id = target_site.organization_id
    and dependency.source_asset_id = source_page.page_asset_id;

  insert into public.builder_site_pages (
    site_id, organization_id, page_asset_id, slug, is_home, position
  ) values (
    target_site.id,
    target_site.organization_id,
    created_asset.id,
    normalized_slug,
    false,
    next_position
  );

  update public.builder_sites site
  set updated_at = now()
  where site.id = target_site.id;

  return private.builder_site_page_payload(created_asset.id);
end;
$$;

create or replace function public.set_builder_site_home(target_page_asset_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  caller_organization_id uuid := public.current_user_organization_id();
  target_site public.builder_sites;
  target_page public.builder_site_pages;
  previous_home public.builder_site_pages;
  previous_home_asset public.builder_assets;
  previous_home_slug text;
begin
  if caller_id is null or caller_organization_id is null then
    raise exception using errcode = '42501', message = 'BUILDER_ACCESS_DENIED';
  end if;

  select page.*
  into target_page
  from public.builder_site_pages page
  where page.page_asset_id = target_page_asset_id
    and page.organization_id = caller_organization_id;

  select site.*
  into target_site
  from public.builder_sites site
  where site.id = target_page.site_id
    and site.organization_id = caller_organization_id
  for update;

  if target_site.id is null
     or not public.can_manage_organization(target_site.organization_id) then
    raise exception using errcode = '42501', message = 'BUILDER_ACCESS_DENIED';
  end if;

  select page.*
  into target_page
  from public.builder_site_pages page
  where page.page_asset_id = target_page_asset_id
    and page.site_id = target_site.id;
  if target_page.page_asset_id is null then
    raise exception using errcode = 'P0002', message = 'BUILDER_PAGE_NOT_FOUND';
  end if;
  if target_page.is_home then
    return private.builder_site_page_payload(target_page.page_asset_id);
  end if;

  select page.*
  into previous_home
  from public.builder_site_pages page
  where page.site_id = target_site.id and page.is_home
  for update of page;

  if previous_home.page_asset_id is null then
    raise exception using errcode = '23514', message = 'BUILDER_SITE_HOME_REQUIRED';
  end if;

  select asset.*
  into previous_home_asset
  from public.builder_assets asset
  where asset.id = previous_home.page_asset_id
    and asset.organization_id = previous_home.organization_id;

  previous_home_slug := private.builder_next_site_page_slug(
    target_site.id,
    previous_home_asset.name,
    previous_home.page_asset_id
  );

  update public.builder_site_pages page
  set is_home = false, slug = previous_home_slug
  where page.page_asset_id = previous_home.page_asset_id;

  update public.builder_site_pages page
  set is_home = true, slug = '/'
  where page.page_asset_id = target_page.page_asset_id;

  update public.builder_sites site
  set updated_at = now()
  where site.id = target_site.id;

  return private.builder_site_page_payload(target_page.page_asset_id);
end;
$$;

create or replace function public.delete_builder_site_page(target_page_asset_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  caller_organization_id uuid := public.current_user_organization_id();
  target_site public.builder_sites;
  target_page public.builder_site_pages;
  page_count integer;
begin
  if caller_id is null or caller_organization_id is null then
    raise exception using errcode = '42501', message = 'BUILDER_ACCESS_DENIED';
  end if;

  select page.*
  into target_page
  from public.builder_site_pages page
  where page.page_asset_id = target_page_asset_id
    and page.organization_id = caller_organization_id;

  select site.*
  into target_site
  from public.builder_sites site
  where site.id = target_page.site_id
    and site.organization_id = caller_organization_id
  for update;

  if target_site.id is null
     or not public.can_manage_organization(target_site.organization_id) then
    raise exception using errcode = '42501', message = 'BUILDER_ACCESS_DENIED';
  end if;

  select page.*
  into target_page
  from public.builder_site_pages page
  where page.page_asset_id = target_page_asset_id
    and page.site_id = target_site.id;
  if target_page.page_asset_id is null then
    raise exception using errcode = 'P0002', message = 'BUILDER_PAGE_NOT_FOUND';
  end if;

  select count(*) into page_count
  from public.builder_site_pages page
  where page.site_id = target_site.id;

  if page_count <= 1 then
    raise exception using errcode = '23514', message = 'BUILDER_SITE_LAST_PAGE_REQUIRED';
  end if;
  if target_page.is_home then
    raise exception using errcode = '23514', message = 'BUILDER_SITE_HOME_DELETE_FORBIDDEN';
  end if;

  delete from public.builder_site_pages page
  where page.page_asset_id = target_page.page_asset_id;

  delete from public.builder_asset_dependencies dependency
  where dependency.organization_id = target_page.organization_id
    and dependency.source_asset_id = target_page.page_asset_id;

  update public.builder_assets asset
  set lifecycle = 'archived', archived_at = now()
  where asset.id = target_page.page_asset_id
    and asset.organization_id = target_page.organization_id;

  update public.builder_sites site
  set updated_at = now()
  where site.id = target_site.id;

  return jsonb_build_object(
    'site_id', target_site.id,
    'deleted_page_asset_id', target_page.page_asset_id
  );
end;
$$;

alter function private.builder_normalize_site_page_slug(text) owner to postgres;
alter function private.builder_next_site_page_slug(uuid, text, uuid) owner to postgres;
alter function private.builder_site_page_payload(uuid) owner to postgres;
alter function private.builder_site_page_membership_validate() owner to postgres;
alter function private.builder_site_pages_require_home() owner to postgres;
alter function private.builder_bootstrap_site_for_landing_asset() owner to postgres;
alter function public.create_builder_site_page(uuid, text, text) owner to postgres;
alter function public.update_builder_site_page(uuid, text, text) owner to postgres;
alter function public.duplicate_builder_site_page(uuid, text, text) owner to postgres;
alter function public.set_builder_site_home(uuid) owner to postgres;
alter function public.delete_builder_site_page(uuid) owner to postgres;

revoke all on function private.builder_normalize_site_page_slug(text) from public, anon, authenticated, service_role;
revoke all on function private.builder_next_site_page_slug(uuid, text, uuid) from public, anon, authenticated, service_role;
revoke all on function private.builder_site_page_payload(uuid) from public, anon, authenticated, service_role;
revoke all on function private.builder_site_page_membership_validate() from public, anon, authenticated, service_role;
revoke all on function private.builder_site_pages_require_home() from public, anon, authenticated, service_role;
revoke all on function private.builder_bootstrap_site_for_landing_asset() from public, anon, authenticated, service_role;
revoke all on function public.create_builder_site_page(uuid, text, text) from public, anon, authenticated, service_role;
revoke all on function public.update_builder_site_page(uuid, text, text) from public, anon, authenticated, service_role;
revoke all on function public.duplicate_builder_site_page(uuid, text, text) from public, anon, authenticated, service_role;
revoke all on function public.set_builder_site_home(uuid) from public, anon, authenticated, service_role;
revoke all on function public.delete_builder_site_page(uuid) from public, anon, authenticated, service_role;

grant execute on function public.create_builder_site_page(uuid, text, text) to authenticated;
grant execute on function public.update_builder_site_page(uuid, text, text) to authenticated;
grant execute on function public.duplicate_builder_site_page(uuid, text, text) to authenticated;
grant execute on function public.set_builder_site_home(uuid) to authenticated;
grant execute on function public.delete_builder_site_page(uuid) to authenticated;

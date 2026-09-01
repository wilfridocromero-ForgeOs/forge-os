-- Builder Phase 3B.1: validated LandingDocumentV1 drafts with optimistic CAS.

create or replace function private.builder_default_landing_document_v1()
returns jsonb
language sql
immutable
security invoker
set search_path = ''
as $$
  select '{"schema_version":1,"document_type":"landing_page","locale":"es","settings":{"seo":{"title":"","description":""},"design_system":{"colors":{},"typography":{},"buttons":{},"radii":{},"spacing":{},"content_widths":{}}},"sections":[]}'::jsonb;
$$;

create or replace function private.builder_landing_document_v1_is_valid(candidate jsonb)
returns boolean
language plpgsql
immutable
security invoker
set search_path = ''
as $$
declare
  section_value jsonb;
  region_value jsonb;
  block_value jsonb;
  action_value jsonb;
  responsive_value jsonb;
  breakpoint_value jsonb;
  token_category text;
  token_entry record;
  style_entry record;
  identifier text;
  identifiers text[] := array[]::text[];
  block_count integer := 0;
  region_span_total integer;
begin
  if candidate is null or jsonb_typeof(candidate) is distinct from 'object' or pg_column_size(candidate) > 524288 then return false; end if;
  if candidate->>'schema_version' is distinct from '1' or candidate->>'document_type' is distinct from 'landing_page' then return false; end if;
  if jsonb_typeof(candidate->'locale') is distinct from 'string' or coalesce(char_length(candidate->>'locale'), 0) not between 1 and 16 then return false; end if;
  if exists (select 1 from jsonb_object_keys(candidate) key where key <> all(array['schema_version','document_type','locale','settings','sections'])) then return false; end if;
  if jsonb_typeof(candidate->'settings') is distinct from 'object'
     or exists (select 1 from jsonb_object_keys(candidate->'settings') key where key <> all(array['seo','design_system']))
     or jsonb_typeof(candidate#>'{settings,seo}') is distinct from 'object'
     or exists (select 1 from jsonb_object_keys(candidate#>'{settings,seo}') key where key <> all(array['title','description']))
     or jsonb_typeof(candidate#>'{settings,design_system}') is distinct from 'object' then return false; end if;
  if exists (select 1 from jsonb_object_keys(candidate#>'{settings,design_system}') key where key <> all(array['colors','typography','buttons','radii','spacing','content_widths'])) then return false; end if;
  if exists (select 1 from unnest(array['colors','typography','buttons','radii','spacing','content_widths']) key where jsonb_typeof(candidate#>array['settings','design_system',key]) is distinct from 'object') then return false; end if;
  foreach token_category in array array['colors','typography','buttons','radii','spacing','content_widths'] loop
    for token_entry in select key, value from jsonb_each(candidate#>array['settings','design_system',token_category]) loop
      if token_entry.key !~ '^[a-z][a-z0-9_-]{0,47}$' or jsonb_typeof(token_entry.value) is distinct from 'string' or char_length(token_entry.value #>> '{}') > 120 then return false; end if;
    end loop;
  end loop;
  if jsonb_typeof(candidate->'sections') is distinct from 'array' or jsonb_array_length(candidate->'sections') > 50 then return false; end if;

  for section_value in select value from jsonb_array_elements(candidate->'sections') loop
    if jsonb_typeof(section_value) is distinct from 'object'
       or exists (select 1 from jsonb_object_keys(section_value) key where key <> all(array['id','layout','style','responsive','regions']))
       or coalesce(section_value->>'id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       or coalesce(section_value->>'layout','') not in ('stack','columns')
       or jsonb_typeof(section_value->'regions') is distinct from 'array'
       or jsonb_array_length(section_value->'regions') not between 1 and 12 then return false; end if;
    identifier := section_value->>'id'; if identifier = any(identifiers) then return false; end if; identifiers := array_append(identifiers, identifier);
    if section_value->>'layout' = 'stack' and jsonb_array_length(section_value->'regions') <> 1 then return false; end if;
    if section_value ? 'style' and (jsonb_typeof(section_value->'style') is distinct from 'object' or exists (select 1 from jsonb_object_keys(section_value->'style') key where key <> all(array['background','color','spacing','radius','content_width','align']))) then return false; end if;
    if section_value ? 'style' then
      for style_entry in select key, value from jsonb_each(section_value->'style') loop
        if jsonb_typeof(style_entry.value) is distinct from 'string' or (style_entry.key = 'align' and style_entry.value #>> '{}' not in ('start','center','end')) or (style_entry.key <> 'align' and style_entry.value #>> '{}' !~ '^[a-z][a-z0-9_-]{0,47}$') then return false; end if;
      end loop;
    end if;
    responsive_value := section_value->'responsive';
    if responsive_value is not null then
      if jsonb_typeof(responsive_value) is distinct from 'object' or exists (select 1 from jsonb_object_keys(responsive_value) key where key <> all(array['tablet','mobile'])) then return false; end if;
      for breakpoint_value in select value from jsonb_each(responsive_value) loop
        if jsonb_typeof(breakpoint_value) is distinct from 'object' or exists (select 1 from jsonb_object_keys(breakpoint_value) key where key <> all(array['layout','span','align','spacing','hidden'])) then return false; end if;
        if breakpoint_value ? 'layout' and coalesce(breakpoint_value->>'layout','') not in ('stack','columns') then return false; end if;
        if breakpoint_value ? 'span' and (jsonb_typeof(breakpoint_value->'span') is distinct from 'number' or (breakpoint_value->>'span')::numeric <> trunc((breakpoint_value->>'span')::numeric) or (breakpoint_value->>'span')::integer not between 1 and 12) then return false; end if;
        if breakpoint_value ? 'align' and coalesce(breakpoint_value->>'align','') not in ('start','center','end') then return false; end if;
        if breakpoint_value ? 'spacing' and coalesce(breakpoint_value->>'spacing','') !~ '^[a-z][a-z0-9_-]{0,47}$' then return false; end if;
        if breakpoint_value ? 'hidden' and jsonb_typeof(breakpoint_value->'hidden') is distinct from 'boolean' then return false; end if;
      end loop;
    end if;
    region_span_total := 0;
    for region_value in select value from jsonb_array_elements(section_value->'regions') loop
      if jsonb_typeof(region_value) is distinct from 'object'
         or exists (select 1 from jsonb_object_keys(region_value) key where key <> all(array['id','span','blocks']))
         or coalesce(region_value->>'id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
         or jsonb_typeof(region_value->'span') is distinct from 'number'
         or (region_value->>'span')::numeric <> trunc((region_value->>'span')::numeric)
         or (region_value->>'span')::integer not between 1 and 12
         or jsonb_typeof(region_value->'blocks') is distinct from 'array' then return false; end if;
      identifier := region_value->>'id'; if identifier = any(identifiers) then return false; end if; identifiers := array_append(identifiers, identifier);
      region_span_total := region_span_total + (region_value->>'span')::integer;
      for block_value in select value from jsonb_array_elements(region_value->'blocks') loop
        block_count := block_count + 1; if block_count > 500 then return false; end if;
        if jsonb_typeof(block_value) is distinct from 'object'
           or exists (select 1 from jsonb_object_keys(block_value) key where key <> all(array['id','type','schema_version','content','style','responsive']))
           or coalesce(block_value->>'id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
           or coalesce(block_value->>'type','') not in ('heading','text','image','action_group','form_reference')
           or block_value->>'schema_version' is distinct from '1'
           or jsonb_typeof(block_value->'content') is distinct from 'object' then return false; end if;
        identifier := block_value->>'id'; if identifier = any(identifiers) then return false; end if; identifiers := array_append(identifiers, identifier);
        if block_value ? 'style' and (jsonb_typeof(block_value->'style') is distinct from 'object' or exists (select 1 from jsonb_object_keys(block_value->'style') key where key <> all(array['background','color','spacing','radius','content_width','align']))) then return false; end if;
        if block_value ? 'style' then
          for style_entry in select key, value from jsonb_each(block_value->'style') loop
            if jsonb_typeof(style_entry.value) is distinct from 'string' or (style_entry.key = 'align' and style_entry.value #>> '{}' not in ('start','center','end')) or (style_entry.key <> 'align' and style_entry.value #>> '{}' !~ '^[a-z][a-z0-9_-]{0,47}$') then return false; end if;
          end loop;
        end if;
        responsive_value := block_value->'responsive';
        if responsive_value is not null and (jsonb_typeof(responsive_value) is distinct from 'object' or exists (select 1 from jsonb_object_keys(responsive_value) key where key <> all(array['tablet','mobile']))) then return false; end if;
        if responsive_value is not null then
          for breakpoint_value in select value from jsonb_each(responsive_value) loop
            if jsonb_typeof(breakpoint_value) is distinct from 'object' or exists (select 1 from jsonb_object_keys(breakpoint_value) key where key <> all(array['layout','span','align','spacing','hidden'])) then return false; end if;
            if breakpoint_value ? 'layout' and coalesce(breakpoint_value->>'layout','') not in ('stack','columns') then return false; end if;
            if breakpoint_value ? 'span' and (jsonb_typeof(breakpoint_value->'span') is distinct from 'number' or (breakpoint_value->>'span')::numeric <> trunc((breakpoint_value->>'span')::numeric) or (breakpoint_value->>'span')::integer not between 1 and 12) then return false; end if;
            if breakpoint_value ? 'align' and coalesce(breakpoint_value->>'align','') not in ('start','center','end') then return false; end if;
            if breakpoint_value ? 'spacing' and coalesce(breakpoint_value->>'spacing','') !~ '^[a-z][a-z0-9_-]{0,47}$' then return false; end if;
            if breakpoint_value ? 'hidden' and jsonb_typeof(breakpoint_value->'hidden') is distinct from 'boolean' then return false; end if;
          end loop;
        end if;

        if block_value->>'type' = 'heading' then
          if exists (select 1 from jsonb_object_keys(block_value->'content') key where key <> all(array['text','level']))
             or jsonb_typeof(block_value#>'{content,text}') is distinct from 'string' or coalesce(char_length(btrim(block_value#>>'{content,text}')),0) not between 1 and 240
             or jsonb_typeof(block_value#>'{content,level}') is distinct from 'number' or (block_value#>>'{content,level}')::integer not between 1 and 6 then return false; end if;
        elsif block_value->>'type' = 'text' then
          if exists (select 1 from jsonb_object_keys(block_value->'content') key where key <> all(array['text']))
             or jsonb_typeof(block_value#>'{content,text}') is distinct from 'string' or coalesce(char_length(block_value#>>'{content,text}'),8001) > 8000 then return false; end if;
        elsif block_value->>'type' = 'image' then
          if exists (select 1 from jsonb_object_keys(block_value->'content') key where key <> all(array['source','alt','decorative']))
             or jsonb_typeof(block_value#>'{content,source}') is distinct from 'object'
             or coalesce(block_value#>>'{content,source,kind}','') not in ('placeholder','external')
             or jsonb_typeof(block_value#>'{content,alt}') is distinct from 'string'
             or jsonb_typeof(block_value#>'{content,decorative}') is distinct from 'boolean' then return false; end if;
          if block_value#>>'{content,source,kind}' = 'external' and coalesce(block_value#>>'{content,source,url}','') !~ '^https://[^[:space:]]+$' then return false; end if;
          if (block_value#>>'{content,decorative}')::boolean = false and btrim(block_value#>>'{content,alt}') = '' then return false; end if;
        elsif block_value->>'type' = 'action_group' then
          if exists (select 1 from jsonb_object_keys(block_value->'content') key where key <> all(array['actions']))
             or jsonb_typeof(block_value#>'{content,actions}') is distinct from 'array'
             or jsonb_array_length(block_value#>'{content,actions}') not between 1 and 2 then return false; end if;
          for action_value in select value from jsonb_array_elements(block_value#>'{content,actions}') loop
            if jsonb_typeof(action_value) is distinct from 'object'
               or exists (select 1 from jsonb_object_keys(action_value) key where key <> all(array['label','href','variant']))
               or char_length(btrim(coalesce(action_value->>'label',''))) not between 1 and 80
               or coalesce(action_value->>'variant','') not in ('primary','secondary')
               or not (coalesce(action_value->>'href','') ~ '^#[^[:space:]]*$' or coalesce(action_value->>'href','') ~ '^https://[^[:space:]]+$') then return false; end if;
          end loop;
        else
          if exists (select 1 from jsonb_object_keys(block_value->'content') key where key <> all(array['asset_id','label']))
             or char_length(btrim(coalesce(block_value#>>'{content,label}',''))) not between 1 and 120
             or (block_value#>'{content,asset_id}' <> 'null'::jsonb and coalesce(block_value#>>'{content,asset_id}','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$') then return false; end if;
        end if;
      end loop;
    end loop;
    if section_value->>'layout' = 'columns' and region_span_total <> 12 then return false; end if;
  end loop;
  return true;
exception when others then return false;
end;
$$;

revoke all on function private.builder_default_landing_document_v1() from public, anon, authenticated;
revoke all on function private.builder_landing_document_v1_is_valid(jsonb) from public, anon, authenticated;

create table public.builder_asset_drafts (
  asset_id uuid primary key,
  organization_id uuid not null,
  schema_version integer not null default 1 check (schema_version = 1),
  document jsonb not null,
  revision bigint not null default 1 check (revision > 0),
  updated_by uuid not null references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, asset_id),
  foreign key (organization_id, asset_id) references public.builder_assets(organization_id, id) on delete cascade,
  check (private.builder_landing_document_v1_is_valid(document)),
  check ((document->>'schema_version')::integer = schema_version)
);

create table public.builder_asset_dependencies (
  organization_id uuid not null,
  source_asset_id uuid not null,
  target_asset_id uuid not null,
  dependency_type text not null check (dependency_type = 'form_reference'),
  created_at timestamptz not null default now(),
  primary key (source_asset_id, target_asset_id, dependency_type),
  foreign key (organization_id, source_asset_id) references public.builder_assets(organization_id, id) on delete cascade,
  foreign key (organization_id, target_asset_id) references public.builder_assets(organization_id, id) on delete restrict,
  check (source_asset_id <> target_asset_id)
);

alter table public.builder_asset_drafts enable row level security;
alter table public.builder_asset_dependencies enable row level security;

create policy builder_asset_drafts_select on public.builder_asset_drafts
for select to authenticated
using (
  organization_id = (select public.current_user_organization_id())
  and exists (
    select 1 from public.builder_assets asset
    where asset.id = builder_asset_drafts.asset_id
      and asset.organization_id = builder_asset_drafts.organization_id
      and (
        (select public.can_manage_organization(asset.organization_id))
        or exists (
          select 1 from public.member_module_access access
          where access.user_id = (select auth.uid()) and access.module_key = 'builder' and access.enabled
        )
      )
  )
);

revoke all on public.builder_asset_drafts from public, anon, authenticated;
grant select on public.builder_asset_drafts to authenticated;
revoke all on public.builder_asset_dependencies from public, anon, authenticated;

create or replace function public.builder_assets_touch_and_protect()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.organization_id is distinct from old.organization_id
     or new.asset_type is distinct from old.asset_type
     or new.created_by is distinct from old.created_by then
    raise exception using errcode = '23514', message = 'BUILDER_ASSET_IDENTITY_IMMUTABLE';
  end if;
  if new.lifecycle = 'archived' and old.lifecycle <> 'archived' and exists (
    select 1 from public.builder_asset_dependencies dependency
    where dependency.organization_id = old.organization_id and dependency.target_asset_id = old.id
  ) then
    raise exception using errcode = '23514', message = 'BUILDER_ASSET_HAS_ACTIVE_DEPENDENCIES';
  end if;
  new.updated_at = now();
  return new;
end;
$$;

alter function public.builder_assets_touch_and_protect() owner to postgres;
revoke all on function public.builder_assets_touch_and_protect() from public, anon, authenticated;

create or replace function public.builder_create_initial_asset_version()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  initial_document jsonb := case when new.asset_type = 'landing_page' then private.builder_default_landing_document_v1() else '{"schema_version":1}'::jsonb end;
begin
  insert into public.builder_asset_versions (organization_id, asset_id, version_number, schema_version, document, created_by)
  values (new.organization_id, new.id, 1, 1, initial_document, new.created_by);
  if new.asset_type = 'landing_page' then
    insert into public.builder_asset_drafts (asset_id, organization_id, schema_version, document, revision, updated_by)
    values (new.id, new.organization_id, 1, initial_document, 1, new.created_by)
    on conflict (asset_id) do nothing;
  end if;
  return new;
end;
$$;

alter function public.builder_create_initial_asset_version() owner to postgres;
revoke all on function public.builder_create_initial_asset_version() from public, anon, authenticated;

insert into public.builder_asset_drafts (asset_id, organization_id, schema_version, document, revision, updated_by)
select asset.id, asset.organization_id, 1,
       case when private.builder_landing_document_v1_is_valid(version.document) then version.document else private.builder_default_landing_document_v1() end,
       1, asset.created_by
from public.builder_assets asset
left join lateral (
  select candidate.document from public.builder_asset_versions candidate
  where candidate.asset_id = asset.id and candidate.organization_id = asset.organization_id
  order by candidate.version_number desc limit 1
) version on true
where asset.asset_type = 'landing_page'
on conflict (asset_id) do nothing;

create or replace function public.save_builder_asset_draft(
  target_asset_id uuid,
  expected_revision bigint,
  requested_schema_version integer,
  requested_document jsonb
)
returns public.builder_asset_drafts
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  caller_organization_id uuid := public.current_user_organization_id();
  target_asset public.builder_assets;
  saved_draft public.builder_asset_drafts;
  referenced_form_id uuid;
begin
  if caller_id is null or caller_organization_id is null then raise exception using errcode = '42501', message = 'BUILDER_ACCESS_DENIED'; end if;
  select asset.* into target_asset from public.builder_assets asset
  where asset.id = target_asset_id and asset.organization_id = caller_organization_id for update;
  if target_asset.id is null or not public.can_manage_organization(target_asset.organization_id) then raise exception using errcode = '42501', message = 'BUILDER_ACCESS_DENIED'; end if;
  if target_asset.asset_type <> 'landing_page' or target_asset.lifecycle <> 'draft' then raise exception using errcode = '23514', message = 'BUILDER_DRAFT_ASSET_INVALID'; end if;
  if requested_schema_version <> 1 or not private.builder_landing_document_v1_is_valid(requested_document) then raise exception using errcode = '22023', message = 'BUILDER_DOCUMENT_INVALID'; end if;

  for referenced_form_id in
    select distinct (block#>>'{content,asset_id}')::uuid
    from jsonb_array_elements(requested_document->'sections') section_value,
         jsonb_array_elements(section_value->'regions') region_value,
         jsonb_array_elements(region_value->'blocks') block
    where block->>'type' = 'form_reference' and block#>'{content,asset_id}' <> 'null'::jsonb
  loop
    if not exists (
      select 1 from public.builder_assets form_asset
      where form_asset.id = referenced_form_id and form_asset.organization_id = target_asset.organization_id
        and form_asset.asset_type = 'form' and form_asset.lifecycle = 'draft'
    ) then raise exception using errcode = '23514', message = 'BUILDER_FORM_REFERENCE_INVALID'; end if;
  end loop;

  update public.builder_asset_drafts draft
  set document = requested_document, schema_version = requested_schema_version,
      revision = draft.revision + 1, updated_by = caller_id, updated_at = now()
  where draft.asset_id = target_asset.id and draft.organization_id = target_asset.organization_id
    and draft.revision = expected_revision
  returning * into saved_draft;
  if saved_draft.asset_id is null then
    if exists (select 1 from public.builder_asset_drafts draft where draft.asset_id = target_asset.id) then
      raise exception using errcode = '40001', message = 'BUILDER_DRAFT_CONFLICT';
    end if;
    raise exception using errcode = 'P0002', message = 'BUILDER_DRAFT_NOT_FOUND';
  end if;
  delete from public.builder_asset_dependencies dependency
  where dependency.organization_id = target_asset.organization_id and dependency.source_asset_id = target_asset.id;
  insert into public.builder_asset_dependencies (organization_id, source_asset_id, target_asset_id, dependency_type)
  select distinct target_asset.organization_id, target_asset.id, (block#>>'{content,asset_id}')::uuid, 'form_reference'
  from jsonb_array_elements(requested_document->'sections') section_value,
       jsonb_array_elements(section_value->'regions') region_value,
       jsonb_array_elements(region_value->'blocks') block
  where block->>'type' = 'form_reference' and block#>'{content,asset_id}' <> 'null'::jsonb;
  return saved_draft;
end;
$$;

alter function public.save_builder_asset_draft(uuid, bigint, integer, jsonb) owner to postgres;
revoke all on function public.save_builder_asset_draft(uuid, bigint, integer, jsonb) from public, anon;
grant execute on function public.save_builder_asset_draft(uuid, bigint, integer, jsonb) to authenticated;

drop policy if exists builder_asset_versions_insert on public.builder_asset_versions;
revoke insert on public.builder_asset_versions from authenticated;
revoke all on public.builder_asset_versions from public, anon;

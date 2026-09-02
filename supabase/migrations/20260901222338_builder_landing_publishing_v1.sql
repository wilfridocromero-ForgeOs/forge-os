-- Builder Phase 4B.2: immutable Landing publications and a minimal public read boundary.

alter table public.builder_assets
  add column public_slug text,
  add column published_version_id uuid,
  add column published_at timestamptz;

alter table public.builder_assets
  add constraint builder_assets_public_slug_check check (
    public_slug is null or (
      char_length(public_slug) between 3 and 80
      and public_slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'
      and public_slug <> all(array[
        'admin','api','app','assets','builder','calendario','configuracion',
        'construir','discovery','login','orvesen-ia','p','proyectos','register',
        'site','sites','www'
      ])
    )
  ),
  add constraint builder_assets_public_slug_key unique (public_slug),
  add constraint builder_assets_publication_state_check check (
    (published_version_id is null and published_at is null)
    or (published_version_id is not null and published_at is not null and public_slug is not null)
  );

alter table public.builder_asset_versions
  drop constraint builder_asset_versions_state_check,
  add constraint builder_asset_versions_state_check check (state in ('draft', 'published'));

alter table public.builder_assets
  add constraint builder_assets_published_version_fkey
  foreign key (organization_id, id, published_version_id)
  references public.builder_asset_versions(organization_id, asset_id, id)
  on delete restrict;

create or replace function private.builder_normalize_public_slug(candidate text)
returns text
language sql
immutable
security invoker
set search_path = ''
as $$
  select trim(both '-' from regexp_replace(
    translate(lower(btrim(candidate)),
      'áàäâãåéèëêíìïîóòöôõúùüûñç',
      'aaaaaaeeeeiiiiooooouuuunc'),
    '[^a-z0-9]+', '-', 'g'
  ));
$$;

create or replace function private.builder_public_link_v1_is_valid(candidate text)
returns boolean
language sql
immutable
security invoker
set search_path = ''
as $$
  select case
    when candidate is null or candidate ~ '[[:cntrl:]]' then false
    when candidate ~ '^#[^[:space:]]*$' then true
    when candidate ~ '^https://[^[:space:]]+$' then true
    when candidate ~ '^mailto:[^[:space:]]+$' then true
    when candidate ~ '^tel:[+0-9(). -]+$' then true
    else false
  end;
$$;

create or replace function private.builder_landing_publication_metadata_v1_is_valid(candidate jsonb)
returns boolean
language plpgsql
immutable
security invoker
set search_path = ''
as $$
begin
  if candidate is null or jsonb_typeof(candidate#>'{settings,seo}') is distinct from 'object' then
    return false;
  end if;
  return not exists (
      select 1 from jsonb_object_keys(candidate#>'{settings,seo}') key
      where key <> all(array['title','description'])
    )
    and jsonb_typeof(candidate#>'{settings,seo,title}') = 'string'
    and char_length(candidate#>>'{settings,seo,title}') <= 120
    and jsonb_typeof(candidate#>'{settings,seo,description}') = 'string'
    and char_length(candidate#>>'{settings,seo,description}') <= 300;
exception when others then return false;
end;
$$;

create or replace function private.builder_landing_professional_block_v1_is_valid(block jsonb)
returns boolean
language plpgsql
immutable
security invoker
set search_path = ''
as $$
declare
  content jsonb := block->'content';
  item jsonb;
  url text;
begin
  if block->>'schema_version' is distinct from '1' or jsonb_typeof(content) is distinct from 'object' then return false; end if;
  case block->>'type'
    when 'action_group' then
      if exists(select 1 from jsonb_object_keys(content) key where key <> 'actions') or jsonb_typeof(content->'actions') is distinct from 'array' or jsonb_array_length(content->'actions') not between 1 and 2 then return false; end if;
      for item in select value from jsonb_array_elements(content->'actions') loop
        if jsonb_typeof(item) <> 'object' or exists(select 1 from jsonb_object_keys(item) key where key <> all(array['label','href','variant','size','width','radius','shadow','border','background','text_color','border_color'])) or char_length(btrim(coalesce(item->>'label',''))) not between 1 and 80 or not private.builder_public_link_v1_is_valid(item->>'href') then return false; end if;
        if item ? 'variant' and item->>'variant' not in ('primary','secondary','outline','ghost') then return false; end if;
        if item ? 'size' and item->>'size' not in ('sm','md','lg') then return false; end if;
        if item ? 'width' and item->>'width' not in ('auto','full') then return false; end if;
        if item ? 'radius' and item->>'radius' not in ('none','sm','md','lg','pill') then return false; end if;
        if item ? 'shadow' and item->>'shadow' not in ('none','subtle','soft','medium') then return false; end if;
        if item ? 'border' and item->>'border' not in ('none','subtle','standard') then return false; end if;
        if exists(select 1 from unnest(array['background','text_color','border_color']) key where item ? key and item->>key !~ '^[a-z][a-z0-9_-]{0,47}$') then return false; end if;
      end loop;
      return true;
    when 'image' then
      if exists(select 1 from jsonb_object_keys(content) key where key <> all(array['source','alt','decorative','fit','aspect_ratio','radius','focal_position'])) or jsonb_typeof(content->'source') is distinct from 'object' or content#>>'{source,kind}' not in ('placeholder','external') or jsonb_typeof(content->'decorative') is distinct from 'boolean' then return false; end if;
      return (content#>>'{source,kind}' = 'placeholder' or coalesce(content#>>'{source,url}','') ~ '^https://[^[:space:]]+$') and ((content->>'decorative')::boolean or char_length(btrim(coalesce(content->>'alt',''))) between 1 and 300) and coalesce(content->>'fit','cover') in ('cover','contain') and coalesce(content->>'aspect_ratio','auto') in ('auto','square','4:3','16:9','portrait') and coalesce(content->>'radius','md') in ('none','sm','md','lg') and coalesce(content->>'focal_position','center') in ('center','top','bottom','left','right');
    when 'logo' then
      if exists(select 1 from jsonb_object_keys(content) key where key <> all(array['url','alt','width','href'])) then return false; end if;
      return coalesce(content->>'url','') ~ '^https://[^[:space:]]+$' and char_length(btrim(coalesce(content->>'alt',''))) between 1 and 200 and content->>'width' in ('sm','md','lg') and (coalesce(content->>'href','') = '' or private.builder_public_link_v1_is_valid(content->>'href'));
    when 'feature_item' then
      return not exists(select 1 from jsonb_object_keys(content) key where key <> all(array['icon','title','description','href'])) and content->>'icon' in ('sparkles','shield','chart','check','users','zap') and char_length(btrim(coalesce(content->>'title',''))) between 1 and 120 and char_length(coalesce(content->>'description','')) <= 800 and (coalesce(content->>'href','') = '' or private.builder_public_link_v1_is_valid(content->>'href'));
    when 'stat' then
      return not exists(select 1 from jsonb_object_keys(content) key where key <> all(array['value','label','supporting_text'])) and char_length(btrim(coalesce(content->>'value',''))) between 1 and 40 and char_length(btrim(coalesce(content->>'label',''))) between 1 and 120 and char_length(coalesce(content->>'supporting_text','')) <= 300;
    when 'testimonial' then
      return not exists(select 1 from jsonb_object_keys(content) key where key <> all(array['quote','person_name','role_company','avatar_url'])) and char_length(btrim(coalesce(content->>'quote',''))) between 1 and 1600 and char_length(btrim(coalesce(content->>'person_name',''))) between 1 and 120 and char_length(coalesce(content->>'role_company','')) <= 200 and (coalesce(content->>'avatar_url','') = '' or content->>'avatar_url' ~ '^https://[^[:space:]]+$');
    when 'video' then
      url := coalesce(content->>'url','');
      return not exists(select 1 from jsonb_object_keys(content) key where key <> all(array['url','title','poster_url'])) and char_length(btrim(coalesce(content->>'title',''))) between 1 and 200 and (url ~ '^https://(www\.|m\.)?youtube\.com/watch\?[^[:space:]]*v=[A-Za-z0-9_-]{6,20}(&[^[:space:]]*)?$' or url ~ '^https://youtu\.be/[A-Za-z0-9_-]{6,20}([?][^[:space:]]*)?$' or url ~ '^https://(www\.)?vimeo\.com/[0-9]{5,12}/?$') and (coalesce(content->>'poster_url','') = '' or content->>'poster_url' ~ '^https://[^[:space:]]+$');
    when 'pricing_card' then
      if exists(select 1 from jsonb_object_keys(content) key where key <> all(array['plan_name','price','cadence','description','features','cta_label','cta_url','emphasis'])) or jsonb_typeof(content->'features') is distinct from 'array' or jsonb_array_length(content->'features') > 12 or jsonb_typeof(content->'emphasis') is distinct from 'boolean' then return false; end if;
      for item in select value from jsonb_array_elements(content->'features') loop if jsonb_typeof(item) <> 'string' or char_length(btrim(item#>>'{}')) not between 1 and 160 then return false; end if; end loop;
      return char_length(btrim(coalesce(content->>'plan_name',''))) between 1 and 100 and char_length(btrim(coalesce(content->>'price',''))) between 1 and 50 and char_length(coalesce(content->>'cadence','')) <= 40 and char_length(coalesce(content->>'description','')) <= 600 and char_length(btrim(coalesce(content->>'cta_label',''))) between 1 and 80 and private.builder_public_link_v1_is_valid(content->>'cta_url');
    when 'faq_item' then
      return not exists(select 1 from jsonb_object_keys(content) key where key <> all(array['question','answer','default_open'])) and char_length(btrim(coalesce(content->>'question',''))) between 1 and 300 and char_length(btrim(coalesce(content->>'answer',''))) between 1 and 2000 and jsonb_typeof(content->'default_open') = 'boolean';
    when 'divider' then
      return not exists(select 1 from jsonb_object_keys(content) key where key <> all(array['style','width','spacing'])) and content->>'style' in ('solid','dashed','subtle') and content->>'width' in ('narrow','standard','full') and content->>'spacing' in ('xs','sm','md','lg','xl');
    when 'spacer' then
      return not exists(select 1 from jsonb_object_keys(content) key where key <> 'size') and content->>'size' in ('xs','sm','md','lg','xl');
    when 'social_links' then
      if exists(select 1 from jsonb_object_keys(content) key where key <> 'links') or jsonb_typeof(content->'links') is distinct from 'array' or jsonb_array_length(content->'links') > 10 then return false; end if;
      for item in select value from jsonb_array_elements(content->'links') loop
        if jsonb_typeof(item) <> 'object' or exists(select 1 from jsonb_object_keys(item) key where key <> all(array['provider','url','label'])) or item->>'provider' not in ('instagram','facebook','linkedin','youtube','x','tiktok','website','email') or not private.builder_public_link_v1_is_valid(item->>'url') or char_length(btrim(coalesce(item->>'label',''))) not between 1 and 80 then return false; end if;
      end loop;
      return true;
    else return false;
  end case;
exception when others then return false;
end;
$$;

alter table public.builder_asset_drafts
  add constraint builder_asset_drafts_publication_metadata_check
  check (private.builder_landing_publication_metadata_v1_is_valid(document));

create or replace function public.builder_asset_versions_are_immutable()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception using errcode = '55000', message = 'BUILDER_ASSET_VERSION_IMMUTABLE';
end;
$$;

create trigger builder_asset_versions_are_immutable
before update or delete on public.builder_asset_versions
for each row execute function public.builder_asset_versions_are_immutable();

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
  if old.public_slug is not null and new.public_slug is distinct from old.public_slug then
    raise exception using errcode = '23514', message = 'BUILDER_PUBLIC_SLUG_IMMUTABLE';
  end if;
  if new.lifecycle = 'archived' and old.lifecycle <> 'archived' then
    if old.asset_type = 'landing_page' and old.published_version_id is not null then
      raise exception using errcode = '23514', message = 'BUILDER_PUBLISHED_ASSET_CANNOT_ARCHIVE';
    end if;
    if exists (
      select 1 from public.builder_asset_dependencies dependency
      where dependency.organization_id = old.organization_id and dependency.target_asset_id = old.id
    ) then
      raise exception using errcode = '23514', message = 'BUILDER_ASSET_HAS_ACTIVE_DEPENDENCIES';
    end if;
  end if;
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.publish_builder_landing(
  target_asset_id uuid,
  expected_revision bigint,
  requested_public_slug text default null
)
returns table (
  public_slug text,
  published_version_id uuid,
  published_at timestamptz,
  version_number integer,
  draft_revision bigint
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  caller_organization_id uuid := public.current_user_organization_id();
  target_asset public.builder_assets;
  target_draft public.builder_asset_drafts;
  created_version public.builder_asset_versions;
  normalized_slug text;
  next_version_number integer;
  referenced_form_id uuid;
begin
  if caller_id is null or caller_organization_id is null then
    raise exception using errcode = '42501', message = 'BUILDER_ACCESS_DENIED';
  end if;

  select asset.* into target_asset
  from public.builder_assets asset
  where asset.id = target_asset_id and asset.organization_id = caller_organization_id
  for update;

  if target_asset.id is null or not public.can_manage_organization(target_asset.organization_id) then
    raise exception using errcode = '42501', message = 'BUILDER_ACCESS_DENIED';
  end if;
  if target_asset.asset_type <> 'landing_page' or target_asset.lifecycle = 'archived' then
    raise exception using errcode = '23514', message = 'BUILDER_PUBLISH_ASSET_INVALID';
  end if;

  select draft.* into target_draft
  from public.builder_asset_drafts draft
  where draft.asset_id = target_asset.id and draft.organization_id = target_asset.organization_id
  for update;

  if target_draft.asset_id is null then
    raise exception using errcode = 'P0002', message = 'BUILDER_DRAFT_NOT_FOUND';
  end if;
  if target_draft.revision <> expected_revision then
    raise exception using errcode = '40001', message = 'BUILDER_PUBLISH_CONFLICT';
  end if;
  if target_draft.schema_version <> 1
     or not private.builder_landing_document_v1_is_valid(target_draft.document)
     or not private.builder_landing_publication_metadata_v1_is_valid(target_draft.document) then
    raise exception using errcode = '22023', message = 'BUILDER_DOCUMENT_INVALID';
  end if;

  for referenced_form_id in
    select distinct (block#>>'{content,asset_id}')::uuid
    from jsonb_array_elements(target_draft.document->'sections') section_value,
         jsonb_array_elements(section_value->'regions') region_value,
         jsonb_array_elements(region_value->'blocks') block
    where block->>'type' = 'form_reference' and block#>'{content,asset_id}' <> 'null'::jsonb
  loop
    if not exists (
      select 1 from public.builder_assets form_asset
      where form_asset.id = referenced_form_id
        and form_asset.organization_id = target_asset.organization_id
        and form_asset.asset_type = 'form'
        and form_asset.lifecycle = 'draft'
    ) then
      raise exception using errcode = '23514', message = 'BUILDER_FORM_REFERENCE_INVALID';
    end if;
  end loop;

  if target_asset.public_slug is null then
    if requested_public_slug is null then
      raise exception using errcode = '22023', message = 'BUILDER_PUBLIC_SLUG_REQUIRED';
    end if;
    normalized_slug := private.builder_normalize_public_slug(requested_public_slug);
    if normalized_slug is null
       or char_length(normalized_slug) not between 3 and 80
       or normalized_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$'
       or normalized_slug = any(array[
         'admin','api','app','assets','builder','calendario','configuracion',
         'construir','discovery','login','orvesen-ia','p','proyectos','register',
         'site','sites','www'
       ]) then
      raise exception using errcode = '22023', message = 'BUILDER_PUBLIC_SLUG_INVALID';
    end if;
    if exists (select 1 from public.builder_assets asset where asset.public_slug = normalized_slug and asset.id <> target_asset.id) then
      raise exception using errcode = '23505', message = 'BUILDER_PUBLIC_SLUG_TAKEN';
    end if;
  else
    normalized_slug := target_asset.public_slug;
    if requested_public_slug is not null
       and private.builder_normalize_public_slug(requested_public_slug) is distinct from target_asset.public_slug then
      raise exception using errcode = '23514', message = 'BUILDER_PUBLIC_SLUG_IMMUTABLE';
    end if;
  end if;

  select coalesce(max(version.version_number), 0) + 1 into next_version_number
  from public.builder_asset_versions version
  where version.asset_id = target_asset.id and version.organization_id = target_asset.organization_id;

  insert into public.builder_asset_versions (
    organization_id, asset_id, version_number, state, schema_version, document, created_by
  ) values (
    target_asset.organization_id, target_asset.id, next_version_number, 'published',
    target_draft.schema_version, target_draft.document, caller_id
  ) returning * into created_version;

  update public.builder_assets asset
  set public_slug = normalized_slug,
      published_version_id = created_version.id,
      published_at = now()
  where asset.id = target_asset.id and asset.organization_id = target_asset.organization_id
  returning asset.* into target_asset;

  return query select target_asset.public_slug, target_asset.published_version_id,
    target_asset.published_at, created_version.version_number, target_draft.revision;
exception
  when unique_violation then
    raise exception using errcode = '23505', message = 'BUILDER_PUBLIC_SLUG_TAKEN';
end;
$$;

create or replace function public.unpublish_builder_landing(target_asset_id uuid)
returns table (public_slug text, published_version_id uuid, published_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  caller_organization_id uuid := public.current_user_organization_id();
  target_asset public.builder_assets;
begin
  if caller_id is null or caller_organization_id is null then
    raise exception using errcode = '42501', message = 'BUILDER_ACCESS_DENIED';
  end if;
  select asset.* into target_asset
  from public.builder_assets asset
  where asset.id = target_asset_id and asset.organization_id = caller_organization_id
  for update;
  if target_asset.id is null or not public.can_manage_organization(target_asset.organization_id) then
    raise exception using errcode = '42501', message = 'BUILDER_ACCESS_DENIED';
  end if;
  if target_asset.asset_type <> 'landing_page' then
    raise exception using errcode = '23514', message = 'BUILDER_PUBLISH_ASSET_INVALID';
  end if;
  if target_asset.published_version_id is not null then
    update public.builder_assets asset
    set published_version_id = null, published_at = null
    where asset.id = target_asset.id and asset.organization_id = target_asset.organization_id
    returning asset.* into target_asset;
  end if;
  return query select target_asset.public_slug, target_asset.published_version_id, target_asset.published_at;
end;
$$;

create or replace function public.get_published_builder_landing(requested_public_slug text)
returns table (public_slug text, document jsonb, published_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select asset.public_slug, version.document, asset.published_at
  from public.builder_assets asset
  join public.builder_asset_versions version
    on version.id = asset.published_version_id
   and version.asset_id = asset.id
   and version.organization_id = asset.organization_id
   and version.state = 'published'
  where requested_public_slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'
    and asset.public_slug = requested_public_slug
    and asset.asset_type = 'landing_page'
    and asset.lifecycle = 'draft'
    and asset.published_version_id is not null
    and private.builder_landing_document_v1_is_valid(version.document)
    and private.builder_landing_publication_metadata_v1_is_valid(version.document)
  limit 1;
$$;

alter function private.builder_normalize_public_slug(text) owner to postgres;
alter function private.builder_public_link_v1_is_valid(text) owner to postgres;
alter function private.builder_landing_publication_metadata_v1_is_valid(jsonb) owner to postgres;
alter function private.builder_landing_professional_block_v1_is_valid(jsonb) owner to postgres;
alter function public.builder_asset_versions_are_immutable() owner to postgres;
alter function public.builder_assets_touch_and_protect() owner to postgres;
alter function public.publish_builder_landing(uuid, bigint, text) owner to postgres;
alter function public.unpublish_builder_landing(uuid) owner to postgres;
alter function public.get_published_builder_landing(text) owner to postgres;

revoke all on function private.builder_normalize_public_slug(text) from public, anon, authenticated, service_role;
revoke all on function private.builder_public_link_v1_is_valid(text) from public, anon, authenticated, service_role;
revoke all on function private.builder_landing_publication_metadata_v1_is_valid(jsonb) from public, anon, authenticated, service_role;
revoke all on function private.builder_landing_professional_block_v1_is_valid(jsonb) from public, anon, authenticated, service_role;
revoke all on function public.builder_asset_versions_are_immutable() from public, anon, authenticated, service_role;
revoke all on function public.builder_assets_touch_and_protect() from public, anon, authenticated, service_role;
revoke all on function public.publish_builder_landing(uuid, bigint, text) from public, anon, authenticated, service_role;
revoke all on function public.unpublish_builder_landing(uuid) from public, anon, authenticated, service_role;
revoke all on function public.get_published_builder_landing(text) from public, anon, authenticated, service_role;

grant execute on function public.publish_builder_landing(uuid, bigint, text) to authenticated;
grant execute on function public.unpublish_builder_landing(uuid) to authenticated;
grant execute on function public.get_published_builder_landing(text) to anon, authenticated;

revoke insert, update on public.builder_assets from authenticated;
grant insert (organization_id, asset_type, name, created_by) on public.builder_assets to authenticated;
grant update (name, lifecycle, archived_at) on public.builder_assets to authenticated;

revoke all on public.builder_asset_drafts from anon;
revoke all on public.builder_asset_versions from anon;
revoke all on public.builder_asset_dependencies from anon;
revoke all on public.builder_assets from anon;

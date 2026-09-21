-- ORVESEN Builder Footer V1: strict dedicated Footer blocks.
-- Incremental by design: the legacy/Header/Social validator chain remains intact.

create or replace function private.builder_footer_navigation_target_v1_is_valid(value jsonb)
returns boolean
language plpgsql
immutable
security invoker
set search_path = ''
as $$
declare
  target_type text;
begin
  if value is null
     or jsonb_typeof(value) is distinct from 'object'
     or exists(
       select 1
       from jsonb_object_keys(value) key
       where key <> all(array['type','section_id','anchor','asset_id','url','email','phone'])
     ) then return false; end if;

  target_type := value->>'type';
  if target_type = 'section' then
    return jsonb_typeof(value->'anchor') is not distinct from 'string'
      and coalesce(value->>'anchor','') ~ '^[a-z0-9]+(-[a-z0-9]+)*$'
      and (
        not (value ? 'section_id')
        or (
          jsonb_typeof(value->'section_id') is not distinct from 'string'
          and value->>'section_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        )
      );
  end if;

  if target_type = 'page' then
    return jsonb_typeof(value->'asset_id') is not distinct from 'string'
      and value->>'asset_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';
  end if;

  if target_type = 'url' then
    return jsonb_typeof(value->'url') is not distinct from 'string'
      and value->>'url' ~ '^https://[^[:space:][:cntrl:]]+$';
  end if;

  if target_type = 'email' then
    return jsonb_typeof(value->'email') is not distinct from 'string'
      and value->>'email' ~ '^[^[:space:]@]+@[^[:space:]@]+$';
  end if;

  if target_type = 'phone' then
    return jsonb_typeof(value->'phone') is not distinct from 'string'
      and value->>'phone' ~ '^\+?[0-9(). -]+$';
  end if;

  return false;
exception when others then return false;
end;
$$;

create or replace function private.builder_footer_link_collection_v1_is_valid(value jsonb, max_items integer)
returns boolean
language plpgsql
immutable
security invoker
set search_path = ''
as $$
declare
  item jsonb;
  item_id text;
  ids text[] := array[]::text[];
begin
  if value is null
     or jsonb_typeof(value) is distinct from 'array'
     or max_items is null
     or max_items not between 0 and 100
     or jsonb_array_length(value) > max_items then return false; end if;

  for item in select collection_item.value from jsonb_array_elements(value) collection_item loop
    if jsonb_typeof(item) is distinct from 'object'
       or exists(
         select 1
         from jsonb_object_keys(item) key
         where key <> all(array['id','label','href','target','enabled'])
       )
       or jsonb_typeof(item->'id') is distinct from 'string'
       or coalesce(item->>'id','') !~ '^[a-z][a-z0-9_-]{0,47}$'
       or jsonb_typeof(item->'label') is distinct from 'string'
       or char_length(btrim(coalesce(item->>'label',''))) not between 1 and 80
       or jsonb_typeof(item->'enabled') is distinct from 'boolean' then return false; end if;

    item_id := item->>'id';
    if item_id = any(ids) then return false; end if;
    ids := array_append(ids, item_id);

    if item ? 'target' then
      if not private.builder_footer_navigation_target_v1_is_valid(item->'target') then return false; end if;
    elsif jsonb_typeof(item->'href') is distinct from 'string'
       or coalesce(item->>'href','') !~ '^(https://[^[:space:][:cntrl:]]+|#[^[:space:][:cntrl:]]*|mailto:[^[:space:][:cntrl:]]+|tel:\+?[0-9(). -]+)$' then
      return false;
    end if;
  end loop;

  return true;
exception when others then return false;
end;
$$;

create or replace function private.builder_landing_footer_block_v1_is_valid(block jsonb)
returns boolean
language plpgsql
immutable
security invoker
set search_path = ''
as $$
declare
  content jsonb := block->'content';
  brand jsonb;
  link_group jsonb;
  group_id text;
  group_ids text[] := array[]::text[];
begin
  if block->>'schema_version' is distinct from '1'
     or block->>'type' is distinct from 'site_footer'
     or jsonb_typeof(content) is distinct from 'object'
     or exists(
       select 1
       from jsonb_object_keys(content) key
       where key <> all(array[
         'preset','brand','link_groups','social_enabled','social','copyright','legal_links',
         'surface','text_color','border','spacing','gap','alignment'
       ])
     ) then return false; end if;

  if coalesce(content->>'preset','') not in ('classic','centered','columns','minimal','split','custom')
     or jsonb_typeof(content->'social_enabled') is distinct from 'boolean'
     or jsonb_typeof(content->'copyright') is distinct from 'string'
     or char_length(content->>'copyright') > 240
     or coalesce(content->>'surface','') not in ('transparent','solid','dark','light')
     or coalesce(content->>'text_color','') not in ('text','muted','primary','light','dark')
     or coalesce(content->>'border','') not in ('none','subtle','standard')
     or coalesce(content->>'spacing','') not in ('sm','md','lg')
     or coalesce(content->>'gap','') not in ('sm','md','lg')
     or coalesce(content->>'alignment','') not in ('start','center') then return false; end if;

  brand := content->'brand';
  if jsonb_typeof(brand) is distinct from 'object'
     or exists(
       select 1
       from jsonb_object_keys(brand) key
       where key <> all(array['name','logo_url','logo_size','tagline'])
     )
     or jsonb_typeof(brand->'name') is distinct from 'string'
     or char_length(brand->>'name') > 120
     or jsonb_typeof(brand->'logo_url') is distinct from 'string'
     or coalesce(brand->>'logo_url','') !~ '^(|https://[^[:space:][:cntrl:]]+)$'
     or (char_length(btrim(coalesce(brand->>'name',''))) = 0 and coalesce(brand->>'logo_url','') = '')
     or coalesce(brand->>'logo_size','') not in ('sm','md','lg')
     or jsonb_typeof(brand->'tagline') is distinct from 'string'
     or char_length(brand->>'tagline') > 400 then return false; end if;

  if jsonb_typeof(content->'link_groups') is distinct from 'array'
     or jsonb_array_length(content->'link_groups') > 4 then return false; end if;

  for link_group in select group_item.value from jsonb_array_elements(content->'link_groups') group_item loop
    if jsonb_typeof(link_group) is distinct from 'object'
       or exists(
         select 1
         from jsonb_object_keys(link_group) key
         where key <> all(array['id','title','links'])
       )
       or jsonb_typeof(link_group->'id') is distinct from 'string'
       or coalesce(link_group->>'id','') !~ '^[a-z][a-z0-9_-]{0,47}$'
       or jsonb_typeof(link_group->'title') is distinct from 'string'
       or char_length(link_group->>'title') > 80
       or not private.builder_footer_link_collection_v1_is_valid(link_group->'links', 8) then return false; end if;

    group_id := link_group->>'id';
    if group_id = any(group_ids) then return false; end if;
    group_ids := array_append(group_ids, group_id);
  end loop;

  if not private.builder_footer_link_collection_v1_is_valid(content->'legal_links', 6)
     or not private.builder_landing_header_social_block_v1_is_valid(
       jsonb_build_object(
         'schema_version', 1,
         'type', 'social_links',
         'content', content->'social'
       )
     ) then return false; end if;

  return true;
exception when others then return false;
end;
$$;

-- Keep the same signature/OID so the existing draft constraint remains bound.
-- Footer is validated strictly, then represented as a legacy-safe text block only
-- for delegation through the already-deployed compatibility validator chain.
create or replace function private.builder_landing_document_v1_is_valid(candidate jsonb)
returns boolean
language plpgsql
immutable
security invoker
set search_path = ''
as $$
declare
  normalized jsonb := candidate;
  section_index integer; region_index integer; block_index integer; action_index integer;
  block jsonb; item jsonb; normalized_links jsonb;
begin
  for section_index in 0..jsonb_array_length(candidate->'sections') - 1 loop
    if candidate#>>array['sections',section_index::text,'label'] is not null and char_length(candidate#>>array['sections',section_index::text,'label']) > 120 then return false; end if;
    if candidate#>>array['sections',section_index::text,'anchor'] is not null and candidate#>>array['sections',section_index::text,'anchor'] !~ '^[a-z0-9]+(-[a-z0-9]+)*$' then return false; end if;
    normalized := jsonb_set(normalized,array['sections',section_index::text],(normalized#>array['sections',section_index::text]) - array['label','anchor']);
    if candidate#>array['sections',section_index::text,'style','appearance'] is not null then
      if not private.builder_visual_appearance_v1_is_valid(candidate#>array['sections',section_index::text,'style','appearance']) then return false; end if;
      normalized := jsonb_set(normalized,array['sections',section_index::text,'style'],(normalized#>array['sections',section_index::text,'style']) - 'appearance');
    end if;
    for region_index in 0..jsonb_array_length(candidate#>array['sections',section_index::text,'regions']) - 1 loop
      for block_index in 0..jsonb_array_length(candidate#>array['sections',section_index::text,'regions',region_index::text,'blocks']) - 1 loop
        block := candidate#>array['sections',section_index::text,'regions',region_index::text,'blocks',block_index::text];
        if block#>'{style,appearance}' is not null and not private.builder_visual_appearance_v1_is_valid(block#>'{style,appearance}') then return false; end if;
        if block->>'type' = 'action_group' then
          for action_index in 0..jsonb_array_length(block#>'{content,actions}') - 1 loop
            if block#>>array['content','actions',action_index::text,'variant'] in ('gradient','glass','soft','elevated') then
              normalized := jsonb_set(normalized,array['sections',section_index::text,'regions',region_index::text,'blocks',block_index::text,'content','actions',action_index::text,'variant'],'"primary"'::jsonb);
            end if;
          end loop;
        end if;
        if block#>>'{style,line_height}' is not null and block#>>'{style,line_height}' not in ('tight','normal','relaxed') then return false; end if;
        if block#>>'{style,letter_spacing}' is not null and block#>>'{style,letter_spacing}' not in ('tight','normal','wide') then return false; end if;
        if block ? 'style' then normalized := jsonb_set(normalized,array['sections',section_index::text,'regions',region_index::text,'blocks',block_index::text,'style'],(normalized#>array['sections',section_index::text,'regions',region_index::text,'blocks',block_index::text,'style']) - array['line_height','letter_spacing','appearance']); end if;
        if block->>'type' in ('site_header','social_links') then
          if not private.builder_landing_header_social_block_v1_is_valid(block) then return false; end if;
          if block->>'type' = 'social_links' then
            normalized_links := '[]'::jsonb;
            for item in select value from jsonb_array_elements(block#>'{content,links}') loop normalized_links := normalized_links || jsonb_build_array(item - 'enabled'); end loop;
            normalized := jsonb_set(normalized,array['sections',section_index::text,'regions',region_index::text,'blocks',block_index::text,'content'],jsonb_build_object('links',normalized_links));
          else
            normalized := jsonb_set(normalized,array['sections',section_index::text,'regions',region_index::text,'blocks',block_index::text,'type'],'"text"'::jsonb);
            normalized := jsonb_set(normalized,array['sections',section_index::text,'regions',region_index::text,'blocks',block_index::text,'content'],'{"text":""}'::jsonb);
          end if;
        end if;
        if block->>'type' = 'site_footer' then
          if not private.builder_landing_footer_block_v1_is_valid(block) then return false; end if;
          normalized := jsonb_set(normalized,array['sections',section_index::text,'regions',region_index::text,'blocks',block_index::text,'type'],'"text"'::jsonb);
          normalized := jsonb_set(normalized,array['sections',section_index::text,'regions',region_index::text,'blocks',block_index::text,'content'],'{"text":""}'::jsonb);
        end if;
      end loop;
    end loop;
  end loop;
  return private.builder_landing_document_v1_is_valid_before_header(normalized);
exception when others then return false;
end;
$$;

alter function private.builder_footer_navigation_target_v1_is_valid(jsonb) owner to postgres;
alter function private.builder_footer_link_collection_v1_is_valid(jsonb, integer) owner to postgres;
alter function private.builder_landing_footer_block_v1_is_valid(jsonb) owner to postgres;
alter function private.builder_landing_document_v1_is_valid(jsonb) owner to postgres;

revoke all on function private.builder_footer_navigation_target_v1_is_valid(jsonb) from public, anon, authenticated;
revoke all on function private.builder_footer_link_collection_v1_is_valid(jsonb, integer) from public, anon, authenticated;
revoke all on function private.builder_landing_footer_block_v1_is_valid(jsonb) from public, anon, authenticated;
revoke all on function private.builder_landing_document_v1_is_valid(jsonb) from public, anon, authenticated;

-- ORVESEN Builder Header Composer V1: strict global Nav style + per-item overrides.
-- Incremental by design: 20260905120000 may already exist in remote history.

create or replace function private.builder_header_nav_style_v1_is_valid(value jsonb)
returns boolean
language plpgsql
immutable
security invoker
set search_path = ''
as $$
begin
  if value is null or jsonb_typeof(value) is distinct from 'object' then return false; end if;
  if exists(
    select 1
    from jsonb_object_keys(value) key
    where key <> all(array[
      'font_family','font_size','font_weight','text_color','gap','padding_x','padding_y',
      'background','border','border_width','border_color','radius',
      'hover_background','hover_text_color','active_background','active_text_color','alignment'
    ])
  ) then return false; end if;

  if value ? 'font_family' and (jsonb_typeof(value->'font_family') is distinct from 'string' or value->>'font_family' not in ('inherit','sans','serif','display','mono')) then return false; end if;
  if value ? 'font_size' and (jsonb_typeof(value->'font_size') is distinct from 'string' or value->>'font_size' not in ('xs','sm','md','lg','xl')) then return false; end if;
  if value ? 'font_weight' and (jsonb_typeof(value->'font_weight') is distinct from 'string' or value->>'font_weight' not in ('regular','medium','semibold','bold')) then return false; end if;
  if value ? 'text_color' and (jsonb_typeof(value->'text_color') is distinct from 'string' or value->>'text_color' not in ('inherit','text','muted','primary','light','dark')) then return false; end if;
  if value ? 'gap' and (jsonb_typeof(value->'gap') is distinct from 'string' or value->>'gap' not in ('none','xs','sm','md','lg','xl')) then return false; end if;
  if value ? 'padding_x' and (jsonb_typeof(value->'padding_x') is distinct from 'string' or value->>'padding_x' not in ('none','xs','sm','md','lg')) then return false; end if;
  if value ? 'padding_y' and (jsonb_typeof(value->'padding_y') is distinct from 'string' or value->>'padding_y' not in ('none','xs','sm','md','lg')) then return false; end if;
  if value ? 'background' and (jsonb_typeof(value->'background') is distinct from 'string' or value->>'background' not in ('transparent','surface','page','primary','dark','light')) then return false; end if;
  if value ? 'border' and (jsonb_typeof(value->'border') is distinct from 'string' or value->>'border' not in ('none','subtle','standard')) then return false; end if;
  if value ? 'border_width' and (jsonb_typeof(value->'border_width') is distinct from 'string' or value->>'border_width' not in ('none','thin','medium')) then return false; end if;
  if value ? 'border_color' and (jsonb_typeof(value->'border_color') is distinct from 'string' or value->>'border_color' not in ('current','text','muted','primary','light','dark')) then return false; end if;
  if value ? 'radius' and (jsonb_typeof(value->'radius') is distinct from 'string' or value->>'radius' not in ('none','sm','md','lg','pill')) then return false; end if;
  if value ? 'hover_background' and (jsonb_typeof(value->'hover_background') is distinct from 'string' or value->>'hover_background' not in ('transparent','surface','page','primary','dark','light')) then return false; end if;
  if value ? 'hover_text_color' and (jsonb_typeof(value->'hover_text_color') is distinct from 'string' or value->>'hover_text_color' not in ('inherit','text','muted','primary','light','dark')) then return false; end if;
  if value ? 'active_background' and (jsonb_typeof(value->'active_background') is distinct from 'string' or value->>'active_background' not in ('transparent','surface','page','primary','dark','light')) then return false; end if;
  if value ? 'active_text_color' and (jsonb_typeof(value->'active_text_color') is distinct from 'string' or value->>'active_text_color' not in ('inherit','text','muted','primary','light','dark')) then return false; end if;
  if value ? 'alignment' and (jsonb_typeof(value->'alignment') is distinct from 'string' or value->>'alignment' not in ('start','center','end')) then return false; end if;
  return true;
exception when others then return false;
end;
$$;

create or replace function private.builder_landing_header_social_block_v1_is_valid(block jsonb)
returns boolean
language plpgsql
immutable
security invoker
set search_path = ''
as $$
declare
  content jsonb := block->'content';
  item jsonb;
begin
  if block->>'schema_version' is distinct from '1' or jsonb_typeof(content) is distinct from 'object' then return false; end if;

  if block->>'type' = 'site_header' then
    if exists(select 1 from jsonb_object_keys(content) key where key <> all(array['preset','logo_url','brand_name','logo_size','nav_items','nav_style','cta','sticky','surface','text_color','shadow','border','spacing','alignment']))
       or content->>'preset' not in ('classic','boxed','floating_pill','minimal','centered','split','glass','custom','logo_nav_cta','centered_nav','centered_logo','transparent','solid','dark','light','sticky','cta_heavy')
       or coalesce(content->>'logo_url','') !~ '^(|https://[^[:space:]]+)$'
       or char_length(btrim(coalesce(content->>'brand_name',''))) not between 1 and 120
       or content->>'logo_size' not in ('sm','md','lg')
       or jsonb_typeof(content->'nav_items') is distinct from 'array'
       or jsonb_array_length(content->'nav_items') > 10
       or (content ? 'nav_style' and not private.builder_header_nav_style_v1_is_valid(content->'nav_style'))
       or jsonb_typeof(content->'cta') is distinct from 'object'
       or jsonb_typeof(content->'sticky') is distinct from 'boolean'
       or content->>'surface' not in ('transparent','solid','dark','light')
       or content->>'text_color' not in ('text','muted','primary','light','dark')
       or content->>'shadow' not in ('none','subtle','soft')
       or content->>'border' not in ('none','subtle','standard')
       or content->>'spacing' not in ('sm','md','lg')
       or content->>'alignment' not in ('start','center','spread') then return false; end if;

    for item in select value from jsonb_array_elements(content->'nav_items') loop
      if jsonb_typeof(item) is distinct from 'object'
         or exists(select 1 from jsonb_object_keys(item) key where key <> all(array['id','label','href','target','enabled','style']))
         or (item ? 'id' and coalesce(item->>'id','') <> '' and item->>'id' !~ '^[a-z][a-z0-9_-]{0,47}$')
         or jsonb_typeof(item->'enabled') is distinct from 'boolean'
         or char_length(btrim(coalesce(item->>'label',''))) not between 1 and 80
         or (item ? 'style' and (
           not private.builder_header_nav_style_v1_is_valid(item->'style')
           or exists(select 1 from jsonb_object_keys(item->'style') key where key = any(array['gap','alignment']))
         )) then return false; end if;
      if item ? 'target' then
        if jsonb_typeof(item->'target') is distinct from 'object'
           or exists(select 1 from jsonb_object_keys(item->'target') key where key <> all(array['type','section_id','anchor','asset_id','url','email','phone'])) then return false; end if;
        if item#>>'{target,type}' = 'section' and (coalesce(item#>>'{target,anchor}','') !~ '^[a-z0-9]+(-[a-z0-9]+)*$' or (item#>>'{target,section_id}' is not null and item#>>'{target,section_id}' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$')) then return false; end if;
        if item#>>'{target,type}' = 'page' and coalesce(item#>>'{target,asset_id}','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then return false; end if;
        if item#>>'{target,type}' = 'url' and coalesce(item#>>'{target,url}','') !~ '^https://[^[:space:]]+$' then return false; end if;
        if item#>>'{target,type}' = 'email' and coalesce(item#>>'{target,email}','') !~ '^[^[:space:]@]+@[^[:space:]@]+$' then return false; end if;
        if item#>>'{target,type}' = 'phone' and coalesce(item#>>'{target,phone}','') !~ '^\+?[0-9(). -]+$' then return false; end if;
        if item#>>'{target,type}' not in ('section','page','url','email','phone') then return false; end if;
      elsif coalesce(item->>'href','') !~ '^(https://|#|mailto:|tel:)' then return false;
      end if;
    end loop;

    item := content->'cta';
    return not exists(select 1 from jsonb_object_keys(item) key where key <> all(array['label','href','enabled']))
      and jsonb_typeof(item->'enabled') is not distinct from 'boolean'
      and char_length(btrim(coalesce(item->>'label',''))) between 1 and 80
      and coalesce(item->>'href','') ~ '^(https://|#|mailto:|tel:)';
  end if;

  if block->>'type' = 'social_links' then
    if exists(select 1 from jsonb_object_keys(content) key where key <> all(array['links','variant','size','gap','align','color']))
       or jsonb_typeof(content->'links') is distinct from 'array'
       or jsonb_array_length(content->'links') > 10
       or coalesce(content->>'variant','outline') not in ('minimal','circle','square','filled','outline')
       or coalesce(content->>'size','md') not in ('sm','md','lg')
       or coalesce(content->>'gap','md') not in ('sm','md','lg')
       or coalesce(content->>'align','start') not in ('start','center','end')
       or coalesce(content->>'color','text') not in ('text','muted','primary') then return false; end if;
    for item in select value from jsonb_array_elements(content->'links') loop
      if jsonb_typeof(item) is distinct from 'object'
         or exists(select 1 from jsonb_object_keys(item) key where key <> all(array['provider','url','label','enabled']))
         or item->>'provider' not in ('instagram','facebook','linkedin','youtube','x','tiktok','website','email')
         or coalesce(item->>'url','') !~ '^(https://|mailto:|#)'
         or char_length(btrim(coalesce(item->>'label',''))) not between 1 and 80
         or (item ? 'enabled' and jsonb_typeof(item->'enabled') is distinct from 'boolean') then return false; end if;
    end loop;
    return true;
  end if;

  return false;
exception when others then return false;
end;
$$;

alter function private.builder_header_nav_style_v1_is_valid(jsonb) owner to postgres;
alter function private.builder_landing_header_social_block_v1_is_valid(jsonb) owner to postgres;
revoke all on function private.builder_header_nav_style_v1_is_valid(jsonb) from public, anon, authenticated;
revoke all on function private.builder_landing_header_social_block_v1_is_valid(jsonb) from public, anon, authenticated;

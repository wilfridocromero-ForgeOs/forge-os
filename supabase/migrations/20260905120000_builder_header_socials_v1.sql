-- Builder UX: explicit Header blocks and independent configurable Socials.
create or replace function private.builder_visual_appearance_v1_is_valid(value jsonb)
returns boolean language plpgsql immutable security invoker set search_path = '' as $$
declare color_pattern constant text := '^(#[0-9a-fA-F]{6}|[a-z][a-z0-9_-]{0,47})$';
begin
  if value is null or jsonb_typeof(value) <> 'object' or exists(select 1 from jsonb_object_keys(value) k where k <> all(array['preset','surface','gradient','shadow','glow','border','radius','opacity','blur','texture','elevation','hover'])) then return false; end if;
  if value ? 'preset' and value->>'preset' not in ('clean','soft','elevated','glass','premium_dark','gradient','glow','luxury') then return false; end if;
  if value ? 'surface' and value->>'surface' not in ('inherit','solid','gradient','glass','transparent') then return false; end if;
  if value ? 'border' and value->>'border' not in ('none','subtle','standard','highlight') then return false; end if;
  if value ? 'radius' and value->>'radius' not in ('none','sm','md','lg','xl') then return false; end if;
  if value ? 'opacity' and (jsonb_typeof(value->'opacity') <> 'number' or (value->>'opacity')::integer not in (0,20,40,60,80,100)) then return false; end if;
  if value ? 'blur' and value->>'blur' not in ('none','sm','md') then return false; end if;
  if value ? 'texture' and value->>'texture' not in ('none','grain') then return false; end if;
  if value ? 'elevation' and value->>'elevation' not in ('flat','raised','floating') then return false; end if;
  if value ? 'hover' and value->>'hover' not in ('none','lift','brightness','scale') then return false; end if;
  if value ? 'gradient' then
    if jsonb_typeof(value->'gradient') <> 'object' or exists(select 1 from jsonb_object_keys(value->'gradient') k where k <> all(array['type','preset','color_1','color_2','color_3','angle','position','intensity'])) or value#>>'{gradient,type}' not in ('linear','radial','highlight') or value#>>'{gradient,preset}' not in ('subtle','premium_dark','warm','cool','metallic','soft_light') then return false; end if;
    if value#>>'{gradient,angle}' is not null and (value#>>'{gradient,angle}')::integer not in (0,45,90,135,180,225,270,315) then return false; end if;
    if value#>>'{gradient,position}' is not null and value#>>'{gradient,position}' not in ('center','top','bottom','left','right') then return false; end if;
    if value#>>'{gradient,intensity}' is not null and (value#>>'{gradient,intensity}')::integer not in (0,20,40,60,80,100) then return false; end if;
    if exists(select 1 from unnest(array['color_1','color_2','color_3']) k where value->'gradient' ? k and value->'gradient'->>k !~ color_pattern) then return false; end if;
  end if;
  if value ? 'shadow' then
    if jsonb_typeof(value->'shadow') <> 'object' or exists(select 1 from jsonb_object_keys(value->'shadow') k where k <> all(array['token','color','intensity','inset'])) or value#>>'{shadow,token}' not in ('none','subtle','soft','medium','strong','floating','deep') then return false; end if;
    if value#>>'{shadow,color}' is not null and value#>>'{shadow,color}' !~ color_pattern then return false; end if;
    if value#>>'{shadow,intensity}' is not null and (value#>>'{shadow,intensity}')::integer not in (0,20,40,60,80,100) then return false; end if;
    if value#>'{shadow,inset}' is not null and jsonb_typeof(value#>'{shadow,inset}') <> 'boolean' then return false; end if;
  end if;
  if value ? 'glow' then
    if jsonb_typeof(value->'glow') <> 'object' or exists(select 1 from jsonb_object_keys(value->'glow') k where k <> all(array['token','color','intensity','position','blur'])) or value#>>'{glow,token}' not in ('none','soft','edge','radial','top','bottom','ambient') then return false; end if;
    if value#>>'{glow,color}' is not null and value#>>'{glow,color}' !~ color_pattern then return false; end if;
    if value#>>'{glow,intensity}' is not null and (value#>>'{glow,intensity}')::integer not in (0,20,40,60,80,100) then return false; end if;
    if value#>>'{glow,position}' is not null and value#>>'{glow,position}' not in ('center','top','bottom','left','right') then return false; end if;
    if value#>>'{glow,blur}' is not null and value#>>'{glow,blur}' not in ('sm','md','lg') then return false; end if;
  end if;
  return true;
exception when others then return false;
end;
$$;

alter function private.builder_form_document_v1_is_valid(jsonb)
  rename to builder_form_document_v1_is_valid_before_visual;

create function private.builder_form_document_v1_is_valid(candidate jsonb)
returns boolean language plpgsql immutable security invoker set search_path = '' as $$
declare field_value jsonb; option_value jsonb; ids text[] := array[]::text[]; field_id text;
begin
  -- Preserve every document accepted by the exact production validator.
  if private.builder_form_document_v1_is_valid_before_visual(candidate) then return true; end if;
  if candidate is null or jsonb_typeof(candidate) <> 'object' or pg_column_size(candidate) > 262144 or candidate->>'schema_version' <> '1' or candidate->>'document_type' <> 'form' then return false; end if;
  if exists(select 1 from jsonb_object_keys(candidate) k where k <> all(array['schema_version','document_type','settings','fields'])) then return false; end if;
  if jsonb_typeof(candidate->'settings') <> 'object' or exists(select 1 from jsonb_object_keys(candidate->'settings') k where k <> all(array['submit_label','success_message','layout','style_preset','inherit_page_theme','background','card_background','border_color','radius','shadow','padding','field_background','field_border','label_color','input_color','placeholder_color','submit_variant','vertical_spacing','button_alignment','button_width','appearance'])) then return false; end if;
  if coalesce(char_length(candidate#>>'{settings,submit_label}'),0) not between 1 and 80 or coalesce(char_length(candidate#>>'{settings,success_message}'),0) > 500 or candidate#>>'{settings,layout}' not in ('stack','two_column') or candidate#>>'{settings,style_preset}' not in ('clean_light','dark','soft_card','minimal','glass') or jsonb_typeof(candidate#>'{settings,inherit_page_theme}') <> 'boolean' or candidate#>>'{settings,radius}' not in ('none','sm','md','lg') or candidate#>>'{settings,shadow}' not in ('none','soft','elevated') or candidate#>>'{settings,padding}' not in ('sm','md','lg') or candidate#>>'{settings,submit_variant}' not in ('primary','secondary','outline') or candidate#>>'{settings,vertical_spacing}' not in ('sm','md','lg') or candidate#>>'{settings,button_alignment}' not in ('start','center','end') or candidate#>>'{settings,button_width}' not in ('auto','full') then return false; end if;
  if candidate->'settings' ? 'appearance' and not private.builder_visual_appearance_v1_is_valid(candidate#>'{settings,appearance}') then return false; end if;
  if exists(select 1 from unnest(array['background','card_background','border_color','field_background','field_border','label_color','input_color','placeholder_color']) k where jsonb_typeof(candidate->'settings'->k) <> 'string' or char_length(candidate->'settings'->>k) > 40) then return false; end if;
  if jsonb_typeof(candidate->'fields') <> 'array' or jsonb_array_length(candidate->'fields') > 60 then return false; end if;
  for field_value in select value from jsonb_array_elements(candidate->'fields') loop
    if jsonb_typeof(field_value) <> 'object' or exists(select 1 from jsonb_object_keys(field_value) k where k <> all(array['id','type','label','placeholder','required','width','options'])) or coalesce(field_value->>'id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' or field_value->>'type' not in ('text','email','tel','textarea','select','checkbox','radio','number','url') or jsonb_typeof(field_value->'label') <> 'string' or char_length(field_value->>'label') > 120 or jsonb_typeof(field_value->'placeholder') <> 'string' or char_length(field_value->>'placeholder') > 240 or jsonb_typeof(field_value->'required') <> 'boolean' or coalesce(field_value->>'width','') not in ('full','half') then return false; end if;
    field_id := field_value->>'id'; if field_id = any(ids) then return false; end if; ids := array_append(ids,field_id);
    if field_value->>'type' in ('select','radio') then
      if jsonb_typeof(field_value->'options') <> 'array' or jsonb_array_length(field_value->'options') not between 1 and 30 then return false; end if;
      for option_value in select value from jsonb_array_elements(field_value->'options') loop if jsonb_typeof(option_value) <> 'string' or char_length(option_value#>>'{}') > 120 then return false; end if; end loop;
    elsif field_value ? 'options' then return false;
    end if;
  end loop;
  return true;
exception when others then return false;
end;
$$;

alter function private.builder_landing_document_v1_is_valid(jsonb)
  rename to builder_landing_document_v1_is_valid_before_header;

create function private.builder_landing_header_social_block_v1_is_valid(block jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  content jsonb := block->'content';
  item jsonb;
begin
  if block->>'schema_version' is distinct from '1' or jsonb_typeof(content) is distinct from 'object' then return false; end if;
  if block->>'type' = 'site_header' then
    if exists(select 1 from jsonb_object_keys(content) key where key <> all(array['preset','logo_url','brand_name','logo_size','nav_items','cta','sticky','surface','text_color','shadow','border','spacing','alignment']))
       or content->>'preset' not in ('logo_nav_cta','centered_nav','centered_logo','split','minimal','transparent','solid','dark','light','sticky','cta_heavy')
       or coalesce(content->>'logo_url','') !~ '^(|https://[^[:space:]]+)$'
       or char_length(btrim(coalesce(content->>'brand_name',''))) not between 1 and 120
       or content->>'logo_size' not in ('sm','md','lg')
       or jsonb_typeof(content->'nav_items') is distinct from 'array' or jsonb_array_length(content->'nav_items') > 10
       or jsonb_typeof(content->'cta') is distinct from 'object'
       or jsonb_typeof(content->'sticky') is distinct from 'boolean'
       or content->>'surface' not in ('transparent','solid','dark','light')
       or content->>'text_color' not in ('text','muted','primary','light','dark')
       or content->>'shadow' not in ('none','subtle','soft')
       or content->>'border' not in ('none','subtle','standard')
       or content->>'spacing' not in ('sm','md','lg')
       or content->>'alignment' not in ('start','center','spread') then return false; end if;
    for item in select value from jsonb_array_elements(content->'nav_items') loop
      if jsonb_typeof(item) <> 'object' or exists(select 1 from jsonb_object_keys(item) key where key <> all(array['id','label','href','target','enabled'])) or jsonb_typeof(item->'enabled') <> 'boolean' or char_length(btrim(coalesce(item->>'label',''))) not between 1 and 80 then return false; end if;
      if item ? 'target' then
        if jsonb_typeof(item->'target') <> 'object' or exists(select 1 from jsonb_object_keys(item->'target') key where key <> all(array['type','section_id','anchor','asset_id','url','email','phone'])) then return false; end if;
        if item#>>'{target,type}' = 'section' and (coalesce(item#>>'{target,anchor}','') !~ '^[a-z0-9]+(-[a-z0-9]+)*$' or (item#>>'{target,section_id}' is not null and item#>>'{target,section_id}' !~* '^[0-9a-f-]{36}$')) then return false; end if;
        if item#>>'{target,type}' = 'page' and coalesce(item#>>'{target,asset_id}','') !~* '^[0-9a-f-]{36}$' then return false; end if;
        if item#>>'{target,type}' = 'url' and coalesce(item#>>'{target,url}','') !~ '^https://[^[:space:]]+$' then return false; end if;
        if item#>>'{target,type}' = 'email' and coalesce(item#>>'{target,email}','') !~ '^[^[:space:]@]+@[^[:space:]@]+$' then return false; end if;
        if item#>>'{target,type}' = 'phone' and coalesce(item#>>'{target,phone}','') !~ '^\+?[0-9(). -]+$' then return false; end if;
        if item#>>'{target,type}' not in ('section','page','url','email','phone') then return false; end if;
      elsif coalesce(item->>'href','') !~ '^(https://|#|mailto:|tel:)' then return false;
      end if;
    end loop;
    item := content->'cta';
    return not exists(select 1 from jsonb_object_keys(item) key where key <> all(array['label','href','enabled'])) and jsonb_typeof(item->'enabled') = 'boolean' and char_length(btrim(coalesce(item->>'label',''))) between 1 and 80 and coalesce(item->>'href','') ~ '^(https://|#|mailto:)';
  end if;
  if block->>'type' = 'social_links' then
    if exists(select 1 from jsonb_object_keys(content) key where key <> all(array['links','variant','size','gap','align','color'])) or jsonb_typeof(content->'links') <> 'array' or jsonb_array_length(content->'links') > 10 or coalesce(content->>'variant','outline') not in ('minimal','circle','square','filled','outline') or coalesce(content->>'size','md') not in ('sm','md','lg') or coalesce(content->>'gap','md') not in ('sm','md','lg') or coalesce(content->>'align','start') not in ('start','center','end') or coalesce(content->>'color','text') not in ('text','muted','primary') then return false; end if;
    for item in select value from jsonb_array_elements(content->'links') loop
      if jsonb_typeof(item) <> 'object' or exists(select 1 from jsonb_object_keys(item) key where key <> all(array['provider','url','label','enabled'])) or item->>'provider' not in ('instagram','facebook','linkedin','youtube','x','tiktok','website','email') or coalesce(item->>'url','') !~ '^(https://|mailto:|#)' or char_length(btrim(coalesce(item->>'label',''))) not between 1 and 80 or (item ? 'enabled' and jsonb_typeof(item->'enabled') <> 'boolean') then return false; end if;
    end loop;
    return true;
  end if;
  return false;
exception when others then return false;
end;
$$;

create function private.builder_landing_document_v1_is_valid(candidate jsonb)
returns boolean
language plpgsql
immutable
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
      end loop;
    end loop;
  end loop;
  return private.builder_landing_document_v1_is_valid_before_header(normalized);
exception when others then return false;
end;
$$;

alter function private.builder_landing_document_v1_is_valid_before_header(jsonb) owner to postgres;
alter function private.builder_visual_appearance_v1_is_valid(jsonb) owner to postgres;
alter function private.builder_form_document_v1_is_valid_before_visual(jsonb) owner to postgres;
alter function private.builder_form_document_v1_is_valid(jsonb) owner to postgres;
alter function private.builder_landing_header_social_block_v1_is_valid(jsonb) owner to postgres;
alter function private.builder_landing_document_v1_is_valid(jsonb) owner to postgres;
revoke all on function private.builder_landing_document_v1_is_valid_before_header(jsonb) from public, anon, authenticated;
revoke all on function private.builder_visual_appearance_v1_is_valid(jsonb) from public, anon, authenticated;
revoke all on function private.builder_form_document_v1_is_valid_before_visual(jsonb) from public, anon, authenticated;
revoke all on function private.builder_form_document_v1_is_valid(jsonb) from public, anon, authenticated;
revoke all on function private.builder_landing_header_social_block_v1_is_valid(jsonb) from public, anon, authenticated;
revoke all on function private.builder_landing_document_v1_is_valid(jsonb) from public, anon, authenticated;

alter table public.builder_asset_drafts drop constraint builder_asset_drafts_document_check;
alter table public.builder_asset_drafts add constraint builder_asset_drafts_document_check check (private.builder_landing_document_v1_is_valid(document) or private.builder_form_document_v1_is_valid(document));

-- Rebind the publication constraint to the compatibility wrapper after the rename.
alter table public.builder_asset_drafts drop constraint builder_asset_drafts_publication_metadata_check;
alter table public.builder_asset_drafts add constraint builder_asset_drafts_publication_metadata_check check (
  (document->>'document_type' = 'form' and private.builder_form_document_v1_is_valid(document))
  or
  (document->>'document_type' = 'landing_page' and private.builder_landing_publication_metadata_v1_is_valid(document))
);

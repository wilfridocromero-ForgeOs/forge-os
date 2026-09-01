-- Builder Phase 4A: backward-compatible professional primitives for LandingDocumentV1.
alter function private.builder_landing_document_v1_is_valid(jsonb)
  rename to builder_landing_document_v1_is_valid_phase3;

create function private.builder_landing_professional_block_v1_is_valid(block jsonb)
returns boolean
language plpgsql
immutable
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
        if jsonb_typeof(item) <> 'object' or exists(select 1 from jsonb_object_keys(item) key where key <> all(array['label','href','variant','size','width','radius','shadow','border','background','text_color','border_color'])) or char_length(btrim(coalesce(item->>'label',''))) not between 1 and 80 or coalesce(item->>'href','') !~ '^(https://|#|mailto:)' then return false; end if;
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
      return coalesce(content->>'url','') ~ '^https://[^[:space:]]+$' and char_length(btrim(coalesce(content->>'alt',''))) between 1 and 200 and content->>'width' in ('sm','md','lg') and (coalesce(content->>'href','') = '' or content->>'href' ~ '^(https://|#|mailto:)');
    when 'feature_item' then
      return not exists(select 1 from jsonb_object_keys(content) key where key <> all(array['icon','title','description','href'])) and content->>'icon' in ('sparkles','shield','chart','check','users','zap') and char_length(btrim(coalesce(content->>'title',''))) between 1 and 120 and char_length(coalesce(content->>'description','')) <= 800 and (coalesce(content->>'href','') = '' or content->>'href' ~ '^(https://|#|mailto:)');
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
      return char_length(btrim(coalesce(content->>'plan_name',''))) between 1 and 100 and char_length(btrim(coalesce(content->>'price',''))) between 1 and 50 and char_length(coalesce(content->>'cadence','')) <= 40 and char_length(coalesce(content->>'description','')) <= 600 and char_length(btrim(coalesce(content->>'cta_label',''))) between 1 and 80 and coalesce(content->>'cta_url','') ~ '^(https://|#|mailto:)';
    when 'faq_item' then
      return not exists(select 1 from jsonb_object_keys(content) key where key <> all(array['question','answer','default_open'])) and char_length(btrim(coalesce(content->>'question',''))) between 1 and 300 and char_length(btrim(coalesce(content->>'answer',''))) between 1 and 2000 and jsonb_typeof(content->'default_open') = 'boolean';
    when 'divider' then
      return not exists(select 1 from jsonb_object_keys(content) key where key <> all(array['style','width','spacing'])) and content->>'style' in ('solid','dashed','subtle') and content->>'width' in ('narrow','standard','full') and content->>'spacing' in ('xs','sm','md','lg','xl');
    when 'spacer' then
      return not exists(select 1 from jsonb_object_keys(content) key where key <> 'size') and content->>'size' in ('xs','sm','md','lg','xl');
    when 'social_links' then
      if exists(select 1 from jsonb_object_keys(content) key where key <> 'links') or jsonb_typeof(content->'links') is distinct from 'array' or jsonb_array_length(content->'links') > 10 then return false; end if;
      for item in select value from jsonb_array_elements(content->'links') loop
        if jsonb_typeof(item) <> 'object' or exists(select 1 from jsonb_object_keys(item) key where key <> all(array['provider','url','label'])) or item->>'provider' not in ('instagram','facebook','linkedin','youtube','x','tiktok','website','email') or coalesce(item->>'url','') !~ '^(https://|mailto:|#)' or char_length(btrim(coalesce(item->>'label',''))) not between 1 and 80 then return false; end if;
      end loop;
      return true;
    else return false;
  end case;
exception when others then return false;
end;
$$;

create function private.builder_landing_professional_style_v1_is_valid(style jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  background jsonb := style->'background';
begin
  if jsonb_typeof(style) is distinct from 'object' then return false; end if;
  if exists(select 1 from jsonb_object_keys(style) key where key <> all(array['background','color','spacing','radius','content_width','align','text_variant','text_size','text_weight','max_width','border','shadow','padding_top','padding_bottom'])) then return false; end if;
  if style ? 'align' and style->>'align' not in ('start','center','end') then return false; end if;
  if style ? 'text_variant' and style->>'text_variant' not in ('lead','body','small') then return false; end if;
  if style ? 'text_size' and style->>'text_size' not in ('xs','sm','md','lg','xl','2xl') then return false; end if;
  if style ? 'text_weight' and style->>'text_weight' not in ('regular','medium','semibold','bold') then return false; end if;
  if style ? 'max_width' and style->>'max_width' not in ('none','narrow','standard','wide') then return false; end if;
  if style ? 'border' and style->>'border' not in ('none','subtle','standard') then return false; end if;
  if style ? 'shadow' and style->>'shadow' not in ('none','subtle','soft','medium','elevated') then return false; end if;
  if style ? 'radius' and style->>'radius' not in ('none','sm','md','lg','pill') then return false; end if;
  if style ? 'padding_top' and style->>'padding_top' not in ('none','xs','sm','md','lg','xl') then return false; end if;
  if style ? 'padding_bottom' and style->>'padding_bottom' not in ('none','xs','sm','md','lg','xl') then return false; end if;
  if style ? 'background' and jsonb_typeof(background) = 'object' then
    if exists(select 1 from jsonb_object_keys(background) key where key <> all(array['type','color','url','fit','position','overlay_color','overlay_opacity','gradient'])) then return false; end if;
    if background->>'type' not in ('none','transparent','solid','image','gradient') then return false; end if;
    if background->>'type' = 'none' and exists(select 1 from jsonb_object_keys(background) key where key <> 'type') then return false; end if;
    if background->>'type' = 'transparent' and exists(select 1 from jsonb_object_keys(background) key where key <> 'type') then return false; end if;
    if background->>'type' = 'solid' and exists(select 1 from jsonb_object_keys(background) key where key <> all(array['type','color'])) then return false; end if;
    if background->>'type' = 'image' and exists(select 1 from jsonb_object_keys(background) key where key <> all(array['type','url','fit','position','overlay_color','overlay_opacity'])) then return false; end if;
    if background->>'type' = 'gradient' and exists(select 1 from jsonb_object_keys(background) key where key <> all(array['type','gradient'])) then return false; end if;
    if background->>'type' = 'solid' and coalesce(background->>'color','') !~ '^[a-z][a-z0-9_-]{0,47}$' then return false; end if;
    if background->>'type' = 'image' and (coalesce(background->>'url','') !~ '^https://[^[:space:]"()]+$' or coalesce(background->>'fit','cover') not in ('cover','contain') or coalesce(background->>'position','center') not in ('center','top','bottom','left','right')) then return false; end if;
    if background->>'type' = 'gradient' and background->>'gradient' not in ('aurora','gold_dusk','graphite','soft_light') then return false; end if;
    if background ? 'overlay_color' and background->>'overlay_color' !~ '^[a-z][a-z0-9_-]{0,47}$' then return false; end if;
    if background ? 'overlay_opacity' and (jsonb_typeof(background->'overlay_opacity') <> 'number' or (background->>'overlay_opacity')::integer not in (0,10,20,30,40,50,60,70,80)) then return false; end if;
  elsif style ? 'background' and jsonb_typeof(background) <> 'string' then return false;
  end if;
  return true;
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
  section_index integer;
  region_index integer;
  block_index integer;
  block jsonb;
  style jsonb;
  professional_types constant text[] := array['image','action_group','logo','feature_item','stat','testimonial','video','pricing_card','faq_item','divider','spacer','social_links'];
begin
  if jsonb_typeof(candidate->'sections') is distinct from 'array' then return false; end if;
  if exists(select 1 from jsonb_object_keys(candidate#>'{settings,design_system,buttons}') key where key <> all(array['variant','size','width','radius','shadow','border','background','text_color','border_color'])) then return false; end if;
  if candidate#>>'{settings,design_system,buttons,variant}' is not null and candidate#>>'{settings,design_system,buttons,variant}' not in ('primary','secondary','outline','ghost') then return false; end if;
  if candidate#>>'{settings,design_system,buttons,size}' is not null and candidate#>>'{settings,design_system,buttons,size}' not in ('sm','md','lg') then return false; end if;
  if candidate#>>'{settings,design_system,buttons,width}' is not null and candidate#>>'{settings,design_system,buttons,width}' not in ('auto','full') then return false; end if;
  if candidate#>>'{settings,design_system,buttons,radius}' is not null and candidate#>>'{settings,design_system,buttons,radius}' not in ('none','sm','md','lg','pill') then return false; end if;
  if candidate#>>'{settings,design_system,buttons,shadow}' is not null and candidate#>>'{settings,design_system,buttons,shadow}' not in ('none','subtle','soft','medium') then return false; end if;
  if candidate#>>'{settings,design_system,buttons,border}' is not null and candidate#>>'{settings,design_system,buttons,border}' not in ('none','subtle','standard') then return false; end if;
  if exists(select 1 from unnest(array['background','text_color','border_color']) key where candidate#>'{settings,design_system,buttons}' ? key and candidate#>>array['settings','design_system','buttons',key] !~ '^[a-z][a-z0-9_-]{0,47}$') then return false; end if;
  for section_index in 0..jsonb_array_length(candidate->'sections') - 1 loop
    style := candidate#>array['sections',section_index::text,'style'];
    if style is not null then
      if not private.builder_landing_professional_style_v1_is_valid(style) then return false; end if;
      style := style - array['text_variant','text_size','text_weight','max_width','border','shadow','padding_top','padding_bottom'];
      if jsonb_typeof(style->'background') = 'object' then style := style - 'background'; end if;
      normalized := jsonb_set(normalized, array['sections',section_index::text,'style'], style);
    end if;
    if jsonb_typeof(candidate#>array['sections',section_index::text,'regions']) is distinct from 'array' then return false; end if;
    for region_index in 0..jsonb_array_length(candidate#>array['sections',section_index::text,'regions']) - 1 loop
      if jsonb_typeof(candidate#>array['sections',section_index::text,'regions',region_index::text,'blocks']) is distinct from 'array' then return false; end if;
      for block_index in 0..jsonb_array_length(candidate#>array['sections',section_index::text,'regions',region_index::text,'blocks']) - 1 loop
        block := candidate#>array['sections',section_index::text,'regions',region_index::text,'blocks',block_index::text];
        style := block->'style';
        if style is not null then
          if not private.builder_landing_professional_style_v1_is_valid(style) then return false; end if;
          style := style - array['text_variant','text_size','text_weight','max_width','border','shadow','padding_top','padding_bottom'];
          if jsonb_typeof(style->'background') = 'object' then style := style - 'background'; end if;
          normalized := jsonb_set(normalized, array['sections',section_index::text,'regions',region_index::text,'blocks',block_index::text,'style'], style);
        end if;
        if block->>'type' = 'heading' and block#>>'{content,text}' = '' then
          normalized := jsonb_set(normalized, array['sections',section_index::text,'regions',region_index::text,'blocks',block_index::text,'type'], '"text"'::jsonb);
          normalized := jsonb_set(normalized, array['sections',section_index::text,'regions',region_index::text,'blocks',block_index::text,'content'], '{"text":""}'::jsonb);
        end if;
        if block->>'type' = any(professional_types) then
          if not private.builder_landing_professional_block_v1_is_valid(block) then return false; end if;
          normalized := jsonb_set(normalized, array['sections',section_index::text,'regions',region_index::text,'blocks',block_index::text,'type'], '"text"'::jsonb);
          normalized := jsonb_set(normalized, array['sections',section_index::text,'regions',region_index::text,'blocks',block_index::text,'content'], '{"text":""}'::jsonb);
        end if;
      end loop;
    end loop;
  end loop;
  return private.builder_landing_document_v1_is_valid_phase3(normalized);
exception when others then return false;
end;
$$;

alter function private.builder_landing_document_v1_is_valid_phase3(jsonb) owner to postgres;
alter function private.builder_landing_professional_block_v1_is_valid(jsonb) owner to postgres;
alter function private.builder_landing_professional_style_v1_is_valid(jsonb) owner to postgres;
alter function private.builder_landing_document_v1_is_valid(jsonb) owner to postgres;
revoke all on function private.builder_landing_document_v1_is_valid_phase3(jsonb) from public, anon, authenticated;
revoke all on function private.builder_landing_professional_block_v1_is_valid(jsonb) from public, anon, authenticated;
revoke all on function private.builder_landing_professional_style_v1_is_valid(jsonb) from public, anon, authenticated;
revoke all on function private.builder_landing_document_v1_is_valid(jsonb) from public, anon, authenticated;

alter table public.builder_asset_drafts drop constraint builder_asset_drafts_document_check;
alter table public.builder_asset_drafts add constraint builder_asset_drafts_document_check check (private.builder_landing_document_v1_is_valid(document));

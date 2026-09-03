-- ORVESEN Builder V6 — server validator sync
-- New migration. Do not modify the historical Phase 3B.1 migration.

create or replace function private.builder_landing_document_v1_is_valid(candidate jsonb)
returns boolean
language plpgsql
immutable
security invoker
set search_path = ''
as $$
declare
  s jsonb; r jsonb; b jsonb; a jsonb; x jsonb; bp jsonb; bg jsonb;
  e record; cat text; ident text; ids text[] := array[]::text[];
  blocks integer := 0; spans integer; t text;
begin
  if candidate is null or jsonb_typeof(candidate) <> 'object' or pg_column_size(candidate) > 524288 then return false; end if;
  if candidate->>'schema_version' <> '1' or candidate->>'document_type' <> 'landing_page' then return false; end if;
  if jsonb_typeof(candidate->'locale') <> 'string' or char_length(candidate->>'locale') not between 1 and 16 then return false; end if;
  if exists(select 1 from jsonb_object_keys(candidate) k where k <> all(array['schema_version','document_type','locale','settings','sections'])) then return false; end if;

  if jsonb_typeof(candidate->'settings') <> 'object'
     or exists(select 1 from jsonb_object_keys(candidate->'settings') k where k <> all(array['seo','design_system']))
     or jsonb_typeof(candidate#>'{settings,seo}') <> 'object'
     or exists(select 1 from jsonb_object_keys(candidate#>'{settings,seo}') k where k <> all(array['title','description']))
     or jsonb_typeof(candidate#>'{settings,seo,title}') <> 'string'
     or char_length(candidate#>>'{settings,seo,title}') > 120
     or jsonb_typeof(candidate#>'{settings,seo,description}') <> 'string'
     or char_length(candidate#>>'{settings,seo,description}') > 300
     or jsonb_typeof(candidate#>'{settings,design_system}') <> 'object' then return false; end if;

  if exists(select 1 from jsonb_object_keys(candidate#>'{settings,design_system}') k where k <> all(array['colors','typography','buttons','radii','spacing','content_widths'])) then return false; end if;
  foreach cat in array array['colors','typography','buttons','radii','spacing','content_widths'] loop
    if jsonb_typeof(candidate#>array['settings','design_system',cat]) <> 'object' then return false; end if;
    for e in select key,value from jsonb_each(candidate#>array['settings','design_system',cat]) loop
      if e.key !~ '^[a-z][a-z0-9_-]{0,47}$' or jsonb_typeof(e.value) <> 'string' or char_length(e.value#>>'{}') > 120 then return false; end if;
      if cat='buttons' then
        t:=e.value#>>'{}';
        if e.key='variant' and t not in ('primary','secondary','outline','ghost') then return false; end if;
        if e.key='size' and t not in ('sm','md','lg') then return false; end if;
        if e.key='width' and t not in ('auto','full') then return false; end if;
        if e.key='radius' and t not in ('none','sm','md','lg','pill') then return false; end if;
        if e.key='shadow' and t not in ('none','subtle','soft','medium') then return false; end if;
        if e.key='border' and t not in ('none','subtle','standard') then return false; end if;
        if e.key in ('background','text_color','border_color') and t !~ '^[a-z][a-z0-9_-]{0,47}$' then return false; end if;
        if e.key not in ('variant','size','width','radius','shadow','border','background','text_color','border_color') then return false; end if;
      end if;
    end loop;
  end loop;

  if jsonb_typeof(candidate->'sections') <> 'array' or jsonb_array_length(candidate->'sections') > 50 then return false; end if;
  for s in select value from jsonb_array_elements(candidate->'sections') loop
    if jsonb_typeof(s)<>'object' or exists(select 1 from jsonb_object_keys(s) k where k <> all(array['id','layout','style','responsive','regions']))
       or coalesce(s->>'id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       or s->>'layout' not in ('stack','columns') or jsonb_typeof(s->'regions')<>'array' or jsonb_array_length(s->'regions') not between 1 and 12 then return false; end if;
    ident:=s->>'id'; if ident=any(ids) then return false; end if; ids:=array_append(ids,ident);
    if s->>'layout'='stack' and jsonb_array_length(s->'regions')<>1 then return false; end if;

    -- Section/block style schema mirrors landingDocument.js V6.
    if s ? 'style' then
      if jsonb_typeof(s->'style')<>'object' or exists(select 1 from jsonb_object_keys(s->'style') k where k <> all(array['background','color','spacing','radius','content_width','align','text_variant','text_size','text_weight','font_family','max_width','border','shadow','padding_top','padding_bottom'])) then return false; end if;
      for e in select key,value from jsonb_each(s->'style') loop
        if e.key='background' and jsonb_typeof(e.value)='object' then
          bg:=e.value;
          if exists(select 1 from jsonb_object_keys(bg) k where k <> all(array['type','color','url','fit','position','overlay_color','overlay_opacity','gradient'])) then return false; end if;
          if coalesce(bg->>'type','') not in ('none','transparent','solid','image','gradient') then return false; end if;
          if bg->>'type'='image' and (coalesce(bg->>'url','') !~ '^https://[^[:space:]]+$' or coalesce(bg->>'fit','cover') not in ('cover','contain') or coalesce(bg->>'position','center') not in ('center','top','bottom','left','right')) then return false; end if;
          if bg->>'type'='gradient' and coalesce(bg->>'gradient','') not in ('none','aurora','gold_dusk','graphite','soft_light') then return false; end if;
        else
          if jsonb_typeof(e.value)<>'string' then return false; end if; t:=e.value#>>'{}';
          if e.key='align' and t not in ('start','center','end') then return false; end if;
          if e.key='text_variant' and t not in ('lead','body','small') then return false; end if;
          if e.key='text_size' and t not in ('xs','sm','md','lg','xl','2xl') then return false; end if;
          if e.key='text_weight' and t not in ('regular','medium','semibold','bold') then return false; end if;
          if e.key='font_family' and t not in ('inherit','sans','serif','mono','display') then return false; end if;
          if e.key='max_width' and t not in ('none','narrow','standard','wide') then return false; end if;
          if e.key='border' and t not in ('none','subtle','standard') then return false; end if;
          if e.key='shadow' and t not in ('none','subtle','soft','medium','elevated') then return false; end if;
          if e.key='radius' and t not in ('none','sm','md','lg','pill') then return false; end if;
          if e.key in ('padding_top','padding_bottom') and t not in ('none','xs','sm','md','lg','xl') then return false; end if;
          if e.key not in ('align','text_variant','text_size','text_weight','font_family','max_width','border','shadow','radius','padding_top','padding_bottom') and t !~ '^[a-z][a-z0-9_-]{0,47}$' then return false; end if;
        end if;
      end loop;
    end if;

    x:=s->'responsive';
    if x is not null then
      if jsonb_typeof(x)<>'object' or exists(select 1 from jsonb_object_keys(x) k where k <> all(array['tablet','mobile'])) then return false; end if;
      for bp in select value from jsonb_each(x) loop
        if jsonb_typeof(bp)<>'object' or exists(select 1 from jsonb_object_keys(bp) k where k <> all(array['layout','span','align','spacing','hidden'])) then return false; end if;
        if bp?'layout' and bp->>'layout' not in ('stack','columns') then return false; end if;
        if bp?'span' and (jsonb_typeof(bp->'span')<>'number' or (bp->>'span')::numeric<>trunc((bp->>'span')::numeric) or (bp->>'span')::int not between 1 and 12) then return false; end if;
        if bp?'align' and bp->>'align' not in ('start','center','end') then return false; end if;
        if bp?'spacing' and bp->>'spacing' !~ '^[a-z][a-z0-9_-]{0,47}$' then return false; end if;
        if bp?'hidden' and jsonb_typeof(bp->'hidden')<>'boolean' then return false; end if;
      end loop;
    end if;

    spans:=0;
    for r in select value from jsonb_array_elements(s->'regions') loop
      if jsonb_typeof(r)<>'object' or exists(select 1 from jsonb_object_keys(r) k where k <> all(array['id','span','blocks']))
         or coalesce(r->>'id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
         or jsonb_typeof(r->'span')<>'number' or (r->>'span')::numeric<>trunc((r->>'span')::numeric) or (r->>'span')::int not between 1 and 12
         or jsonb_typeof(r->'blocks')<>'array' then return false; end if;
      ident:=r->>'id'; if ident=any(ids) then return false; end if; ids:=array_append(ids,ident); spans:=spans+(r->>'span')::int;

      for b in select value from jsonb_array_elements(r->'blocks') loop
        blocks:=blocks+1; if blocks>500 then return false; end if;
        if jsonb_typeof(b)<>'object' or exists(select 1 from jsonb_object_keys(b) k where k <> all(array['id','type','schema_version','content','style','responsive']))
           or coalesce(b->>'id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
           or b->>'type' not in ('heading','text','image','action_group','form_reference','logo','feature_item','stat','testimonial','video','pricing_card','faq_item','divider','spacer','social_links')
           or b->>'schema_version'<>'1' or jsonb_typeof(b->'content')<>'object' then return false; end if;
        ident:=b->>'id'; if ident=any(ids) then return false; end if; ids:=array_append(ids,ident);

        -- Validate block style by applying the same allowlist/value checks used above.
        if b ? 'style' then
          if jsonb_typeof(b->'style')<>'object' or exists(select 1 from jsonb_object_keys(b->'style') k where k <> all(array['background','color','spacing','radius','content_width','align','text_variant','text_size','text_weight','font_family','max_width','border','shadow','padding_top','padding_bottom'])) then return false; end if;
          for e in select key,value from jsonb_each(b->'style') loop
            if e.key='background' and jsonb_typeof(e.value)='object' then
              bg:=e.value;
              if exists(select 1 from jsonb_object_keys(bg) k where k <> all(array['type','color','url','fit','position','overlay_color','overlay_opacity','gradient'])) then return false; end if;
              if coalesce(bg->>'type','') not in ('none','transparent','solid','image','gradient') then return false; end if;
            else
              if jsonb_typeof(e.value)<>'string' then return false; end if; t:=e.value#>>'{}';
              if e.key='align' and t not in ('start','center','end') then return false; end if;
              if e.key='text_variant' and t not in ('lead','body','small') then return false; end if;
              if e.key='text_size' and t not in ('xs','sm','md','lg','xl','2xl') then return false; end if;
              if e.key='text_weight' and t not in ('regular','medium','semibold','bold') then return false; end if;
              if e.key='font_family' and t not in ('inherit','sans','serif','mono','display') then return false; end if;
              if e.key='max_width' and t not in ('none','narrow','standard','wide') then return false; end if;
              if e.key='border' and t not in ('none','subtle','standard') then return false; end if;
              if e.key='shadow' and t not in ('none','subtle','soft','medium','elevated') then return false; end if;
              if e.key='radius' and t not in ('none','sm','md','lg','pill') then return false; end if;
              if e.key in ('padding_top','padding_bottom') and t not in ('none','xs','sm','md','lg','xl') then return false; end if;
              if e.key not in ('align','text_variant','text_size','text_weight','font_family','max_width','border','shadow','radius','padding_top','padding_bottom') and t !~ '^[a-z][a-z0-9_-]{0,47}$' then return false; end if;
            end if;
          end loop;
        end if;

        -- Content key allowlists mirror BLOCK_REGISTRY.
        if b->>'type'='heading' and (exists(select 1 from jsonb_object_keys(b->'content') k where k <> all(array['text','level'])) or jsonb_typeof(b#>'{content,text}')<>'string' or char_length(b#>>'{content,text}')>240 or (b#>>'{content,level}')::int not between 1 and 6) then return false; end if;
        if b->>'type'='text' and (exists(select 1 from jsonb_object_keys(b->'content') k where k<>'text') or jsonb_typeof(b#>'{content,text}')<>'string' or char_length(b#>>'{content,text}')>8000) then return false; end if;
        if b->>'type'='image' and exists(select 1 from jsonb_object_keys(b->'content') k where k <> all(array['source','alt','decorative','fit','aspect_ratio','radius','focal_position'])) then return false; end if;
        if b->>'type'='form_reference' and exists(select 1 from jsonb_object_keys(b->'content') k where k <> all(array['asset_id','label'])) then return false; end if;
        if b->>'type'='logo' and exists(select 1 from jsonb_object_keys(b->'content') k where k <> all(array['url','alt','width','href'])) then return false; end if;
        if b->>'type'='feature_item' and exists(select 1 from jsonb_object_keys(b->'content') k where k <> all(array['icon','title','description','href'])) then return false; end if;
        if b->>'type'='stat' and exists(select 1 from jsonb_object_keys(b->'content') k where k <> all(array['value','label','supporting_text'])) then return false; end if;
        if b->>'type'='testimonial' and exists(select 1 from jsonb_object_keys(b->'content') k where k <> all(array['quote','person_name','role_company','avatar_url'])) then return false; end if;
        if b->>'type'='video' and exists(select 1 from jsonb_object_keys(b->'content') k where k <> all(array['url','title','poster_url'])) then return false; end if;
        if b->>'type'='pricing_card' and exists(select 1 from jsonb_object_keys(b->'content') k where k <> all(array['plan_name','price','cadence','description','features','cta_label','cta_url','emphasis'])) then return false; end if;
        if b->>'type'='faq_item' and exists(select 1 from jsonb_object_keys(b->'content') k where k <> all(array['question','answer','default_open'])) then return false; end if;
        if b->>'type'='divider' and exists(select 1 from jsonb_object_keys(b->'content') k where k <> all(array['style','width','spacing'])) then return false; end if;
        if b->>'type'='spacer' and exists(select 1 from jsonb_object_keys(b->'content') k where k<>'size') then return false; end if;
        if b->>'type'='social_links' and exists(select 1 from jsonb_object_keys(b->'content') k where k<>'links') then return false; end if;

        if b->>'type'='action_group' then
          if exists(select 1 from jsonb_object_keys(b->'content') k where k<>'actions') or jsonb_typeof(b#>'{content,actions}')<>'array' or jsonb_array_length(b#>'{content,actions}') not between 1 and 2 then return false; end if;
          for a in select value from jsonb_array_elements(b#>'{content,actions}') loop
            if jsonb_typeof(a)<>'object' or exists(select 1 from jsonb_object_keys(a) k where k <> all(array['label','href','variant','size','width','radius','shadow','border','background','text_color','border_color']))
               or char_length(btrim(coalesce(a->>'label',''))) not between 1 and 80
               or char_length(coalesce(a->>'href','')) not between 1 and 2048
               or (a?'variant' and a->>'variant' not in ('primary','secondary','outline','ghost'))
               or (a?'size' and a->>'size' not in ('sm','md','lg'))
               or (a?'width' and a->>'width' not in ('auto','full'))
               or (a?'radius' and a->>'radius' not in ('none','sm','md','lg','pill'))
               or (a?'shadow' and a->>'shadow' not in ('none','subtle','soft','medium'))
               or (a?'border' and a->>'border' not in ('none','subtle','standard')) then return false; end if;
            if not (coalesce(a->>'href','') ~ '^#[^[:space:]]*$' or coalesce(a->>'href','') ~ '^mailto:[^[:space:]]+$' or coalesce(a->>'href','') ~ '^tel:\+?[0-9(). -]+$' or coalesce(a->>'href','') ~ '^https://[^[:space:]]+$') then return false; end if;
          end loop;
        end if;

        x:=b->'responsive';
        if x is not null and (jsonb_typeof(x)<>'object' or exists(select 1 from jsonb_object_keys(x) k where k <> all(array['tablet','mobile']))) then return false; end if;
      end loop;
    end loop;
    if s->>'layout'='columns' and spans<>12 then return false; end if;
  end loop;
  return true;
exception when others then return false;
end;
$$;

alter function private.builder_landing_document_v1_is_valid(jsonb) owner to postgres;
revoke all on function private.builder_landing_document_v1_is_valid(jsonb) from public, anon, authenticated;

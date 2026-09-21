-- ORVESEN Builder: FormDocumentV1 drafts + autosave RPC.
-- Adds canonical editable form assets without changing landing document semantics.

create or replace function private.builder_visual_appearance_v1_is_valid(value jsonb)
returns boolean
language plpgsql
immutable
security invoker
set search_path = ''
as $$
declare
  color_pattern constant text := '^(#[0-9a-fA-F]{6}|[a-z][a-z0-9_-]{0,47})$';
begin
  if value is null or jsonb_typeof(value) is distinct from 'object' then return false; end if;
  if exists(select 1 from jsonb_object_keys(value) key where key <> all(array['preset','surface','gradient','shadow','glow','border','radius','opacity','blur','texture','elevation','hover'])) then return false; end if;
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
    if jsonb_typeof(value->'gradient') <> 'object' or exists(select 1 from jsonb_object_keys(value->'gradient') key where key <> all(array['type','preset','color_1','color_2','color_3','angle','position','intensity'])) then return false; end if;
    if value#>>'{gradient,type}' not in ('linear','radial','highlight') or value#>>'{gradient,preset}' not in ('subtle','premium_dark','warm','cool','metallic','soft_light') then return false; end if;
    if value#>>'{gradient,angle}' is not null and (value#>>'{gradient,angle}')::integer not in (0,45,90,135,180,225,270,315) then return false; end if;
    if value#>>'{gradient,position}' is not null and value#>>'{gradient,position}' not in ('center','top','bottom','left','right') then return false; end if;
    if value#>>'{gradient,intensity}' is not null and (value#>>'{gradient,intensity}')::integer not in (0,20,40,60,80,100) then return false; end if;
    if exists(select 1 from unnest(array['color_1','color_2','color_3']) k where value->'gradient' ? k and value->'gradient'->>k !~ color_pattern) then return false; end if;
  end if;
  if value ? 'shadow' then
    if jsonb_typeof(value->'shadow') <> 'object' or exists(select 1 from jsonb_object_keys(value->'shadow') key where key <> all(array['token','color','intensity','inset'])) or value#>>'{shadow,token}' not in ('none','subtle','soft','medium','strong','floating','deep') then return false; end if;
    if value#>>'{shadow,color}' is not null and value#>>'{shadow,color}' !~ color_pattern then return false; end if;
    if value#>>'{shadow,intensity}' is not null and (value#>>'{shadow,intensity}')::integer not in (0,20,40,60,80,100) then return false; end if;
    if value#>'{shadow,inset}' is not null and jsonb_typeof(value#>'{shadow,inset}') <> 'boolean' then return false; end if;
  end if;
  if value ? 'glow' then
    if jsonb_typeof(value->'glow') <> 'object' or exists(select 1 from jsonb_object_keys(value->'glow') key where key <> all(array['token','color','intensity','position','blur'])) or value#>>'{glow,token}' not in ('none','soft','edge','radial','top','bottom','ambient') then return false; end if;
    if value#>>'{glow,color}' is not null and value#>>'{glow,color}' !~ color_pattern then return false; end if;
    if value#>>'{glow,intensity}' is not null and (value#>>'{glow,intensity}')::integer not in (0,20,40,60,80,100) then return false; end if;
    if value#>>'{glow,position}' is not null and value#>>'{glow,position}' not in ('center','top','bottom','left','right') then return false; end if;
    if value#>>'{glow,blur}' is not null and value#>>'{glow,blur}' not in ('sm','md','lg') then return false; end if;
  end if;
  return true;
exception when others then return false;
end;
$$;

create or replace function private.builder_default_form_document_v1()
returns jsonb
language sql
immutable
security invoker
set search_path = ''
as $$
  select '{
    "schema_version":1,
    "document_type":"form",
    "settings":{
      "submit_label":"Enviar",
      "success_message":"Gracias. Recibimos tu información.",
      "layout":"stack",
      "style_preset":"clean_light",
      "inherit_page_theme":false,
      "background":"#f4f3ef",
      "card_background":"#ffffff",
      "border_color":"#dedbd2",
      "radius":"lg",
      "shadow":"soft",
      "padding":"lg",
      "field_background":"#ffffff",
      "field_border":"#d8d5cc",
      "label_color":"#27251f",
      "input_color":"#171612",
      "placeholder_color":"#77736a",
      "submit_variant":"primary"
      ,"vertical_spacing":"md"
      ,"button_alignment":"start"
      ,"button_width":"auto"
      ,"appearance":{"preset":"clean","surface":"solid","shadow":{"token":"none"},"glow":{"token":"none"},"border":"subtle","radius":"md","opacity":100,"blur":"none","texture":"none","elevation":"flat","hover":"none"}
    },
    "fields":[
      {"id":"00000000-0000-4000-8000-000000000001","type":"text","label":"Nombre","placeholder":"Tu nombre","required":false,"width":"full"},
      {"id":"00000000-0000-4000-8000-000000000002","type":"email","label":"Email","placeholder":"tu@email.com","required":true,"width":"full"}
    ]
  }'::jsonb;
$$;

create or replace function private.builder_form_document_v1_is_valid(candidate jsonb)
returns boolean
language plpgsql
immutable
security invoker
set search_path = ''
as $$
declare
  field_value jsonb;
  option_value jsonb;
  ids text[] := array[]::text[];
  field_id text;
begin
  if candidate is null or jsonb_typeof(candidate) is distinct from 'object' or pg_column_size(candidate) > 262144 then return false; end if;
  if candidate->>'schema_version' is distinct from '1' or candidate->>'document_type' is distinct from 'form' then return false; end if;
  if exists (select 1 from jsonb_object_keys(candidate) key where key <> all(array['schema_version','document_type','settings','fields'])) then return false; end if;

  if jsonb_typeof(candidate->'settings') is distinct from 'object'
     or coalesce(char_length(candidate#>>'{settings,submit_label}'),0) not between 1 and 80
     or coalesce(char_length(candidate#>>'{settings,success_message}'),0) > 500 then return false; end if;

  if exists (select 1 from jsonb_object_keys(candidate->'settings') key where key <> all(array['submit_label','success_message','layout','style_preset','inherit_page_theme','background','card_background','border_color','radius','shadow','padding','field_background','field_border','label_color','input_color','placeholder_color','submit_variant','vertical_spacing','button_alignment','button_width','appearance']))
     or coalesce(candidate#>>'{settings,layout}','') not in ('stack','two_column')
     or coalesce(candidate#>>'{settings,style_preset}','') not in ('clean_light','dark','soft_card','minimal','glass')
     or jsonb_typeof(candidate#>'{settings,inherit_page_theme}') is distinct from 'boolean'
     or coalesce(candidate#>>'{settings,radius}','') not in ('none','sm','md','lg')
     or coalesce(candidate#>>'{settings,shadow}','') not in ('none','soft','elevated')
     or coalesce(candidate#>>'{settings,padding}','') not in ('sm','md','lg')
     or coalesce(candidate#>>'{settings,submit_variant}','') not in ('primary','secondary','outline')
     or coalesce(candidate#>>'{settings,vertical_spacing}','') not in ('sm','md','lg')
     or coalesce(candidate#>>'{settings,button_alignment}','') not in ('start','center','end')
     or coalesce(candidate#>>'{settings,button_width}','') not in ('auto','full')
     or (candidate->'settings' ? 'appearance' and not private.builder_visual_appearance_v1_is_valid(candidate#>'{settings,appearance}'))
     or exists (select 1 from unnest(array['background','card_background','border_color','field_background','field_border','label_color','input_color','placeholder_color']) color_key where jsonb_typeof(candidate->'settings'->color_key) is distinct from 'string' or char_length(candidate->'settings'->>color_key) > 40) then return false; end if;

  if jsonb_typeof(candidate->'fields') is distinct from 'array' or jsonb_array_length(candidate->'fields') > 60 then return false; end if;

  for field_value in select value from jsonb_array_elements(candidate->'fields') loop
    if jsonb_typeof(field_value) is distinct from 'object'
       or exists (select 1 from jsonb_object_keys(field_value) key where key <> all(array['id','type','label','placeholder','required','width','options']))
       or coalesce(field_value->>'id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       or coalesce(field_value->>'type','') not in ('text','email','tel','textarea','select','checkbox','radio','number','url')
       or jsonb_typeof(field_value->'label') is distinct from 'string'
       or char_length(field_value->>'label') > 120
       or jsonb_typeof(field_value->'placeholder') is distinct from 'string'
       or char_length(field_value->>'placeholder') > 240
       or jsonb_typeof(field_value->'required') is distinct from 'boolean'
       or coalesce(field_value->>'width','') not in ('full','half') then return false; end if;

    field_id := field_value->>'id';
    if field_id = any(ids) then return false; end if;
    ids := array_append(ids, field_id);

    if field_value->>'type' in ('select', 'radio') then
      if jsonb_typeof(field_value->'options') is distinct from 'array'
         or jsonb_array_length(field_value->'options') not between 1 and 30 then return false; end if;
      for option_value in select value from jsonb_array_elements(field_value->'options') loop
        if jsonb_typeof(option_value) is distinct from 'string' or char_length(option_value #>> '{}') > 120 then return false; end if;
      end loop;
    elsif field_value ? 'options' then
      return false;
    end if;
  end loop;

  return true;
exception when others then
  return false;
end;
$$;

revoke all on function private.builder_default_form_document_v1() from public, anon, authenticated;
revoke all on function private.builder_form_document_v1_is_valid(jsonb) from public, anon, authenticated;
revoke all on function private.builder_visual_appearance_v1_is_valid(jsonb) from public, anon, authenticated;

alter table public.builder_asset_drafts
  drop constraint if exists builder_asset_drafts_document_check;

alter table public.builder_asset_drafts
  add constraint builder_asset_drafts_document_check
  check (
    private.builder_landing_document_v1_is_valid(document)
    or private.builder_form_document_v1_is_valid(document)
  );

create or replace function public.builder_create_initial_asset_version()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  initial_document jsonb := case
    when new.asset_type = 'landing_page' then private.builder_default_landing_document_v1()
    when new.asset_type = 'form' then private.builder_default_form_document_v1()
    else '{"schema_version":1}'::jsonb
  end;
begin
  insert into public.builder_asset_versions (organization_id, asset_id, version_number, schema_version, document, created_by)
  values (new.organization_id, new.id, 1, 1, initial_document, new.created_by);

  if new.asset_type in ('landing_page','form') then
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
select asset.id, asset.organization_id, 1, private.builder_default_form_document_v1(), 1, asset.created_by
from public.builder_assets asset
where asset.asset_type = 'form'
on conflict (asset_id) do nothing;

create or replace function public.save_builder_form_draft(
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
begin
  if caller_id is null or caller_organization_id is null then
    raise exception using errcode = '42501', message = 'BUILDER_ACCESS_DENIED';
  end if;

  select asset.* into target_asset
  from public.builder_assets asset
  where asset.id = target_asset_id
    and asset.organization_id = caller_organization_id
  for update;

  if target_asset.id is null
     or not public.can_manage_organization(target_asset.organization_id) then
    raise exception using errcode = '42501', message = 'BUILDER_ACCESS_DENIED';
  end if;

  if target_asset.asset_type <> 'form' or target_asset.lifecycle <> 'draft' then
    raise exception using errcode = '23514', message = 'BUILDER_DRAFT_ASSET_INVALID';
  end if;

  if requested_schema_version <> 1
     or not private.builder_form_document_v1_is_valid(requested_document) then
    raise exception using errcode = '22023', message = 'BUILDER_FORM_DOCUMENT_INVALID';
  end if;

  update public.builder_asset_drafts draft
  set document = requested_document,
      schema_version = requested_schema_version,
      revision = draft.revision + 1,
      updated_by = caller_id,
      updated_at = now()
  where draft.asset_id = target_asset.id
    and draft.organization_id = target_asset.organization_id
    and draft.revision = expected_revision
  returning * into saved_draft;

  if saved_draft.asset_id is null then
    raise exception using errcode = '40001', message = 'BUILDER_DRAFT_CONFLICT';
  end if;

  return saved_draft;
end;
$$;

alter function public.save_builder_form_draft(uuid,bigint,integer,jsonb) owner to postgres;
revoke all on function public.save_builder_form_draft(uuid,bigint,integer,jsonb) from public, anon;
grant execute on function public.save_builder_form_draft(uuid,bigint,integer,jsonb) to authenticated;

-- ORVESEN Email Marketing V1 - Increment 2: Audiences.
--
-- Scope: static lists, tags, typed custom fields, segment definitions
-- (segment.v1 DSL, interpreted without dynamic SQL), audience preview and an
-- explicit CRM (public.clients) import. No sending, no campaigns, no UI.
--
-- Builds on 20260926160000_email_marketing_v1_foundation.sql without
-- redefining any of its objects. The only change to an Increment 1 object is
-- additive: email_audit_log.entity_type accepts the new catalog entity types.
--
-- Security model (unchanged from Increment 1):
-- * Organization and actor are derived server-side; RPCs never accept them.
-- * Authorization goes through private.email_require / private.email_can
--   (founder/admin of the active organization). Mapping:
--   preview -> 'read'; every mutation and the CRM import -> 'manage_contacts'.
-- * API roles get SELECT only (RLS), never direct DML. Catalog rows are never
--   deleted: lists, tags, fields and segments can only be archived.
-- * CRM import never records consent: imported contacts stay unsendable until
--   consent evidence is recorded through email_record_consent.

-- ---------------------------------------------------------------------------
-- Audit: accept the new entity types (additive).
-- ---------------------------------------------------------------------------

alter table public.email_audit_log
  drop constraint email_audit_log_entity_type_check,
  add constraint email_audit_log_entity_type_check check (entity_type in (
    'contact', 'consent', 'suppression',
    'list', 'tag', 'custom_field', 'segment', 'crm_import'
  ));

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.email_lists (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  name text not null check (char_length(name) between 1 and 100 and name = btrim(name) and name !~ '[[:cntrl:]]'),
  name_normalized text generated always as (lower(name)) stored,
  description text check (description is null or (char_length(description) between 1 and 500 and description !~ '[[:cntrl:]]')),
  status text not null default 'active' check (status in ('active', 'archived')),
  created_by uuid not null,
  created_at timestamptz not null default now(),
  archived_at timestamptz,
  archived_by uuid,
  unique (organization_id, id),
  check ((status = 'active') = (archived_at is null))
);

create unique index email_lists_active_name_key
  on public.email_lists (organization_id, name_normalized) where status = 'active';

create table public.email_list_members (
  organization_id uuid not null,
  list_id uuid not null,
  contact_id uuid not null,
  added_by uuid not null,
  added_at timestamptz not null default now(),
  primary key (organization_id, list_id, contact_id),
  foreign key (organization_id, list_id)
    references public.email_lists (organization_id, id) on delete restrict,
  foreign key (organization_id, contact_id)
    references public.email_contacts (organization_id, id) on delete restrict
);

create index email_list_members_contact_idx
  on public.email_list_members (organization_id, contact_id);

create table public.email_tags (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  name text not null check (char_length(name) between 1 and 50 and name = btrim(name) and name !~ '[[:cntrl:]]'),
  name_normalized text generated always as (lower(name)) stored,
  status text not null default 'active' check (status in ('active', 'archived')),
  created_by uuid not null,
  created_at timestamptz not null default now(),
  archived_at timestamptz,
  archived_by uuid,
  unique (organization_id, id),
  check ((status = 'active') = (archived_at is null))
);

create unique index email_tags_active_name_key
  on public.email_tags (organization_id, name_normalized) where status = 'active';

create table public.email_contact_tags (
  organization_id uuid not null,
  tag_id uuid not null,
  contact_id uuid not null,
  added_by uuid not null,
  added_at timestamptz not null default now(),
  primary key (organization_id, tag_id, contact_id),
  foreign key (organization_id, tag_id)
    references public.email_tags (organization_id, id) on delete restrict,
  foreign key (organization_id, contact_id)
    references public.email_contacts (organization_id, id) on delete restrict
);

create index email_contact_tags_contact_idx
  on public.email_contact_tags (organization_id, contact_id);

create table public.email_custom_field_definitions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  key text not null check (key ~ '^[a-z][a-z0-9_]{0,39}$'),
  label text not null check (char_length(label) between 1 and 80 and label = btrim(label) and label !~ '[[:cntrl:]]'),
  field_type text not null check (field_type in ('text', 'number', 'boolean', 'date', 'select')),
  options jsonb not null default '[]'::jsonb check (jsonb_typeof(options) = 'array'),
  status text not null default 'active' check (status in ('active', 'archived')),
  created_by uuid not null,
  created_at timestamptz not null default now(),
  archived_at timestamptz,
  archived_by uuid,
  unique (organization_id, id),
  unique (organization_id, key),
  check ((field_type = 'select') = (jsonb_array_length(options) > 0)),
  check (jsonb_array_length(options) <= 50),
  check ((status = 'active') = (archived_at is null))
);

create table public.email_contact_field_values (
  organization_id uuid not null,
  contact_id uuid not null,
  field_id uuid not null,
  value jsonb not null check (jsonb_typeof(value) in ('string', 'number', 'boolean') and pg_column_size(value) <= 1024),
  updated_by uuid not null,
  updated_at timestamptz not null default now(),
  primary key (organization_id, contact_id, field_id),
  foreign key (organization_id, contact_id)
    references public.email_contacts (organization_id, id) on delete restrict,
  foreign key (organization_id, field_id)
    references public.email_custom_field_definitions (organization_id, id) on delete restrict
);

create index email_contact_field_values_field_idx
  on public.email_contact_field_values (organization_id, field_id);

create table public.email_segments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  name text not null check (char_length(name) between 1 and 100 and name = btrim(name) and name !~ '[[:cntrl:]]'),
  name_normalized text generated always as (lower(name)) stored,
  description text check (description is null or (char_length(description) between 1 and 500 and description !~ '[[:cntrl:]]')),
  definition jsonb not null check (
    jsonb_typeof(definition) = 'object'
    and definition ->> 'version' = 'segment.v1'
    and pg_column_size(definition) <= 16384
  ),
  version bigint not null default 1 check (version > 0),
  status text not null default 'active' check (status in ('active', 'archived')),
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  archived_by uuid,
  unique (organization_id, id),
  check ((status = 'active') = (archived_at is null)),
  check (updated_at >= created_at)
);

create unique index email_segments_active_name_key
  on public.email_segments (organization_id, name_normalized) where status = 'active';

-- CRM link: informational, append-only. Deliberately no foreign key to
-- public.clients so the CRM schema and its deletion rules are untouched; the
-- link is validated against the caller's organization when it is created.
create table public.email_contact_crm_links (
  organization_id uuid not null references public.organizations(id) on delete restrict,
  client_id bigint not null check (client_id > 0),
  contact_id uuid not null,
  import_batch_id uuid not null,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  primary key (organization_id, client_id),
  foreign key (organization_id, contact_id)
    references public.email_contacts (organization_id, id) on delete restrict
);

create index email_contact_crm_links_contact_idx
  on public.email_contact_crm_links (organization_id, contact_id);

-- ---------------------------------------------------------------------------
-- Invariant triggers
-- ---------------------------------------------------------------------------

-- Catalog rows (lists, tags, custom fields, segments): created active, never
-- deleted, archived is terminal, identity is immutable. TG_ARGV lists extra
-- columns that are immutable for that table.
create or replace function private.email_catalog_guard()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  old_row jsonb;
  new_row jsonb := to_jsonb(new);
  immutable_column text;
begin
  if tg_op = 'DELETE' then
    raise exception using errcode = '55000', message = 'EMAIL_CATALOG_DELETE_FORBIDDEN';
  end if;
  if tg_op = 'INSERT' then
    if new_row ->> 'status' <> 'active' then
      raise exception using errcode = '55000', message = 'EMAIL_CATALOG_INVALID_INITIAL_STATE';
    end if;
    return new;
  end if;
  old_row := to_jsonb(old);
  if new_row -> 'id' is distinct from old_row -> 'id'
     or new_row -> 'organization_id' is distinct from old_row -> 'organization_id'
     or new_row -> 'created_by' is distinct from old_row -> 'created_by'
     or new_row -> 'created_at' is distinct from old_row -> 'created_at' then
    raise exception using errcode = '55000', message = 'EMAIL_CATALOG_IDENTITY_IMMUTABLE';
  end if;
  if old_row ->> 'status' = 'archived' then
    raise exception using errcode = '55000', message = 'EMAIL_CATALOG_ARCHIVED';
  end if;
  if new_row ->> 'status' is distinct from old_row ->> 'status'
     and not (old_row ->> 'status' = 'active' and new_row ->> 'status' = 'archived') then
    raise exception using errcode = '55000', message = 'EMAIL_CATALOG_INVALID_TRANSITION';
  end if;
  -- TG_ARGV is null (not an empty array) when the trigger has no arguments.
  foreach immutable_column in array coalesce(tg_argv, array[]::text[]) loop
    if new_row -> immutable_column is distinct from old_row -> immutable_column then
      raise exception using errcode = '55000', message = 'EMAIL_CATALOG_FIELD_IMMUTABLE';
    end if;
  end loop;
  return new;
end;
$$;

create trigger email_lists_guard
before insert or update or delete on public.email_lists
for each row execute function private.email_catalog_guard('name', 'description');
create trigger email_tags_guard
before insert or update or delete on public.email_tags
for each row execute function private.email_catalog_guard('name');
create trigger email_custom_field_definitions_guard
before insert or update or delete on public.email_custom_field_definitions
for each row execute function private.email_catalog_guard('key', 'label', 'field_type', 'options');
create trigger email_segments_guard
before insert or update or delete on public.email_segments
for each row execute function private.email_catalog_guard();

-- Segments: any content change bumps version exactly once.
create or replace function private.email_segments_versioning()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.name is distinct from old.name
     or new.description is distinct from old.description
     or new.definition is distinct from old.definition then
    new.version := old.version + 1;
    new.updated_at := now();
  else
    new.version := old.version;
  end if;
  return new;
end;
$$;

create trigger email_segments_versioning
before update on public.email_segments
for each row execute function private.email_segments_versioning();

create trigger email_lists_no_truncate before truncate on public.email_lists
for each statement execute function private.email_reject_mutation('EMAIL_CATALOG_DELETE_FORBIDDEN');
create trigger email_tags_no_truncate before truncate on public.email_tags
for each statement execute function private.email_reject_mutation('EMAIL_CATALOG_DELETE_FORBIDDEN');
create trigger email_custom_field_definitions_no_truncate before truncate on public.email_custom_field_definitions
for each statement execute function private.email_reject_mutation('EMAIL_CATALOG_DELETE_FORBIDDEN');
create trigger email_segments_no_truncate before truncate on public.email_segments
for each statement execute function private.email_reject_mutation('EMAIL_CATALOG_DELETE_FORBIDDEN');

create trigger email_contact_crm_links_append_only
before update or delete on public.email_contact_crm_links
for each row execute function private.email_reject_mutation('EMAIL_CRM_LINK_APPEND_ONLY');
create trigger email_contact_crm_links_no_truncate
before truncate on public.email_contact_crm_links
for each statement execute function private.email_reject_mutation('EMAIL_CRM_LINK_APPEND_ONLY');

-- Typed custom field values.
create or replace function private.email_custom_value_is_valid(
  field_type text,
  field_options jsonb,
  candidate jsonb
)
returns boolean
language plpgsql
stable
set search_path = ''
as $$
declare
  parsed_date date;
begin
  if candidate is null then
    return false;
  end if;
  case field_type
    when 'text' then
      return jsonb_typeof(candidate) = 'string'
        and char_length(candidate #>> '{}') between 1 and 500
        and (candidate #>> '{}') !~ '[[:cntrl:]]';
    when 'number' then
      return jsonb_typeof(candidate) = 'number';
    when 'boolean' then
      return jsonb_typeof(candidate) = 'boolean';
    when 'date' then
      if jsonb_typeof(candidate) <> 'string' or (candidate #>> '{}') !~ '^\d{4}-\d{2}-\d{2}$' then
        return false;
      end if;
      begin
        parsed_date := to_date(candidate #>> '{}', 'YYYY-MM-DD');
      exception when others then
        return false;
      end;
      return to_char(parsed_date, 'YYYY-MM-DD') = candidate #>> '{}';
    when 'select' then
      return jsonb_typeof(candidate) = 'string' and field_options @> jsonb_build_array(candidate);
    else
      return false;
  end case;
end;
$$;

-- Values must match their field's type and belong to the same organization.
create or replace function private.email_contact_field_values_guard()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  definition_row public.email_custom_field_definitions%rowtype;
begin
  if tg_op = 'UPDATE' and (
    new.organization_id is distinct from old.organization_id
    or new.contact_id is distinct from old.contact_id
    or new.field_id is distinct from old.field_id
  ) then
    raise exception using errcode = '55000', message = 'EMAIL_FIELD_VALUE_IDENTITY_IMMUTABLE';
  end if;
  select * into definition_row
  from public.email_custom_field_definitions as definition
  where definition.organization_id = new.organization_id and definition.id = new.field_id;
  if not found or not private.email_custom_value_is_valid(definition_row.field_type, definition_row.options, new.value) then
    raise exception using errcode = '22023', message = 'EMAIL_INVALID_FIELD_VALUE';
  end if;
  return new;
end;
$$;

create trigger email_contact_field_values_guard
before insert or update on public.email_contact_field_values
for each row execute function private.email_contact_field_values_guard();

-- ---------------------------------------------------------------------------
-- Argument helpers
-- ---------------------------------------------------------------------------

-- Required display name: trimmed, 1..max chars, no control characters.
create or replace function private.email_clean_label(raw_value text, max_length integer)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  cleaned text := btrim(raw_value);
begin
  if cleaned is null or char_length(cleaned) not between 1 and max_length or cleaned ~ '[[:cntrl:]]' then
    raise exception using errcode = '22023', message = 'EMAIL_INVALID_ARGUMENT';
  end if;
  return cleaned;
end;
$$;

-- Optional description: null/blank -> null; otherwise 1..500 chars.
create or replace function private.email_clean_description(raw_value text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  cleaned text := nullif(btrim(raw_value), '');
begin
  if cleaned is not null and (char_length(cleaned) > 500 or cleaned ~ '[[:cntrl:]]') then
    raise exception using errcode = '22023', message = 'EMAIL_INVALID_ARGUMENT';
  end if;
  return cleaned;
end;
$$;

-- Distinct, non-null id batch of 1..max_size elements.
create or replace function private.email_clean_uuid_batch(raw_ids uuid[], max_size integer)
returns uuid[]
language plpgsql
immutable
set search_path = ''
as $$
declare
  cleaned uuid[];
begin
  if raw_ids is null or array_position(raw_ids, null) is not null then
    raise exception using errcode = '22023', message = 'EMAIL_INVALID_ARGUMENT';
  end if;
  select coalesce(array_agg(distinct id), array[]::uuid[]) into cleaned from unnest(raw_ids) as id;
  if cardinality(cleaned) not between 1 and max_size then
    raise exception using errcode = '22023', message = 'EMAIL_INVALID_ARGUMENT';
  end if;
  return cleaned;
end;
$$;

create or replace function private.email_is_uuid_text(candidate text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(candidate ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$', false);
$$;

-- ---------------------------------------------------------------------------
-- Segment DSL (segment.v1)
--
-- { "version": "segment.v1", "match": "all" | "any", "rules": [ rule, ... ] }  (1..20 rules)
--   { "type": "list",  "op": "in"  | "not_in",  "list_id": uuid }
--   { "type": "tag",   "op": "has" | "not_has", "tag_id": uuid }
--   { "type": "field", "field": "locale"|"timezone"|"source"|"email_domain",
--     "op": "eq"|"neq" (value: string) | "in"|"not_in" (value: 1..50 strings) | "is_null"|"is_not_null" }
--   { "type": "custom_field", "key": text, "op": ..., "value": ... }  ops by field type:
--     text:    eq, neq, contains (string); in, not_in (strings); is_set, is_not_set
--     select:  eq, neq (option); in, not_in (options); is_set, is_not_set
--     number:  eq, neq, gt, gte, lt, lte (number); is_set, is_not_set
--     date:    eq, neq, gt, gte, lt, lte (YYYY-MM-DD); is_set, is_not_set
--     boolean: is_true, is_false, is_set, is_not_set
-- Only active contacts can ever match. Referenced lists/tags/fields must belong
-- to the caller's organization (archived ones remain valid references).
-- ---------------------------------------------------------------------------

create or replace function private.email_segment_invalid(rule_index integer, reason text)
returns void
language plpgsql
volatile
set search_path = ''
as $$
begin
  raise exception using errcode = '22023', message = 'EMAIL_INVALID_SEGMENT',
    detail = case when rule_index is null then reason else format('rule %s: %s', rule_index, reason) end;
end;
$$;

create or replace function private.email_segment_validate(target_organization_id uuid, definition jsonb)
returns void
language plpgsql
stable
set search_path = ''
as $$
declare
  rule jsonb;
  rule_index integer := 0;
  rule_type text;
  rule_op text;
  allowed_keys text[];
  definition_row public.email_custom_field_definitions%rowtype;
  value_count integer;
begin
  if definition is null or jsonb_typeof(definition) <> 'object' or pg_column_size(definition) > 16384 then
    perform private.email_segment_invalid(null, 'definition must be an object');
  end if;
  if exists (select 1 from jsonb_object_keys(definition) as k where k not in ('version', 'match', 'rules')) then
    perform private.email_segment_invalid(null, 'unknown top-level key');
  end if;
  if definition ->> 'version' is distinct from 'segment.v1' then
    perform private.email_segment_invalid(null, 'version must be segment.v1');
  end if;
  if coalesce(definition ->> 'match', '') not in ('all', 'any') then
    perform private.email_segment_invalid(null, 'match must be all or any');
  end if;
  if jsonb_typeof(definition -> 'rules') is distinct from 'array' then
    perform private.email_segment_invalid(null, 'rules must be an array of 1..20 rules');
  end if;
  if jsonb_array_length(definition -> 'rules') not between 1 and 20 then
    perform private.email_segment_invalid(null, 'rules must be an array of 1..20 rules');
  end if;

  for rule in select value from jsonb_array_elements(definition -> 'rules') loop
    rule_index := rule_index + 1;
    if jsonb_typeof(rule) <> 'object' then
      perform private.email_segment_invalid(rule_index, 'rule must be an object');
    end if;
    rule_type := rule ->> 'type';
    rule_op := rule ->> 'op';
    allowed_keys := case rule_type
      when 'list' then array['type', 'op', 'list_id']
      when 'tag' then array['type', 'op', 'tag_id']
      when 'field' then array['type', 'op', 'field', 'value']
      when 'custom_field' then array['type', 'op', 'key', 'value']
      else null end;
    if allowed_keys is null then
      perform private.email_segment_invalid(rule_index, 'unknown rule type');
    end if;
    if exists (select 1 from jsonb_object_keys(rule) as k where k <> all (allowed_keys)) then
      perform private.email_segment_invalid(rule_index, 'unknown key');
    end if;

    if rule_type = 'list' then
      if coalesce(rule_op, '') not in ('in', 'not_in') or not private.email_is_uuid_text(rule ->> 'list_id') then
        perform private.email_segment_invalid(rule_index, 'invalid list rule');
      end if;
      if not exists (select 1 from public.email_lists as list
                     where list.organization_id = target_organization_id and list.id = (rule ->> 'list_id')::uuid) then
        perform private.email_segment_invalid(rule_index, 'unknown list');
      end if;

    elsif rule_type = 'tag' then
      if coalesce(rule_op, '') not in ('has', 'not_has') or not private.email_is_uuid_text(rule ->> 'tag_id') then
        perform private.email_segment_invalid(rule_index, 'invalid tag rule');
      end if;
      if not exists (select 1 from public.email_tags as tag
                     where tag.organization_id = target_organization_id and tag.id = (rule ->> 'tag_id')::uuid) then
        perform private.email_segment_invalid(rule_index, 'unknown tag');
      end if;

    elsif rule_type = 'field' then
      if coalesce(rule ->> 'field', '') not in ('locale', 'timezone', 'source', 'email_domain') then
        perform private.email_segment_invalid(rule_index, 'unknown contact field');
      end if;
      if rule_op in ('is_null', 'is_not_null') then
        if rule ? 'value' then
          perform private.email_segment_invalid(rule_index, 'operator takes no value');
        end if;
      elsif rule_op in ('eq', 'neq') then
        if jsonb_typeof(rule -> 'value') is distinct from 'string' then
          perform private.email_segment_invalid(rule_index, 'value must be a string');
        end if;
        if char_length(rule ->> 'value') not between 1 and 254 then
          perform private.email_segment_invalid(rule_index, 'value must be a string');
        end if;
      elsif rule_op in ('in', 'not_in') then
        if jsonb_typeof(rule -> 'value') is distinct from 'array' then
          perform private.email_segment_invalid(rule_index, 'value must be 1..50 strings');
        end if;
        if jsonb_array_length(rule -> 'value') not between 1 and 50
           or exists (select 1 from jsonb_array_elements(rule -> 'value') as v
                      where jsonb_typeof(v) <> 'string' or char_length(v #>> '{}') not between 1 and 254) then
          perform private.email_segment_invalid(rule_index, 'value must be 1..50 strings');
        end if;
      else
        perform private.email_segment_invalid(rule_index, 'unknown operator');
      end if;

    else -- custom_field
      select * into definition_row
      from public.email_custom_field_definitions as field
      where field.organization_id = target_organization_id and field.key = rule ->> 'key';
      if not found then
        perform private.email_segment_invalid(rule_index, 'unknown custom field');
      end if;
      if rule_op in ('is_set', 'is_not_set') then
        if rule ? 'value' then
          perform private.email_segment_invalid(rule_index, 'operator takes no value');
        end if;
      elsif definition_row.field_type = 'boolean' then
        if coalesce(rule_op, '') not in ('is_true', 'is_false') or rule ? 'value' then
          perform private.email_segment_invalid(rule_index, 'invalid boolean rule');
        end if;
      elsif rule_op in ('in', 'not_in') and definition_row.field_type in ('text', 'select') then
        if jsonb_typeof(rule -> 'value') is distinct from 'array' then
          perform private.email_segment_invalid(rule_index, 'value must be 1..50 valid values');
        end if;
        select count(*) into value_count
        from jsonb_array_elements(rule -> 'value') as v
        where private.email_custom_value_is_valid(definition_row.field_type, definition_row.options, v);
        if jsonb_array_length(rule -> 'value') not between 1 and 50
           or value_count <> jsonb_array_length(rule -> 'value') then
          perform private.email_segment_invalid(rule_index, 'value must be 1..50 valid values');
        end if;
      elsif (rule_op in ('eq', 'neq'))
         or (rule_op = 'contains' and definition_row.field_type = 'text')
         or (rule_op in ('gt', 'gte', 'lt', 'lte') and definition_row.field_type in ('number', 'date')) then
        if not private.email_custom_value_is_valid(definition_row.field_type, definition_row.options, rule -> 'value') then
          perform private.email_segment_invalid(rule_index, 'value does not match the field type');
        end if;
      else
        perform private.email_segment_invalid(rule_index, 'operator not supported for this field type');
      end if;
    end if;
  end loop;
end;
$$;

-- Evaluates one validated rule for one contact. Unknown shapes never match.
create or replace function private.email_segment_rule_matches(
  target_organization_id uuid,
  contact_row public.email_contacts,
  rule jsonb
)
returns boolean
language plpgsql
stable
set search_path = ''
as $$
declare
  rule_op text := rule ->> 'op';
  field_value text;
  definition_row public.email_custom_field_definitions%rowtype;
  stored jsonb;
  comparison integer;
begin
  if rule ->> 'type' = 'list' then
    return (rule_op = 'in') = exists (
      select 1 from public.email_list_members as member
      where member.organization_id = target_organization_id
        and member.list_id = (rule ->> 'list_id')::uuid
        and member.contact_id = contact_row.id);

  elsif rule ->> 'type' = 'tag' then
    return (rule_op = 'has') = exists (
      select 1 from public.email_contact_tags as assignment
      where assignment.organization_id = target_organization_id
        and assignment.tag_id = (rule ->> 'tag_id')::uuid
        and assignment.contact_id = contact_row.id);

  elsif rule ->> 'type' = 'field' then
    field_value := case rule ->> 'field'
      when 'locale' then contact_row.locale
      when 'timezone' then contact_row.timezone
      when 'source' then contact_row.source
      when 'email_domain' then split_part(contact_row.email_normalized, '@', 2)
    end;
    return case rule_op
      when 'is_null' then field_value is null
      when 'is_not_null' then field_value is not null
      when 'eq' then field_value is not null and field_value = rule ->> 'value'
      when 'neq' then field_value is distinct from rule ->> 'value'
      when 'in' then field_value is not null
        and exists (select 1 from jsonb_array_elements_text(rule -> 'value') as v where v = field_value)
      when 'not_in' then field_value is null
        or not exists (select 1 from jsonb_array_elements_text(rule -> 'value') as v where v = field_value)
      else false
    end;

  elsif rule ->> 'type' = 'custom_field' then
    select * into definition_row
    from public.email_custom_field_definitions as field
    where field.organization_id = target_organization_id and field.key = rule ->> 'key';
    if not found then
      return false;
    end if;
    select field_value_row.value into stored
    from public.email_contact_field_values as field_value_row
    where field_value_row.organization_id = target_organization_id
      and field_value_row.contact_id = contact_row.id
      and field_value_row.field_id = definition_row.id;
    if rule_op = 'is_set' then
      return stored is not null;
    elsif rule_op = 'is_not_set' then
      return stored is null;
    elsif stored is null then
      return rule_op in ('neq', 'not_in');
    end if;

    if definition_row.field_type = 'boolean' then
      return (rule_op = 'is_true' and stored = 'true'::jsonb) or (rule_op = 'is_false' and stored = 'false'::jsonb);
    elsif rule_op = 'in' then
      return exists (select 1 from jsonb_array_elements(rule -> 'value') as v where v = stored);
    elsif rule_op = 'not_in' then
      return not exists (select 1 from jsonb_array_elements(rule -> 'value') as v where v = stored);
    elsif rule_op = 'contains' then
      return position(lower(rule ->> 'value') in lower(stored #>> '{}')) > 0;
    end if;

    comparison := case definition_row.field_type
      when 'number' then sign((stored #>> '{}')::numeric - (rule ->> 'value')::numeric)::integer
      when 'date' then sign(((stored #>> '{}')::date - (rule ->> 'value')::date)::numeric)::integer
      else case when stored #>> '{}' = rule ->> 'value' then 0 else null end
    end;
    return case rule_op
      when 'eq' then comparison = 0
      when 'neq' then comparison is distinct from 0
      when 'gt' then comparison > 0
      when 'gte' then comparison >= 0
      when 'lt' then comparison < 0
      when 'lte' then comparison <= 0
      else false
    end;
  end if;
  return false;
end;
$$;

create or replace function private.email_segment_matches(
  target_organization_id uuid,
  contact_row public.email_contacts,
  definition jsonb
)
returns boolean
language plpgsql
stable
set search_path = ''
as $$
declare
  rule jsonb;
  match_all boolean := definition ->> 'match' = 'all';
  rule_result boolean;
begin
  if contact_row.organization_id is distinct from target_organization_id or contact_row.status <> 'active' then
    return false;
  end if;
  for rule in select value from jsonb_array_elements(definition -> 'rules') loop
    rule_result := coalesce(private.email_segment_rule_matches(target_organization_id, contact_row, rule), false);
    if match_all and not rule_result then
      return false;
    elsif not match_all and rule_result then
      return true;
    end if;
  end loop;
  return match_all;
end;
$$;

-- Preview: counts, sendability breakdown (fail-closed via email_is_sendable)
-- and a bounded sample. Reads only; never snapshots or sends.
create or replace function private.email_preview(
  target_organization_id uuid,
  definition jsonb,
  sample_size integer
)
returns jsonb
language sql
stable
set search_path = ''
as $$
  with matched as (
    select contact.*
    from public.email_contacts as contact
    where contact.organization_id = target_organization_id
      and contact.status = 'active'
      and private.email_segment_matches(target_organization_id, contact, definition)
  ),
  evaluated as (
    select matched.id, matched.email, matched.first_name, matched.last_name,
           check_result.sendable, check_result.reason_code
    from matched
    cross join lateral private.email_is_sendable(target_organization_id, matched.id, 'marketing') as check_result
  )
  select jsonb_build_object(
    'matched', (select count(*) from evaluated),
    'sendable', (select count(*) from evaluated where sendable),
    'not_sendable_by_reason', coalesce((
      select jsonb_object_agg(reason_code, reason_count)
      from (select reason_code, count(*) as reason_count from evaluated where not sendable group by reason_code) as reasons
    ), '{}'::jsonb),
    'sample', coalesce((
      select jsonb_agg(jsonb_build_object(
        'contact_id', sample.id, 'email', sample.email, 'first_name', sample.first_name,
        'last_name', sample.last_name, 'sendable', sample.sendable, 'reason_code', sample.reason_code)
        order by sample.email)
      from (select * from evaluated order by email limit sample_size) as sample
    ), '[]'::jsonb)
  );
$$;

-- ---------------------------------------------------------------------------
-- RPCs: lists
-- ---------------------------------------------------------------------------

-- Idempotent on the active name: a repeat returns the existing list.
create or replace function public.email_create_list(
  p_name text,
  p_description text default null
)
returns table (list_id uuid, was_created boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  organization uuid := private.email_require('manage_contacts');
  cleaned_name text := private.email_clean_label(p_name, 100);
  cleaned_description text := private.email_clean_description(p_description);
  created_id uuid;
begin
  insert into public.email_lists (organization_id, name, description, created_by)
  values (organization, cleaned_name, cleaned_description, (select auth.uid()))
  on conflict (organization_id, name_normalized) where status = 'active' do nothing
  returning id into created_id;

  if created_id is not null then
    perform private.email_write_audit(organization, 'email.list.created', 'list', created_id,
      jsonb_build_object('name', cleaned_name));
    return query select created_id, true;
    return;
  end if;
  return query
    select list.id, false from public.email_lists as list
    where list.organization_id = organization and list.name_normalized = lower(cleaned_name) and list.status = 'active';
end;
$$;

create or replace function public.email_archive_list(p_list_id uuid)
returns public.email_lists
language plpgsql
security definer
set search_path = ''
as $$
declare
  organization uuid := private.email_require('manage_contacts');
  current_row public.email_lists%rowtype;
  updated_row public.email_lists%rowtype;
begin
  select * into current_row from public.email_lists as list
  where list.id = p_list_id and list.organization_id = organization for update;
  if not found then
    raise exception using errcode = '42501', message = 'EMAIL_LIST_NOT_FOUND';
  end if;
  if current_row.status = 'archived' then
    return current_row;
  end if;
  update public.email_lists as list
  set status = 'archived', archived_at = now(), archived_by = (select auth.uid())
  where list.id = current_row.id and list.organization_id = organization
  returning * into updated_row;
  perform private.email_write_audit(organization, 'email.list.archived', 'list', updated_row.id);
  return updated_row;
end;
$$;

-- Adds active contacts of the caller's organization. Ids from other
-- organizations are indistinguishable from unknown ids.
create or replace function public.email_add_list_members(p_list_id uuid, p_contact_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  organization uuid := private.email_require('manage_contacts');
  ids uuid[] := private.email_clean_uuid_batch(p_contact_ids, 1000);
  list_row public.email_lists%rowtype;
  active_count integer;
  archived_count integer;
  added_count integer;
begin
  select * into list_row from public.email_lists as list
  where list.id = p_list_id and list.organization_id = organization for update;
  if not found then
    raise exception using errcode = '42501', message = 'EMAIL_LIST_NOT_FOUND';
  end if;
  if list_row.status <> 'active' then
    raise exception using errcode = '55000', message = 'EMAIL_LIST_ARCHIVED';
  end if;

  select count(*) filter (where contact.status = 'active'), count(*) filter (where contact.status = 'archived')
  into active_count, archived_count
  from public.email_contacts as contact
  where contact.organization_id = organization and contact.id = any (ids);

  with inserted as (
    insert into public.email_list_members (organization_id, list_id, contact_id, added_by)
    select organization, list_row.id, contact.id, (select auth.uid())
    from public.email_contacts as contact
    where contact.organization_id = organization and contact.id = any (ids) and contact.status = 'active'
    on conflict do nothing
    returning 1
  )
  select count(*) into added_count from inserted;

  if added_count > 0 then
    perform private.email_write_audit(organization, 'email.list.members_added', 'list', list_row.id,
      jsonb_build_object('added', added_count));
  end if;
  return jsonb_build_object(
    'added', added_count,
    'already_member', active_count - added_count,
    'skipped_archived', archived_count,
    'skipped_not_found', cardinality(ids) - active_count - archived_count);
end;
$$;

create or replace function public.email_remove_list_members(p_list_id uuid, p_contact_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  organization uuid := private.email_require('manage_contacts');
  ids uuid[] := private.email_clean_uuid_batch(p_contact_ids, 1000);
  removed_count integer;
begin
  if not exists (select 1 from public.email_lists as list where list.id = p_list_id and list.organization_id = organization) then
    raise exception using errcode = '42501', message = 'EMAIL_LIST_NOT_FOUND';
  end if;
  with removed as (
    delete from public.email_list_members as member
    where member.organization_id = organization and member.list_id = p_list_id and member.contact_id = any (ids)
    returning 1
  )
  select count(*) into removed_count from removed;
  if removed_count > 0 then
    perform private.email_write_audit(organization, 'email.list.members_removed', 'list', p_list_id,
      jsonb_build_object('removed', removed_count));
  end if;
  return jsonb_build_object('removed', removed_count, 'not_member', cardinality(ids) - removed_count);
end;
$$;

-- ---------------------------------------------------------------------------
-- RPCs: tags
-- ---------------------------------------------------------------------------

create or replace function public.email_create_tag(p_name text)
returns table (tag_id uuid, was_created boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  organization uuid := private.email_require('manage_contacts');
  cleaned_name text := private.email_clean_label(p_name, 50);
  created_id uuid;
begin
  insert into public.email_tags (organization_id, name, created_by)
  values (organization, cleaned_name, (select auth.uid()))
  on conflict (organization_id, name_normalized) where status = 'active' do nothing
  returning id into created_id;

  if created_id is not null then
    perform private.email_write_audit(organization, 'email.tag.created', 'tag', created_id,
      jsonb_build_object('name', cleaned_name));
    return query select created_id, true;
    return;
  end if;
  return query
    select tag.id, false from public.email_tags as tag
    where tag.organization_id = organization and tag.name_normalized = lower(cleaned_name) and tag.status = 'active';
end;
$$;

create or replace function public.email_archive_tag(p_tag_id uuid)
returns public.email_tags
language plpgsql
security definer
set search_path = ''
as $$
declare
  organization uuid := private.email_require('manage_contacts');
  current_row public.email_tags%rowtype;
  updated_row public.email_tags%rowtype;
begin
  select * into current_row from public.email_tags as tag
  where tag.id = p_tag_id and tag.organization_id = organization for update;
  if not found then
    raise exception using errcode = '42501', message = 'EMAIL_TAG_NOT_FOUND';
  end if;
  if current_row.status = 'archived' then
    return current_row;
  end if;
  update public.email_tags as tag
  set status = 'archived', archived_at = now(), archived_by = (select auth.uid())
  where tag.id = current_row.id and tag.organization_id = organization
  returning * into updated_row;
  perform private.email_write_audit(organization, 'email.tag.archived', 'tag', updated_row.id);
  return updated_row;
end;
$$;

create or replace function public.email_add_contact_tags(p_tag_id uuid, p_contact_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  organization uuid := private.email_require('manage_contacts');
  ids uuid[] := private.email_clean_uuid_batch(p_contact_ids, 1000);
  tag_row public.email_tags%rowtype;
  active_count integer;
  archived_count integer;
  added_count integer;
begin
  select * into tag_row from public.email_tags as tag
  where tag.id = p_tag_id and tag.organization_id = organization for update;
  if not found then
    raise exception using errcode = '42501', message = 'EMAIL_TAG_NOT_FOUND';
  end if;
  if tag_row.status <> 'active' then
    raise exception using errcode = '55000', message = 'EMAIL_TAG_ARCHIVED';
  end if;

  select count(*) filter (where contact.status = 'active'), count(*) filter (where contact.status = 'archived')
  into active_count, archived_count
  from public.email_contacts as contact
  where contact.organization_id = organization and contact.id = any (ids);

  with inserted as (
    insert into public.email_contact_tags (organization_id, tag_id, contact_id, added_by)
    select organization, tag_row.id, contact.id, (select auth.uid())
    from public.email_contacts as contact
    where contact.organization_id = organization and contact.id = any (ids) and contact.status = 'active'
    on conflict do nothing
    returning 1
  )
  select count(*) into added_count from inserted;

  if added_count > 0 then
    perform private.email_write_audit(organization, 'email.tag.assigned', 'tag', tag_row.id,
      jsonb_build_object('added', added_count));
  end if;
  return jsonb_build_object(
    'added', added_count,
    'already_tagged', active_count - added_count,
    'skipped_archived', archived_count,
    'skipped_not_found', cardinality(ids) - active_count - archived_count);
end;
$$;

create or replace function public.email_remove_contact_tags(p_tag_id uuid, p_contact_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  organization uuid := private.email_require('manage_contacts');
  ids uuid[] := private.email_clean_uuid_batch(p_contact_ids, 1000);
  removed_count integer;
begin
  if not exists (select 1 from public.email_tags as tag where tag.id = p_tag_id and tag.organization_id = organization) then
    raise exception using errcode = '42501', message = 'EMAIL_TAG_NOT_FOUND';
  end if;
  with removed as (
    delete from public.email_contact_tags as assignment
    where assignment.organization_id = organization and assignment.tag_id = p_tag_id and assignment.contact_id = any (ids)
    returning 1
  )
  select count(*) into removed_count from removed;
  if removed_count > 0 then
    perform private.email_write_audit(organization, 'email.tag.unassigned', 'tag', p_tag_id,
      jsonb_build_object('removed', removed_count));
  end if;
  return jsonb_build_object('removed', removed_count, 'not_tagged', cardinality(ids) - removed_count);
end;
$$;

-- ---------------------------------------------------------------------------
-- RPCs: custom fields
-- ---------------------------------------------------------------------------

-- Keys are unique per organization forever (archived keys are not reused).
-- An identical repeat returns the existing field; a different definition
-- under the same key is rejected.
create or replace function public.email_create_custom_field(
  p_key text,
  p_label text,
  p_field_type text,
  p_options jsonb default '[]'::jsonb
)
returns table (field_id uuid, was_created boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  organization uuid := private.email_require('manage_contacts');
  cleaned_label text := private.email_clean_label(p_label, 80);
  cleaned_options jsonb := coalesce(p_options, '[]'::jsonb);
  created_id uuid;
  existing public.email_custom_field_definitions%rowtype;
begin
  if p_key is null or p_key !~ '^[a-z][a-z0-9_]{0,39}$'
     or p_field_type is null or p_field_type not in ('text', 'number', 'boolean', 'date', 'select') then
    raise exception using errcode = '22023', message = 'EMAIL_INVALID_ARGUMENT';
  end if;
  if jsonb_typeof(cleaned_options) <> 'array' then
    raise exception using errcode = '22023', message = 'EMAIL_INVALID_ARGUMENT';
  end if;
  if p_field_type = 'select' then
    if jsonb_array_length(cleaned_options) not between 1 and 50
       or exists (select 1 from jsonb_array_elements(cleaned_options) as option
                  where jsonb_typeof(option) <> 'string' or char_length(option #>> '{}') not between 1 and 100
                     or option #>> '{}' <> btrim(option #>> '{}') or (option #>> '{}') ~ '[[:cntrl:]]')
       or (select count(distinct option) from jsonb_array_elements(cleaned_options) as option) <> jsonb_array_length(cleaned_options) then
      raise exception using errcode = '22023', message = 'EMAIL_INVALID_ARGUMENT';
    end if;
  elsif jsonb_array_length(cleaned_options) <> 0 then
    raise exception using errcode = '22023', message = 'EMAIL_INVALID_ARGUMENT';
  end if;

  insert into public.email_custom_field_definitions (organization_id, key, label, field_type, options, created_by)
  values (organization, p_key, cleaned_label, p_field_type, cleaned_options, (select auth.uid()))
  on conflict (organization_id, key) do nothing
  returning id into created_id;

  if created_id is not null then
    perform private.email_write_audit(organization, 'email.custom_field.created', 'custom_field', created_id,
      jsonb_build_object('key', p_key, 'field_type', p_field_type));
    return query select created_id, true;
    return;
  end if;

  select * into existing from public.email_custom_field_definitions as field
  where field.organization_id = organization and field.key = p_key;
  if existing.status <> 'active' or existing.label <> cleaned_label
     or existing.field_type <> p_field_type or existing.options <> cleaned_options then
    raise exception using errcode = '23505', message = 'EMAIL_FIELD_KEY_CONFLICT';
  end if;
  return query select existing.id, false;
end;
$$;

create or replace function public.email_archive_custom_field(p_field_id uuid)
returns public.email_custom_field_definitions
language plpgsql
security definer
set search_path = ''
as $$
declare
  organization uuid := private.email_require('manage_contacts');
  current_row public.email_custom_field_definitions%rowtype;
  updated_row public.email_custom_field_definitions%rowtype;
begin
  select * into current_row from public.email_custom_field_definitions as field
  where field.id = p_field_id and field.organization_id = organization for update;
  if not found then
    raise exception using errcode = '42501', message = 'EMAIL_FIELD_NOT_FOUND';
  end if;
  if current_row.status = 'archived' then
    return current_row;
  end if;
  update public.email_custom_field_definitions as field
  set status = 'archived', archived_at = now(), archived_by = (select auth.uid())
  where field.id = current_row.id and field.organization_id = organization
  returning * into updated_row;
  perform private.email_write_audit(organization, 'email.custom_field.archived', 'custom_field', updated_row.id);
  return updated_row;
end;
$$;

-- p_values: object { field_key: value | null }. null clears the value.
-- All keys must be active fields of the caller's organization; the whole call
-- is rejected if any value is invalid.
create or replace function public.email_set_contact_fields(p_contact_id uuid, p_values jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  organization uuid := private.email_require('manage_contacts');
  actor uuid := (select auth.uid());
  contact_row public.email_contacts%rowtype;
  entry record;
  definition_row public.email_custom_field_definitions%rowtype;
  set_count integer := 0;
  cleared_count integer := 0;
  changed_keys text[] := array[]::text[];
  affected integer;
begin
  if p_values is null or jsonb_typeof(p_values) <> 'object' or p_values = '{}'::jsonb then
    raise exception using errcode = '22023', message = 'EMAIL_INVALID_ARGUMENT';
  end if;
  if (select count(*) from jsonb_object_keys(p_values)) > 50 then
    raise exception using errcode = '22023', message = 'EMAIL_INVALID_ARGUMENT';
  end if;

  select * into contact_row from public.email_contacts as contact
  where contact.id = p_contact_id and contact.organization_id = organization for update;
  if not found then
    raise exception using errcode = '42501', message = 'EMAIL_CONTACT_NOT_FOUND';
  end if;
  if contact_row.status <> 'active' then
    raise exception using errcode = '55000', message = 'EMAIL_CONTACT_ARCHIVED';
  end if;

  for entry in select key, value from jsonb_each(p_values) order by key loop
    select * into definition_row from public.email_custom_field_definitions as field
    where field.organization_id = organization and field.key = entry.key;
    if not found then
      raise exception using errcode = '22023', message = 'EMAIL_UNKNOWN_FIELD', detail = entry.key;
    end if;
    if definition_row.status <> 'active' then
      raise exception using errcode = '55000', message = 'EMAIL_FIELD_ARCHIVED', detail = entry.key;
    end if;

    if jsonb_typeof(entry.value) = 'null' then
      delete from public.email_contact_field_values as field_value
      where field_value.organization_id = organization
        and field_value.contact_id = contact_row.id
        and field_value.field_id = definition_row.id;
      get diagnostics affected = row_count;
      if affected > 0 then
        cleared_count := cleared_count + 1;
        changed_keys := array_append(changed_keys, entry.key);
      end if;
    else
      if not private.email_custom_value_is_valid(definition_row.field_type, definition_row.options, entry.value) then
        raise exception using errcode = '22023', message = 'EMAIL_INVALID_FIELD_VALUE', detail = entry.key;
      end if;
      insert into public.email_contact_field_values (organization_id, contact_id, field_id, value, updated_by)
      values (organization, contact_row.id, definition_row.id, entry.value, actor)
      on conflict (organization_id, contact_id, field_id) do update
        set value = excluded.value, updated_by = excluded.updated_by, updated_at = now()
        where public.email_contact_field_values.value is distinct from excluded.value;
      get diagnostics affected = row_count;
      if affected > 0 then
        set_count := set_count + 1;
        changed_keys := array_append(changed_keys, entry.key);
      end if;
    end if;
  end loop;

  if cardinality(changed_keys) > 0 then
    perform private.email_write_audit(organization, 'email.contact.fields_updated', 'contact', contact_row.id,
      jsonb_build_object('changed_keys', to_jsonb(changed_keys)));
  end if;
  return jsonb_build_object('set', set_count, 'cleared', cleared_count);
end;
$$;

-- ---------------------------------------------------------------------------
-- RPCs: segments and preview
-- ---------------------------------------------------------------------------

create or replace function public.email_create_segment(
  p_name text,
  p_definition jsonb,
  p_description text default null
)
returns public.email_segments
language plpgsql
security definer
set search_path = ''
as $$
declare
  organization uuid := private.email_require('manage_contacts');
  cleaned_name text := private.email_clean_label(p_name, 100);
  cleaned_description text := private.email_clean_description(p_description);
  created_row public.email_segments%rowtype;
begin
  perform private.email_segment_validate(organization, p_definition);
  if exists (select 1 from public.email_segments as segment
             where segment.organization_id = organization and segment.status = 'active'
               and segment.name_normalized = lower(cleaned_name)) then
    raise exception using errcode = '23505', message = 'EMAIL_SEGMENT_NAME_CONFLICT';
  end if;
  begin
    insert into public.email_segments (organization_id, name, description, definition, created_by)
    values (organization, cleaned_name, cleaned_description, p_definition, (select auth.uid()))
    returning * into created_row;
  exception when unique_violation then
    -- Lost a race with a concurrent create of the same active name.
    raise exception using errcode = '23505', message = 'EMAIL_SEGMENT_NAME_CONFLICT';
  end;
  perform private.email_write_audit(organization, 'email.segment.created', 'segment', created_row.id,
    jsonb_build_object('name', cleaned_name, 'rules', jsonb_array_length(p_definition -> 'rules')));
  return created_row;
end;
$$;

-- p_changes: object with any of name, description, definition.
create or replace function public.email_update_segment(
  p_segment_id uuid,
  p_changes jsonb,
  p_expected_version bigint default null
)
returns public.email_segments
language plpgsql
security definer
set search_path = ''
as $$
declare
  organization uuid := private.email_require('manage_contacts');
  current_row public.email_segments%rowtype;
  updated_row public.email_segments%rowtype;
  next_name text;
  next_description text;
  next_definition jsonb;
begin
  if p_changes is null or jsonb_typeof(p_changes) <> 'object' or p_changes = '{}'::jsonb then
    raise exception using errcode = '22023', message = 'EMAIL_INVALID_ARGUMENT';
  end if;
  if exists (select 1 from jsonb_object_keys(p_changes) as k where k not in ('name', 'description', 'definition')) then
    raise exception using errcode = '22023', message = 'EMAIL_INVALID_ARGUMENT';
  end if;

  select * into current_row from public.email_segments as segment
  where segment.id = p_segment_id and segment.organization_id = organization for update;
  if not found then
    raise exception using errcode = '42501', message = 'EMAIL_SEGMENT_NOT_FOUND';
  end if;
  if current_row.status <> 'active' then
    raise exception using errcode = '55000', message = 'EMAIL_SEGMENT_ARCHIVED';
  end if;
  if p_expected_version is not null and p_expected_version <> current_row.version then
    raise exception using errcode = '40001', message = 'EMAIL_SEGMENT_VERSION_CONFLICT';
  end if;

  next_name := case when p_changes ? 'name'
    then private.email_clean_label(p_changes ->> 'name', 100) else current_row.name end;
  next_description := case when p_changes ? 'description'
    then private.email_clean_description(p_changes ->> 'description') else current_row.description end;
  next_definition := case when p_changes ? 'definition' then p_changes -> 'definition' else current_row.definition end;
  perform private.email_segment_validate(organization, next_definition);

  if lower(next_name) <> current_row.name_normalized and exists (
    select 1 from public.email_segments as segment
    where segment.organization_id = organization and segment.status = 'active'
      and segment.name_normalized = lower(next_name) and segment.id <> current_row.id) then
    raise exception using errcode = '23505', message = 'EMAIL_SEGMENT_NAME_CONFLICT';
  end if;

  if next_name = current_row.name and next_description is not distinct from current_row.description
     and next_definition = current_row.definition then
    return current_row;
  end if;

  begin
    update public.email_segments as segment
    set name = next_name, description = next_description, definition = next_definition
    where segment.id = current_row.id and segment.organization_id = organization
    returning * into updated_row;
  exception when unique_violation then
    raise exception using errcode = '23505', message = 'EMAIL_SEGMENT_NAME_CONFLICT';
  end;
  perform private.email_write_audit(organization, 'email.segment.updated', 'segment', updated_row.id,
    jsonb_build_object('version', updated_row.version));
  return updated_row;
end;
$$;

create or replace function public.email_archive_segment(p_segment_id uuid)
returns public.email_segments
language plpgsql
security definer
set search_path = ''
as $$
declare
  organization uuid := private.email_require('manage_contacts');
  current_row public.email_segments%rowtype;
  updated_row public.email_segments%rowtype;
begin
  select * into current_row from public.email_segments as segment
  where segment.id = p_segment_id and segment.organization_id = organization for update;
  if not found then
    raise exception using errcode = '42501', message = 'EMAIL_SEGMENT_NOT_FOUND';
  end if;
  if current_row.status = 'archived' then
    return current_row;
  end if;
  update public.email_segments as segment
  set status = 'archived', archived_at = now(), archived_by = (select auth.uid())
  where segment.id = current_row.id and segment.organization_id = organization
  returning * into updated_row;
  perform private.email_write_audit(organization, 'email.segment.archived', 'segment', updated_row.id);
  return updated_row;
end;
$$;

create or replace function public.email_preview_audience(p_definition jsonb, p_sample_size integer default 10)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  organization uuid := private.email_require('read');
begin
  if p_sample_size is null or p_sample_size not between 0 and 50 then
    raise exception using errcode = '22023', message = 'EMAIL_INVALID_ARGUMENT';
  end if;
  perform private.email_segment_validate(organization, p_definition);
  return private.email_preview(organization, p_definition, p_sample_size);
end;
$$;

create or replace function public.email_preview_segment(p_segment_id uuid, p_sample_size integer default 10)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  organization uuid := private.email_require('read');
  segment_row public.email_segments%rowtype;
begin
  if p_sample_size is null or p_sample_size not between 0 and 50 then
    raise exception using errcode = '22023', message = 'EMAIL_INVALID_ARGUMENT';
  end if;
  select * into segment_row from public.email_segments as segment
  where segment.id = p_segment_id and segment.organization_id = organization;
  if not found then
    raise exception using errcode = '42501', message = 'EMAIL_SEGMENT_NOT_FOUND';
  end if;
  return jsonb_build_object('segment_id', segment_row.id, 'version', segment_row.version)
    || private.email_preview(organization, segment_row.definition, p_sample_size);
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC: explicit CRM import
-- ---------------------------------------------------------------------------

-- Creates (or links existing) email contacts from CRM clients of the caller's
-- organization. Never records consent: imported contacts are not sendable
-- until consent evidence is recorded. Clients of other organizations are
-- indistinguishable from unknown ids.
create or replace function public.email_import_contacts_from_crm(p_client_ids bigint[])
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  organization uuid := private.email_require('manage_contacts');
  actor uuid := (select auth.uid());
  batch_id uuid := gen_random_uuid();
  ids bigint[];
  client_row record;
  normalized text;
  display_name text;
  existing public.email_contacts%rowtype;
  target_contact_id uuid;
  was_created boolean;
  link_inserted integer;
  found_count integer := 0;
  created_count integer := 0;
  linked_existing_count integer := 0;
  already_linked_count integer := 0;
  no_email_count integer := 0;
  invalid_email_count integer := 0;
  archived_count integer := 0;
begin
  if p_client_ids is null or array_position(p_client_ids, null) is not null then
    raise exception using errcode = '22023', message = 'EMAIL_INVALID_ARGUMENT';
  end if;
  select coalesce(array_agg(distinct id), array[]::bigint[]) into ids from unnest(p_client_ids) as id;
  if cardinality(ids) not between 1 and 500 then
    raise exception using errcode = '22023', message = 'EMAIL_INVALID_ARGUMENT';
  end if;

  for client_row in
    select client.id, client.email, client.contact_name
    from public.clients as client
    where client.organization_id = organization and client.id = any (ids)
    order by client.id
  loop
    found_count := found_count + 1;
    if exists (select 1 from public.email_contact_crm_links as link
               where link.organization_id = organization and link.client_id = client_row.id) then
      already_linked_count := already_linked_count + 1;
      continue;
    end if;
    if nullif(btrim(client_row.email), '') is null then
      no_email_count := no_email_count + 1;
      continue;
    end if;
    normalized := private.email_normalize_address(client_row.email);
    if normalized is null then
      invalid_email_count := invalid_email_count + 1;
      continue;
    end if;

    select * into existing from public.email_contacts as contact
    where contact.organization_id = organization and contact.email_normalized = normalized;
    if found and existing.status = 'archived' then
      archived_count := archived_count + 1;
      continue;
    elsif found then
      target_contact_id := existing.id;
      was_created := false;
      linked_existing_count := linked_existing_count + 1;
    else
      display_name := nullif(btrim(left(regexp_replace(coalesce(client_row.contact_name, ''), '[[:cntrl:]]', ' ', 'g'), 100)), '');
      select created.contact_id, created.was_created into target_contact_id, was_created
      from public.email_create_contact(client_row.email, display_name, null, null, null, 'import') as created;
      if was_created then
        created_count := created_count + 1;
      else
        linked_existing_count := linked_existing_count + 1;
      end if;
    end if;

    -- A concurrent import may have linked this client meanwhile: count it as
    -- already linked instead of aborting the whole batch.
    insert into public.email_contact_crm_links (organization_id, client_id, contact_id, import_batch_id, created_by)
    values (organization, client_row.id, target_contact_id, batch_id, actor)
    on conflict (organization_id, client_id) do nothing;
    get diagnostics link_inserted = row_count;
    if link_inserted = 0 then
      already_linked_count := already_linked_count + 1;
      if was_created then
        created_count := created_count - 1;
      else
        linked_existing_count := linked_existing_count - 1;
      end if;
    end if;
  end loop;

  perform private.email_write_audit(organization, 'email.crm.import_completed', 'crm_import', batch_id,
    jsonb_build_object(
      'requested', cardinality(ids), 'created', created_count, 'linked_existing', linked_existing_count,
      'already_linked', already_linked_count, 'skipped_not_found', cardinality(ids) - found_count,
      'skipped_no_email', no_email_count, 'skipped_invalid_email', invalid_email_count,
      'skipped_archived', archived_count));
  return jsonb_build_object(
    'batch_id', batch_id,
    'requested', cardinality(ids),
    'created', created_count,
    'linked_existing', linked_existing_count,
    'already_linked', already_linked_count,
    'skipped_not_found', cardinality(ids) - found_count,
    'skipped_no_email', no_email_count,
    'skipped_invalid_email', invalid_email_count,
    'skipped_archived', archived_count,
    'consent_recorded', false);
end;
$$;

-- ---------------------------------------------------------------------------
-- Row level security (read-only for founder/admin of the active organization)
-- ---------------------------------------------------------------------------

alter table public.email_lists enable row level security;
alter table public.email_list_members enable row level security;
alter table public.email_tags enable row level security;
alter table public.email_contact_tags enable row level security;
alter table public.email_custom_field_definitions enable row level security;
alter table public.email_contact_field_values enable row level security;
alter table public.email_segments enable row level security;
alter table public.email_contact_crm_links enable row level security;

create policy email_lists_select on public.email_lists
for select to authenticated
using (organization_id = (select public.current_user_organization_id()) and (select private.email_can('read')));

create policy email_list_members_select on public.email_list_members
for select to authenticated
using (organization_id = (select public.current_user_organization_id()) and (select private.email_can('read')));

create policy email_tags_select on public.email_tags
for select to authenticated
using (organization_id = (select public.current_user_organization_id()) and (select private.email_can('read')));

create policy email_contact_tags_select on public.email_contact_tags
for select to authenticated
using (organization_id = (select public.current_user_organization_id()) and (select private.email_can('read')));

create policy email_custom_field_definitions_select on public.email_custom_field_definitions
for select to authenticated
using (organization_id = (select public.current_user_organization_id()) and (select private.email_can('read')));

create policy email_contact_field_values_select on public.email_contact_field_values
for select to authenticated
using (organization_id = (select public.current_user_organization_id()) and (select private.email_can('read')));

create policy email_segments_select on public.email_segments
for select to authenticated
using (organization_id = (select public.current_user_organization_id()) and (select private.email_can('read')));

create policy email_contact_crm_links_select on public.email_contact_crm_links
for select to authenticated
using (organization_id = (select public.current_user_organization_id()) and (select private.email_can('read')));

-- ---------------------------------------------------------------------------
-- Ownership and grants
-- ---------------------------------------------------------------------------

alter function private.email_catalog_guard() owner to postgres;
alter function private.email_segments_versioning() owner to postgres;
alter function private.email_custom_value_is_valid(text, jsonb, jsonb) owner to postgres;
alter function private.email_contact_field_values_guard() owner to postgres;
alter function private.email_clean_label(text, integer) owner to postgres;
alter function private.email_clean_description(text) owner to postgres;
alter function private.email_clean_uuid_batch(uuid[], integer) owner to postgres;
alter function private.email_is_uuid_text(text) owner to postgres;
alter function private.email_segment_invalid(integer, text) owner to postgres;
alter function private.email_segment_validate(uuid, jsonb) owner to postgres;
alter function private.email_segment_rule_matches(uuid, public.email_contacts, jsonb) owner to postgres;
alter function private.email_segment_matches(uuid, public.email_contacts, jsonb) owner to postgres;
alter function private.email_preview(uuid, jsonb, integer) owner to postgres;
alter function public.email_create_list(text, text) owner to postgres;
alter function public.email_archive_list(uuid) owner to postgres;
alter function public.email_add_list_members(uuid, uuid[]) owner to postgres;
alter function public.email_remove_list_members(uuid, uuid[]) owner to postgres;
alter function public.email_create_tag(text) owner to postgres;
alter function public.email_archive_tag(uuid) owner to postgres;
alter function public.email_add_contact_tags(uuid, uuid[]) owner to postgres;
alter function public.email_remove_contact_tags(uuid, uuid[]) owner to postgres;
alter function public.email_create_custom_field(text, text, text, jsonb) owner to postgres;
alter function public.email_archive_custom_field(uuid) owner to postgres;
alter function public.email_set_contact_fields(uuid, jsonb) owner to postgres;
alter function public.email_create_segment(text, jsonb, text) owner to postgres;
alter function public.email_update_segment(uuid, jsonb, bigint) owner to postgres;
alter function public.email_archive_segment(uuid) owner to postgres;
alter function public.email_preview_audience(jsonb, integer) owner to postgres;
alter function public.email_preview_segment(uuid, integer) owner to postgres;
alter function public.email_import_contacts_from_crm(bigint[]) owner to postgres;

revoke all on function private.email_catalog_guard() from public, anon, authenticated, service_role;
revoke all on function private.email_segments_versioning() from public, anon, authenticated, service_role;
revoke all on function private.email_custom_value_is_valid(text, jsonb, jsonb) from public, anon, authenticated, service_role;
revoke all on function private.email_contact_field_values_guard() from public, anon, authenticated, service_role;
revoke all on function private.email_clean_label(text, integer) from public, anon, authenticated, service_role;
revoke all on function private.email_clean_description(text) from public, anon, authenticated, service_role;
revoke all on function private.email_clean_uuid_batch(uuid[], integer) from public, anon, authenticated, service_role;
revoke all on function private.email_is_uuid_text(text) from public, anon, authenticated, service_role;
revoke all on function private.email_segment_invalid(integer, text) from public, anon, authenticated, service_role;
revoke all on function private.email_segment_validate(uuid, jsonb) from public, anon, authenticated, service_role;
revoke all on function private.email_segment_rule_matches(uuid, public.email_contacts, jsonb) from public, anon, authenticated, service_role;
revoke all on function private.email_segment_matches(uuid, public.email_contacts, jsonb) from public, anon, authenticated, service_role;
revoke all on function private.email_preview(uuid, jsonb, integer) from public, anon, authenticated, service_role;

revoke all on function public.email_create_list(text, text) from public, anon, authenticated, service_role;
revoke all on function public.email_archive_list(uuid) from public, anon, authenticated, service_role;
revoke all on function public.email_add_list_members(uuid, uuid[]) from public, anon, authenticated, service_role;
revoke all on function public.email_remove_list_members(uuid, uuid[]) from public, anon, authenticated, service_role;
revoke all on function public.email_create_tag(text) from public, anon, authenticated, service_role;
revoke all on function public.email_archive_tag(uuid) from public, anon, authenticated, service_role;
revoke all on function public.email_add_contact_tags(uuid, uuid[]) from public, anon, authenticated, service_role;
revoke all on function public.email_remove_contact_tags(uuid, uuid[]) from public, anon, authenticated, service_role;
revoke all on function public.email_create_custom_field(text, text, text, jsonb) from public, anon, authenticated, service_role;
revoke all on function public.email_archive_custom_field(uuid) from public, anon, authenticated, service_role;
revoke all on function public.email_set_contact_fields(uuid, jsonb) from public, anon, authenticated, service_role;
revoke all on function public.email_create_segment(text, jsonb, text) from public, anon, authenticated, service_role;
revoke all on function public.email_update_segment(uuid, jsonb, bigint) from public, anon, authenticated, service_role;
revoke all on function public.email_archive_segment(uuid) from public, anon, authenticated, service_role;
revoke all on function public.email_preview_audience(jsonb, integer) from public, anon, authenticated, service_role;
revoke all on function public.email_preview_segment(uuid, integer) from public, anon, authenticated, service_role;
revoke all on function public.email_import_contacts_from_crm(bigint[]) from public, anon, authenticated, service_role;

grant execute on function public.email_create_list(text, text) to authenticated;
grant execute on function public.email_archive_list(uuid) to authenticated;
grant execute on function public.email_add_list_members(uuid, uuid[]) to authenticated;
grant execute on function public.email_remove_list_members(uuid, uuid[]) to authenticated;
grant execute on function public.email_create_tag(text) to authenticated;
grant execute on function public.email_archive_tag(uuid) to authenticated;
grant execute on function public.email_add_contact_tags(uuid, uuid[]) to authenticated;
grant execute on function public.email_remove_contact_tags(uuid, uuid[]) to authenticated;
grant execute on function public.email_create_custom_field(text, text, text, jsonb) to authenticated;
grant execute on function public.email_archive_custom_field(uuid) to authenticated;
grant execute on function public.email_set_contact_fields(uuid, jsonb) to authenticated;
grant execute on function public.email_create_segment(text, jsonb, text) to authenticated;
grant execute on function public.email_update_segment(uuid, jsonb, bigint) to authenticated;
grant execute on function public.email_archive_segment(uuid) to authenticated;
grant execute on function public.email_preview_audience(jsonb, integer) to authenticated;
grant execute on function public.email_preview_segment(uuid, integer) to authenticated;
grant execute on function public.email_import_contacts_from_crm(bigint[]) to authenticated;

revoke all on table public.email_lists, public.email_list_members, public.email_tags,
  public.email_contact_tags, public.email_custom_field_definitions,
  public.email_contact_field_values, public.email_segments, public.email_contact_crm_links
  from public, anon, authenticated, service_role;
grant select on table public.email_lists, public.email_list_members, public.email_tags,
  public.email_contact_tags, public.email_custom_field_definitions,
  public.email_contact_field_values, public.email_segments, public.email_contact_crm_links
  to authenticated, service_role;

comment on table public.email_segments is
  'Saved audience definitions (segment.v1 DSL). Evaluated without dynamic SQL; only active contacts match.';
comment on table public.email_contact_crm_links is
  'Append-only link from CRM clients to email contacts. No foreign key to public.clients by design.';
comment on function public.email_import_contacts_from_crm(bigint[]) is
  'Explicit CRM import. Never records consent: imported contacts are not sendable until consent evidence is recorded.';

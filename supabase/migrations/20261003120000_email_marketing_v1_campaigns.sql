-- ORVESEN Email Marketing V1 - Increment 3c: campaign drafts, readiness,
-- merge-value resolution and preview input.
--
-- Scope: draft campaigns (draft -> archived) that reference a sender identity,
-- pin one template version and carry an inline segment.v1 audience; a
-- read-only readiness report; the single server-side merge-value resolver; and
-- a read-only preview-input RPC whose output is rendered by the Increment 3b
-- TypeScript renderer (supabase/functions/_shared/email/render_v1.ts). There
-- is no SQL renderer. No approval, scheduling, snapshot, jobs, provider,
-- sending, Edge Function or UI.
--
-- Builds on Increments 1, 2 and 3a. The only change to an earlier object is
-- additive: email_audit_log.entity_type accepts 'campaign'. The migration
-- refuses to run if that CHECK is not exactly the Increment 3a definition.
-- private.email_can is NOT changed (manage_campaigns exists since 3a).
--
-- Security model (unchanged):
-- * Organization and actor are derived server-side; RPCs never accept them.
-- * API roles get SELECT only (RLS), never direct DML. Rows are never deleted.
-- * References are same-organization by composite foreign keys; ids of
--   another organization behave exactly like unknown ids.

-- ---------------------------------------------------------------------------
-- Audit: accept 'campaign' (additive). Fail closed on any drift of the
-- Increment 3a definition.
-- ---------------------------------------------------------------------------

do $$
begin
  if (select pg_catalog.pg_get_constraintdef(c.oid)
      from pg_catalog.pg_constraint as c
      where c.conrelid = 'public.email_audit_log'::regclass and c.conname = 'email_audit_log_entity_type_check')
     is distinct from
     'CHECK ((entity_type = ANY (ARRAY[''contact''::text, ''consent''::text, ''suppression''::text, ''list''::text, ''tag''::text, ''custom_field''::text, ''segment''::text, ''crm_import''::text, ''sender_domain''::text, ''sender_identity''::text, ''template''::text, ''template_version''::text])))'
  then
    raise exception using errcode = '55000', message = 'EMAIL_MIGRATION_REFUSED_UNEXPECTED_STATE',
      detail = 'email_audit_log_entity_type_check is not the Increment 3a definition.';
  end if;
end;
$$;

alter table public.email_audit_log
  drop constraint email_audit_log_entity_type_check,
  add constraint email_audit_log_entity_type_check check (entity_type in (
    'contact', 'consent', 'suppression',
    'list', 'tag', 'custom_field', 'segment', 'crm_import',
    'sender_domain', 'sender_identity', 'template', 'template_version',
    'campaign'
  ));

-- ---------------------------------------------------------------------------
-- Campaigns
-- ---------------------------------------------------------------------------

create table public.email_campaigns (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  name text not null check (char_length(name) between 1 and 100 and name = btrim(name)
    and not private.email_text_has_unsafe_chars(name, false)),
  -- Same locale caveat as every Email name (see email_templates).
  name_normalized text generated always as (lower(name)) stored,
  description text check (description is null or (char_length(description) between 1 and 500
    and not private.email_text_has_unsafe_chars(description, false))),
  sender_identity_id uuid,
  template_id uuid,
  template_version integer check (template_version is null or template_version > 0),
  audience_definition jsonb check (audience_definition is null or (
    jsonb_typeof(audience_definition) = 'object'
    and audience_definition ->> 'version' = 'segment.v1'
    and pg_column_size(audience_definition) <= 16384)),
  -- Computed by the guard trigger from the PostgreSQL canonical jsonb text;
  -- never supplied by a caller.
  audience_sha256 text check (audience_sha256 is null or audience_sha256 ~ '^[0-9a-f]{64}$'),
  status text not null default 'draft' check (status in ('draft', 'archived')),
  version bigint not null default 1 check (version > 0),
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  archived_by uuid,
  unique (organization_id, id),
  foreign key (organization_id, sender_identity_id)
    references public.email_sender_identities (organization_id, id) on delete restrict,
  foreign key (organization_id, template_id, template_version)
    references public.email_template_versions (organization_id, template_id, version_number) on delete restrict,
  check ((template_id is null) = (template_version is null)),
  check ((audience_definition is null) = (audience_sha256 is null)),
  check ((status = 'draft') = (archived_at is null)),
  check ((archived_at is null) = (archived_by is null)),
  check (updated_at >= created_at)
);

create unique index email_campaigns_active_name_key
  on public.email_campaigns (organization_id, name_normalized) where status = 'draft';
create index email_campaigns_sender_idx on public.email_campaigns (organization_id, sender_identity_id);
create index email_campaigns_template_idx on public.email_campaigns (organization_id, template_id, template_version);

-- Authoritative invariants for every role (the RPCs only parse input):
-- identity and name immutable; draft -> archived only, archived terminal;
-- references must be active when they are set or changed (locked FOR SHARE so
-- a concurrent archive serializes); the audience must be valid segment.v1 for
-- the organization; audience_sha256 and version are always server-computed.
create or replace function private.email_campaigns_guard()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  sender_status text;
  template_status text;
  content_changed boolean;
begin
  if tg_op = 'DELETE' then
    raise exception using errcode = '55000', message = 'EMAIL_CAMPAIGN_DELETE_FORBIDDEN';
  end if;

  if tg_op = 'INSERT' then
    if new.status <> 'draft' or new.version <> 1 or new.archived_at is not null or new.archived_by is not null then
      raise exception using errcode = '55000', message = 'EMAIL_CAMPAIGN_INVALID_INITIAL_STATE';
    end if;
    new.updated_at := new.created_at;
    content_changed := true;
  else
    if new.id is distinct from old.id or new.organization_id is distinct from old.organization_id
       or new.created_by is distinct from old.created_by or new.created_at is distinct from old.created_at
       or new.name is distinct from old.name then
      raise exception using errcode = '55000', message = 'EMAIL_CAMPAIGN_FIELD_IMMUTABLE';
    end if;
    if old.status = 'archived' then
      raise exception using errcode = '55000', message = 'EMAIL_CAMPAIGN_ARCHIVED';
    end if;
    content_changed := new.description is distinct from old.description
      or new.sender_identity_id is distinct from old.sender_identity_id
      or new.template_id is distinct from old.template_id
      or new.template_version is distinct from old.template_version
      -- Canonical text, not jsonb equality: 1.50 and 1.5 are equal jsonb but
      -- hash differently. Any change of the audience canonical text changes
      -- audience_sha256 and bumps version; version also bumps for other real
      -- changes (description, sender, template, archive) without a hash change.
      or new.audience_definition::text is distinct from old.audience_definition::text;
    if new.status is distinct from old.status then
      if not (old.status = 'draft' and new.status = 'archived') or content_changed then
        raise exception using errcode = '55000', message = 'EMAIL_CAMPAIGN_INVALID_TRANSITION';
      end if;
    elsif new.archived_at is distinct from old.archived_at or new.archived_by is distinct from old.archived_by then
      raise exception using errcode = '55000', message = 'EMAIL_CAMPAIGN_INVALID_TRANSITION';
    end if;
  end if;

  if new.sender_identity_id is not null
     and (tg_op = 'INSERT' or new.sender_identity_id is distinct from old.sender_identity_id) then
    select identity.status into sender_status from public.email_sender_identities as identity
    where identity.organization_id = new.organization_id and identity.id = new.sender_identity_id
    for share;
    if sender_status is distinct from 'active' then
      raise exception using errcode = '55000', message = 'EMAIL_SENDER_IDENTITY_ARCHIVED';
    end if;
  end if;
  if new.template_id is not null
     and (tg_op = 'INSERT' or new.template_id is distinct from old.template_id
          or new.template_version is distinct from old.template_version) then
    select template.status into template_status from public.email_templates as template
    where template.organization_id = new.organization_id and template.id = new.template_id
    for share;
    if template_status is distinct from 'active' then
      raise exception using errcode = '55000', message = 'EMAIL_TEMPLATE_ARCHIVED';
    end if;
  end if;
  if new.audience_definition is not null
     and (tg_op = 'INSERT' or new.audience_definition::text is distinct from old.audience_definition::text) then
    perform private.email_segment_validate(new.organization_id, new.audience_definition);
  end if;

  new.audience_sha256 := case when new.audience_definition is null then null
    else encode(sha256(convert_to(new.audience_definition::text, 'UTF8')), 'hex') end;

  if tg_op = 'UPDATE' then
    if content_changed or new.status is distinct from old.status then
      new.version := old.version + 1;
      new.updated_at := now();
    else
      new.version := old.version;
      new.updated_at := old.updated_at;
    end if;
  end if;
  return new;
end;
$$;

create trigger email_campaigns_guard
before insert or update or delete on public.email_campaigns
for each row execute function private.email_campaigns_guard();
create trigger email_campaigns_no_truncate before truncate on public.email_campaigns
for each statement execute function private.email_reject_mutation('EMAIL_CAMPAIGN_DELETE_FORBIDDEN');

-- ---------------------------------------------------------------------------
-- Merge tags: non-validating path extraction and the single resolver.
-- ---------------------------------------------------------------------------

-- Distinct merge-tag paths of a stored version, bytewise (C) order. Same
-- candidate and tag grammar as private.email_merge_tag_paths (contract section
-- 5) and the same text fields (subject, preheader, text of heading, paragraph
-- and button blocks), but it never raises: a custom field archived after the
-- version was saved is still reported, so it can be resolved as absent
-- (contract section 7.1). Malformed candidates cannot exist in a stored
-- version; they are ignored here.
create or replace function private.email_template_merge_paths(subject text, preheader text, content jsonb)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select coalesce(array(
    select distinct parts[1] collate "C"
    from (
      select subject as value
      union all select preheader
      union all
      select block ->> 'text'
      from jsonb_array_elements(case when jsonb_typeof(content -> 'blocks') = 'array' then content -> 'blocks' else '[]'::jsonb end) as block
      where block ->> 'type' in ('heading', 'paragraph', 'button')
    ) as field
    cross join lateral regexp_matches(coalesce(field.value, ''), '\{\{([^{}]*)\}\}', 'g') as candidate
    cross join lateral regexp_match(candidate[1], '^ *([a-z][a-z0-9_]*\.[a-z][a-z0-9_]*) *(\|(.*))?$') as parts
    where parts is not null
    order by 1
  ), array[]::text[]);
$$;

-- The only merge-value resolver (preview now, dispatcher later). Returns the
-- Increment 3b MergeValues shape, or null when the contact or the version is
-- not in target_organization_id. Only paths the version uses are filled;
-- every other value is null. Stored values are passed through unchanged
-- (null stays null, '' stays ''). Custom fields: active field -> stored value
-- as text (value #>> '{}', contract 7.1 step 0) or null when the contact has
-- none; archived or missing field -> archived_custom (rendered as absent).
create or replace function private.email_resolve_merge_values(
  target_organization_id uuid,
  target_contact_id uuid,
  target_template_version_id uuid
)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  version_row public.email_template_versions%rowtype;
  contact_row public.email_contacts%rowtype;
  paths text[];
  organization_name text;
  custom_values jsonb := '{}'::jsonb;
  archived_keys text[] := array[]::text[];
  field_key text;
  field_row public.email_custom_field_definitions%rowtype;
begin
  select * into version_row from public.email_template_versions as template_version
  where template_version.organization_id = target_organization_id and template_version.id = target_template_version_id;
  if not found then
    return null;
  end if;
  select * into contact_row from public.email_contacts as contact
  where contact.organization_id = target_organization_id and contact.id = target_contact_id;
  if not found then
    return null;
  end if;

  paths := private.email_template_merge_paths(version_row.subject, version_row.preheader, version_row.content);
  if 'organization.name' = any (paths) then
    select organization.name into organization_name from public.organizations as organization
    where organization.id = target_organization_id;
  end if;
  for field_key in
    select substr(path, 8) from unnest(paths) as path where path like 'custom.%' order by substr(path, 8) collate "C"
  loop
    select * into field_row from public.email_custom_field_definitions as field
    where field.organization_id = target_organization_id and field.key = field_key;
    if not found or field_row.status <> 'active' then
      archived_keys := array_append(archived_keys, field_key);
    else
      custom_values := custom_values || jsonb_build_object(field_key, (
        select field_value.value #>> '{}' from public.email_contact_field_values as field_value
        where field_value.organization_id = target_organization_id
          and field_value.contact_id = contact_row.id and field_value.field_id = field_row.id));
    end if;
  end loop;

  return jsonb_build_object(
    'contact', jsonb_build_object(
      'first_name', case when 'contact.first_name' = any (paths) then contact_row.first_name end,
      'last_name', case when 'contact.last_name' = any (paths) then contact_row.last_name end,
      'email', case when 'contact.email' = any (paths) then contact_row.email end),
    'organization', jsonb_build_object('name', organization_name),
    'custom', custom_values,
    'archived_custom', to_jsonb(archived_keys));
end;
$$;

-- Fixed, system-defined preview footer (email-footer.v1, Increment 3b contract
-- section 9.4). Preview only: the URL is under the reserved .invalid TLD
-- (RFC 2606), never resolvable and never a real unsubscribe mechanism; it is
-- never stored as campaign data and never interpreted as consent state.
create or replace function private.email_preview_footer()
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object(
    'version', 'email-footer.v1',
    'organization_name', 'ORVESEN - vista previa',
    'unsubscribe_label', 'Darse de baja (vista previa)',
    'unsubscribe_url', 'https://unsubscribe.preview.invalid/orvesen-preview',
    'notice', 'Vista previa: este enlace de baja no funciona y no cambia ninguna suscripcion.');
$$;

-- ---------------------------------------------------------------------------
-- Readiness (read-only; never renders, never writes)
-- ---------------------------------------------------------------------------

create or replace function private.email_campaign_readiness_report(target_organization_id uuid, target_campaign_id uuid)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  campaign_row public.email_campaigns%rowtype;
  sender_row public.email_sender_identities%rowtype;
  template_row public.email_templates%rowtype;
  version_row public.email_template_versions%rowtype;
  blocking text[] := array[]::text[];
  warnings text[] := array[]::text[];
  audience_counts jsonb;
  preview jsonb;
  sender_json jsonb;
  template_json jsonb;
  audience_valid boolean := false;
begin
  select * into campaign_row from public.email_campaigns as campaign
  where campaign.organization_id = target_organization_id and campaign.id = target_campaign_id;
  if not found then
    return null;
  end if;
  if campaign_row.status = 'archived' then
    blocking := array_append(blocking, 'CAMPAIGN_ARCHIVED');
  end if;

  if campaign_row.sender_identity_id is null then
    blocking := array_append(blocking, 'SENDER_MISSING');
  else
    select * into sender_row from public.email_sender_identities as identity
    where identity.organization_id = target_organization_id and identity.id = campaign_row.sender_identity_id;
    sender_json := jsonb_build_object('id', sender_row.id, 'version', sender_row.version);
    if sender_row.status <> 'active' then
      blocking := array_append(blocking, 'SENDER_ARCHIVED');
    end if;
    if exists (select 1 from public.email_sender_domains as domain
               where domain.organization_id = target_organization_id and domain.id = sender_row.domain_id
                 and domain.verification_status <> 'verified') then
      warnings := array_append(warnings, 'SENDER_DOMAIN_UNVERIFIED');
    end if;
  end if;

  if campaign_row.template_id is null then
    blocking := array_append(blocking, 'TEMPLATE_MISSING');
  else
    select * into template_row from public.email_templates as template
    where template.organization_id = target_organization_id and template.id = campaign_row.template_id;
    select * into version_row from public.email_template_versions as template_version
    where template_version.organization_id = target_organization_id
      and template_version.template_id = campaign_row.template_id
      and template_version.version_number = campaign_row.template_version;
    template_json := jsonb_build_object('id', template_row.id, 'version_number', version_row.version_number,
      'content_sha256', version_row.content_sha256);
    if template_row.status <> 'active' then
      blocking := array_append(blocking, 'TEMPLATE_ARCHIVED');
    end if;
    if version_row.version_number < template_row.latest_version then
      warnings := array_append(warnings, 'TEMPLATE_VERSION_NOT_LATEST');
    end if;
    if exists (
      select 1 from unnest(private.email_template_merge_paths(version_row.subject, version_row.preheader, version_row.content)) as path
      where path like 'custom.%' and not exists (
        select 1 from public.email_custom_field_definitions as field
        where field.organization_id = target_organization_id and field.key = substr(path, 8) and field.status = 'active')
    ) then
      warnings := array_append(warnings, 'TEMPLATE_USES_ARCHIVED_FIELD');
    end if;
  end if;

  if campaign_row.audience_definition is null then
    blocking := array_append(blocking, 'AUDIENCE_MISSING');
  else
    begin
      perform private.email_segment_validate(target_organization_id, campaign_row.audience_definition);
      audience_valid := true;
    exception when sqlstate '22023' then
      blocking := array_append(blocking, 'AUDIENCE_INVALID');
    end;
    if audience_valid then
      -- Counts only: the sample (contact PII) is never requested.
      preview := private.email_preview(target_organization_id, campaign_row.audience_definition, 0);
      audience_counts := jsonb_build_object('matched', preview -> 'matched', 'sendable', preview -> 'sendable',
        'not_sendable_by_reason', preview -> 'not_sendable_by_reason');
      if (preview ->> 'matched')::bigint = 0 then
        blocking := array_append(blocking, 'AUDIENCE_EMPTY');
      elsif (preview ->> 'sendable')::bigint = 0 then
        blocking := array_append(blocking, 'AUDIENCE_NO_SENDABLE');
      end if;
    end if;
    if exists (
      select 1 from jsonb_array_elements(case when jsonb_typeof(campaign_row.audience_definition -> 'rules') = 'array'
                                              then campaign_row.audience_definition -> 'rules' else '[]'::jsonb end) as rule
      -- uuid semantics: Increment 2 accepts UUID text case-insensitively. The
      -- CASE guarantees the cast only runs on text that is a valid UUID.
      join public.email_lists as list on list.organization_id = target_organization_id
        and list.id = case when private.email_is_uuid_text(rule ->> 'list_id') then (rule ->> 'list_id')::uuid end
        and list.status = 'archived'
      where rule ->> 'type' = 'list'
    ) then
      warnings := array_append(warnings, 'AUDIENCE_REFERENCES_ARCHIVED_LIST');
    end if;
    if exists (
      select 1 from jsonb_array_elements(case when jsonb_typeof(campaign_row.audience_definition -> 'rules') = 'array'
                                              then campaign_row.audience_definition -> 'rules' else '[]'::jsonb end) as rule
      join public.email_tags as tag on tag.organization_id = target_organization_id
        and tag.id = case when private.email_is_uuid_text(rule ->> 'tag_id') then (rule ->> 'tag_id')::uuid end
        and tag.status = 'archived'
      where rule ->> 'type' = 'tag'
    ) then
      warnings := array_append(warnings, 'AUDIENCE_REFERENCES_ARCHIVED_TAG');
    end if;
  end if;

  return jsonb_build_object(
    'ready', cardinality(blocking) = 0,
    'campaign_version', campaign_row.version,
    'blocking', to_jsonb(array(select code from unnest(blocking) as code order by code collate "C")),
    'warnings', to_jsonb(array(select code from unnest(warnings) as code order by code collate "C")),
    'sender', sender_json,
    'template', template_json,
    'audience_sha256', campaign_row.audience_sha256,
    'audience', audience_counts);
end;
$$;

-- ---------------------------------------------------------------------------
-- RPCs
-- ---------------------------------------------------------------------------

-- Idempotent on the active (draft) name: a repeat returns the existing draft.
create or replace function public.email_create_campaign(
  p_name text,
  p_description text default null
)
returns table (campaign_id uuid, was_created boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  organization uuid := private.email_require('manage_campaigns');
  cleaned_name text := btrim(p_name);
  cleaned_description text := nullif(btrim(p_description), '');
  created_id uuid;
  existing_id uuid;
  attempt integer;
begin
  if cleaned_name is null or char_length(cleaned_name) not between 1 and 100
     or private.email_text_has_unsafe_chars(cleaned_name, false)
     or (cleaned_description is not null and (char_length(cleaned_description) > 500
         or private.email_text_has_unsafe_chars(cleaned_description, false))) then
    raise exception using errcode = '22023', message = 'EMAIL_INVALID_ARGUMENT';
  end if;
  for attempt in 1..3 loop
    insert into public.email_campaigns (organization_id, name, description, created_by)
    values (organization, cleaned_name, cleaned_description, (select auth.uid()))
    on conflict (organization_id, name_normalized) where status = 'draft' do nothing
    returning id into created_id;

    if created_id is not null then
      perform private.email_write_audit(organization, 'email.campaign.created', 'campaign', created_id,
        jsonb_build_object('name', cleaned_name));
      return query select created_id, true;
      return;
    end if;
    select campaign.id into existing_id from public.email_campaigns as campaign
    where campaign.organization_id = organization and campaign.name_normalized = lower(cleaned_name)
      and campaign.status = 'draft';
    if existing_id is not null then
      return query select existing_id, false;
      return;
    end if;
  end loop;
  raise exception using errcode = '40001', message = 'EMAIL_CONCURRENT_MODIFICATION';
end;
$$;

-- Patch keys: description (string|null), sender_identity_id (uuid string|null),
-- template ({template_id, version_number}|null), audience_definition
-- (segment.v1 object|null). expected_version is mandatory. A no-op returns the
-- row unchanged (no version bump, no audit).
create or replace function public.email_update_campaign(
  p_campaign_id uuid,
  p_changes jsonb,
  p_expected_version bigint
)
returns public.email_campaigns
language plpgsql
security definer
set search_path = ''
as $$
declare
  organization uuid := private.email_require('manage_campaigns');
  current_row public.email_campaigns%rowtype;
  updated_row public.email_campaigns%rowtype;
  next_description text;
  next_sender uuid;
  next_template uuid;
  next_version integer;
  next_audience jsonb;
  changed_fields text[] := array[]::text[];
begin
  if p_expected_version is null or p_changes is null or jsonb_typeof(p_changes) <> 'object' or p_changes = '{}'::jsonb then
    raise exception using errcode = '22023', message = 'EMAIL_INVALID_ARGUMENT';
  end if;
  if p_changes ? 'name' then
    raise exception using errcode = '55000', message = 'EMAIL_CAMPAIGN_NAME_IMMUTABLE';
  end if;
  if exists (
    select 1 from jsonb_each(p_changes) as change
    where change.key not in ('description', 'sender_identity_id', 'template', 'audience_definition')
       or (change.key = 'description' and jsonb_typeof(change.value) not in ('string', 'null'))
       or (change.key = 'sender_identity_id' and jsonb_typeof(change.value) <> 'null'
           and not private.email_is_uuid_text(change.value #>> '{}'))
       or (change.key = 'template' and jsonb_typeof(change.value) <> 'null' and (
             jsonb_typeof(change.value) <> 'object'
             or (select array_agg(key order by key collate "C") from jsonb_object_keys(change.value) as key)
                is distinct from array['template_id', 'version_number']
             or not private.email_is_uuid_text(change.value ->> 'template_id')
             or jsonb_typeof(change.value -> 'version_number') <> 'number'
             or (change.value ->> 'version_number') !~ '^[1-9][0-9]{0,8}$'))
       or (change.key = 'audience_definition' and jsonb_typeof(change.value) not in ('object', 'null'))
  ) then
    raise exception using errcode = '22023', message = 'EMAIL_INVALID_ARGUMENT';
  end if;

  select * into current_row from public.email_campaigns as campaign
  where campaign.id = p_campaign_id and campaign.organization_id = organization for update;
  if not found then
    raise exception using errcode = '42501', message = 'EMAIL_CAMPAIGN_NOT_FOUND';
  end if;
  if current_row.status <> 'draft' then
    raise exception using errcode = '55000', message = 'EMAIL_CAMPAIGN_ARCHIVED';
  end if;
  if p_expected_version <> current_row.version then
    raise exception using errcode = '40001', message = 'EMAIL_CAMPAIGN_VERSION_CONFLICT';
  end if;

  next_description := current_row.description;
  if p_changes ? 'description' then
    next_description := nullif(btrim(p_changes ->> 'description'), '');
    if next_description is not null and (char_length(next_description) > 500
       or private.email_text_has_unsafe_chars(next_description, false)) then
      raise exception using errcode = '22023', message = 'EMAIL_INVALID_ARGUMENT';
    end if;
  end if;
  next_sender := current_row.sender_identity_id;
  if p_changes ? 'sender_identity_id' then
    next_sender := (p_changes ->> 'sender_identity_id')::uuid;
    if next_sender is not null and not exists (
      select 1 from public.email_sender_identities as identity
      where identity.organization_id = organization and identity.id = next_sender) then
      raise exception using errcode = '42501', message = 'EMAIL_SENDER_IDENTITY_NOT_FOUND';
    end if;
  end if;
  next_template := current_row.template_id;
  next_version := current_row.template_version;
  if p_changes ? 'template' then
    next_template := (p_changes -> 'template' ->> 'template_id')::uuid;
    next_version := (p_changes -> 'template' ->> 'version_number')::integer;
    if next_template is not null and not exists (
      select 1 from public.email_template_versions as template_version
      where template_version.organization_id = organization and template_version.template_id = next_template
        and template_version.version_number = next_version) then
      raise exception using errcode = '42501', message = 'EMAIL_TEMPLATE_VERSION_NOT_FOUND';
    end if;
  end if;
  next_audience := current_row.audience_definition;
  if p_changes ? 'audience_definition' then
    next_audience := case when jsonb_typeof(p_changes -> 'audience_definition') = 'null' then null
                          else p_changes -> 'audience_definition' end;
  end if;

  if next_description is distinct from current_row.description then changed_fields := array_append(changed_fields, 'description'); end if;
  if next_sender is distinct from current_row.sender_identity_id then changed_fields := array_append(changed_fields, 'sender_identity_id'); end if;
  if next_template is distinct from current_row.template_id or next_version is distinct from current_row.template_version then
    changed_fields := array_append(changed_fields, 'template');
  end if;
  if next_audience::text is distinct from current_row.audience_definition::text then
    changed_fields := array_append(changed_fields, 'audience_definition');
  end if;
  if cardinality(changed_fields) = 0 then
    return current_row;
  end if;

  update public.email_campaigns as campaign
  set description = next_description, sender_identity_id = next_sender,
      template_id = next_template, template_version = next_version, audience_definition = next_audience
  where campaign.id = current_row.id and campaign.organization_id = organization
  returning * into updated_row;
  -- Identifiers and hashes only: never the description, the audience
  -- definition, template content, addresses or contact values.
  perform private.email_write_audit(organization, 'email.campaign.updated', 'campaign', updated_row.id,
    jsonb_strip_nulls(jsonb_build_object(
      'changed_fields', to_jsonb(changed_fields), 'version', updated_row.version,
      'sender_identity_id', case when 'sender_identity_id' = any (changed_fields) then to_jsonb(updated_row.sender_identity_id) end,
      'template_id', case when 'template' = any (changed_fields) then to_jsonb(updated_row.template_id) end,
      'template_version', case when 'template' = any (changed_fields) then to_jsonb(updated_row.template_version) end,
      'audience_sha256', case when 'audience_definition' = any (changed_fields) then to_jsonb(updated_row.audience_sha256) end)));
  return updated_row;
end;
$$;

-- Idempotent: archiving an archived campaign returns it unchanged (no audit).
create or replace function public.email_archive_campaign(p_campaign_id uuid)
returns public.email_campaigns
language plpgsql
security definer
set search_path = ''
as $$
declare
  organization uuid := private.email_require('manage_campaigns');
  current_row public.email_campaigns%rowtype;
  updated_row public.email_campaigns%rowtype;
begin
  select * into current_row from public.email_campaigns as campaign
  where campaign.id = p_campaign_id and campaign.organization_id = organization for update;
  if not found then
    raise exception using errcode = '42501', message = 'EMAIL_CAMPAIGN_NOT_FOUND';
  end if;
  if current_row.status = 'archived' then
    return current_row;
  end if;
  update public.email_campaigns as campaign
  set status = 'archived', archived_at = now(), archived_by = (select auth.uid())
  where campaign.id = current_row.id and campaign.organization_id = organization
  returning * into updated_row;
  perform private.email_write_audit(organization, 'email.campaign.archived', 'campaign', updated_row.id,
    jsonb_build_object('version', updated_row.version));
  return updated_row;
end;
$$;

-- Read-only readiness report (see private.email_campaign_readiness_report).
create or replace function public.email_campaign_readiness(p_campaign_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  organization uuid := private.email_require('read');
  report jsonb;
begin
  report := private.email_campaign_readiness_report(organization, p_campaign_id);
  if report is null then
    raise exception using errcode = '42501', message = 'EMAIL_CAMPAIGN_NOT_FOUND';
  end if;
  return report;
end;
$$;

-- Read-only preview input for one contact: the PINNED template version, the
-- resolved merge values, the contact's sendability and the fixed preview
-- footer. Rendering happens only in the Increment 3b TypeScript renderer.
create or replace function public.email_campaign_preview_input(p_campaign_id uuid, p_contact_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  organization uuid := private.email_require('read');
  campaign_row public.email_campaigns%rowtype;
  version_row public.email_template_versions%rowtype;
  merge_values jsonb;
  sendability record;
begin
  select * into campaign_row from public.email_campaigns as campaign
  where campaign.id = p_campaign_id and campaign.organization_id = organization;
  if not found then
    raise exception using errcode = '42501', message = 'EMAIL_CAMPAIGN_NOT_FOUND';
  end if;
  if campaign_row.template_id is null then
    raise exception using errcode = '55000', message = 'EMAIL_CAMPAIGN_TEMPLATE_MISSING';
  end if;
  select * into version_row from public.email_template_versions as template_version
  where template_version.organization_id = organization
    and template_version.template_id = campaign_row.template_id
    and template_version.version_number = campaign_row.template_version;
  merge_values := private.email_resolve_merge_values(organization, p_contact_id, version_row.id);
  if merge_values is null then
    raise exception using errcode = '42501', message = 'EMAIL_CONTACT_NOT_FOUND';
  end if;
  select * into sendability from private.email_is_sendable(organization, p_contact_id, 'marketing');
  return jsonb_build_object(
    'campaign_version', campaign_row.version,
    'template_version', jsonb_build_object(
      'subject', version_row.subject, 'preheader', version_row.preheader,
      'content', version_row.content, 'content_sha256', version_row.content_sha256),
    'values', merge_values,
    'contact', jsonb_build_object('sendable', sendability.sendable, 'reason_code', sendability.reason_code),
    'footer', private.email_preview_footer());
end;
$$;

-- ---------------------------------------------------------------------------
-- Row level security (read-only for founder/admin of the active organization)
-- ---------------------------------------------------------------------------

alter table public.email_campaigns enable row level security;

create policy email_campaigns_select on public.email_campaigns
for select to authenticated
using (organization_id = (select public.current_user_organization_id()) and (select private.email_can('read')));

-- ---------------------------------------------------------------------------
-- Ownership and grants
-- ---------------------------------------------------------------------------

alter function private.email_campaigns_guard() owner to postgres;
alter function private.email_template_merge_paths(text, text, jsonb) owner to postgres;
alter function private.email_resolve_merge_values(uuid, uuid, uuid) owner to postgres;
alter function private.email_preview_footer() owner to postgres;
alter function private.email_campaign_readiness_report(uuid, uuid) owner to postgres;
alter function public.email_create_campaign(text, text) owner to postgres;
alter function public.email_update_campaign(uuid, jsonb, bigint) owner to postgres;
alter function public.email_archive_campaign(uuid) owner to postgres;
alter function public.email_campaign_readiness(uuid) owner to postgres;
alter function public.email_campaign_preview_input(uuid, uuid) owner to postgres;

revoke all on function private.email_campaigns_guard() from public, anon, authenticated, service_role;
revoke all on function private.email_template_merge_paths(text, text, jsonb) from public, anon, authenticated, service_role;
revoke all on function private.email_resolve_merge_values(uuid, uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function private.email_preview_footer() from public, anon, authenticated, service_role;
revoke all on function private.email_campaign_readiness_report(uuid, uuid) from public, anon, authenticated, service_role;

revoke all on function public.email_create_campaign(text, text) from public, anon, authenticated, service_role;
revoke all on function public.email_update_campaign(uuid, jsonb, bigint) from public, anon, authenticated, service_role;
revoke all on function public.email_archive_campaign(uuid) from public, anon, authenticated, service_role;
revoke all on function public.email_campaign_readiness(uuid) from public, anon, authenticated, service_role;
revoke all on function public.email_campaign_preview_input(uuid, uuid) from public, anon, authenticated, service_role;

grant execute on function public.email_create_campaign(text, text) to authenticated;
grant execute on function public.email_update_campaign(uuid, jsonb, bigint) to authenticated;
grant execute on function public.email_archive_campaign(uuid) to authenticated;
grant execute on function public.email_campaign_readiness(uuid) to authenticated;
grant execute on function public.email_campaign_preview_input(uuid, uuid) to authenticated;

revoke all on table public.email_campaigns from public, anon, authenticated, service_role;
grant select on table public.email_campaigns to authenticated, service_role;

comment on table public.email_campaigns is
  'Campaign drafts (draft -> archived). Pin one template version, reference a sender identity, carry an inline segment.v1 audience. No approval, scheduling or sending in Increment 3c.';
comment on function public.email_campaign_readiness(uuid) is
  'Read-only readiness report with stable reason codes. Never renders, never writes, never returns contact samples.';
comment on function public.email_campaign_preview_input(uuid, uuid) is
  'Read-only render input for one contact (pinned version, resolved values, fixed preview footer). Rendered only by the Increment 3b TypeScript renderer.';

-- ORVESEN Email Marketing V1 — Increment 1: Email Domain Foundation & Safety Core.
--
-- Scope: contacts, append-only consent ledger, suppression list, immutable
-- audit log, fail-closed sendability. No provider, no sending, no campaigns.
--
-- Security model:
-- * Every row is owned by exactly one organization. Composite keys
--   (organization_id, id) make cross-tenant references structurally impossible.
-- * Organization and actor are always derived server-side from auth.uid() and
--   public.current_user_organization_id(); RPCs never accept them as input.
-- * authenticated/anon/service_role get no direct DML. Writes go through the
--   SECURITY DEFINER RPCs below; triggers enforce invariants for every role.
-- * Increment 1 access is founder/admin of the active organization only.
--   There is intentionally no platform_owner bypass in email_* objects.
-- * This ledger records consent evidence. It is not, by itself, legal
--   compliance with any jurisdiction's marketing or privacy rules.

-- ---------------------------------------------------------------------------
-- Pure helpers
-- ---------------------------------------------------------------------------

-- Canonical address used for identity, deduplication and suppression.
-- Lower-cases the whole address and trims whitespace. It deliberately does NOT
-- strip dots or +tags (provider-specific aliasing would merge distinct people).
-- ASCII only in V1: internationalized domains must arrive punycode-encoded.
-- Returns null for anything that is not a plausible single mailbox.
create or replace function private.email_normalize_address(raw_address text)
returns text
language plpgsql
immutable
strict
set search_path = ''
as $$
declare
  candidate text := lower(btrim(raw_address, E' \t\r\n'));
  local_part text;
  domain_part text;
begin
  if candidate = '' or char_length(candidate) > 254 then
    return null;
  end if;
  if candidate !~ '^[a-z0-9!#$%&''*+/=?^_`{|}~.-]+@[a-z0-9.-]+$' then
    return null;
  end if;
  local_part := split_part(candidate, '@', 1);
  domain_part := split_part(candidate, '@', 2);
  if char_length(local_part) not between 1 and 64
     or local_part like '.%' or local_part like '%.' or local_part like '%..%' then
    return null;
  end if;
  if char_length(domain_part) > 253
     or domain_part !~ '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]([a-z0-9-]{0,61}[a-z0-9])?$' then
    return null;
  end if;
  return candidate;
end;
$$;

-- Non-reversible reference to an address for audit details (no raw PII).
create or replace function private.email_address_hash(normalized_address text)
returns text
language sql
immutable
strict
set search_path = ''
as $$
  select encode(sha256(convert_to(normalized_address, 'UTF8')), 'hex');
$$;

-- ---------------------------------------------------------------------------
-- Authorization: single decision point for the email domain
-- ---------------------------------------------------------------------------

-- Membership is read directly (not via can_manage_organization) so that email
-- data never inherits a future cross-tenant bypass added to a shared helper.
-- Unknown actions fail closed.
create or replace function private.email_can(requested_action text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    requested_action in (
      'read',
      'manage_contacts',
      'manage_consent',
      'manage_suppressions',
      'lift_suppression'
    )
    and (select auth.uid()) is not null
    and exists (
      select 1
      from public.organization_memberships as membership
      where membership.user_id = (select auth.uid())
        and membership.organization_id = public.current_user_organization_id()
        and membership.role in ('founder', 'admin')
    ),
    false
  );
$$;

-- Returns the caller's active organization or raises. Used by every RPC.
create or replace function private.email_require(required_action text)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  active_organization_id uuid := public.current_user_organization_id();
begin
  if (select auth.uid()) is null
     or active_organization_id is null
     or not private.email_can(required_action) then
    raise exception using errcode = '42501', message = 'EMAIL_ACCESS_DENIED';
  end if;
  return active_organization_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.email_audit_log (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id) on delete restrict,
  actor_type text not null check (actor_type in ('user', 'system')),
  actor_user_id uuid,
  action text not null check (action ~ '^email\.[a-z_]+\.[a-z_]+$' and char_length(action) <= 80),
  entity_type text not null check (entity_type in ('contact', 'consent', 'suppression')),
  entity_id uuid not null,
  details jsonb not null default '{}'::jsonb
    check (jsonb_typeof(details) = 'object' and pg_column_size(details) <= 8192),
  created_at timestamptz not null default now(),
  check ((actor_type = 'user') = (actor_user_id is not null))
);

create index email_audit_log_org_created_idx
  on public.email_audit_log (organization_id, created_at desc, id desc);
create index email_audit_log_entity_idx
  on public.email_audit_log (organization_id, entity_type, entity_id, id desc);

create table public.email_contacts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  email text not null check (char_length(email) between 3 and 254),
  email_normalized text not null,
  first_name text check (
    first_name is null
    or (char_length(first_name) between 1 and 100 and first_name !~ '[[:cntrl:]]')
  ),
  last_name text check (
    last_name is null
    or (char_length(last_name) between 1 and 100 and last_name !~ '[[:cntrl:]]')
  ),
  locale text check (locale is null or locale ~ '^[a-z]{2,3}(-[A-Za-z0-9]{2,8}){0,3}$'),
  timezone text check (timezone is null or (char_length(timezone) <= 64 and timezone ~ '^[A-Za-z0-9_+/-]+$')),
  source text not null check (source in ('manual', 'import', 'api')),
  status text not null default 'active' check (status in ('active', 'archived')),
  version bigint not null default 1 check (version > 0),
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  archived_by uuid,
  unique (organization_id, id),
  unique (organization_id, email_normalized),
  check (email_normalized = private.email_normalize_address(email)),
  check (
    (status = 'active' and archived_at is null and archived_by is null)
    or (status = 'archived' and archived_at is not null)
  ),
  check (updated_at >= created_at)
);

create index email_contacts_org_status_idx
  on public.email_contacts (organization_id, status, created_at desc);

create table public.email_contact_consents (
  id uuid primary key default gen_random_uuid(),
  ledger_position bigint generated always as identity unique,
  organization_id uuid not null,
  contact_id uuid not null,
  email_normalized text not null,
  purpose text not null check (purpose in ('marketing')),
  action text not null check (action in ('granted', 'revoked')),
  method text not null,
  source text check (source is null or char_length(btrim(source)) between 1 and 200),
  consent_text text check (consent_text is null or char_length(btrim(consent_text)) between 1 and 5000),
  consent_text_version text check (
    consent_text_version is null or char_length(btrim(consent_text_version)) between 1 and 64
  ),
  reason text check (reason is null or char_length(btrim(reason)) between 1 and 1000),
  evidence jsonb not null default '{}'::jsonb
    check (jsonb_typeof(evidence) = 'object' and pg_column_size(evidence) <= 8192),
  occurred_at timestamptz not null,
  recorded_at timestamptz not null default now(),
  actor_type text not null check (actor_type in ('user', 'system')),
  recorded_by uuid,
  idempotency_key text check (idempotency_key is null or idempotency_key ~ '^[A-Za-z0-9._:-]{8,128}$'),
  request_hash text check (request_hash is null or request_hash ~ '^[0-9a-f]{64}$'),
  unique (organization_id, id),
  unique (organization_id, idempotency_key),
  foreign key (organization_id, contact_id)
    references public.email_contacts (organization_id, id) on delete restrict,
  -- Evidence shape: a grant is only representable with its full evidence.
  check (
    (
      action = 'granted'
      and method in ('manual_entry', 'written', 'verbal', 'import_attestation', 'external_form')
      and source is not null
      and consent_text is not null
      and consent_text_version is not null
      and reason is null
    )
    or (
      action = 'revoked'
      and method in ('user_request', 'manual_entry', 'written', 'verbal')
      and consent_text is null
      and consent_text_version is null
    )
  ),
  check ((actor_type = 'user') = (recorded_by is not null)),
  check ((idempotency_key is null) = (request_hash is null)),
  check (occurred_at <= recorded_at + interval '5 minutes'),
  check (occurred_at >= timestamptz '2000-01-01 00:00:00+00')
);

create index email_contact_consents_contact_idx
  on public.email_contact_consents (organization_id, contact_id, purpose, ledger_position desc);
create index email_contact_consents_address_idx
  on public.email_contact_consents (organization_id, email_normalized, purpose, ledger_position desc);

-- Suppression is keyed by address, not by contact, so it survives contact
-- archival and applies to any future contact with the same address.
create table public.email_suppressions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  email_normalized text not null,
  contact_id uuid,
  reason text not null check (reason in (
    'unsubscribed', 'hard_bounce', 'complaint', 'manual', 'invalid_address', 'legal_request'
  )),
  source text not null check (source in ('manual', 'consent_revocation', 'system')),
  note text check (note is null or char_length(btrim(note)) between 1 and 1000),
  actor_type text not null check (actor_type in ('user', 'system')),
  created_by uuid,
  created_at timestamptz not null default now(),
  lifted_at timestamptz,
  lifted_by uuid,
  lift_reason text,
  unique (organization_id, id),
  foreign key (organization_id, contact_id)
    references public.email_contacts (organization_id, id) on delete restrict,
  check (email_normalized = private.email_normalize_address(email_normalized)),
  check ((actor_type = 'user') = (created_by is not null)),
  check (
    (lifted_at is null and lifted_by is null and lift_reason is null)
    or (
      lifted_at is not null and lifted_by is not null
      and char_length(btrim(lift_reason)) between 10 and 1000
      and lifted_at >= created_at
    )
  )
);

create unique index email_suppressions_active_address_key
  on public.email_suppressions (organization_id, email_normalized)
  where lifted_at is null;
create index email_suppressions_org_created_idx
  on public.email_suppressions (organization_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Invariant triggers (apply to every role, including service_role)
-- ---------------------------------------------------------------------------

create or replace function private.email_reject_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception using errcode = '55000', message = tg_argv[0];
end;
$$;

create trigger email_audit_log_immutable
before update or delete on public.email_audit_log
for each row execute function private.email_reject_mutation('EMAIL_AUDIT_IMMUTABLE');
create trigger email_audit_log_no_truncate
before truncate on public.email_audit_log
for each statement execute function private.email_reject_mutation('EMAIL_AUDIT_IMMUTABLE');

create trigger email_contact_consents_append_only
before update or delete on public.email_contact_consents
for each row execute function private.email_reject_mutation('EMAIL_CONSENT_LEDGER_APPEND_ONLY');
create trigger email_contact_consents_no_truncate
before truncate on public.email_contact_consents
for each statement execute function private.email_reject_mutation('EMAIL_CONSENT_LEDGER_APPEND_ONLY');

create trigger email_contacts_no_truncate
before truncate on public.email_contacts
for each statement execute function private.email_reject_mutation('EMAIL_CONTACT_DELETE_FORBIDDEN');
create trigger email_suppressions_no_truncate
before truncate on public.email_suppressions
for each statement execute function private.email_reject_mutation('EMAIL_SUPPRESSION_DELETE_FORBIDDEN');

-- Contacts: identity is immutable, archived is terminal in V1, no deletes.
create or replace function private.email_contacts_guard()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception using errcode = '55000', message = 'EMAIL_CONTACT_DELETE_FORBIDDEN';
  end if;
  if tg_op = 'INSERT' then
    if new.status <> 'active' or new.version <> 1 then
      raise exception using errcode = '55000', message = 'EMAIL_CONTACT_INVALID_INITIAL_STATE';
    end if;
    return new;
  end if;
  if new.id is distinct from old.id
     or new.organization_id is distinct from old.organization_id
     or new.email is distinct from old.email
     or new.email_normalized is distinct from old.email_normalized
     or new.source is distinct from old.source
     or new.created_at is distinct from old.created_at
     or new.created_by is distinct from old.created_by then
    raise exception using errcode = '55000', message = 'EMAIL_CONTACT_IDENTITY_IMMUTABLE';
  end if;
  if old.status = 'archived' then
    raise exception using errcode = '55000', message = 'EMAIL_CONTACT_ARCHIVED';
  end if;
  if new.status is distinct from old.status
     and not (old.status = 'active' and new.status = 'archived') then
    raise exception using errcode = '55000', message = 'EMAIL_CONTACT_INVALID_TRANSITION';
  end if;
  new.version := old.version + 1;
  new.updated_at := now();
  return new;
end;
$$;

create trigger email_contacts_guard
before insert or update or delete on public.email_contacts
for each row execute function private.email_contacts_guard();

-- Consents: the ledger entry must describe the contact's own address, and a
-- grant can only be recorded for an active contact. Revocation is always
-- accepted so an opt-out can never be blocked by contact state.
create or replace function private.email_contact_consents_guard()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  contact_row public.email_contacts%rowtype;
begin
  select * into contact_row
  from public.email_contacts as contact
  where contact.organization_id = new.organization_id
    and contact.id = new.contact_id;
  if not found or contact_row.email_normalized is distinct from new.email_normalized then
    raise exception using errcode = '55000', message = 'EMAIL_CONSENT_ADDRESS_MISMATCH';
  end if;
  if new.action = 'granted' and contact_row.status <> 'active' then
    raise exception using errcode = '55000', message = 'EMAIL_CONTACT_ARCHIVED';
  end if;
  return new;
end;
$$;

create trigger email_contact_consents_guard
before insert on public.email_contact_consents
for each row execute function private.email_contact_consents_guard();

-- Suppressions: created active, lifted at most once, otherwise immutable.
create or replace function private.email_suppressions_guard()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception using errcode = '55000', message = 'EMAIL_SUPPRESSION_DELETE_FORBIDDEN';
  end if;
  if tg_op = 'INSERT' then
    if new.lifted_at is not null then
      raise exception using errcode = '55000', message = 'EMAIL_SUPPRESSION_INVALID_INITIAL_STATE';
    end if;
    if new.contact_id is not null and not exists (
      select 1 from public.email_contacts as contact
      where contact.organization_id = new.organization_id
        and contact.id = new.contact_id
        and contact.email_normalized = new.email_normalized
    ) then
      raise exception using errcode = '55000', message = 'EMAIL_SUPPRESSION_CONTACT_MISMATCH';
    end if;
    return new;
  end if;
  if old.lifted_at is not null then
    raise exception using errcode = '55000', message = 'EMAIL_SUPPRESSION_ALREADY_LIFTED';
  end if;
  if new.id is distinct from old.id
     or new.organization_id is distinct from old.organization_id
     or new.email_normalized is distinct from old.email_normalized
     or new.contact_id is distinct from old.contact_id
     or new.reason is distinct from old.reason
     or new.source is distinct from old.source
     or new.note is distinct from old.note
     or new.actor_type is distinct from old.actor_type
     or new.created_by is distinct from old.created_by
     or new.created_at is distinct from old.created_at
     or new.lifted_at is null then
    raise exception using errcode = '55000', message = 'EMAIL_SUPPRESSION_IMMUTABLE';
  end if;
  return new;
end;
$$;

create trigger email_suppressions_guard
before insert or update or delete on public.email_suppressions
for each row execute function private.email_suppressions_guard();

-- ---------------------------------------------------------------------------
-- Internal writers (never granted to API roles)
-- ---------------------------------------------------------------------------

create or replace function private.email_write_audit(
  target_organization_id uuid,
  audit_action text,
  target_entity_type text,
  target_entity_id uuid,
  audit_details jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
begin
  insert into public.email_audit_log (
    organization_id, actor_type, actor_user_id, action, entity_type, entity_id, details
  ) values (
    target_organization_id,
    case when actor is null then 'system' else 'user' end,
    actor,
    audit_action,
    target_entity_type,
    target_entity_id,
    coalesce(audit_details, '{}'::jsonb)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Sendability (fail closed). For future server-side dispatch only.
-- ---------------------------------------------------------------------------

-- Takes an explicit organization because it is meant for trusted server-side
-- callers; it is therefore not executable by any API role. Any missing or
-- inconsistent piece of evidence yields sendable = false.
create or replace function private.email_is_sendable(
  target_organization_id uuid,
  target_contact_id uuid,
  target_purpose text default 'marketing'
)
returns table (
  sendable boolean,
  reason_code text,
  suppression_reason text,
  consent_id uuid
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  contact_row public.email_contacts%rowtype;
  active_suppression public.email_suppressions%rowtype;
  latest_consent public.email_contact_consents%rowtype;
begin
  if target_organization_id is null or target_contact_id is null
     or target_purpose is distinct from 'marketing' then
    return query select false, 'INVALID_REQUEST'::text, null::text, null::uuid;
    return;
  end if;

  select * into contact_row
  from public.email_contacts as contact
  where contact.organization_id = target_organization_id
    and contact.id = target_contact_id;
  if not found then
    return query select false, 'CONTACT_NOT_FOUND'::text, null::text, null::uuid;
    return;
  end if;
  if contact_row.status <> 'active' then
    return query select false, 'CONTACT_NOT_ACTIVE'::text, null::text, null::uuid;
    return;
  end if;
  if private.email_normalize_address(contact_row.email) is distinct from contact_row.email_normalized then
    return query select false, 'ADDRESS_INVALID'::text, null::text, null::uuid;
    return;
  end if;

  select * into active_suppression
  from public.email_suppressions as suppression
  where suppression.organization_id = target_organization_id
    and suppression.email_normalized = contact_row.email_normalized
    and suppression.lifted_at is null
  limit 1;
  if found then
    return query select false, 'SUPPRESSED'::text, active_suppression.reason, null::uuid;
    return;
  end if;

  select * into latest_consent
  from public.email_contact_consents as consent
  where consent.organization_id = target_organization_id
    and consent.contact_id = contact_row.id
    and consent.purpose = target_purpose
  order by consent.ledger_position desc
  limit 1;
  if not found then
    return query select false, 'CONSENT_MISSING'::text, null::text, null::uuid;
    return;
  end if;
  if latest_consent.action <> 'granted' then
    return query select false, 'CONSENT_REVOKED'::text, null::text, latest_consent.id;
    return;
  end if;
  if latest_consent.email_normalized is distinct from contact_row.email_normalized
     or nullif(btrim(coalesce(latest_consent.source, '')), '') is null
     or nullif(btrim(coalesce(latest_consent.consent_text, '')), '') is null
     or nullif(btrim(coalesce(latest_consent.consent_text_version, '')), '') is null
     or latest_consent.occurred_at is null
     or latest_consent.occurred_at > now() then
    return query select false, 'CONSENT_EVIDENCE_INCOMPLETE'::text, null::text, latest_consent.id;
    return;
  end if;

  return query select true, 'SENDABLE'::text, null::text, latest_consent.id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Argument helpers
-- ---------------------------------------------------------------------------

create or replace function private.email_clean_name(raw_value text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  cleaned text := nullif(btrim(raw_value), '');
begin
  if cleaned is not null and (char_length(cleaned) > 100 or cleaned ~ '[[:cntrl:]]') then
    raise exception using errcode = '22023', message = 'EMAIL_INVALID_ARGUMENT';
  end if;
  return cleaned;
end;
$$;

create or replace function private.email_clean_locale(raw_value text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  cleaned text := nullif(btrim(raw_value), '');
begin
  if cleaned is not null and cleaned !~ '^[a-z]{2,3}(-[A-Za-z0-9]{2,8}){0,3}$' then
    raise exception using errcode = '22023', message = 'EMAIL_INVALID_ARGUMENT';
  end if;
  return cleaned;
end;
$$;

create or replace function private.email_clean_timezone(raw_value text)
returns text
language plpgsql
stable
set search_path = ''
as $$
declare
  cleaned text := nullif(btrim(raw_value), '');
begin
  if cleaned is not null and (
    char_length(cleaned) > 64
    or not exists (select 1 from pg_catalog.pg_timezone_names as tz where tz.name = cleaned)
  ) then
    raise exception using errcode = '22023', message = 'EMAIL_INVALID_ARGUMENT';
  end if;
  return cleaned;
end;
$$;

create or replace function private.email_request_hash(payload jsonb)
returns text
language sql
immutable
strict
set search_path = ''
as $$
  select encode(sha256(convert_to(payload::text, 'UTF8')), 'hex');
$$;

-- ---------------------------------------------------------------------------
-- RPCs
-- ---------------------------------------------------------------------------

-- Idempotent on the normalized address: a repeat returns the existing contact
-- with was_created = false and does not modify it.
create or replace function public.email_create_contact(
  p_email text,
  p_first_name text default null,
  p_last_name text default null,
  p_locale text default null,
  p_timezone text default null,
  p_source text default 'manual'
)
returns table (contact_id uuid, was_created boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  organization uuid := private.email_require('manage_contacts');
  actor uuid := (select auth.uid());
  normalized text := private.email_normalize_address(p_email);
  cleaned_first_name text := private.email_clean_name(p_first_name);
  cleaned_last_name text := private.email_clean_name(p_last_name);
  cleaned_locale text := private.email_clean_locale(p_locale);
  cleaned_timezone text := private.email_clean_timezone(p_timezone);
  created_id uuid;
  existing public.email_contacts%rowtype;
begin
  if normalized is null then
    raise exception using errcode = '22023', message = 'EMAIL_INVALID_ADDRESS';
  end if;
  if p_source is null or p_source not in ('manual', 'import', 'api') then
    raise exception using errcode = '22023', message = 'EMAIL_INVALID_ARGUMENT';
  end if;

  insert into public.email_contacts (
    organization_id, email, email_normalized, first_name, last_name,
    locale, timezone, source, created_by
  ) values (
    organization, btrim(p_email, E' \t\r\n'), normalized, cleaned_first_name, cleaned_last_name,
    cleaned_locale, cleaned_timezone, p_source, actor
  )
  on conflict (organization_id, email_normalized) do nothing
  returning id into created_id;

  if created_id is not null then
    perform private.email_write_audit(
      organization, 'email.contact.created', 'contact', created_id,
      jsonb_build_object('source', p_source, 'address_hash', private.email_address_hash(normalized))
    );
    return query select created_id, true;
    return;
  end if;

  select * into existing
  from public.email_contacts as contact
  where contact.organization_id = organization
    and contact.email_normalized = normalized;
  if existing.status = 'archived' then
    raise exception using errcode = '55000', message = 'EMAIL_CONTACT_ARCHIVED';
  end if;
  return query select existing.id, false;
end;
$$;

-- p_changes: JSON object with any of first_name, last_name, locale, timezone.
-- A key with null clears the field. The address cannot be changed.
create or replace function public.email_update_contact(
  p_contact_id uuid,
  p_changes jsonb,
  p_expected_version bigint default null
)
returns public.email_contacts
language plpgsql
security definer
set search_path = ''
as $$
declare
  organization uuid := private.email_require('manage_contacts');
  current_row public.email_contacts%rowtype;
  updated_row public.email_contacts%rowtype;
  next_first_name text;
  next_last_name text;
  next_locale text;
  next_timezone text;
  changed_fields text[] := array[]::text[];
begin
  if p_changes is null or jsonb_typeof(p_changes) <> 'object' or p_changes = '{}'::jsonb then
    raise exception using errcode = '22023', message = 'EMAIL_INVALID_ARGUMENT';
  end if;
  if exists (
    select 1 from jsonb_each(p_changes) as change
    where change.key not in ('first_name', 'last_name', 'locale', 'timezone')
       or jsonb_typeof(change.value) not in ('string', 'null')
  ) then
    raise exception using errcode = '22023', message = 'EMAIL_INVALID_ARGUMENT';
  end if;

  select * into current_row
  from public.email_contacts as contact
  where contact.id = p_contact_id and contact.organization_id = organization
  for update;
  if not found then
    raise exception using errcode = '42501', message = 'EMAIL_CONTACT_NOT_FOUND';
  end if;
  if current_row.status <> 'active' then
    raise exception using errcode = '55000', message = 'EMAIL_CONTACT_ARCHIVED';
  end if;
  if p_expected_version is not null and p_expected_version <> current_row.version then
    raise exception using errcode = '40001', message = 'EMAIL_CONTACT_VERSION_CONFLICT';
  end if;

  next_first_name := case when p_changes ? 'first_name'
    then private.email_clean_name(p_changes ->> 'first_name') else current_row.first_name end;
  next_last_name := case when p_changes ? 'last_name'
    then private.email_clean_name(p_changes ->> 'last_name') else current_row.last_name end;
  next_locale := case when p_changes ? 'locale'
    then private.email_clean_locale(p_changes ->> 'locale') else current_row.locale end;
  next_timezone := case when p_changes ? 'timezone'
    then private.email_clean_timezone(p_changes ->> 'timezone') else current_row.timezone end;

  if next_first_name is distinct from current_row.first_name then changed_fields := array_append(changed_fields, 'first_name'); end if;
  if next_last_name is distinct from current_row.last_name then changed_fields := array_append(changed_fields, 'last_name'); end if;
  if next_locale is distinct from current_row.locale then changed_fields := array_append(changed_fields, 'locale'); end if;
  if next_timezone is distinct from current_row.timezone then changed_fields := array_append(changed_fields, 'timezone'); end if;

  if cardinality(changed_fields) = 0 then
    return current_row;
  end if;

  update public.email_contacts as contact
  set first_name = next_first_name,
      last_name = next_last_name,
      locale = next_locale,
      timezone = next_timezone
  where contact.id = current_row.id and contact.organization_id = organization
  returning * into updated_row;

  perform private.email_write_audit(
    organization, 'email.contact.updated', 'contact', updated_row.id,
    jsonb_build_object('changed_fields', to_jsonb(changed_fields), 'version', updated_row.version)
  );
  return updated_row;
end;
$$;

create or replace function public.email_archive_contact(
  p_contact_id uuid,
  p_reason text default null
)
returns public.email_contacts
language plpgsql
security definer
set search_path = ''
as $$
declare
  organization uuid := private.email_require('manage_contacts');
  current_row public.email_contacts%rowtype;
  updated_row public.email_contacts%rowtype;
  cleaned_reason text := nullif(btrim(p_reason), '');
begin
  if cleaned_reason is not null and char_length(cleaned_reason) > 1000 then
    raise exception using errcode = '22023', message = 'EMAIL_INVALID_ARGUMENT';
  end if;

  select * into current_row
  from public.email_contacts as contact
  where contact.id = p_contact_id and contact.organization_id = organization
  for update;
  if not found then
    raise exception using errcode = '42501', message = 'EMAIL_CONTACT_NOT_FOUND';
  end if;
  if current_row.status = 'archived' then
    return current_row;
  end if;

  update public.email_contacts as contact
  set status = 'archived', archived_at = now(), archived_by = (select auth.uid())
  where contact.id = current_row.id and contact.organization_id = organization
  returning * into updated_row;

  perform private.email_write_audit(
    organization, 'email.contact.archived', 'contact', updated_row.id,
    jsonb_strip_nulls(jsonb_build_object('reason', cleaned_reason))
  );
  return updated_row;
end;
$$;

-- Records a consent grant with its evidence. Idempotent when an
-- idempotency key is supplied: an identical replay returns the original entry,
-- a different payload under the same key is rejected.
create or replace function public.email_record_consent(
  p_contact_id uuid,
  p_method text,
  p_source text,
  p_consent_text text,
  p_consent_text_version text,
  p_occurred_at timestamptz,
  p_evidence jsonb default '{}'::jsonb,
  p_purpose text default 'marketing',
  p_idempotency_key text default null
)
returns table (consent_id uuid, was_created boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  organization uuid := private.email_require('manage_consent');
  actor uuid := (select auth.uid());
  contact_row public.email_contacts%rowtype;
  evidence_payload jsonb := coalesce(p_evidence, '{}'::jsonb);
  payload_hash text;
  created_id uuid;
  existing public.email_contact_consents%rowtype;
  latest_revocation_at timestamptz;
begin
  if p_purpose is distinct from 'marketing'
     or p_method is null
     or p_method not in ('manual_entry', 'written', 'verbal', 'import_attestation', 'external_form')
     or nullif(btrim(p_source), '') is null or char_length(btrim(p_source)) > 200
     or nullif(btrim(p_consent_text), '') is null or char_length(btrim(p_consent_text)) > 5000
     or nullif(btrim(p_consent_text_version), '') is null or char_length(btrim(p_consent_text_version)) > 64
     or p_occurred_at is null
     or p_occurred_at > now() + interval '5 minutes'
     or p_occurred_at < timestamptz '2000-01-01 00:00:00+00'
     or jsonb_typeof(evidence_payload) <> 'object'
     or pg_column_size(evidence_payload) > 8192
     or (p_idempotency_key is not null and p_idempotency_key !~ '^[A-Za-z0-9._:-]{8,128}$') then
    raise exception using errcode = '22023', message = 'EMAIL_INVALID_ARGUMENT';
  end if;

  select * into contact_row
  from public.email_contacts as contact
  where contact.id = p_contact_id and contact.organization_id = organization
  for update;
  if not found then
    raise exception using errcode = '42501', message = 'EMAIL_CONTACT_NOT_FOUND';
  end if;

  if p_idempotency_key is not null then
    -- Timestamps are hashed as epoch seconds so the hash is session-timezone independent.
    payload_hash := private.email_request_hash(jsonb_build_object(
      'operation', 'grant', 'contact_id', contact_row.id, 'purpose', p_purpose,
      'method', p_method, 'source', btrim(p_source), 'consent_text', btrim(p_consent_text),
      'consent_text_version', btrim(p_consent_text_version),
      'occurred_at', extract(epoch from p_occurred_at), 'evidence', evidence_payload
    ));
    select * into existing
    from public.email_contact_consents as consent
    where consent.organization_id = organization and consent.idempotency_key = p_idempotency_key;
    if found then
      if existing.request_hash is distinct from payload_hash then
        raise exception using errcode = '22023', message = 'EMAIL_IDEMPOTENCY_CONFLICT';
      end if;
      return query select existing.id, false;
      return;
    end if;
  end if;

  if contact_row.status <> 'active' then
    raise exception using errcode = '55000', message = 'EMAIL_CONTACT_ARCHIVED';
  end if;

  -- Re-consent must happen after the most recent revocation; a backdated
  -- grant cannot silently override an opt-out.
  select max(consent.occurred_at) into latest_revocation_at
  from public.email_contact_consents as consent
  where consent.organization_id = organization
    and consent.contact_id = contact_row.id
    and consent.purpose = p_purpose
    and consent.action = 'revoked';
  if latest_revocation_at is not null and p_occurred_at <= latest_revocation_at then
    raise exception using errcode = '55000', message = 'EMAIL_CONSENT_PREDATES_REVOCATION';
  end if;

  insert into public.email_contact_consents (
    organization_id, contact_id, email_normalized, purpose, action, method, source,
    consent_text, consent_text_version, evidence, occurred_at, actor_type, recorded_by,
    idempotency_key, request_hash
  ) values (
    organization, contact_row.id, contact_row.email_normalized, p_purpose, 'granted', p_method,
    btrim(p_source), btrim(p_consent_text), btrim(p_consent_text_version), evidence_payload,
    p_occurred_at, 'user', actor, p_idempotency_key, payload_hash
  )
  on conflict (organization_id, idempotency_key) do nothing
  returning id into created_id;

  if created_id is null then
    select * into existing
    from public.email_contact_consents as consent
    where consent.organization_id = organization and consent.idempotency_key = p_idempotency_key;
    if existing.request_hash is distinct from payload_hash then
      raise exception using errcode = '22023', message = 'EMAIL_IDEMPOTENCY_CONFLICT';
    end if;
    return query select existing.id, false;
    return;
  end if;

  perform private.email_write_audit(
    organization, 'email.consent.granted', 'consent', created_id,
    jsonb_build_object('contact_id', contact_row.id, 'purpose', p_purpose, 'method', p_method,
                       'consent_text_version', btrim(p_consent_text_version))
  );
  return query select created_id, true;
end;
$$;

-- Records a revocation and ensures an active suppression for the address.
-- Always accepted for archived contacts: an opt-out must never be blocked.
create or replace function public.email_revoke_consent(
  p_contact_id uuid,
  p_method text,
  p_reason text default null,
  p_occurred_at timestamptz default null,
  p_purpose text default 'marketing',
  p_idempotency_key text default null
)
returns table (consent_id uuid, was_created boolean, suppression_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  organization uuid := private.email_require('manage_consent');
  actor uuid := (select auth.uid());
  contact_row public.email_contacts%rowtype;
  cleaned_reason text := nullif(btrim(p_reason), '');
  effective_occurred_at timestamptz := coalesce(p_occurred_at, now());
  payload_hash text;
  created_id uuid;
  existing public.email_contact_consents%rowtype;
  created_suppression_id uuid;
  active_suppression_id uuid;
begin
  if p_purpose is distinct from 'marketing'
     or p_method is null
     or p_method not in ('user_request', 'manual_entry', 'written', 'verbal')
     or (cleaned_reason is not null and char_length(cleaned_reason) > 1000)
     or effective_occurred_at > now() + interval '5 minutes'
     or effective_occurred_at < timestamptz '2000-01-01 00:00:00+00'
     or (p_idempotency_key is not null and p_idempotency_key !~ '^[A-Za-z0-9._:-]{8,128}$') then
    raise exception using errcode = '22023', message = 'EMAIL_INVALID_ARGUMENT';
  end if;

  select * into contact_row
  from public.email_contacts as contact
  where contact.id = p_contact_id and contact.organization_id = organization
  for update;
  if not found then
    raise exception using errcode = '42501', message = 'EMAIL_CONTACT_NOT_FOUND';
  end if;

  if p_idempotency_key is not null then
    -- occurred_at defaults to now() and is therefore hashed only when explicit.
    payload_hash := private.email_request_hash(jsonb_build_object(
      'operation', 'revoke', 'contact_id', contact_row.id, 'purpose', p_purpose,
      'method', p_method, 'reason', cleaned_reason,
      'occurred_at', extract(epoch from p_occurred_at)
    ));
  end if;

  insert into public.email_contact_consents (
    organization_id, contact_id, email_normalized, purpose, action, method, reason,
    occurred_at, actor_type, recorded_by, idempotency_key, request_hash
  ) values (
    organization, contact_row.id, contact_row.email_normalized, p_purpose, 'revoked', p_method,
    cleaned_reason, effective_occurred_at, 'user', actor, p_idempotency_key, payload_hash
  )
  on conflict (organization_id, idempotency_key) do nothing
  returning id into created_id;

  if created_id is null then
    -- Replay: report the original entry and the current suppression, but do
    -- not re-suppress an address that was legitimately lifted since then.
    select * into existing
    from public.email_contact_consents as consent
    where consent.organization_id = organization and consent.idempotency_key = p_idempotency_key;
    if existing.request_hash is distinct from payload_hash then
      raise exception using errcode = '22023', message = 'EMAIL_IDEMPOTENCY_CONFLICT';
    end if;
    select suppression.id into active_suppression_id
    from public.email_suppressions as suppression
    where suppression.organization_id = organization
      and suppression.email_normalized = contact_row.email_normalized
      and suppression.lifted_at is null;
    return query select existing.id, false, active_suppression_id;
    return;
  end if;

  insert into public.email_suppressions (
    organization_id, email_normalized, contact_id, reason, source, actor_type, created_by
  ) values (
    organization, contact_row.email_normalized, contact_row.id, 'unsubscribed',
    'consent_revocation', 'user', actor
  )
  on conflict (organization_id, email_normalized) where lifted_at is null do nothing
  returning id into created_suppression_id;

  select suppression.id into active_suppression_id
  from public.email_suppressions as suppression
  where suppression.organization_id = organization
    and suppression.email_normalized = contact_row.email_normalized
    and suppression.lifted_at is null;

  perform private.email_write_audit(
    organization, 'email.consent.revoked', 'consent', created_id,
    jsonb_build_object('contact_id', contact_row.id, 'purpose', p_purpose, 'method', p_method)
  );
  if created_suppression_id is not null then
    perform private.email_write_audit(
      organization, 'email.suppression.created', 'suppression', created_suppression_id,
      jsonb_build_object('reason', 'unsubscribed', 'source', 'consent_revocation',
                         'address_hash', private.email_address_hash(contact_row.email_normalized))
    );
  end if;

  return query select created_id, true, active_suppression_id;
end;
$$;

-- Idempotent per address: while an active suppression exists, a repeat call
-- returns it with was_created = false (its reason is not changed).
create or replace function public.email_add_suppression(
  p_email text,
  p_reason text,
  p_note text default null
)
returns table (suppression_id uuid, was_created boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  organization uuid := private.email_require('manage_suppressions');
  actor uuid := (select auth.uid());
  normalized text := private.email_normalize_address(p_email);
  cleaned_note text := nullif(btrim(p_note), '');
  linked_contact_id uuid;
  created_id uuid;
  existing_id uuid;
begin
  if normalized is null then
    raise exception using errcode = '22023', message = 'EMAIL_INVALID_ADDRESS';
  end if;
  if p_reason is null
     or p_reason not in ('unsubscribed', 'hard_bounce', 'complaint', 'manual', 'invalid_address', 'legal_request')
     or (cleaned_note is not null and char_length(cleaned_note) > 1000) then
    raise exception using errcode = '22023', message = 'EMAIL_INVALID_ARGUMENT';
  end if;

  select contact.id into linked_contact_id
  from public.email_contacts as contact
  where contact.organization_id = organization and contact.email_normalized = normalized;

  insert into public.email_suppressions (
    organization_id, email_normalized, contact_id, reason, source, note, actor_type, created_by
  ) values (
    organization, normalized, linked_contact_id, p_reason, 'manual', cleaned_note, 'user', actor
  )
  on conflict (organization_id, email_normalized) where lifted_at is null do nothing
  returning id into created_id;

  if created_id is not null then
    perform private.email_write_audit(
      organization, 'email.suppression.created', 'suppression', created_id,
      jsonb_build_object('reason', p_reason, 'source', 'manual',
                         'address_hash', private.email_address_hash(normalized))
    );
    return query select created_id, true;
    return;
  end if;

  select suppression.id into existing_id
  from public.email_suppressions as suppression
  where suppression.organization_id = organization
    and suppression.email_normalized = normalized
    and suppression.lifted_at is null;
  return query select existing_id, false;
end;
$$;

-- Lifting rules (V1):
-- * complaint and legal_request suppressions cannot be lifted.
-- * unsubscribed requires a consent grant that both occurred and was recorded
--   after the suppression and is still the latest consent event for that address.
-- * everything else requires founder/admin and a written reason.
create or replace function public.email_lift_suppression(
  p_suppression_id uuid,
  p_reason text
)
returns public.email_suppressions
language plpgsql
security definer
set search_path = ''
as $$
declare
  organization uuid := private.email_require('lift_suppression');
  current_row public.email_suppressions%rowtype;
  updated_row public.email_suppressions%rowtype;
  cleaned_reason text := nullif(btrim(p_reason), '');
  latest_consent public.email_contact_consents%rowtype;
begin
  if cleaned_reason is null or char_length(cleaned_reason) not between 10 and 1000 then
    raise exception using errcode = '22023', message = 'EMAIL_INVALID_ARGUMENT';
  end if;

  select * into current_row
  from public.email_suppressions as suppression
  where suppression.id = p_suppression_id and suppression.organization_id = organization
  for update;
  if not found then
    raise exception using errcode = '42501', message = 'EMAIL_SUPPRESSION_NOT_FOUND';
  end if;
  if current_row.lifted_at is not null then
    raise exception using errcode = '55000', message = 'EMAIL_SUPPRESSION_ALREADY_LIFTED';
  end if;
  if current_row.reason in ('complaint', 'legal_request') then
    raise exception using errcode = '55000', message = 'EMAIL_SUPPRESSION_NOT_LIFTABLE';
  end if;
  if current_row.reason = 'unsubscribed' then
    select * into latest_consent
    from public.email_contact_consents as consent
    where consent.organization_id = organization
      and consent.email_normalized = current_row.email_normalized
      and consent.purpose = 'marketing'
    order by consent.ledger_position desc
    limit 1;
    if not found
       or latest_consent.action <> 'granted'
       or latest_consent.recorded_at <= current_row.created_at
       or latest_consent.occurred_at <= current_row.created_at then
      raise exception using errcode = '55000', message = 'EMAIL_SUPPRESSION_REQUIRES_NEW_CONSENT';
    end if;
  end if;

  update public.email_suppressions as suppression
  set lifted_at = now(), lifted_by = (select auth.uid()), lift_reason = cleaned_reason
  where suppression.id = current_row.id and suppression.organization_id = organization
  returning * into updated_row;

  perform private.email_write_audit(
    organization, 'email.suppression.lifted', 'suppression', updated_row.id,
    jsonb_build_object('reason', current_row.reason, 'lift_reason', cleaned_reason)
  );
  return updated_row;
end;
$$;

-- ---------------------------------------------------------------------------
-- Row level security (read-only for founder/admin of the active organization)
-- ---------------------------------------------------------------------------

alter table public.email_audit_log enable row level security;
alter table public.email_contacts enable row level security;
alter table public.email_contact_consents enable row level security;
alter table public.email_suppressions enable row level security;

create policy email_audit_log_select on public.email_audit_log
for select to authenticated
using (
  organization_id = (select public.current_user_organization_id())
  and (select private.email_can('read'))
);

create policy email_contacts_select on public.email_contacts
for select to authenticated
using (
  organization_id = (select public.current_user_organization_id())
  and (select private.email_can('read'))
);

create policy email_contact_consents_select on public.email_contact_consents
for select to authenticated
using (
  organization_id = (select public.current_user_organization_id())
  and (select private.email_can('read'))
);

create policy email_suppressions_select on public.email_suppressions
for select to authenticated
using (
  organization_id = (select public.current_user_organization_id())
  and (select private.email_can('read'))
);

-- ---------------------------------------------------------------------------
-- Ownership and grants
-- ---------------------------------------------------------------------------

alter function private.email_normalize_address(text) owner to postgres;
alter function private.email_address_hash(text) owner to postgres;
alter function private.email_can(text) owner to postgres;
alter function private.email_require(text) owner to postgres;
alter function private.email_reject_mutation() owner to postgres;
alter function private.email_contacts_guard() owner to postgres;
alter function private.email_contact_consents_guard() owner to postgres;
alter function private.email_suppressions_guard() owner to postgres;
alter function private.email_write_audit(uuid, text, text, uuid, jsonb) owner to postgres;
alter function private.email_is_sendable(uuid, uuid, text) owner to postgres;
alter function private.email_clean_name(text) owner to postgres;
alter function private.email_clean_locale(text) owner to postgres;
alter function private.email_clean_timezone(text) owner to postgres;
alter function private.email_request_hash(jsonb) owner to postgres;
alter function public.email_create_contact(text, text, text, text, text, text) owner to postgres;
alter function public.email_update_contact(uuid, jsonb, bigint) owner to postgres;
alter function public.email_archive_contact(uuid, text) owner to postgres;
alter function public.email_record_consent(uuid, text, text, text, text, timestamptz, jsonb, text, text) owner to postgres;
alter function public.email_revoke_consent(uuid, text, text, timestamptz, text, text) owner to postgres;
alter function public.email_add_suppression(text, text, text) owner to postgres;
alter function public.email_lift_suppression(uuid, text) owner to postgres;

revoke all on function private.email_normalize_address(text) from public, anon, authenticated, service_role;
revoke all on function private.email_address_hash(text) from public, anon, authenticated, service_role;
revoke all on function private.email_can(text) from public, anon, authenticated, service_role;
revoke all on function private.email_require(text) from public, anon, authenticated, service_role;
revoke all on function private.email_reject_mutation() from public, anon, authenticated, service_role;
revoke all on function private.email_contacts_guard() from public, anon, authenticated, service_role;
revoke all on function private.email_contact_consents_guard() from public, anon, authenticated, service_role;
revoke all on function private.email_suppressions_guard() from public, anon, authenticated, service_role;
revoke all on function private.email_write_audit(uuid, text, text, uuid, jsonb) from public, anon, authenticated, service_role;
revoke all on function private.email_is_sendable(uuid, uuid, text) from public, anon, authenticated, service_role;
revoke all on function private.email_clean_name(text) from public, anon, authenticated, service_role;
revoke all on function private.email_clean_locale(text) from public, anon, authenticated, service_role;
revoke all on function private.email_clean_timezone(text) from public, anon, authenticated, service_role;
revoke all on function private.email_request_hash(jsonb) from public, anon, authenticated, service_role;

-- RLS policies evaluate email_can as the querying role. The private schema is
-- not exposed and authenticated has no USAGE on it, so this grant does not
-- make the helper callable through the API.
grant execute on function private.email_can(text) to authenticated;
-- private.email_is_sendable is intentionally executable by no API role, not
-- even service_role (which has no USAGE on schema private). Future dispatch
-- (Increment 5) will expose it through a dedicated worker entry point once the
-- dispatcher design is decided.

revoke all on function public.email_create_contact(text, text, text, text, text, text) from public, anon, authenticated, service_role;
revoke all on function public.email_update_contact(uuid, jsonb, bigint) from public, anon, authenticated, service_role;
revoke all on function public.email_archive_contact(uuid, text) from public, anon, authenticated, service_role;
revoke all on function public.email_record_consent(uuid, text, text, text, text, timestamptz, jsonb, text, text) from public, anon, authenticated, service_role;
revoke all on function public.email_revoke_consent(uuid, text, text, timestamptz, text, text) from public, anon, authenticated, service_role;
revoke all on function public.email_add_suppression(text, text, text) from public, anon, authenticated, service_role;
revoke all on function public.email_lift_suppression(uuid, text) from public, anon, authenticated, service_role;

grant execute on function public.email_create_contact(text, text, text, text, text, text) to authenticated;
grant execute on function public.email_update_contact(uuid, jsonb, bigint) to authenticated;
grant execute on function public.email_archive_contact(uuid, text) to authenticated;
grant execute on function public.email_record_consent(uuid, text, text, text, text, timestamptz, jsonb, text, text) to authenticated;
grant execute on function public.email_revoke_consent(uuid, text, text, timestamptz, text, text) to authenticated;
grant execute on function public.email_add_suppression(text, text, text) to authenticated;
grant execute on function public.email_lift_suppression(uuid, text) to authenticated;

revoke all on table public.email_audit_log, public.email_contacts,
  public.email_contact_consents, public.email_suppressions
  from public, anon, authenticated, service_role;
grant select on table public.email_audit_log, public.email_contacts,
  public.email_contact_consents, public.email_suppressions
  to authenticated, service_role;

comment on table public.email_contact_consents is
  'Append-only consent evidence ledger. Records evidence; does not by itself establish legal compliance.';
comment on table public.email_suppressions is
  'Per-organization address suppression. Keyed by normalized address; survives contact lifecycle.';
comment on function private.email_is_sendable(uuid, uuid, text) is
  'Fail-closed sendability check for trusted server-side callers only.';

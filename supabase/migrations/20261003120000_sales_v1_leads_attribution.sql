-- ORVESEN Sales V1 - Increment 2: Leads + Attribution.
--
-- Scope: organization-scoped lead intake records, append-only attribution
-- evidence ("touches"), first/last touch derived in a security-invoker view,
-- idempotent authenticated ingestion, lead update, qualification,
-- disqualification and archive. No opportunities, conversion, public.clients
-- writes, public/anonymous ingestion, Builder/Email/Orb integration, UI,
-- scoring, assignment or activities.
--
-- Changes to Increment 1 objects (approved decisions D1 and D2), each guarded:
-- * D1: private.sales_can gains the action 'manage_leads' (founder/admin only).
-- * D2: sales_audit_log action/entity_type CHECKs are widened additively and a
--   lead action/entity consistency CHECK is added.
-- The guard below verifies the exact Increment 1 definitions first and aborts
-- the whole migration (SALES_MIGRATION_DRIFT) on any difference.
--
-- Security model (unchanged from Increment 1):
-- * Organization and actor come from auth.uid() / current_user_organization_id();
--   RPCs never accept an organization id.
-- * No direct DML for anon/authenticated/service_role. Writes only through the
--   SECURITY DEFINER RPCs; guard triggers enforce invariants for every role.
-- * Founder/admin of the active organization only. No platform-owner bypass.
-- * A Sales lead never implies marketing consent.
--
-- Concurrency: every lead ingestion, touch addition and lead identity update
-- takes a per-organization transaction advisory lock, so match-then-insert is
-- serialized; partial unique indexes are the backstop. The 1000-touch cap is a
-- CHECK on a counter maintained by trigger.
--
-- Atomicity: no explicit BEGIN/COMMIT (repository convention); the SQL Editor
-- and the Supabase CLI run the file as one transaction. ASCII only.

-- ---------------------------------------------------------------------------
-- Guard: exact Increment 1 state (fail closed on drift)
-- ---------------------------------------------------------------------------

-- Take the strongest lock this migration needs on the audit log up front
-- (no read-then-upgrade).
lock table public.sales_audit_log in access exclusive mode;

do $guard$
declare
  expected_constraints text[] := array[
    $c$sales_audit_log_action_check => CHECK ((action = ANY (ARRAY['sales.pipeline.created'::text, 'sales.stage.created'::text, 'sales.stage.updated'::text, 'sales.stage.archived'::text, 'sales.stages.reordered'::text])))$c$,
    $c$sales_audit_log_check => CHECK (((entity_type = 'pipeline'::text) = (action = ANY (ARRAY['sales.pipeline.created'::text, 'sales.stages.reordered'::text]))))$c$,
    $c$sales_audit_log_details_check => CHECK (((jsonb_typeof(details) = 'object'::text) AND (pg_column_size(details) <= 16384)))$c$,
    $c$sales_audit_log_entity_type_check => CHECK ((entity_type = ANY (ARRAY['pipeline'::text, 'stage'::text])))$c$
  ];
  found_constraints text[];
  can_row record;
begin
  select proc.prosecdef, coalesce(proc.proconfig, '{}') as config,
         pg_catalog.pg_get_userbyid(proc.proowner)::text as owner,
         pg_catalog.md5(replace(proc.prosrc, chr(13), '')) as body_md5
  into can_row
  from pg_catalog.pg_proc as proc
  where proc.oid = pg_catalog.to_regprocedure('private.sales_can(text)');

  if can_row.body_md5 is distinct from '2f61c4f2f9c52c0ab2e7a19495652a33'
     or can_row.prosecdef is distinct from true
     or can_row.config is distinct from array['search_path=""']
     or can_row.owner is distinct from 'postgres' then
    raise exception using errcode = '55000', message = 'SALES_MIGRATION_DRIFT',
      detail = 'private.sales_can is not the exact Increment 1 definition';
  end if;

  select coalesce(array_agg(con.conname || ' => ' || pg_catalog.pg_get_constraintdef(con.oid) order by con.conname), '{}')
  into found_constraints
  from pg_catalog.pg_constraint as con
  where con.conrelid = pg_catalog.to_regclass('public.sales_audit_log') and con.contype = 'c';

  if found_constraints is distinct from expected_constraints then
    raise exception using errcode = '55000', message = 'SALES_MIGRATION_DRIFT',
      detail = 'sales_audit_log CHECK constraints are not the exact Increment 1 definitions';
  end if;
end;
$guard$;

-- ---------------------------------------------------------------------------
-- D1: authorization decision point gains 'manage_leads' (guarded above)
-- ---------------------------------------------------------------------------

create or replace function private.sales_can(requested_action text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    requested_action in ('read', 'manage_pipeline', 'manage_leads')
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

-- ---------------------------------------------------------------------------
-- D2: audit log accepts lead events (additive; guarded above)
-- ---------------------------------------------------------------------------

alter table public.sales_audit_log drop constraint sales_audit_log_action_check;
alter table public.sales_audit_log add constraint sales_audit_log_action_check check (action in (
  'sales.pipeline.created',
  'sales.stage.created',
  'sales.stage.updated',
  'sales.stage.archived',
  'sales.stages.reordered',
  'sales.lead.created',
  'sales.lead.updated',
  'sales.lead.qualified',
  'sales.lead.disqualified',
  'sales.lead.archived',
  'sales.lead.touch_added'
));
alter table public.sales_audit_log drop constraint sales_audit_log_entity_type_check;
alter table public.sales_audit_log add constraint sales_audit_log_entity_type_check
  check (entity_type in ('pipeline', 'stage', 'lead', 'lead_touch'));
alter table public.sales_audit_log add constraint sales_audit_log_lead_entity_check check (
  (action in ('sales.lead.created', 'sales.lead.updated', 'sales.lead.qualified',
              'sales.lead.disqualified', 'sales.lead.archived')) = (entity_type = 'lead')
  and (action = 'sales.lead.touch_added') = (entity_type = 'lead_touch')
);

-- ---------------------------------------------------------------------------
-- Pure helpers (immutable; used by CHECK constraints and RPCs)
-- ---------------------------------------------------------------------------

-- Same rules as private.email_normalize_address (Email Marketing V1, commit
-- 0b64966): lower-case and trim; no provider-specific dot or +tag stripping;
-- ASCII mailboxes only. Returns null for anything that is not one plausible
-- mailbox. Parity is asserted by the test suite.
create function private.sales_normalize_email(raw_address text)
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

-- Formatting-only phone normalization: removes spaces, dots, dashes and
-- parentheses, keeps a leading '+', requires 7..15 digits. Never infers a
-- country. Returns null when the result is not acceptable.
create function private.sales_normalize_phone(raw_phone text)
returns text
language plpgsql
immutable
strict
set search_path = ''
as $$
declare
  candidate text := regexp_replace(btrim(raw_phone, E' \t\r\n'), '[ ().-]', '', 'g');
begin
  if candidate !~ '^\+?[0-9]{7,15}$' then
    return null;
  end if;
  return candidate;
end;
$$;

-- Trimmed free text of 1..max_length characters without control characters.
create function private.sales_clean_text(raw_text text, max_length integer)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when raw_text is null or max_length is null then null
    when char_length(btrim(raw_text)) between 1 and max_length
      and btrim(raw_text) !~ '[[:cntrl:]]' then btrim(raw_text)
    else null
  end;
$$;

-- http(s) URL with a plain host (no userinfo), at most 2048 characters, no
-- whitespace or control characters. Returns null when not acceptable.
create function private.sales_clean_url(raw_url text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when raw_url is null then null
    when char_length(btrim(raw_url)) not between 1 and 2048 then null
    when btrim(raw_url) ~ '[[:cntrl:][:space:]]' then null
    when btrim(raw_url) !~* '^https?://[a-z0-9]([a-z0-9.-]*[a-z0-9])?(:[0-9]{1,5})?([/?#][^[:space:]]*)?$' then null
    else btrim(raw_url)
  end;
$$;

-- Allow-listed advertising click identifiers: flat object of short strings.
create function private.sales_click_ids_valid(click_ids jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select click_ids is not null
    and jsonb_typeof(click_ids) = 'object'
    and not exists (
      select 1
      from jsonb_each(click_ids) as item
      where item.key not in ('gclid', 'fbclid', 'msclkid', 'ttclid', 'li_fat_id')
         or jsonb_typeof(item.value) <> 'string'
         or char_length(item.value #>> '{}') not between 1 and 512
         or (item.value #>> '{}') ~ '[[:cntrl:][:space:]]'
    );
$$;

-- Bounded raw attribution evidence: flat object, at most 50 keys, keys
-- [A-Za-z0-9_.-]{1,64}, string values up to 1024 characters without control
-- characters, at most 8 KB stored.
create function private.sales_raw_valid(raw jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select raw is not null
    and jsonb_typeof(raw) = 'object'
    and pg_column_size(raw) <= 8192
    and (select count(*) from jsonb_object_keys(raw)) <= 50
    and not exists (
      select 1
      from jsonb_each(raw) as item
      where item.key !~ '^[A-Za-z0-9_.-]{1,64}$'
         or jsonb_typeof(item.value) <> 'string'
         or char_length(item.value #>> '{}') > 1024
         or (item.value #>> '{}') ~ '[[:cntrl:]]'
    );
$$;

-- SHA-256 of the canonical jsonb text (jsonb normalizes key order/whitespace).
create function private.sales_request_hash(payload jsonb)
returns text
language sql
immutable
strict
set search_path = ''
as $$
  select encode(sha256(convert_to(payload::text, 'UTF8')), 'hex');
$$;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.sales_leads (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  email text check (email is null or char_length(email) between 3 and 254),
  email_normalized text,
  phone text check (phone is null or char_length(phone) between 1 and 40),
  phone_normalized text,
  full_name text check (full_name is null or full_name = private.sales_clean_text(full_name, 200)),
  company_name text check (company_name is null or company_name = private.sales_clean_text(company_name, 200)),
  external_source text check (external_source is null or external_source ~ '^[a-z][a-z0-9_]{0,39}$'),
  external_id text check (external_id is null or (char_length(external_id) between 1 and 200
                                                  and external_id !~ '[[:cntrl:][:space:]]')),
  status text not null default 'new' check (status in ('new', 'qualified', 'disqualified', 'archived')),
  qualification_reason text,
  qualification_note text check (qualification_note is null
                                 or qualification_note = private.sales_clean_text(qualification_note, 500)),
  qualification_decided_at timestamptz,
  qualification_decided_by uuid,
  archive_reason text check (archive_reason is null
                             or archive_reason in ('duplicate', 'spam', 'test', 'not_interested', 'other')),
  archived_at timestamptz,
  archived_by uuid,
  touch_count integer not null default 0 check (touch_count between 0 and 1000),
  created_via text not null check (created_via in ('manual', 'import', 'api', 'landing_page', 'webhook')),
  actor_type text not null check (actor_type in ('user', 'system')),
  created_by uuid,
  version bigint not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  check ((actor_type = 'user') = (created_by is not null)),
  check (email_normalized is not distinct from private.sales_normalize_email(email)),
  check (phone_normalized is not distinct from private.sales_normalize_phone(phone)),
  check (email is null or email_normalized is not null),
  check (phone is null or phone_normalized is not null),
  check ((external_source is null) = (external_id is null)),
  -- Minimum identity: a contact channel or an external key. Name-only is rejected.
  check (email_normalized is not null or phone_normalized is not null or external_id is not null),
  check (
    (status = 'new' and qualification_reason is null and qualification_note is null
       and qualification_decided_at is null and qualification_decided_by is null)
    or (status = 'qualified' and qualification_reason in ('fit', 'need', 'budget', 'timing', 'other')
       and qualification_decided_at is not null and qualification_decided_by is not null)
    or (status = 'disqualified'
       and qualification_reason in ('no_fit', 'no_budget', 'unresponsive', 'duplicate', 'spam', 'other')
       and qualification_decided_at is not null and qualification_decided_by is not null)
    or (status = 'archived'
       and (qualification_reason is null) = (qualification_decided_at is null)
       and (qualification_decided_at is null) = (qualification_decided_by is null)
       and (qualification_note is null or qualification_reason is not null))
  ),
  check (
    (status = 'archived' and archived_at is not null and archived_by is not null and archive_reason is not null)
    or (status <> 'archived' and archived_at is null and archived_by is null and archive_reason is null)
  ),
  check (updated_at >= created_at)
);

-- One active lead per normalized email / external key within an organization.
-- Archived leads are excluded, so a later inquiry creates a new lead.
create unique index sales_leads_active_email_idx
  on public.sales_leads (organization_id, email_normalized)
  where email_normalized is not null and status <> 'archived';
create unique index sales_leads_active_external_idx
  on public.sales_leads (organization_id, external_source, external_id)
  where external_id is not null and status <> 'archived';
create index sales_leads_active_phone_idx
  on public.sales_leads (organization_id, phone_normalized)
  where phone_normalized is not null and status <> 'archived';
create index sales_leads_org_status_idx
  on public.sales_leads (organization_id, status, created_at desc);

create table public.sales_lead_touches (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  lead_id uuid not null,
  occurred_at timestamptz not null,
  received_at timestamptz not null default clock_timestamp(),
  ingestion_channel text not null check (ingestion_channel in ('manual', 'import', 'api', 'landing_page', 'webhook')),
  channel text not null default 'unknown' check (channel in (
    'direct', 'organic_search', 'paid_search', 'organic_social', 'paid_social', 'email',
    'referral', 'affiliate', 'display', 'offline', 'other', 'unknown')),
  utm_source text check (utm_source is null or (char_length(utm_source) between 1 and 200
    and utm_source = lower(btrim(utm_source)) and utm_source !~ '[[:cntrl:]]')),
  utm_medium text check (utm_medium is null or (char_length(utm_medium) between 1 and 200
    and utm_medium = lower(btrim(utm_medium)) and utm_medium !~ '[[:cntrl:]]')),
  utm_campaign text check (utm_campaign is null or (char_length(utm_campaign) between 1 and 200
    and utm_campaign = lower(btrim(utm_campaign)) and utm_campaign !~ '[[:cntrl:]]')),
  utm_term text check (utm_term is null or (char_length(utm_term) between 1 and 200
    and utm_term = lower(btrim(utm_term)) and utm_term !~ '[[:cntrl:]]')),
  utm_content text check (utm_content is null or (char_length(utm_content) between 1 and 200
    and utm_content = lower(btrim(utm_content)) and utm_content !~ '[[:cntrl:]]')),
  referrer_url text check (referrer_url is null or referrer_url = private.sales_clean_url(referrer_url)),
  landing_url text check (landing_url is null or landing_url = private.sales_clean_url(landing_url)),
  -- Opaque references (no FK): Builder asset, Builder growth system, campaign.
  landing_asset_id uuid,
  funnel_id uuid,
  campaign_ref text check (campaign_ref is null or campaign_ref ~ '^[A-Za-z0-9._:/-]{1,200}$'),
  click_ids jsonb not null default '{}'::jsonb check (private.sales_click_ids_valid(click_ids)),
  event_source text check (event_source is null or event_source ~ '^[a-z][a-z0-9_]{0,39}$'),
  external_event_id text check (external_event_id is null or (char_length(external_event_id) between 1 and 200
                                                              and external_event_id !~ '[[:cntrl:][:space:]]')),
  raw jsonb not null default '{}'::jsonb check (private.sales_raw_valid(raw)),
  idempotency_key text check (idempotency_key is null or idempotency_key ~ '^[A-Za-z0-9._:-]{8,128}$'),
  request_hash text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  actor_type text not null check (actor_type in ('user', 'system')),
  created_by uuid,
  constraint sales_lead_touches_lead_fkey
    foreign key (organization_id, lead_id)
    references public.sales_leads(organization_id, id)
    on delete restrict,
  unique (organization_id, id),
  check ((actor_type = 'user') = (created_by is not null)),
  check ((event_source is null) = (external_event_id is null)),
  check (occurred_at >= timestamptz '2000-01-01 00:00:00+00'
         and occurred_at <= received_at + interval '5 minutes')
);

create unique index sales_lead_touches_idempotency_idx
  on public.sales_lead_touches (organization_id, idempotency_key)
  where idempotency_key is not null;
create unique index sales_lead_touches_event_idx
  on public.sales_lead_touches (organization_id, event_source, external_event_id)
  where external_event_id is not null;
create index sales_lead_touches_lead_order_idx
  on public.sales_lead_touches (organization_id, lead_id, occurred_at, received_at, id);
create index sales_lead_touches_campaign_idx
  on public.sales_lead_touches (organization_id, utm_campaign)
  where utm_campaign is not null;

-- ---------------------------------------------------------------------------
-- Guard triggers (apply to every role, including the function owner)
-- ---------------------------------------------------------------------------

create function private.sales_leads_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception using errcode = '55000', message = 'SALES_IMMUTABLE',
      detail = 'Sales leads are archived, never deleted';
  end if;

  if tg_op = 'INSERT' then
    if new.version <> 1 or new.status <> 'new' or new.touch_count <> 0 then
      raise exception using errcode = '55000', message = 'SALES_IMMUTABLE',
        detail = 'New leads start as new at version 1 with no touches';
    end if;
    new.updated_at := new.created_at;
    return new;
  end if;

  if new.id is distinct from old.id
     or new.organization_id is distinct from old.organization_id
     or new.external_source is distinct from old.external_source
     or new.external_id is distinct from old.external_id
     or new.created_via is distinct from old.created_via
     or new.actor_type is distinct from old.actor_type
     or new.created_by is distinct from old.created_by
     or new.created_at is distinct from old.created_at then
    raise exception using errcode = '55000', message = 'SALES_IMMUTABLE',
      detail = 'Lead identity columns are immutable';
  end if;
  if new.touch_count is distinct from old.touch_count
     and new.touch_count is distinct from old.touch_count + 1 then
    raise exception using errcode = '55000', message = 'SALES_IMMUTABLE',
      detail = 'touch_count only increases by one per recorded touch';
  end if;
  if old.status = 'archived' then
    raise exception using errcode = '55000', message = 'SALES_IMMUTABLE',
      detail = 'Archived leads are immutable';
  end if;
  if new.status is distinct from old.status and not (
       (old.status = 'new' and new.status in ('qualified', 'disqualified', 'archived'))
    or (old.status = 'qualified' and new.status in ('disqualified', 'archived'))
    or (old.status = 'disqualified' and new.status in ('qualified', 'archived'))
  ) then
    raise exception using errcode = '55000', message = 'SALES_INVALID_TRANSITION',
      detail = format('%s -> %s is not allowed', old.status, new.status);
  end if;

  -- version and updated_at are always derived here; callers cannot set them.
  if new.email is distinct from old.email
     or new.email_normalized is distinct from old.email_normalized
     or new.phone is distinct from old.phone
     or new.phone_normalized is distinct from old.phone_normalized
     or new.full_name is distinct from old.full_name
     or new.company_name is distinct from old.company_name
     or new.status is distinct from old.status
     or new.qualification_reason is distinct from old.qualification_reason
     or new.qualification_note is distinct from old.qualification_note
     or new.qualification_decided_at is distinct from old.qualification_decided_at
     or new.qualification_decided_by is distinct from old.qualification_decided_by
     or new.archive_reason is distinct from old.archive_reason
     or new.archived_at is distinct from old.archived_at
     or new.archived_by is distinct from old.archived_by then
    new.version := old.version + 1;
    new.updated_at := greatest(now(), old.updated_at);
  else
    new.version := old.version;
    new.updated_at := old.updated_at;
  end if;
  return new;
end;
$$;

create trigger sales_leads_guard
before insert or update or delete on public.sales_leads
for each row execute function private.sales_leads_guard();

create trigger sales_leads_reject_truncate
before truncate on public.sales_leads
for each statement execute function private.sales_reject_mutation();

-- Touches: received_at is server time; archived leads take no new evidence.
create function private.sales_lead_touches_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  lead_status text;
begin
  if tg_op <> 'INSERT' then
    raise exception using errcode = '55000', message = 'SALES_IMMUTABLE',
      detail = 'Attribution touches are append-only evidence';
  end if;
  new.received_at := clock_timestamp();
  select lead.status into lead_status
  from public.sales_leads as lead
  where lead.id = new.lead_id and lead.organization_id = new.organization_id;
  if lead_status = 'archived' then
    raise exception using errcode = '55000', message = 'SALES_LEAD_ARCHIVED',
      detail = 'Archived leads take no new touches';
  end if;
  return new;
end;
$$;

create trigger sales_lead_touches_guard
before insert or update or delete on public.sales_lead_touches
for each row execute function private.sales_lead_touches_guard();

create trigger sales_lead_touches_reject_truncate
before truncate on public.sales_lead_touches
for each statement execute function private.sales_reject_mutation();

-- Counter behind the 1000-touch cap (CHECK on sales_leads.touch_count). The
-- lead row update also serializes concurrent touches on the same lead.
create function private.sales_lead_touches_count()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.sales_leads
  set touch_count = touch_count + 1
  where id = new.lead_id and organization_id = new.organization_id;
  return null;
end;
$$;

create trigger sales_lead_touches_count
after insert on public.sales_lead_touches
for each row execute function private.sales_lead_touches_count();

-- ---------------------------------------------------------------------------
-- Input cleaning (raise SALES_INVALID_INPUT with the offending field in detail)
-- ---------------------------------------------------------------------------

create function private.sales_clean_lead(p_lead jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_key text;
  v_email text;
  v_email_normalized text;
  v_phone text;
  v_phone_normalized text;
  v_full_name text;
  v_company_name text;
  v_external_source text;
  v_external_id text;
begin
  if p_lead is null or jsonb_typeof(p_lead) <> 'object' then
    raise exception using errcode = '22023', message = 'SALES_INVALID_INPUT', detail = 'lead';
  end if;
  for v_key in select jsonb_object_keys(p_lead) loop
    if v_key not in ('email', 'phone', 'full_name', 'company_name', 'external_source', 'external_id') then
      raise exception using errcode = '22023', message = 'SALES_INVALID_INPUT', detail = 'lead.' || v_key;
    end if;
    if jsonb_typeof(p_lead -> v_key) not in ('string', 'null') then
      raise exception using errcode = '22023', message = 'SALES_INVALID_INPUT', detail = 'lead.' || v_key;
    end if;
  end loop;

  v_email := nullif(btrim(p_lead ->> 'email', E' \t\r\n'), '');
  if v_email is not null then
    v_email_normalized := private.sales_normalize_email(v_email);
    if v_email_normalized is null or char_length(v_email) > 254 then
      raise exception using errcode = '22023', message = 'SALES_INVALID_INPUT', detail = 'lead.email';
    end if;
  end if;

  v_phone := nullif(btrim(p_lead ->> 'phone', E' \t\r\n'), '');
  if v_phone is not null then
    v_phone_normalized := private.sales_normalize_phone(v_phone);
    if v_phone_normalized is null or char_length(v_phone) > 40 then
      raise exception using errcode = '22023', message = 'SALES_INVALID_INPUT', detail = 'lead.phone';
    end if;
  end if;

  if nullif(btrim(p_lead ->> 'full_name'), '') is not null then
    v_full_name := private.sales_clean_text(p_lead ->> 'full_name', 200);
    if v_full_name is null then
      raise exception using errcode = '22023', message = 'SALES_INVALID_INPUT', detail = 'lead.full_name';
    end if;
  end if;
  if nullif(btrim(p_lead ->> 'company_name'), '') is not null then
    v_company_name := private.sales_clean_text(p_lead ->> 'company_name', 200);
    if v_company_name is null then
      raise exception using errcode = '22023', message = 'SALES_INVALID_INPUT', detail = 'lead.company_name';
    end if;
  end if;

  v_external_source := nullif(btrim(p_lead ->> 'external_source'), '');
  v_external_id := nullif(btrim(p_lead ->> 'external_id'), '');
  if (v_external_source is null) <> (v_external_id is null)
     or (v_external_source is not null and v_external_source !~ '^[a-z][a-z0-9_]{0,39}$')
     or (v_external_id is not null and (char_length(v_external_id) > 200 or v_external_id ~ '[[:cntrl:][:space:]]')) then
    raise exception using errcode = '22023', message = 'SALES_INVALID_INPUT', detail = 'lead.external';
  end if;

  if v_email_normalized is null and v_phone_normalized is null and v_external_id is null then
    raise exception using errcode = '22023', message = 'SALES_INVALID_INPUT', detail = 'lead.identity';
  end if;

  return jsonb_build_object(
    'email', v_email, 'email_normalized', v_email_normalized,
    'phone', v_phone, 'phone_normalized', v_phone_normalized,
    'full_name', v_full_name, 'company_name', v_company_name,
    'external_source', v_external_source, 'external_id', v_external_id);
end;
$$;

-- Validates and normalizes one touch. Not immutable: occurred_at is compared
-- with the current time.
create function private.sales_clean_touch(p_touch jsonb, p_allowed_channels text[])
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_key text;
  v_value text;
  v_result jsonb := '{}'::jsonb;
  v_occurred timestamptz;
  v_uuid uuid;
begin
  if p_touch is null or jsonb_typeof(p_touch) <> 'object' then
    raise exception using errcode = '22023', message = 'SALES_INVALID_INPUT', detail = 'touch';
  end if;
  for v_key in select jsonb_object_keys(p_touch) loop
    if v_key not in ('occurred_at', 'ingestion_channel', 'channel', 'utm_source', 'utm_medium', 'utm_campaign',
                     'utm_term', 'utm_content', 'referrer_url', 'landing_url', 'landing_asset_id', 'funnel_id',
                     'campaign_ref', 'click_ids', 'event_source', 'external_event_id', 'raw') then
      raise exception using errcode = '22023', message = 'SALES_INVALID_INPUT', detail = 'touch.' || v_key;
    end if;
    if v_key not in ('click_ids', 'raw') and jsonb_typeof(p_touch -> v_key) not in ('string', 'null') then
      raise exception using errcode = '22023', message = 'SALES_INVALID_INPUT', detail = 'touch.' || v_key;
    end if;
  end loop;

  v_value := coalesce(nullif(btrim(p_touch ->> 'ingestion_channel'), ''), 'manual');
  if p_allowed_channels is null or not (v_value = any (p_allowed_channels)) then
    raise exception using errcode = '22023', message = 'SALES_INVALID_INPUT', detail = 'touch.ingestion_channel';
  end if;
  v_result := v_result || jsonb_build_object('ingestion_channel', v_value);

  v_value := coalesce(nullif(btrim(p_touch ->> 'channel'), ''), 'unknown');
  if v_value not in ('direct', 'organic_search', 'paid_search', 'organic_social', 'paid_social', 'email',
                     'referral', 'affiliate', 'display', 'offline', 'other', 'unknown') then
    raise exception using errcode = '22023', message = 'SALES_INVALID_INPUT', detail = 'touch.channel';
  end if;
  v_result := v_result || jsonb_build_object('channel', v_value);

  v_value := nullif(btrim(p_touch ->> 'occurred_at'), '');
  if v_value is null then
    v_occurred := clock_timestamp();
  else
    if v_value !~ '^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}(:?\d{2})?)$' then
      raise exception using errcode = '22023', message = 'SALES_INVALID_INPUT', detail = 'touch.occurred_at';
    end if;
    begin
      v_occurred := v_value::timestamptz;
    exception when others then
      raise exception using errcode = '22023', message = 'SALES_INVALID_INPUT', detail = 'touch.occurred_at';
    end;
    if v_occurred < timestamptz '2000-01-01 00:00:00+00' or v_occurred > clock_timestamp() + interval '5 minutes' then
      raise exception using errcode = '22023', message = 'SALES_INVALID_INPUT', detail = 'touch.occurred_at';
    end if;
  end if;
  v_result := v_result || jsonb_build_object('occurred_at', v_occurred);

  foreach v_key in array array['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'] loop
    v_value := nullif(lower(btrim(p_touch ->> v_key)), '');
    if v_value is not null and (char_length(v_value) > 200 or v_value ~ '[[:cntrl:]]') then
      raise exception using errcode = '22023', message = 'SALES_INVALID_INPUT', detail = 'touch.' || v_key;
    end if;
    v_result := v_result || jsonb_build_object(v_key, v_value);
  end loop;

  foreach v_key in array array['referrer_url', 'landing_url'] loop
    v_value := nullif(btrim(p_touch ->> v_key), '');
    if v_value is not null then
      v_value := private.sales_clean_url(v_value);
      if v_value is null then
        raise exception using errcode = '22023', message = 'SALES_INVALID_INPUT', detail = 'touch.' || v_key;
      end if;
    end if;
    v_result := v_result || jsonb_build_object(v_key, v_value);
  end loop;

  foreach v_key in array array['landing_asset_id', 'funnel_id'] loop
    v_value := nullif(btrim(p_touch ->> v_key), '');
    v_uuid := null;
    if v_value is not null then
      if v_value !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
        raise exception using errcode = '22023', message = 'SALES_INVALID_INPUT', detail = 'touch.' || v_key;
      end if;
      v_uuid := v_value::uuid;
    end if;
    v_result := v_result || jsonb_build_object(v_key, v_uuid);
  end loop;

  v_value := nullif(btrim(p_touch ->> 'campaign_ref'), '');
  if v_value is not null and v_value !~ '^[A-Za-z0-9._:/-]{1,200}$' then
    raise exception using errcode = '22023', message = 'SALES_INVALID_INPUT', detail = 'touch.campaign_ref';
  end if;
  v_result := v_result || jsonb_build_object('campaign_ref', v_value);

  if p_touch ? 'click_ids' and jsonb_typeof(p_touch -> 'click_ids') <> 'null' then
    if not private.sales_click_ids_valid(p_touch -> 'click_ids') then
      raise exception using errcode = '22023', message = 'SALES_INVALID_INPUT', detail = 'touch.click_ids';
    end if;
    v_result := v_result || jsonb_build_object('click_ids', p_touch -> 'click_ids');
  else
    v_result := v_result || jsonb_build_object('click_ids', '{}'::jsonb);
  end if;

  if p_touch ? 'raw' and jsonb_typeof(p_touch -> 'raw') <> 'null' then
    if not private.sales_raw_valid(p_touch -> 'raw') then
      raise exception using errcode = '22023', message = 'SALES_INVALID_INPUT', detail = 'touch.raw';
    end if;
    v_result := v_result || jsonb_build_object('raw', p_touch -> 'raw');
  else
    v_result := v_result || jsonb_build_object('raw', '{}'::jsonb);
  end if;

  if (nullif(btrim(p_touch ->> 'event_source'), '') is null) <> (nullif(btrim(p_touch ->> 'external_event_id'), '') is null)
     or coalesce(nullif(btrim(p_touch ->> 'event_source'), ''), 'x') !~ '^[a-z][a-z0-9_]{0,39}$'
     or char_length(coalesce(btrim(p_touch ->> 'external_event_id'), '')) > 200
     or coalesce(btrim(p_touch ->> 'external_event_id'), '') ~ '[[:cntrl:][:space:]]' then
    raise exception using errcode = '22023', message = 'SALES_INVALID_INPUT', detail = 'touch.external_event';
  end if;
  v_result := v_result || jsonb_build_object(
    'event_source', nullif(btrim(p_touch ->> 'event_source'), ''),
    'external_event_id', nullif(btrim(p_touch ->> 'external_event_id'), ''));

  return v_result;
end;
$$;

-- ---------------------------------------------------------------------------
-- Shared internals (not callable through the API)
-- ---------------------------------------------------------------------------

-- Result shape shared by ingestion, add-touch and replays.
create function private.sales_lead_result(p_touch_id uuid, p_replayed boolean)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'lead', to_jsonb(lead),
    'touch', to_jsonb(touch),
    'lead_created', not exists (
      select 1 from public.sales_lead_touches as earlier
      where earlier.organization_id = touch.organization_id
        and earlier.lead_id = touch.lead_id
        and (earlier.received_at, earlier.id) < (touch.received_at, touch.id)),
    'replayed', p_replayed)
  from public.sales_lead_touches as touch
  join public.sales_leads as lead
    on lead.organization_id = touch.organization_id and lead.id = touch.lead_id
  where touch.id = p_touch_id;
$$;

-- Returns the touch that already holds this idempotency key or external event,
-- or null. Raises SALES_IDEMPOTENCY_CONFLICT when it was recorded for a
-- different request. Caller must hold the organization advisory lock.
create function private.sales_find_replay(
  p_organization_id uuid,
  p_idempotency_key text,
  p_event_source text,
  p_external_event_id text,
  p_request_hash text
)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_hash text;
begin
  if p_idempotency_key is not null then
    select touch.id, touch.request_hash into v_id, v_hash
    from public.sales_lead_touches as touch
    where touch.organization_id = p_organization_id and touch.idempotency_key = p_idempotency_key;
  end if;
  if v_id is null and p_external_event_id is not null then
    select touch.id, touch.request_hash into v_id, v_hash
    from public.sales_lead_touches as touch
    where touch.organization_id = p_organization_id
      and touch.event_source = p_event_source
      and touch.external_event_id = p_external_event_id;
  end if;
  if v_id is not null and v_hash is distinct from p_request_hash then
    raise exception using errcode = '23505', message = 'SALES_IDEMPOTENCY_CONFLICT';
  end if;
  return v_id;
end;
$$;

create function private.sales_lock_organization_leads(p_organization_id uuid)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  select pg_advisory_xact_lock(hashtextextended('orvesen.sales.leads:' || p_organization_id::text, 0));
$$;

-- Inserts one touch from a cleaned touch object. Caller holds the organization
-- advisory lock and has locked the lead row.
create function private.sales_insert_touch(
  p_organization_id uuid,
  p_lead_id uuid,
  p_touch jsonb,
  p_idempotency_key text,
  p_request_hash text
)
returns public.sales_lead_touches
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_touch public.sales_lead_touches;
begin
  insert into public.sales_lead_touches (
    organization_id, lead_id, occurred_at, ingestion_channel, channel,
    utm_source, utm_medium, utm_campaign, utm_term, utm_content,
    referrer_url, landing_url, landing_asset_id, funnel_id, campaign_ref,
    click_ids, event_source, external_event_id, raw,
    idempotency_key, request_hash, actor_type, created_by
  ) values (
    p_organization_id, p_lead_id, (p_touch ->> 'occurred_at')::timestamptz,
    p_touch ->> 'ingestion_channel', p_touch ->> 'channel',
    p_touch ->> 'utm_source', p_touch ->> 'utm_medium', p_touch ->> 'utm_campaign',
    p_touch ->> 'utm_term', p_touch ->> 'utm_content',
    p_touch ->> 'referrer_url', p_touch ->> 'landing_url',
    (p_touch ->> 'landing_asset_id')::uuid, (p_touch ->> 'funnel_id')::uuid, p_touch ->> 'campaign_ref',
    p_touch -> 'click_ids', p_touch ->> 'event_source', p_touch ->> 'external_event_id', p_touch -> 'raw',
    p_idempotency_key, p_request_hash, 'user', (select auth.uid())
  )
  returning * into v_touch;
  return v_touch;
end;
$$;

-- Ingestion core: replay detection, identity matching, lead creation, touch.
-- Not exposed; a future trusted landing-page/webhook entry point reuses it.
create function private.sales_ingest_lead_core(
  p_organization_id uuid,
  p_lead jsonb,
  p_touch jsonb,
  p_idempotency_key text,
  p_allowed_channels text[]
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_lead_in jsonb;
  v_touch_in jsonb;
  v_hash text;
  v_replay uuid;
  v_lead public.sales_leads;
  v_touch public.sales_lead_touches;
  v_matched_by text;
begin
  if v_actor is null or p_organization_id is null then
    raise exception using errcode = '42501', message = 'SALES_AUTH_REQUIRED';
  end if;
  if p_idempotency_key is not null and p_idempotency_key !~ '^[A-Za-z0-9._:-]{8,128}$' then
    raise exception using errcode = '22023', message = 'SALES_INVALID_INPUT', detail = 'idempotency_key';
  end if;
  v_lead_in := private.sales_clean_lead(p_lead);
  v_touch_in := private.sales_clean_touch(coalesce(p_touch, '{}'::jsonb), p_allowed_channels);
  v_hash := private.sales_request_hash(jsonb_build_object(
    'op', 'ingest', 'lead', p_lead, 'touch', coalesce(p_touch, '{}'::jsonb)));

  perform private.sales_lock_organization_leads(p_organization_id);

  v_replay := private.sales_find_replay(p_organization_id, p_idempotency_key,
    v_touch_in ->> 'event_source', v_touch_in ->> 'external_event_id', v_hash);
  if v_replay is not null then
    return private.sales_lead_result(v_replay, true);
  end if;

  -- Match order: external key, email, phone (only when no email was given).
  -- Archived leads are never matched.
  if v_lead_in ->> 'external_id' is not null then
    select * into v_lead from public.sales_leads as lead
    where lead.organization_id = p_organization_id
      and lead.external_source = v_lead_in ->> 'external_source'
      and lead.external_id = v_lead_in ->> 'external_id'
      and lead.status <> 'archived'
    for update;
    if v_lead.id is not null then v_matched_by := 'external'; end if;
  end if;
  if v_lead.id is null and v_lead_in ->> 'email_normalized' is not null then
    select * into v_lead from public.sales_leads as lead
    where lead.organization_id = p_organization_id
      and lead.email_normalized = v_lead_in ->> 'email_normalized'
      and lead.status <> 'archived'
    for update;
    if v_lead.id is not null then v_matched_by := 'email'; end if;
  end if;
  if v_lead.id is null and v_lead_in ->> 'email_normalized' is null
     and v_lead_in ->> 'phone_normalized' is not null then
    select * into v_lead from public.sales_leads as lead
    where lead.organization_id = p_organization_id
      and lead.phone_normalized = v_lead_in ->> 'phone_normalized'
      and lead.status <> 'archived'
    order by lead.created_at, lead.id
    limit 1
    for update;
    if v_lead.id is not null then v_matched_by := 'phone'; end if;
  end if;

  if v_lead.id is null then
    insert into public.sales_leads (
      organization_id, email, email_normalized, phone, phone_normalized, full_name, company_name,
      external_source, external_id, created_via, actor_type, created_by
    ) values (
      p_organization_id, v_lead_in ->> 'email', v_lead_in ->> 'email_normalized',
      v_lead_in ->> 'phone', v_lead_in ->> 'phone_normalized',
      v_lead_in ->> 'full_name', v_lead_in ->> 'company_name',
      v_lead_in ->> 'external_source', v_lead_in ->> 'external_id',
      v_touch_in ->> 'ingestion_channel', 'user', v_actor
    )
    returning * into v_lead;
  elsif v_lead.touch_count >= 1000 then
    raise exception using errcode = '54000', message = 'SALES_TOUCH_LIMIT';
  end if;

  v_touch := private.sales_insert_touch(p_organization_id, v_lead.id, v_touch_in, p_idempotency_key, v_hash);

  if v_matched_by is null then
    perform private.sales_write_audit(
      p_organization_id, 'sales.lead.created', 'lead', v_lead.id,
      jsonb_build_object(
        'touch_id', v_touch.id,
        'created_via', v_lead.created_via,
        'has_email', v_lead.email_normalized is not null,
        'has_phone', v_lead.phone_normalized is not null,
        'has_external_key', v_lead.external_id is not null,
        'channel', v_touch.channel,
        'utm_source', v_touch.utm_source,
        'utm_campaign', v_touch.utm_campaign));
  else
    perform private.sales_write_audit(
      p_organization_id, 'sales.lead.touch_added', 'lead_touch', v_touch.id,
      jsonb_build_object(
        'lead_id', v_lead.id,
        'matched_by', v_matched_by,
        'ingestion_channel', v_touch.ingestion_channel,
        'channel', v_touch.channel,
        'utm_source', v_touch.utm_source,
        'utm_campaign', v_touch.utm_campaign));
  end if;

  return private.sales_lead_result(v_touch.id, false);
end;
$$;

-- Lifecycle transitions (qualified, disqualified, archived) with reason codes
-- and optimistic locking. Re-archiving an archived lead is a no-op; repeating
-- the current decision with the same reason and note is a no-op.
create function private.sales_transition_lead(
  p_organization_id uuid,
  p_lead_id uuid,
  p_target text,
  p_reason text,
  p_note text,
  p_expected_version bigint
)
returns public.sales_leads
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_note text;
  v_lead public.sales_leads;
  v_result public.sales_leads;
begin
  if p_lead_id is null or p_expected_version is null or p_reason is null
     or p_target not in ('qualified', 'disqualified', 'archived') then
    raise exception using errcode = '22023', message = 'SALES_INVALID_INPUT', detail = 'arguments';
  end if;
  if (p_target = 'qualified' and p_reason not in ('fit', 'need', 'budget', 'timing', 'other'))
     or (p_target = 'disqualified' and p_reason not in ('no_fit', 'no_budget', 'unresponsive', 'duplicate', 'spam', 'other'))
     or (p_target = 'archived' and p_reason not in ('duplicate', 'spam', 'test', 'not_interested', 'other')) then
    raise exception using errcode = '22023', message = 'SALES_INVALID_INPUT', detail = 'reason';
  end if;
  if p_note is not null and btrim(p_note) <> '' then
    v_note := private.sales_clean_text(p_note, 500);
    if v_note is null then
      raise exception using errcode = '22023', message = 'SALES_INVALID_INPUT', detail = 'note';
    end if;
  end if;

  select * into v_lead from public.sales_leads as lead
  where lead.id = p_lead_id and lead.organization_id = p_organization_id
  for update;
  if v_lead.id is null then
    raise exception using errcode = 'P0002', message = 'SALES_NOT_FOUND';
  end if;
  if v_lead.status = 'archived' then
    if p_target = 'archived' then
      return v_lead;
    end if;
    raise exception using errcode = '55000', message = 'SALES_LEAD_ARCHIVED';
  end if;
  if v_lead.version <> p_expected_version then
    raise exception using errcode = 'P0001', message = 'SALES_VERSION_CONFLICT',
      detail = format('expected %s, current %s', p_expected_version, v_lead.version);
  end if;
  if v_lead.status = p_target then
    if v_lead.qualification_reason = p_reason and v_lead.qualification_note is not distinct from v_note then
      return v_lead;
    end if;
    raise exception using errcode = '55000', message = 'SALES_INVALID_TRANSITION',
      detail = format('lead is already %s', p_target);
  end if;

  if p_target = 'archived' then
    update public.sales_leads
    set status = 'archived', archive_reason = p_reason, archived_at = now(), archived_by = v_actor
    where id = v_lead.id
    returning * into v_result;
  else
    update public.sales_leads
    set status = p_target, qualification_reason = p_reason, qualification_note = v_note,
        qualification_decided_at = now(), qualification_decided_by = v_actor
    where id = v_lead.id
    returning * into v_result;
  end if;

  perform private.sales_write_audit(
    p_organization_id,
    case p_target when 'qualified' then 'sales.lead.qualified'
                  when 'disqualified' then 'sales.lead.disqualified'
                  else 'sales.lead.archived' end,
    'lead', v_result.id,
    jsonb_build_object(
      'from_status', v_lead.status,
      'to_status', v_result.status,
      'reason', p_reason,
      'has_note', v_note is not null,
      'version_from', v_lead.version,
      'version_to', v_result.version));
  return v_result;
end;
$$;

-- ---------------------------------------------------------------------------
-- RPCs (authenticated; founder/admin through sales_can('manage_leads'))
-- ---------------------------------------------------------------------------

-- p_lead: {email, phone, full_name, company_name, external_source, external_id}
-- p_touch: attribution evidence; ingestion_channel one of manual, import, api.
-- Returns {lead, touch, lead_created, replayed}.
create function public.sales_ingest_lead(
  p_lead jsonb,
  p_touch jsonb default null,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  organization uuid := private.sales_require('manage_leads');
begin
  return private.sales_ingest_lead_core(organization, p_lead, p_touch, p_idempotency_key,
    array['manual', 'import', 'api']);
end;
$$;

-- Adds attribution evidence to an existing, non-archived lead.
create function public.sales_add_lead_touch(
  p_lead_id uuid,
  p_touch jsonb,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  organization uuid := private.sales_require('manage_leads');
  v_touch_in jsonb;
  v_hash text;
  v_replay uuid;
  v_lead public.sales_leads;
  v_touch public.sales_lead_touches;
begin
  if p_lead_id is null then
    raise exception using errcode = '22023', message = 'SALES_INVALID_INPUT', detail = 'lead_id';
  end if;
  if p_idempotency_key is not null and p_idempotency_key !~ '^[A-Za-z0-9._:-]{8,128}$' then
    raise exception using errcode = '22023', message = 'SALES_INVALID_INPUT', detail = 'idempotency_key';
  end if;
  v_touch_in := private.sales_clean_touch(coalesce(p_touch, '{}'::jsonb), array['manual', 'import', 'api']);
  v_hash := private.sales_request_hash(jsonb_build_object(
    'op', 'add_touch', 'lead_id', p_lead_id, 'touch', coalesce(p_touch, '{}'::jsonb)));

  perform private.sales_lock_organization_leads(organization);

  v_replay := private.sales_find_replay(organization, p_idempotency_key,
    v_touch_in ->> 'event_source', v_touch_in ->> 'external_event_id', v_hash);
  if v_replay is not null then
    return private.sales_lead_result(v_replay, true);
  end if;

  select * into v_lead from public.sales_leads as lead
  where lead.id = p_lead_id and lead.organization_id = organization
  for update;
  if v_lead.id is null then
    raise exception using errcode = 'P0002', message = 'SALES_NOT_FOUND';
  end if;
  if v_lead.status = 'archived' then
    raise exception using errcode = '55000', message = 'SALES_LEAD_ARCHIVED';
  end if;
  if v_lead.touch_count >= 1000 then
    raise exception using errcode = '54000', message = 'SALES_TOUCH_LIMIT';
  end if;

  v_touch := private.sales_insert_touch(organization, v_lead.id, v_touch_in, p_idempotency_key, v_hash);
  perform private.sales_write_audit(
    organization, 'sales.lead.touch_added', 'lead_touch', v_touch.id,
    jsonb_build_object(
      'lead_id', v_lead.id,
      'matched_by', 'lead_id',
      'ingestion_channel', v_touch.ingestion_channel,
      'channel', v_touch.channel,
      'utm_source', v_touch.utm_source,
      'utm_campaign', v_touch.utm_campaign));
  return private.sales_lead_result(v_touch.id, false);
end;
$$;

-- Patch keys: email, phone, full_name, company_name (null clears). The result
-- must keep a minimum identity. Audit records changed field names only.
create function public.sales_update_lead(
  p_lead_id uuid,
  p_changes jsonb,
  p_expected_version bigint
)
returns public.sales_leads
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  organization uuid := private.sales_require('manage_leads');
  v_lead public.sales_leads;
  v_result public.sales_leads;
  v_patch jsonb;
  v_clean jsonb;
  v_fields text[] := '{}';
begin
  if p_lead_id is null or p_expected_version is null or p_changes is null
     or jsonb_typeof(p_changes) <> 'object' or p_changes = '{}'::jsonb
     or exists (select 1 from jsonb_object_keys(p_changes) as change_key
                where change_key not in ('email', 'phone', 'full_name', 'company_name')) then
    raise exception using errcode = '22023', message = 'SALES_INVALID_INPUT', detail = 'changes';
  end if;

  perform private.sales_lock_organization_leads(organization);

  select * into v_lead from public.sales_leads as lead
  where lead.id = p_lead_id and lead.organization_id = organization
  for update;
  if v_lead.id is null then
    raise exception using errcode = 'P0002', message = 'SALES_NOT_FOUND';
  end if;
  if v_lead.status = 'archived' then
    raise exception using errcode = '55000', message = 'SALES_LEAD_ARCHIVED';
  end if;
  if v_lead.version <> p_expected_version then
    raise exception using errcode = 'P0001', message = 'SALES_VERSION_CONFLICT',
      detail = format('expected %s, current %s', p_expected_version, v_lead.version);
  end if;

  -- Validate the merged identity with the same cleaner used for ingestion.
  v_patch := jsonb_build_object(
    'email', v_lead.email, 'phone', v_lead.phone,
    'full_name', v_lead.full_name, 'company_name', v_lead.company_name,
    'external_source', v_lead.external_source, 'external_id', v_lead.external_id) || p_changes;
  v_clean := private.sales_clean_lead(v_patch);

  if (v_clean ->> 'email') is distinct from v_lead.email then v_fields := v_fields || 'email'::text; end if;
  if (v_clean ->> 'phone') is distinct from v_lead.phone then v_fields := v_fields || 'phone'::text; end if;
  if (v_clean ->> 'full_name') is distinct from v_lead.full_name then v_fields := v_fields || 'full_name'::text; end if;
  if (v_clean ->> 'company_name') is distinct from v_lead.company_name then v_fields := v_fields || 'company_name'::text; end if;
  if cardinality(v_fields) = 0 then
    return v_lead;
  end if;

  if v_clean ->> 'email_normalized' is not null and exists (
    select 1 from public.sales_leads as other
    where other.organization_id = organization
      and other.id <> v_lead.id
      and other.status <> 'archived'
      and other.email_normalized = v_clean ->> 'email_normalized'
  ) then
    raise exception using errcode = '23505', message = 'SALES_LEAD_EMAIL_EXISTS';
  end if;

  update public.sales_leads
  set email = v_clean ->> 'email', email_normalized = v_clean ->> 'email_normalized',
      phone = v_clean ->> 'phone', phone_normalized = v_clean ->> 'phone_normalized',
      full_name = v_clean ->> 'full_name', company_name = v_clean ->> 'company_name'
  where id = v_lead.id
  returning * into v_result;

  perform private.sales_write_audit(
    organization, 'sales.lead.updated', 'lead', v_result.id,
    jsonb_build_object('fields', to_jsonb(v_fields), 'version_from', v_lead.version, 'version_to', v_result.version));
  return v_result;
end;
$$;

create function public.sales_qualify_lead(
  p_lead_id uuid,
  p_reason text,
  p_note text,
  p_expected_version bigint
)
returns public.sales_leads
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  organization uuid := private.sales_require('manage_leads');
begin
  return private.sales_transition_lead(organization, p_lead_id, 'qualified', p_reason, p_note, p_expected_version);
end;
$$;

create function public.sales_disqualify_lead(
  p_lead_id uuid,
  p_reason text,
  p_note text,
  p_expected_version bigint
)
returns public.sales_leads
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  organization uuid := private.sales_require('manage_leads');
begin
  return private.sales_transition_lead(organization, p_lead_id, 'disqualified', p_reason, p_note, p_expected_version);
end;
$$;

create function public.sales_archive_lead(
  p_lead_id uuid,
  p_reason text,
  p_expected_version bigint
)
returns public.sales_leads
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  organization uuid := private.sales_require('manage_leads');
begin
  return private.sales_transition_lead(organization, p_lead_id, 'archived', p_reason, null, p_expected_version);
end;
$$;

-- ---------------------------------------------------------------------------
-- Derived attribution (security invoker: RLS of the base tables applies)
-- ---------------------------------------------------------------------------

create view public.sales_lead_attribution
with (security_invoker = true)
as
select
  lead.id as lead_id,
  lead.organization_id,
  lead.status,
  coalesce(counted.touch_count, 0) as touch_count,
  first_touch.id as first_touch_id,
  first_touch.occurred_at as first_occurred_at,
  first_touch.ingestion_channel as first_ingestion_channel,
  first_touch.channel as first_channel,
  first_touch.utm_source as first_utm_source,
  first_touch.utm_medium as first_utm_medium,
  first_touch.utm_campaign as first_utm_campaign,
  first_touch.landing_url as first_landing_url,
  first_touch.landing_asset_id as first_landing_asset_id,
  first_touch.funnel_id as first_funnel_id,
  first_touch.campaign_ref as first_campaign_ref,
  last_touch.id as last_touch_id,
  last_touch.occurred_at as last_occurred_at,
  last_touch.ingestion_channel as last_ingestion_channel,
  last_touch.channel as last_channel,
  last_touch.utm_source as last_utm_source,
  last_touch.utm_medium as last_utm_medium,
  last_touch.utm_campaign as last_utm_campaign,
  last_touch.landing_url as last_landing_url,
  last_touch.landing_asset_id as last_landing_asset_id,
  last_touch.funnel_id as last_funnel_id,
  last_touch.campaign_ref as last_campaign_ref
from public.sales_leads as lead
left join lateral (
  select touch.*
  from public.sales_lead_touches as touch
  where touch.organization_id = lead.organization_id and touch.lead_id = lead.id
  order by touch.occurred_at, touch.received_at, touch.id
  limit 1
) as first_touch on true
left join lateral (
  select touch.*
  from public.sales_lead_touches as touch
  where touch.organization_id = lead.organization_id and touch.lead_id = lead.id
  order by touch.occurred_at desc, touch.received_at desc, touch.id desc
  limit 1
) as last_touch on true
left join lateral (
  select count(*)::integer as touch_count
  from public.sales_lead_touches as touch
  where touch.organization_id = lead.organization_id and touch.lead_id = lead.id
) as counted on true;

-- ---------------------------------------------------------------------------
-- Row level security (read-only; all writes go through the RPCs)
-- ---------------------------------------------------------------------------

alter table public.sales_leads enable row level security;
alter table public.sales_lead_touches enable row level security;

create policy sales_leads_select on public.sales_leads
for select to authenticated
using (
  organization_id = (select public.current_user_organization_id())
  and (select private.sales_can('read'))
);

create policy sales_lead_touches_select on public.sales_lead_touches
for select to authenticated
using (
  organization_id = (select public.current_user_organization_id())
  and (select private.sales_can('read'))
);

-- ---------------------------------------------------------------------------
-- Ownership and grants
-- ---------------------------------------------------------------------------

alter function private.sales_can(text) owner to postgres;
alter function private.sales_normalize_email(text) owner to postgres;
alter function private.sales_normalize_phone(text) owner to postgres;
alter function private.sales_clean_text(text, integer) owner to postgres;
alter function private.sales_clean_url(text) owner to postgres;
alter function private.sales_click_ids_valid(jsonb) owner to postgres;
alter function private.sales_raw_valid(jsonb) owner to postgres;
alter function private.sales_request_hash(jsonb) owner to postgres;
alter function private.sales_leads_guard() owner to postgres;
alter function private.sales_lead_touches_guard() owner to postgres;
alter function private.sales_lead_touches_count() owner to postgres;
alter function private.sales_clean_lead(jsonb) owner to postgres;
alter function private.sales_clean_touch(jsonb, text[]) owner to postgres;
alter function private.sales_lead_result(uuid, boolean) owner to postgres;
alter function private.sales_find_replay(uuid, text, text, text, text) owner to postgres;
alter function private.sales_lock_organization_leads(uuid) owner to postgres;
alter function private.sales_insert_touch(uuid, uuid, jsonb, text, text) owner to postgres;
alter function private.sales_ingest_lead_core(uuid, jsonb, jsonb, text, text[]) owner to postgres;
alter function private.sales_transition_lead(uuid, uuid, text, text, text, bigint) owner to postgres;
alter function public.sales_ingest_lead(jsonb, jsonb, text) owner to postgres;
alter function public.sales_add_lead_touch(uuid, jsonb, text) owner to postgres;
alter function public.sales_update_lead(uuid, jsonb, bigint) owner to postgres;
alter function public.sales_qualify_lead(uuid, text, text, bigint) owner to postgres;
alter function public.sales_disqualify_lead(uuid, text, text, bigint) owner to postgres;
alter function public.sales_archive_lead(uuid, text, bigint) owner to postgres;
alter view public.sales_lead_attribution owner to postgres;

revoke all on function private.sales_can(text) from public, anon, authenticated, service_role;
revoke all on function private.sales_normalize_email(text) from public, anon, authenticated, service_role;
revoke all on function private.sales_normalize_phone(text) from public, anon, authenticated, service_role;
revoke all on function private.sales_clean_text(text, integer) from public, anon, authenticated, service_role;
revoke all on function private.sales_clean_url(text) from public, anon, authenticated, service_role;
revoke all on function private.sales_click_ids_valid(jsonb) from public, anon, authenticated, service_role;
revoke all on function private.sales_raw_valid(jsonb) from public, anon, authenticated, service_role;
revoke all on function private.sales_request_hash(jsonb) from public, anon, authenticated, service_role;
revoke all on function private.sales_leads_guard() from public, anon, authenticated, service_role;
revoke all on function private.sales_lead_touches_guard() from public, anon, authenticated, service_role;
revoke all on function private.sales_lead_touches_count() from public, anon, authenticated, service_role;
revoke all on function private.sales_clean_lead(jsonb) from public, anon, authenticated, service_role;
revoke all on function private.sales_clean_touch(jsonb, text[]) from public, anon, authenticated, service_role;
revoke all on function private.sales_lead_result(uuid, boolean) from public, anon, authenticated, service_role;
revoke all on function private.sales_find_replay(uuid, text, text, text, text) from public, anon, authenticated, service_role;
revoke all on function private.sales_lock_organization_leads(uuid) from public, anon, authenticated, service_role;
revoke all on function private.sales_insert_touch(uuid, uuid, jsonb, text, text) from public, anon, authenticated, service_role;
revoke all on function private.sales_ingest_lead_core(uuid, jsonb, jsonb, text, text[]) from public, anon, authenticated, service_role;
revoke all on function private.sales_transition_lead(uuid, uuid, text, text, text, bigint) from public, anon, authenticated, service_role;
revoke all on function public.sales_ingest_lead(jsonb, jsonb, text) from public, anon, authenticated, service_role;
revoke all on function public.sales_add_lead_touch(uuid, jsonb, text) from public, anon, authenticated, service_role;
revoke all on function public.sales_update_lead(uuid, jsonb, bigint) from public, anon, authenticated, service_role;
revoke all on function public.sales_qualify_lead(uuid, text, text, bigint) from public, anon, authenticated, service_role;
revoke all on function public.sales_disqualify_lead(uuid, text, text, bigint) from public, anon, authenticated, service_role;
revoke all on function public.sales_archive_lead(uuid, text, bigint) from public, anon, authenticated, service_role;

-- RLS policies evaluate sales_can as the querying role (unchanged from Inc1).
grant execute on function private.sales_can(text) to authenticated;

grant execute on function public.sales_ingest_lead(jsonb, jsonb, text) to authenticated;
grant execute on function public.sales_add_lead_touch(uuid, jsonb, text) to authenticated;
grant execute on function public.sales_update_lead(uuid, jsonb, bigint) to authenticated;
grant execute on function public.sales_qualify_lead(uuid, text, text, bigint) to authenticated;
grant execute on function public.sales_disqualify_lead(uuid, text, text, bigint) to authenticated;
grant execute on function public.sales_archive_lead(uuid, text, bigint) to authenticated;

revoke all on table public.sales_leads, public.sales_lead_touches, public.sales_lead_attribution
  from public, anon, authenticated, service_role;
grant select on table public.sales_leads, public.sales_lead_touches, public.sales_lead_attribution
  to authenticated;

comment on table public.sales_leads is
  'Organization-scoped inbound lead intake records. Not the customer/account identity and not marketing consent.';
comment on table public.sales_lead_touches is
  'Append-only attribution evidence. UPDATE, DELETE and TRUNCATE are rejected for every role.';
comment on view public.sales_lead_attribution is
  'First/last touch per lead, derived from immutable touches (order: occurred_at, received_at, id). Security invoker.';

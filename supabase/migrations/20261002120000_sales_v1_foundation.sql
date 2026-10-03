-- ORVESEN Sales V1 - Increment 1: Sales Foundation & Safety Core.
--
-- Scope: authorization decision point, append-only audit log, pipelines and
-- pipeline stages. No leads, opportunities, clients integration, money, tax,
-- payments, receipts, subscriptions, metrics or UI.
--
-- Security model:
-- * Every row is owned by exactly one organization. Composite keys
--   (organization_id, id) make cross-tenant references structurally impossible.
-- * Organization and actor are always derived server-side from auth.uid() and
--   public.current_user_organization_id(); RPCs never accept them as input.
-- * anon/authenticated/service_role get no direct DML. Writes go through the
--   SECURITY DEFINER RPCs below. Guard triggers enforce invariants for every
--   role, including the function owner.
-- * Increment 1 access is founder/admin of the active organization only.
--   There is intentionally no platform_owner bypass in sales_* objects.
--
-- Terminal-stage invariants (enforced in the database, not by callers):
-- * At most one active won stage per pipeline (partial unique index).
-- * Every active pipeline has exactly one active won stage, at least one active
--   lost stage, and contiguous active positions 1..n (deferred constraint
--   trigger, checked at commit).
-- * Every insert of a stage and every change to a stage's status or position
--   updates the parent pipeline row (structure_version). That row write
--   serializes concurrent structural changes per pipeline: under READ COMMITTED
--   the later transaction waits and its commit-time check sees the earlier
--   commit; under REPEATABLE READ/SERIALIZABLE it fails with 40001.
--
-- Atomicity: no explicit BEGIN/COMMIT (repository convention). The Supabase CLI
-- and the SQL Editor both execute this file as a single transaction. Owned
-- objects are created without IF NOT EXISTS / OR REPLACE so drift fails loudly.
-- ASCII only.

-- ---------------------------------------------------------------------------
-- Authorization: single decision point for the sales domain
-- ---------------------------------------------------------------------------

-- Membership is read directly (not via can_manage_organization) so that sales
-- data never inherits a future cross-tenant bypass added to a shared helper.
-- Unknown or null actions fail closed.
create function private.sales_can(requested_action text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    requested_action in ('read', 'manage_pipeline')
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
create function private.sales_require(required_action text)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  active_organization_id uuid;
begin
  if (select auth.uid()) is null then
    raise exception using errcode = '42501', message = 'SALES_AUTH_REQUIRED';
  end if;
  active_organization_id := public.current_user_organization_id();
  if active_organization_id is null then
    raise exception using errcode = '42501', message = 'SALES_NO_ACTIVE_ORGANIZATION';
  end if;
  if not private.sales_can(required_action) then
    raise exception using errcode = '42501', message = 'SALES_FORBIDDEN';
  end if;
  return active_organization_id;
end;
$$;

-- Display names: trimmed, 1..80 characters, no control characters.
-- Returns null when the value is not acceptable.
create function private.sales_clean_name(raw_name text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when raw_name is null then null
    when char_length(btrim(raw_name)) between 1 and 80
      and btrim(raw_name) !~ '[[:cntrl:]]' then btrim(raw_name)
    else null
  end;
$$;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.sales_audit_log (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id) on delete restrict,
  actor_user_id uuid not null,
  action text not null check (action in (
    'sales.pipeline.created',
    'sales.stage.created',
    'sales.stage.updated',
    'sales.stage.archived',
    'sales.stages.reordered'
  )),
  entity_type text not null check (entity_type in ('pipeline', 'stage')),
  entity_id uuid not null,
  details jsonb not null default '{}'::jsonb
    check (jsonb_typeof(details) = 'object' and pg_column_size(details) <= 16384),
  created_at timestamptz not null default now(),
  check (
    (entity_type = 'pipeline') = (action in ('sales.pipeline.created', 'sales.stages.reordered'))
  )
);

create index sales_audit_log_org_created_idx
  on public.sales_audit_log (organization_id, created_at desc, id desc);
create index sales_audit_log_entity_idx
  on public.sales_audit_log (organization_id, entity_type, entity_id, id desc);

create table public.sales_pipelines (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  name text not null check (name = private.sales_clean_name(name)),
  is_default boolean not null default false,
  status text not null default 'active' check (status in ('active', 'archived')),
  version bigint not null default 1 check (version > 0),
  structure_version bigint not null default 1 check (structure_version > 0),
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  archived_by uuid,
  unique (organization_id, id),
  check (
    (status = 'active' and archived_at is null and archived_by is null)
    or (status = 'archived' and archived_at is not null and archived_by is not null)
  ),
  check (not (is_default and status = 'archived')),
  check (updated_at >= created_at)
);

create unique index sales_pipelines_one_default_idx
  on public.sales_pipelines (organization_id)
  where is_default;
create unique index sales_pipelines_active_name_idx
  on public.sales_pipelines (organization_id, lower(name))
  where status = 'active';

create table public.sales_pipeline_stages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  pipeline_id uuid not null,
  key text not null check (key ~ '^[a-z][a-z0-9_]{0,39}$'),
  name text not null check (name = private.sales_clean_name(name)),
  kind text not null check (kind in ('open', 'won', 'lost')),
  default_probability_bps integer not null check (
    (kind = 'open' and default_probability_bps between 0 and 10000)
    or (kind = 'won' and default_probability_bps = 10000)
    or (kind = 'lost' and default_probability_bps = 0)
  ),
  position integer check (position is null or position between 1 and 50),
  status text not null default 'active' check (status in ('active', 'archived')),
  version bigint not null default 1 check (version > 0),
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  archived_by uuid,
  constraint sales_pipeline_stages_pipeline_fkey
    foreign key (organization_id, pipeline_id)
    references public.sales_pipelines(organization_id, id)
    on delete restrict,
  unique (organization_id, id),
  constraint sales_pipeline_stages_pipeline_key_key unique (pipeline_id, key),
  -- Deferred so that reorder/compaction can pass through transient duplicates.
  constraint sales_pipeline_stages_pipeline_position_key
    unique (pipeline_id, position) deferrable initially deferred,
  check ((status = 'active') = (position is not null)),
  check (
    (status = 'active' and archived_at is null and archived_by is null)
    or (status = 'archived' and archived_at is not null and archived_by is not null)
  ),
  check (updated_at >= created_at)
);

create unique index sales_pipeline_stages_one_active_won_idx
  on public.sales_pipeline_stages (pipeline_id)
  where kind = 'won' and status = 'active';
create unique index sales_pipeline_stages_active_name_idx
  on public.sales_pipeline_stages (pipeline_id, lower(name))
  where status = 'active';
create index sales_pipeline_stages_org_pipeline_idx
  on public.sales_pipeline_stages (organization_id, pipeline_id, status, position);

-- ---------------------------------------------------------------------------
-- Guard triggers (apply to every role, including the function owner)
-- ---------------------------------------------------------------------------

create function private.sales_reject_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception using
    errcode = '55000',
    message = 'SALES_IMMUTABLE',
    detail = format('%s on %s is not allowed', tg_op, tg_table_name);
end;
$$;

create trigger sales_audit_log_reject_mutation
before update or delete on public.sales_audit_log
for each row execute function private.sales_reject_mutation();

create trigger sales_audit_log_reject_truncate
before truncate on public.sales_audit_log
for each statement execute function private.sales_reject_mutation();

create trigger sales_pipelines_reject_truncate
before truncate on public.sales_pipelines
for each statement execute function private.sales_reject_mutation();

create trigger sales_pipeline_stages_reject_truncate
before truncate on public.sales_pipeline_stages
for each statement execute function private.sales_reject_mutation();

create function private.sales_pipelines_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception using errcode = '55000', message = 'SALES_IMMUTABLE',
      detail = 'Sales pipelines are archived, never deleted';
  end if;

  if tg_op = 'INSERT' then
    if new.version <> 1 or new.structure_version <> 1 or new.status <> 'active' then
      raise exception using errcode = '55000', message = 'SALES_IMMUTABLE',
        detail = 'New pipelines start active at version 1';
    end if;
    new.updated_at := new.created_at;
    return new;
  end if;

  if new.id is distinct from old.id
     or new.organization_id is distinct from old.organization_id
     or new.is_default is distinct from old.is_default
     or new.created_by is distinct from old.created_by
     or new.created_at is distinct from old.created_at then
    raise exception using errcode = '55000', message = 'SALES_IMMUTABLE',
      detail = 'Pipeline identity columns are immutable';
  end if;
  if old.status = 'archived' and new.status <> 'archived' then
    raise exception using errcode = '55000', message = 'SALES_IMMUTABLE',
      detail = 'Archived pipelines cannot be restored';
  end if;
  if new.structure_version < old.structure_version then
    raise exception using errcode = '55000', message = 'SALES_IMMUTABLE',
      detail = 'structure_version cannot decrease';
  end if;

  -- version and updated_at are always derived here; callers cannot set them.
  if new.name is distinct from old.name
     or new.status is distinct from old.status
     or new.archived_at is distinct from old.archived_at
     or new.archived_by is distinct from old.archived_by then
    new.version := old.version + 1;
    new.updated_at := greatest(now(), old.updated_at);
  elsif new.structure_version is distinct from old.structure_version then
    new.version := old.version;
    new.updated_at := greatest(now(), old.updated_at);
  else
    new.version := old.version;
    new.updated_at := old.updated_at;
  end if;
  return new;
end;
$$;

create trigger sales_pipelines_guard
before insert or update or delete on public.sales_pipelines
for each row execute function private.sales_pipelines_guard();

create function private.sales_pipeline_stages_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception using errcode = '55000', message = 'SALES_IMMUTABLE',
      detail = 'Sales pipeline stages are archived, never deleted';
  end if;

  if tg_op = 'INSERT' then
    if new.version <> 1 or new.status <> 'active' then
      raise exception using errcode = '55000', message = 'SALES_IMMUTABLE',
        detail = 'New stages start active at version 1';
    end if;
    if not exists (
      select 1 from public.sales_pipelines as pipeline
      where pipeline.id = new.pipeline_id
        and pipeline.organization_id = new.organization_id
        and pipeline.status = 'active'
    ) then
      raise exception using errcode = '55000', message = 'SALES_IMMUTABLE',
        detail = 'Stages can only be added to active pipelines';
    end if;
    new.updated_at := new.created_at;
    return new;
  end if;

  if new.id is distinct from old.id
     or new.organization_id is distinct from old.organization_id
     or new.pipeline_id is distinct from old.pipeline_id
     or new.key is distinct from old.key
     or new.kind is distinct from old.kind
     or new.created_by is distinct from old.created_by
     or new.created_at is distinct from old.created_at then
    raise exception using errcode = '55000', message = 'SALES_IMMUTABLE',
      detail = 'Stage identity columns are immutable';
  end if;
  if old.status = 'archived' and new.status <> 'archived' then
    raise exception using errcode = '55000', message = 'SALES_IMMUTABLE',
      detail = 'Archived stages cannot be restored';
  end if;

  -- version and updated_at are always derived here; callers cannot set them.
  if new.name is distinct from old.name
     or new.default_probability_bps is distinct from old.default_probability_bps
     or new.position is distinct from old.position
     or new.status is distinct from old.status
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

create trigger sales_pipeline_stages_guard
before insert or update or delete on public.sales_pipeline_stages
for each row execute function private.sales_pipeline_stages_guard();

-- Writes the parent pipeline row whenever stage structure changes. The row
-- write is the per-pipeline serialization point (see header).
create function private.sales_bump_pipeline_structure()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.sales_pipelines
  set structure_version = structure_version + 1
  where id = new.pipeline_id
    and organization_id = new.organization_id;
  return null;
end;
$$;

create trigger sales_pipeline_stages_bump_structure
after insert or update of status, position on public.sales_pipeline_stages
for each row execute function private.sales_bump_pipeline_structure();

-- Commit-time structural invariant for one pipeline.
create function private.sales_check_pipeline_structure()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_pipeline_id uuid;
  pipeline_status text;
  active_count integer;
  won_count integer;
  lost_count integer;
  min_position integer;
  max_position integer;
  distinct_positions integer;
begin
  if tg_table_name = 'sales_pipelines' then
    target_pipeline_id := new.id;
  else
    target_pipeline_id := new.pipeline_id;
  end if;

  select pipeline.status into pipeline_status
  from public.sales_pipelines as pipeline
  where pipeline.id = target_pipeline_id
  for update;

  if pipeline_status is distinct from 'active' then
    return null;
  end if;

  select
    count(*),
    count(*) filter (where stage.kind = 'won'),
    count(*) filter (where stage.kind = 'lost'),
    min(stage.position),
    max(stage.position),
    count(distinct stage.position)
  into active_count, won_count, lost_count, min_position, max_position, distinct_positions
  from public.sales_pipeline_stages as stage
  where stage.pipeline_id = target_pipeline_id
    and stage.status = 'active';

  if won_count <> 1 or lost_count < 1 then
    raise exception using
      errcode = '23514',
      message = 'SALES_TERMINAL_STAGE_INVARIANT',
      detail = format('pipeline %s has %s active won and %s active lost stages',
        target_pipeline_id, won_count, lost_count);
  end if;
  if active_count > 50
     or min_position <> 1
     or max_position <> active_count
     or distinct_positions <> active_count then
    raise exception using
      errcode = '23514',
      message = 'SALES_STAGE_POSITION_INVARIANT',
      detail = format('pipeline %s active positions are not 1..%s',
        target_pipeline_id, active_count);
  end if;
  return null;
end;
$$;

create constraint trigger sales_pipelines_check_structure
after insert on public.sales_pipelines
deferrable initially deferred
for each row execute function private.sales_check_pipeline_structure();

create constraint trigger sales_pipeline_stages_check_structure
after insert or update on public.sales_pipeline_stages
deferrable initially deferred
for each row execute function private.sales_check_pipeline_structure();

-- ---------------------------------------------------------------------------
-- Audit writer (only callable from the RPCs below)
-- ---------------------------------------------------------------------------

create function private.sales_write_audit(
  p_organization_id uuid,
  p_action text,
  p_entity_type text,
  p_entity_id uuid,
  p_details jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.sales_audit_log (
    organization_id, actor_user_id, action, entity_type, entity_id, details
  ) values (
    p_organization_id, (select auth.uid()), p_action, p_entity_type, p_entity_id,
    coalesce(p_details, '{}'::jsonb)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- RPCs
-- ---------------------------------------------------------------------------

-- Idempotent and concurrency-safe. Concurrent first calls race on the partial
-- unique index sales_pipelines_one_default_idx; exactly one inserts the
-- pipeline and its canonical stages, the rest wait and return that pipeline.
create function public.sales_ensure_default_pipeline()
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  organization uuid := private.sales_require('manage_pipeline');
  actor uuid := (select auth.uid());
  pipeline public.sales_pipelines;
  created boolean := false;
begin
  select * into pipeline
  from public.sales_pipelines as existing
  where existing.organization_id = organization and existing.is_default;

  if pipeline.id is null then
    insert into public.sales_pipelines (organization_id, name, is_default, created_by)
    values (organization, 'Pipeline principal', true, actor)
    on conflict (organization_id) where is_default do nothing
    returning * into pipeline;

    if pipeline.id is not null then
      created := true;
      insert into public.sales_pipeline_stages (
        organization_id, pipeline_id, key, name, kind, default_probability_bps, position, created_by
      )
      select organization, pipeline.id, canonical.key, canonical.name, canonical.kind,
             canonical.probability, canonical.position, actor
      from (values
        ('new', 'Nuevo', 'open', 1000, 1),
        ('qualified', 'Calificado', 'open', 2500, 2),
        ('proposal', 'Propuesta', 'open', 5000, 3),
        ('negotiation', U&'Negociaci\00F3n', 'open', 7500, 4),
        ('won', 'Ganado', 'won', 10000, 5),
        ('lost', 'Perdido', 'lost', 0, 6)
      ) as canonical(key, name, kind, probability, position);

      perform private.sales_write_audit(
        organization, 'sales.pipeline.created', 'pipeline', pipeline.id,
        jsonb_build_object(
          'name', pipeline.name,
          'is_default', true,
          'stages', (
            select jsonb_agg(jsonb_build_object(
              'id', stage.id, 'key', stage.key, 'kind', stage.kind, 'position', stage.position
            ) order by stage.position)
            from public.sales_pipeline_stages as stage
            where stage.pipeline_id = pipeline.id
          )
        )
      );
    else
      select * into pipeline
      from public.sales_pipelines as existing
      where existing.organization_id = organization and existing.is_default;
      if pipeline.id is null then
        raise exception using errcode = '40001', message = 'SALES_RETRY';
      end if;
    end if;
  end if;

  -- Re-read the pipeline so structure_version reflects the inserted stages.
  select * into pipeline from public.sales_pipelines where id = pipeline.id;

  return jsonb_build_object(
    'was_created', created,
    'pipeline', to_jsonb(pipeline),
    'stages', coalesce((
      select jsonb_agg(to_jsonb(stage) order by stage.position)
      from public.sales_pipeline_stages as stage
      where stage.pipeline_id = pipeline.id and stage.status = 'active'
    ), '[]'::jsonb)
  );
end;
$$;

create function public.sales_create_stage(
  p_pipeline_id uuid,
  p_key text,
  p_name text,
  p_kind text,
  p_default_probability_bps integer default null
)
returns public.sales_pipeline_stages
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  organization uuid := private.sales_require('manage_pipeline');
  actor uuid := (select auth.uid());
  clean_name text := private.sales_clean_name(p_name);
  probability integer;
  active_count integer;
  stage public.sales_pipeline_stages;
begin
  if p_pipeline_id is null
     or p_key is null or p_key !~ '^[a-z][a-z0-9_]{0,39}$'
     or clean_name is null
     or p_kind is null or p_kind not in ('open', 'won', 'lost') then
    raise exception using errcode = '22023', message = 'SALES_INVALID_INPUT';
  end if;

  probability := case p_kind
    when 'won' then coalesce(p_default_probability_bps, 10000)
    when 'lost' then coalesce(p_default_probability_bps, 0)
    else coalesce(p_default_probability_bps, 0)
  end;
  if (p_kind = 'won' and probability <> 10000)
     or (p_kind = 'lost' and probability <> 0)
     or probability not between 0 and 10000 then
    raise exception using errcode = '22023', message = 'SALES_INVALID_INPUT';
  end if;

  -- Per-pipeline serialization point; also proves organization ownership.
  perform 1 from public.sales_pipelines as pipeline
  where pipeline.id = p_pipeline_id
    and pipeline.organization_id = organization
    and pipeline.status = 'active'
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'SALES_NOT_FOUND';
  end if;

  if exists (
    select 1 from public.sales_pipeline_stages as existing
    where existing.pipeline_id = p_pipeline_id and existing.key = p_key
  ) then
    raise exception using errcode = '23505', message = 'SALES_STAGE_KEY_EXISTS';
  end if;
  if exists (
    select 1 from public.sales_pipeline_stages as existing
    where existing.pipeline_id = p_pipeline_id
      and existing.status = 'active'
      and lower(existing.name) = lower(clean_name)
  ) then
    raise exception using errcode = '23505', message = 'SALES_STAGE_NAME_EXISTS';
  end if;
  if p_kind = 'won' and exists (
    select 1 from public.sales_pipeline_stages as existing
    where existing.pipeline_id = p_pipeline_id
      and existing.status = 'active'
      and existing.kind = 'won'
  ) then
    raise exception using errcode = '23505', message = 'SALES_WON_STAGE_EXISTS';
  end if;

  select count(*) into active_count
  from public.sales_pipeline_stages as existing
  where existing.pipeline_id = p_pipeline_id and existing.status = 'active';
  if active_count >= 50 then
    raise exception using errcode = '54000', message = 'SALES_STAGE_LIMIT';
  end if;

  insert into public.sales_pipeline_stages (
    organization_id, pipeline_id, key, name, kind, default_probability_bps, position, created_by
  ) values (
    organization, p_pipeline_id, p_key, clean_name, p_kind, probability, active_count + 1, actor
  )
  returning * into stage;

  perform private.sales_write_audit(
    organization, 'sales.stage.created', 'stage', stage.id,
    jsonb_build_object(
      'pipeline_id', stage.pipeline_id,
      'key', stage.key,
      'name', stage.name,
      'kind', stage.kind,
      'default_probability_bps', stage.default_probability_bps,
      'position', stage.position
    )
  );
  return stage;
end;
$$;

-- Patch keys: name, default_probability_bps. Optimistic locking through
-- p_expected_version; a no-op returns the row without a version bump or audit.
create function public.sales_update_stage(
  p_stage_id uuid,
  p_changes jsonb,
  p_expected_version bigint
)
returns public.sales_pipeline_stages
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  organization uuid := private.sales_require('manage_pipeline');
  current_stage public.sales_pipeline_stages;
  stage public.sales_pipeline_stages;
  new_name text;
  new_probability integer;
  raw_probability numeric;
  change_set jsonb := '{}'::jsonb;
begin
  if p_stage_id is null
     or p_expected_version is null
     or p_changes is null
     or jsonb_typeof(p_changes) <> 'object'
     or p_changes = '{}'::jsonb
     or exists (
       select 1 from jsonb_object_keys(p_changes) as change_key
       where change_key not in ('name', 'default_probability_bps')
     ) then
    raise exception using errcode = '22023', message = 'SALES_INVALID_INPUT';
  end if;

  select * into current_stage
  from public.sales_pipeline_stages as existing
  where existing.id = p_stage_id and existing.organization_id = organization;
  if current_stage.id is null then
    raise exception using errcode = 'P0002', message = 'SALES_NOT_FOUND';
  end if;

  -- Per-pipeline serialization point, then re-read the stage under lock.
  perform 1 from public.sales_pipelines as pipeline
  where pipeline.id = current_stage.pipeline_id
    and pipeline.organization_id = organization
  for update;
  select * into current_stage
  from public.sales_pipeline_stages as existing
  where existing.id = p_stage_id and existing.organization_id = organization
  for update;

  if current_stage.status <> 'active' then
    raise exception using errcode = '55000', message = 'SALES_STAGE_ARCHIVED';
  end if;
  if current_stage.version <> p_expected_version then
    raise exception using errcode = 'P0001', message = 'SALES_VERSION_CONFLICT',
      detail = format('expected %s, current %s', p_expected_version, current_stage.version);
  end if;

  new_name := current_stage.name;
  if p_changes ? 'name' then
    if jsonb_typeof(p_changes -> 'name') <> 'string' then
      raise exception using errcode = '22023', message = 'SALES_INVALID_INPUT';
    end if;
    new_name := private.sales_clean_name(p_changes ->> 'name');
    if new_name is null then
      raise exception using errcode = '22023', message = 'SALES_INVALID_INPUT';
    end if;
  end if;

  new_probability := current_stage.default_probability_bps;
  if p_changes ? 'default_probability_bps' then
    if jsonb_typeof(p_changes -> 'default_probability_bps') <> 'number' then
      raise exception using errcode = '22023', message = 'SALES_INVALID_INPUT';
    end if;
    raw_probability := (p_changes ->> 'default_probability_bps')::numeric;
    if raw_probability <> trunc(raw_probability)
       or raw_probability not between 0 and 10000 then
      raise exception using errcode = '22023', message = 'SALES_INVALID_INPUT';
    end if;
    new_probability := raw_probability::integer;
    if (current_stage.kind = 'won' and new_probability <> 10000)
       or (current_stage.kind = 'lost' and new_probability <> 0) then
      raise exception using errcode = '22023', message = 'SALES_INVALID_INPUT';
    end if;
  end if;

  if new_name is not distinct from current_stage.name
     and new_probability is not distinct from current_stage.default_probability_bps then
    return current_stage;
  end if;

  if new_name is distinct from current_stage.name then
    if exists (
      select 1 from public.sales_pipeline_stages as other
      where other.pipeline_id = current_stage.pipeline_id
        and other.status = 'active'
        and other.id <> current_stage.id
        and lower(other.name) = lower(new_name)
    ) then
      raise exception using errcode = '23505', message = 'SALES_STAGE_NAME_EXISTS';
    end if;
    change_set := change_set || jsonb_build_object(
      'name', jsonb_build_object('from', current_stage.name, 'to', new_name));
  end if;
  if new_probability is distinct from current_stage.default_probability_bps then
    change_set := change_set || jsonb_build_object(
      'default_probability_bps', jsonb_build_object(
        'from', current_stage.default_probability_bps, 'to', new_probability));
  end if;

  update public.sales_pipeline_stages
  set name = new_name,
      default_probability_bps = new_probability
  where id = current_stage.id
  returning * into stage;

  perform private.sales_write_audit(
    organization, 'sales.stage.updated', 'stage', stage.id,
    jsonb_build_object(
      'pipeline_id', stage.pipeline_id,
      'version_from', current_stage.version,
      'version_to', stage.version,
      'changes', change_set
    )
  );
  return stage;
end;
$$;

-- p_stage_ids must be exactly the complete set of active stage ids of the
-- pipeline, in the desired order. An identical order is a no-op (no audit).
create function public.sales_reorder_stages(
  p_pipeline_id uuid,
  p_stage_ids uuid[]
)
returns setof public.sales_pipeline_stages
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  organization uuid := private.sales_require('manage_pipeline');
  current_ids uuid[];
begin
  if p_pipeline_id is null
     or p_stage_ids is null
     or coalesce(array_ndims(p_stage_ids), 0) <> 1
     or cardinality(p_stage_ids) not between 1 and 50 then
    raise exception using errcode = '22023', message = 'SALES_INVALID_INPUT';
  end if;

  perform 1 from public.sales_pipelines as pipeline
  where pipeline.id = p_pipeline_id
    and pipeline.organization_id = organization
    and pipeline.status = 'active'
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'SALES_NOT_FOUND';
  end if;

  select coalesce(array_agg(stage.id order by stage.position), '{}'::uuid[])
  into current_ids
  from public.sales_pipeline_stages as stage
  where stage.pipeline_id = p_pipeline_id
    and stage.organization_id = organization
    and stage.status = 'active';

  if array_position(p_stage_ids, null) is not null
     or cardinality(p_stage_ids) <> cardinality(current_ids)
     or (select count(distinct requested) from unnest(p_stage_ids) as requested)
        <> cardinality(p_stage_ids)
     or exists (
       select requested from unnest(p_stage_ids) as requested
       except
       select existing from unnest(current_ids) as existing
     ) then
    raise exception using errcode = '22023', message = 'SALES_INVALID_STAGE_SET';
  end if;

  if p_stage_ids <> current_ids then
    update public.sales_pipeline_stages as stage
    set position = requested.ordinal::integer
    from unnest(p_stage_ids) with ordinality as requested(stage_id, ordinal)
    where stage.id = requested.stage_id
      and stage.pipeline_id = p_pipeline_id
      and stage.organization_id = organization
      and stage.position is distinct from requested.ordinal::integer;

    perform private.sales_write_audit(
      organization, 'sales.stages.reordered', 'pipeline', p_pipeline_id,
      jsonb_build_object('before', to_jsonb(current_ids), 'after', to_jsonb(p_stage_ids))
    );
  end if;

  return query
  select stage.*
  from public.sales_pipeline_stages as stage
  where stage.pipeline_id = p_pipeline_id and stage.status = 'active'
  order by stage.position;
end;
$$;

-- Archives a stage and compacts the remaining positions. The only active won
-- stage and the last active lost stage cannot be archived. Archiving an
-- archived stage returns it unchanged (no audit).
create function public.sales_archive_stage(p_stage_id uuid)
returns public.sales_pipeline_stages
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  organization uuid := private.sales_require('manage_pipeline');
  actor uuid := (select auth.uid());
  current_stage public.sales_pipeline_stages;
  stage public.sales_pipeline_stages;
begin
  if p_stage_id is null then
    raise exception using errcode = '22023', message = 'SALES_INVALID_INPUT';
  end if;

  select * into current_stage
  from public.sales_pipeline_stages as existing
  where existing.id = p_stage_id and existing.organization_id = organization;
  if current_stage.id is null then
    raise exception using errcode = 'P0002', message = 'SALES_NOT_FOUND';
  end if;

  -- Per-pipeline serialization point, then re-read the stage under lock.
  perform 1 from public.sales_pipelines as pipeline
  where pipeline.id = current_stage.pipeline_id
    and pipeline.organization_id = organization
  for update;
  select * into current_stage
  from public.sales_pipeline_stages as existing
  where existing.id = p_stage_id and existing.organization_id = organization
  for update;

  if current_stage.status = 'archived' then
    return current_stage;
  end if;
  if current_stage.kind = 'won' and (
    select count(*) from public.sales_pipeline_stages as other
    where other.pipeline_id = current_stage.pipeline_id
      and other.status = 'active'
      and other.kind = 'won'
  ) <= 1 then
    raise exception using errcode = '23514', message = 'SALES_LAST_WON_STAGE';
  end if;
  if current_stage.kind = 'lost' and (
    select count(*) from public.sales_pipeline_stages as other
    where other.pipeline_id = current_stage.pipeline_id
      and other.status = 'active'
      and other.kind = 'lost'
  ) <= 1 then
    raise exception using errcode = '23514', message = 'SALES_LAST_LOST_STAGE';
  end if;

  update public.sales_pipeline_stages
  set status = 'archived',
      position = null,
      archived_at = now(),
      archived_by = actor
  where id = current_stage.id
  returning * into stage;

  update public.sales_pipeline_stages as other
  set position = other.position - 1
  where other.pipeline_id = current_stage.pipeline_id
    and other.status = 'active'
    and other.position > current_stage.position;

  perform private.sales_write_audit(
    organization, 'sales.stage.archived', 'stage', stage.id,
    jsonb_build_object(
      'pipeline_id', stage.pipeline_id,
      'key', stage.key,
      'kind', stage.kind,
      'previous_position', current_stage.position,
      'version_from', current_stage.version,
      'version_to', stage.version
    )
  );
  return stage;
end;
$$;

-- ---------------------------------------------------------------------------
-- Row level security (read-only; all writes go through the RPCs)
-- ---------------------------------------------------------------------------

alter table public.sales_audit_log enable row level security;
alter table public.sales_pipelines enable row level security;
alter table public.sales_pipeline_stages enable row level security;

create policy sales_audit_log_select on public.sales_audit_log
for select to authenticated
using (
  organization_id = (select public.current_user_organization_id())
  and (select private.sales_can('read'))
);

create policy sales_pipelines_select on public.sales_pipelines
for select to authenticated
using (
  organization_id = (select public.current_user_organization_id())
  and (select private.sales_can('read'))
);

create policy sales_pipeline_stages_select on public.sales_pipeline_stages
for select to authenticated
using (
  organization_id = (select public.current_user_organization_id())
  and (select private.sales_can('read'))
);

-- ---------------------------------------------------------------------------
-- Ownership and grants
-- ---------------------------------------------------------------------------

alter function private.sales_can(text) owner to postgres;
alter function private.sales_require(text) owner to postgres;
alter function private.sales_clean_name(text) owner to postgres;
alter function private.sales_reject_mutation() owner to postgres;
alter function private.sales_pipelines_guard() owner to postgres;
alter function private.sales_pipeline_stages_guard() owner to postgres;
alter function private.sales_bump_pipeline_structure() owner to postgres;
alter function private.sales_check_pipeline_structure() owner to postgres;
alter function private.sales_write_audit(uuid, text, text, uuid, jsonb) owner to postgres;
alter function public.sales_ensure_default_pipeline() owner to postgres;
alter function public.sales_create_stage(uuid, text, text, text, integer) owner to postgres;
alter function public.sales_update_stage(uuid, jsonb, bigint) owner to postgres;
alter function public.sales_reorder_stages(uuid, uuid[]) owner to postgres;
alter function public.sales_archive_stage(uuid) owner to postgres;

revoke all on function private.sales_can(text) from public, anon, authenticated, service_role;
revoke all on function private.sales_require(text) from public, anon, authenticated, service_role;
revoke all on function private.sales_clean_name(text) from public, anon, authenticated, service_role;
revoke all on function private.sales_reject_mutation() from public, anon, authenticated, service_role;
revoke all on function private.sales_pipelines_guard() from public, anon, authenticated, service_role;
revoke all on function private.sales_pipeline_stages_guard() from public, anon, authenticated, service_role;
revoke all on function private.sales_bump_pipeline_structure() from public, anon, authenticated, service_role;
revoke all on function private.sales_check_pipeline_structure() from public, anon, authenticated, service_role;
revoke all on function private.sales_write_audit(uuid, text, text, uuid, jsonb) from public, anon, authenticated, service_role;
revoke all on function public.sales_ensure_default_pipeline() from public, anon, authenticated, service_role;
revoke all on function public.sales_create_stage(uuid, text, text, text, integer) from public, anon, authenticated, service_role;
revoke all on function public.sales_update_stage(uuid, jsonb, bigint) from public, anon, authenticated, service_role;
revoke all on function public.sales_reorder_stages(uuid, uuid[]) from public, anon, authenticated, service_role;
revoke all on function public.sales_archive_stage(uuid) from public, anon, authenticated, service_role;

-- RLS policies evaluate sales_can as the querying role. It only reveals the
-- caller's own permission and is not exposed through the API schema.
grant execute on function private.sales_can(text) to authenticated;

grant execute on function public.sales_ensure_default_pipeline() to authenticated;
grant execute on function public.sales_create_stage(uuid, text, text, text, integer) to authenticated;
grant execute on function public.sales_update_stage(uuid, jsonb, bigint) to authenticated;
grant execute on function public.sales_reorder_stages(uuid, uuid[]) to authenticated;
grant execute on function public.sales_archive_stage(uuid) to authenticated;

revoke all on table public.sales_audit_log, public.sales_pipelines, public.sales_pipeline_stages
  from public, anon, authenticated, service_role;
revoke all on sequence public.sales_audit_log_id_seq
  from public, anon, authenticated, service_role;
grant select on table public.sales_audit_log, public.sales_pipelines, public.sales_pipeline_stages
  to authenticated;

comment on table public.sales_audit_log is
  'Append-only audit of every Sales mutation. UPDATE, DELETE and TRUNCATE are rejected for every role.';
comment on table public.sales_pipelines is
  'Sales pipelines per organization. At most one default. Archived, never deleted.';
comment on table public.sales_pipeline_stages is
  'Ordered pipeline stages. Exactly one active won stage and at least one active lost stage per active pipeline (checked at commit).';

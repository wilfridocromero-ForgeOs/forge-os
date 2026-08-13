-- ORVESEN OS - Company Master Score V1
-- Canonical backend chain:
-- Discovery -> Score Template Result -> Division Score -> Company Master Score.
-- Performance and coverage remain independent at every aggregation level.

create table public.score_template_results (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  division_id uuid not null references public.divisions(id) on delete restrict,
  template_id uuid not null references public.score_templates(id) on delete restrict,
  assessment_id uuid references public.discovery_assessments(id) on delete restrict,
  source_type text not null check (source_type in ('discovery', 'manual', 'integration')),
  source_id text not null,
  score_percentage numeric(7,4),
  coverage_percentage numeric(7,4) not null,
  status text not null check (status in ('evaluated', 'partial', 'stale')),
  calculation_version integer not null default 1 check (calculation_version > 0),
  evaluated_at timestamptz not null,
  created_at timestamptz not null default now(),
  check (score_percentage is null or score_percentage between 0 and 100),
  check (coverage_percentage between 0 and 100),
  check (source_type <> 'discovery' or assessment_id is not null)
);

create unique index score_template_results_assessment_uidx
  on public.score_template_results(assessment_id)
  where assessment_id is not null;
create unique index score_template_results_source_uidx
  on public.score_template_results(organization_id, source_type, source_id, template_id);
create index score_template_results_current_idx
  on public.score_template_results(organization_id, division_id, template_id, evaluated_at desc, created_at desc);
create index score_template_results_template_idx
  on public.score_template_results(template_id);

create table public.division_score_models (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  division_id uuid not null references public.divisions(id) on delete restrict,
  name text not null check (char_length(trim(name)) between 2 and 120),
  status text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  version integer not null default 1 check (version > 0),
  stale_after_days integer default 90
    check (stale_after_days is null or stale_after_days > 0),
  created_at timestamptz not null default now(),
  published_at timestamptz,
  unique (organization_id, division_id, version),
  check ((status = 'published' and published_at is not null) or status <> 'published')
);

create unique index division_score_models_one_published_idx
  on public.division_score_models(organization_id, division_id)
  where status = 'published';
create index division_score_models_org_idx
  on public.division_score_models(organization_id, division_id, status);

create table public.division_score_components (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  model_id uuid not null references public.division_score_models(id) on delete cascade,
  template_id uuid not null references public.score_templates(id) on delete restrict,
  weight numeric(7,4) not null check (weight > 0 and weight <= 100),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (model_id, template_id)
);

create index division_score_components_model_idx
  on public.division_score_components(model_id, active);
create index division_score_components_template_idx
  on public.division_score_components(template_id);
create index division_score_components_org_idx
  on public.division_score_components(organization_id);

create table public.division_score_snapshots (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  division_id uuid not null references public.divisions(id) on delete restrict,
  model_id uuid not null references public.division_score_models(id) on delete restrict,
  performance_percentage numeric(7,4),
  coverage_percentage numeric(7,4) not null,
  status text not null check (status in ('unevaluated', 'insufficient_data', 'partial', 'current', 'stale')),
  calculation_version integer not null default 1 check (calculation_version > 0),
  idempotency_key text not null,
  calculated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  check (performance_percentage is null or performance_percentage between 0 and 100),
  check (coverage_percentage between 0 and 100),
  check ((status = 'unevaluated' and performance_percentage is null)
    or status <> 'unevaluated'),
  unique (model_id, idempotency_key)
);

create index division_score_snapshots_current_idx
  on public.division_score_snapshots(organization_id, division_id, calculated_at desc, created_at desc);
create index division_score_snapshots_model_idx
  on public.division_score_snapshots(model_id, calculated_at desc);

create table public.division_score_snapshot_components (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  snapshot_id uuid not null references public.division_score_snapshots(id) on delete cascade,
  template_id uuid not null references public.score_templates(id) on delete restrict,
  template_result_id uuid references public.score_template_results(id) on delete restrict,
  configured_weight numeric(7,4) not null check (configured_weight > 0 and configured_weight <= 100),
  represented boolean not null,
  template_score_percentage numeric(7,4),
  template_coverage_percentage numeric(7,4) not null,
  weighted_performance_contribution numeric(12,6),
  weighted_coverage_contribution numeric(12,6) not null,
  created_at timestamptz not null default now(),
  check (template_score_percentage is null or template_score_percentage between 0 and 100),
  check (template_coverage_percentage between 0 and 100),
  check ((represented and template_result_id is not null and template_score_percentage is not null)
    or (not represented and template_result_id is null and template_score_percentage is null)),
  unique (snapshot_id, template_id)
);

create index division_snapshot_components_snapshot_idx
  on public.division_score_snapshot_components(snapshot_id);
create index division_snapshot_components_result_idx
  on public.division_score_snapshot_components(template_result_id)
  where template_result_id is not null;
create index division_snapshot_components_org_idx
  on public.division_score_snapshot_components(organization_id);

create table public.company_score_models (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 2 and 120),
  status text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  version integer not null default 1 check (version > 0),
  minimum_publishable_coverage numeric(7,4) default 60,
  stale_after_days integer default 90
    check (stale_after_days is null or stale_after_days > 0),
  created_at timestamptz not null default now(),
  published_at timestamptz,
  unique (organization_id, version),
  check (minimum_publishable_coverage is null or minimum_publishable_coverage > 0
    and minimum_publishable_coverage <= 100),
  check ((status = 'published' and published_at is not null
    and minimum_publishable_coverage is not null) or status <> 'published')
);

create unique index company_score_models_one_published_idx
  on public.company_score_models(organization_id)
  where status = 'published';
create index company_score_models_org_idx
  on public.company_score_models(organization_id, status);

create table public.company_score_components (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  model_id uuid not null references public.company_score_models(id) on delete cascade,
  division_id uuid not null references public.divisions(id) on delete restrict,
  weight numeric(7,4) not null check (weight > 0 and weight <= 100),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (model_id, division_id)
);

create index company_score_components_model_idx
  on public.company_score_components(model_id, active);
create index company_score_components_division_idx
  on public.company_score_components(division_id);
create index company_score_components_org_idx
  on public.company_score_components(organization_id);

create table public.company_score_snapshots (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  model_id uuid not null references public.company_score_models(id) on delete restrict,
  performance_percentage numeric(7,4),
  master_score integer,
  coverage_percentage numeric(7,4) not null,
  status text not null check (status in ('unevaluated', 'insufficient_data', 'partial', 'current', 'stale')),
  calculation_version integer not null default 1 check (calculation_version > 0),
  idempotency_key text not null,
  calculated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  check (performance_percentage is null or performance_percentage between 0 and 100),
  check (master_score is null or master_score between 0 and 1000),
  check (coverage_percentage between 0 and 100),
  check ((master_score is null and status in ('unevaluated', 'insufficient_data'))
    or (master_score is not null and performance_percentage is not null
      and status in ('partial', 'current', 'stale'))),
  check (status <> 'unevaluated' or performance_percentage is null),
  unique (model_id, idempotency_key)
);

create index company_score_snapshots_current_idx
  on public.company_score_snapshots(organization_id, calculated_at desc, created_at desc);
create index company_score_snapshots_model_idx
  on public.company_score_snapshots(model_id, calculated_at desc);

create table public.company_score_snapshot_components (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  snapshot_id uuid not null references public.company_score_snapshots(id) on delete cascade,
  division_id uuid not null references public.divisions(id) on delete restrict,
  division_snapshot_id uuid references public.division_score_snapshots(id) on delete restrict,
  configured_weight numeric(7,4) not null check (configured_weight > 0 and configured_weight <= 100),
  represented boolean not null,
  division_performance_percentage numeric(7,4),
  division_coverage_percentage numeric(7,4) not null,
  weighted_performance_contribution numeric(12,6),
  weighted_coverage_contribution numeric(12,6) not null,
  created_at timestamptz not null default now(),
  check (division_performance_percentage is null or division_performance_percentage between 0 and 100),
  check (division_coverage_percentage between 0 and 100),
  check ((represented and division_snapshot_id is not null and division_performance_percentage is not null)
    or (not represented and division_snapshot_id is null and division_performance_percentage is null)),
  unique (snapshot_id, division_id)
);

create index company_snapshot_components_snapshot_idx
  on public.company_score_snapshot_components(snapshot_id);
create index company_snapshot_components_division_snapshot_idx
  on public.company_score_snapshot_components(division_snapshot_id)
  where division_snapshot_id is not null;
create index company_snapshot_components_org_idx
  on public.company_score_snapshot_components(organization_id);

-- Validate model/component tenant compatibility and published weights.
create or replace function public.validate_division_score_component()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  model_record public.division_score_models;
  template_record public.score_templates;
begin
  if tg_op = 'DELETE' then
    select * into model_record from public.division_score_models where id = old.model_id;
    if model_record.status <> 'draft' then
      raise exception 'Solo pueden modificarse componentes de modelos draft';
    end if;
    return old;
  end if;

  if tg_op = 'UPDATE' and old.model_id is distinct from new.model_id then
    select * into model_record
    from public.division_score_models
    where id = old.model_id;
    if model_record.status <> 'draft' then
      raise exception 'No puede mover componentes fuera de un modelo no draft';
    end if;
  end if;

  select * into model_record from public.division_score_models where id = new.model_id;
  select * into template_record from public.score_templates where id = new.template_id;

  if model_record.id is null or template_record.id is null then
    raise exception 'Modelo de division o plantilla Score no disponible';
  end if;
  if new.organization_id <> model_record.organization_id
     or template_record.organization_id <> model_record.organization_id
     or template_record.division_id is distinct from model_record.division_id then
    raise exception 'El componente debe pertenecer a la misma organizacion y division del modelo';
  end if;
  if model_record.status <> 'draft' then
    raise exception 'Solo pueden modificarse componentes de modelos draft';
  end if;
  return new;
end;
$$;

create or replace function public.validate_company_score_component()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  model_record public.company_score_models;
  division_organization_id uuid;
begin
  if tg_op = 'DELETE' then
    select * into model_record from public.company_score_models where id = old.model_id;
    if model_record.status <> 'draft' then
      raise exception 'Solo pueden modificarse componentes de modelos draft';
    end if;
    return old;
  end if;

  if tg_op = 'UPDATE' and old.model_id is distinct from new.model_id then
    select * into model_record
    from public.company_score_models
    where id = old.model_id;
    if model_record.status <> 'draft' then
      raise exception 'No puede mover componentes fuera de un modelo no draft';
    end if;
  end if;

  select * into model_record from public.company_score_models where id = new.model_id;
  select organization_id into division_organization_id from public.divisions where id = new.division_id;

  if model_record.id is null or division_organization_id is null then
    raise exception 'Modelo empresarial o division no disponible';
  end if;
  if new.organization_id <> model_record.organization_id
     or division_organization_id <> model_record.organization_id then
    raise exception 'El componente debe pertenecer a la misma organizacion del modelo';
  end if;
  if model_record.status <> 'draft' then
    raise exception 'Solo pueden modificarse componentes de modelos draft';
  end if;
  return new;
end;
$$;

create or replace function public.validate_division_score_model_publication()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  division_organization_id uuid;
  active_weight numeric;
begin
  if tg_op = 'DELETE' then
    if old.status <> 'draft' then
      raise exception 'Solo los modelos de division draft pueden eliminarse';
    end if;
    return old;
  end if;

  select organization_id into division_organization_id from public.divisions where id = new.division_id;
  if division_organization_id is distinct from new.organization_id then
    raise exception 'La division no pertenece a la organizacion del modelo';
  end if;
  if new.status = 'published' then
    select coalesce(sum(weight), 0) into active_weight
    from public.division_score_components where model_id = new.id and active;
    if active_weight <> 100 then
      raise exception 'Los pesos activos del modelo de division deben sumar 100%%; suma actual: %', active_weight;
    end if;
  end if;
  if tg_op = 'UPDATE' and old.status = 'published' and (
    new.status <> 'archived'
    or new.organization_id is distinct from old.organization_id
    or new.division_id is distinct from old.division_id
    or new.name is distinct from old.name
    or new.version is distinct from old.version
    or new.stale_after_days is distinct from old.stale_after_days
    or new.published_at is distinct from old.published_at
  ) then
    raise exception 'Un modelo publicado solo puede archivarse; cree una nueva version';
  end if;
  if tg_op = 'UPDATE' and old.status = 'archived' then
    raise exception 'Un modelo archivado es inmutable';
  end if;
  return new;
end;
$$;

create or replace function public.validate_company_score_model_publication()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  active_weight numeric;
begin
  if tg_op = 'DELETE' then
    if old.status <> 'draft' then
      raise exception 'Solo los modelos empresariales draft pueden eliminarse';
    end if;
    return old;
  end if;

  if new.status = 'published' then
    if new.minimum_publishable_coverage is null then
      raise exception 'Defina minimum_publishable_coverage antes de publicar';
    end if;
    select coalesce(sum(weight), 0) into active_weight
    from public.company_score_components where model_id = new.id and active;
    if active_weight <> 100 then
      raise exception 'Los pesos activos del modelo empresarial deben sumar 100%%; suma actual: %', active_weight;
    end if;
  end if;
  if tg_op = 'UPDATE' and old.status = 'published' and (
    new.status <> 'archived'
    or new.organization_id is distinct from old.organization_id
    or new.name is distinct from old.name
    or new.version is distinct from old.version
    or new.minimum_publishable_coverage is distinct from old.minimum_publishable_coverage
    or new.stale_after_days is distinct from old.stale_after_days
    or new.published_at is distinct from old.published_at
  ) then
    raise exception 'Un modelo publicado solo puede archivarse; cree una nueva version';
  end if;
  if tg_op = 'UPDATE' and old.status = 'archived' then
    raise exception 'Un modelo archivado es inmutable';
  end if;
  return new;
end;
$$;

create trigger validate_division_score_component_trigger
before insert or update or delete on public.division_score_components
for each row execute function public.validate_division_score_component();

create trigger validate_company_score_component_trigger
before insert or update or delete on public.company_score_components
for each row execute function public.validate_company_score_component();

create trigger validate_division_score_model_publication_trigger
before insert or update or delete on public.division_score_models
for each row execute function public.validate_division_score_model_publication();

create trigger validate_company_score_model_publication_trigger
before insert or update or delete on public.company_score_models
for each row execute function public.validate_company_score_model_publication();

-- Append-only Discovery materialization. Informative Discoveries (score is null)
-- return without creating a Score Template Result.
create or replace function private.materialize_score_template_result(target_assessment_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  assessment public.discovery_assessments;
  resolved_template_id uuid;
  resolved_division_id uuid;
  linked_template_count integer;
  expected_category_weight numeric;
  represented_category_weight numeric;
  calculated_coverage numeric;
  result_id uuid;
begin
  select * into assessment
  from public.discovery_assessments
  where id = target_assessment_id;

  if assessment.id is null or assessment.status <> 'completed' or assessment.score is null then
    return null;
  end if;

  if (select auth.uid()) is not null
     and assessment.organization_id is distinct from (select public.current_user_organization_id())
     and not (select public.is_platform_owner()) then
    raise exception 'La evaluacion no pertenece a la organizacion del usuario';
  end if;

  select count(distinct category.template_id),
    (array_agg(distinct category.template_id))[1]
  into linked_template_count, resolved_template_id
  from public.discovery_question_score_links link
  join public.discovery_questions discovery_question on discovery_question.id = link.discovery_question_id
  join public.discovery_sections section on section.id = discovery_question.section_id
  join public.score_questions score_question on score_question.id = link.score_question_id
  join public.score_categories category on category.id = score_question.category_id
  where section.template_id = assessment.discovery_template_id
    and link.active;

  if linked_template_count = 0 then
    return null;
  end if;
  if linked_template_count <> 1 then
    raise exception 'El Discovery evaluativo debe resolver exactamente una plantilla Score';
  end if;

  select division_id into resolved_division_id
  from public.score_templates
  where id = resolved_template_id
    and organization_id = assessment.organization_id;

  if resolved_division_id is null
     or assessment.division_id is distinct from resolved_division_id then
    raise exception 'La plantilla Score, evaluacion y division no son compatibles';
  end if;

  -- Template coverage:
  -- sum(category_weight * represented_question_weight / expected_question_weight)
  -- / sum(expected_category_weight) * 100.
  with expected_questions as (
    select
      category.id as category_id,
      category.weight as category_weight,
      sum(question.weight) filter (
        where question.weight > 0 and public.is_score_question_scorable(question.id)
      ) as expected_question_weight
    from public.score_categories category
    left join public.score_questions question on question.category_id = category.id
    where category.template_id = resolved_template_id
      and category.weight > 0
    group by category.id, category.weight
  ), represented_questions as (
    select distinct response.question_id
    from public.discovery_responses response
    join public.discovery_question_score_links link
      on link.discovery_question_id = response.discovery_question_id
     and link.score_question_id = response.question_id
     and link.active
    where response.assessment_id = target_assessment_id
      and response.numeric_score is not null
  ), category_coverage as (
    select
      expected.category_weight,
      expected.expected_question_weight,
      coalesce(sum(question.weight) filter (
        where represented.question_id is not null
      ), 0) as represented_question_weight
    from expected_questions expected
    left join public.score_questions question on question.category_id = expected.category_id
    left join represented_questions represented on represented.question_id = question.id
    where expected.expected_question_weight > 0
    group by expected.category_id, expected.category_weight, expected.expected_question_weight
  )
  select
    sum(category_weight),
    sum(category_weight * represented_question_weight / expected_question_weight)
  into expected_category_weight, represented_category_weight
  from category_coverage;

  calculated_coverage := case
    when coalesce(expected_category_weight, 0) = 0 then 0
    else round(least(100, greatest(0,
      represented_category_weight / expected_category_weight * 100
    )), 4)
  end;

  insert into public.score_template_results(
    organization_id, division_id, template_id, assessment_id,
    source_type, source_id, score_percentage, coverage_percentage,
    status, calculation_version, evaluated_at
  ) values (
    assessment.organization_id,
    resolved_division_id,
    resolved_template_id,
    assessment.id,
    'discovery',
    assessment.id::text,
    round(assessment.score / nullif(assessment.max_score, 0) * 100, 4),
    calculated_coverage,
    case when calculated_coverage < 100 then 'partial' else 'evaluated' end,
    1,
    coalesce(assessment.completed_at, assessment.updated_at)
  )
  on conflict (assessment_id) where assessment_id is not null do nothing
  returning id into result_id;

  if result_id is null then
    select id into result_id
    from public.score_template_results
    where assessment_id = target_assessment_id;
  end if;

  return result_id;
end;
$$;

create or replace function private.handle_completed_discovery_score_result()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'completed' and new.score is not null then
    perform private.materialize_score_template_result(new.id);
  end if;
  return new;
end;
$$;

create trigger materialize_completed_discovery_score_result_trigger
after insert or update of status, score, completed_at
on public.discovery_assessments
for each row execute function private.handle_completed_discovery_score_result();

revoke all on function private.materialize_score_template_result(uuid) from public, anon, authenticated;
revoke all on function private.handle_completed_discovery_score_result() from public, anon, authenticated;

-- Canonical division calculation. A stable set of latest Template Results maps
-- to one idempotency key, so immediate retries reuse the same snapshot.
create or replace function public.calculate_division_score(target_model_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  model_record public.division_score_models;
  expected_weight numeric;
  represented_weight numeric;
  weighted_performance numeric;
  weighted_coverage numeric;
  calculated_performance numeric;
  calculated_coverage numeric;
  calculated_status text;
  calculation_key text;
  snapshot_id uuid;
  has_stale boolean;
begin
  select * into model_record from public.division_score_models where id = target_model_id;
  if model_record.id is null or model_record.status <> 'published' then
    raise exception 'El modelo de division debe estar publicado';
  end if;
  if not (select public.can_manage_organization(model_record.organization_id)) then
    raise exception 'No autorizado para calcular esta organizacion';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('division-score:' || target_model_id::text, 0));

  with latest_results as (
    select component.id component_id, component.template_id, component.weight,
      result.id result_id, result.score_percentage, result.coverage_percentage,
      result.evaluated_at
    from public.division_score_components component
    left join lateral (
      select candidate.* from public.score_template_results candidate
      where candidate.organization_id = model_record.organization_id
        and candidate.division_id = model_record.division_id
        and candidate.template_id = component.template_id
        and candidate.score_percentage is not null
      order by candidate.evaluated_at desc, candidate.created_at desc, candidate.id desc
      limit 1
    ) result on true
    where component.model_id = target_model_id and component.active
  )
  select
    coalesce(sum(weight), 0),
    coalesce(sum(weight) filter (where result_id is not null), 0),
    sum(score_percentage * weight) filter (where result_id is not null),
    coalesce(sum(weight * coalesce(coverage_percentage, 0)), 0),
    coalesce(bool_or(model_record.stale_after_days is not null
      and evaluated_at < now() - make_interval(days => model_record.stale_after_days)), false),
    coalesce(string_agg(template_id::text || '=' || coalesce(result_id::text, 'none'), ',' order by template_id), '')
  into expected_weight, represented_weight, weighted_performance,
    weighted_coverage, has_stale, calculation_key
  from latest_results;

  if expected_weight <> 100 then
    raise exception 'Los pesos activos del modelo publicado deben sumar 100';
  end if;

  calculation_key := md5(
    model_record.id::text || ':' || model_record.version::text
    || ':1:stale=' || has_stale::text || ':' || calculation_key
  );

  calculated_performance := case when represented_weight = 0 then null
    else round(weighted_performance / represented_weight, 4) end;
  calculated_coverage := round(weighted_coverage / expected_weight, 4);
  calculated_status := case
    when represented_weight = 0 then 'unevaluated'
    when calculated_coverage = 0 then 'insufficient_data'
    when has_stale then 'stale'
    when calculated_coverage < 100 then 'partial'
    else 'current'
  end;

  insert into public.division_score_snapshots(
    organization_id, division_id, model_id, performance_percentage,
    coverage_percentage, status, calculation_version, idempotency_key
  ) values (
    model_record.organization_id, model_record.division_id, model_record.id,
    calculated_performance, calculated_coverage, calculated_status, 1, calculation_key
  )
  on conflict (model_id, idempotency_key) do nothing
  returning id into snapshot_id;

  if snapshot_id is null then
    select id into snapshot_id from public.division_score_snapshots
    where model_id = target_model_id and idempotency_key = calculation_key;
    return snapshot_id;
  end if;

  insert into public.division_score_snapshot_components(
    organization_id, snapshot_id, template_id, template_result_id,
    configured_weight, represented, template_score_percentage,
    template_coverage_percentage, weighted_performance_contribution,
    weighted_coverage_contribution
  )
  select
    model_record.organization_id, snapshot_id, component.template_id, result.id,
    component.weight, result.id is not null, result.score_percentage,
    coalesce(result.coverage_percentage, 0),
    case when result.id is null then null else result.score_percentage * component.weight end,
    component.weight * coalesce(result.coverage_percentage, 0)
  from public.division_score_components component
  left join lateral (
    select candidate.* from public.score_template_results candidate
    where candidate.organization_id = model_record.organization_id
      and candidate.division_id = model_record.division_id
      and candidate.template_id = component.template_id
      and candidate.score_percentage is not null
    order by candidate.evaluated_at desc, candidate.created_at desc, candidate.id desc
    limit 1
  ) result on true
  where component.model_id = target_model_id and component.active;

  return snapshot_id;
end;
$$;

-- Canonical Company Master calculation. Coverage controls publication only;
-- it never multiplies or penalizes performance.
create or replace function public.calculate_company_master_score(target_model_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  model_record public.company_score_models;
  expected_weight numeric;
  represented_weight numeric;
  weighted_performance numeric;
  weighted_coverage numeric;
  calculated_performance numeric;
  calculated_coverage numeric;
  calculated_master_score integer;
  calculated_status text;
  calculation_key text;
  snapshot_id uuid;
  has_stale boolean;
begin
  select * into model_record from public.company_score_models where id = target_model_id;
  if model_record.id is null or model_record.status <> 'published' then
    raise exception 'El modelo empresarial debe estar publicado';
  end if;
  if not (select public.can_manage_organization(model_record.organization_id)) then
    raise exception 'No autorizado para calcular esta organizacion';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('company-score:' || target_model_id::text, 0));

  with latest_snapshots as (
    select component.division_id, component.weight,
      division_snapshot.id division_snapshot_id,
      division_snapshot.performance_percentage,
      division_snapshot.coverage_percentage,
      division_snapshot.status division_status,
      division_snapshot.calculated_at
    from public.company_score_components component
    left join lateral (
      select candidate.* from public.division_score_snapshots candidate
      where candidate.organization_id = model_record.organization_id
        and candidate.division_id = component.division_id
        and candidate.performance_percentage is not null
      order by candidate.calculated_at desc, candidate.created_at desc, candidate.id desc
      limit 1
    ) division_snapshot on true
    where component.model_id = target_model_id and component.active
  )
  select
    coalesce(sum(weight), 0),
    coalesce(sum(weight) filter (where division_snapshot_id is not null), 0),
    sum(performance_percentage * weight) filter (where division_snapshot_id is not null),
    coalesce(sum(weight * coalesce(coverage_percentage, 0)), 0),
    coalesce(bool_or(division_status = 'stale' or
      (model_record.stale_after_days is not null and calculated_at < now() - make_interval(days => model_record.stale_after_days))), false),
    coalesce(string_agg(division_id::text || '=' || coalesce(division_snapshot_id::text, 'none'), ',' order by division_id), '')
  into expected_weight, represented_weight, weighted_performance,
    weighted_coverage, has_stale, calculation_key
  from latest_snapshots;

  if expected_weight <> 100 then
    raise exception 'Los pesos activos del modelo publicado deben sumar 100';
  end if;

  calculation_key := md5(
    model_record.id::text || ':' || model_record.version::text
    || ':1:stale=' || has_stale::text || ':' || calculation_key
  );

  calculated_performance := case when represented_weight = 0 then null
    else round(weighted_performance / represented_weight, 4) end;
  calculated_coverage := round(weighted_coverage / expected_weight, 4);

  if represented_weight = 0 then
    calculated_status := 'unevaluated';
    calculated_master_score := null;
  elsif calculated_coverage < model_record.minimum_publishable_coverage then
    calculated_status := 'insufficient_data';
    calculated_master_score := null;
  else
    calculated_master_score := round(calculated_performance * 10)::integer;
    calculated_status := case
      when has_stale then 'stale'
      when calculated_coverage < 100 then 'partial'
      else 'current'
    end;
  end if;

  insert into public.company_score_snapshots(
    organization_id, model_id, performance_percentage, master_score,
    coverage_percentage, status, calculation_version, idempotency_key
  ) values (
    model_record.organization_id, model_record.id, calculated_performance,
    calculated_master_score, calculated_coverage, calculated_status, 1, calculation_key
  )
  on conflict (model_id, idempotency_key) do nothing
  returning id into snapshot_id;

  if snapshot_id is null then
    select id into snapshot_id from public.company_score_snapshots
    where model_id = target_model_id and idempotency_key = calculation_key;
    return snapshot_id;
  end if;

  insert into public.company_score_snapshot_components(
    organization_id, snapshot_id, division_id, division_snapshot_id,
    configured_weight, represented, division_performance_percentage,
    division_coverage_percentage, weighted_performance_contribution,
    weighted_coverage_contribution
  )
  select
    model_record.organization_id, snapshot_id, component.division_id,
    division_snapshot.id, component.weight, division_snapshot.id is not null,
    division_snapshot.performance_percentage,
    coalesce(division_snapshot.coverage_percentage, 0),
    case when division_snapshot.id is null then null
      else division_snapshot.performance_percentage * component.weight end,
    component.weight * coalesce(division_snapshot.coverage_percentage, 0)
  from public.company_score_components component
  left join lateral (
    select candidate.* from public.division_score_snapshots candidate
    where candidate.organization_id = model_record.organization_id
      and candidate.division_id = component.division_id
      and candidate.performance_percentage is not null
    order by candidate.calculated_at desc, candidate.created_at desc, candidate.id desc
    limit 1
  ) division_snapshot on true
  where component.model_id = target_model_id and component.active;

  return snapshot_id;
end;
$$;

revoke all on function public.calculate_division_score(uuid) from public, anon;
revoke all on function public.calculate_company_master_score(uuid) from public, anon;
grant execute on function public.calculate_division_score(uuid) to authenticated;
grant execute on function public.calculate_company_master_score(uuid) to authenticated;

-- Read models for the future Dashboard. PostgreSQL 17 supports security_invoker.
create view public.current_score_template_results
with (security_invoker = true)
as
select distinct on (organization_id, division_id, template_id)
  result.*
from public.score_template_results result
order by organization_id, division_id, template_id,
  evaluated_at desc, created_at desc, id desc;

create view public.current_division_scores
with (security_invoker = true)
as
select distinct on (organization_id, division_id)
  snapshot.*
from public.division_score_snapshots snapshot
order by organization_id, division_id,
  calculated_at desc, created_at desc, id desc;

create view public.current_company_master_score
with (security_invoker = true)
as
select distinct on (organization_id)
  snapshot.*
from public.company_score_snapshots snapshot
order by organization_id, calculated_at desc, created_at desc, id desc;

create view public.company_master_score_history
with (security_invoker = true)
as
select
  snapshot.id,
  snapshot.organization_id,
  snapshot.model_id,
  snapshot.performance_percentage,
  snapshot.master_score,
  snapshot.coverage_percentage,
  snapshot.status,
  snapshot.calculation_version,
  snapshot.calculated_at,
  snapshot.created_at,
  lag(snapshot.master_score) over (
    partition by snapshot.organization_id order by snapshot.calculated_at, snapshot.created_at, snapshot.id
  ) as previous_master_score
from public.company_score_snapshots snapshot;

-- Tenant isolation. Configuration is managed by organization administrators;
-- immutable results/snapshots are written only by canonical backend functions.
alter table public.score_template_results enable row level security;
alter table public.division_score_models enable row level security;
alter table public.division_score_components enable row level security;
alter table public.division_score_snapshots enable row level security;
alter table public.division_score_snapshot_components enable row level security;
alter table public.company_score_models enable row level security;
alter table public.company_score_components enable row level security;
alter table public.company_score_snapshots enable row level security;
alter table public.company_score_snapshot_components enable row level security;

create policy score_template_results_read_org on public.score_template_results
for select to authenticated
using (organization_id = (select public.current_user_organization_id()) or (select public.is_platform_owner()));

create policy division_score_models_read_org on public.division_score_models
for select to authenticated
using (organization_id = (select public.current_user_organization_id()) or (select public.is_platform_owner()));
create policy division_score_models_manage_org on public.division_score_models
for all to authenticated
using ((select public.can_manage_organization(organization_id)))
with check ((select public.can_manage_organization(organization_id)));

create policy division_score_components_read_org on public.division_score_components
for select to authenticated
using (organization_id = (select public.current_user_organization_id()) or (select public.is_platform_owner()));
create policy division_score_components_manage_org on public.division_score_components
for all to authenticated
using ((select public.can_manage_organization(organization_id)))
with check ((select public.can_manage_organization(organization_id)));

create policy division_score_snapshots_read_org on public.division_score_snapshots
for select to authenticated
using (organization_id = (select public.current_user_organization_id()) or (select public.is_platform_owner()));
create policy division_snapshot_components_read_org on public.division_score_snapshot_components
for select to authenticated
using (organization_id = (select public.current_user_organization_id()) or (select public.is_platform_owner()));

create policy company_score_models_read_org on public.company_score_models
for select to authenticated
using (organization_id = (select public.current_user_organization_id()) or (select public.is_platform_owner()));
create policy company_score_models_manage_org on public.company_score_models
for all to authenticated
using ((select public.can_manage_organization(organization_id)))
with check ((select public.can_manage_organization(organization_id)));

create policy company_score_components_read_org on public.company_score_components
for select to authenticated
using (organization_id = (select public.current_user_organization_id()) or (select public.is_platform_owner()));
create policy company_score_components_manage_org on public.company_score_components
for all to authenticated
using ((select public.can_manage_organization(organization_id)))
with check ((select public.can_manage_organization(organization_id)));

create policy company_score_snapshots_read_org on public.company_score_snapshots
for select to authenticated
using (organization_id = (select public.current_user_organization_id()) or (select public.is_platform_owner()));
create policy company_snapshot_components_read_org on public.company_score_snapshot_components
for select to authenticated
using (organization_id = (select public.current_user_organization_id()) or (select public.is_platform_owner()));

revoke all on public.score_template_results,
  public.division_score_models,
  public.division_score_components,
  public.division_score_snapshots,
  public.division_score_snapshot_components,
  public.company_score_models,
  public.company_score_components,
  public.company_score_snapshots,
  public.company_score_snapshot_components
from anon, authenticated;

grant select on public.score_template_results,
  public.division_score_snapshots,
  public.division_score_snapshot_components,
  public.company_score_snapshots,
  public.company_score_snapshot_components
to authenticated;

grant select, insert, update, delete on public.division_score_models,
  public.division_score_components,
  public.company_score_models,
  public.company_score_components
to authenticated;

revoke all on public.current_score_template_results,
  public.current_division_scores,
  public.current_company_master_score,
  public.company_master_score_history
from anon;
grant select on public.current_score_template_results,
  public.current_division_scores,
  public.current_company_master_score,
  public.company_master_score_history
to authenticated;

revoke all on function public.validate_division_score_component() from public, anon, authenticated;
revoke all on function public.validate_company_score_component() from public, anon, authenticated;
revoke all on function public.validate_division_score_model_publication() from public, anon, authenticated;
revoke all on function public.validate_company_score_model_publication() from public, anon, authenticated;

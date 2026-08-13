-- ORVESEN OS - Automatic Company Score Chain V1
-- Recalculate only the affected published Division model after a canonical
-- Score Template Result is inserted, then its applicable published Company model.
--
-- The canonical formulas, advisory locks and idempotency keys remain unchanged.
-- Direct RPC calls still require organization-management permission; the existing
-- permission check is bypassed only while PostgreSQL is executing a trigger.

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
  if pg_trigger_depth() = 0
     and not (select public.can_manage_organization(model_record.organization_id)) then
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
  if pg_trigger_depth() = 0
     and not (select public.can_manage_organization(model_record.organization_id)) then
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

-- This trigger runs after the Template Result exists, preserving the transaction
-- order: Template Result -> affected Division -> applicable Company.
create or replace function private.handle_score_template_result_score_chain()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  division_model_id uuid;
  company_model_id uuid;
  division_snapshot_id uuid;
begin
  select model.id
    into division_model_id
  from public.division_score_models model
  join public.division_score_components component
    on component.model_id = model.id
   and component.template_id = new.template_id
   and component.active
  where model.organization_id = new.organization_id
    and model.division_id = new.division_id
    and model.status = 'published'
  limit 1;

  if division_model_id is null then
    return new;
  end if;

  division_snapshot_id := public.calculate_division_score(division_model_id);

  if division_snapshot_id is null then
    return new;
  end if;

  select model.id
    into company_model_id
  from public.company_score_models model
  join public.company_score_components component
    on component.model_id = model.id
   and component.division_id = new.division_id
   and component.active
  where model.organization_id = new.organization_id
    and model.status = 'published'
  limit 1;

  if company_model_id is not null then
    perform public.calculate_company_master_score(company_model_id);
  end if;

  return new;
end;
$$;

drop trigger if exists recalculate_company_score_after_template_result
  on public.score_template_results;

create trigger recalculate_company_score_after_template_result
after insert on public.score_template_results
for each row
execute function private.handle_score_template_result_score_chain();

revoke all on function private.handle_score_template_result_score_chain()
  from public, anon, authenticated;

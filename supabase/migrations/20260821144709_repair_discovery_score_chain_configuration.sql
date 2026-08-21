-- Repair structurally unambiguous Score-chain gaps without hardcoding an
-- organization, division, template, or assessment. A published company model
-- division can be reconciled automatically only when exactly one published
-- Score template already has materialized evidence for that division.
create or replace function private.handle_published_division_score_model_chain()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  division_snapshot_id uuid;
  company_model_id uuid;
  company_snapshot_id uuid;
begin
  if new.status = 'published'
     and old.status is distinct from new.status then
    division_snapshot_id := public.calculate_division_score(new.id);

    if division_snapshot_id is null then
      raise exception 'Division Score calculation returned no snapshot for model %',
        new.id;
    end if;

    update public.division_score_snapshots
    set calculated_at = clock_timestamp()
    where id = division_snapshot_id;

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
      company_snapshot_id :=
        public.calculate_company_master_score(company_model_id);
      update public.company_score_snapshots
      set calculated_at = clock_timestamp()
      where id = company_snapshot_id;
    end if;
  end if;

  return new;
end;
$$;

alter function private.handle_published_division_score_model_chain()
  owner to postgres;
revoke all on function private.handle_published_division_score_model_chain()
  from public, anon, authenticated;

drop trigger if exists recalculate_score_after_division_model_publication
  on public.division_score_models;

create trigger recalculate_score_after_division_model_publication
after update of status
on public.division_score_models
for each row
execute function private.handle_published_division_score_model_chain();

do $$
declare
  candidate record;
  candidate_model_id uuid;
  candidate_version integer;
begin
  for candidate in
    select
      company_model.organization_id,
      company_component.division_id,
      division.name as division_name,
      count(distinct template.id) filter (
        where template.status = 'published'
          and result.id is not null
      ) as eligible_template_count,
      (array_agg(distinct template.id) filter (
        where template.status = 'published'
          and result.id is not null
      ))[1] as template_id
    from public.company_score_models company_model
    join public.company_score_components company_component
      on company_component.model_id = company_model.id
     and company_component.active
    join public.divisions division
      on division.id = company_component.division_id
     and division.organization_id = company_model.organization_id
    left join public.score_templates template
      on template.organization_id = company_model.organization_id
     and template.division_id = company_component.division_id
    left join public.score_template_results result
      on result.organization_id = template.organization_id
     and result.division_id = template.division_id
     and result.template_id = template.id
    where company_model.status = 'published'
      and not exists (
        select 1
        from public.division_score_models existing_model
        where existing_model.organization_id = company_model.organization_id
          and existing_model.division_id = company_component.division_id
          and existing_model.status = 'published'
      )
    group by
      company_model.organization_id,
      company_component.division_id,
      division.name
    having count(distinct template.id) filter (
      where template.status = 'published'
        and result.id is not null
    ) > 0
    order by company_model.organization_id, company_component.division_id
  loop
    if candidate.eligible_template_count <> 1 then
      raise exception
        'Cannot reconcile division %: expected one published Score template with evidence, found %',
        candidate.division_id,
        candidate.eligible_template_count;
    end if;

    perform pg_advisory_xact_lock(hashtextextended(
      'division-score-model:' || candidate.organization_id::text
        || ':' || candidate.division_id::text,
      0
    ));

    select model.id
      into candidate_model_id
    from public.division_score_models model
    where model.organization_id = candidate.organization_id
      and model.division_id = candidate.division_id
      and model.status = 'published';

    if candidate_model_id is null then
      select coalesce(max(model.version), 0) + 1
        into candidate_version
      from public.division_score_models model
      where model.organization_id = candidate.organization_id
        and model.division_id = candidate.division_id;

      insert into public.division_score_models(
        organization_id,
        division_id,
        name,
        status,
        version,
        stale_after_days
      ) values (
        candidate.organization_id,
        candidate.division_id,
        'Score de ' || candidate.division_name,
        'draft',
        candidate_version,
        90
      )
      returning id into candidate_model_id;

      insert into public.division_score_components(
        organization_id,
        model_id,
        template_id,
        weight,
        active
      ) values (
        candidate.organization_id,
        candidate_model_id,
        candidate.template_id,
        100,
        true
      );

      update public.division_score_models
      set status = 'published',
          published_at = now()
      where id = candidate_model_id;
    end if;
  end loop;
end
$$;

-- Do not silently accept a new Template Result that is expected to feed a
-- published company model but lacks a published Division Score model. Raising
-- here keeps Discovery completion atomic instead of showing a completed result
-- that the Dashboard cannot consume.
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
  company_snapshot_id uuid;
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
    if exists (
      select 1
      from public.company_score_models company_model
      join public.company_score_components company_component
        on company_component.model_id = company_model.id
       and company_component.division_id = new.division_id
       and company_component.active
      where company_model.organization_id = new.organization_id
        and company_model.status = 'published'
    ) then
      raise exception
        'Published company model division % lacks a Division Score model for template %',
        new.division_id,
        new.template_id;
    end if;
    return new;
  end if;

  division_snapshot_id := public.calculate_division_score(division_model_id);

  if division_snapshot_id is null then
    raise exception 'Division Score calculation returned no snapshot for model %',
      division_model_id;
  end if;

  update public.division_score_snapshots
  set calculated_at = clock_timestamp()
  where id = division_snapshot_id;

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
    company_snapshot_id :=
      public.calculate_company_master_score(company_model_id);
    update public.company_score_snapshots
    set calculated_at = clock_timestamp()
    where id = company_snapshot_id;
  end if;

  return new;
end;
$$;

alter function private.handle_score_template_result_score_chain()
  owner to postgres;
revoke all on function private.handle_score_template_result_score_chain()
  from public, anon, authenticated;

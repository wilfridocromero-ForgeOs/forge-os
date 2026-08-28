do $migration$
declare
  target_organization_id constant uuid := '7070c469-2b6a-427c-bc33-bfec8b493201';
  expected_division_id constant uuid := 'ddd1cec5-06b5-4998-ab10-3c6c9cc3a43f';
  expected_template_id constant uuid := 'f53b9037-b1a2-4b81-9ab5-115319137332';
  target_division_id uuid;
  target_template_id uuid;
  target_model_id uuid;
  published_model_count integer;
  published_template_count integer;
  active_component_count integer;
  compatible_component_count integer;
  target_division_count integer;
  next_version integer;
begin
  perform pg_advisory_xact_lock(hashtextextended(
    'division-score-model:' || target_organization_id::text || ':ORVESEN Media',
    0
  ));

  if not exists (
    select 1
    from public.organizations organization
    where organization.id = target_organization_id
  ) then
    raise exception 'Expected ORVESEN organization was not found';
  end if;

  select count(*), (array_agg(division.id order by division.id))[1]
    into target_division_count, target_division_id
  from public.divisions division
  where division.organization_id = target_organization_id
    and division.name = 'ORVESEN Media';

  if target_division_count <> 1
     or target_division_id is distinct from expected_division_id then
    raise exception
      'Expected ORVESEN Media division was not uniquely resolved; found %',
      target_division_count;
  end if;

  select count(*), (array_agg(template.id order by template.id))[1]
    into published_template_count, target_template_id
  from public.score_templates template
  where template.organization_id = target_organization_id
    and template.division_id = target_division_id
    and template.status = 'published';

  if published_template_count <> 1
     or target_template_id is distinct from expected_template_id then
    raise exception
      'ORVESEN Media must have exactly the expected published Score template; found %',
      published_template_count;
  end if;

  select count(*), (array_agg(model.id order by model.version desc))[1]
    into published_model_count, target_model_id
  from public.division_score_models model
  where model.organization_id = target_organization_id
    and model.division_id = target_division_id
    and model.status = 'published';

  if published_model_count > 1 then
    raise exception 'ORVESEN Media has more than one published Division Score model';
  end if;

  if published_model_count = 1 then
    select
      count(*) filter (where component.active),
      count(*) filter (
        where component.active
          and component.template_id = target_template_id
          and component.weight = 100
      )
      into active_component_count, compatible_component_count
    from public.division_score_components component
    where component.model_id = target_model_id;

    if active_component_count <> 1 or compatible_component_count <> 1 then
      raise exception
        'Existing ORVESEN Media Division Score model is not compatible with its published template';
    end if;
  else
    select coalesce(max(model.version), 0) + 1
      into next_version
    from public.division_score_models model
    where model.organization_id = target_organization_id
      and model.division_id = target_division_id;

    insert into public.division_score_models(
      organization_id,
      division_id,
      name,
      status,
      version,
      stale_after_days
    ) values (
      target_organization_id,
      target_division_id,
      'Score de ORVESEN Media',
      'draft',
      next_version,
      90
    )
    returning id into target_model_id;

    insert into public.division_score_components(
      organization_id,
      model_id,
      template_id,
      weight,
      active
    ) values (
      target_organization_id,
      target_model_id,
      target_template_id,
      100,
      true
    );

    update public.division_score_models
    set status = 'published',
        published_at = now()
    where id = target_model_id
      and status = 'draft';

    if not found then
      raise exception 'ORVESEN Media Division Score model could not be published';
    end if;
  end if;
end
$migration$;

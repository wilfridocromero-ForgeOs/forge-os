-- ORVESEN OS - Discovery Execution V1 compatibility.
-- Bridges the historical score-template assessment model with Discovery Builder.

-- A Discovery or its client may not be assigned to a division. Organization ID
-- remains mandatory and is still the canonical RLS boundary.
alter table public.discovery_assessments
  alter column division_id drop not null;

-- Discovery-question identity is canonical for the new execution flow. The
-- historical constraint prevented two Discovery questions in one assessment
-- from feeding the same Score question.
alter table public.discovery_responses
  drop constraint discovery_responses_assessment_id_question_id_key;

create index discovery_responses_assessment_score_question_idx
  on public.discovery_responses(assessment_id, question_id)
  where question_id is not null;

-- Preserve one response per Score question for assessments that still use the
-- historical model, without blocking the new many-to-one Discovery model.
create unique index discovery_responses_historical_question_uidx
  on public.discovery_responses(assessment_id, question_id)
  where discovery_question_id is null and question_id is not null;

-- A single Discovery answer carries at most one Score-question identity.
create unique index discovery_question_score_links_one_active_uidx
  on public.discovery_question_score_links(discovery_question_id)
  where active;

-- A response using both identities must use the exact active Builder link.
-- Historical responses (Discovery question NULL, Score question present) keep
-- their previous behavior.
create or replace function public.validate_discovery_response_question()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  assessment_template_id uuid;
  question_template_id uuid;
begin
  if new.discovery_question_id is null then
    return new;
  end if;

  select a.discovery_template_id
    into assessment_template_id
  from public.discovery_assessments a
  where a.id = new.assessment_id;

  select s.template_id
    into question_template_id
  from public.discovery_questions q
  join public.discovery_sections s on s.id = q.section_id
  where q.id = new.discovery_question_id;

  if assessment_template_id is null
     or question_template_id is null
     or assessment_template_id <> question_template_id then
    raise exception using
      errcode = '23514',
      message = 'La pregunta Discovery no pertenece a la plantilla de la evaluacion';
  end if;

  if new.question_id is not null
     and not exists (
       select 1
       from public.discovery_question_score_links link
       where link.discovery_question_id = new.discovery_question_id
         and link.score_question_id = new.question_id
         and link.active
     ) then
    raise exception using
      errcode = '23514',
      message = 'La pregunta Score no corresponde a un enlace Discovery activo';
  end if;

  return new;
end
$$;

drop trigger validate_discovery_response_question_trigger
  on public.discovery_responses;

create trigger validate_discovery_response_question_trigger
before insert or update of assessment_id, discovery_question_id, question_id
on public.discovery_responses
for each row execute function public.validate_discovery_response_question();

-- V1 does not combine different Score templates. The transaction-level lock
-- serializes concurrent link creation for the same Discovery template.
create function public.validate_discovery_single_score_template()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  discovery_template_id uuid;
  target_score_template_id uuid;
begin
  if not new.active then
    return new;
  end if;

  select section.template_id
    into discovery_template_id
  from public.discovery_questions question
  join public.discovery_sections section on section.id = question.section_id
  where question.id = new.discovery_question_id;

  select category.template_id
    into target_score_template_id
  from public.score_questions question
  join public.score_categories category on category.id = question.category_id
  where question.id = new.score_question_id;

  if discovery_template_id is null or target_score_template_id is null then
    raise exception using
      errcode = '23503',
      message = 'No se pudo determinar la plantilla Discovery o Score';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(discovery_template_id::text, 0));

  if exists (
    select 1
    from public.discovery_question_score_links existing_link
    join public.discovery_questions existing_question
      on existing_question.id = existing_link.discovery_question_id
    join public.discovery_sections existing_section
      on existing_section.id = existing_question.section_id
    join public.score_questions existing_score_question
      on existing_score_question.id = existing_link.score_question_id
    join public.score_categories existing_category
      on existing_category.id = existing_score_question.category_id
    where existing_section.template_id = discovery_template_id
      and existing_link.active
      and existing_link.id <> new.id
      and existing_category.template_id <> target_score_template_id
  ) then
    raise exception using
      errcode = '23514',
      message = 'Un Discovery solo puede conectarse a una plantilla Score';
  end if;

  return new;
end
$$;

do $$
begin
  if exists (
    select 1
    from public.discovery_question_score_links link
    join public.discovery_questions question on question.id = link.discovery_question_id
    join public.discovery_sections section on section.id = question.section_id
    join public.score_questions score_question on score_question.id = link.score_question_id
    join public.score_categories category on category.id = score_question.category_id
    where link.active
    group by section.template_id
    having count(distinct category.template_id) > 1
  ) then
    raise exception 'Existen Discoveries conectados a multiples plantillas Score';
  end if;
end
$$;

create trigger validate_discovery_single_score_template_trigger
before insert or update of discovery_question_id, score_question_id, active
on public.discovery_question_score_links
for each row execute function public.validate_discovery_single_score_template();

revoke all on function public.validate_discovery_single_score_template()
  from public;

-- New assessments aggregate only Score questions actually answered through
-- active Discovery links. Many Discovery answers feeding the same Score
-- question are averaged first, so the canonical Score-question weight is
-- applied once. Historical assessments retain their previous calculation.
create or replace function public.finalize_discovery(target_assessment_id uuid)
returns public.discovery_assessments
language plpgsql
security invoker
set search_path = public
as $$
declare
  assessment public.discovery_assessments;
  missing_required integer;
  represented_categories integer;
  scored_responses integer;
  answered_questions integer;
  total_questions integer;
  overall_percentage numeric;
  represented_weight numeric;
  strengths jsonb;
  weaknesses jsonb;
  priorities jsonb;
  effective_score_template_id uuid;
begin
  select *
    into assessment
  from public.discovery_assessments
  where id = target_assessment_id
  for update;

  if not found
     or not public.discovery_assessment_visible(target_assessment_id) then
    raise exception 'Discovery no disponible';
  end if;

  -- Discovery Builder execution path.
  if assessment.discovery_template_id is not null then
    select count(*)
      into missing_required
    from public.discovery_sections section
    join public.discovery_questions question on question.section_id = section.id
    left join public.discovery_responses response
      on response.assessment_id = target_assessment_id
     and response.discovery_question_id = question.id
    where section.template_id = assessment.discovery_template_id
      and question.required
      and response.id is null;

    if missing_required > 0 then
      raise exception 'Faltan % respuestas obligatorias', missing_required;
    end if;

    select count(*), count(response.id)
      into total_questions, answered_questions
    from public.discovery_sections section
    join public.discovery_questions question on question.section_id = section.id
    left join public.discovery_responses response
      on response.assessment_id = target_assessment_id
     and response.discovery_question_id = question.id
    where section.template_id = assessment.discovery_template_id;

    delete from public.discovery_category_results
    where assessment_id = target_assessment_id;

    delete from public.discovery_recommendations
    where assessment_id = target_assessment_id;

    select count(*)
      into scored_responses
    from public.discovery_responses response
    join public.discovery_question_score_links link
      on link.discovery_question_id = response.discovery_question_id
     and link.score_question_id = response.question_id
     and link.active
    where response.assessment_id = target_assessment_id
      and response.numeric_score is not null;

    insert into public.discovery_category_results(
      assessment_id,
      category_id,
      score,
      max_score,
      percentage,
      status
    )
    with score_question_results as (
      select
        score_question.id as score_question_id,
        score_question.category_id,
        score_question.weight,
        avg(response.numeric_score) as normalized_score
      from public.discovery_responses response
      join public.discovery_question_score_links link
        on link.discovery_question_id = response.discovery_question_id
       and link.score_question_id = response.question_id
       and link.active
      join public.score_questions score_question
        on score_question.id = response.question_id
      where response.assessment_id = target_assessment_id
        and response.numeric_score is not null
      group by score_question.id, score_question.category_id, score_question.weight
    ), category_scores as (
      select
        category_id,
        sum(normalized_score * weight)
          / nullif(sum(weight), 0) as percentage
      from score_question_results
      group by category_id
      having sum(weight) > 0
    )
    select
      target_assessment_id,
      category_id,
      round(percentage, 2),
      100,
      round(percentage, 4),
      case
        when percentage < 40 then 'critical'
        when percentage < 60 then 'priority'
        when percentage < 75 then 'developing'
        else 'strong'
      end
    from category_scores;

    select count(*)
      into represented_categories
    from public.discovery_category_results
    where assessment_id = target_assessment_id;

    if represented_categories = 0 and scored_responses > 0 then
      raise exception 'Las preguntas Score respondidas no tienen pesos validos';
    end if;

    if represented_categories = 0 then
      update public.discovery_assessments
      set
        status = 'completed',
        score = null,
        completed_at = now(),
        updated_at = now(),
        maturity_level = null,
        diagnosis = jsonb_build_object(
          'kind', 'informative',
          'hasScore', false,
          'answeredQuestions', answered_questions,
          'totalQuestions', total_questions,
          'strengths', '[]'::jsonb,
          'weaknesses', '[]'::jsonb,
          'priorities', '[]'::jsonb,
          'calculatedAt', now(),
          'calculation', 'informative_discovery_v1'
        )
      where id = target_assessment_id
      returning * into assessment;

      return assessment;
    end if;

    select
      sum(result.percentage * category.weight)
        / nullif(sum(category.weight), 0),
      sum(category.weight),
      (array_agg(distinct category.template_id))[1]
      into overall_percentage, represented_weight, effective_score_template_id
    from public.discovery_category_results result
    join public.score_categories category on category.id = result.category_id
    where result.assessment_id = target_assessment_id;

    if represented_weight is null
       or represented_weight <= 0
       or overall_percentage is null then
      raise exception 'Las categorias Score evaluadas no tienen pesos validos';
    end if;

    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'categoryId', category.id,
          'name', category.name,
          'percentage', result.percentage
        ) order by result.percentage desc
      ),
      '[]'::jsonb
    )
      into strengths
    from public.discovery_category_results result
    join public.score_categories category on category.id = result.category_id
    where result.assessment_id = target_assessment_id
      and result.percentage >= 75;

    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'categoryId', category.id,
          'name', category.name,
          'percentage', result.percentage
        ) order by result.percentage
      ),
      '[]'::jsonb
    )
      into weaknesses
    from public.discovery_category_results result
    join public.score_categories category on category.id = result.category_id
    where result.assessment_id = target_assessment_id
      and result.percentage < 60;

    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'categoryId', category.id,
          'name', category.name,
          'percentage', result.percentage,
          'weight', category.weight
        ) order by result.percentage, category.weight desc
      ),
      '[]'::jsonb
    )
      into priorities
    from public.discovery_category_results result
    join public.score_categories category on category.id = result.category_id
    where result.assessment_id = target_assessment_id
      and result.percentage < 75;

    -- Only configured historical rules are reused. No fallback or AI
    -- recommendations are invented for the new Discovery path.
    insert into public.discovery_recommendations(
      assessment_id,
      category_id,
      rule_id,
      service_key,
      title,
      reason,
      priority,
      project_blueprint
    )
    select
      target_assessment_id,
      result.category_id,
      rule.id,
      rule.service_key,
      rule.service_name,
      case
        when rule.description <> '' then rule.description
        else 'Prioridad detectada a partir de las respuestas de '
          || category.name || ' (' || round(result.percentage, 0) || '%).'
      end,
      rule.priority,
      rule.project_blueprint
    from public.discovery_category_results result
    join public.score_categories category on category.id = result.category_id
    join public.discovery_recommendation_rules rule
      on rule.organization_id = assessment.organization_id
     and rule.active
     and (rule.template_id is null
       or rule.template_id = effective_score_template_id)
     and (rule.category_id is null
       or rule.category_id = result.category_id)
     and result.percentage between rule.minimum_percentage
       and rule.maximum_percentage
    where result.assessment_id = target_assessment_id
    on conflict (assessment_id, service_key) do update
      set title = excluded.title,
          reason = excluded.reason,
          priority = excluded.priority,
          project_blueprint = excluded.project_blueprint;

    update public.discovery_assessments
    set
      status = 'completed',
      score = round(max_score * overall_percentage / 100, 2),
      completed_at = now(),
      updated_at = now(),
      maturity_level = case
        when overall_percentage < 40 then 'Fundacional'
        when overall_percentage < 60 then 'En desarrollo'
        when overall_percentage < 75 then 'Establecido'
        when overall_percentage < 90 then 'Avanzado'
        else 'Optimizado'
      end,
      diagnosis = jsonb_build_object(
        'kind', 'scored',
        'hasScore', true,
        'percentage', round(overall_percentage, 2),
        'answeredQuestions', answered_questions,
        'totalQuestions', total_questions,
        'scoreTemplateId', effective_score_template_id,
        'strengths', strengths,
        'weaknesses', weaknesses,
        'priorities', priorities,
        'calculatedAt', now(),
        'calculation', 'linked_weighted_categories_v1'
      )
    where id = target_assessment_id
    returning * into assessment;

    return assessment;
  end if;

  -- Historical execution path.
  if assessment.template_id is null then
    raise exception 'La evaluacion no tiene una plantilla Discovery o Score';
  end if;

  select count(*)
    into missing_required
  from public.score_categories category
  join public.score_questions question on question.category_id = category.id
  left join public.discovery_responses response
    on response.assessment_id = target_assessment_id
   and response.question_id = question.id
  where category.template_id = assessment.template_id
    and question.required
    and response.id is null;

  if missing_required > 0 then
    raise exception 'Faltan % respuestas obligatorias', missing_required;
  end if;

  delete from public.discovery_category_results
  where assessment_id = target_assessment_id;

  insert into public.discovery_category_results(
    assessment_id,
    category_id,
    score,
    max_score,
    percentage,
    status
  )
  select
    target_assessment_id,
    category.id,
    round(coalesce(
      sum(response.numeric_score * question.weight)
        / nullif(sum(question.weight)
          filter (where response.numeric_score is not null), 0),
      0
    ), 2),
    100,
    round(coalesce(
      sum(response.numeric_score * question.weight)
        / nullif(sum(question.weight)
          filter (where response.numeric_score is not null), 0),
      0
    ), 4),
    case
      when coalesce(sum(response.numeric_score * question.weight)
        / nullif(sum(question.weight)
          filter (where response.numeric_score is not null), 0), 0) < 40
        then 'critical'
      when coalesce(sum(response.numeric_score * question.weight)
        / nullif(sum(question.weight)
          filter (where response.numeric_score is not null), 0), 0) < 60
        then 'priority'
      when coalesce(sum(response.numeric_score * question.weight)
        / nullif(sum(question.weight)
          filter (where response.numeric_score is not null), 0), 0) < 75
        then 'developing'
      else 'strong'
    end
  from public.score_categories category
  join public.score_questions question on question.category_id = category.id
  left join public.discovery_responses response
    on response.assessment_id = target_assessment_id
   and response.question_id = question.id
  where category.template_id = assessment.template_id
  group by category.id;

  select coalesce(
    sum(result.percentage * category.weight)
      / nullif(sum(category.weight), 0),
    0
  )
    into overall_percentage
  from public.discovery_category_results result
  join public.score_categories category on category.id = result.category_id
  where result.assessment_id = target_assessment_id;

  select coalesce(jsonb_agg(jsonb_build_object(
      'categoryId', category.id,
      'name', category.name,
      'percentage', result.percentage
    ) order by result.percentage desc), '[]'::jsonb)
    into strengths
  from public.discovery_category_results result
  join public.score_categories category on category.id = result.category_id
  where result.assessment_id = target_assessment_id
    and result.percentage >= 75;

  select coalesce(jsonb_agg(jsonb_build_object(
      'categoryId', category.id,
      'name', category.name,
      'percentage', result.percentage
    ) order by result.percentage), '[]'::jsonb)
    into weaknesses
  from public.discovery_category_results result
  join public.score_categories category on category.id = result.category_id
  where result.assessment_id = target_assessment_id
    and result.percentage < 60;

  select coalesce(jsonb_agg(jsonb_build_object(
      'categoryId', category.id,
      'name', category.name,
      'percentage', result.percentage,
      'weight', category.weight
    ) order by result.percentage, category.weight desc), '[]'::jsonb)
    into priorities
  from public.discovery_category_results result
  join public.score_categories category on category.id = result.category_id
  where result.assessment_id = target_assessment_id
    and result.percentage < 75;

  delete from public.discovery_recommendations
  where assessment_id = target_assessment_id;

  insert into public.discovery_recommendations(
    assessment_id, category_id, rule_id, service_key, title, reason,
    priority, project_blueprint
  )
  select
    target_assessment_id,
    result.category_id,
    rule.id,
    rule.service_key,
    rule.service_name,
    case
      when rule.description <> '' then rule.description
      else 'Prioridad detectada a partir de las respuestas de '
        || category.name || ' (' || round(result.percentage, 0) || '%).'
    end,
    rule.priority,
    rule.project_blueprint
  from public.discovery_category_results result
  join public.score_categories category on category.id = result.category_id
  join public.discovery_recommendation_rules rule
    on rule.organization_id = assessment.organization_id
   and rule.active
   and (rule.template_id is null
     or rule.template_id = assessment.template_id)
   and (rule.category_id is null
     or rule.category_id = result.category_id)
   and result.percentage between rule.minimum_percentage
     and rule.maximum_percentage
  where result.assessment_id = target_assessment_id
  on conflict (assessment_id, service_key) do update
    set title = excluded.title,
        reason = excluded.reason,
        priority = excluded.priority,
        project_blueprint = excluded.project_blueprint;

  insert into public.discovery_recommendations(
    assessment_id, category_id, service_key, title, reason, priority
  )
  select
    target_assessment_id,
    result.category_id,
    'improve-' || category.id::text,
    'Fortalecer ' || category.name,
    'Las respuestas situan esta categoria en '
      || round(result.percentage, 0)
      || '%. Requiere un plan de mejora antes de escalar.',
    100 + row_number() over(
      order by result.percentage, category.weight desc
    )
  from public.discovery_category_results result
  join public.score_categories category on category.id = result.category_id
  where result.assessment_id = target_assessment_id
    and result.percentage < 60
    and not exists (
      select 1
      from public.discovery_recommendations recommendation
      where recommendation.assessment_id = target_assessment_id
        and recommendation.category_id = result.category_id
    )
  on conflict (assessment_id, service_key) do nothing;

  update public.discovery_assessments
  set
    status = 'completed',
    score = round(max_score * overall_percentage / 100, 2),
    completed_at = now(),
    updated_at = now(),
    maturity_level = case
      when overall_percentage < 40 then 'Fundacional'
      when overall_percentage < 60 then 'En desarrollo'
      when overall_percentage < 75 then 'Establecido'
      when overall_percentage < 90 then 'Avanzado'
      else 'Optimizado'
    end,
    diagnosis = jsonb_build_object(
      'percentage', round(overall_percentage, 2),
      'strengths', strengths,
      'weaknesses', weaknesses,
      'priorities', priorities,
      'calculatedAt', now(),
      'calculation', 'weighted_categories_v1'
    )
  where id = target_assessment_id
  returning * into assessment;

  return assessment;
end
$$;

grant execute on function public.finalize_discovery(uuid) to authenticated;

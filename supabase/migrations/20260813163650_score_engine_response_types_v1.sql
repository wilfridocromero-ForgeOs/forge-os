-- ORVESEN OS - Score Engine response types V1.
--
-- This migration completes the canonical 0-100 normalization rules without
-- changing category/area aggregation. Empty configurations remain valid for
-- historical compatibility. Number and multiple-choice questions are only
-- scorable after they receive complete configuration.

create or replace function public.score_question_configuration_is_valid(
  target_response_type text,
  target_scale_min integer,
  target_scale_max integer,
  target_options jsonb,
  target_scoring_config jsonb,
  require_scorable boolean default false
)
returns boolean
language plpgsql
immutable
security invoker
set search_path = public
as $$
declare
  config jsonb := coalesce(target_scoring_config, '{}'::jsonb);
  option_item jsonb;
  threshold_item jsonb;
  other_threshold jsonb;
  threshold_index integer;
  other_index integer;
  response_mode text;
  response_direction text;
begin
  if jsonb_typeof(config) <> 'object'
     or jsonb_typeof(coalesce(target_options, '[]'::jsonb)) <> 'array' then
    return false;
  end if;

  if target_response_type in ('yes_no', 'boolean') then
    if config ? 'yes_score'
       and (jsonb_typeof(config->'yes_score') <> 'number'
         or (config->>'yes_score')::numeric not between 0 and 100) then
      return false;
    end if;
    if config ? 'no_score'
       and (jsonb_typeof(config->'no_score') <> 'number'
         or (config->>'no_score')::numeric not between 0 and 100) then
      return false;
    end if;
    return true;
  end if;

  if target_response_type = 'scale' then
    response_direction := coalesce(config->>'direction', 'higher');
    return target_scale_min < target_scale_max
      and response_direction in ('higher', 'lower')
      and coalesce(config->>'normalization', 'linear') = 'linear';
  end if;

  if target_response_type = 'percentage' then
    return coalesce(config->>'mode', 'direct') in ('direct', 'inverse');
  end if;

  if target_response_type = 'number' then
    response_mode := config->>'mode';
    if response_mode is not null
       and response_mode not in ('target', 'thresholds') then
      return false;
    end if;
    if config ? 'direction'
       and coalesce(config->>'direction', '') not in ('higher', 'lower') then
      return false;
    end if;
    if config ? 'target'
       and (
         jsonb_typeof(config->'target') <> 'number'
         or (config->>'target')::numeric <= 0
       ) then
      return false;
    end if;
    if config ? 'thresholds'
       and jsonb_typeof(config->'thresholds') <> 'array' then
      return false;
    end if;

    -- A missing mode with target preserves the pre-V1 target configuration.
    response_mode := coalesce(
      response_mode,
      case when config ? 'target' then 'target' end
    );

    if response_mode = 'target' then
      if not require_scorable then
        return true;
      end if;
      return coalesce(config ? 'target', false);
    end if;

    if response_mode is null then
      return not require_scorable;
    end if;
    if response_mode <> 'thresholds' then
      return false;
    end if;
    if not (config ? 'thresholds')
       or jsonb_array_length(config->'thresholds') = 0 then
      return not require_scorable;
    end if;

    for threshold_index in 0..jsonb_array_length(config->'thresholds') - 1 loop
      threshold_item := config->'thresholds'->threshold_index;
      if jsonb_typeof(threshold_item) <> 'object' then
        return false;
      end if;
      if threshold_item ? 'min'
         and jsonb_typeof(threshold_item->'min') <> 'number' then
        return false;
      end if;
      if threshold_item ? 'max'
         and (
           threshold_item->'max' <> 'null'::jsonb
           and jsonb_typeof(threshold_item->'max') <> 'number'
         ) then
        return false;
      end if;
      if threshold_item ? 'score'
         and jsonb_typeof(threshold_item->'score') <> 'number' then
        return false;
      end if;

      if not require_scorable then
        continue;
      end if;
      if not (threshold_item ? 'min')
         or not (threshold_item ? 'max')
         or not (threshold_item ? 'score')
         or (threshold_item->>'score')::numeric not between 0 and 100
         or (
           threshold_item->'max' <> 'null'::jsonb
           and (threshold_item->>'min')::numeric > (threshold_item->>'max')::numeric
         ) then
        return false;
      end if;

      -- Inclusive ranges must never overlap; gaps are allowed and normalize
      -- to NULL when no threshold represents the answer.
      if threshold_index > 0 then
        for other_index in 0..threshold_index - 1 loop
          other_threshold := config->'thresholds'->other_index;
          if (
            other_threshold->'max' = 'null'::jsonb
            or (threshold_item->>'min')::numeric <= (other_threshold->>'max')::numeric
          ) and (
            threshold_item->'max' = 'null'::jsonb
            or (other_threshold->>'min')::numeric <= (threshold_item->>'max')::numeric
          ) then
            return false;
          end if;
        end loop;
      end if;
    end loop;
    return true;
  end if;

  if target_response_type = 'multiple_choice' then
    if jsonb_array_length(coalesce(target_options, '[]'::jsonb)) = 0 then
      return not require_scorable;
    end if;

    for option_item in
      select value from jsonb_array_elements(target_options)
    loop
      if jsonb_typeof(option_item) <> 'object' then
        return false;
      end if;
      if option_item ? 'value'
         and jsonb_typeof(option_item->'value') <> 'string' then
        return false;
      end if;
      if option_item ? 'label'
         and jsonb_typeof(option_item->'label') <> 'string' then
        return false;
      end if;
      if option_item ? 'score'
         and jsonb_typeof(option_item->'score') <> 'number' then
        return false;
      end if;
      if require_scorable
         and (
           not (option_item ? 'value')
           or btrim(option_item->>'value') = ''
           or not (option_item ? 'label')
           or btrim(option_item->>'label') = ''
           or not (option_item ? 'score')
           or (option_item->>'score')::numeric not between 0 and 100
         ) then
        return false;
      end if;
    end loop;

    if not require_scorable then
      return true;
    end if;
    return (
      select count(*) = count(distinct value->>'value')
      from jsonb_array_elements(target_options)
    );
  end if;

  if target_response_type = 'text' then
    return not require_scorable;
  end if;

  return false;
exception
  when invalid_text_representation or numeric_value_out_of_range then
    return false;
end
$$;

create or replace function public.is_score_question_scorable(
  target_question_id uuid
)
returns boolean
language sql
stable
security invoker
set search_path = public
as $$
  select coalesce(
    public.score_question_configuration_is_valid(
      question.response_type,
      question.scale_min,
      question.scale_max,
      question.options,
      question.scoring_config,
      true
    ),
    false
  )
  from public.score_questions question
  where question.id = target_question_id
$$;

create or replace function public.validate_score_question_configuration()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  template_status text;
begin
  if not coalesce(
    public.score_question_configuration_is_valid(
      new.response_type,
      new.scale_min,
      new.scale_max,
      new.options,
      new.scoring_config,
      false
    ),
    false
  ) then
    raise exception using
      errcode = '23514',
      message = 'La configuración de scoring no es válida para el tipo de respuesta';
  end if;

  select template.status
    into template_status
  from public.score_categories category
  join public.score_templates template on template.id = category.template_id
  where category.id = new.category_id;

  if template_status = 'published'
     and new.response_type <> 'text'
     and not coalesce(
       public.score_question_configuration_is_valid(
         new.response_type,
         new.scale_min,
         new.scale_max,
         new.options,
         new.scoring_config,
         true
       ),
       false
     ) then
    raise exception using
      errcode = '23514',
      message = 'Una pregunta puntuable incompleta no puede guardarse en un Score publicado';
  end if;
  return new;
end
$$;

drop trigger if exists validate_score_question_configuration_trigger
  on public.score_questions;
create trigger validate_score_question_configuration_trigger
before insert or update of response_type, scale_min, scale_max, options, scoring_config
on public.score_questions
for each row execute function public.validate_score_question_configuration();

create or replace function public.validate_score_template_publication()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if new.status = 'published'
     and exists (
       select 1
       from public.score_categories category
       join public.score_questions question
         on question.category_id = category.id
       where category.template_id = new.id
         and question.response_type <> 'text'
         and not coalesce(
           public.is_score_question_scorable(question.id),
           false
         )
     ) then
    raise exception using
      errcode = '23514',
      message = 'El Score contiene preguntas puntuables con configuración incompleta';
  end if;
  return new;
end
$$;

drop trigger if exists validate_score_template_publication_trigger
  on public.score_templates;
create trigger validate_score_template_publication_trigger
before insert or update of status
on public.score_templates
for each row execute function public.validate_score_template_publication();

create or replace function public.normalize_discovery_response(
  target_question_id uuid,
  target_value jsonb
)
returns numeric
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  question record;
  raw numeric;
  normalized numeric;
  option_score numeric;
  answer_text text;
  answer_token text;
  response_mode text;
  response_direction text;
begin
  select response_type, scale_min, scale_max, options, scoring_config
    into question
  from public.score_questions
  where id = target_question_id;

  if not found then
    raise exception 'Pregunta no encontrada';
  end if;

  if question.response_type = 'text' then
    return null;
  end if;
  if not coalesce(
    public.is_score_question_scorable(target_question_id),
    false
  ) then
    return null;
  end if;

  answer_text := btrim(target_value #>> '{}');

  if question.response_type in ('yes_no', 'boolean') then
    -- Removing the acute accent makes si/sí and their case variants equal.
    answer_token := translate(lower(answer_text), 'í', 'i');
    if answer_token in ('true', 'yes', 'si', '1') then
      normalized := coalesce(
        (question.scoring_config->>'yes_score')::numeric,
        100
      );
    elsif answer_token in ('false', 'no', '0') then
      normalized := coalesce(
        (question.scoring_config->>'no_score')::numeric,
        0
      );
    else
      raise exception 'La respuesta no es válida para una pregunta Sí/No';
    end if;
    return round(least(greatest(normalized, 0), 100), 4);
  end if;

  if question.response_type = 'scale' then
    raw := answer_text::numeric;
    normalized := (raw - question.scale_min)
      / nullif(question.scale_max - question.scale_min, 0) * 100;
    if coalesce(question.scoring_config->>'direction', 'higher') = 'lower' then
      normalized := 100 - normalized;
    end if;
    return round(least(greatest(normalized, 0), 100), 4);
  end if;

  if question.response_type = 'percentage' then
    raw := answer_text::numeric;
    normalized := least(greatest(raw, 0), 100);
    if coalesce(question.scoring_config->>'mode', 'direct') = 'inverse' then
      normalized := 100 - normalized;
    end if;
    return round(normalized, 4);
  end if;

  if question.response_type = 'number' then
    if not public.is_score_question_scorable(target_question_id) then
      return null;
    end if;

    raw := answer_text::numeric;
    response_mode := coalesce(
      question.scoring_config->>'mode',
      case when question.scoring_config ? 'target' then 'target' end
    );

    if response_mode = 'target' then
      response_direction := coalesce(
        question.scoring_config->>'direction',
        'higher'
      );
      if response_direction = 'lower' then
        if raw = 0 then
          return 100;
        end if;
        normalized := (question.scoring_config->>'target')::numeric / raw * 100;
      else
        normalized := raw / (question.scoring_config->>'target')::numeric * 100;
      end if;
      return round(least(greatest(normalized, 0), 100), 4);
    end if;

    select (threshold_item->>'score')::numeric
      into normalized
    from jsonb_array_elements(
      question.scoring_config->'thresholds'
    ) threshold_item
    where raw >= (threshold_item->>'min')::numeric
      and (
        threshold_item->'max' = 'null'::jsonb
        or raw <= (threshold_item->>'max')::numeric
      )
    limit 1;

    if not found then
      return null;
    end if;
    return round(least(greatest(normalized, 0), 100), 4);
  end if;

  if question.response_type = 'multiple_choice' then
    if not public.is_score_question_scorable(target_question_id) then
      return null;
    end if;

    select (option_item->>'score')::numeric
      into option_score
    from jsonb_array_elements(question.options) option_item
    where option_item->>'value' = answer_text
    limit 1;

    if not found then
      return null;
    end if;
    return round(least(greatest(option_score, 0), 100), 4);
  end if;

  -- Text remains evidence/information and is never scored in V1.
  return null;
exception
  when invalid_text_representation or division_by_zero then
    raise exception 'La respuesta no puede convertirse en una puntuación válida';
end
$$;

revoke all on function public.score_question_configuration_is_valid(
  text, integer, integer, jsonb, jsonb, boolean
) from public;
grant execute on function public.score_question_configuration_is_valid(
  text, integer, integer, jsonb, jsonb, boolean
) to authenticated;
revoke all on function public.validate_score_question_configuration()
  from public;
revoke all on function public.validate_score_template_publication()
  from public;

revoke all on function public.is_score_question_scorable(uuid) from public;
grant execute on function public.is_score_question_scorable(uuid)
  to authenticated;

revoke all on function public.normalize_discovery_response(uuid, jsonb)
  from public;
grant execute on function public.normalize_discovery_response(uuid, jsonb)
  to authenticated;

-- Static acceptance matrix (documentation only; no test data is inserted):
-- yes_no default:          yes=100, no=0, true=100, false=0, 1=100, 0=0
-- yes_no inverted:         yes_score=0, no_score=100
-- scale 1..5 higher:       1=0, 3=50, 5=100
-- scale 1..5 lower:        1=100, 3=50, 5=0
-- percentage direct:      20=20, 80=80
-- percentage inverse:     20=80, 80=20
-- number target 100 high: 50=50, 100=100, 200=100
-- number target partial:  draft-valid, not scorable, not publishable
-- number thresholds:      partial=draft-valid; complete non-overlapping=scorable
-- number threshold gaps:  valid and normalize to NULL when unmatched
-- multiple_choice:        partial=draft-valid; complete unique values=scorable
-- text:                   always NULL

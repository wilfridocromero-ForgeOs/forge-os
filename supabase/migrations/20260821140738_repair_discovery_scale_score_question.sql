-- Repair the single published ORVESEN OS score question whose response type
-- drifted from its linked Discovery question. The guardrails make the change
-- fail closed if the production relationship no longer matches the audited
-- state. Historical responses and calculated results are intentionally left
-- untouched.
do $$
declare
  affected_rows integer;
begin
  if not exists (
    select 1
    from public.discovery_question_score_links link
    join public.discovery_questions discovery_question
      on discovery_question.id = link.discovery_question_id
    join public.discovery_sections section
      on section.id = discovery_question.section_id
    join public.discovery_templates template
      on template.id = section.template_id
    join public.score_questions score_question
      on score_question.id = link.score_question_id
    where link.active
      and template.id = 'd16e877e-0f59-4605-8fd6-b2fdfa9fdd16'::uuid
      and template.organization_id = '7070c469-2b6a-427c-bc33-bfec8b493201'::uuid
      and discovery_question.id = '2d616508-af4d-43c0-9c29-340b5faba896'::uuid
      and discovery_question.response_type = 'scale'
      and score_question.id = 'c5902a9f-7d63-490b-9aed-0eb57e556585'::uuid
      and score_question.response_type = 'yes_no'
  ) then
    raise exception 'Audited Discovery/Score response-type mismatch was not found';
  end if;

  update public.score_questions
  set response_type = 'scale',
      scale_min = 1,
      scale_max = 5,
      updated_at = now()
  where id = 'c5902a9f-7d63-490b-9aed-0eb57e556585'::uuid
    and response_type = 'yes_no';

  get diagnostics affected_rows = row_count;
  if affected_rows <> 1 then
    raise exception 'Expected to repair one Score question, repaired %', affected_rows;
  end if;
end
$$;

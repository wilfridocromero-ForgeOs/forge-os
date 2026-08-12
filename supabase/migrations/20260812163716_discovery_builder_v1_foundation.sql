-- ORVESEN OS - Discovery Builder V1 data foundation.
-- Candidate migration only. It has not been applied to any database.

create table public.discovery_templates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  division_id uuid references public.divisions(id) on delete restrict,
  name text not null,
  description text,
  status text not null default 'draft',
  version integer not null default 1,
  created_by uuid not null default auth.uid() references public.users(id) on delete restrict,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint discovery_templates_name_check check (btrim(name) <> ''),
  constraint discovery_templates_status_check check (status in ('draft', 'published', 'archived')),
  constraint discovery_templates_version_check check (version > 0),
  constraint discovery_templates_published_at_check check (
    published_at is null or status in ('published', 'archived')
  )
);

create table public.discovery_sections (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.discovery_templates(id) on delete cascade,
  title text not null,
  description text,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint discovery_sections_title_check check (btrim(title) <> ''),
  constraint discovery_sections_position_check check (position >= 0)
);

create table public.discovery_questions (
  id uuid primary key default gen_random_uuid(),
  section_id uuid not null references public.discovery_sections(id) on delete cascade,
  prompt text not null,
  help_text text,
  response_type text not null,
  options jsonb not null default '[]'::jsonb,
  required boolean not null default false,
  position integer not null default 0,
  question_kind text not null default 'informative',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint discovery_questions_prompt_check check (btrim(prompt) <> ''),
  constraint discovery_questions_response_type_check check (
    response_type in ('scale', 'boolean', 'yes_no', 'number', 'percentage', 'text', 'multiple_choice')
  ),
  constraint discovery_questions_options_check check (jsonb_typeof(options) = 'array'),
  constraint discovery_questions_position_check check (position >= 0),
  constraint discovery_questions_kind_check check (question_kind in ('informative', 'evaluative'))
);

create table public.discovery_question_score_links (
  id uuid primary key default gen_random_uuid(),
  discovery_question_id uuid not null references public.discovery_questions(id) on delete cascade,
  score_question_id uuid not null references public.score_questions(id) on delete restrict,
  mapping_config jsonb not null default '{}'::jsonb,
  active boolean not null default true,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint discovery_question_score_links_unique unique (discovery_question_id, score_question_id),
  constraint discovery_question_score_links_mapping_check check (jsonb_typeof(mapping_config) = 'object'),
  constraint discovery_question_score_links_position_check check (position >= 0)
);

alter table public.discovery_assessments
  add column discovery_template_id uuid references public.discovery_templates(id) on delete restrict;

alter table public.discovery_responses
  add column discovery_question_id uuid references public.discovery_questions(id) on delete restrict;

-- Preserve the historical score-question column and FK while allowing
-- informative Discovery questions that do not produce a score.
alter table public.discovery_responses
  alter column question_id drop not null,
  add constraint discovery_responses_question_identity_check
    check (question_id is not null or discovery_question_id is not null);

-- PostgreSQL's historical UNIQUE (assessment_id, question_id) remains intact.
-- NULL score-question IDs do not collide, so Discovery identity gets its own
-- partial unique index.
create unique index discovery_responses_assessment_discovery_question_uidx
  on public.discovery_responses(assessment_id, discovery_question_id)
  where discovery_question_id is not null;

create index discovery_templates_org_status_idx
  on public.discovery_templates(organization_id, status, updated_at desc);
create index discovery_templates_division_idx
  on public.discovery_templates(division_id, status)
  where division_id is not null;
create index discovery_templates_created_by_idx
  on public.discovery_templates(created_by, updated_at desc);
create index discovery_sections_template_position_idx
  on public.discovery_sections(template_id, position);
create index discovery_questions_section_position_idx
  on public.discovery_questions(section_id, position);
create index discovery_question_score_links_score_question_idx
  on public.discovery_question_score_links(score_question_id)
  where active;
create index discovery_assessments_discovery_template_idx
  on public.discovery_assessments(discovery_template_id)
  where discovery_template_id is not null;

-- Both Discovery tables are empty at authoring time, verified read-only.
-- The existing max_score > 0 constraint remains valid.
alter table public.discovery_assessments
  alter column max_score set default 100;

-- The existing trigger calls normalize_discovery_response for every response.
-- This minimal compatibility change leaves the scoring engine canonical and
-- assigns no numeric score to purely informative responses.
create or replace function public.handle_discovery_response_score()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if new.question_id is null then
    new.numeric_score := null;
  else
    new.numeric_score := public.normalize_discovery_response(new.question_id, new.response_value);
  end if;
  new.updated_at := now();
  return new;
end
$$;

-- A response that uses a Discovery question must use a question from the
-- exact Discovery template assigned to its assessment.
create function public.validate_discovery_response_question()
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

  return new;
end
$$;

create trigger validate_discovery_response_question_trigger
before insert or update of assessment_id, discovery_question_id
on public.discovery_responses
for each row execute function public.validate_discovery_response_question();

-- Enforce same-organization links in PostgreSQL. V1 intentionally does not
-- infer or allow global/official Score templates.
create function public.validate_discovery_score_link_organization()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  discovery_organization_id uuid;
  score_organization_id uuid;
begin
  select dt.organization_id
    into discovery_organization_id
  from public.discovery_questions dq
  join public.discovery_sections ds on ds.id = dq.section_id
  join public.discovery_templates dt on dt.id = ds.template_id
  where dq.id = new.discovery_question_id;

  select st.organization_id
    into score_organization_id
  from public.score_questions sq
  join public.score_categories sc on sc.id = sq.category_id
  join public.score_templates st on st.id = sc.template_id
  where sq.id = new.score_question_id;

  if discovery_organization_id is null or score_organization_id is null then
    raise exception using
      errcode = '23503',
      message = 'No se pudo validar la pregunta Discovery o la pregunta Score';
  end if;

  if discovery_organization_id <> score_organization_id then
    raise exception using
      errcode = '42501',
      message = 'Discovery y Score deben pertenecer a la misma organizacion';
  end if;

  return new;
end
$$;

create trigger validate_discovery_score_link_organization_trigger
before insert or update of discovery_question_id, score_question_id
on public.discovery_question_score_links
for each row execute function public.validate_discovery_score_link_organization();

-- A division is optional, but when present it must belong to the template's
-- organization. A foreign key alone cannot enforce this cross-table rule.
create function public.validate_discovery_template_division()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  division_organization_id uuid;
begin
  if new.division_id is null then
    return new;
  end if;

  select d.organization_id
    into division_organization_id
  from public.divisions d
  where d.id = new.division_id;

  if division_organization_id is null
     or division_organization_id <> new.organization_id then
    raise exception using
      errcode = '42501',
      message = 'La division debe pertenecer a la organizacion del Discovery';
  end if;

  return new;
end
$$;

create trigger validate_discovery_template_division_trigger
before insert or update of organization_id, division_id
on public.discovery_templates
for each row execute function public.validate_discovery_template_division();

create trigger discovery_templates_set_updated_at
before update on public.discovery_templates
for each row execute function public.set_updated_at();
create trigger discovery_sections_set_updated_at
before update on public.discovery_sections
for each row execute function public.set_updated_at();
create trigger discovery_questions_set_updated_at
before update on public.discovery_questions
for each row execute function public.set_updated_at();
create trigger discovery_question_score_links_set_updated_at
before update on public.discovery_question_score_links
for each row execute function public.set_updated_at();

alter table public.discovery_templates enable row level security;
alter table public.discovery_sections enable row level security;
alter table public.discovery_questions enable row level security;
alter table public.discovery_question_score_links enable row level security;

revoke all on public.discovery_templates, public.discovery_sections,
  public.discovery_questions, public.discovery_question_score_links from anon;
grant select, insert, update, delete on public.discovery_templates,
  public.discovery_sections, public.discovery_questions,
  public.discovery_question_score_links to authenticated;

create policy "Organization members read discovery templates"
on public.discovery_templates for select to authenticated
using (
  organization_id = (select public.current_user_organization_id())
  or (select public.is_platform_owner())
);
create policy "Managers create discovery templates"
on public.discovery_templates for insert to authenticated
with check (
  (select public.can_manage_organization(organization_id))
  and created_by = (select auth.uid())
);
create policy "Managers update discovery templates"
on public.discovery_templates for update to authenticated
using ((select public.can_manage_organization(organization_id)))
with check ((select public.can_manage_organization(organization_id)));
create policy "Managers delete discovery templates"
on public.discovery_templates for delete to authenticated
using ((select public.can_manage_organization(organization_id)));

create policy "Organization members read discovery sections"
on public.discovery_sections for select to authenticated
using (exists (
  select 1 from public.discovery_templates dt
  where dt.id = template_id
    and (dt.organization_id = (select public.current_user_organization_id())
      or (select public.is_platform_owner()))
));
create policy "Managers create discovery sections"
on public.discovery_sections for insert to authenticated
with check (exists (
  select 1 from public.discovery_templates dt
  where dt.id = template_id
    and (select public.can_manage_organization(dt.organization_id))
));
create policy "Managers update discovery sections"
on public.discovery_sections for update to authenticated
using (exists (
  select 1 from public.discovery_templates dt
  where dt.id = template_id
    and (select public.can_manage_organization(dt.organization_id))
))
with check (exists (
  select 1 from public.discovery_templates dt
  where dt.id = template_id
    and (select public.can_manage_organization(dt.organization_id))
));
create policy "Managers delete discovery sections"
on public.discovery_sections for delete to authenticated
using (exists (
  select 1 from public.discovery_templates dt
  where dt.id = template_id
    and (select public.can_manage_organization(dt.organization_id))
));

create policy "Organization members read discovery questions"
on public.discovery_questions for select to authenticated
using (exists (
  select 1
  from public.discovery_sections ds
  join public.discovery_templates dt on dt.id = ds.template_id
  where ds.id = section_id
    and (dt.organization_id = (select public.current_user_organization_id())
      or (select public.is_platform_owner()))
));
create policy "Managers create discovery questions"
on public.discovery_questions for insert to authenticated
with check (exists (
  select 1
  from public.discovery_sections ds
  join public.discovery_templates dt on dt.id = ds.template_id
  where ds.id = section_id
    and (select public.can_manage_organization(dt.organization_id))
));
create policy "Managers update discovery questions"
on public.discovery_questions for update to authenticated
using (exists (
  select 1
  from public.discovery_sections ds
  join public.discovery_templates dt on dt.id = ds.template_id
  where ds.id = section_id
    and (select public.can_manage_organization(dt.organization_id))
))
with check (exists (
  select 1
  from public.discovery_sections ds
  join public.discovery_templates dt on dt.id = ds.template_id
  where ds.id = section_id
    and (select public.can_manage_organization(dt.organization_id))
));
create policy "Managers delete discovery questions"
on public.discovery_questions for delete to authenticated
using (exists (
  select 1
  from public.discovery_sections ds
  join public.discovery_templates dt on dt.id = ds.template_id
  where ds.id = section_id
    and (select public.can_manage_organization(dt.organization_id))
));

create policy "Organization members read discovery score links"
on public.discovery_question_score_links for select to authenticated
using (exists (
  select 1
  from public.discovery_questions dq
  join public.discovery_sections ds on ds.id = dq.section_id
  join public.discovery_templates dt on dt.id = ds.template_id
  where dq.id = discovery_question_id
    and (dt.organization_id = (select public.current_user_organization_id())
      or (select public.is_platform_owner()))
));
create policy "Managers create discovery score links"
on public.discovery_question_score_links for insert to authenticated
with check (exists (
  select 1
  from public.discovery_questions dq
  join public.discovery_sections ds on ds.id = dq.section_id
  join public.discovery_templates dt on dt.id = ds.template_id
  where dq.id = discovery_question_id
    and (select public.can_manage_organization(dt.organization_id))
));
create policy "Managers update discovery score links"
on public.discovery_question_score_links for update to authenticated
using (exists (
  select 1
  from public.discovery_questions dq
  join public.discovery_sections ds on ds.id = dq.section_id
  join public.discovery_templates dt on dt.id = ds.template_id
  where dq.id = discovery_question_id
    and (select public.can_manage_organization(dt.organization_id))
))
with check (exists (
  select 1
  from public.discovery_questions dq
  join public.discovery_sections ds on ds.id = dq.section_id
  join public.discovery_templates dt on dt.id = ds.template_id
  where dq.id = discovery_question_id
    and (select public.can_manage_organization(dt.organization_id))
));
create policy "Managers delete discovery score links"
on public.discovery_question_score_links for delete to authenticated
using (exists (
  select 1
  from public.discovery_questions dq
  join public.discovery_sections ds on ds.id = dq.section_id
  join public.discovery_templates dt on dt.id = ds.template_id
  where dq.id = discovery_question_id
    and (select public.can_manage_organization(dt.organization_id))
));

revoke all on function public.validate_discovery_response_question() from public;
revoke all on function public.validate_discovery_score_link_organization() from public;
revoke all on function public.validate_discovery_template_division() from public;

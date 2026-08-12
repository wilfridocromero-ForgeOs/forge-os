-- Recovered Discovery V1 migration.
-- Version aligned with remote history: 20260806001003 (discovery_v1).
-- The SQL body was recovered from the existing local artifact and validated
-- against the current remote PostgreSQL catalogs. It is not a byte-for-byte
-- export of the original migration stored by Supabase.

-- ORVESEN Discovery V1: normalized responses, diagnostic results and conversion-ready recommendations.

alter table public.score_questions
  add column if not exists options jsonb not null default '[]'::jsonb check (jsonb_typeof(options) = 'array'),
  add column if not exists scoring_config jsonb not null default '{}'::jsonb check (jsonb_typeof(scoring_config) = 'object');

alter table public.discovery_assessments
  add column if not exists maturity_level text,
  add column if not exists diagnosis jsonb not null default '{}'::jsonb check (jsonb_typeof(diagnosis) = 'object'),
  add column if not exists selected_path text check (selected_path is null or selected_path in ('self_service','orvesen_help')),
  add column if not exists analysis_version integer not null default 1,
  add column if not exists started_at timestamptz not null default now();

create table if not exists public.discovery_responses (
  id uuid primary key default gen_random_uuid(),
  assessment_id uuid not null references public.discovery_assessments(id) on delete cascade,
  question_id uuid not null references public.score_questions(id) on delete restrict,
  response_value jsonb not null,
  numeric_score numeric(7,4) check (numeric_score is null or numeric_score between 0 and 100),
  answered_by uuid not null references public.users(id) on delete restrict default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (assessment_id, question_id)
);

create table if not exists public.discovery_category_results (
  id uuid primary key default gen_random_uuid(),
  assessment_id uuid not null references public.discovery_assessments(id) on delete cascade,
  category_id uuid not null references public.score_categories(id) on delete restrict,
  score numeric(12,2) not null default 0,
  max_score numeric(12,2) not null default 100 check (max_score > 0),
  percentage numeric(7,4) not null check (percentage between 0 and 100),
  status text not null check (status in ('critical','priority','developing','strong')),
  created_at timestamptz not null default now(),
  unique (assessment_id, category_id)
);

create table if not exists public.discovery_recommendation_rules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  template_id uuid references public.score_templates(id) on delete cascade,
  category_id uuid references public.score_categories(id) on delete cascade,
  service_key text not null,
  service_name text not null,
  description text not null default '',
  minimum_percentage numeric(7,4) not null default 0 check (minimum_percentage between 0 and 100),
  maximum_percentage numeric(7,4) not null default 59.9999 check (maximum_percentage between 0 and 100),
  priority integer not null default 100,
  project_blueprint jsonb not null default '{}'::jsonb check (jsonb_typeof(project_blueprint) = 'object'),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (minimum_percentage <= maximum_percentage)
);

create table if not exists public.discovery_recommendations (
  id uuid primary key default gen_random_uuid(),
  assessment_id uuid not null references public.discovery_assessments(id) on delete cascade,
  category_id uuid references public.score_categories(id) on delete set null,
  rule_id uuid references public.discovery_recommendation_rules(id) on delete set null,
  service_key text not null,
  title text not null,
  reason text not null,
  priority integer not null default 100,
  status text not null default 'recommended' check (status in ('recommended','accepted','dismissed','converted')),
  project_blueprint jsonb not null default '{}'::jsonb check (jsonb_typeof(project_blueprint) = 'object'),
  created_at timestamptz not null default now(),
  unique (assessment_id, service_key)
);

create table if not exists public.strategist_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  assessment_id uuid not null references public.discovery_assessments(id) on delete cascade,
  requested_by uuid not null references public.users(id) on delete restrict default auth.uid(),
  assigned_to uuid references public.users(id) on delete set null,
  status text not null default 'requested' check (status in ('requested','assigned','contacted','closed','cancelled')),
  message text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (assessment_id)
);

create index if not exists discovery_responses_assessment_idx on public.discovery_responses(assessment_id);
create index if not exists discovery_responses_question_idx on public.discovery_responses(question_id);
create index if not exists discovery_category_results_assessment_idx on public.discovery_category_results(assessment_id);
create index if not exists discovery_rules_org_template_idx on public.discovery_recommendation_rules(organization_id, template_id, active);
create index if not exists discovery_recommendations_assessment_idx on public.discovery_recommendations(assessment_id, priority);
create index if not exists strategist_requests_org_status_idx on public.strategist_requests(organization_id, status);

alter table public.discovery_responses enable row level security;
alter table public.discovery_category_results enable row level security;
alter table public.discovery_recommendation_rules enable row level security;
alter table public.discovery_recommendations enable row level security;
alter table public.strategist_requests enable row level security;

grant select, insert, update, delete on public.discovery_responses, public.discovery_category_results,
  public.discovery_recommendations, public.strategist_requests to authenticated;
grant select on public.discovery_recommendation_rules to authenticated;
grant insert, update, delete on public.discovery_recommendation_rules to authenticated;

create or replace function public.discovery_assessment_visible(target_assessment_id uuid)
returns boolean language sql stable security invoker set search_path = public as $$
  select exists (
    select 1 from public.discovery_assessments a
    where a.id = target_assessment_id
      and (a.organization_id = (select public.current_user_organization_id()) or (select public.is_platform_owner()))
  )
$$;

drop policy if exists "Members manage discovery responses" on public.discovery_responses;
create policy "Members manage discovery responses" on public.discovery_responses for all to authenticated
using ((select public.discovery_assessment_visible(assessment_id)))
with check ((select public.discovery_assessment_visible(assessment_id)) and answered_by = (select auth.uid()));

drop policy if exists "Members read discovery category results" on public.discovery_category_results;
create policy "Members read discovery category results" on public.discovery_category_results for select to authenticated
using ((select public.discovery_assessment_visible(assessment_id)));
drop policy if exists "Members create discovery category results" on public.discovery_category_results;
create policy "Members create discovery category results" on public.discovery_category_results for insert to authenticated
with check ((select public.discovery_assessment_visible(assessment_id)));
drop policy if exists "Members update discovery category results" on public.discovery_category_results;
create policy "Members update discovery category results" on public.discovery_category_results for update to authenticated
using ((select public.discovery_assessment_visible(assessment_id))) with check ((select public.discovery_assessment_visible(assessment_id)));
drop policy if exists "Members delete discovery category results" on public.discovery_category_results;
create policy "Members delete discovery category results" on public.discovery_category_results for delete to authenticated
using ((select public.discovery_assessment_visible(assessment_id)));

drop policy if exists "Members read discovery recommendation rules" on public.discovery_recommendation_rules;
create policy "Members read discovery recommendation rules" on public.discovery_recommendation_rules for select to authenticated
using (organization_id = (select public.current_user_organization_id()) or (select public.is_platform_owner()));
drop policy if exists "Managers manage discovery recommendation rules" on public.discovery_recommendation_rules;
drop policy if exists "Managers create discovery recommendation rules" on public.discovery_recommendation_rules;
create policy "Managers create discovery recommendation rules" on public.discovery_recommendation_rules for insert to authenticated
with check ((select public.can_manage_organization(organization_id)));
drop policy if exists "Managers update discovery recommendation rules" on public.discovery_recommendation_rules;
create policy "Managers update discovery recommendation rules" on public.discovery_recommendation_rules for update to authenticated
using ((select public.can_manage_organization(organization_id))) with check ((select public.can_manage_organization(organization_id)));
drop policy if exists "Managers delete discovery recommendation rules" on public.discovery_recommendation_rules;
create policy "Managers delete discovery recommendation rules" on public.discovery_recommendation_rules for delete to authenticated
using ((select public.can_manage_organization(organization_id)));

drop policy if exists "Members read discovery recommendations" on public.discovery_recommendations;
create policy "Members read discovery recommendations" on public.discovery_recommendations for select to authenticated
using ((select public.discovery_assessment_visible(assessment_id)));
drop policy if exists "Members create discovery recommendations" on public.discovery_recommendations;
create policy "Members create discovery recommendations" on public.discovery_recommendations for insert to authenticated
with check ((select public.discovery_assessment_visible(assessment_id)));
drop policy if exists "Members update discovery recommendations" on public.discovery_recommendations;
create policy "Members update discovery recommendations" on public.discovery_recommendations for update to authenticated
using ((select public.discovery_assessment_visible(assessment_id))) with check ((select public.discovery_assessment_visible(assessment_id)));
drop policy if exists "Members delete discovery recommendations" on public.discovery_recommendations;
create policy "Members delete discovery recommendations" on public.discovery_recommendations for delete to authenticated
using ((select public.discovery_assessment_visible(assessment_id)));

drop policy if exists "Members read strategist requests" on public.strategist_requests;
create policy "Members read strategist requests" on public.strategist_requests for select to authenticated
using (organization_id = (select public.current_user_organization_id()) or (select public.is_platform_owner()));
drop policy if exists "Members request strategist" on public.strategist_requests;
create policy "Members request strategist" on public.strategist_requests for insert to authenticated
with check (organization_id = (select public.current_user_organization_id()) and requested_by = (select auth.uid()) and (select public.discovery_assessment_visible(assessment_id)));
drop policy if exists "Managers update strategist requests" on public.strategist_requests;
create policy "Managers update strategist requests" on public.strategist_requests for update to authenticated
using ((select public.can_manage_organization(organization_id))) with check ((select public.can_manage_organization(organization_id)));

create or replace function public.normalize_discovery_response(target_question_id uuid, target_value jsonb)
returns numeric language plpgsql stable security invoker set search_path = public as $$
declare q record; raw numeric; option_score numeric;
begin
  select response_type, scale_min, scale_max, options, scoring_config into q from public.score_questions where id = target_question_id;
  if not found then raise exception 'Pregunta no encontrada'; end if;
  if q.response_type = 'scale' then
    raw := (target_value #>> '{}')::numeric;
    return round(least(greatest((raw - q.scale_min) / nullif(q.scale_max - q.scale_min, 0) * 100, 0), 100), 4);
  elsif q.response_type in ('yes_no','boolean') then
    return case when lower(target_value #>> '{}') in ('true','yes','si','sí','1') then 100 else 0 end;
  elsif q.response_type = 'percentage' then
    return round(least(greatest((target_value #>> '{}')::numeric, 0), 100), 4);
  elsif q.response_type = 'number' and q.scoring_config ? 'target' then
    raw := (target_value #>> '{}')::numeric;
    if coalesce(q.scoring_config->>'direction','higher') = 'lower' then
      return round(least(greatest((q.scoring_config->>'target')::numeric / nullif(raw,0) * 100,0),100),4);
    end if;
    return round(least(greatest(raw / nullif((q.scoring_config->>'target')::numeric,0) * 100,0),100),4);
  elsif q.response_type = 'multiple_choice' then
    select (item->>'score')::numeric into option_score from jsonb_array_elements(q.options) item where item->'value' = target_value limit 1;
    return least(greatest(option_score,0),100);
  end if;
  return null;
exception when invalid_text_representation or division_by_zero then
  raise exception 'La respuesta no puede convertirse en una puntuación válida';
end $$;

create or replace function public.handle_discovery_response_score()
returns trigger language plpgsql security invoker set search_path = public as $$
begin
  new.numeric_score := public.normalize_discovery_response(new.question_id, new.response_value);
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists discovery_response_score_trigger on public.discovery_responses;
create trigger discovery_response_score_trigger before insert or update of response_value, question_id on public.discovery_responses
for each row execute function public.handle_discovery_response_score();

create or replace function public.finalize_discovery(target_assessment_id uuid)
returns public.discovery_assessments language plpgsql security invoker set search_path = public as $$
declare assessment public.discovery_assessments; missing_required integer; overall_percentage numeric; strengths jsonb; weaknesses jsonb; priorities jsonb;
begin
  select * into assessment from public.discovery_assessments where id = target_assessment_id for update;
  if not found or not public.discovery_assessment_visible(target_assessment_id) then raise exception 'Discovery no disponible'; end if;

  select count(*) into missing_required
  from public.score_categories c join public.score_questions q on q.category_id = c.id
  left join public.discovery_responses r on r.assessment_id = target_assessment_id and r.question_id = q.id
  where c.template_id = assessment.template_id and q.required and r.id is null;
  if missing_required > 0 then raise exception 'Faltan % respuestas obligatorias', missing_required; end if;

  delete from public.discovery_category_results where assessment_id = target_assessment_id;
  insert into public.discovery_category_results(assessment_id, category_id, score, max_score, percentage, status)
  select target_assessment_id, c.id,
    round(coalesce(sum(r.numeric_score * q.weight) / nullif(sum(q.weight) filter (where r.numeric_score is not null),0),0),2), 100,
    round(coalesce(sum(r.numeric_score * q.weight) / nullif(sum(q.weight) filter (where r.numeric_score is not null),0),0),4),
    case when coalesce(sum(r.numeric_score * q.weight) / nullif(sum(q.weight) filter (where r.numeric_score is not null),0),0) < 40 then 'critical'
      when coalesce(sum(r.numeric_score * q.weight) / nullif(sum(q.weight) filter (where r.numeric_score is not null),0),0) < 60 then 'priority'
      when coalesce(sum(r.numeric_score * q.weight) / nullif(sum(q.weight) filter (where r.numeric_score is not null),0),0) < 75 then 'developing' else 'strong' end
  from public.score_categories c join public.score_questions q on q.category_id = c.id
  left join public.discovery_responses r on r.assessment_id = target_assessment_id and r.question_id = q.id
  where c.template_id = assessment.template_id group by c.id;

  select coalesce(sum(cr.percentage * c.weight) / nullif(sum(c.weight),0),0) into overall_percentage
  from public.discovery_category_results cr join public.score_categories c on c.id=cr.category_id where cr.assessment_id=target_assessment_id;
  select coalesce(jsonb_agg(jsonb_build_object('categoryId',c.id,'name',c.name,'percentage',cr.percentage) order by cr.percentage desc),'[]') into strengths
    from public.discovery_category_results cr join public.score_categories c on c.id=cr.category_id where cr.assessment_id=target_assessment_id and cr.percentage>=75;
  select coalesce(jsonb_agg(jsonb_build_object('categoryId',c.id,'name',c.name,'percentage',cr.percentage) order by cr.percentage),'[]') into weaknesses
    from public.discovery_category_results cr join public.score_categories c on c.id=cr.category_id where cr.assessment_id=target_assessment_id and cr.percentage<60;
  select coalesce(jsonb_agg(jsonb_build_object('categoryId',c.id,'name',c.name,'percentage',cr.percentage,'weight',c.weight) order by cr.percentage,c.weight desc),'[]') into priorities
    from public.discovery_category_results cr join public.score_categories c on c.id=cr.category_id where cr.assessment_id=target_assessment_id and cr.percentage<75;

  delete from public.discovery_recommendations where assessment_id=target_assessment_id;
  insert into public.discovery_recommendations(assessment_id,category_id,rule_id,service_key,title,reason,priority,project_blueprint)
  select target_assessment_id, cr.category_id, rule.id, rule.service_key, rule.service_name,
    case when rule.description<>'' then rule.description else 'Prioridad detectada a partir de las respuestas de '||c.name||' ('||round(cr.percentage,0)||'%).' end,
    rule.priority,rule.project_blueprint
  from public.discovery_category_results cr join public.score_categories c on c.id=cr.category_id
  join public.discovery_recommendation_rules rule on rule.organization_id=assessment.organization_id and rule.active
    and (rule.template_id is null or rule.template_id=assessment.template_id) and (rule.category_id is null or rule.category_id=cr.category_id)
    and cr.percentage between rule.minimum_percentage and rule.maximum_percentage
  where cr.assessment_id=target_assessment_id
  on conflict (assessment_id,service_key) do update set title=excluded.title,reason=excluded.reason,priority=excluded.priority,project_blueprint=excluded.project_blueprint;

  insert into public.discovery_recommendations(assessment_id,category_id,service_key,title,reason,priority)
  select target_assessment_id,cr.category_id,'improve-'||c.id::text,'Fortalecer '||c.name,
    'Las respuestas sitúan esta categoría en '||round(cr.percentage,0)||'%. Requiere un plan de mejora antes de escalar.',
    100 + row_number() over(order by cr.percentage,c.weight desc)
  from public.discovery_category_results cr join public.score_categories c on c.id=cr.category_id
  where cr.assessment_id=target_assessment_id and cr.percentage<60
    and not exists (select 1 from public.discovery_recommendations r where r.assessment_id=target_assessment_id and r.category_id=cr.category_id)
  on conflict (assessment_id,service_key) do nothing;

  update public.discovery_assessments set status='completed', score=round(max_score*overall_percentage/100,2), completed_at=now(), updated_at=now(),
    maturity_level=case when overall_percentage<40 then 'Fundacional' when overall_percentage<60 then 'En desarrollo' when overall_percentage<75 then 'Establecido' when overall_percentage<90 then 'Avanzado' else 'Optimizado' end,
    diagnosis=jsonb_build_object('percentage',round(overall_percentage,2),'strengths',strengths,'weaknesses',weaknesses,'priorities',priorities,'calculatedAt',now(),'calculation','weighted_categories_v1')
  where id=target_assessment_id returning * into assessment;
  return assessment;
end $$;

grant execute on function public.discovery_assessment_visible(uuid), public.normalize_discovery_response(uuid,jsonb), public.finalize_discovery(uuid) to authenticated;

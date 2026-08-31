-- Discovery safe delete: destructive assessment deletion is restricted to a
-- narrow, server-authorized lifecycle operation. Finalized result aggregates
-- remain protected and direct table deletion is no longer exposed.

drop policy if exists "Organization members delete discovery_assessments"
  on public.discovery_assessments;

revoke delete on table public.discovery_assessments from public, anon, authenticated;

create or replace function public.delete_in_progress_discovery_assessment(
  target_assessment_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  active_organization_id uuid;
  assessment_row public.discovery_assessments%rowtype;
begin
  if actor_id is null then
    raise exception using errcode = '42501', message = 'DISCOVERY_DELETE_NOT_AUTHENTICATED';
  end if;

  active_organization_id := public.current_user_organization_id();

  select assessment.*
  into assessment_row
  from public.discovery_assessments as assessment
  where assessment.id = target_assessment_id
  for update;

  -- Deliberately use the same response for missing and cross-organization IDs.
  if not found
     or active_organization_id is null
     or assessment_row.organization_id <> active_organization_id then
    raise exception using errcode = 'P0001', message = 'DISCOVERY_ASSESSMENT_NOT_AVAILABLE';
  end if;

  if not public.can_manage_organization(assessment_row.organization_id) then
    raise exception using errcode = '42501', message = 'DISCOVERY_DELETE_NOT_AUTHORIZED';
  end if;

  if assessment_row.status not in ('draft', 'in_progress') then
    raise exception using errcode = 'P0001', message = 'DISCOVERY_ASSESSMENT_NOT_DELETABLE';
  end if;

  -- Unfinished rows must not be used as a back door to remove materialized
  -- Discovery or Score results if historical data is ever inconsistent.
  if exists (
    select 1 from public.discovery_category_results as category_result
    where category_result.assessment_id = assessment_row.id
  ) or exists (
    select 1 from public.discovery_recommendations as recommendation
    where recommendation.assessment_id = assessment_row.id
  ) or exists (
    select 1 from public.score_template_results as score_result
    where score_result.assessment_id = assessment_row.id
  ) then
    raise exception using errcode = 'P0001', message = 'DISCOVERY_ASSESSMENT_HAS_RESULTS';
  end if;

  delete from public.discovery_assessments
  where id = assessment_row.id;

  return assessment_row.id;
end;
$$;

alter function public.delete_in_progress_discovery_assessment(uuid) owner to postgres;
revoke all on function public.delete_in_progress_discovery_assessment(uuid) from public, anon;
grant execute on function public.delete_in_progress_discovery_assessment(uuid) to authenticated;

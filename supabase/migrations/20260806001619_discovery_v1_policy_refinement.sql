-- Discovery V1 policy refinement baseline.
-- Version aligned with remote history: 20260806001619
-- (discovery_v1_policy_refinement).
--
-- The original migration body is not downloadable from the Supabase migration
-- history. This file reconstructs the current remote policy state reported by
-- pg_policies. It must be treated as a baseline, not as a byte-for-byte copy of
-- the historical SQL.

drop policy if exists "Organization members write discovery_assessments"
  on public.discovery_assessments;

drop policy if exists "Organization members read discovery_assessments"
  on public.discovery_assessments;
create policy "Organization members read discovery_assessments"
  on public.discovery_assessments
  for select
  to authenticated
  using (
    organization_id = (select public.current_user_organization_id())
    or (select public.is_platform_owner())
  );

drop policy if exists "Organization members insert discovery_assessments"
  on public.discovery_assessments;
create policy "Organization members insert discovery_assessments"
  on public.discovery_assessments
  for insert
  to authenticated
  with check (
    organization_id = (select public.current_user_organization_id())
  );

drop policy if exists "Organization members update discovery_assessments"
  on public.discovery_assessments;
create policy "Organization members update discovery_assessments"
  on public.discovery_assessments
  for update
  to authenticated
  using (
    organization_id = (select public.current_user_organization_id())
  )
  with check (
    organization_id = (select public.current_user_organization_id())
  );

drop policy if exists "Organization members delete discovery_assessments"
  on public.discovery_assessments;
create policy "Organization members delete discovery_assessments"
  on public.discovery_assessments
  for delete
  to authenticated
  using (
    organization_id = (select public.current_user_organization_id())
  );

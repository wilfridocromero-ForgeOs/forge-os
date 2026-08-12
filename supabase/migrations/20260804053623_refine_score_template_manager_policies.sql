-- Exact historical SQL recovered read-only from
-- supabase_migrations.schema_migrations (20260804053623 / refine_score_template_manager_policies).
-- The migration is already applied remotely. Do not execute it manually
-- against production; this copy is for local history reconciliation only.


drop policy if exists "score_templates_manage_org" on public.score_templates;

drop policy if exists "score_templates_insert_manager" on public.score_templates;
create policy "score_templates_insert_manager" on public.score_templates
for insert to authenticated
with check (
  (select public.can_manage_organization(organization_id))
  and created_by = (select auth.uid())
  and exists (
    select 1 from public.work_areas wa
    where wa.id = area_id and wa.organization_id = organization_id
  )
);

drop policy if exists "score_templates_update_manager" on public.score_templates;
create policy "score_templates_update_manager" on public.score_templates
for update to authenticated
using ((select public.can_manage_organization(organization_id)))
with check (
  (select public.can_manage_organization(organization_id))
  and exists (
    select 1 from public.work_areas wa
    where wa.id = area_id and wa.organization_id = organization_id
  )
);

drop policy if exists "score_templates_delete_manager" on public.score_templates;
create policy "score_templates_delete_manager" on public.score_templates
for delete to authenticated
using ((select public.can_manage_organization(organization_id)));


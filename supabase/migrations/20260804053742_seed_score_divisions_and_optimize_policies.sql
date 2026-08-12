-- Exact historical SQL recovered read-only from
-- supabase_migrations.schema_migrations (20260804053742 / seed_score_divisions_and_optimize_policies).
-- The migration is already applied remotely. Do not execute it manually
-- against production; this copy is for local history reconciliation only.


insert into public.work_areas (organization_id, name, slug, description, active)
select distinct
  u.organization_id,
  trim(u.division),
  lower(regexp_replace(trim(u.division), '[^a-zA-Z0-9]+', '-', 'g')) || '-' || left(md5(u.organization_id::text || trim(u.division)), 6),
  'División de ORVESEN',
  true
from public.users u
where nullif(trim(u.division), '') is not null
  and not exists (
    select 1 from public.work_areas wa
    where wa.organization_id = u.organization_id and lower(wa.name) = lower(trim(u.division))
  );

create index if not exists score_templates_area_id_idx on public.score_templates(area_id);
create index if not exists score_templates_created_by_idx on public.score_templates(created_by);

drop policy if exists "score_categories_manage_org" on public.score_categories;
create policy "score_categories_insert_manager" on public.score_categories
for insert to authenticated with check (exists (
  select 1 from public.score_templates st
  where st.id = template_id and (select public.can_manage_organization(st.organization_id))
));
create policy "score_categories_update_manager" on public.score_categories
for update to authenticated
using (exists (select 1 from public.score_templates st where st.id = template_id and (select public.can_manage_organization(st.organization_id))))
with check (exists (select 1 from public.score_templates st where st.id = template_id and (select public.can_manage_organization(st.organization_id))));
create policy "score_categories_delete_manager" on public.score_categories
for delete to authenticated
using (exists (select 1 from public.score_templates st where st.id = template_id and (select public.can_manage_organization(st.organization_id))));

drop policy if exists "score_questions_manage_org" on public.score_questions;
create policy "score_questions_insert_manager" on public.score_questions
for insert to authenticated with check (exists (
  select 1 from public.score_categories sc join public.score_templates st on st.id=sc.template_id
  where sc.id=category_id and (select public.can_manage_organization(st.organization_id))
));
create policy "score_questions_update_manager" on public.score_questions
for update to authenticated
using (exists (select 1 from public.score_categories sc join public.score_templates st on st.id=sc.template_id where sc.id=category_id and (select public.can_manage_organization(st.organization_id))))
with check (exists (select 1 from public.score_categories sc join public.score_templates st on st.id=sc.template_id where sc.id=category_id and (select public.can_manage_organization(st.organization_id))));
create policy "score_questions_delete_manager" on public.score_questions
for delete to authenticated
using (exists (select 1 from public.score_categories sc join public.score_templates st on st.id=sc.template_id where sc.id=category_id and (select public.can_manage_organization(st.organization_id))));


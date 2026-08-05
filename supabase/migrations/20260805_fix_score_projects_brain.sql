-- Focused fixes: Score Builder RLS, Projects division validation and ORVESEN library.
drop policy if exists score_templates_insert_manager on public.score_templates;
drop policy if exists score_templates_update_manager on public.score_templates;

create policy score_templates_insert_manager
on public.score_templates for insert to authenticated
with check (
  (select public.can_manage_organization(score_templates.organization_id))
  and created_by = (select auth.uid())
  and division_id is not null
  and exists (
    select 1 from public.divisions d
    where d.id = score_templates.division_id
      and d.organization_id = score_templates.organization_id
      and d.active
  )
);

create policy score_templates_update_manager
on public.score_templates for update to authenticated
using ((select public.can_manage_organization(score_templates.organization_id)))
with check (
  (select public.can_manage_organization(score_templates.organization_id))
  and division_id is not null
  and exists (
    select 1 from public.divisions d
    where d.id = score_templates.division_id
      and d.organization_id = score_templates.organization_id
      and d.active
  )
);

drop policy if exists "Organization members create projects" on public.projects;
drop policy if exists "Project owners and managers update projects" on public.projects;

create policy "Organization members create projects"
on public.projects for insert to authenticated
with check (
  projects.organization_id = (select public.current_user_organization_id())
  and projects.created_by = (select auth.uid())
  and exists (
    select 1 from public.divisions d
    where d.id = projects.division_id
      and d.organization_id = projects.organization_id
      and d.active
  )
);

create policy "Project owners and managers update projects"
on public.projects for update to authenticated
using (
  projects.organization_id = (select public.current_user_organization_id())
  and (
    projects.owner_id = (select auth.uid())
    or projects.created_by = (select auth.uid())
    or (select public.is_platform_owner())
    or public.can_manage_organization(projects.organization_id)
  )
)
with check (
  projects.organization_id = (select public.current_user_organization_id())
  and exists (
    select 1 from public.divisions d
    where d.id = projects.division_id
      and d.organization_id = projects.organization_id
      and d.active
  )
);

insert into public.knowledge_folders (organization_id, parent_id, division_id, name, created_by)
select o.id, null, null, 'Fundación ORVESEN', u.id
from public.organizations o
join lateral (
  select id from public.users
  where organization_id = o.id and role in ('platform_owner','organization_admin')
  order by case when role='platform_owner' then 0 else 1 end, created_at
  limit 1
) u on true
where o.organization_type = 'internal'
  and not exists (
    select 1 from public.knowledge_folders f
    where f.organization_id=o.id and f.parent_id is null and lower(f.name)=lower('Fundación ORVESEN')
  );

-- Projects V1: organization-safe references, task ordering, archival and strict RLS.

alter table public.project_tasks
  add column if not exists position integer not null default 0;

alter table public.projects drop constraint if exists projects_status_check;
alter table public.projects add constraint projects_status_check
  check (status in ('planned', 'active', 'blocked', 'completed', 'cancelled', 'archived'));

create index if not exists project_tasks_project_position_idx
  on public.project_tasks (project_id, position, created_at);

create or replace function private.validate_project_organization_scope()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.divisions d
    where d.id = new.division_id
      and d.organization_id = new.organization_id
      and d.active
  ) then
    raise exception 'Project division must belong to the project organization';
  end if;

  if new.client_id is not null and not exists (
    select 1 from public.clients c
    where c.id = new.client_id
      and c.organization_id = new.organization_id
  ) then
    raise exception 'Project client must belong to the project organization';
  end if;

  if new.owner_id is not null and not exists (
    select 1 from public.organization_memberships m
    where m.user_id = new.owner_id
      and m.organization_id = new.organization_id
  ) then
    raise exception 'Project owner must be a member of the project organization';
  end if;

  if new.created_by is not null and not exists (
    select 1 from public.organization_memberships m
    where m.user_id = new.created_by
      and m.organization_id = new.organization_id
  ) then
    raise exception 'Project creator must be a member of the project organization';
  end if;

  return new;
end;
$$;

create or replace function private.validate_project_task_organization_scope()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  project_organization_id uuid;
begin
  select p.organization_id into project_organization_id
  from public.projects p
  where p.id = new.project_id;

  if project_organization_id is null then
    raise exception 'Project does not exist';
  end if;

  if new.assigned_to is not null and not exists (
    select 1 from public.organization_memberships m
    where m.user_id = new.assigned_to
      and m.organization_id = project_organization_id
  ) then
    raise exception 'Task assignee must be a member of the project organization';
  end if;

  if not exists (
    select 1 from public.organization_memberships m
    where m.user_id = new.created_by
      and m.organization_id = project_organization_id
  ) then
    raise exception 'Task creator must be a member of the project organization';
  end if;

  return new;
end;
$$;

revoke all on function private.validate_project_organization_scope() from public, anon, authenticated;
revoke all on function private.validate_project_task_organization_scope() from public, anon, authenticated;

drop trigger if exists validate_project_organization_scope_trigger on public.projects;
create trigger validate_project_organization_scope_trigger
before insert or update of organization_id, division_id, client_id, owner_id, created_by
on public.projects
for each row execute function private.validate_project_organization_scope();

drop trigger if exists validate_project_task_organization_scope_trigger on public.project_tasks;
create trigger validate_project_task_organization_scope_trigger
before insert or update of project_id, assigned_to, created_by
on public.project_tasks
for each row execute function private.validate_project_task_organization_scope();

drop policy if exists "Organization members read projects" on public.projects;
create policy "Organization members read projects"
on public.projects for select to authenticated
using (organization_id = (select public.current_user_organization_id()));

do $$
declare
  project_table text;
begin
  foreach project_table in array array[
    'project_tasks', 'project_comments', 'project_files', 'project_deliverables',
    'project_activity', 'project_automations'
  ] loop
    execute format('drop policy if exists "Project members read %1$s" on public.%1$I', project_table);
    execute format(
      'create policy "Project members read %1$s" on public.%1$I for select to authenticated using (exists (select 1 from public.projects p where p.id = project_id and p.organization_id = (select public.current_user_organization_id())))',
      project_table
    );
  end loop;
end;
$$;

drop policy if exists "Authors delete comments" on public.project_comments;
create policy "Authors delete comments" on public.project_comments
for delete to authenticated using (
  author_id = (select auth.uid())
  and exists (
    select 1 from public.projects p
    where p.id = project_comments.project_id
      and p.organization_id = (select public.current_user_organization_id())
  )
);

drop policy if exists "Authors update comments" on public.project_comments;
create policy "Authors update comments" on public.project_comments
for update to authenticated using (
  author_id = (select auth.uid())
  and exists (
    select 1 from public.projects p
    where p.id = project_comments.project_id
      and p.organization_id = (select public.current_user_organization_id())
  )
) with check (
  author_id = (select auth.uid())
  and exists (
    select 1 from public.projects p
    where p.id = project_comments.project_id
      and p.organization_id = (select public.current_user_organization_id())
  )
);

drop policy if exists "Project managers delete tasks" on public.project_tasks;
create policy "Project managers delete tasks" on public.project_tasks
for delete to authenticated using (
  exists (
    select 1 from public.projects p
    where p.id = project_tasks.project_id
      and p.organization_id = (select public.current_user_organization_id())
      and (project_tasks.created_by = (select auth.uid()) or public.can_manage_organization(p.organization_id))
  )
);

drop policy if exists "Project owners delete deliverables" on public.project_deliverables;
create policy "Project owners delete deliverables" on public.project_deliverables
for delete to authenticated using (
  exists (
    select 1 from public.projects p
    where p.id = project_deliverables.project_id
      and p.organization_id = (select public.current_user_organization_id())
      and (project_deliverables.created_by = (select auth.uid()) or public.can_manage_organization(p.organization_id))
  )
);

drop policy if exists "Project owners update deliverables" on public.project_deliverables;
create policy "Project owners update deliverables" on public.project_deliverables
for update to authenticated using (
  exists (
    select 1 from public.projects p
    where p.id = project_deliverables.project_id
      and p.organization_id = (select public.current_user_organization_id())
      and (project_deliverables.created_by = (select auth.uid()) or public.can_manage_organization(p.organization_id))
  )
) with check (
  exists (
    select 1 from public.projects p
    where p.id = project_deliverables.project_id
      and p.organization_id = (select public.current_user_organization_id())
  )
);

drop policy if exists "Uploaders delete files" on public.project_files;
create policy "Uploaders delete files" on public.project_files
for delete to authenticated using (
  uploaded_by = (select auth.uid())
  and exists (
    select 1 from public.projects p
    where p.id = project_files.project_id
      and p.organization_id = (select public.current_user_organization_id())
  )
);

drop policy if exists "Project managers delete automations" on public.project_automations;
create policy "Project managers delete automations" on public.project_automations
for delete to authenticated using (
  created_by = (select auth.uid())
  and exists (
    select 1 from public.projects p
    where p.id = project_automations.project_id
      and p.organization_id = (select public.current_user_organization_id())
  )
);

drop policy if exists "Project managers update automations" on public.project_automations;
create policy "Project managers update automations" on public.project_automations
for update to authenticated using (
  created_by = (select auth.uid())
  and exists (
    select 1 from public.projects p
    where p.id = project_automations.project_id
      and p.organization_id = (select public.current_user_organization_id())
  )
) with check (
  created_by = (select auth.uid())
  and exists (
    select 1 from public.projects p
    where p.id = project_automations.project_id
      and p.organization_id = (select public.current_user_organization_id())
  )
);

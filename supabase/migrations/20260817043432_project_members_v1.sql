create table public.project_members (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete restrict,
  role text not null,
  added_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint project_members_role_check check (role in ('owner', 'member', 'observer')),
  constraint project_members_project_user_key unique (project_id, user_id)
);

create unique index project_members_one_owner_idx
  on public.project_members (project_id)
  where role = 'owner';
create index project_members_user_idx on public.project_members (user_id, project_id);
create index project_members_project_role_idx on public.project_members (project_id, role);

alter table public.project_members enable row level security;

create or replace function public.can_manage_project_membership(target_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    (select auth.uid()) is not null
    and exists (
      select 1
      from public.projects p
      where p.id = target_project_id
        and (
          (select public.is_platform_owner())
          or (
            p.organization_id = (select public.current_user_organization_id())
            and (
              p.owner_id = (select auth.uid())
              or public.can_manage_organization(p.organization_id)
            )
          )
        )
    );
$$;

alter function public.can_manage_project_membership(uuid) owner to postgres;
revoke all on function public.can_manage_project_membership(uuid) from public, anon, authenticated;
grant execute on function public.can_manage_project_membership(uuid) to authenticated;

create or replace function private.validate_project_member_scope()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  project_organization_id uuid;
  project_owner_id uuid;
begin
  if tg_op = 'UPDATE' and (
    old.project_id is distinct from new.project_id
    or old.user_id is distinct from new.user_id
    or old.added_by is distinct from new.added_by
  ) then
    raise exception 'Project member identity fields are immutable';
  end if;

  select p.organization_id, p.owner_id
  into project_organization_id, project_owner_id
  from public.projects p
  where p.id = new.project_id;

  if project_organization_id is null then
    raise exception 'Project does not exist';
  end if;

  if not exists (
    select 1 from public.users u
    join public.organization_memberships m
      on m.user_id = u.id and m.organization_id = project_organization_id
    where u.id = new.user_id
      and u.organization_id = project_organization_id
  ) then
    raise exception 'Project member must belong to the project organization';
  end if;

  if new.added_by is not null and not exists (
    select 1 from public.organization_memberships m
    where m.user_id = new.added_by and m.organization_id = project_organization_id
  ) then
    raise exception 'Project member actor must belong to the project organization';
  end if;

  if new.role = 'owner' and new.user_id is distinct from project_owner_id then
    raise exception 'Project owner membership must match projects.owner_id';
  end if;

  return new;
end;
$$;

create or replace function private.block_project_member_removal_with_open_tasks()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1 from public.project_tasks t
    where t.project_id = old.project_id
      and t.assigned_to = old.user_id
      and t.status not in ('completed', 'cancelled')
  ) then
    raise exception 'Reassign or unassign open tasks before removing this project member';
  end if;
  return old;
end;
$$;

create or replace function private.sync_project_owner_membership()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  previous_setting text := current_setting('orvesen.syncing_project_owner', true);
begin
  perform set_config('orvesen.syncing_project_owner', 'on', true);

  update public.project_members
  set role = 'member', updated_at = now()
  where project_id = new.id
    and role = 'owner'
    and (new.owner_id is null or user_id is distinct from new.owner_id);

  if new.owner_id is not null then
    insert into public.project_members (project_id, user_id, role, added_by)
    values (new.id, new.owner_id, 'owner', coalesce((select auth.uid()), new.created_by, new.owner_id))
    on conflict (project_id, user_id) do update
      set role = 'owner', updated_at = now();
  end if;

  perform set_config('orvesen.syncing_project_owner', coalesce(previous_setting, 'off'), true);
  return new;
exception when others then
  perform set_config('orvesen.syncing_project_owner', coalesce(previous_setting, 'off'), true);
  raise;
end;
$$;

create or replace function private.record_project_member_activity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  activity_event text;
  activity_project_id uuid;
  affected_user_id uuid;
  old_role text;
  new_role text;
begin
  if current_setting('orvesen.syncing_project_owner', true) = 'on' then
    return coalesce(new, old);
  end if;

  activity_project_id := case when tg_op = 'DELETE' then old.project_id else new.project_id end;
  affected_user_id := case when tg_op = 'DELETE' then old.user_id else new.user_id end;

  if tg_op = 'INSERT' then
    activity_event := 'member_added';
    new_role := new.role;
  elsif tg_op = 'DELETE' then
    activity_event := 'member_removed';
    old_role := old.role;
  elsif old.role is distinct from new.role then
    activity_event := 'member_role_changed';
    old_role := old.role;
    new_role := new.role;
  else
    return new;
  end if;

  insert into public.project_activity (
    project_id, actor_id, event_type, entity_type, entity_id, payload
  ) values (
    activity_project_id,
    (select auth.uid()),
    activity_event,
    'project_member',
    affected_user_id::text,
    jsonb_build_object('user_id', affected_user_id, 'old_role', old_role, 'new_role', new_role)
  );

  return coalesce(new, old);
end;
$$;

create or replace function private.record_project_activity_v2()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  activity_event text;
  activity_payload jsonb := '{}'::jsonb;
begin
  if tg_op = 'INSERT' then
    activity_event := 'project_created';
    activity_payload := jsonb_build_object('name', new.name, 'status', new.status);
  elsif old.owner_id is distinct from new.owner_id then
    activity_event := 'project_owner_changed';
    activity_payload := jsonb_build_object('name', new.name, 'old_owner_id', old.owner_id, 'new_owner_id', new.owner_id);
  elsif old.status is distinct from new.status then
    activity_event := case
      when new.status = 'completed' then 'project_completed'
      when old.status = 'completed' and new.status in ('planned', 'active', 'blocked') then 'project_reopened'
      when new.status = 'archived' then 'project_archived'
      else 'project_status_changed'
    end;
    activity_payload := jsonb_build_object('name', new.name, 'old_status', old.status, 'new_status', new.status);
  elsif old.name is distinct from new.name
     or old.description is distinct from new.description
     or old.priority is distinct from new.priority
     or old.division_id is distinct from new.division_id
     or old.client_id is distinct from new.client_id
     or old.starts_at is distinct from new.starts_at
     or old.due_at is distinct from new.due_at then
    activity_event := 'project_updated';
    activity_payload := jsonb_build_object('name', new.name, 'old_priority', old.priority, 'new_priority', new.priority);
  end if;

  if activity_event is not null then
    insert into public.project_activity (project_id, actor_id, event_type, entity_type, entity_id, payload)
    values (new.id, (select auth.uid()), activity_event, 'project', new.id::text, activity_payload);
  end if;
  return new;
end;
$$;

revoke all on function private.validate_project_member_scope() from public, anon, authenticated;
revoke all on function private.block_project_member_removal_with_open_tasks() from public, anon, authenticated;
revoke all on function private.sync_project_owner_membership() from public, anon, authenticated;
revoke all on function private.record_project_member_activity() from public, anon, authenticated;
revoke all on function private.record_project_activity_v2() from public, anon, authenticated;

create trigger set_project_members_updated_at
before update on public.project_members
for each row execute function public.set_updated_at();

create trigger validate_project_member_scope_trigger
before insert or update on public.project_members
for each row execute function private.validate_project_member_scope();

create trigger block_project_member_removal_trigger
before delete on public.project_members
for each row execute function private.block_project_member_removal_with_open_tasks();

drop trigger if exists record_project_activity_trigger on public.projects;
create trigger record_project_activity_v2_trigger
after insert or update on public.projects
for each row execute function private.record_project_activity_v2();

create trigger sync_project_owner_membership_trigger
after insert or update of owner_id on public.projects
for each row execute function private.sync_project_owner_membership();

insert into public.project_members (project_id, user_id, role, added_by)
select p.id, p.owner_id, 'owner', coalesce(p.created_by, p.owner_id)
from public.projects p
where p.owner_id is not null
on conflict (project_id, user_id) do update set role = 'owner', updated_at = now();

insert into public.project_members (project_id, user_id, role, added_by)
select t.project_id, t.assigned_to, 'member', coalesce(t.created_by, p.created_by, t.assigned_to)
from public.project_tasks t
join public.projects p on p.id = t.project_id
where t.assigned_to is not null
  and t.assigned_to is distinct from p.owner_id
on conflict (project_id, user_id) do nothing;

create trigger record_project_member_activity_trigger
after insert or update or delete on public.project_members
for each row execute function private.record_project_member_activity();

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
  from public.projects p where p.id = new.project_id;

  if project_organization_id is null then raise exception 'Project does not exist'; end if;

  if new.assigned_to is not null and not exists (
    select 1 from public.project_members pm
    where pm.project_id = new.project_id
      and pm.user_id = new.assigned_to
      and pm.role in ('owner', 'member')
  ) then
    raise exception 'Task assignee must be an owner or member of the project';
  end if;

  if not exists (
    select 1 from public.organization_memberships m
    where m.user_id = new.created_by and m.organization_id = project_organization_id
  ) then
    raise exception 'Task creator must be a member of the project organization';
  end if;

  return new;
end;
$$;

revoke all on function private.validate_project_task_organization_scope() from public, anon, authenticated;

create policy "Project participants read project members"
on public.project_members for select to authenticated
using (
  exists (
    select 1 from public.projects p
    where p.id = project_id
      and p.organization_id = (select public.current_user_organization_id())
  )
);

create policy "Project managers add project members"
on public.project_members for insert to authenticated
with check (
  role in ('member', 'observer')
  and added_by = (select auth.uid())
  and public.can_manage_project_membership(project_id)
);

create policy "Project managers update project members"
on public.project_members for update to authenticated
using (role <> 'owner' and public.can_manage_project_membership(project_id))
with check (role in ('member', 'observer') and public.can_manage_project_membership(project_id));

create policy "Project managers remove project members"
on public.project_members for delete to authenticated
using (role <> 'owner' and public.can_manage_project_membership(project_id));

revoke all on table public.project_members from public, anon, authenticated;
grant select, insert, update, delete on table public.project_members to authenticated;

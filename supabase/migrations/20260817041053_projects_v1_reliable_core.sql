-- Projects V1: reliable completion semantics and transactional activity history.

alter table public.project_tasks
  add column completed_by uuid references public.users(id) on delete set null;

create index project_tasks_completed_by_idx
  on public.project_tasks (completed_by)
  where completed_by is not null;

create or replace function private.apply_project_completion_semantics()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.completed_at := case when new.status = 'completed' then now() else null end;
  elsif new.status = 'completed' and old.status <> 'completed' then
    new.completed_at := now();
  elsif new.status = 'completed' and old.status = 'completed' then
    new.completed_at := old.completed_at;
  elsif old.status = 'completed' and new.status in ('planned', 'active', 'blocked') then
    new.completed_at := null;
  else
    new.completed_at := old.completed_at;
  end if;
  return new;
end;
$$;

create or replace function private.apply_project_task_completion_semantics()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  project_organization_id uuid;
begin
  if tg_op = 'INSERT' then
    if new.status = 'completed' then
      new.completed_at := now();
      new.completed_by := actor;
    else
      new.completed_at := null;
      new.completed_by := null;
    end if;
  elsif new.status = 'completed' and old.status <> 'completed' then
    new.completed_at := now();
    new.completed_by := actor;
  elsif new.status = 'completed' and old.status = 'completed' then
    new.completed_at := old.completed_at;
    new.completed_by := old.completed_by;
  else
    new.completed_at := null;
    new.completed_by := null;
  end if;

  if new.completed_by is not null then
    select p.organization_id into project_organization_id
    from public.projects p
    where p.id = new.project_id;

    if not exists (
      select 1 from public.organization_memberships m
      where m.organization_id = project_organization_id
        and m.user_id = new.completed_by
    ) then
      raise exception 'Task completer must be a member of the project organization';
    end if;
  end if;

  return new;
end;
$$;

create or replace function private.apply_project_deliverable_approval_semantics()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  project_organization_id uuid;
begin
  if tg_op = 'INSERT' then
    if new.status = 'approved' then
      new.approved_at := now();
      new.approved_by := actor;
    else
      new.approved_at := null;
      new.approved_by := null;
    end if;
  elsif new.status = 'approved' and old.status <> 'approved' then
    new.approved_at := now();
    new.approved_by := actor;
  elsif new.status = 'approved' and old.status = 'approved' then
    new.approved_at := old.approved_at;
    new.approved_by := old.approved_by;
  else
    new.approved_at := null;
    new.approved_by := null;
  end if;

  if new.approved_by is not null then
    select p.organization_id into project_organization_id
    from public.projects p
    where p.id = new.project_id;

    if not exists (
      select 1 from public.organization_memberships m
      where m.organization_id = project_organization_id
        and m.user_id = new.approved_by
    ) then
      raise exception 'Deliverable approver must be a member of the project organization';
    end if;
  end if;

  return new;
end;
$$;

create or replace function private.record_project_activity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  activity_project_id uuid;
  activity_event text;
  activity_entity_type text;
  activity_entity_id text;
  activity_payload jsonb := '{}'::jsonb;
begin
  if tg_table_name = 'projects' then
    activity_project_id := coalesce(new.id, old.id);
    activity_entity_type := 'project';
    activity_entity_id := activity_project_id::text;

    if tg_op = 'INSERT' then
      activity_event := 'project_created';
      activity_payload := jsonb_build_object('name', new.name, 'status', new.status);
    elsif tg_op = 'UPDATE' and old.status is distinct from new.status then
      activity_event := case
        when new.status = 'completed' then 'project_completed'
        when old.status = 'completed' and new.status in ('planned', 'active', 'blocked') then 'project_reopened'
        when new.status = 'archived' then 'project_archived'
        else 'project_status_changed'
      end;
      activity_payload := jsonb_build_object('name', new.name, 'old_status', old.status, 'new_status', new.status);
    elsif tg_op = 'UPDATE' and (
      old.name is distinct from new.name or
      old.description is distinct from new.description or
      old.priority is distinct from new.priority or
      old.owner_id is distinct from new.owner_id or
      old.division_id is distinct from new.division_id or
      old.client_id is distinct from new.client_id or
      old.starts_at is distinct from new.starts_at or
      old.due_at is distinct from new.due_at
    ) then
      activity_event := 'project_updated';
      activity_payload := jsonb_build_object(
        'name', new.name,
        'old_owner_id', old.owner_id,
        'new_owner_id', new.owner_id,
        'old_priority', old.priority,
        'new_priority', new.priority
      );
    end if;
  elsif tg_table_name = 'project_tasks' then
    activity_project_id := case when tg_op = 'DELETE' then old.project_id else new.project_id end;
    activity_entity_type := 'task';
    activity_entity_id := case when tg_op = 'DELETE' then old.id::text else new.id::text end;

    if tg_op = 'INSERT' then
      activity_event := 'task_created';
      activity_payload := jsonb_build_object('title', new.title, 'status', new.status);
    elsif tg_op = 'DELETE' then
      activity_event := 'task_deleted';
      activity_payload := jsonb_build_object('title', old.title, 'status', old.status);
    elsif old.status is distinct from new.status then
      activity_event := case
        when new.status = 'completed' then 'task_completed'
        when old.status = 'completed' then 'task_reopened'
        else 'task_status_changed'
      end;
      activity_payload := jsonb_build_object('title', new.title, 'old_status', old.status, 'new_status', new.status);
    elsif old.title is distinct from new.title or
          old.description is distinct from new.description or
          old.priority is distinct from new.priority or
          old.assigned_to is distinct from new.assigned_to or
          old.due_at is distinct from new.due_at or
          old.work_type is distinct from new.work_type or
          old.position is distinct from new.position then
      activity_event := 'task_updated';
      activity_payload := jsonb_build_object(
        'title', new.title,
        'old_assigned_to', old.assigned_to,
        'new_assigned_to', new.assigned_to,
        'old_priority', old.priority,
        'new_priority', new.priority
      );
    end if;
  elsif tg_table_name = 'project_deliverables' then
    activity_project_id := case when tg_op = 'DELETE' then old.project_id else new.project_id end;
    activity_entity_type := 'deliverable';
    activity_entity_id := case when tg_op = 'DELETE' then old.id::text else new.id::text end;

    if tg_op = 'INSERT' then
      activity_event := 'deliverable_created';
      activity_payload := jsonb_build_object('title', new.title, 'status', new.status);
    elsif tg_op = 'DELETE' then
      activity_event := 'deliverable_deleted';
      activity_payload := jsonb_build_object('title', old.title, 'status', old.status);
    elsif old.status is distinct from new.status then
      activity_event := case when new.status = 'approved' then 'deliverable_approved' else 'deliverable_status_changed' end;
      activity_payload := jsonb_build_object('title', new.title, 'old_status', old.status, 'new_status', new.status);
    elsif old.title is distinct from new.title or
          old.description is distinct from new.description or
          old.due_at is distinct from new.due_at then
      activity_event := 'deliverable_updated';
      activity_payload := jsonb_build_object('title', new.title);
    end if;
  end if;

  if activity_event is not null then
    insert into public.project_activity (
      project_id, actor_id, event_type, entity_type, entity_id, payload
    ) values (
      activity_project_id, actor, activity_event, activity_entity_type, activity_entity_id, activity_payload
    );
  end if;

  return coalesce(new, old);
end;
$$;

revoke all on function private.apply_project_completion_semantics() from public, anon, authenticated;
revoke all on function private.apply_project_task_completion_semantics() from public, anon, authenticated;
revoke all on function private.apply_project_deliverable_approval_semantics() from public, anon, authenticated;
revoke all on function private.record_project_activity() from public, anon, authenticated;

drop trigger if exists apply_project_completion_semantics_trigger on public.projects;
create trigger apply_project_completion_semantics_trigger
before insert or update of status, completed_at on public.projects
for each row execute function private.apply_project_completion_semantics();

drop trigger if exists apply_project_task_completion_semantics_trigger on public.project_tasks;
create trigger apply_project_task_completion_semantics_trigger
before insert or update of status, completed_at, completed_by on public.project_tasks
for each row execute function private.apply_project_task_completion_semantics();

drop trigger if exists apply_project_deliverable_approval_semantics_trigger on public.project_deliverables;
create trigger apply_project_deliverable_approval_semantics_trigger
before insert or update of status, approved_at, approved_by on public.project_deliverables
for each row execute function private.apply_project_deliverable_approval_semantics();

drop trigger if exists record_project_activity_trigger on public.projects;
create trigger record_project_activity_trigger
after insert or update on public.projects
for each row execute function private.record_project_activity();

drop trigger if exists record_project_task_activity_trigger on public.project_tasks;
create trigger record_project_task_activity_trigger
after insert or update or delete on public.project_tasks
for each row execute function private.record_project_activity();

drop trigger if exists record_project_deliverable_activity_trigger on public.project_deliverables;
create trigger record_project_deliverable_activity_trigger
after insert or update or delete on public.project_deliverables
for each row execute function private.record_project_activity();

drop policy if exists "Project members append activity" on public.project_activity;

revoke all on table public.projects from anon, authenticated;
revoke all on table public.project_tasks from anon, authenticated;
revoke all on table public.project_deliverables from anon, authenticated;
revoke all on table public.project_activity from anon, authenticated;

grant select, insert, update, delete on table public.projects to authenticated;
grant select, insert, update, delete on table public.project_tasks to authenticated;
grant select, insert, update, delete on table public.project_deliverables to authenticated;
grant select on table public.project_activity to authenticated;

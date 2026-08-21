-- ORVESEN OS 8A: canonical in-app notifications.

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  recipient_user_id uuid not null references public.users(id) on delete cascade,
  actor_user_id uuid references public.users(id) on delete set null,
  type text not null check (type in (
    'task_assigned',
    'task_reassigned',
    'task_completed',
    'task_reopened',
    'evidence_submitted',
    'project_comment_added'
  )),
  title text not null check (char_length(trim(title)) between 1 and 160),
  body text check (body is null or char_length(body) <= 500),
  entity_type text check (entity_type is null or char_length(entity_type) <= 80),
  entity_id uuid,
  project_id uuid references public.projects(id) on delete set null,
  task_id uuid references public.project_tasks(id) on delete set null,
  source_type text check (source_type is null or char_length(source_type) <= 80),
  source_id uuid,
  action_url text check (
    action_url is null
    or (char_length(action_url) <= 2000 and action_url like '/%' and action_url not like '//%')
  ),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index notifications_recipient_created_idx
  on public.notifications (recipient_user_id, organization_id, created_at desc, id desc);

create index notifications_recipient_unread_idx
  on public.notifications (recipient_user_id, organization_id, created_at desc)
  where read_at is null;

alter table public.notifications enable row level security;

revoke all on table public.notifications from public, anon, authenticated;
grant select on table public.notifications to authenticated;
grant update (read_at) on table public.notifications to authenticated;

create policy "Users read their own notifications"
on public.notifications
for select
to authenticated
using (
  recipient_user_id = (select auth.uid())
  and organization_id = (select public.current_user_organization_id())
);

create policy "Users update their own notification read state"
on public.notifications
for update
to authenticated
using (
  recipient_user_id = (select auth.uid())
  and organization_id = (select public.current_user_organization_id())
)
with check (
  recipient_user_id = (select auth.uid())
  and organization_id = (select public.current_user_organization_id())
);

create or replace function private.create_notification(
  target_recipient_user_id uuid,
  target_organization_id uuid,
  target_actor_user_id uuid,
  notification_type text,
  notification_title text,
  notification_body text default null,
  target_entity_type text default null,
  target_entity_id uuid default null,
  target_project_id uuid default null,
  target_task_id uuid default null,
  target_source_type text default null,
  target_source_id uuid default null,
  target_action_url text default null,
  notification_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  notification_id uuid;
begin
  if target_recipient_user_id is null
     or target_organization_id is null
     or target_recipient_user_id is not distinct from target_actor_user_id then
    return null;
  end if;

  if not exists (
    select 1
    from public.organization_memberships membership
    where membership.user_id = target_recipient_user_id
      and membership.organization_id = target_organization_id
  ) then
    return null;
  end if;

  if target_actor_user_id is not null and not exists (
    select 1
    from public.organization_memberships membership
    where membership.user_id = target_actor_user_id
      and membership.organization_id = target_organization_id
  ) then
    return null;
  end if;

  insert into public.notifications (
    organization_id,
    recipient_user_id,
    actor_user_id,
    type,
    title,
    body,
    entity_type,
    entity_id,
    project_id,
    task_id,
    source_type,
    source_id,
    action_url,
    metadata
  ) values (
    target_organization_id,
    target_recipient_user_id,
    target_actor_user_id,
    notification_type,
    trim(notification_title),
    nullif(trim(notification_body), ''),
    target_entity_type,
    target_entity_id,
    target_project_id,
    target_task_id,
    target_source_type,
    target_source_id,
    target_action_url,
    coalesce(notification_metadata, '{}'::jsonb)
  )
  returning id into notification_id;

  return notification_id;
end;
$$;

alter function private.create_notification(uuid, uuid, uuid, text, text, text, text, uuid, uuid, uuid, text, uuid, text, jsonb) owner to postgres;
revoke all on function private.create_notification(uuid, uuid, uuid, text, text, text, text, uuid, uuid, uuid, text, uuid, text, jsonb) from public, anon, authenticated;

create or replace function private.notify_project_task_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  project_record record;
  actor_id uuid := (select auth.uid());
  recipient_id uuid;
  assignment_type text;
begin
  if new.is_recurrence_template then
    return new;
  end if;

  select project.organization_id, project.owner_id
  into project_record
  from public.projects project
  where project.id = new.project_id;

  if project_record.organization_id is null then
    return new;
  end if;

  begin
    if new.assigned_to is not null and (
      tg_op = 'INSERT'
      or new.assigned_to is distinct from old.assigned_to
    ) then
      assignment_type := case
        when tg_op = 'UPDATE' and old.assigned_to is not null then 'task_reassigned'
        else 'task_assigned'
      end;

      perform private.create_notification(
        new.assigned_to,
        project_record.organization_id,
        actor_id,
        assignment_type,
        case assignment_type when 'task_reassigned' then 'Tarea reasignada' else 'Nueva tarea asignada' end,
        new.title,
        'project_task',
        new.id,
        new.project_id,
        new.id,
        'project_task',
        new.id,
        '/proyectos/' || new.project_id::text || '?tab=work&task=' || new.id::text,
        jsonb_build_object('status', new.status)
      );
    end if;

    if tg_op = 'UPDATE' and new.status = 'completed' and old.status <> 'completed' then
      for recipient_id in
        select distinct candidate
        from unnest(array[new.created_by, project_record.owner_id]::uuid[]) candidate
        where candidate is not null
      loop
        perform private.create_notification(
          recipient_id,
          project_record.organization_id,
          actor_id,
          'task_completed',
          'Tarea completada',
          new.title,
          'project_task',
          new.id,
          new.project_id,
          new.id,
          'project_task',
          new.id,
          '/proyectos/' || new.project_id::text || '?tab=work&task=' || new.id::text,
          '{}'::jsonb
        );
      end loop;
    elsif tg_op = 'UPDATE' and old.status = 'completed' and new.status <> 'completed' then
      perform private.create_notification(
        new.assigned_to,
        project_record.organization_id,
        actor_id,
        'task_reopened',
        'Tarea reabierta',
        new.title,
        'project_task',
        new.id,
        new.project_id,
        new.id,
        'project_task',
        new.id,
        '/proyectos/' || new.project_id::text || '?tab=work&task=' || new.id::text,
        '{}'::jsonb
      );
    end if;
  exception when others then
    raise warning 'Notification generation failed for project task %: %', new.id, sqlerrm;
  end;

  return new;
end;
$$;

alter function private.notify_project_task_change() owner to postgres;
revoke all on function private.notify_project_task_change() from public, anon, authenticated;

create trigger notify_project_task_change_trigger
after insert or update of assigned_to, status
on public.project_tasks
for each row execute function private.notify_project_task_change();

create or replace function private.notify_project_comment_added()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  project_record record;
begin
  select project.organization_id, project.owner_id
  into project_record
  from public.projects project
  where project.id = new.project_id;

  begin
    perform private.create_notification(
      project_record.owner_id,
      project_record.organization_id,
      new.author_id,
      'project_comment_added',
      'Nuevo comentario en el proyecto',
      left(new.body, 180),
      'project_comment',
      new.id,
      new.project_id,
      null,
      'project_comment',
      new.id,
      '/proyectos/' || new.project_id::text || '?tab=activity',
      '{}'::jsonb
    );
  exception when others then
    raise warning 'Notification generation failed for project comment %: %', new.id, sqlerrm;
  end;

  return new;
end;
$$;

alter function private.notify_project_comment_added() owner to postgres;
revoke all on function private.notify_project_comment_added() from public, anon, authenticated;

create trigger notify_project_comment_added_trigger
after insert
on public.project_comments
for each row execute function private.notify_project_comment_added();

-- Projects Phase 8B: reliable, contextual task assignment notifications.

create unique index notifications_task_assignment_dedup_idx
  on public.notifications (
    recipient_user_id,
    type,
    source_type,
    source_id,
    ((metadata ->> 'assignment_version'))
  )
  where type in ('task_assigned', 'task_reassigned');

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
    organization_id, recipient_user_id, actor_user_id, type, title, body,
    entity_type, entity_id, project_id, task_id, source_type, source_id,
    action_url, metadata
  ) values (
    target_organization_id, target_recipient_user_id, target_actor_user_id,
    notification_type, trim(notification_title), nullif(trim(notification_body), ''),
    target_entity_type, target_entity_id, target_project_id, target_task_id,
    target_source_type, target_source_id, target_action_url,
    coalesce(notification_metadata, '{}'::jsonb)
  )
  on conflict do nothing
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

  select project.organization_id, project.owner_id, project.name
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
        left(format('Te asignaron «%s» en %s.', new.title, project_record.name), 500),
        'project_task',
        new.id,
        new.project_id,
        new.id,
        'project_task',
        new.id,
        '/proyectos/' || new.project_id::text || '?tab=work&task=' || new.id::text,
        jsonb_strip_nulls(jsonb_build_object(
          'status', new.status,
          'project_name', project_record.name,
          'task_title', new.title,
          'due_at', new.due_at,
          'assignment_version', new.updated_at
        ))
      );
    end if;

    if tg_op = 'UPDATE' and new.status = 'completed' and old.status <> 'completed' then
      for recipient_id in
        select distinct candidate
        from unnest(array[new.created_by, project_record.owner_id]::uuid[]) candidate
        where candidate is not null
      loop
        perform private.create_notification(
          recipient_id, project_record.organization_id, actor_id,
          'task_completed', 'Tarea completada', new.title,
          'project_task', new.id, new.project_id, new.id,
          'project_task', new.id,
          '/proyectos/' || new.project_id::text || '?tab=work&task=' || new.id::text,
          '{}'::jsonb
        );
      end loop;
    elsif tg_op = 'UPDATE' and old.status = 'completed' and new.status <> 'completed' then
      perform private.create_notification(
        new.assigned_to, project_record.organization_id, actor_id,
        'task_reopened', 'Tarea reabierta', new.title,
        'project_task', new.id, new.project_id, new.id,
        'project_task', new.id,
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

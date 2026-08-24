-- ORVESEN OS 8D: one central, retry-safe temporal scheduler.

create extension if not exists pg_cron;

alter table public.notifications
  drop constraint notifications_type_check;

alter table public.notifications
  add constraint notifications_type_check check (type in (
    'task_assigned',
    'task_reassigned',
    'task_completed',
    'task_reopened',
    'evidence_submitted',
    'project_comment_added',
    'task_due_soon',
    'task_overdue',
    'calendar_reminder'
  ));

create unique index notifications_temporal_dedup_idx
  on public.notifications (
    recipient_user_id,
    type,
    source_type,
    source_id,
    ((metadata ->> 'dedup_key'))
  )
  where type in ('task_due_soon', 'task_overdue', 'calendar_reminder');

create index project_tasks_temporal_notifications_idx
  on public.project_tasks (due_at, id)
  include (project_id, assigned_to, created_by, title)
  where due_at is not null
    and not is_recurrence_template
    and status in ('pending', 'in_progress', 'blocked');

create index calendar_events_reminder_due_idx
  on public.calendar_events (remind_at, id)
  include (organization_id, assigned_to, created_by, title, starts_at)
  where remind_at is not null
    and status = 'scheduled';

create or replace function private.run_temporal_scheduler(
  run_at timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  recurrence_count integer := 0;
  due_soon_count integer := 0;
  overdue_count integer := 0;
  calendar_count integer := 0;
begin
  if run_at is null then
    raise exception 'Scheduler run timestamp is required';
  end if;

  if not pg_catalog.pg_try_advisory_xact_lock(
    pg_catalog.hashtextextended('orvesen.temporal_scheduler.v1', 0)
  ) then
    return jsonb_build_object(
      'status', 'already_running',
      'run_at', run_at
    );
  end if;

  select private.materialize_due_project_task_occurrences()
  into recurrence_count;

  with due_soon_candidates as (
    select
      task.id,
      task.project_id,
      task.title,
      task.due_at,
      project.organization_id,
      coalesce(task.assigned_to, task.created_by) as recipient_user_id
    from public.project_tasks task
    join public.projects project on project.id = task.project_id
    join public.organization_memberships membership
      on membership.organization_id = project.organization_id
     and membership.user_id = coalesce(task.assigned_to, task.created_by)
    where not task.is_recurrence_template
      and task.status in ('pending', 'in_progress', 'blocked')
      and project.status not in ('completed', 'cancelled', 'archived')
      and task.due_at > run_at
      and task.due_at <= run_at + interval '24 hours'
    order by task.due_at, task.id
    limit 500
  )
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
  )
  select
    candidate.organization_id,
    candidate.recipient_user_id,
    null,
    'task_due_soon',
    'Tarea próxima a vencer',
    left(candidate.title, 500),
    'project_task',
    candidate.id,
    candidate.project_id,
    candidate.id,
    'project_task_due',
    candidate.id,
    '/proyectos/' || candidate.project_id::text || '?tab=work&task=' || candidate.id::text,
    jsonb_build_object(
      'dedup_key', extract(epoch from candidate.due_at)::text,
      'due_at', candidate.due_at,
      'window_hours', 24
    )
  from due_soon_candidates candidate
  on conflict do nothing;

  get diagnostics due_soon_count = row_count;

  with overdue_candidates as (
    select
      task.id,
      task.project_id,
      task.title,
      task.due_at,
      project.organization_id,
      coalesce(task.assigned_to, task.created_by) as recipient_user_id
    from public.project_tasks task
    join public.projects project on project.id = task.project_id
    join public.organization_memberships membership
      on membership.organization_id = project.organization_id
     and membership.user_id = coalesce(task.assigned_to, task.created_by)
    where not task.is_recurrence_template
      and task.status in ('pending', 'in_progress', 'blocked')
      and project.status not in ('completed', 'cancelled', 'archived')
      and task.due_at is not null
      and task.due_at <= run_at
    order by task.due_at, task.id
    limit 500
  )
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
  )
  select
    candidate.organization_id,
    candidate.recipient_user_id,
    null,
    'task_overdue',
    'Tarea vencida',
    left(candidate.title, 500),
    'project_task',
    candidate.id,
    candidate.project_id,
    candidate.id,
    'project_task_due',
    candidate.id,
    '/proyectos/' || candidate.project_id::text || '?tab=work&task=' || candidate.id::text,
    jsonb_build_object(
      'dedup_key', extract(epoch from candidate.due_at)::text,
      'due_at', candidate.due_at
    )
  from overdue_candidates candidate
  on conflict do nothing;

  get diagnostics overdue_count = row_count;

  with reminder_candidates as (
    select
      event.id,
      event.organization_id,
      event.title,
      event.starts_at,
      event.remind_at,
      coalesce(event.assigned_to, event.created_by) as recipient_user_id
    from public.calendar_events event
    join public.organization_memberships membership
      on membership.organization_id = event.organization_id
     and membership.user_id = coalesce(event.assigned_to, event.created_by)
    where event.status = 'scheduled'
      and event.remind_at is not null
      and event.remind_at <= run_at
    order by event.remind_at, event.id
    limit 500
  )
  insert into public.notifications (
    organization_id,
    recipient_user_id,
    actor_user_id,
    type,
    title,
    body,
    entity_type,
    entity_id,
    source_type,
    source_id,
    action_url,
    metadata
  )
  select
    candidate.organization_id,
    candidate.recipient_user_id,
    null,
    'calendar_reminder',
    'Recordatorio de calendario',
    left(candidate.title, 500),
    'calendar_event',
    candidate.id,
    'calendar_event_reminder',
    candidate.id,
    '/calendario?event=' || candidate.id::text,
    jsonb_build_object(
      'dedup_key', extract(epoch from candidate.remind_at)::text,
      'remind_at', candidate.remind_at,
      'starts_at', candidate.starts_at
    )
  from reminder_candidates candidate
  on conflict do nothing;

  get diagnostics calendar_count = row_count;

  return jsonb_build_object(
    'status', 'completed',
    'run_at', run_at,
    'recurrences_materialized', recurrence_count,
    'task_due_soon_created', due_soon_count,
    'task_overdue_created', overdue_count,
    'calendar_reminders_created', calendar_count
  );
end;
$function$;

alter function private.run_temporal_scheduler(timestamptz) owner to postgres;
revoke all on function private.run_temporal_scheduler(timestamptz)
  from public, anon, authenticated;

select cron.schedule(
  'orvesen-temporal-scheduler-v1',
  '*/5 * * * *',
  $cron$select private.run_temporal_scheduler();$cron$
);

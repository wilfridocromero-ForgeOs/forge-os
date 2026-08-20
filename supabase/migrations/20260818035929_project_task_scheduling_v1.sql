-- Projects V1 Phase 6A: task dates, recurrence definitions and isolated occurrences.

alter table public.project_tasks
  add column starts_at timestamptz,
  add column recurrence_schedule_id uuid,
  add column scheduled_for timestamptz,
  add column is_recurrence_template boolean not null default false;

alter table public.project_tasks
  add constraint project_tasks_dates_check
    check (due_at is null or starts_at is null or due_at >= starts_at),
  add constraint project_tasks_occurrence_shape_check
    check (
      (is_recurrence_template and recurrence_schedule_id is null and scheduled_for is null)
      or (not is_recurrence_template and (
        (recurrence_schedule_id is null and scheduled_for is null)
        or (recurrence_schedule_id is not null and scheduled_for is not null)
      ))
    );

create table public.project_task_schedules (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  template_task_id uuid not null unique references public.project_tasks(id) on delete restrict,
  recurrence_unit text not null check (recurrence_unit in ('day', 'week', 'month')),
  interval_count integer not null default 1 check (interval_count between 1 and 12),
  weekday smallint check (weekday between 0 and 6),
  day_of_month smallint check (day_of_month between 1 and 31),
  timezone text not null default 'UTC' check (char_length(timezone) between 1 and 64),
  next_run_at timestamptz not null,
  duration_minutes integer check (duration_minutes is null or duration_minutes between 0 and 525600),
  active boolean not null default true,
  last_error text,
  last_error_at timestamptz,
  last_success_at timestamptz,
  created_by uuid not null references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint project_task_schedules_last_error_check check (
    last_error is null or last_error in (
      'assignee_not_project_member', 'creator_not_organization_member',
      'template_unavailable', 'project_unavailable', 'operational_validation_failed'
    )
  ),
  constraint project_task_schedules_rule_shape_check check (
    (recurrence_unit = 'day' and weekday is null and day_of_month is null)
    or (recurrence_unit = 'week' and weekday is not null and day_of_month is null)
    or (recurrence_unit = 'month' and weekday is null and day_of_month is not null)
  )
);

alter table public.project_tasks
  add constraint project_tasks_recurrence_schedule_fkey
  foreign key (recurrence_schedule_id) references public.project_task_schedules(id) on delete restrict;

create unique index project_tasks_schedule_occurrence_key
  on public.project_tasks (recurrence_schedule_id, scheduled_for)
  where recurrence_schedule_id is not null;
create index project_tasks_calendar_idx
  on public.project_tasks (starts_at, due_at, status)
  where not is_recurrence_template;
create index project_tasks_assignee_calendar_idx
  on public.project_tasks (assigned_to, due_at, status)
  where assigned_to is not null and not is_recurrence_template;
create index project_task_schedules_due_idx
  on public.project_task_schedules (next_run_at)
  where active;
create index project_task_schedules_project_idx
  on public.project_task_schedules (project_id, active, next_run_at);
create index project_task_schedules_creator_idx
  on public.project_task_schedules (created_by);

alter table public.project_task_schedules enable row level security;
revoke all on table public.project_task_schedules from public, anon, authenticated;
grant select on table public.project_task_schedules to authenticated;
grant all on table public.project_task_schedules to service_role;

create policy "Project organization reads task schedules"
on public.project_task_schedules for select to authenticated
using (exists (
  select 1 from public.projects p
  where p.id = project_task_schedules.project_id
    and p.organization_id = (select public.current_user_organization_id())
));

drop policy if exists "Project members create tasks" on public.project_tasks;
create policy "Project participants create tasks"
on public.project_tasks for insert to authenticated
with check (
  created_by = (select auth.uid())
  and exists (
    select 1 from public.projects p
    where p.id = project_tasks.project_id
      and p.organization_id = (select public.current_user_organization_id())
      and (
        public.can_manage_project_membership(p.id)
        or exists (
          select 1 from public.project_members pm
          where pm.project_id = p.id
            and pm.user_id = (select auth.uid())
            and pm.role in ('owner', 'member')
        )
      )
  )
);

create or replace function public.can_configure_project_task(target_task_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null and exists (
    select 1
    from public.project_tasks t
    join public.projects p on p.id = t.project_id
    where t.id = target_task_id
      and p.organization_id = (select public.current_user_organization_id())
      and (
        t.created_by = (select auth.uid())
        or t.assigned_to = (select auth.uid())
        or public.can_manage_project_membership(t.project_id)
      )
      and (
        public.can_manage_project_membership(t.project_id)
        or exists (
          select 1 from public.project_members pm
          where pm.project_id = t.project_id
            and pm.user_id = (select auth.uid())
            and pm.role in ('owner', 'member')
        )
      )
  );
$$;

alter function public.can_configure_project_task(uuid) owner to postgres;
revoke all on function public.can_configure_project_task(uuid) from public, anon, authenticated;
grant execute on function public.can_configure_project_task(uuid) to authenticated;

create or replace function private.next_project_task_run(
  current_run timestamptz,
  recurrence_unit text,
  interval_count integer,
  day_of_month integer,
  timezone_name text
)
returns timestamptz
language plpgsql
stable
set search_path = ''
as $$
declare
  local_run timestamp := current_run at time zone timezone_name;
  local_next timestamp;
begin
  local_next := case recurrence_unit
    when 'day' then local_run + make_interval(days => interval_count)
    when 'week' then local_run + make_interval(days => interval_count * 7)
    when 'month' then
      date_trunc('month', local_run + make_interval(months => interval_count))
      + make_interval(days => least(day_of_month, extract(day from (
          date_trunc('month', local_run + make_interval(months => interval_count) + interval '1 month') - interval '1 day'
        ))::integer) - 1)
      + (local_run - date_trunc('day', local_run))
  end;
  return local_next at time zone timezone_name;
end;
$$;

create or replace function private.materialize_project_task_schedule(
  target_schedule_id uuid,
  horizon timestamptz default now()
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  schedule_row public.project_task_schedules%rowtype;
  template_row public.project_tasks%rowtype;
  occurrence_id uuid;
  occurrence_count integer := 0;
begin
  select * into schedule_row
  from public.project_task_schedules
  where id = target_schedule_id and active
  for update;

  if not found then return 0; end if;

  select * into template_row
  from public.project_tasks
  where id = schedule_row.template_task_id and is_recurrence_template;

  if not found then
    raise exception 'Recurring task template does not exist';
  end if;

  if template_row.assigned_to is not null and not exists (
    select 1
    from public.project_members pm
    join public.projects p on p.id = pm.project_id
    join public.organization_memberships om
      on om.organization_id = p.organization_id and om.user_id = pm.user_id
    where pm.project_id = template_row.project_id
      and pm.user_id = template_row.assigned_to
      and pm.role in ('owner', 'member')
  ) then
    raise exception 'Task assignee must be an operational project member';
  end if;

  if not exists (
    select 1
    from public.projects p
    join public.organization_memberships om
      on om.organization_id = p.organization_id
    where p.id = template_row.project_id
      and om.user_id = schedule_row.created_by
  ) then
    raise exception 'Task creator must be a member of the project organization';
  end if;

  while schedule_row.next_run_at <= horizon and occurrence_count < 100 loop
    occurrence_id := gen_random_uuid();
    insert into public.project_tasks (
      id, project_id, title, description, status, priority, assigned_to,
      starts_at, due_at, created_by, work_type, position,
      recurrence_schedule_id, scheduled_for, is_recurrence_template
    ) values (
      occurrence_id, template_row.project_id, template_row.title, template_row.description,
      'pending', template_row.priority, template_row.assigned_to,
      schedule_row.next_run_at,
      case when schedule_row.duration_minutes is null then null
           else schedule_row.next_run_at + make_interval(mins => schedule_row.duration_minutes) end,
      schedule_row.created_by, template_row.work_type, template_row.position,
      schedule_row.id, schedule_row.next_run_at, false
    ) on conflict (recurrence_schedule_id, scheduled_for) where recurrence_schedule_id is not null do nothing;

    if found then
      insert into public.task_evidence_requirements (
        task_id, evidence_type, label, description, is_required,
        min_count, max_count, position, created_by
      )
      select occurrence_id, r.evidence_type, r.label, r.description, r.is_required,
             r.min_count, r.max_count, r.position, schedule_row.created_by
      from public.task_evidence_requirements r
      where r.task_id = template_row.id;
      occurrence_count := occurrence_count + 1;
    end if;

    schedule_row.next_run_at := private.next_project_task_run(
      schedule_row.next_run_at, schedule_row.recurrence_unit,
      schedule_row.interval_count, schedule_row.day_of_month, schedule_row.timezone
    );
  end loop;

  update public.project_task_schedules
  set next_run_at = schedule_row.next_run_at,
      last_error = null,
      last_error_at = null,
      last_success_at = now(),
      updated_at = now()
  where id = schedule_row.id;
  return occurrence_count;
end;
$$;

create or replace function private.materialize_due_project_task_occurrences()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  schedule_id uuid;
  total_count integer := 0;
begin
  for schedule_id in
    select s.id from public.project_task_schedules s
    where s.active and s.next_run_at <= now()
    order by s.next_run_at
    limit 500
  loop
    begin
      total_count := total_count + private.materialize_project_task_schedule(schedule_id, now());
    exception when others then
      update public.project_task_schedules
      set active = false,
          last_error = case
            when sqlerrm ilike '%assignee%project%' then 'assignee_not_project_member'
            when sqlerrm ilike '%creator%organization%' then 'creator_not_organization_member'
            when sqlerrm ilike '%template%does not exist%' then 'template_unavailable'
            when sqlerrm ilike '%project%does not exist%' then 'project_unavailable'
            else 'operational_validation_failed'
          end,
          last_error_at = now(),
          updated_at = now()
      where id = schedule_id;

      insert into public.project_activity(project_id, actor_id, event_type, entity_type, entity_id, payload)
      select s.project_id, null, 'task_recurrence_auto_paused', 'task_schedule', s.id::text,
             jsonb_build_object('title', t.title, 'reason', s.last_error)
      from public.project_task_schedules s
      join public.project_tasks t on t.id = s.template_task_id
      where s.id = schedule_id;
    end;
  end loop;
  return total_count;
end;
$$;

create or replace function public.save_project_task_schedule(
  target_task_id uuid,
  requested_assigned_to uuid,
  requested_priority text,
  requested_work_type text,
  requested_description text,
  requested_starts_at timestamptz,
  requested_due_at timestamptz,
  requested_schedule_active boolean,
  requested_unit text,
  requested_interval integer,
  requested_weekday integer,
  requested_day_of_month integer,
  requested_first_run timestamp,
  requested_timezone text default 'UTC'
)
returns public.project_task_schedules
language plpgsql
security definer
set search_path = ''
as $$
declare
  task_row public.project_tasks%rowtype;
  schedule_row public.project_task_schedules%rowtype;
  duration_value integer;
  event_name text;
  has_schedule boolean := false;
  has_recurrence_input boolean := requested_unit is not null;
  first_run_at timestamptz;
begin
  if not public.can_configure_project_task(target_task_id) then
    raise exception 'Not allowed to configure this task';
  end if;
  if requested_priority not in ('low', 'medium', 'high', 'urgent')
     or requested_work_type not in ('task', 'checklist', 'milestone', 'review')
     or char_length(coalesce(requested_description, '')) > 2000
     or (requested_starts_at is not null and requested_due_at is not null and requested_due_at < requested_starts_at) then
    raise exception 'Invalid task configuration';
  end if;
  if has_recurrence_input and not exists (
    select 1 from pg_catalog.pg_timezone_names where name = requested_timezone
  ) then
    raise exception 'Invalid recurrence timezone';
  end if;
  first_run_at := case when has_recurrence_input then requested_first_run at time zone requested_timezone else null end;
  if has_recurrence_input and (requested_unit not in ('day', 'week', 'month')
     or requested_interval not between 1 and 12
     or requested_first_run is null
     or char_length(coalesce(requested_timezone, '')) not between 1 and 64) then
    raise exception 'Invalid recurrence configuration';
  end if;
  if requested_schedule_active and first_run_at <= now() then
    raise exception 'Next recurrence must be in the future';
  end if;
  if has_recurrence_input and ((requested_unit = 'week' and requested_weekday not between 0 and 6)
     or (requested_unit = 'month' and requested_day_of_month not between 1 and 31)) then
    raise exception 'Invalid recurrence day';
  end if;
  if has_recurrence_input and requested_unit = 'week'
     and extract(dow from requested_first_run)::integer <> requested_weekday then
    raise exception 'First run must match the selected weekday';
  end if;
  if has_recurrence_input and requested_unit = 'month'
     and extract(day from requested_first_run)::integer <> requested_day_of_month then
    raise exception 'First run must match the selected month day';
  end if;

  select * into task_row from public.project_tasks where id = target_task_id for update;
  if not found then raise exception 'Task does not exist'; end if;
  if task_row.recurrence_schedule_id is not null then
    raise exception 'Configure recurrence from its template';
  end if;
  if requested_schedule_active and task_row.status in ('completed', 'cancelled') then
    raise exception 'Only an open task can become recurring';
  end if;
  if requested_schedule_active and not task_row.is_recurrence_template
     and exists (select 1 from public.task_evidence e where e.task_id = target_task_id) then
    raise exception 'A task with evidence history cannot become a recurring template';
  end if;

  if requested_assigned_to is not null and not exists (
    select 1 from public.project_members pm
    join public.organization_memberships om
      on om.user_id = pm.user_id
    join public.projects p
      on p.id = pm.project_id and p.organization_id = om.organization_id
    where pm.project_id = task_row.project_id
      and pm.user_id = requested_assigned_to
      and pm.role in ('owner', 'member')
  ) then
    raise exception 'Task assignee must be an operational project member';
  end if;

  duration_value := case when requested_starts_at is not null and requested_due_at is not null
    then greatest(0, floor(extract(epoch from (requested_due_at - requested_starts_at)) / 60)::integer)
    when requested_due_at is not null then 0
    else null end;

  select * into schedule_row from public.project_task_schedules
  where template_task_id = target_task_id for update;
  has_schedule := found;
  event_name := case
    when has_schedule and schedule_row.active and not requested_schedule_active then 'task_recurrence_stopped'
    when has_schedule and not schedule_row.active and requested_schedule_active then 'task_recurrence_activated'
    when has_schedule then 'task_recurrence_changed'
    else 'task_recurrence_activated'
  end;

  perform set_config('orvesen.configuring_recurrence', 'on', true);
  update public.project_tasks
  set assigned_to = requested_assigned_to,
      priority = requested_priority,
      work_type = requested_work_type,
      description = nullif(trim(requested_description), ''),
      starts_at = case when requested_schedule_active then first_run_at else requested_starts_at end,
      due_at = case
        when requested_schedule_active and duration_value is not null then first_run_at + make_interval(mins => duration_value)
        when requested_schedule_active then null
        else requested_due_at
      end,
      is_recurrence_template = task_row.is_recurrence_template or requested_schedule_active,
      status = case when requested_schedule_active then 'pending' else task_row.status end,
      completed_at = case when requested_schedule_active then null else task_row.completed_at end,
      completed_by = case when requested_schedule_active then null else task_row.completed_by end
  where id = target_task_id;

  if not requested_schedule_active and not has_schedule then
    return null;
  end if;

  if not requested_schedule_active then
    update public.project_task_schedules
    set recurrence_unit = requested_unit,
        interval_count = requested_interval,
        weekday = case when requested_unit = 'week' then requested_weekday else null end,
        day_of_month = case when requested_unit = 'month' then requested_day_of_month else null end,
        timezone = requested_timezone,
        next_run_at = first_run_at,
        duration_minutes = duration_value,
        active = false,
        last_error = null,
        last_error_at = null,
        created_by = (select auth.uid()),
        updated_at = now()
    where id = schedule_row.id
    returning * into schedule_row;

    if event_name = 'task_recurrence_stopped' then
      insert into public.project_activity(project_id, actor_id, event_type, entity_type, entity_id, payload)
      values(task_row.project_id, (select auth.uid()), event_name, 'task_schedule', schedule_row.id::text,
        jsonb_build_object('title', task_row.title));
    end if;
    return schedule_row;
  end if;

  insert into public.project_task_schedules (
    project_id, template_task_id, recurrence_unit, interval_count, weekday,
    day_of_month, timezone, next_run_at, duration_minutes, active, created_by
  ) values (
    task_row.project_id, task_row.id, requested_unit, requested_interval,
    case when requested_unit = 'week' then requested_weekday else null end,
    case when requested_unit = 'month' then requested_day_of_month else null end,
    requested_timezone, first_run_at, duration_value, true, (select auth.uid())
  )
  on conflict (template_task_id) do update set
    recurrence_unit = excluded.recurrence_unit,
    interval_count = excluded.interval_count,
    weekday = excluded.weekday,
    day_of_month = excluded.day_of_month,
    timezone = excluded.timezone,
    next_run_at = excluded.next_run_at,
    duration_minutes = excluded.duration_minutes,
    active = true,
    created_by = (select auth.uid()),
    last_error = null,
    last_error_at = null,
    updated_at = now()
  returning * into schedule_row;

  insert into public.project_activity(project_id, actor_id, event_type, entity_type, entity_id, payload)
  values(task_row.project_id, (select auth.uid()), event_name, 'task_schedule', schedule_row.id::text,
    jsonb_build_object('title', task_row.title, 'unit', requested_unit, 'interval', requested_interval, 'next_run_at', first_run_at));
  return schedule_row;
end;
$$;

alter function public.save_project_task_schedule(uuid,uuid,text,text,text,timestamptz,timestamptz,boolean,text,integer,integer,integer,timestamp,text) owner to postgres;
alter function private.materialize_project_task_schedule(uuid,timestamptz) owner to postgres;
alter function private.materialize_due_project_task_occurrences() owner to postgres;
revoke all on function public.save_project_task_schedule(uuid,uuid,text,text,text,timestamptz,timestamptz,boolean,text,integer,integer,integer,timestamp,text) from public, anon, authenticated;
revoke all on function private.next_project_task_run(timestamptz,text,integer,integer,text) from public, anon, authenticated;
revoke all on function private.materialize_project_task_schedule(uuid,timestamptz) from public, anon, authenticated;
revoke all on function private.materialize_due_project_task_occurrences() from public, anon, authenticated;
grant execute on function public.save_project_task_schedule(uuid,uuid,text,text,text,timestamptz,timestamptz,boolean,text,integer,integer,integer,timestamp,text) to authenticated;

create or replace function private.validate_recurring_project_task()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is not null
     and current_setting('orvesen.configuring_recurrence', true) is distinct from 'on'
     and (tg_op = 'INSERT' or old.is_recurrence_template is distinct from new.is_recurrence_template
          or old.recurrence_schedule_id is distinct from new.recurrence_schedule_id
          or old.scheduled_for is distinct from new.scheduled_for) then
    raise exception 'Task recurrence identity is managed by the scheduling backend';
  end if;
  if new.is_recurrence_template and new.status <> 'pending' then
    raise exception 'Recurring task templates are definitions, not executions';
  end if;
  if new.assigned_to is not null and not exists (
    select 1 from public.project_members pm
    where pm.project_id = new.project_id
      and pm.user_id = new.assigned_to
      and pm.role in ('owner', 'member')
  ) then
    raise exception 'Task assignee must be an operational project member';
  end if;
  if new.recurrence_schedule_id is not null and not exists (
    select 1 from public.project_task_schedules s
    where s.id = new.recurrence_schedule_id and s.project_id = new.project_id
  ) then
    raise exception 'Task occurrence must belong to its schedule project';
  end if;
  return new;
end;
$$;

create trigger validate_recurring_project_task_trigger
before insert or update on public.project_tasks
for each row execute function private.validate_recurring_project_task();
revoke all on function private.validate_recurring_project_task() from public, anon, authenticated;

create or replace function private.recalculate_project_progress(target_project_id uuid)
returns numeric
language plpgsql
security definer
set search_path = ''
as $$
declare total_items integer; completed_items integer; calculated numeric;
begin
  select count(*), count(*) filter (where completed) into total_items, completed_items
  from (
    select status = 'completed' as completed from public.project_tasks
    where project_id = target_project_id and status <> 'cancelled' and not is_recurrence_template
    union all
    select status in ('approved', 'delivered') as completed from public.project_deliverables
    where project_id = target_project_id and status <> 'rejected'
  ) items;
  calculated := case when total_items=0 then 0 else round((completed_items::numeric/total_items::numeric)*100,2) end;
  update public.projects set progress=calculated,updated_at=now()
  where id=target_project_id and progress is distinct from calculated;
  return calculated;
end;
$$;

drop trigger if exists set_project_task_schedules_updated_at on public.project_task_schedules;
create trigger set_project_task_schedules_updated_at
before update on public.project_task_schedules for each row execute function public.set_updated_at();

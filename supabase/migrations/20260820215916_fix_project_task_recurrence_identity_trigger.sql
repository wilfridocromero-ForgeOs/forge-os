create or replace function private.validate_recurring_project_task()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is not null
     and current_setting('orvesen.configuring_recurrence', true) is distinct from 'on' then
    if tg_op = 'INSERT' then
      if new.is_recurrence_template
         or new.recurrence_schedule_id is not null
         or new.scheduled_for is not null then
        raise exception 'Task recurrence identity is managed by the scheduling backend';
      end if;
    elsif old.is_recurrence_template is distinct from new.is_recurrence_template
       or old.recurrence_schedule_id is distinct from new.recurrence_schedule_id
       or old.scheduled_for is distinct from new.scheduled_for then
      raise exception 'Task recurrence identity is managed by the scheduling backend';
    end if;
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

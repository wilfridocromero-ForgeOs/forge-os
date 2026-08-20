create or replace function private.record_task_evidence_activity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  event_name text;
  project_id_value uuid;
  task_id_value uuid := coalesce(new.task_id, old.task_id);
  label_value text;
begin
  select t.project_id into project_id_value
  from public.project_tasks t
  where t.id = task_id_value;

  -- During ON DELETE CASCADE the parent task is already gone. Its own trigger
  -- records task_deleted with OLD.project_id, so no orphan child event is needed.
  if project_id_value is null then
    if tg_table_name = 'task_evidence_requirements' and tg_op = 'DELETE' then
      return old;
    end if;
    raise exception 'Cannot record task evidence activity without a project';
  end if;

  if tg_table_name = 'task_evidence_requirements' then
    label_value := coalesce(new.label, old.label);
    event_name := case tg_op
      when 'INSERT' then 'evidence_requirement_added'
      when 'DELETE' then 'evidence_requirement_removed'
      else 'evidence_requirement_updated'
    end;
  else
    select r.label into label_value
    from public.task_evidence_requirements r
    where r.id = coalesce(new.requirement_id, old.requirement_id);

    if tg_op = 'INSERT' then
      event_name := 'evidence_submitted';
    elsif old.deleted_at is null and new.deleted_at is not null then
      event_name := 'evidence_removed';
    else
      return coalesce(new, old);
    end if;
  end if;

  insert into public.project_activity (
    project_id, actor_id, event_type, entity_type, entity_id, payload
  ) values (
    project_id_value,
    (select auth.uid()),
    event_name,
    case when tg_table_name = 'task_evidence_requirements' then 'evidence_requirement' else 'task_evidence' end,
    coalesce(new.id, old.id)::text,
    jsonb_build_object(
      'task_id', task_id_value,
      'label', label_value,
      'evidence_type', coalesce(new.evidence_type, old.evidence_type)
    )
  );
  return coalesce(new, old);
end;
$$;

revoke all on function private.record_task_evidence_activity() from public, anon, authenticated;

create or replace function public.create_project_task_with_configuration(
  target_project_id uuid,
  requested_title text,
  requested_description text,
  requested_assigned_to uuid,
  requested_priority text,
  requested_work_type text,
  requested_starts_at timestamptz,
  requested_due_at timestamptz,
  requested_evidence_requirements jsonb default '[]'::jsonb,
  requested_schedule_active boolean default false,
  requested_unit text default null,
  requested_interval integer default null,
  requested_weekday integer default null,
  requested_day_of_month integer default null,
  requested_first_run timestamp default null,
  requested_timezone text default null
)
returns public.project_tasks
language plpgsql
security invoker
set search_path = ''
as $$
declare
  created_task public.project_tasks%rowtype;
  requirement jsonb;
  requirement_position integer := 0;
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication required';
  end if;
  if jsonb_typeof(coalesce(requested_evidence_requirements, '[]'::jsonb)) <> 'array'
     or jsonb_array_length(coalesce(requested_evidence_requirements, '[]'::jsonb)) > 20 then
    raise exception 'Invalid evidence requirements';
  end if;

  insert into public.project_tasks (
    project_id, title, description, status, priority, work_type,
    assigned_to, starts_at, due_at, created_by
  ) values (
    target_project_id, trim(requested_title), nullif(trim(requested_description), ''),
    'pending', requested_priority, requested_work_type,
    requested_assigned_to, requested_starts_at, requested_due_at, (select auth.uid())
  ) returning * into created_task;

  for requirement in
    select value from jsonb_array_elements(coalesce(requested_evidence_requirements, '[]'::jsonb))
  loop
    insert into public.task_evidence_requirements (
      task_id, evidence_type, label, description, is_required,
      min_count, max_count, position, created_by
    ) values (
      created_task.id,
      requirement->>'evidence_type',
      trim(requirement->>'label'),
      nullif(trim(requirement->>'description'), ''),
      coalesce((requirement->>'is_required')::boolean, true),
      case when coalesce((requirement->>'is_required')::boolean, true)
        then coalesce((requirement->>'min_count')::integer, 1) else 0 end,
      coalesce((requirement->>'max_count')::integer, 1),
      requirement_position,
      (select auth.uid())
    );
    requirement_position := requirement_position + 1;
  end loop;

  if requested_schedule_active then
    perform public.save_project_task_schedule(
      created_task.id, requested_assigned_to, requested_priority, requested_work_type,
      requested_description, requested_starts_at, requested_due_at, true,
      requested_unit, requested_interval, requested_weekday, requested_day_of_month,
      requested_first_run, requested_timezone
    );
  end if;

  select * into created_task from public.project_tasks where id = created_task.id;
  return created_task;
end;
$$;

revoke all on function public.create_project_task_with_configuration(
  uuid,text,text,uuid,text,text,timestamptz,timestamptz,jsonb,boolean,text,integer,integer,integer,timestamp,text
) from public, anon;
grant execute on function public.create_project_task_with_configuration(
  uuid,text,text,uuid,text,text,timestamptz,timestamptz,jsonb,boolean,text,integer,integer,integer,timestamp,text
) to authenticated;

create or replace function public.save_project_task_configuration(
  target_task_id uuid,
  requested_title text,
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
  requested_timezone text default null
)
returns public.project_task_schedules
language plpgsql
security invoker
set search_path = ''
as $$
declare
  saved_schedule public.project_task_schedules%rowtype;
begin
  update public.project_tasks
  set title = trim(requested_title)
  where id = target_task_id;

  if not found then raise exception 'Task does not exist or is not editable'; end if;

  select * into saved_schedule
  from public.save_project_task_schedule(
    target_task_id, requested_assigned_to, requested_priority, requested_work_type,
    requested_description, requested_starts_at, requested_due_at,
    requested_schedule_active, requested_unit, requested_interval,
    requested_weekday, requested_day_of_month, requested_first_run, requested_timezone
  );
  return saved_schedule;
end;
$$;

revoke all on function public.save_project_task_configuration(
  uuid,text,uuid,text,text,text,timestamptz,timestamptz,boolean,text,integer,integer,integer,timestamp,text
) from public, anon;
grant execute on function public.save_project_task_configuration(
  uuid,text,uuid,text,text,text,timestamptz,timestamptz,boolean,text,integer,integer,integer,timestamp,text
) to authenticated;

create or replace function public.delete_project_task_safely(target_task_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  task_row public.project_tasks%rowtype;
  schedule_id uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication required';
  end if;

  select * into task_row from public.project_tasks where id = target_task_id for update;
  if not found then raise exception 'Task does not exist'; end if;

  if not (
    task_row.created_by = (select auth.uid())
    or exists (
      select 1 from public.projects p
      where p.id = task_row.project_id
        and public.can_manage_organization(p.organization_id)
    )
  ) then
    raise exception 'Not allowed to delete this task';
  end if;

  if task_row.recurrence_schedule_id is not null then
    raise exception 'Recurring executions preserve project history';
  end if;
  if exists (select 1 from public.task_evidence e where e.task_id = task_row.id) then
    raise exception 'Tasks with evidence preserve project history';
  end if;

  select s.id into schedule_id
  from public.project_task_schedules s
  where s.template_task_id = task_row.id
  for update;

  if schedule_id is not null then
    if exists (select 1 from public.project_tasks t where t.recurrence_schedule_id = schedule_id) then
      raise exception 'Recurring tasks with executions preserve project history';
    end if;
    delete from public.project_task_schedules where id = schedule_id;
  end if;

  delete from public.project_tasks where id = task_row.id;
end;
$$;

alter function public.delete_project_task_safely(uuid) owner to postgres;
revoke all on function public.delete_project_task_safely(uuid) from public, anon;
grant execute on function public.delete_project_task_safely(uuid) to authenticated;

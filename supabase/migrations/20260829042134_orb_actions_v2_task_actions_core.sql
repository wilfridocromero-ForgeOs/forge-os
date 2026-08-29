-- ORVESEN Orb Actions V2 Phase 2A: safe project-task updates and status changes.

alter table public.orb_action_proposals
  drop constraint if exists orb_action_proposals_action_type_check;
alter table public.orb_action_proposals
  add constraint orb_action_proposals_action_type_check
  check (action_type in (
    'create_project_task',
    'update_project_task',
    'change_project_task_status'
  ));

create or replace function private.can_change_project_task_status(target_task_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null and exists (
    select 1
    from public.project_tasks task
    join public.projects project on project.id = task.project_id
    where task.id = target_task_id
      and project.organization_id = (select public.current_user_organization_id())
      and (
        public.can_manage_project_membership(project.id)
        or (
          (task.created_by = (select auth.uid()) or task.assigned_to = (select auth.uid()))
          and exists (
            select 1
            from public.project_members member
            where member.project_id = project.id
              and member.user_id = (select auth.uid())
              and member.role in ('owner', 'member')
          )
        )
      )
  );
$$;

alter function private.can_change_project_task_status(uuid) owner to postgres;
revoke all on function private.can_change_project_task_status(uuid) from public, anon, authenticated;

create or replace function public.prepare_orb_update_project_task_proposal(
  target_conversation_id uuid,
  target_user_message_id uuid,
  target_task_id uuid,
  requested_changes jsonb
)
returns public.orb_action_proposals
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  caller_organization_id uuid := public.current_user_organization_id();
  task_row public.project_tasks%rowtype;
  project_row public.projects%rowtype;
  normalized_changes jsonb := '{}'::jsonb;
  target_values jsonb;
  expected_values jsonb;
  canonical jsonb;
  canonical_hash text;
  proposal public.orb_action_proposals%rowtype;
  current_assignee_name text;
  target_assignee_name text;
  requested_assignee uuid;
  requested_due_at timestamptz;
  requested_title text;
  requested_description text;
  requested_priority text;
  display_changes jsonb := '[]'::jsonb;
begin
  if caller_id is null or caller_organization_id is null then
    raise exception 'Authentication and active organization required' using errcode = '42501';
  end if;
  if requested_changes is null or jsonb_typeof(requested_changes) <> 'object'
     or requested_changes = '{}'::jsonb
     or exists (
       select 1 from jsonb_object_keys(requested_changes) as key
       where key not in ('title','instructions','assignee_id','priority','due_at')
     ) then
    raise exception 'Invalid action arguments' using errcode = '22023';
  end if;
  if not exists (
    select 1
    from public.orb_messages message
    join public.orb_conversations conversation
      on conversation.id = message.conversation_id
     and conversation.organization_id = message.organization_id
    where message.id = target_user_message_id
      and message.conversation_id = target_conversation_id
      and message.organization_id = caller_organization_id
      and message.role = 'user'
      and message.created_by = caller_id
      and conversation.created_by = caller_id
  ) then
    raise exception 'Orb turn not found' using errcode = '42501';
  end if;

  select task.* into task_row
  from public.project_tasks task
  join public.projects project on project.id = task.project_id
  where task.id = target_task_id and project.organization_id = caller_organization_id;
  if not found then raise exception 'Task action not allowed' using errcode = '42501'; end if;
  select project.* into project_row from public.projects project
  where project.id = task_row.project_id and project.organization_id = caller_organization_id;
  if not found or not public.can_configure_project_task(target_task_id) then
    raise exception 'Task action not allowed' using errcode = '42501';
  end if;
  if task_row.is_recurrence_template or task_row.recurrence_schedule_id is not null then
    raise exception 'Configure recurrence from its template' using errcode = '55000';
  end if;

  if requested_changes ? 'title' then
    if jsonb_typeof(requested_changes->'title') <> 'string' then
      raise exception 'Invalid action arguments' using errcode = '22023';
    end if;
    requested_title := btrim(requested_changes->>'title');
    if char_length(requested_title) not between 2 and 180 then
      raise exception 'Invalid action arguments' using errcode = '22023';
    end if;
    normalized_changes := normalized_changes || jsonb_build_object('title', requested_title);
  end if;
  if requested_changes ? 'instructions' then
    if jsonb_typeof(requested_changes->'instructions') not in ('string','null') then
      raise exception 'Invalid action arguments' using errcode = '22023';
    end if;
    requested_description := nullif(btrim(requested_changes->>'instructions'), '');
    if char_length(coalesce(requested_description, '')) > 2000 then
      raise exception 'Invalid action arguments' using errcode = '22023';
    end if;
    normalized_changes := normalized_changes || jsonb_build_object('instructions', requested_description);
  end if;
  if requested_changes ? 'priority' then
    requested_priority := requested_changes->>'priority';
    if requested_priority not in ('low','medium','high','urgent') then
      raise exception 'Invalid action arguments' using errcode = '22023';
    end if;
    normalized_changes := normalized_changes || jsonb_build_object('priority', requested_priority);
  end if;
  if requested_changes ? 'due_at' then
    if jsonb_typeof(requested_changes->'due_at') not in ('string','null') then
      raise exception 'Invalid action arguments' using errcode = '22023';
    end if;
    if requested_changes->>'due_at' is not null then
      if requested_changes->>'due_at' !~ '(Z|[+-][0-9]{2}:[0-9]{2})$' then
        raise exception 'Due date requires an explicit timezone' using errcode = '22023';
      end if;
      requested_due_at := (requested_changes->>'due_at')::timestamptz;
      if task_row.starts_at is not null and requested_due_at < task_row.starts_at then
        raise exception 'Due date cannot precede start date' using errcode = '22023';
      end if;
    end if;
    normalized_changes := normalized_changes || jsonb_build_object('due_at', requested_due_at);
  end if;
  if requested_changes ? 'assignee_id' then
    if jsonb_typeof(requested_changes->'assignee_id') not in ('string','null') then
      raise exception 'Invalid action arguments' using errcode = '22023';
    end if;
    if requested_changes->>'assignee_id' is not null then
      requested_assignee := (requested_changes->>'assignee_id')::uuid;
      select "user".first_name into target_assignee_name
      from public.project_members member
      join public.users "user" on "user".id = member.user_id
      join public.organization_memberships membership
        on membership.user_id = member.user_id
       and membership.organization_id = caller_organization_id
      where member.project_id = task_row.project_id
        and member.user_id = requested_assignee
        and member.role in ('owner','member');
      if not found then raise exception 'Assignee not available' using errcode = '42501'; end if;
    end if;
    normalized_changes := normalized_changes || jsonb_build_object('assignee_id', requested_assignee);
  end if;

  select "user".first_name into current_assignee_name
  from public.users "user" where "user".id = task_row.assigned_to;
  expected_values := jsonb_build_object(
    'updated_at', task_row.updated_at,
    'title', task_row.title,
    'instructions', task_row.description,
    'assignee_id', task_row.assigned_to,
    'priority', task_row.priority,
    'due_at', task_row.due_at
  );
  target_values := jsonb_build_object(
    'title', case when normalized_changes ? 'title' then normalized_changes->>'title' else task_row.title end,
    'instructions', case when normalized_changes ? 'instructions' then normalized_changes->'instructions' else to_jsonb(task_row.description) end,
    'assignee_id', case when normalized_changes ? 'assignee_id' then normalized_changes->'assignee_id' else to_jsonb(task_row.assigned_to) end,
    'priority', case when normalized_changes ? 'priority' then normalized_changes->>'priority' else task_row.priority end,
    'due_at', case when normalized_changes ? 'due_at' then normalized_changes->'due_at' else to_jsonb(task_row.due_at) end
  );
  if target_values = expected_values - 'updated_at' then
    raise exception 'Action does not change the task' using errcode = '22023';
  end if;

  if normalized_changes ? 'title' then display_changes := display_changes || jsonb_build_array(jsonb_build_object('field','title','label','Título','current',task_row.title,'target',target_values->'title')); end if;
  if normalized_changes ? 'instructions' then display_changes := display_changes || jsonb_build_array(jsonb_build_object('field','instructions','label','Instrucciones','current',task_row.description,'target',target_values->'instructions')); end if;
  if normalized_changes ? 'assignee_id' then display_changes := display_changes || jsonb_build_array(jsonb_build_object('field','assignee_id','label','Responsable','current',current_assignee_name,'target',target_assignee_name)); end if;
  if normalized_changes ? 'priority' then display_changes := display_changes || jsonb_build_array(jsonb_build_object('field','priority','label','Prioridad','current',task_row.priority,'target',target_values->'priority')); end if;
  if normalized_changes ? 'due_at' then display_changes := display_changes || jsonb_build_array(jsonb_build_object('field','due_at','label','Vencimiento','current',task_row.due_at,'target',target_values->'due_at')); end if;

  canonical := jsonb_build_object(
    'task_id', task_row.id,
    'project_id', task_row.project_id,
    'expected', expected_values,
    'changes', normalized_changes,
    'target', target_values
  );
  canonical_hash := encode(extensions.digest(convert_to(canonical::text, 'UTF8'), 'sha256'), 'hex');
  insert into public.orb_action_proposals (
    action_type, organization_id, user_id, conversation_id, user_message_id,
    canonical_arguments, arguments_hash, display_payload, expires_at
  ) values (
    'update_project_task', caller_organization_id, caller_id,
    target_conversation_id, target_user_message_id, canonical, canonical_hash,
    jsonb_build_object(
      'project_id', project_row.id, 'project_name', project_row.name,
      'task_id', task_row.id, 'task_title', task_row.title,
      'changes', display_changes
    ), now() + interval '15 minutes'
  )
  on conflict (user_id, user_message_id, action_type, arguments_hash)
  do update set updated_at = public.orb_action_proposals.updated_at
  returning * into proposal;
  return proposal;
end;
$$;

create or replace function public.prepare_orb_task_status_proposal(
  target_conversation_id uuid,
  target_user_message_id uuid,
  target_task_id uuid,
  requested_target_status text
)
returns public.orb_action_proposals
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  caller_organization_id uuid := public.current_user_organization_id();
  task_row public.project_tasks%rowtype;
  project_row public.projects%rowtype;
  canonical jsonb;
  canonical_hash text;
  proposal public.orb_action_proposals%rowtype;
begin
  if caller_id is null or caller_organization_id is null then
    raise exception 'Authentication and active organization required' using errcode = '42501';
  end if;
  if requested_target_status not in ('pending','in_progress','completed') then
    raise exception 'Invalid target status' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.orb_messages message
    join public.orb_conversations conversation
      on conversation.id = message.conversation_id and conversation.organization_id = message.organization_id
    where message.id = target_user_message_id and message.conversation_id = target_conversation_id
      and message.organization_id = caller_organization_id and message.role = 'user'
      and message.created_by = caller_id and conversation.created_by = caller_id
  ) then raise exception 'Orb turn not found' using errcode = '42501'; end if;

  select task.* into task_row
  from public.project_tasks task join public.projects project on project.id = task.project_id
  where task.id = target_task_id and project.organization_id = caller_organization_id;
  if not found then raise exception 'Task action not allowed' using errcode = '42501'; end if;
  select project.* into project_row from public.projects project
  where project.id = task_row.project_id and project.organization_id = caller_organization_id;
  if not found or not private.can_change_project_task_status(target_task_id) then
    raise exception 'Task action not allowed' using errcode = '42501';
  end if;
  if task_row.is_recurrence_template then
    raise exception 'Recurring task templates do not have an operational status' using errcode = '55000';
  end if;
  if not (
    (task_row.status = 'pending' and requested_target_status in ('in_progress','completed'))
    or (task_row.status = 'in_progress' and requested_target_status in ('pending','completed'))
    or (task_row.status = 'completed' and requested_target_status = 'pending')
  ) then raise exception 'Unsupported task status transition' using errcode = '22023'; end if;

  canonical := jsonb_build_object(
    'task_id', task_row.id,
    'project_id', task_row.project_id,
    'expected', jsonb_build_object('updated_at', task_row.updated_at, 'status', task_row.status),
    'target_status', requested_target_status
  );
  canonical_hash := encode(extensions.digest(convert_to(canonical::text, 'UTF8'), 'sha256'), 'hex');
  insert into public.orb_action_proposals (
    action_type, organization_id, user_id, conversation_id, user_message_id,
    canonical_arguments, arguments_hash, display_payload, expires_at
  ) values (
    'change_project_task_status', caller_organization_id, caller_id,
    target_conversation_id, target_user_message_id, canonical, canonical_hash,
    jsonb_build_object(
      'project_id', project_row.id, 'project_name', project_row.name,
      'task_id', task_row.id, 'task_title', task_row.title,
      'changes', jsonb_build_array(jsonb_build_object(
        'field','status','label','Estado','current',task_row.status,'target',requested_target_status
      ))
    ), now() + interval '15 minutes'
  )
  on conflict (user_id, user_message_id, action_type, arguments_hash)
  do update set updated_at = public.orb_action_proposals.updated_at
  returning * into proposal;
  return proposal;
end;
$$;

create or replace function public.confirm_orb_action_proposal(
  target_proposal_id uuid,
  expected_arguments_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  caller_organization_id uuid := public.current_user_organization_id();
  proposal public.orb_action_proposals%rowtype;
  args jsonb;
  project_row public.projects%rowtype;
  task_row public.project_tasks%rowtype;
  changes jsonb;
  target_values jsonb;
  expected_values jsonb;
  requested_assignee uuid;
  result_payload jsonb;
begin
  if caller_id is null or caller_organization_id is null then
    raise exception 'Authentication and active organization required' using errcode = '42501';
  end if;
  select * into proposal from public.orb_action_proposals item
  where item.id = target_proposal_id for update;
  if not found or proposal.user_id <> caller_id or proposal.organization_id <> caller_organization_id then
    raise exception 'Action proposal not available' using errcode = '42501';
  end if;
  if expected_arguments_hash is null or expected_arguments_hash <> proposal.arguments_hash then
    raise exception 'Action proposal hash mismatch' using errcode = '22023';
  end if;
  if encode(extensions.digest(convert_to(proposal.canonical_arguments::text, 'UTF8'), 'sha256'), 'hex') <> proposal.arguments_hash then
    raise exception 'Stored action proposal is invalid' using errcode = '22023';
  end if;
  if proposal.status = 'completed' then
    return jsonb_build_object('status','completed','proposal_id',proposal.id,'task_id',proposal.result_entity_id);
  end if;
  if proposal.status <> 'proposed' then
    return jsonb_build_object('status',proposal.status,'proposal_id',proposal.id,'safe_error_code',proposal.safe_error_code);
  end if;
  if proposal.expires_at <= now() then
    update public.orb_action_proposals set status = 'expired' where id = proposal.id;
    return jsonb_build_object('status','expired','proposal_id',proposal.id);
  end if;
  args := proposal.canonical_arguments;

  if proposal.action_type = 'create_project_task' then
    select * into project_row from public.projects project
    where project.id = (args->>'project_id')::uuid and project.organization_id = caller_organization_id;
    if not found or project_row.status not in ('planned','active','blocked') then
      raise exception 'Project no longer accepts tasks' using errcode = '55000';
    end if;
    if not (
      public.can_manage_project_membership(project_row.id)
      or exists (select 1 from public.project_members member where member.project_id = project_row.id and member.user_id = caller_id and member.role in ('owner','member'))
    ) then raise exception 'Project action no longer allowed' using errcode = '42501'; end if;
    if nullif(args->>'assignee_id','') is not null and not exists (
      select 1 from public.project_members member where member.project_id = project_row.id
        and member.user_id = (args->>'assignee_id')::uuid and member.role in ('owner','member')
    ) then raise exception 'Assignee no longer available' using errcode = '42501'; end if;
    update public.orb_action_proposals set status = 'executing', confirmed_at = now() where id = proposal.id;
    select * into task_row from public.create_project_task_with_configuration(
      project_row.id, args->>'title', args->>'instructions', nullif(args->>'assignee_id','')::uuid,
      args->>'priority', 'task', nullif(args->>'starts_at','')::timestamptz,
      nullif(args->>'due_at','')::timestamptz, '[]'::jsonb, false,
      null, null, null, null, null, null
    );
  elsif proposal.action_type in ('update_project_task','change_project_task_status') then
    select task.* into task_row
    from public.project_tasks task join public.projects project on project.id = task.project_id
    where task.id = (args->>'task_id')::uuid
      and task.project_id = (args->>'project_id')::uuid
      and project.organization_id = caller_organization_id
    for update of task;
    if not found then raise exception 'Task action not available' using errcode = '42501'; end if;
    select project.* into project_row from public.projects project
    where project.id = task_row.project_id and project.organization_id = caller_organization_id;
    if not found then raise exception 'Task action not available' using errcode = '42501'; end if;
    expected_values := args->'expected';
    if task_row.updated_at is distinct from (expected_values->>'updated_at')::timestamptz then
      update public.orb_action_proposals set status='failed', confirmed_at=now(), executed_at=now(), safe_error_code='STALE_ENTITY_STATE' where id=proposal.id;
      return jsonb_build_object('status','failed','proposal_id',proposal.id,'safe_error_code','STALE_ENTITY_STATE');
    end if;

    if proposal.action_type = 'update_project_task' then
      if not public.can_configure_project_task(task_row.id) then raise exception 'Task action no longer allowed' using errcode = '42501'; end if;
      if task_row.title is distinct from expected_values->>'title'
         or task_row.description is distinct from nullif(expected_values->>'instructions','')
         or task_row.assigned_to is distinct from nullif(expected_values->>'assignee_id','')::uuid
         or task_row.priority is distinct from expected_values->>'priority'
         or task_row.due_at is distinct from nullif(expected_values->>'due_at','')::timestamptz then
        update public.orb_action_proposals set status='failed', confirmed_at=now(), executed_at=now(), safe_error_code='STALE_ENTITY_STATE' where id=proposal.id;
        return jsonb_build_object('status','failed','proposal_id',proposal.id,'safe_error_code','STALE_ENTITY_STATE');
      end if;
      changes := args->'changes';
      target_values := args->'target';
      if target_values <> jsonb_build_object(
        'title', case when changes ? 'title' then changes->>'title' else task_row.title end,
        'instructions', case when changes ? 'instructions' then changes->'instructions' else to_jsonb(task_row.description) end,
        'assignee_id', case when changes ? 'assignee_id' then changes->'assignee_id' else to_jsonb(task_row.assigned_to) end,
        'priority', case when changes ? 'priority' then changes->>'priority' else task_row.priority end,
        'due_at', case when changes ? 'due_at' then changes->'due_at' else to_jsonb(task_row.due_at) end
      ) then raise exception 'Stored action target is invalid' using errcode = '22023'; end if;
      if changes ? 'assignee_id' and changes->>'assignee_id' is not null then
        requested_assignee := (changes->>'assignee_id')::uuid;
        if not exists (
          select 1 from public.project_members member
          join public.organization_memberships membership
            on membership.user_id = member.user_id and membership.organization_id = caller_organization_id
          where member.project_id = task_row.project_id and member.user_id = requested_assignee
            and member.role in ('owner','member')
        ) then raise exception 'Assignee no longer available' using errcode = '42501'; end if;
      end if;
      update public.orb_action_proposals set status='executing', confirmed_at=now() where id=proposal.id;
      update public.project_tasks set
        title = case when changes ? 'title' then changes->>'title' else title end,
        description = case when changes ? 'instructions' then nullif(changes->>'instructions','') else description end,
        assigned_to = case when changes ? 'assignee_id' then nullif(changes->>'assignee_id','')::uuid else assigned_to end,
        priority = case when changes ? 'priority' then changes->>'priority' else priority end,
        due_at = case when changes ? 'due_at' then nullif(changes->>'due_at','')::timestamptz else due_at end
      where id = task_row.id returning * into task_row;
    else
      if not private.can_change_project_task_status(task_row.id) then raise exception 'Task action no longer allowed' using errcode = '42501'; end if;
      if task_row.status is distinct from expected_values->>'status' then
        update public.orb_action_proposals set status='failed', confirmed_at=now(), executed_at=now(), safe_error_code='STALE_ENTITY_STATE' where id=proposal.id;
        return jsonb_build_object('status','failed','proposal_id',proposal.id,'safe_error_code','STALE_ENTITY_STATE');
      end if;
      if not (
        (task_row.status='pending' and args->>'target_status' in ('in_progress','completed'))
        or (task_row.status='in_progress' and args->>'target_status' in ('pending','completed'))
        or (task_row.status='completed' and args->>'target_status'='pending')
      ) then raise exception 'Unsupported task status transition' using errcode = '22023'; end if;
      update public.orb_action_proposals set status='executing', confirmed_at=now() where id=proposal.id;
      update public.project_tasks set status = args->>'target_status'
      where id = task_row.id returning * into task_row;
    end if;
  else
    raise exception 'Unsupported action type' using errcode = '22023';
  end if;

  update public.orb_action_proposals set
    status='completed', executed_at=now(), result_entity_type='project_task', result_entity_id=task_row.id
  where id=proposal.id;
  result_payload := jsonb_build_object('status','completed','proposal_id',proposal.id,'task_id',task_row.id,'project_id',task_row.project_id);
  return result_payload;
exception
  when sqlstate '42501' or sqlstate '22023' or sqlstate '55000' then raise;
  when others then
    if proposal.id is not null then
      update public.orb_action_proposals set
        status='failed', confirmed_at=coalesce(confirmed_at,now()), executed_at=now(),
        safe_error_code=case when sqlerrm like '%Required evidence is incomplete%' then 'EVIDENCE_REQUIRED' else 'ACTION_EXECUTION_FAILED' end
      where id=proposal.id and status in ('proposed','executing');
      return jsonb_build_object(
        'status','failed','proposal_id',proposal.id,
        'safe_error_code',case when sqlerrm like '%Required evidence is incomplete%' then 'EVIDENCE_REQUIRED' else 'ACTION_EXECUTION_FAILED' end
      );
    end if;
    raise;
end;
$$;

alter function public.prepare_orb_update_project_task_proposal(uuid,uuid,uuid,jsonb) owner to postgres;
alter function public.prepare_orb_task_status_proposal(uuid,uuid,uuid,text) owner to postgres;
alter function public.confirm_orb_action_proposal(uuid,text) owner to postgres;

revoke all on function public.prepare_orb_update_project_task_proposal(uuid,uuid,uuid,jsonb) from public, anon, authenticated;
revoke all on function public.prepare_orb_task_status_proposal(uuid,uuid,uuid,text) from public, anon, authenticated;
revoke all on function public.confirm_orb_action_proposal(uuid,text) from public, anon, authenticated;
grant execute on function public.prepare_orb_update_project_task_proposal(uuid,uuid,uuid,jsonb) to authenticated;
grant execute on function public.prepare_orb_task_status_proposal(uuid,uuid,uuid,text) to authenticated;
grant execute on function public.confirm_orb_action_proposal(uuid,text) to authenticated;

comment on function public.prepare_orb_update_project_task_proposal(uuid,uuid,uuid,jsonb) is
  'Prepares, but never executes, an expiring Orb task-update proposal from live authorized state.';
comment on function public.prepare_orb_task_status_proposal(uuid,uuid,uuid,text) is
  'Prepares, but never executes, an expiring Orb task-status proposal from live authorized state.';

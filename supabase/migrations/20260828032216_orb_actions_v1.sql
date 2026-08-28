-- ORVESEN Orb Actions V1: explicit, user-confirmed and idempotent actions.

create extension if not exists pgcrypto with schema extensions;

create table public.orb_action_proposals (
  id uuid primary key default gen_random_uuid(),
  action_type text not null check (action_type = 'create_project_task'),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  conversation_id uuid not null references public.orb_conversations(id) on delete cascade,
  user_message_id uuid not null references public.orb_messages(id) on delete cascade,
  canonical_arguments jsonb not null check (jsonb_typeof(canonical_arguments) = 'object'),
  arguments_hash text not null check (arguments_hash ~ '^[0-9a-f]{64}$'),
  display_payload jsonb not null check (jsonb_typeof(display_payload) = 'object'),
  status text not null default 'proposed'
    check (status in ('proposed','executing','completed','cancelled','expired','failed')),
  expires_at timestamptz not null,
  confirmed_at timestamptz,
  executed_at timestamptz,
  result_entity_type text check (result_entity_type is null or result_entity_type = 'project_task'),
  result_entity_id uuid,
  safe_error_code text check (safe_error_code is null or safe_error_code ~ '^[A-Z0-9_]{1,80}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint orb_action_proposals_owner_membership_fkey
    foreign key (user_id, organization_id)
    references public.organization_memberships(user_id, organization_id) on delete cascade,
  constraint orb_action_proposals_conversation_scope_fkey
    foreign key (organization_id, conversation_id)
    references public.orb_conversations(organization_id, id) on delete cascade,
  constraint orb_action_proposals_message_scope_fkey
    foreign key (organization_id, conversation_id, user_message_id)
    references public.orb_messages(organization_id, conversation_id, id) on delete cascade,
  constraint orb_action_proposals_state_shape_check check (
    (status = 'proposed' and confirmed_at is null and executed_at is null and result_entity_id is null and safe_error_code is null)
    or (status = 'executing' and confirmed_at is not null and executed_at is null and result_entity_id is null and safe_error_code is null)
    or (status = 'completed' and confirmed_at is not null and executed_at is not null and result_entity_type = 'project_task' and result_entity_id is not null and safe_error_code is null)
    or (status in ('cancelled','expired') and executed_at is null and result_entity_id is null)
    or (status = 'failed' and confirmed_at is not null and executed_at is not null and result_entity_id is null and safe_error_code is not null)
  )
);

create unique index orb_action_proposals_turn_idempotency_key
  on public.orb_action_proposals (user_id, user_message_id, action_type, arguments_hash);
create index orb_action_proposals_conversation_status_idx
  on public.orb_action_proposals (conversation_id, status, created_at desc);
create index orb_action_proposals_expiration_idx
  on public.orb_action_proposals (expires_at) where status = 'proposed';

create trigger orb_action_proposals_set_updated_at
before update on public.orb_action_proposals
for each row execute function public.set_updated_at();

alter table public.orb_action_proposals enable row level security;

create policy "Users read own Orb action proposals"
on public.orb_action_proposals for select to authenticated
using (
  user_id = (select auth.uid())
  and organization_id = (select public.current_user_organization_id())
);

revoke all on table public.orb_action_proposals from public, anon, authenticated;
grant select on table public.orb_action_proposals to authenticated;

create or replace function public.prepare_orb_project_task_proposal(
  target_conversation_id uuid,
  target_user_message_id uuid,
  target_project_id uuid,
  requested_title text,
  requested_instructions text default null,
  requested_assignee_id uuid default null,
  requested_priority text default 'medium',
  requested_starts_at text default null,
  requested_due_at text default null
)
returns public.orb_action_proposals
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  caller_organization_id uuid := public.current_user_organization_id();
  project_row public.projects%rowtype;
  normalized_title text := btrim(requested_title);
  normalized_instructions text := nullif(btrim(requested_instructions), '');
  canonical jsonb;
  canonical_hash text;
  proposal public.orb_action_proposals%rowtype;
  assignee_name text;
  normalized_starts_at timestamptz;
  normalized_due_at timestamptz;
begin
  if caller_id is null or caller_organization_id is null then
    raise exception 'Authentication and active organization required' using errcode = '42501';
  end if;
  if normalized_title is null or char_length(normalized_title) not between 2 and 180
     or normalized_instructions is not null and char_length(normalized_instructions) > 10000
     or requested_priority is null or requested_priority not in ('low','medium','high','urgent') then
    raise exception 'Invalid action arguments' using errcode = '22023';
  end if;
  if requested_starts_at is not null then
    if requested_starts_at !~ '(Z|[+-][0-9]{2}:[0-9]{2})$' then
      raise exception 'Start date requires an explicit timezone' using errcode = '22023';
    end if;
    normalized_starts_at := requested_starts_at::timestamptz;
  end if;
  if requested_due_at is not null then
    if requested_due_at !~ '(Z|[+-][0-9]{2}:[0-9]{2})$' then
      raise exception 'Due date requires an explicit timezone' using errcode = '22023';
    end if;
    normalized_due_at := requested_due_at::timestamptz;
  end if;
  if normalized_due_at is not null and normalized_starts_at is not null and normalized_due_at < normalized_starts_at then
    raise exception 'Due date cannot precede start date' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.orb_messages m
    join public.orb_conversations c on c.id = m.conversation_id and c.organization_id = m.organization_id
    where m.id = target_user_message_id and m.conversation_id = target_conversation_id
      and m.organization_id = caller_organization_id and m.role = 'user'
      and m.created_by = caller_id and c.created_by = caller_id
  ) then
    raise exception 'Orb turn not found' using errcode = '42501';
  end if;

  select * into project_row from public.projects p
  where p.id = target_project_id and p.organization_id = caller_organization_id;
  if not found then raise exception 'Project not available' using errcode = '42501'; end if;
  if project_row.status not in ('planned','active','blocked') then
    raise exception 'Project does not accept new tasks' using errcode = '55000';
  end if;
  if not (
    public.can_manage_project_membership(project_row.id)
    or exists (select 1 from public.project_members pm where pm.project_id = project_row.id and pm.user_id = caller_id and pm.role in ('owner','member'))
  ) then
    raise exception 'Project action not allowed' using errcode = '42501';
  end if;
  if requested_assignee_id is not null then
    select u.first_name into assignee_name
    from public.project_members pm join public.users u on u.id = pm.user_id
    where pm.project_id = project_row.id and pm.user_id = requested_assignee_id and pm.role in ('owner','member');
    if not found then raise exception 'Assignee not available' using errcode = '42501'; end if;
  end if;

  canonical := jsonb_build_object(
    'project_id', project_row.id, 'title', normalized_title,
    'instructions', normalized_instructions, 'assignee_id', requested_assignee_id,
    'priority', requested_priority, 'starts_at', normalized_starts_at,
    'due_at', normalized_due_at
  );
  canonical_hash := encode(extensions.digest(convert_to(canonical::text, 'UTF8'), 'sha256'), 'hex');

  insert into public.orb_action_proposals (
    action_type, organization_id, user_id, conversation_id, user_message_id,
    canonical_arguments, arguments_hash, display_payload, expires_at
  ) values (
    'create_project_task', caller_organization_id, caller_id, target_conversation_id,
    target_user_message_id, canonical, canonical_hash,
    jsonb_build_object(
      'project_id', project_row.id, 'project_name', project_row.name, 'title', normalized_title,
      'instructions', normalized_instructions, 'assignee_name', assignee_name,
      'priority', requested_priority, 'starts_at', normalized_starts_at,
      'due_at', normalized_due_at
    ), now() + interval '15 minutes'
  )
  on conflict (user_id, user_message_id, action_type, arguments_hash)
  do update set updated_at = orb_action_proposals.updated_at
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
begin
  if caller_id is null or caller_organization_id is null then
    raise exception 'Authentication and active organization required' using errcode = '42501';
  end if;
  select * into proposal from public.orb_action_proposals p
  where p.id = target_proposal_id for update;
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
  select * into project_row from public.projects p
  where p.id = (args->>'project_id')::uuid and p.organization_id = caller_organization_id;
  if not found or project_row.status not in ('planned','active','blocked') then
    raise exception 'Project no longer accepts tasks' using errcode = '55000';
  end if;
  if not (
    public.can_manage_project_membership(project_row.id)
    or exists (select 1 from public.project_members pm where pm.project_id = project_row.id and pm.user_id = caller_id and pm.role in ('owner','member'))
  ) then
    raise exception 'Project action no longer allowed' using errcode = '42501';
  end if;
  if nullif(args->>'assignee_id','') is not null and not exists (
    select 1 from public.project_members pm where pm.project_id = project_row.id
      and pm.user_id = (args->>'assignee_id')::uuid and pm.role in ('owner','member')
  ) then
    raise exception 'Assignee no longer available' using errcode = '42501';
  end if;

  update public.orb_action_proposals
  set status = 'executing', confirmed_at = now()
  where id = proposal.id;

  select * into task_row from public.create_project_task_with_configuration(
    project_row.id,
    args->>'title', args->>'instructions', nullif(args->>'assignee_id','')::uuid,
    args->>'priority', 'task', nullif(args->>'starts_at','')::timestamptz,
    nullif(args->>'due_at','')::timestamptz, '[]'::jsonb, false,
    null, null, null, null, null, null
  );

  update public.orb_action_proposals set
    status = 'completed', executed_at = now(), result_entity_type = 'project_task',
    result_entity_id = task_row.id
  where id = proposal.id;
  return jsonb_build_object('status','completed','proposal_id',proposal.id,'task_id',task_row.id,'project_id',project_row.id);
exception
  when sqlstate '42501' or sqlstate '22023' or sqlstate '55000' then
    raise;
  when others then
    if proposal.id is not null then
      update public.orb_action_proposals set
        status = 'failed', confirmed_at = coalesce(confirmed_at, now()),
        executed_at = now(), safe_error_code = 'ACTION_EXECUTION_FAILED'
      where id = proposal.id and status in ('proposed','executing');
      return jsonb_build_object(
        'status','failed','proposal_id',proposal.id,
        'safe_error_code','ACTION_EXECUTION_FAILED'
      );
    end if;
    raise;
end;
$$;

create or replace function public.cancel_orb_action_proposal(target_proposal_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  caller_organization_id uuid := public.current_user_organization_id();
  proposal public.orb_action_proposals%rowtype;
begin
  if caller_id is null or caller_organization_id is null then
    raise exception 'Authentication and active organization required' using errcode = '42501';
  end if;
  select * into proposal from public.orb_action_proposals p
  where p.id = target_proposal_id for update;
  if not found or proposal.user_id <> caller_id or proposal.organization_id <> caller_organization_id then
    raise exception 'Action proposal not available' using errcode = '42501';
  end if;
  if proposal.status = 'proposed' and proposal.expires_at <= now() then
    update public.orb_action_proposals set status = 'expired' where id = proposal.id returning * into proposal;
  elsif proposal.status = 'proposed' then
    update public.orb_action_proposals set status = 'cancelled' where id = proposal.id returning * into proposal;
  end if;
  return jsonb_build_object('status',proposal.status,'proposal_id',proposal.id);
end;
$$;

alter function public.prepare_orb_project_task_proposal(uuid,uuid,uuid,text,text,uuid,text,text,text) owner to postgres;
alter function public.confirm_orb_action_proposal(uuid,text) owner to postgres;
alter function public.cancel_orb_action_proposal(uuid) owner to postgres;

revoke all on function public.prepare_orb_project_task_proposal(uuid,uuid,uuid,text,text,uuid,text,text,text) from public, anon, authenticated;
revoke all on function public.confirm_orb_action_proposal(uuid,text) from public, anon, authenticated;
revoke all on function public.cancel_orb_action_proposal(uuid) from public, anon, authenticated;
grant execute on function public.prepare_orb_project_task_proposal(uuid,uuid,uuid,text,text,uuid,text,text,text) to authenticated;
grant execute on function public.confirm_orb_action_proposal(uuid,text) to authenticated;
grant execute on function public.cancel_orb_action_proposal(uuid) to authenticated;

comment on table public.orb_action_proposals is
  'User-owned, expiring Orb action proposals. OpenAI may prepare but never confirm or execute them.';

-- ORVESEN ORB V1: personal, organization-scoped conversations and messages.
-- OpenAI credentials and provider configuration remain backend-only.

create table public.orb_conversations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete cascade,
  title text not null default 'Nueva conversación'
    check (char_length(btrim(title)) between 1 and 120),
  status text not null default 'active'
    check (status in ('active', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_message_at timestamptz,
  constraint orb_conversations_organization_id_id_key
    unique (organization_id, id),
  constraint orb_conversations_owner_membership_fkey
    foreign key (created_by, organization_id)
    references public.organization_memberships(user_id, organization_id)
    on delete cascade
);

create index orb_conversations_owner_recent_idx
  on public.orb_conversations (organization_id, created_by, last_message_at desc nulls last, created_at desc);

create table public.orb_messages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  conversation_id uuid not null,
  created_by uuid references auth.users(id) on delete set null,
  role text not null check (role in ('user', 'assistant')),
  content text not null default ''
    check (char_length(content) <= 16000),
  status text not null
    check (status in ('pending', 'streaming', 'completed', 'failed')),
  provider text check (provider is null or char_length(btrim(provider)) between 1 and 40),
  model text check (model is null or char_length(btrim(model)) between 1 and 100),
  provider_response_id text
    check (provider_response_id is null or char_length(provider_response_id) between 1 and 200),
  client_message_id uuid,
  reply_to_message_id uuid,
  processing_token uuid,
  error_code text check (error_code is null or error_code ~ '^[A-Z0-9_]{1,80}$'),
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint orb_messages_conversation_fkey
    foreign key (organization_id, conversation_id)
    references public.orb_conversations(organization_id, id)
    on delete cascade,
  constraint orb_messages_organization_conversation_id_key
    unique (organization_id, conversation_id, id),
  constraint orb_messages_reply_fkey
    foreign key (organization_id, conversation_id, reply_to_message_id)
    references public.orb_messages(organization_id, conversation_id, id)
    on delete cascade,
  constraint orb_messages_role_shape_check check (
    (
      role = 'user'
      and created_by is not null
      and client_message_id is not null
      and reply_to_message_id is null
      and processing_token is null
      and provider is null
      and model is null
      and provider_response_id is null
      and status = 'completed'
      and completed_at is not null
      and error_code is null
      and nullif(btrim(content), '') is not null
    )
    or
    (
      role = 'assistant'
      and created_by is null
      and client_message_id is null
      and reply_to_message_id is not null
      and provider is not null
      and model is not null
    )
  ),
  constraint orb_messages_terminal_state_check check (
    (
      status in ('pending', 'streaming')
      and completed_at is null
      and error_code is null
    )
    or
    (
      status = 'completed'
      and completed_at is not null
      and error_code is null
      and processing_token is null
    )
    or
    (
      status = 'failed'
      and completed_at is not null
      and error_code is not null
      and processing_token is null
    )
  ),
  constraint orb_messages_streaming_token_check
    check (status <> 'streaming' or processing_token is not null)
);

create unique index orb_messages_client_idempotency_key
  on public.orb_messages (conversation_id, client_message_id)
  where client_message_id is not null;

create unique index orb_messages_single_reply_key
  on public.orb_messages (conversation_id, reply_to_message_id)
  where role = 'assistant';

create index orb_messages_conversation_history_idx
  on public.orb_messages (organization_id, conversation_id, created_at, id);

create trigger orb_conversations_set_updated_at
before update on public.orb_conversations
for each row execute function public.set_updated_at();

alter table public.orb_conversations enable row level security;
alter table public.orb_messages enable row level security;

create policy "Users read own Orb conversations"
on public.orb_conversations
for select to authenticated
using (
  organization_id = (select public.current_user_organization_id())
  and created_by = (select auth.uid())
);

create policy "Users update own Orb conversation metadata"
on public.orb_conversations
for update to authenticated
using (
  organization_id = (select public.current_user_organization_id())
  and created_by = (select auth.uid())
)
with check (
  organization_id = (select public.current_user_organization_id())
  and created_by = (select auth.uid())
);

create policy "Users read messages from own Orb conversations"
on public.orb_messages
for select to authenticated
using (
  organization_id = (select public.current_user_organization_id())
  and exists (
    select 1
    from public.orb_conversations as conversation
    where conversation.id = orb_messages.conversation_id
      and conversation.organization_id = orb_messages.organization_id
      and conversation.created_by = (select auth.uid())
  )
);

revoke all on table public.orb_conversations from public, anon, authenticated;
revoke all on table public.orb_messages from public, anon, authenticated;
grant select on table public.orb_conversations to authenticated;
grant update (title, status) on table public.orb_conversations to authenticated;
grant select on table public.orb_messages to authenticated;
grant select, insert, update, delete on table public.orb_conversations to service_role;
grant select, insert, update, delete on table public.orb_messages to service_role;

create or replace function public.create_orb_conversation(target_title text default null)
returns public.orb_conversations
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  caller_organization_id uuid := public.current_user_organization_id();
  normalized_title text := coalesce(nullif(btrim(target_title), ''), 'Nueva conversación');
  created_conversation public.orb_conversations;
begin
  if caller_id is null or caller_organization_id is null then
    raise exception 'Authentication and active organization required' using errcode = '42501';
  end if;
  if char_length(normalized_title) > 120 then
    raise exception 'Conversation title is too long' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.organization_memberships as membership
    where membership.user_id = caller_id
      and membership.organization_id = caller_organization_id
  ) then
    raise exception 'Active organization membership not found' using errcode = '42501';
  end if;

  insert into public.orb_conversations (organization_id, created_by, title)
  values (caller_organization_id, caller_id, normalized_title)
  returning * into created_conversation;
  return created_conversation;
end;
$$;

create or replace function public.begin_orb_turn(
  target_conversation_id uuid,
  target_client_message_id uuid,
  target_content text,
  target_provider text,
  target_model text
)
returns table (
  organization_id uuid,
  conversation_id uuid,
  user_message_id uuid,
  assistant_message_id uuid,
  assistant_status text,
  assistant_content text,
  membership_role text,
  was_created boolean
)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  caller_id uuid := (select auth.uid());
  caller_organization_id uuid := public.current_user_organization_id();
  selected_conversation public.orb_conversations;
  selected_user_message public.orb_messages;
  selected_assistant_message public.orb_messages;
  inserted_user boolean := false;
begin
  if caller_id is null or caller_organization_id is null then
    raise exception 'Authentication and active organization required' using errcode = '42501';
  end if;
  if target_conversation_id is null or target_client_message_id is null then
    raise exception 'Conversation and client message IDs are required' using errcode = '22023';
  end if;
  if nullif(btrim(target_content), '') is null or char_length(target_content) > 8000 then
    raise exception 'Message must contain between 1 and 8000 characters' using errcode = '22023';
  end if;
  if nullif(btrim(target_provider), '') is null or char_length(btrim(target_provider)) > 40
     or nullif(btrim(target_model), '') is null or char_length(btrim(target_model)) > 100 then
    raise exception 'Invalid backend model configuration' using errcode = '22023';
  end if;

  select conversation.* into selected_conversation
  from public.orb_conversations as conversation
  where conversation.id = target_conversation_id
    and conversation.organization_id = caller_organization_id
    and conversation.created_by = caller_id
    and conversation.status = 'active'
  for update;
  if not found then
    raise exception 'Conversation not found' using errcode = 'P0002';
  end if;

  insert into public.orb_messages (
    organization_id, conversation_id, created_by, role, content,
    status, client_message_id, completed_at
  ) values (
    caller_organization_id, selected_conversation.id, caller_id, 'user', target_content,
    'completed', target_client_message_id, now()
  )
  on conflict (conversation_id, client_message_id)
    where client_message_id is not null
  do nothing
  returning * into selected_user_message;

  if found then
    inserted_user := true;
  else
    select message.* into selected_user_message
    from public.orb_messages as message
    where message.conversation_id = selected_conversation.id
      and message.client_message_id = target_client_message_id
      and message.role = 'user';
    if selected_user_message.content is distinct from target_content
       or selected_user_message.created_by is distinct from caller_id then
      raise exception 'Client message ID conflicts with another request' using errcode = '23505';
    end if;
  end if;

  insert into public.orb_messages (
    organization_id, conversation_id, role, content, status,
    provider, model, reply_to_message_id
  ) values (
    caller_organization_id, selected_conversation.id, 'assistant', '', 'pending',
    btrim(target_provider), btrim(target_model), selected_user_message.id
  )
  on conflict (conversation_id, reply_to_message_id)
    where role = 'assistant'
  do nothing
  returning * into selected_assistant_message;

  if not found then
    select message.* into selected_assistant_message
    from public.orb_messages as message
    where message.conversation_id = selected_conversation.id
      and message.reply_to_message_id = selected_user_message.id
      and message.role = 'assistant';
  end if;

  update public.orb_conversations
  set last_message_at = greatest(
        coalesce(last_message_at, '-infinity'::timestamptz),
        selected_user_message.created_at
      )
  where id = selected_conversation.id;

  return query select
    caller_organization_id,
    selected_conversation.id,
    selected_user_message.id,
    selected_assistant_message.id,
    selected_assistant_message.status,
    selected_assistant_message.content,
    public.current_user_membership_role(),
    inserted_user;
end;
$$;

create or replace function public.claim_orb_assistant_message(
  target_assistant_message_id uuid,
  target_processing_token uuid
)
returns boolean
language sql
security definer
set search_path = ''
as $$
  with claimed as (
    update public.orb_messages as message
    set status = 'streaming', processing_token = target_processing_token
    where message.id = target_assistant_message_id
      and message.role = 'assistant'
      and message.status = 'pending'
      and message.processing_token is null
      and target_processing_token is not null
    returning 1
  )
  select exists (select 1 from claimed);
$$;

create or replace function public.complete_orb_assistant_message(
  target_assistant_message_id uuid,
  target_processing_token uuid,
  target_content text,
  target_provider_response_id text
)
returns boolean
language sql
security definer
set search_path = ''
as $$
  with completed as (
    update public.orb_messages as message
    set content = left(target_content, 16000),
        status = 'completed',
        provider_response_id = nullif(left(target_provider_response_id, 200), ''),
        processing_token = null,
        completed_at = now()
    where message.id = target_assistant_message_id
      and message.role = 'assistant'
      and message.status = 'streaming'
      and message.processing_token = target_processing_token
      and nullif(btrim(target_content), '') is not null
    returning 1
  )
  select exists (select 1 from completed);
$$;

create or replace function public.fail_orb_assistant_message(
  target_assistant_message_id uuid,
  target_processing_token uuid,
  target_error_code text
)
returns boolean
language sql
security definer
set search_path = ''
as $$
  with failed as (
    update public.orb_messages as message
    set status = 'failed',
        error_code = case
          when coalesce(target_error_code, '') ~ '^[A-Z0-9_]{1,80}$' then target_error_code
          else 'ORB_REQUEST_FAILED'
        end,
        processing_token = null,
        completed_at = now()
    where message.id = target_assistant_message_id
      and message.role = 'assistant'
      and message.status in ('pending', 'streaming')
      and (
        message.processing_token = target_processing_token
        or (message.processing_token is null and target_processing_token is null)
      )
    returning 1
  )
  select exists (select 1 from failed);
$$;

alter function public.create_orb_conversation(text) owner to postgres;
alter function public.begin_orb_turn(uuid, uuid, text, text, text) owner to postgres;
alter function public.claim_orb_assistant_message(uuid, uuid) owner to postgres;
alter function public.complete_orb_assistant_message(uuid, uuid, text, text) owner to postgres;
alter function public.fail_orb_assistant_message(uuid, uuid, text) owner to postgres;

revoke all on function public.create_orb_conversation(text) from public, anon, authenticated;
revoke all on function public.begin_orb_turn(uuid, uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.claim_orb_assistant_message(uuid, uuid) from public, anon, authenticated;
revoke all on function public.complete_orb_assistant_message(uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function public.fail_orb_assistant_message(uuid, uuid, text) from public, anon, authenticated;

grant execute on function public.create_orb_conversation(text) to authenticated;
grant execute on function public.begin_orb_turn(uuid, uuid, text, text, text) to authenticated;
grant execute on function public.claim_orb_assistant_message(uuid, uuid) to service_role;
grant execute on function public.complete_orb_assistant_message(uuid, uuid, text, text) to service_role;
grant execute on function public.fail_orb_assistant_message(uuid, uuid, text) to service_role;

comment on table public.orb_conversations is
  'Personal Orb conversations isolated by active organization and creator.';
comment on table public.orb_messages is
  'Idempotent user turns and backend-authored Orb responses. Direct client writes are forbidden.';

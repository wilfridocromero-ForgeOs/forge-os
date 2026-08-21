-- ORVESEN OS 8B: private, user-owned Web Push device subscriptions.

create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null,
  p256dh text not null,
  auth text not null,
  user_agent text,
  device_label text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_used_at timestamptz,
  constraint push_subscriptions_membership_fkey
    foreign key (user_id, organization_id)
    references public.organization_memberships(user_id, organization_id)
    on delete cascade,
  constraint push_subscriptions_endpoint_key unique (endpoint),
  constraint push_subscriptions_endpoint_length_check
    check (char_length(endpoint) between 1 and 4096),
  constraint push_subscriptions_p256dh_length_check
    check (char_length(p256dh) between 1 and 1024),
  constraint push_subscriptions_auth_length_check
    check (char_length(auth) between 1 and 512),
  constraint push_subscriptions_user_agent_length_check
    check (user_agent is null or char_length(user_agent) <= 1000),
  constraint push_subscriptions_device_label_length_check
    check (device_label is null or char_length(device_label) <= 120)
);

create index push_subscriptions_user_devices_idx
  on public.push_subscriptions (user_id, organization_id, updated_at desc);

create trigger set_push_subscriptions_updated_at
before update on public.push_subscriptions
for each row execute function public.set_updated_at();

alter table public.push_subscriptions enable row level security;

revoke all on table public.push_subscriptions from public, anon, authenticated;
grant select, insert, update, delete on table public.push_subscriptions to authenticated;

create policy "Users read their own push subscriptions"
on public.push_subscriptions
for select
to authenticated
using (
  user_id = (select auth.uid())
  and organization_id = (select public.current_user_organization_id())
);

create policy "Users register their own push subscriptions"
on public.push_subscriptions
for insert
to authenticated
with check (
  user_id = (select auth.uid())
  and organization_id = (select public.current_user_organization_id())
);

create policy "Users update their own push subscriptions"
on public.push_subscriptions
for update
to authenticated
using (
  user_id = (select auth.uid())
  and organization_id = (select public.current_user_organization_id())
)
with check (
  user_id = (select auth.uid())
  and organization_id = (select public.current_user_organization_id())
);

create policy "Users remove their own push subscriptions"
on public.push_subscriptions
for delete
to authenticated
using (
  user_id = (select auth.uid())
  and organization_id = (select public.current_user_organization_id())
);

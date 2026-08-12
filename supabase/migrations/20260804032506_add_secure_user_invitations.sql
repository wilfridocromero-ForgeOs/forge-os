-- Exact historical SQL recovered read-only from
-- supabase_migrations.schema_migrations (20260804032506 / add_secure_user_invitations).
-- The migration is already applied remotely. Do not execute it manually
-- against production; this copy is for local history reconciliation only.


create table if not exists public.user_invitations (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  first_name text not null,
  title text not null default 'Miembro',
  role text not null default 'member'
    check (role in ('organization_admin', 'member')),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  area_ids uuid[] not null default '{}'::uuid[],
  module_keys text[] not null default '{}'::text[],
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'expired', 'cancelled')),
  invited_by uuid not null references public.users(id) on delete restrict,
  invited_user_id uuid references public.users(id) on delete set null,
  expires_at timestamptz not null default (now() + interval '7 days'),
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  check (email = lower(trim(email))),
  check (char_length(trim(first_name)) between 2 and 80),
  check (char_length(trim(title)) between 2 and 80)
);

create unique index if not exists user_invitations_pending_email_idx
  on public.user_invitations (lower(email))
  where status = 'pending';
create index if not exists user_invitations_organization_id_idx
  on public.user_invitations (organization_id);
create index if not exists user_invitations_invited_by_idx
  on public.user_invitations (invited_by);
create index if not exists user_invitations_invited_user_id_idx
  on public.user_invitations (invited_user_id);

alter table public.user_invitations enable row level security;

create policy "Managers can view invitations"
on public.user_invitations for select to authenticated
using (public.can_manage_organization(organization_id));

revoke all on public.user_invitations from anon;
revoke all on public.user_invitations from authenticated;
grant select on public.user_invitations to authenticated;

create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_organization_id uuid;
  pending_invitation public.user_invitations%rowtype;
begin
  select invitation.*
  into pending_invitation
  from public.user_invitations invitation
  where invitation.id::text = coalesce(new.raw_user_meta_data ->> 'invitation_id', '')
    and lower(invitation.email) = lower(new.email)
    and invitation.status = 'pending'
    and invitation.expires_at > now()
  limit 1;

  if pending_invitation.id is not null then
    insert into public.users (
      id, organization_id, first_name, title, role
    )
    values (
      new.id,
      pending_invitation.organization_id,
      pending_invitation.first_name,
      pending_invitation.title,
      pending_invitation.role
    );

    insert into public.user_area_access (user_id, area_id)
    select new.id, area.id
    from public.work_areas area
    where area.id = any(pending_invitation.area_ids)
      and area.organization_id = pending_invitation.organization_id
    on conflict do nothing;

    insert into public.member_module_access (user_id, module_key, enabled)
    select new.id, module_key, true
    from unnest(pending_invitation.module_keys) module_key
    where module_key in ('dashboard','clients','discovery','projects','area_score','playbooks')
    on conflict (user_id, module_key)
    do update set enabled = excluded.enabled, updated_at = now();

    update public.user_invitations
    set status = 'accepted',
        invited_user_id = new.id,
        accepted_at = now()
    where id = pending_invitation.id;

    return new;
  end if;

  insert into public.organizations (name)
  values (
    coalesce(
      nullif(new.raw_user_meta_data ->> 'organization_name', ''),
      nullif(new.raw_user_meta_data ->> 'first_name', '') || ' - ORVESEN',
      split_part(new.email, '@', 1) || ' - ORVESEN'
    )
  )
  returning id into new_organization_id;

  insert into public.users (id, organization_id, first_name)
  values (
    new.id,
    new_organization_id,
    coalesce(
      nullif(new.raw_user_meta_data ->> 'first_name', ''),
      split_part(new.email, '@', 1)
    )
  );

  return new;
end;
$$;

create or replace function public.admin_update_member(
  target_user_id uuid,
  new_first_name text,
  new_title text,
  new_role text,
  new_organization_id uuid
)
returns public.users
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_target public.users;
  updated_profile public.users;
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication required';
  end if;

  select * into current_target from public.users where id = target_user_id;
  if current_target.id is null then
    raise exception 'User not found';
  end if;
  if not public.can_manage_organization(current_target.organization_id) then
    raise exception 'Insufficient permissions';
  end if;
  if new_role = 'platform_owner' and not public.is_platform_owner() then
    raise exception 'Only a platform owner can assign this role';
  end if;
  if new_organization_id <> current_target.organization_id
     and not public.is_platform_owner() then
    raise exception 'Only a platform owner can move users between organizations';
  end if;
  if new_role not in ('platform_owner','organization_admin','member') then
    raise exception 'Invalid role';
  end if;

  update public.users
  set first_name = trim(coalesce(nullif(new_first_name, ''), first_name)),
      title = trim(coalesce(nullif(new_title, ''), 'Miembro')),
      role = new_role,
      organization_id = new_organization_id,
      updated_at = now()
  where id = target_user_id
  returning * into updated_profile;

  if new_organization_id <> current_target.organization_id then
    delete from public.user_area_access access
    where access.user_id = target_user_id
      and not exists (
        select 1 from public.work_areas area
        where area.id = access.area_id
          and area.organization_id = new_organization_id
      );
  end if;

  return updated_profile;
end;
$$;

revoke all on function public.admin_update_member(uuid,text,text,text,uuid) from public, anon;
grant execute on function public.admin_update_member(uuid,text,text,text,uuid) to authenticated;


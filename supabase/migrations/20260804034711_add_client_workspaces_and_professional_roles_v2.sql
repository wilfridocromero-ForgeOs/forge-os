-- Exact historical SQL recovered read-only from
-- supabase_migrations.schema_migrations (20260804034711 / add_client_workspaces_and_professional_roles_v2).
-- The migration is already applied remotely. Do not execute it manually
-- against production; this copy is for local history reconciliation only.


alter table public.users
  add column if not exists division text,
  add column if not exists job_position text,
  add column if not exists specialty text;

alter table public.users drop constraint if exists users_role_check;
alter table public.users add constraint users_role_check
  check (role in ('platform_owner', 'organization_admin', 'area_lead', 'member'));

alter table public.user_invitations
  add column if not exists division text,
  add column if not exists job_position text,
  add column if not exists specialty text,
  add column if not exists source_client_id bigint references public.clients(id) on delete set null;

alter table public.user_invitations drop constraint if exists user_invitations_role_check;
alter table public.user_invitations add constraint user_invitations_role_check
  check (role in ('organization_admin', 'area_lead', 'member'));

alter table public.clients
  add column if not exists workspace_organization_id uuid
    references public.organizations(id) on delete set null,
  add column if not exists portal_enabled boolean not null default false;

create unique index if not exists clients_workspace_organization_unique_idx
  on public.clients (workspace_organization_id)
  where workspace_organization_id is not null;
create index if not exists user_invitations_source_client_id_idx
  on public.user_invitations (source_client_id);

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
      id, organization_id, first_name, title, role,
      division, job_position, specialty
    )
    values (
      new.id,
      pending_invitation.organization_id,
      pending_invitation.first_name,
      pending_invitation.title,
      pending_invitation.role,
      pending_invitation.division,
      pending_invitation.job_position,
      pending_invitation.specialty
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
    set invited_user_id = new.id
    where id = pending_invitation.id;

    if pending_invitation.source_client_id is not null then
      update public.clients
      set portal_enabled = true
      where id = pending_invitation.source_client_id;
    end if;

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

create or replace function public.admin_list_members_v2()
returns table (
  id uuid,
  email text,
  first_name text,
  title text,
  role text,
  organization_id uuid,
  organization_name text,
  division text,
  job_position text,
  specialty text,
  email_confirmed boolean
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then raise exception 'Authentication required'; end if;
  if not (
    public.is_platform_owner()
    or exists (
      select 1 from public.users
      where id = (select auth.uid()) and role = 'organization_admin'
    )
  ) then raise exception 'Insufficient permissions'; end if;

  return query
  select p.id, a.email::text, p.first_name, p.title, p.role,
         p.organization_id, o.name, p.division, p.job_position,
         p.specialty, (a.email_confirmed_at is not null)
  from public.users p
  join auth.users a on a.id = p.id
  join public.organizations o on o.id = p.organization_id
  where public.is_platform_owner()
     or p.organization_id = public.current_user_organization_id()
  order by p.created_at;
end;
$$;

create or replace function public.admin_update_member_professional(
  target_user_id uuid,
  new_first_name text,
  new_title text,
  new_role text,
  new_organization_id uuid,
  new_division text,
  new_position text,
  new_specialty text
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
  if (select auth.uid()) is null then raise exception 'Authentication required'; end if;
  select * into current_target from public.users where id = target_user_id;
  if current_target.id is null then raise exception 'User not found'; end if;
  if not public.can_manage_organization(current_target.organization_id) then raise exception 'Insufficient permissions'; end if;
  if new_role = 'platform_owner' and not public.is_platform_owner() then raise exception 'Only a platform owner can assign this role'; end if;
  if new_organization_id <> current_target.organization_id and not public.is_platform_owner() then raise exception 'Only a platform owner can move users between organizations'; end if;
  if new_role not in ('platform_owner','organization_admin','area_lead','member') then raise exception 'Invalid role'; end if;

  update public.users
  set first_name = trim(coalesce(nullif(new_first_name, ''), first_name)),
      title = trim(coalesce(nullif(new_title, ''), 'Miembro')),
      role = new_role,
      organization_id = new_organization_id,
      division = nullif(trim(coalesce(new_division, '')), ''),
      job_position = nullif(trim(coalesce(new_position, '')), ''),
      specialty = nullif(trim(coalesce(new_specialty, '')), ''),
      updated_at = now()
  where id = target_user_id
  returning * into updated_profile;

  if new_organization_id <> current_target.organization_id then
    delete from public.user_area_access access
    where access.user_id = target_user_id
      and not exists (
        select 1 from public.work_areas area
        where area.id = access.area_id and area.organization_id = new_organization_id
      );
  end if;

  return updated_profile;
end;
$$;

revoke all on function public.admin_list_members_v2() from public, anon;
revoke all on function public.admin_update_member_professional(uuid,text,text,text,uuid,text,text,text) from public, anon;
grant execute on function public.admin_list_members_v2() to authenticated;
grant execute on function public.admin_update_member_professional(uuid,text,text,text,uuid,text,text,text) to authenticated;


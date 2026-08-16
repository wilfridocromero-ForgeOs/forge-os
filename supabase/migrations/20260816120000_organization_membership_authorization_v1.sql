-- Canonical, organization-scoped authorization.
-- public.users remains the personal/legacy profile; roles live in memberships.

create table public.organization_memberships (
  user_id uuid not null references auth.users(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  role text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, organization_id),
  constraint organization_memberships_role_check
    check (role in ('founder', 'admin', 'area_lead', 'member'))
);

create index organization_memberships_organization_idx
  on public.organization_memberships (organization_id, role);

create table public.user_active_organizations (
  user_id uuid primary key references auth.users(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  updated_at timestamptz not null default now(),
  constraint user_active_organizations_membership_fkey
    foreign key (user_id, organization_id)
    references public.organization_memberships(user_id, organization_id)
    on delete cascade
);

-- Creator promotion requires two independent signals: the earliest profile in
-- the organization and the exact transaction timestamp shared with organization
-- creation. Being the first or only current member is not sufficient by itself.
with ranked_profiles as (
  select
    profile.id as user_id,
    profile.organization_id,
    profile.role as legacy_role,
    profile.created_at as profile_created_at,
    organization.created_at as organization_created_at,
    row_number() over (
      partition by profile.organization_id
      order by profile.created_at, profile.id
    ) as creation_order
  from public.users as profile
  join public.organizations as organization
    on organization.id = profile.organization_id
)
insert into public.organization_memberships (user_id, organization_id, role)
select
  user_id,
  organization_id,
  case
    when legacy_role = 'platform_owner'
      or (
        creation_order = 1
        and profile_created_at = organization_created_at
      ) then 'founder'
    when legacy_role = 'organization_admin' then 'admin'
    when legacy_role = 'area_lead' then 'area_lead'
    else 'member'
  end
from ranked_profiles;

insert into public.user_active_organizations (user_id, organization_id)
select id, organization_id
from public.users;

alter table public.organization_memberships enable row level security;
alter table public.user_active_organizations enable row level security;

create or replace function public.current_user_organization_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select active.organization_id
  from public.user_active_organizations as active
  join public.organization_memberships as membership
    on membership.user_id = active.user_id
   and membership.organization_id = active.organization_id
  where active.user_id = (select auth.uid());
$$;

create or replace function public.current_user_membership_role()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select membership.role
  from public.organization_memberships as membership
  where membership.user_id = (select auth.uid())
    and membership.organization_id = public.current_user_organization_id();
$$;

create or replace function public.can_manage_organization(target_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    (select auth.uid()) is not null
    and target_organization_id = public.current_user_organization_id()
    and exists (
      select 1
      from public.organization_memberships as membership
      where membership.user_id = (select auth.uid())
        and membership.organization_id = target_organization_id
        and membership.role in ('founder', 'admin')
    );
$$;

alter function public.current_user_organization_id() owner to postgres;
alter function public.current_user_membership_role() owner to postgres;
alter function public.can_manage_organization(uuid) owner to postgres;
revoke all on function public.current_user_organization_id() from public, anon, authenticated;
revoke all on function public.current_user_membership_role() from public, anon, authenticated;
revoke all on function public.can_manage_organization(uuid) from public, anon, authenticated;
grant execute on function public.current_user_organization_id() to authenticated;
grant execute on function public.current_user_membership_role() to authenticated;
grant execute on function public.can_manage_organization(uuid) to authenticated;

create policy "Members read own memberships"
on public.organization_memberships
for select to authenticated
using (
  user_id = (select auth.uid())
  or public.can_manage_organization(organization_id)
);

create policy "Founders and admins manage memberships"
on public.organization_memberships
for all to authenticated
using (public.can_manage_organization(organization_id))
with check (public.can_manage_organization(organization_id));

create policy "Users read own active organization"
on public.user_active_organizations
for select to authenticated
using (user_id = (select auth.uid()));

create or replace function public.set_active_organization(target_organization_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication required';
  end if;

  if not exists (
    select 1
    from public.organization_memberships as membership
    where membership.user_id = (select auth.uid())
      and membership.organization_id = target_organization_id
  ) then
    raise exception 'Organization membership not found';
  end if;

  insert into public.user_active_organizations (user_id, organization_id, updated_at)
  values ((select auth.uid()), target_organization_id, now())
  on conflict (user_id) do update
    set organization_id = excluded.organization_id,
        updated_at = excluded.updated_at;
end;
$$;

create or replace function public.get_my_authorization_context()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'profile', jsonb_build_object(
      'id', profile.id,
      'first_name', profile.first_name,
      'title', profile.title,
      'division', profile.division,
      'division_id', profile.division_id,
      'job_position', profile.job_position,
      'specialty', profile.specialty
    ),
    'organization', to_jsonb(organization),
    'membership', jsonb_build_object(
      'user_id', membership.user_id,
      'organization_id', membership.organization_id,
      'role', membership.role
    ),
    'organizations', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', available_organization.id,
        'name', available_organization.name,
        'organization_type', available_organization.organization_type,
        'role', available_membership.role
      ) order by available_organization.name)
      from public.organization_memberships as available_membership
      join public.organizations as available_organization
        on available_organization.id = available_membership.organization_id
      where available_membership.user_id = profile.id
    ), '[]'::jsonb)
  )
  from public.users as profile
  join public.user_active_organizations as active
    on active.user_id = profile.id
  join public.organization_memberships as membership
    on membership.user_id = profile.id
   and membership.organization_id = active.organization_id
  join public.organizations as organization
    on organization.id = membership.organization_id
  where profile.id = (select auth.uid());
$$;

alter function public.set_active_organization(uuid) owner to postgres;
alter function public.get_my_authorization_context() owner to postgres;
revoke all on function public.set_active_organization(uuid) from public, anon, authenticated;
revoke all on function public.get_my_authorization_context() from public, anon, authenticated;
grant execute on function public.set_active_organization(uuid) to authenticated;
grant execute on function public.get_my_authorization_context() to authenticated;

-- Member administration now reads and writes the role in the active membership.
create or replace function public.admin_list_members_v2()
returns table(
  id uuid, email text, first_name text, title text, role text,
  organization_id uuid, organization_name text, division text,
  job_position text, specialty text, email_confirmed boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  active_organization_id uuid := public.current_user_organization_id();
begin
  if not public.can_manage_organization(active_organization_id) then
    raise exception 'Insufficient permissions';
  end if;

  return query
  select profile.id, account.email::text, profile.first_name, profile.title,
         membership.role, membership.organization_id, organization.name,
         profile.division, profile.job_position, profile.specialty,
         (account.email_confirmed_at is not null)
  from public.organization_memberships as membership
  join public.users as profile on profile.id = membership.user_id
  join auth.users as account on account.id = membership.user_id
  join public.organizations as organization on organization.id = membership.organization_id
  where membership.organization_id = active_organization_id
  order by membership.created_at;
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
  active_organization_id uuid := public.current_user_organization_id();
  updated_profile public.users;
begin
  if new_organization_id is distinct from active_organization_id
     or not public.can_manage_organization(active_organization_id) then
    raise exception 'Insufficient permissions';
  end if;
  if new_role not in ('founder', 'admin', 'area_lead', 'member') then
    raise exception 'Invalid role';
  end if;
  if new_role = 'founder'
     and public.current_user_membership_role() <> 'founder' then
    raise exception 'Only a founder can assign the founder role';
  end if;
  if not exists (
    select 1 from public.organization_memberships
    where user_id = target_user_id
      and organization_id = active_organization_id
  ) then
    raise exception 'Organization membership not found';
  end if;
  if new_role <> 'founder'
     and (select role from public.organization_memberships
          where user_id = target_user_id and organization_id = active_organization_id) = 'founder'
     and (select count(*) from public.organization_memberships
          where organization_id = active_organization_id and role = 'founder') = 1 then
    raise exception 'An organization must keep at least one founder';
  end if;

  update public.organization_memberships
  set role = new_role, updated_at = now()
  where user_id = target_user_id
    and organization_id = active_organization_id;

  update public.users
  set first_name = trim(coalesce(nullif(new_first_name, ''), first_name)),
      title = trim(coalesce(nullif(new_title, ''), 'Miembro')),
      division = nullif(trim(coalesce(new_division, '')), ''),
      job_position = nullif(trim(coalesce(new_position, '')), ''),
      specialty = nullif(trim(coalesce(new_specialty, '')), ''),
      updated_at = now()
  where id = target_user_id
  returning * into updated_profile;

  return updated_profile;
end;
$$;

-- Future signups create a founder membership; invited users inherit a scoped role.
create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_organization_id uuid;
  pending_invitation public.user_invitations%rowtype;
  membership_role text;
begin
  select invitation.* into pending_invitation
  from public.user_invitations as invitation
  where invitation.id::text = coalesce(new.raw_user_meta_data ->> 'invitation_id', '')
    and lower(invitation.email) = lower(new.email)
    and invitation.status = 'pending'
    and invitation.expires_at > now()
  limit 1;

  if pending_invitation.id is not null then
    insert into public.users (
      id, organization_id, first_name, title, role,
      division, job_position, specialty
    ) values (
      new.id, pending_invitation.organization_id, pending_invitation.first_name,
      pending_invitation.title, pending_invitation.role, pending_invitation.division,
      pending_invitation.job_position, pending_invitation.specialty
    );

    membership_role := case pending_invitation.role
      when 'organization_admin' then 'admin'
      when 'area_lead' then 'area_lead'
      else 'member'
    end;
    insert into public.organization_memberships (user_id, organization_id, role)
    values (new.id, pending_invitation.organization_id, membership_role);
    insert into public.user_active_organizations (user_id, organization_id)
    values (new.id, pending_invitation.organization_id);

    insert into public.user_area_access (user_id, area_id)
    select new.id, area.id
    from public.work_areas as area
    where area.id = any(pending_invitation.area_ids)
      and area.organization_id = pending_invitation.organization_id
    on conflict do nothing;

    insert into public.member_module_access (user_id, module_key, enabled)
    select new.id, module_key, true
    from unnest(pending_invitation.module_keys) module_key
    where module_key in ('dashboard','clients','discovery','projects','area_score','playbooks')
    on conflict (user_id, module_key)
    do update set enabled = excluded.enabled, updated_at = now();

    update public.user_invitations set invited_user_id = new.id
    where id = pending_invitation.id;
    if pending_invitation.source_client_id is not null then
      update public.clients set portal_enabled = true
      where id = pending_invitation.source_client_id;
    end if;
    return new;
  end if;

  insert into public.organizations (name)
  values (coalesce(
    nullif(new.raw_user_meta_data ->> 'organization_name', ''),
    nullif(new.raw_user_meta_data ->> 'first_name', '') || ' - ORVESEN',
    split_part(new.email, '@', 1) || ' - ORVESEN'
  )) returning id into new_organization_id;

  insert into public.users (id, organization_id, first_name)
  values (
    new.id, new_organization_id,
    coalesce(nullif(new.raw_user_meta_data ->> 'first_name', ''), split_part(new.email, '@', 1))
  );
  insert into public.organization_memberships (user_id, organization_id, role)
  values (new.id, new_organization_id, 'founder');
  insert into public.user_active_organizations (user_id, organization_id)
  values (new.id, new_organization_id);
  return new;
end;
$$;

alter function public.admin_list_members_v2() owner to postgres;
alter function public.admin_update_member_professional(uuid,text,text,text,uuid,text,text,text) owner to postgres;
alter function private.handle_new_user() owner to postgres;
revoke all on function public.admin_list_members_v2() from public, anon, authenticated;
revoke all on function public.admin_update_member_professional(uuid,text,text,text,uuid,text,text,text) from public, anon, authenticated;
grant execute on function public.admin_list_members_v2() to authenticated;
grant execute on function public.admin_update_member_professional(uuid,text,text,text,uuid,text,text,text) to authenticated;

-- Retire the two older role RPC entry points. The active application uses the
-- membership-aware v2/professional contracts above.
revoke all on function public.admin_list_members() from public, anon, authenticated;
revoke all on function public.admin_update_member(uuid,text,text,text,uuid) from public, anon, authenticated;

grant select on public.organization_memberships to authenticated;
grant select on public.user_active_organizations to authenticated;

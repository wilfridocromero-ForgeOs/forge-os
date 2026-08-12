-- Exact historical SQL recovered read-only from
-- supabase_migrations.schema_migrations (20260804024641 / add_roles_work_areas_and_secure_permissions).
-- The migration is already applied remotely. Do not execute it manually
-- against production; this copy is for local history reconciliation only.


create extension if not exists pgcrypto;

alter table public.users
  add column if not exists role text not null default 'member',
  add column if not exists updated_at timestamptz not null default now();

alter table public.users drop constraint if exists users_role_check;
alter table public.users add constraint users_role_check
  check (role in ('platform_owner', 'organization_admin', 'member'));

create index if not exists users_organization_id_idx on public.users (organization_id);
create index if not exists clients_organization_id_idx on public.clients (organization_id);
create index if not exists clients_owner_id_idx on public.clients (owner_id);

create or replace function public.is_platform_owner()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.users
    where id = (select auth.uid()) and role = 'platform_owner'
  );
$$;

create or replace function public.current_user_organization_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select organization_id from public.users where id = (select auth.uid());
$$;

create or replace function public.can_manage_organization(target_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    public.is_platform_owner()
    or exists (
      select 1 from public.users
      where id = (select auth.uid())
        and role = 'organization_admin'
        and organization_id = target_organization_id
    );
$$;

revoke all on function public.is_platform_owner() from public, anon;
revoke all on function public.current_user_organization_id() from public, anon;
revoke all on function public.can_manage_organization(uuid) from public, anon;
grant execute on function public.is_platform_owner() to authenticated;
grant execute on function public.current_user_organization_id() to authenticated;
grant execute on function public.can_manage_organization(uuid) to authenticated;

create table if not exists public.work_areas (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 2 and 80),
  slug text not null check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  description text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, slug)
);

create table if not exists public.user_area_access (
  user_id uuid not null references public.users(id) on delete cascade,
  area_id uuid not null references public.work_areas(id) on delete cascade,
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (user_id, area_id)
);

create table if not exists public.member_module_access (
  user_id uuid not null references public.users(id) on delete cascade,
  module_key text not null check (module_key in ('dashboard','clients','discovery','projects','area_score','playbooks')),
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, module_key)
);

create table if not exists public.area_scores (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  area_id uuid not null references public.work_areas(id) on delete cascade,
  score integer not null check (score between 0 and 1000),
  max_score integer not null default 1000 check (max_score > 0),
  status text not null default 'pending' check (status in ('pending','healthy','attention','critical')),
  breakdown jsonb not null default '{}'::jsonb check (jsonb_typeof(breakdown) = 'object'),
  recommendations jsonb not null default '[]'::jsonb check (jsonb_typeof(recommendations) = 'array'),
  computed_at timestamptz not null default now(),
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists work_areas_organization_id_idx on public.work_areas (organization_id);
create index if not exists user_area_access_area_id_idx on public.user_area_access (area_id);
create index if not exists member_module_access_user_id_idx on public.member_module_access (user_id);
create index if not exists area_scores_organization_id_idx on public.area_scores (organization_id);
create index if not exists area_scores_area_id_computed_at_idx on public.area_scores (area_id, computed_at desc);

alter table public.work_areas enable row level security;
alter table public.user_area_access enable row level security;
alter table public.member_module_access enable row level security;
alter table public.area_scores enable row level security;

drop policy if exists "Users can update their profile" on public.users;
drop policy if exists "Users can view their profile" on public.users;
create policy "Users can view permitted profiles" on public.users
for select to authenticated
using (
  id = (select auth.uid())
  or public.is_platform_owner()
  or (
    public.can_manage_organization(organization_id)
    and organization_id = public.current_user_organization_id()
  )
);

drop policy if exists "Members can view their organization" on public.organizations;
create policy "Users can view permitted organizations" on public.organizations
for select to authenticated
using (
  public.is_platform_owner()
  or id = public.current_user_organization_id()
);

drop policy if exists "Members can view organization clients" on public.clients;
drop policy if exists "Members can create organization clients" on public.clients;
drop policy if exists "Members can update organization clients" on public.clients;
drop policy if exists "Members can delete organization clients" on public.clients;

create policy "Users can view permitted clients" on public.clients
for select to authenticated
using (
  public.is_platform_owner()
  or organization_id = public.current_user_organization_id()
);

create policy "Users can create permitted clients" on public.clients
for insert to authenticated
with check (
  owner_id = (select auth.uid())
  and (
    public.is_platform_owner()
    or organization_id = public.current_user_organization_id()
  )
);

create policy "Users can update permitted clients" on public.clients
for update to authenticated
using (
  public.is_platform_owner()
  or organization_id = public.current_user_organization_id()
)
with check (
  public.is_platform_owner()
  or organization_id = public.current_user_organization_id()
);

create policy "Users can delete permitted clients" on public.clients
for delete to authenticated
using (
  public.is_platform_owner()
  or public.can_manage_organization(organization_id)
);

create policy "Users can view permitted work areas" on public.work_areas
for select to authenticated
using (
  public.is_platform_owner()
  or public.can_manage_organization(organization_id)
  or exists (
    select 1 from public.user_area_access access
    where access.area_id = work_areas.id
      and access.user_id = (select auth.uid())
  )
);

create policy "Managers can create work areas" on public.work_areas
for insert to authenticated
with check (public.can_manage_organization(organization_id));

create policy "Managers can update work areas" on public.work_areas
for update to authenticated
using (public.can_manage_organization(organization_id))
with check (public.can_manage_organization(organization_id));

create policy "Managers can delete work areas" on public.work_areas
for delete to authenticated
using (public.can_manage_organization(organization_id));

create policy "Users can view permitted area assignments" on public.user_area_access
for select to authenticated
using (
  user_id = (select auth.uid())
  or public.is_platform_owner()
  or exists (
    select 1 from public.users target_user
    where target_user.id = user_area_access.user_id
      and public.can_manage_organization(target_user.organization_id)
  )
);

create policy "Managers can create area assignments" on public.user_area_access
for insert to authenticated
with check (
  exists (
    select 1
    from public.users target_user
    join public.work_areas target_area on target_area.id = user_area_access.area_id
    where target_user.id = user_area_access.user_id
      and target_user.organization_id = target_area.organization_id
      and public.can_manage_organization(target_user.organization_id)
  )
);

create policy "Managers can update area assignments" on public.user_area_access
for update to authenticated
using (
  exists (
    select 1 from public.users target_user
    where target_user.id = user_area_access.user_id
      and public.can_manage_organization(target_user.organization_id)
  )
)
with check (
  exists (
    select 1
    from public.users target_user
    join public.work_areas target_area on target_area.id = user_area_access.area_id
    where target_user.id = user_area_access.user_id
      and target_user.organization_id = target_area.organization_id
      and public.can_manage_organization(target_user.organization_id)
  )
);

create policy "Managers can delete area assignments" on public.user_area_access
for delete to authenticated
using (
  exists (
    select 1 from public.users target_user
    where target_user.id = user_area_access.user_id
      and public.can_manage_organization(target_user.organization_id)
  )
);

create policy "Users can view module access" on public.member_module_access
for select to authenticated
using (
  user_id = (select auth.uid())
  or public.is_platform_owner()
  or exists (
    select 1 from public.users target_user
    where target_user.id = member_module_access.user_id
      and public.can_manage_organization(target_user.organization_id)
  )
);

create policy "Managers can create module access" on public.member_module_access
for insert to authenticated
with check (
  exists (
    select 1 from public.users target_user
    where target_user.id = member_module_access.user_id
      and public.can_manage_organization(target_user.organization_id)
  )
);

create policy "Managers can update module access" on public.member_module_access
for update to authenticated
using (
  exists (
    select 1 from public.users target_user
    where target_user.id = member_module_access.user_id
      and public.can_manage_organization(target_user.organization_id)
  )
)
with check (
  exists (
    select 1 from public.users target_user
    where target_user.id = member_module_access.user_id
      and public.can_manage_organization(target_user.organization_id)
  )
);

create policy "Managers can delete module access" on public.member_module_access
for delete to authenticated
using (
  exists (
    select 1 from public.users target_user
    where target_user.id = member_module_access.user_id
      and public.can_manage_organization(target_user.organization_id)
  )
);

create policy "Users can view assigned area scores" on public.area_scores
for select to authenticated
using (
  public.is_platform_owner()
  or public.can_manage_organization(organization_id)
  or exists (
    select 1 from public.user_area_access access
    where access.area_id = area_scores.area_id
      and access.user_id = (select auth.uid())
  )
);

create policy "Managers can create area scores" on public.area_scores
for insert to authenticated
with check (
  public.can_manage_organization(organization_id)
  and exists (
    select 1 from public.work_areas area
    where area.id = area_scores.area_id
      and area.organization_id = area_scores.organization_id
  )
);

create policy "Managers can update area scores" on public.area_scores
for update to authenticated
using (public.can_manage_organization(organization_id))
with check (
  public.can_manage_organization(organization_id)
  and exists (
    select 1 from public.work_areas area
    where area.id = area_scores.area_id
      and area.organization_id = area_scores.organization_id
  )
);

create policy "Managers can delete area scores" on public.area_scores
for delete to authenticated
using (public.can_manage_organization(organization_id));

create or replace function public.update_my_profile(new_first_name text)
returns public.users
language plpgsql
security definer
set search_path = ''
as $$
declare
  updated_profile public.users;
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication required';
  end if;
  if char_length(trim(coalesce(new_first_name, ''))) < 2 then
    raise exception 'Name must contain at least two characters';
  end if;

  update public.users
  set first_name = trim(new_first_name), updated_at = now()
  where id = (select auth.uid())
  returning * into updated_profile;

  if updated_profile.id is null then
    raise exception 'Profile not found';
  end if;
  return updated_profile;
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

  return updated_profile;
end;
$$;

create or replace function public.admin_list_members()
returns table (
  id uuid,
  email text,
  first_name text,
  title text,
  role text,
  organization_id uuid,
  organization_name text,
  email_confirmed boolean
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication required';
  end if;
  if not (
    public.is_platform_owner()
    or exists (
      select 1 from public.users
      where id = (select auth.uid()) and role = 'organization_admin'
    )
  ) then
    raise exception 'Insufficient permissions';
  end if;

  return query
  select p.id, a.email::text, p.first_name, p.title, p.role,
         p.organization_id, o.name, (a.email_confirmed_at is not null)
  from public.users p
  join auth.users a on a.id = p.id
  join public.organizations o on o.id = p.organization_id
  where public.is_platform_owner()
     or p.organization_id = public.current_user_organization_id()
  order by p.created_at;
end;
$$;

revoke all on function public.update_my_profile(text) from public, anon;
revoke all on function public.admin_update_member(uuid,text,text,text,uuid) from public, anon;
revoke all on function public.admin_list_members() from public, anon;
grant execute on function public.update_my_profile(text) to authenticated;
grant execute on function public.admin_update_member(uuid,text,text,text,uuid) to authenticated;
grant execute on function public.admin_list_members() to authenticated;

revoke all on public.users from anon;
revoke all on public.organizations from anon;
revoke all on public.clients from anon;
revoke all on public.work_areas from anon;
revoke all on public.user_area_access from anon;
revoke all on public.member_module_access from anon;
revoke all on public.area_scores from anon;

revoke insert, update, delete, truncate on public.users from authenticated;
revoke insert, update, delete, truncate on public.organizations from authenticated;
revoke truncate on public.clients from authenticated;

grant select on public.users, public.organizations, public.clients,
  public.work_areas, public.user_area_access, public.member_module_access,
  public.area_scores to authenticated;
grant insert, update, delete on public.clients, public.work_areas,
  public.user_area_access, public.member_module_access, public.area_scores
  to authenticated;
grant usage, select on all sequences in schema public to authenticated;


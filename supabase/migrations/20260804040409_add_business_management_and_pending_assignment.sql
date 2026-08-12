-- Exact historical SQL recovered read-only from
-- supabase_migrations.schema_migrations (20260804040409 / add_business_management_and_pending_assignment).
-- The migration is already applied remotely. Do not execute it manually
-- against production; this copy is for local history reconciliation only.


alter table public.organizations
  add column if not exists organization_type text not null default 'business';

alter table public.organizations drop constraint if exists organizations_type_check;
alter table public.organizations add constraint organizations_type_check
  check (organization_type in ('internal','pending','client','business','legacy'));

update public.organizations o
set name = 'ORVESEN — Equipo interno',
    organization_type = 'internal',
    updated_at = now()
where exists (
  select 1 from public.users u
  where u.organization_id = o.id
    and u.role = 'platform_owner'
);

update public.organizations o
set organization_type = 'legacy',
    updated_at = now()
where organization_type = 'business'
  and not exists (
    select 1 from public.clients c
    where c.workspace_organization_id = o.id
  );

update public.organizations o
set organization_type = 'client',
    updated_at = now()
where exists (
  select 1 from public.clients c
  where c.workspace_organization_id = o.id
);

insert into public.organizations (name, organization_type)
select 'Pendiente de asignación', 'pending'
where not exists (
  select 1 from public.organizations where organization_type = 'pending'
);

create unique index if not exists organizations_single_internal_idx
  on public.organizations (organization_type)
  where organization_type = 'internal';
create unique index if not exists organizations_single_pending_idx
  on public.organizations (organization_type)
  where organization_type = 'pending';

create or replace function public.admin_list_organizations()
returns table (
  id uuid,
  name text,
  organization_type text,
  member_count bigint,
  linked_client_count bigint,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then raise exception 'Authentication required'; end if;
  if not public.is_platform_owner() then raise exception 'Only the platform owner can manage businesses'; end if;

  return query
  select o.id, o.name, o.organization_type,
         (select count(*) from public.users u where u.organization_id = o.id),
         (select count(*) from public.clients c where c.workspace_organization_id = o.id),
         o.created_at
  from public.organizations o
  order by
    case o.organization_type
      when 'internal' then 1
      when 'pending' then 2
      when 'client' then 3
      when 'business' then 4
      else 5
    end,
    o.name;
end;
$$;

create or replace function public.admin_create_organization(
  new_name text,
  new_type text default 'business'
)
returns public.organizations
language plpgsql
security definer
set search_path = ''
as $$
declare
  created_organization public.organizations;
begin
  if (select auth.uid()) is null then raise exception 'Authentication required'; end if;
  if not public.is_platform_owner() then raise exception 'Only the platform owner can create businesses'; end if;
  if char_length(trim(coalesce(new_name, ''))) < 2 then raise exception 'Business name is required'; end if;
  if new_type not in ('client','business') then raise exception 'Invalid business type'; end if;

  insert into public.organizations (name, organization_type)
  values (trim(new_name), new_type)
  returning * into created_organization;

  return created_organization;
end;
$$;

create or replace function public.admin_update_organization(
  target_organization_id uuid,
  new_name text,
  new_type text
)
returns public.organizations
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_organization public.organizations;
  updated_organization public.organizations;
begin
  if (select auth.uid()) is null then raise exception 'Authentication required'; end if;
  if not public.is_platform_owner() then raise exception 'Only the platform owner can update businesses'; end if;
  if char_length(trim(coalesce(new_name, ''))) < 2 then raise exception 'Business name is required'; end if;

  select * into current_organization from public.organizations where id = target_organization_id;
  if current_organization.id is null then raise exception 'Business not found'; end if;

  if current_organization.organization_type in ('internal','pending') then
    new_type := current_organization.organization_type;
  elsif new_type not in ('client','business','legacy') then
    raise exception 'Invalid business type';
  end if;

  update public.organizations
  set name = trim(new_name),
      organization_type = new_type,
      updated_at = now()
  where id = target_organization_id
  returning * into updated_organization;

  return updated_organization;
end;
$$;

revoke all on function public.admin_list_organizations() from public, anon;
revoke all on function public.admin_create_organization(text,text) from public, anon;
revoke all on function public.admin_update_organization(uuid,text,text) from public, anon;
grant execute on function public.admin_list_organizations() to authenticated;
grant execute on function public.admin_create_organization(text,text) to authenticated;
grant execute on function public.admin_update_organization(uuid,text,text) to authenticated;


-- Clientes V2: harden organization integrity and prevent destructive client deletion.

create or replace function private.client_has_business_history(target_client_id bigint)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    exists (select 1 from public.discovery_assessments where client_id = target_client_id)
    or exists (select 1 from public.projects where client_id = target_client_id)
    or exists (select 1 from public.client_notes where client_id = target_client_id)
    or exists (select 1 from public.user_invitations where source_client_id = target_client_id)
    or exists (
      select 1 from public.clients
      where id = target_client_id
        and (portal_enabled or workspace_organization_id is not null)
    );
$$;

revoke all on function private.client_has_business_history(bigint) from public, anon, authenticated;

create or replace function private.prevent_client_history_deletion()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if private.client_has_business_history(old.id) then
    raise exception using
      errcode = '23503',
      message = 'Client has business history and must be archived instead';
  end if;
  return old;
end;
$$;

revoke all on function private.prevent_client_history_deletion() from public, anon, authenticated;

drop trigger if exists prevent_client_history_deletion_trigger on public.clients;
create trigger prevent_client_history_deletion_trigger
before delete on public.clients
for each row execute function private.prevent_client_history_deletion();

create or replace function public.get_client_deletion_eligibility(target_client_id bigint)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  target public.clients;
  dependency_counts jsonb;
begin
  if (select auth.uid()) is null then raise exception 'Authentication required'; end if;

  select * into target from public.clients where id = target_client_id;
  if target.id is null then raise exception 'Client not found'; end if;
  if not public.can_manage_organization(target.organization_id) then raise exception 'Insufficient permissions'; end if;

  select jsonb_build_object(
    'discoveries', (select count(*) from public.discovery_assessments where client_id = target.id),
    'projects', (select count(*) from public.projects where client_id = target.id),
    'notes', (select count(*) from public.client_notes where client_id = target.id),
    'invitations', (select count(*) from public.user_invitations where source_client_id = target.id),
    'portal', target.portal_enabled or target.workspace_organization_id is not null
  ) into dependency_counts;

  return jsonb_build_object(
    'can_delete', not private.client_has_business_history(target.id),
    'dependencies', dependency_counts
  );
end;
$$;

create or replace function public.delete_client_if_empty(target_client_id bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.clients;
begin
  if (select auth.uid()) is null then raise exception 'Authentication required'; end if;

  select * into target from public.clients where id = target_client_id for update;
  if target.id is null then raise exception 'Client not found'; end if;
  if not public.can_manage_organization(target.organization_id) then raise exception 'Insufficient permissions'; end if;
  if private.client_has_business_history(target.id) then
    raise exception using
      errcode = '23503',
      message = 'Client has business history and must be archived instead';
  end if;

  delete from public.clients where id = target.id;
end;
$$;

revoke all on function public.get_client_deletion_eligibility(bigint) from public, anon;
revoke all on function public.delete_client_if_empty(bigint) from public, anon;
grant execute on function public.get_client_deletion_eligibility(bigint) to authenticated;
grant execute on function public.delete_client_if_empty(bigint) to authenticated;

drop policy if exists "Users can update permitted clients" on public.clients;
drop policy if exists "Managers can update organization clients" on public.clients;
create policy "Managers can update organization clients"
on public.clients for update to authenticated
using (public.is_platform_owner() or public.can_manage_organization(organization_id))
with check (
  public.is_platform_owner()
  or organization_id = (select public.current_user_organization_id())
);

drop policy if exists "client_notes_read_org" on public.client_notes;
create policy "client_notes_read_org"
on public.client_notes for select to authenticated
using (
  organization_id = (select public.current_user_organization_id())
  and exists (
    select 1 from public.clients c
    where c.id = client_notes.client_id
      and c.organization_id = client_notes.organization_id
  )
);

drop policy if exists "client_notes_insert_org" on public.client_notes;
create policy "client_notes_insert_org"
on public.client_notes for insert to authenticated
with check (
  organization_id = (select public.current_user_organization_id())
  and created_by = (select auth.uid())
  and exists (
    select 1 from public.clients c
    where c.id = client_notes.client_id
      and c.organization_id = client_notes.organization_id
  )
);

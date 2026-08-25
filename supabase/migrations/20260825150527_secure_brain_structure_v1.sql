-- CEREBRO FASE 2: structural integrity and least-privilege hardening.
-- This migration is intentionally incremental. It does not recreate Cerebro,
-- mutate existing documents, merge folders, or touch Storage objects/policies.

do $$
begin
  if exists (
    select 1
    from public.knowledge_documents as document
    join public.knowledge_folders as folder on folder.id = document.folder_id
    where document.organization_id <> folder.organization_id
  ) then
    raise exception 'Cannot secure Cerebro: cross-organization document/folder references exist';
  end if;

  if exists (
    select 1
    from public.knowledge_documents as document
    join public.divisions as division on division.id = document.division_id
    where document.organization_id <> division.organization_id
  ) then
    raise exception 'Cannot secure Cerebro: cross-organization document/division references exist';
  end if;

  if exists (
    select 1
    from public.knowledge_folders as folder
    join public.knowledge_folders as parent on parent.id = folder.parent_id
    where folder.organization_id <> parent.organization_id
  ) then
    raise exception 'Cannot secure Cerebro: cross-organization folder/parent references exist';
  end if;

  if exists (
    select 1
    from public.knowledge_folders as folder
    join public.divisions as division on division.id = folder.division_id
    where folder.organization_id <> division.organization_id
  ) then
    raise exception 'Cannot secure Cerebro: cross-organization folder/division references exist';
  end if;
end;
$$;

-- Composite candidate keys allow organization_id to participate in every
-- relationship, making tenant consistency a database invariant.
alter table public.divisions
  add constraint divisions_organization_id_id_key
  unique (organization_id, id);

alter table public.knowledge_folders
  add constraint knowledge_folders_organization_id_id_key
  unique (organization_id, id);

alter table public.knowledge_documents
  drop constraint knowledge_documents_folder_id_fkey,
  add constraint knowledge_documents_organization_folder_fkey
    foreign key (organization_id, folder_id)
    references public.knowledge_folders (organization_id, id)
    on delete set null (folder_id);

alter table public.knowledge_documents
  drop constraint knowledge_documents_division_id_fkey,
  add constraint knowledge_documents_organization_division_fkey
    foreign key (organization_id, division_id)
    references public.divisions (organization_id, id)
    on delete set null (division_id);

alter table public.knowledge_folders
  drop constraint knowledge_folders_parent_id_fkey,
  add constraint knowledge_folders_organization_parent_fkey
    foreign key (organization_id, parent_id)
    references public.knowledge_folders (organization_id, id)
    on delete cascade;

alter table public.knowledge_folders
  drop constraint knowledge_folders_division_id_fkey,
  add constraint knowledge_folders_organization_division_fkey
    foreign key (organization_id, division_id)
    references public.divisions (organization_id, id)
    on delete set null (division_id);

-- The two existing duplicate roots must remain intact, so a partial UNIQUE
-- index cannot be installed. This trigger serializes root-name claims and
-- rejects only new/changed collisions while permitting equal names under
-- different parents.
create or replace function private.prevent_duplicate_knowledge_root_folder()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.parent_id is not null then
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if old.organization_id is not distinct from new.organization_id
       and old.parent_id is not distinct from new.parent_id
       and old.name is not distinct from new.name then
      return new;
    end if;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(new.organization_id::text || ':' || new.name, 0)
  );

  if exists (
    select 1
    from public.knowledge_folders as existing
    where existing.organization_id = new.organization_id
      and existing.parent_id is null
      and existing.name = new.name
      and existing.id <> new.id
  ) then
    raise exception using
      errcode = '23505',
      message = 'A root knowledge folder with this name already exists in the organization',
      constraint = 'knowledge_folders_unique_root_name';
  end if;

  return new;
end;
$$;

revoke all on function private.prevent_duplicate_knowledge_root_folder() from public;
revoke all on function private.prevent_duplicate_knowledge_root_folder() from anon;
revoke all on function private.prevent_duplicate_knowledge_root_folder() from authenticated;

drop trigger if exists prevent_duplicate_knowledge_root_folder
  on public.knowledge_folders;

create trigger prevent_duplicate_knowledge_root_folder
before insert or update of organization_id, parent_id, name
on public.knowledge_folders
for each row
execute function private.prevent_duplicate_knowledge_root_folder();

-- Replace the recursive/shadowed parent lookup. Parent existence and tenant
-- equality are now enforced by the composite foreign key, without querying
-- knowledge_folders from its own RLS policy.
drop policy if exists "Organization managers create knowledge folders"
  on public.knowledge_folders;

create policy "Organization managers create knowledge folders"
on public.knowledge_folders
for insert
to authenticated
with check (
  organization_id = (select public.current_user_organization_id())
  and created_by = (select auth.uid())
  and public.can_manage_organization(organization_id)
  and parent_id is distinct from id
);

drop policy if exists "Organization managers update knowledge folders"
  on public.knowledge_folders;

create policy "Organization managers update knowledge folders"
on public.knowledge_folders
for update
to authenticated
using (
  organization_id = (select public.current_user_organization_id())
  and public.can_manage_organization(organization_id)
)
with check (
  organization_id = (select public.current_user_organization_id())
  and public.can_manage_organization(organization_id)
  and parent_id is distinct from id
);

-- Keep only the Data API privileges used by Brain.jsx. RLS remains enabled
-- and is still the row-authorization boundary.
revoke all on table public.knowledge_documents from anon;
revoke all on table public.knowledge_folders from anon;

revoke all on table public.knowledge_documents from authenticated;
grant select, insert, update, delete
  on table public.knowledge_documents to authenticated;

revoke all on table public.knowledge_folders from authenticated;
grant select, insert, update, delete
  on table public.knowledge_folders to authenticated;

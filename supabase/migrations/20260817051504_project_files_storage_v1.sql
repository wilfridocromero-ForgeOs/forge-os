-- Projects V1 Phase 4: private, organization-scoped project files.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'project-files',
  'project-files',
  false,
  52428800,
  array[
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'text/csv',
    'text/plain',
    'image/jpeg',
    'image/png',
    'image/webp'
  ]::text[]
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

alter table public.project_files
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid references public.users(id) on delete set null;

alter table public.project_files
  alter column mime_type set not null,
  alter column size_bytes set not null;

alter table public.project_files drop constraint if exists project_files_size_bytes_check;
alter table public.project_files add constraint project_files_size_bytes_check
  check (size_bytes > 0 and size_bytes <= 52428800);
alter table public.project_files add constraint project_files_name_length_check
  check (char_length(trim(file_name)) between 1 and 255);
alter table public.project_files add constraint project_files_mime_type_check
  check (mime_type = any (array[
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'text/csv',
    'text/plain',
    'image/jpeg',
    'image/png',
    'image/webp'
  ]));

create index if not exists project_files_active_project_idx
  on public.project_files (project_id, created_at desc, id desc)
  where deleted_at is null;
create index if not exists project_files_uploaded_by_idx
  on public.project_files (uploaded_by);
create index if not exists project_files_deleted_by_idx
  on public.project_files (deleted_by)
  where deleted_by is not null;

create or replace function public.can_upload_project_file(target_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    (select auth.uid()) is not null
    and exists (
      select 1
      from public.projects p
      where p.id = target_project_id
        and p.organization_id = (select public.current_user_organization_id())
        and (
          (select public.is_platform_owner())
          or public.can_manage_organization(p.organization_id)
          or exists (
            select 1
            from public.project_members pm
            where pm.project_id = p.id
              and pm.user_id = (select auth.uid())
              and pm.role in ('owner', 'member')
          )
        )
    );
$$;

create or replace function public.authorize_project_file_object(
  object_name text,
  requested_operation text,
  object_owner uuid default null
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  parts text[];
  path_organization_id uuid;
  path_project_id uuid;
  path_file_id uuid;
  caller_id uuid := (select auth.uid());
begin
  if caller_id is null or requested_operation not in ('read', 'upload', 'delete') then
    return false;
  end if;
  parts := string_to_array(object_name, '/');
  if array_length(parts, 1) <> 5 or parts[3] <> 'files'
     or parts[5] = '' or char_length(parts[5]) > 180 then
    return false;
  end if;
  begin
    path_organization_id := parts[1]::uuid;
    path_project_id := parts[2]::uuid;
    path_file_id := parts[4]::uuid;
  exception when invalid_text_representation then
    return false;
  end;
  if path_organization_id is distinct from (select public.current_user_organization_id())
     or not exists (
       select 1 from public.projects p
       where p.id = path_project_id and p.organization_id = path_organization_id
     ) then
    return false;
  end if;
  if requested_operation = 'read' then
    return true;
  end if;
  if requested_operation = 'upload' then
    return public.can_upload_project_file(path_project_id);
  end if;
  return exists (
    select 1
    from public.project_files pf
    where pf.id = path_file_id
      and pf.project_id = path_project_id
      and pf.storage_path = object_name
      and pf.deleted_at is null
      and (
        pf.uploaded_by = caller_id
        or public.can_manage_project_membership(path_project_id)
      )
  ) or (
    object_owner = caller_id
    and public.can_upload_project_file(path_project_id)
    and not exists (
      select 1 from public.project_files pf
      where pf.storage_path = object_name
    )
  );
end;
$$;

create or replace function private.validate_project_file()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  project_organization_id uuid;
  expected_prefix text;
  stored_size bigint;
  stored_mime text;
begin
  if caller_id is null then raise exception 'Authentication required'; end if;
  if tg_op = 'INSERT' then
    if new.uploaded_by is distinct from caller_id then
      raise exception 'File uploader must match the authenticated user';
    end if;
    if not public.can_upload_project_file(new.project_id) then
      raise exception 'You cannot upload files to this project';
    end if;
    select p.organization_id into project_organization_id
    from public.projects p where p.id = new.project_id;
    expected_prefix := project_organization_id::text || '/' || new.project_id::text || '/files/' || new.id::text || '/';
    if new.storage_path not like expected_prefix || '%'
       or position('/' in substring(new.storage_path from char_length(expected_prefix) + 1)) > 0 then
      raise exception 'Invalid project file storage path';
    end if;
    new.file_name := trim(new.file_name);
    select (o.metadata ->> 'size')::bigint, o.metadata ->> 'mimetype'
      into stored_size, stored_mime
    from storage.objects o
    where o.bucket_id = 'project-files'
      and o.name = new.storage_path
      and o.owner = caller_id;
    if stored_size is null then raise exception 'Storage object does not exist'; end if;
    if stored_size is distinct from new.size_bytes or stored_mime is distinct from new.mime_type then
      raise exception 'File metadata does not match the stored object';
    end if;
    return new;
  end if;
  if new.project_id is distinct from old.project_id
     or new.storage_path is distinct from old.storage_path
     or new.file_name is distinct from old.file_name
     or new.mime_type is distinct from old.mime_type
     or new.size_bytes is distinct from old.size_bytes
     or new.uploaded_by is distinct from old.uploaded_by
     or new.created_at is distinct from old.created_at then
    raise exception 'Project file metadata is immutable';
  end if;
  if old.deleted_at is not null then raise exception 'Deleted file metadata is immutable'; end if;
  if new.deleted_at is null then raise exception 'Only soft deletion is allowed'; end if;
  if caller_id is distinct from old.uploaded_by
     and not public.can_manage_project_membership(old.project_id) then
    raise exception 'You cannot delete this file';
  end if;
  new.deleted_at := now();
  new.deleted_by := caller_id;
  return new;
end;
$$;

create or replace function private.record_project_file_activity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare activity_event text;
begin
  if tg_op = 'INSERT' then
    activity_event := 'file_uploaded';
  elsif old.deleted_at is null and new.deleted_at is not null then
    activity_event := 'file_deleted';
  else
    return new;
  end if;
  insert into public.project_activity(project_id, actor_id, event_type, entity_type, entity_id, payload)
  values (
    new.project_id,
    (select auth.uid()),
    activity_event,
    'file',
    new.id::text,
    jsonb_build_object('file_id', new.id, 'name', new.file_name, 'mime_type', new.mime_type, 'size_bytes', new.size_bytes)
  );
  return new;
end;
$$;

drop trigger if exists validate_project_file_trigger on public.project_files;
create trigger validate_project_file_trigger
before insert or update on public.project_files
for each row execute function private.validate_project_file();

drop trigger if exists record_project_file_activity_trigger on public.project_files;
create trigger record_project_file_activity_trigger
after insert or update on public.project_files
for each row execute function private.record_project_file_activity();

drop policy if exists "Project members upload files" on public.project_files;
create policy "Project participants upload files" on public.project_files
for insert to authenticated
with check (uploaded_by = (select auth.uid()) and public.can_upload_project_file(project_id));

drop policy if exists "Uploaders delete files" on public.project_files;
create policy "Uploaders and managers soft delete files" on public.project_files
for update to authenticated
using (
  deleted_at is null
  and (uploaded_by = (select auth.uid()) or public.can_manage_project_membership(project_id))
)
with check (uploaded_by = (select auth.uid()) or public.can_manage_project_membership(project_id));

revoke all on table public.project_files from anon, authenticated;
grant select, insert, update on table public.project_files to authenticated;

drop policy if exists "Project files are readable in the active organization" on storage.objects;
create policy "Project files are readable in the active organization" on storage.objects
for select to authenticated
using (
  bucket_id = 'project-files'
  and public.authorize_project_file_object(name, 'read', owner)
);

drop policy if exists "Project participants upload project files" on storage.objects;
create policy "Project participants upload project files" on storage.objects
for insert to authenticated
with check (
  bucket_id = 'project-files'
  and public.authorize_project_file_object(name, 'upload', owner)
);

drop policy if exists "Project file owners and managers delete objects" on storage.objects;
create policy "Project file owners and managers delete objects" on storage.objects
for delete to authenticated
using (
  bucket_id = 'project-files'
  and public.authorize_project_file_object(name, 'delete', owner)
);

create or replace function public.get_project_files_page(
  target_project_id uuid,
  before_created_at timestamptz default null,
  before_file_id uuid default null,
  page_size integer default 30
)
returns table (
  id uuid,
  project_id uuid,
  storage_path text,
  file_name text,
  mime_type text,
  size_bytes bigint,
  uploaded_by uuid,
  uploader_name text,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select pf.id, pf.project_id, pf.storage_path, pf.file_name, pf.mime_type,
         pf.size_bytes, pf.uploaded_by, coalesce(u.first_name, 'Usuario'), pf.created_at
  from public.project_files pf
  left join public.users u on u.id = pf.uploaded_by
  where pf.project_id = target_project_id
    and pf.deleted_at is null
    and exists (
      select 1 from public.projects p
      where p.id = target_project_id
        and p.organization_id = (select public.current_user_organization_id())
    )
    and (
      before_created_at is null
      or (pf.created_at, pf.id) < (before_created_at, before_file_id)
    )
  order by pf.created_at desc, pf.id desc
  limit least(greatest(page_size, 1), 50);
$$;

revoke all on function public.can_upload_project_file(uuid) from public, anon;
grant execute on function public.can_upload_project_file(uuid) to authenticated;
revoke all on function public.authorize_project_file_object(text, text, uuid) from public, anon;
grant execute on function public.authorize_project_file_object(text, text, uuid) to authenticated;
revoke all on function public.get_project_files_page(uuid, timestamptz, uuid, integer) from public, anon;
grant execute on function public.get_project_files_page(uuid, timestamptz, uuid, integer) to authenticated;
revoke all on function private.validate_project_file() from public, anon, authenticated;
revoke all on function private.record_project_file_activity() from public, anon, authenticated;

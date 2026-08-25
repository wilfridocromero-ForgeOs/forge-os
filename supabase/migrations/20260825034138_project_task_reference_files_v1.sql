-- Projects Phase 7: task instructions reuse project_tasks.description and
-- reference attachments reuse the existing private project-files pipeline.

alter table public.project_files
  add column task_id uuid references public.project_tasks(id) on delete restrict,
  add column file_role text not null default 'project';

alter table public.project_files
  add constraint project_files_role_check
    check (file_role in ('project', 'task_reference')),
  add constraint project_files_task_context_check
    check (
      (file_role = 'project' and task_id is null)
      or (file_role = 'task_reference' and task_id is not null)
    );

create index project_files_active_task_idx
  on public.project_files (task_id, created_at desc, id desc)
  where task_id is not null and deleted_at is null;

create or replace function private.preserve_task_reference_history()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.project_files file where file.task_id = old.id) then
    raise exception 'Tasks with reference file history preserve project history';
  end if;
  return old;
end;
$$;

create trigger preserve_task_reference_history_trigger
before delete on public.project_tasks
for each row execute function private.preserve_task_reference_history();

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
  if caller_id is null or requested_operation not in ('read', 'upload', 'delete') then return false; end if;
  parts := string_to_array(object_name, '/');
  if array_length(parts, 1) <> 5 or parts[3] <> 'files'
     or parts[5] = '' or char_length(parts[5]) > 180 then return false; end if;
  begin
    path_organization_id := parts[1]::uuid;
    path_project_id := parts[2]::uuid;
    path_file_id := parts[4]::uuid;
  exception when invalid_text_representation then return false;
  end;
  if path_organization_id is distinct from (select public.current_user_organization_id())
     or not exists (
       select 1 from public.projects project
       where project.id = path_project_id and project.organization_id = path_organization_id
     ) then return false;
  end if;
  if requested_operation = 'read' then return true; end if;
  if requested_operation = 'upload' then return public.can_upload_project_file(path_project_id); end if;
  return exists (
    select 1 from public.project_files file
    where file.id = path_file_id
      and file.project_id = path_project_id
      and file.storage_path = object_name
      and file.deleted_at is null
      and (
        (file.uploaded_by = caller_id and public.can_upload_project_file(path_project_id))
        or public.can_manage_project_membership(path_project_id)
        or (file.file_role = 'task_reference' and public.can_configure_project_task(file.task_id))
      )
  ) or (
    object_owner = caller_id
    and public.can_upload_project_file(path_project_id)
    and not exists (select 1 from public.project_files file where file.storage_path = object_name)
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
    if new.file_role = 'task_reference' and not exists (
      select 1 from public.project_tasks task
      where task.id = new.task_id
        and task.project_id = new.project_id
        and public.can_configure_project_task(task.id)
    ) then
      raise exception 'You cannot attach reference files to this task';
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
     or new.task_id is distinct from old.task_id
     or new.file_role is distinct from old.file_role
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
     and not public.can_manage_project_membership(old.project_id)
     and not (old.file_role = 'task_reference' and public.can_configure_project_task(old.task_id)) then
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
    activity_event := case when new.file_role = 'task_reference'
      then 'task_reference_added' else 'file_uploaded' end;
  elsif old.deleted_at is null and new.deleted_at is not null then
    activity_event := case when new.file_role = 'task_reference'
      then 'task_reference_removed' else 'file_deleted' end;
  else
    return new;
  end if;
  insert into public.project_activity(project_id, actor_id, event_type, entity_type, entity_id, payload)
  values (
    new.project_id,
    (select auth.uid()),
    activity_event,
    case when new.file_role = 'task_reference' then 'task_reference' else 'file' end,
    new.id::text,
    jsonb_build_object(
      'file_id', new.id, 'task_id', new.task_id, 'name', new.file_name,
      'mime_type', new.mime_type, 'size_bytes', new.size_bytes
    )
  );
  return new;
end;
$$;

drop policy if exists "Uploaders and managers soft delete files" on public.project_files;
create policy "Editors soft delete project files"
on public.project_files for update to authenticated
using (
  deleted_at is null
  and (
    (uploaded_by = (select auth.uid()) and public.can_upload_project_file(project_id))
    or public.can_manage_project_membership(project_id)
    or (file_role = 'task_reference' and public.can_configure_project_task(task_id))
  )
)
with check (
  (uploaded_by = (select auth.uid()) and public.can_upload_project_file(project_id))
  or public.can_manage_project_membership(project_id)
  or (file_role = 'task_reference' and public.can_configure_project_task(task_id))
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
    and pf.file_role = 'project'
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

create or replace function public.get_task_reference_files(target_task_id uuid)
returns table (
  id uuid,
  project_id uuid,
  task_id uuid,
  source_task_id uuid,
  inherited boolean,
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
  with requested_task as (
    select task.id, task.project_id, schedule.template_task_id
    from public.project_tasks task
    left join public.project_task_schedules schedule
      on schedule.id = task.recurrence_schedule_id
    join public.projects project on project.id = task.project_id
    where task.id = target_task_id
      and project.organization_id = (select public.current_user_organization_id())
  ), sources as (
    select id as source_task_id, false as inherited from requested_task
    union all
    select template_task_id, true from requested_task where template_task_id is not null
  )
  select file.id, file.project_id, target_task_id, file.task_id, source.inherited,
         file.storage_path, file.file_name, file.mime_type, file.size_bytes,
         file.uploaded_by, coalesce(uploader.first_name, 'Usuario'), file.created_at
  from sources source
  join public.project_files file on file.task_id = source.source_task_id
  left join public.users uploader on uploader.id = file.uploaded_by
  where file.file_role = 'task_reference' and file.deleted_at is null
  order by source.inherited, file.created_at desc, file.id desc;
$$;

alter function private.validate_project_file() owner to postgres;
alter function private.record_project_file_activity() owner to postgres;
alter function private.preserve_task_reference_history() owner to postgres;
alter function public.authorize_project_file_object(text, text, uuid) owner to postgres;
alter function public.get_task_reference_files(uuid) owner to postgres;

revoke all on function private.validate_project_file() from public, anon, authenticated;
revoke all on function private.record_project_file_activity() from public, anon, authenticated;
revoke all on function private.preserve_task_reference_history() from public, anon, authenticated;
revoke all on function public.authorize_project_file_object(text, text, uuid) from public, anon;
grant execute on function public.authorize_project_file_object(text, text, uuid) to authenticated;
revoke all on function public.get_task_reference_files(uuid) from public, anon;
grant execute on function public.get_task_reference_files(uuid) to authenticated;

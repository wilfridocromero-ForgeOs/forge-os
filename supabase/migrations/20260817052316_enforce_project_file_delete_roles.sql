-- Prevent former members/observers from deleting files solely because they uploaded them.

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
  if array_length(parts, 1) <> 5 or parts[3] <> 'files' or parts[5] = '' or char_length(parts[5]) > 180 then return false; end if;
  begin
    path_organization_id := parts[1]::uuid;
    path_project_id := parts[2]::uuid;
    path_file_id := parts[4]::uuid;
  exception when invalid_text_representation then return false;
  end;
  if path_organization_id is distinct from (select public.current_user_organization_id())
     or not exists (select 1 from public.projects p where p.id = path_project_id and p.organization_id = path_organization_id) then
    return false;
  end if;
  if requested_operation = 'read' then return true; end if;
  if requested_operation = 'upload' then return public.can_upload_project_file(path_project_id); end if;
  return exists (
    select 1 from public.project_files pf
    where pf.id = path_file_id
      and pf.project_id = path_project_id
      and pf.storage_path = object_name
      and pf.deleted_at is null
      and (
        (pf.uploaded_by = caller_id and public.can_upload_project_file(path_project_id))
        or public.can_manage_project_membership(path_project_id)
      )
  ) or (
    object_owner = caller_id
    and public.can_upload_project_file(path_project_id)
    and not exists (select 1 from public.project_files pf where pf.storage_path = object_name)
  );
end;
$$;

drop policy if exists "Uploaders and managers soft delete files" on public.project_files;
create policy "Uploaders and managers soft delete files" on public.project_files
for update to authenticated
using (
  deleted_at is null
  and (
    (uploaded_by = (select auth.uid()) and public.can_upload_project_file(project_id))
    or public.can_manage_project_membership(project_id)
  )
)
with check (
  (uploaded_by = (select auth.uid()) and public.can_upload_project_file(project_id))
  or public.can_manage_project_membership(project_id)
);

revoke all on function public.authorize_project_file_object(text, text, uuid) from public, anon;
grant execute on function public.authorize_project_file_object(text, text, uuid) to authenticated;

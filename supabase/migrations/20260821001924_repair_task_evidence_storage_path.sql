create or replace function public.authorize_task_evidence_object(
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
  org_id uuid;
  project_id_value uuid;
  task_id_value uuid;
  evidence_id_value uuid;
  caller uuid := (select auth.uid());
begin
  if caller is null or requested_operation not in ('read', 'upload', 'delete') then
    return false;
  end if;

  parts := string_to_array(object_name, '/');
  if array_length(parts, 1) <> 6
     or parts[3] <> 'evidence'
     or parts[6] = ''
     or char_length(parts[6]) > 180 then
    return false;
  end if;

  begin
    org_id := parts[1]::uuid;
    project_id_value := parts[2]::uuid;
    task_id_value := parts[4]::uuid;
    evidence_id_value := parts[5]::uuid;
  exception when invalid_text_representation then
    return false;
  end;

  if not exists (
    select 1
    from public.project_tasks t
    join public.projects p on p.id = t.project_id
    where t.id = task_id_value
      and p.id = project_id_value
      and p.organization_id = org_id
      and org_id = (select public.current_user_organization_id())
  ) then
    return false;
  end if;

  if requested_operation = 'read' then
    return true;
  end if;

  if requested_operation = 'upload' then
    return public.can_submit_task_evidence(task_id_value);
  end if;

  return exists (
    select 1
    from public.task_evidence e
    where e.id = evidence_id_value
      and e.task_id = task_id_value
      and e.storage_path = object_name
      and e.deleted_at is null
      and public.can_delete_task_evidence(e.id)
  ) or (
    object_owner = caller
    and public.can_submit_task_evidence(task_id_value)
    and not exists (
      select 1
      from public.task_evidence e
      where e.storage_path = object_name
    )
  );
end;
$$;

revoke all on function public.authorize_task_evidence_object(text, text, uuid) from public, anon;
grant execute on function public.authorize_task_evidence_object(text, text, uuid) to authenticated;

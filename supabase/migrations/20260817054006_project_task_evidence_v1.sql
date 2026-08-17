create table public.task_evidence_requirements (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.project_tasks(id) on delete cascade,
  evidence_type text not null check (evidence_type in ('image', 'video', 'document', 'url', 'text')),
  label text not null check (char_length(trim(label)) between 2 and 120),
  description text check (description is null or char_length(trim(description)) <= 1000),
  is_required boolean not null default true,
  min_count integer not null default 1 check (min_count between 0 and 20),
  max_count integer not null default 1 check (max_count between 1 and 20 and max_count >= min_count),
  position integer not null default 0 check (position between 0 and 1000),
  created_by uuid not null references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.task_evidence (
  id uuid primary key default gen_random_uuid(),
  requirement_id uuid not null references public.task_evidence_requirements(id) on delete restrict,
  task_id uuid not null references public.project_tasks(id) on delete cascade,
  evidence_type text not null check (evidence_type in ('image', 'video', 'document', 'url', 'text')),
  storage_path text,
  file_name text,
  mime_type text,
  size_bytes bigint,
  value_text text,
  value_url text,
  submitted_by uuid not null references public.users(id),
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  deleted_by uuid references public.users(id) on delete set null,
  constraint task_evidence_value_shape_check check (
    (evidence_type in ('image', 'video', 'document') and storage_path is not null and file_name is not null and mime_type is not null and size_bytes is not null and value_text is null and value_url is null)
    or (evidence_type = 'url' and value_url is not null and storage_path is null and file_name is null and mime_type is null and size_bytes is null and value_text is null)
    or (evidence_type = 'text' and value_text is not null and storage_path is null and file_name is null and mime_type is null and size_bytes is null and value_url is null)
  ),
  unique (task_id, storage_path)
);

create index task_evidence_requirements_task_position_idx on public.task_evidence_requirements(task_id, position, created_at);
create index task_evidence_active_requirement_idx on public.task_evidence(requirement_id, created_at) where deleted_at is null;
create index task_evidence_task_idx on public.task_evidence(task_id, created_at) where deleted_at is null;

alter table public.task_evidence_requirements enable row level security;
alter table public.task_evidence enable row level security;

grant select, insert, update, delete on public.task_evidence_requirements to authenticated;
grant select, insert, update on public.task_evidence to authenticated;
grant all on public.task_evidence_requirements, public.task_evidence to service_role;

create or replace function public.can_submit_task_evidence(target_task_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select (select auth.uid()) is not null and exists (
    select 1 from public.project_tasks t
    join public.projects p on p.id = t.project_id
    where t.id = target_task_id
      and p.organization_id = (select public.current_user_organization_id())
      and (
        (select public.is_platform_owner())
        or public.can_manage_organization(p.organization_id)
        or exists (
          select 1 from public.project_members pm
          where pm.project_id = p.id and pm.user_id = (select auth.uid()) and pm.role in ('owner', 'member')
        )
      )
  );
$$;

create or replace function public.can_manage_task_evidence_requirements(target_task_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select (select auth.uid()) is not null and exists (
    select 1 from public.project_tasks t
    join public.projects p on p.id = t.project_id
    where t.id = target_task_id
      and ((select public.is_platform_owner()) or (
        p.organization_id = (select public.current_user_organization_id())
        and (p.owner_id = (select auth.uid()) or public.can_manage_organization(p.organization_id))
      ))
  );
$$;

create or replace function public.can_delete_task_evidence(target_evidence_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select (select auth.uid()) is not null and exists (
    select 1 from public.task_evidence e
    join public.project_tasks t on t.id = e.task_id
    where e.id = target_evidence_id and e.deleted_at is null and t.status <> 'completed'
      and (e.submitted_by = (select auth.uid()) or public.can_manage_task_evidence_requirements(t.id))
  );
$$;

revoke all on function public.can_submit_task_evidence(uuid) from public, anon;
revoke all on function public.can_manage_task_evidence_requirements(uuid) from public, anon;
revoke all on function public.can_delete_task_evidence(uuid) from public, anon;
grant execute on function public.can_submit_task_evidence(uuid) to authenticated;
grant execute on function public.can_manage_task_evidence_requirements(uuid) to authenticated;
grant execute on function public.can_delete_task_evidence(uuid) to authenticated;

create policy "Project organization reads evidence requirements" on public.task_evidence_requirements
for select to authenticated using (exists (
  select 1 from public.project_tasks t join public.projects p on p.id=t.project_id
  where t.id=task_id and p.organization_id=(select public.current_user_organization_id())
));
create policy "Project managers create evidence requirements" on public.task_evidence_requirements
for insert to authenticated with check (created_by=(select auth.uid()) and public.can_manage_task_evidence_requirements(task_id));
create policy "Project managers update evidence requirements" on public.task_evidence_requirements
for update to authenticated using (public.can_manage_task_evidence_requirements(task_id)) with check (public.can_manage_task_evidence_requirements(task_id));
create policy "Project managers delete evidence requirements" on public.task_evidence_requirements
for delete to authenticated using (public.can_manage_task_evidence_requirements(task_id));

create policy "Project organization reads task evidence" on public.task_evidence
for select to authenticated using (exists (
  select 1 from public.project_tasks t join public.projects p on p.id=t.project_id
  where t.id=task_id and p.organization_id=(select public.current_user_organization_id())
));
create policy "Project participants submit task evidence" on public.task_evidence
for insert to authenticated with check (submitted_by=(select auth.uid()) and public.can_submit_task_evidence(task_id));
create policy "Evidence submitters and managers soft delete task evidence" on public.task_evidence
for update to authenticated using (public.can_delete_task_evidence(id))
with check (deleted_at is not null and deleted_by=(select auth.uid()));

create or replace function private.validate_task_evidence_requirement()
returns trigger language plpgsql security definer set search_path = '' as $$
declare task_status text;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(new.id::text, 0));
  select t.status into task_status from public.project_tasks t where t.id=new.task_id;
  if task_status is null then raise exception 'Task does not exist'; end if;
  if task_status='completed' then raise exception 'Evidence requirements cannot be changed while the task is completed'; end if;
  if tg_op='UPDATE' and (new.task_id is distinct from old.task_id or new.created_by is distinct from old.created_by or new.created_at is distinct from old.created_at) then raise exception 'Evidence requirement identity cannot be changed'; end if;
  if tg_op='UPDATE' and new.evidence_type is distinct from old.evidence_type and exists(select 1 from public.task_evidence e where e.requirement_id=old.id) then raise exception 'Evidence type cannot change after submissions exist'; end if;
  if tg_op='UPDATE' and new.max_count < (select count(*) from public.task_evidence e where e.requirement_id=old.id and e.deleted_at is null) then
    raise exception 'Maximum evidence count cannot be lower than existing evidence';
  end if;
  new.label := trim(new.label); new.description := nullif(trim(new.description), '');
  return new;
end; $$;

create or replace function private.block_completed_task_requirement_delete()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(old.id::text, 0));
  if exists(select 1 from public.project_tasks t where t.id=old.task_id and t.status='completed') then
    raise exception 'Evidence requirements cannot be changed while the task is completed';
  end if;
  if exists(select 1 from public.task_evidence e where e.requirement_id=old.id) then
    raise exception 'Evidence requirements with submissions cannot be deleted';
  end if;
  return old;
end; $$;

create or replace function private.validate_task_evidence()
returns trigger language plpgsql security definer set search_path = '' as $$
declare requirement public.task_evidence_requirements%rowtype; active_count integer; task_status text; project_id_value uuid; organization_id_value uuid; expected_prefix text;
begin
  if tg_op='UPDATE' then
    if row(new.id,new.requirement_id,new.task_id,new.evidence_type,new.storage_path,new.file_name,new.mime_type,new.size_bytes,new.value_text,new.value_url,new.submitted_by,new.created_at)
       is distinct from row(old.id,old.requirement_id,old.task_id,old.evidence_type,old.storage_path,old.file_name,old.mime_type,old.size_bytes,old.value_text,old.value_url,old.submitted_by,old.created_at) then
      raise exception 'Submitted evidence is immutable';
    end if;
    if old.deleted_at is not null or new.deleted_at is null then raise exception 'Evidence may only be soft deleted once'; end if;
    select t.status into task_status from public.project_tasks t where t.id=old.task_id;
    if task_status='completed' then raise exception 'Evidence cannot be deleted while the task is completed'; end if;
    new.deleted_by := (select auth.uid());
    return new;
  end if;
  select * into requirement from public.task_evidence_requirements r where r.id=new.requirement_id;
  if requirement.id is null or requirement.task_id<>new.task_id or requirement.evidence_type<>new.evidence_type then raise exception 'Evidence does not match its requirement'; end if;
  select t.status into task_status from public.project_tasks t where t.id=new.task_id;
  if task_status='completed' then raise exception 'Evidence cannot be submitted while the task is completed'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(new.requirement_id::text, 0));
  select count(*) into active_count from public.task_evidence e where e.requirement_id=new.requirement_id and e.deleted_at is null;
  if active_count >= requirement.max_count then raise exception 'Maximum evidence count reached'; end if;
  if new.evidence_type='url' then
    new.value_url := trim(new.value_url);
    if new.value_url !~* '^https://[^[:space:]]+$' or char_length(new.value_url)>2000 then raise exception 'Evidence URL must use HTTPS'; end if;
  elsif new.evidence_type='text' then
    new.value_text := trim(new.value_text);
    if char_length(new.value_text) not between 1 and 5000 then raise exception 'Evidence text must contain 1 to 5000 characters'; end if;
  else
    new.file_name := trim(new.file_name);
    if char_length(new.file_name) not between 1 and 255 or new.size_bytes <= 0 or new.size_bytes > 52428800 then raise exception 'Invalid evidence file'; end if;
    if new.evidence_type='image' and (new.mime_type not in ('image/jpeg','image/png','image/webp') or new.size_bytes>20971520) then raise exception 'Invalid image evidence'; end if;
    if new.evidence_type='video' and new.mime_type not in ('video/mp4','video/webm') then raise exception 'Invalid video evidence'; end if;
    if new.evidence_type='document' and new.mime_type not in ('application/pdf','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','application/vnd.ms-powerpoint','application/vnd.openxmlformats-officedocument.presentationml.presentation','text/csv','text/plain') then raise exception 'Invalid document evidence'; end if;
    select p.id,p.organization_id into project_id_value,organization_id_value from public.project_tasks t join public.projects p on p.id=t.project_id where t.id=new.task_id;
    expected_prefix:=organization_id_value::text||'/'||project_id_value::text||'/evidence/'||new.task_id::text||'/'||new.id::text||'/';
    if new.storage_path not like expected_prefix||'%' or position('/' in substring(new.storage_path from char_length(expected_prefix)+1))>0 then raise exception 'Invalid evidence storage path'; end if;
  end if;
  return new;
end; $$;

create or replace function private.enforce_task_evidence_completion()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status='completed' and (tg_op='INSERT' or old.status<>'completed') then
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(r.id::text, 0))
    from public.task_evidence_requirements r where r.task_id=new.id order by r.id;
  end if;
  if new.status='completed' and (tg_op='INSERT' or old.status<>'completed') and exists (
    select 1 from public.task_evidence_requirements r
    where r.task_id=new.id and r.is_required and
      (select count(*) from public.task_evidence e where e.requirement_id=r.id and e.deleted_at is null) < r.min_count
  ) then raise exception 'Required evidence is incomplete'; end if;
  return new;
end; $$;

create trigger validate_task_evidence_requirement_trigger before insert or update on public.task_evidence_requirements for each row execute function private.validate_task_evidence_requirement();
create trigger block_completed_task_requirement_delete_trigger before delete on public.task_evidence_requirements for each row execute function private.block_completed_task_requirement_delete();
create trigger set_task_evidence_requirements_updated_at before update on public.task_evidence_requirements for each row execute function public.set_updated_at();
create trigger validate_task_evidence_trigger before insert or update on public.task_evidence for each row execute function private.validate_task_evidence();
create trigger enforce_task_evidence_completion_trigger before insert or update of status on public.project_tasks for each row execute function private.enforce_task_evidence_completion();

create or replace function private.record_task_evidence_activity()
returns trigger language plpgsql security definer set search_path = '' as $$
declare event_name text; project_id_value uuid; label_value text;
begin
  select t.project_id into project_id_value from public.project_tasks t where t.id=coalesce(new.task_id,old.task_id);
  if tg_table_name='task_evidence_requirements' then
    label_value:=coalesce(new.label,old.label);
    event_name:=case tg_op when 'INSERT' then 'evidence_requirement_added' when 'DELETE' then 'evidence_requirement_removed' else 'evidence_requirement_updated' end;
  else
    select r.label into label_value from public.task_evidence_requirements r where r.id=coalesce(new.requirement_id,old.requirement_id);
    if tg_op='INSERT' then event_name:='evidence_submitted';
    elsif old.deleted_at is null and new.deleted_at is not null then event_name:='evidence_removed'; else return coalesce(new,old); end if;
  end if;
  insert into public.project_activity(project_id,actor_id,event_type,entity_type,entity_id,payload)
  values(project_id_value,(select auth.uid()),event_name,case when tg_table_name='task_evidence_requirements' then 'evidence_requirement' else 'task_evidence' end,
    coalesce(new.id,old.id)::text,jsonb_build_object('task_id',coalesce(new.task_id,old.task_id),'label',label_value,'evidence_type',coalesce(new.evidence_type,old.evidence_type)));
  return coalesce(new,old);
end; $$;
create trigger record_evidence_requirement_activity_trigger after insert or update or delete on public.task_evidence_requirements for each row execute function private.record_task_evidence_activity();
create trigger record_task_evidence_activity_trigger after insert or update on public.task_evidence for each row execute function private.record_task_evidence_activity();

create or replace function public.authorize_task_evidence_object(object_name text, requested_operation text, object_owner uuid default null)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare parts text[]; org_id uuid; project_id_value uuid; task_id_value uuid; evidence_id_value uuid; caller uuid:=(select auth.uid());
begin
  if caller is null or requested_operation not in ('read','upload','delete') then return false; end if;
  parts:=string_to_array(object_name,'/');
  if array_length(parts,1)<>7 or parts[3]<>'evidence' or parts[7]='' or char_length(parts[7])>180 then return false; end if;
  begin org_id:=parts[1]::uuid; project_id_value:=parts[2]::uuid; task_id_value:=parts[4]::uuid; evidence_id_value:=parts[6]::uuid;
  exception when invalid_text_representation then return false; end;
  if not exists(select 1 from public.project_tasks t join public.projects p on p.id=t.project_id where t.id=task_id_value and p.id=project_id_value and p.organization_id=org_id and org_id=(select public.current_user_organization_id())) then return false; end if;
  if requested_operation='read' then return true; end if;
  if requested_operation='upload' then return public.can_submit_task_evidence(task_id_value); end if;
  return exists(select 1 from public.task_evidence e where e.id=evidence_id_value and e.task_id=task_id_value and e.storage_path=object_name and e.deleted_at is null and public.can_delete_task_evidence(e.id))
    or (object_owner=caller and public.can_submit_task_evidence(task_id_value) and not exists(select 1 from public.task_evidence e where e.storage_path=object_name));
end; $$;
revoke all on function public.authorize_task_evidence_object(text,text,uuid) from public,anon;
grant execute on function public.authorize_task_evidence_object(text,text,uuid) to authenticated;

create policy "Task evidence objects are readable in the active organization" on storage.objects for select to authenticated
using (bucket_id='project-files' and public.authorize_task_evidence_object(name,'read',owner));
create policy "Project participants upload task evidence objects" on storage.objects for insert to authenticated
with check (bucket_id='project-files' and public.authorize_task_evidence_object(name,'upload',owner));
create policy "Task evidence submitters and managers delete objects" on storage.objects for delete to authenticated
using (bucket_id='project-files' and public.authorize_task_evidence_object(name,'delete',owner));

update storage.buckets set allowed_mime_types=array[
  'application/pdf','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation','text/csv','text/plain',
  'image/jpeg','image/png','image/webp','video/mp4','video/webm'
] where id='project-files';

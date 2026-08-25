-- CEREBRO V2 BLOQUE 1: governed document versions and asynchronous extraction.
-- No binary object is copied, renamed, downloaded, or processed by this migration.

do $$
begin
  if exists (
    select 1
    from public.knowledge_documents as document
    left join storage.objects as object
      on object.bucket_id = 'knowledge-base'
     and object.name = document.file_path
    where object.id is null
  ) then
    raise exception 'Cannot prepare Cerebro: a knowledge document has no Storage object';
  end if;

  if exists (
    select 1
    from storage.objects as object
    left join public.knowledge_documents as document on document.file_path = object.name
    where object.bucket_id = 'knowledge-base'
      and document.id is null
  ) then
    raise exception 'Cannot prepare Cerebro: knowledge-base contains an orphan object';
  end if;
end;
$$;

alter table public.knowledge_documents
  add constraint knowledge_documents_organization_id_id_key
  unique (organization_id, id);

create table public.knowledge_document_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  document_id uuid not null,
  version_number integer not null check (version_number > 0),
  file_path text not null unique,
  file_name text not null,
  mime_type text,
  file_size bigint check (file_size is null or file_size >= 0),
  created_by uuid not null references public.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  status text not null default 'draft'
    check (status in ('draft', 'review', 'approved', 'archived')),
  submitted_for_review_at timestamptz,
  submitted_by uuid references public.users(id) on delete set null,
  approved_at timestamptz,
  approved_by uuid references public.users(id) on delete set null,
  extraction_status text not null default 'pending'
    check (extraction_status in ('pending', 'processing', 'completed', 'failed')),
  extraction_error text,
  extracted_text text,
  extracted_at timestamptz,
  extractor_version text,
  checksum_sha256 text check (checksum_sha256 is null or checksum_sha256 ~ '^[0-9a-f]{64}$'),
  processing_attempts integer not null default 0 check (processing_attempts >= 0),
  processing_token uuid,
  processing_started_at timestamptz,
  next_retry_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint knowledge_document_versions_document_fkey
    foreign key (organization_id, document_id)
    references public.knowledge_documents (organization_id, id)
    on delete cascade,
  constraint knowledge_document_versions_document_number_key
    unique (document_id, version_number),
  constraint knowledge_document_versions_organization_id_id_key
    unique (organization_id, id),
  constraint knowledge_document_versions_review_metadata_check
    check (status <> 'review' or (submitted_for_review_at is not null and submitted_by is not null)),
  constraint knowledge_document_versions_approval_metadata_check
    check (status <> 'approved' or (approved_at is not null and approved_by is not null)),
  constraint knowledge_document_versions_completed_extraction_check
    check (
      extraction_status <> 'completed'
      or (
        extracted_text is not null
        and extracted_at is not null
        and extractor_version is not null
        and checksum_sha256 is not null
      )
    ),
  constraint knowledge_document_versions_failed_extraction_check
    check (extraction_status <> 'failed' or extraction_error is not null)
);

create index knowledge_document_versions_org_document_idx
  on public.knowledge_document_versions (organization_id, document_id, version_number desc);

create index knowledge_document_versions_org_extraction_idx
  on public.knowledge_document_versions (organization_id, extraction_status, next_retry_at);

create index knowledge_document_versions_org_checksum_idx
  on public.knowledge_document_versions (organization_id, checksum_sha256)
  where checksum_sha256 is not null;

create index knowledge_document_versions_created_by_idx
  on public.knowledge_document_versions (created_by);

-- Existing metadata becomes version 1 without copying the associated object.
insert into public.knowledge_document_versions (
  organization_id,
  document_id,
  version_number,
  file_path,
  file_name,
  mime_type,
  file_size,
  created_by,
  created_at,
  status,
  updated_at
)
select
  document.organization_id,
  document.id,
  document.version,
  document.file_path,
  document.file_name,
  document.mime_type,
  document.file_size,
  document.uploaded_by,
  document.created_at,
  document.status,
  document.updated_at
from public.knowledge_documents as document;

alter table public.knowledge_documents
  add column latest_version_id uuid,
  add column current_version_id uuid;

update public.knowledge_documents as document
set latest_version_id = version.id
from public.knowledge_document_versions as version
where version.document_id = document.id
  and version.organization_id = document.organization_id;

alter table public.knowledge_documents
  add constraint knowledge_documents_latest_version_fkey
    foreign key (organization_id, latest_version_id)
    references public.knowledge_document_versions (organization_id, id)
    on delete restrict,
  add constraint knowledge_documents_current_version_fkey
    foreign key (organization_id, current_version_id)
    references public.knowledge_document_versions (organization_id, id)
    on delete set null (current_version_id);

create index knowledge_documents_latest_version_idx
  on public.knowledge_documents (latest_version_id);

create index knowledge_documents_current_version_idx
  on public.knowledge_documents (current_version_id)
  where current_version_id is not null;

alter table public.knowledge_document_versions enable row level security;

create policy "Members read organization knowledge versions"
on public.knowledge_document_versions
for select
to authenticated
using (organization_id = (select public.current_user_organization_id()));

revoke all on table public.knowledge_document_versions from public;
revoke all on table public.knowledge_document_versions from anon;
revoke all on table public.knowledge_document_versions from authenticated;
grant select on table public.knowledge_document_versions to authenticated;
grant select, insert, update, delete on table public.knowledge_document_versions to service_role;

-- Keep direct document edits limited to logical metadata. Version/file/workflow
-- fields are maintained only by the controlled functions below.
revoke insert, delete, update on table public.knowledge_documents from authenticated;
grant update (
  title,
  document_type,
  division,
  description,
  updated_at,
  division_id,
  folder_id,
  category,
  tags,
  author_name
) on table public.knowledge_documents to authenticated;

create or replace function public.register_knowledge_document_version(
  target_document_id uuid,
  target_title text,
  target_document_type text,
  target_division_id uuid,
  target_folder_id uuid,
  target_category text,
  target_tags text[],
  target_author_name text,
  target_file_path text,
  target_file_name text,
  target_mime_type text,
  target_file_size bigint
)
returns table (document_id uuid, version_id uuid, version_number integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  caller_organization_id uuid := public.current_user_organization_id();
  selected_document public.knowledge_documents%rowtype;
  existing_version public.knowledge_document_versions%rowtype;
  created_document_id uuid;
  created_version_id uuid;
  next_version_number integer;
begin
  if caller_id is null or caller_organization_id is null
     or not public.can_manage_organization(caller_organization_id) then
    raise exception 'Not authorized to register knowledge versions' using errcode = '42501';
  end if;

  if target_file_path is null
     or target_file_path not like caller_organization_id::text || '/%'
     or nullif(btrim(target_file_name), '') is null
     or target_file_size is null
     or target_file_size < 0
     or target_file_size > 52428800 then
    raise exception 'Invalid knowledge file metadata' using errcode = '22023';
  end if;

  select version.*
  into existing_version
  from public.knowledge_document_versions as version
  where version.file_path = target_file_path;

  if found then
    if existing_version.organization_id <> caller_organization_id
       or existing_version.created_by <> caller_id then
      raise exception 'Knowledge file path is already registered' using errcode = '23505';
    end if;
    return query
      select existing_version.document_id, existing_version.id, existing_version.version_number;
    return;
  end if;

  if target_document_id is null then
    insert into public.knowledge_documents (
      organization_id,
      uploaded_by,
      title,
      document_type,
      description,
      file_path,
      file_name,
      mime_type,
      file_size,
      status,
      division_id,
      folder_id,
      category,
      version,
      tags,
      author_name
    ) values (
      caller_organization_id,
      caller_id,
      target_title,
      target_document_type,
      null,
      target_file_path,
      target_file_name,
      target_mime_type,
      target_file_size,
      'draft',
      target_division_id,
      target_folder_id,
      nullif(btrim(target_category), ''),
      1,
      coalesce(target_tags, '{}'::text[]),
      nullif(btrim(target_author_name), '')
    )
    returning id into created_document_id;

    next_version_number := 1;
  else
    select document.*
    into selected_document
    from public.knowledge_documents as document
    where document.id = target_document_id
      and document.organization_id = caller_organization_id
    for update;

    if not found then
      raise exception 'Knowledge document not found' using errcode = 'P0002';
    end if;

    created_document_id := selected_document.id;

    select coalesce(max(existing.version_number), 0) + 1
    into next_version_number
    from public.knowledge_document_versions as existing
    where existing.document_id = selected_document.id;
  end if;

  insert into public.knowledge_document_versions (
    organization_id,
    document_id,
    version_number,
    file_path,
    file_name,
    mime_type,
    file_size,
    created_by,
    status
  ) values (
    caller_organization_id,
    created_document_id,
    next_version_number,
    target_file_path,
    target_file_name,
    target_mime_type,
    target_file_size,
    caller_id,
    'draft'
  )
  returning id into created_version_id;

  update public.knowledge_documents
  set latest_version_id = created_version_id,
      file_path = target_file_path,
      file_name = target_file_name,
      mime_type = target_mime_type,
      file_size = target_file_size,
      status = 'draft',
      version = next_version_number,
      updated_at = now()
  where id = created_document_id;

  return query select created_document_id, created_version_id, next_version_number;
end;
$$;

revoke all on function public.register_knowledge_document_version(
  uuid, text, text, uuid, uuid, text, text[], text, text, text, text, bigint
) from public;
revoke all on function public.register_knowledge_document_version(
  uuid, text, text, uuid, uuid, text, text[], text, text, text, text, bigint
) from anon;
grant execute on function public.register_knowledge_document_version(
  uuid, text, text, uuid, uuid, text, text[], text, text, text, text, bigint
) to authenticated;

create or replace function public.transition_knowledge_document_version(
  target_version_id uuid,
  target_status text
)
returns public.knowledge_document_versions
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  selected_version public.knowledge_document_versions%rowtype;
  selected_document public.knowledge_documents%rowtype;
  transitioned_version public.knowledge_document_versions%rowtype;
begin
  if caller_id is null or target_status is null
     or target_status not in ('draft', 'review', 'approved', 'archived') then
    raise exception 'Invalid knowledge workflow request' using errcode = '22023';
  end if;

  select version.*
  into selected_version
  from public.knowledge_document_versions as version
  where version.id = target_version_id
  for update;

  if not found or not public.can_manage_organization(selected_version.organization_id) then
    raise exception 'Not authorized to transition this knowledge version' using errcode = '42501';
  end if;

  select document.*
  into selected_document
  from public.knowledge_documents as document
  where document.id = selected_version.document_id
    and document.organization_id = selected_version.organization_id
  for update;

  if selected_version.status = target_status then
    return selected_version;
  end if;

  if not (
    (selected_version.status = 'draft' and target_status in ('review', 'archived'))
    or (selected_version.status = 'review' and target_status in ('draft', 'approved', 'archived'))
    or (selected_version.status = 'approved' and target_status = 'archived')
  ) then
    raise exception 'Invalid knowledge workflow transition: % -> %', selected_version.status, target_status
      using errcode = '22023';
  end if;

  if target_status = 'approved' then
    if selected_document.current_version_id is not null
       and selected_document.current_version_id <> selected_version.id then
      update public.knowledge_document_versions
      set status = 'archived', updated_at = now()
      where id = selected_document.current_version_id
        and organization_id = selected_version.organization_id;
    end if;

    update public.knowledge_document_versions
    set status = 'approved',
        approved_at = now(),
        approved_by = caller_id,
        updated_at = now()
    where id = selected_version.id
    returning * into transitioned_version;

    update public.knowledge_documents
    set current_version_id = selected_version.id,
        status = case when latest_version_id = selected_version.id then 'approved' else status end,
        updated_at = now()
    where id = selected_document.id;
  elsif target_status = 'review' then
    update public.knowledge_document_versions
    set status = 'review',
        submitted_for_review_at = now(),
        submitted_by = caller_id,
        approved_at = null,
        approved_by = null,
        updated_at = now()
    where id = selected_version.id
    returning * into transitioned_version;
  else
    update public.knowledge_document_versions
    set status = target_status,
        approved_at = case when target_status = 'draft' then null else approved_at end,
        approved_by = case when target_status = 'draft' then null else approved_by end,
        updated_at = now()
    where id = selected_version.id
    returning * into transitioned_version;

    if selected_document.current_version_id = selected_version.id then
      update public.knowledge_documents
      set current_version_id = null, updated_at = now()
      where id = selected_document.id;
    end if;
  end if;

  if selected_document.latest_version_id = selected_version.id and target_status <> 'approved' then
    update public.knowledge_documents
    set status = target_status, updated_at = now()
    where id = selected_document.id;
  end if;

  return transitioned_version;
end;
$$;

revoke all on function public.transition_knowledge_document_version(uuid, text) from public;
revoke all on function public.transition_knowledge_document_version(uuid, text) from anon;
grant execute on function public.transition_knowledge_document_version(uuid, text) to authenticated;

create or replace function public.retry_knowledge_document_extraction(target_version_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  version_organization_id uuid;
begin
  select organization_id into version_organization_id
  from public.knowledge_document_versions
  where id = target_version_id;

  if (select auth.uid()) is null
     or version_organization_id is null
     or not public.can_manage_organization(version_organization_id) then
    raise exception 'Not authorized to retry knowledge extraction' using errcode = '42501';
  end if;

  update public.knowledge_document_versions
  set extraction_status = 'pending',
      extraction_error = null,
      processing_attempts = 0,
      processing_token = null,
      processing_started_at = null,
      next_retry_at = null,
      updated_at = now()
  where id = target_version_id
    and extraction_status = 'failed';
end;
$$;

revoke all on function public.retry_knowledge_document_extraction(uuid) from public;
revoke all on function public.retry_knowledge_document_extraction(uuid) from anon;
grant execute on function public.retry_knowledge_document_extraction(uuid) to authenticated;

create or replace function public.claim_knowledge_document_extraction(
  target_version_id uuid,
  target_processing_token uuid
)
returns table (
  version_id uuid,
  organization_id uuid,
  file_path text,
  file_name text,
  mime_type text,
  file_size bigint,
  processing_attempts integer
)
language sql
security definer
set search_path = ''
as $$
  update public.knowledge_document_versions as version
  set extraction_status = 'processing',
      extraction_error = null,
      processing_token = target_processing_token,
      processing_started_at = now(),
      processing_attempts = version.processing_attempts + 1,
      updated_at = now()
  where version.id = target_version_id
    and version.processing_attempts < 5
    and (
      version.extraction_status = 'pending'
      or (
        version.extraction_status = 'failed'
        and (version.next_retry_at is null or version.next_retry_at <= now())
      )
      or (
        version.extraction_status = 'processing'
        and version.processing_started_at < now() - interval '15 minutes'
      )
    )
  returning version.id, version.organization_id, version.file_path, version.file_name,
            version.mime_type, version.file_size, version.processing_attempts;
$$;

revoke all on function public.claim_knowledge_document_extraction(uuid, uuid) from public;
revoke all on function public.claim_knowledge_document_extraction(uuid, uuid) from anon;
revoke all on function public.claim_knowledge_document_extraction(uuid, uuid) from authenticated;
grant execute on function public.claim_knowledge_document_extraction(uuid, uuid) to service_role;

create or replace function public.complete_knowledge_document_extraction(
  target_version_id uuid,
  target_processing_token uuid,
  target_checksum_sha256 text,
  target_extracted_text text,
  target_extractor_version text
)
returns boolean
language sql
security definer
set search_path = ''
as $$
  with completed as (
    update public.knowledge_document_versions as version
    set extraction_status = 'completed',
        extraction_error = null,
        extracted_text = target_extracted_text,
        extracted_at = now(),
        extractor_version = target_extractor_version,
        checksum_sha256 = target_checksum_sha256,
        processing_token = null,
        processing_started_at = null,
        next_retry_at = null,
        updated_at = now()
    where version.id = target_version_id
      and version.extraction_status = 'processing'
      and version.processing_token = target_processing_token
    returning 1
  )
  select exists (select 1 from completed);
$$;

revoke all on function public.complete_knowledge_document_extraction(uuid, uuid, text, text, text) from public;
revoke all on function public.complete_knowledge_document_extraction(uuid, uuid, text, text, text) from anon;
revoke all on function public.complete_knowledge_document_extraction(uuid, uuid, text, text, text) from authenticated;
grant execute on function public.complete_knowledge_document_extraction(uuid, uuid, text, text, text) to service_role;

create or replace function public.fail_knowledge_document_extraction(
  target_version_id uuid,
  target_processing_token uuid,
  target_error text,
  target_checksum_sha256 text
)
returns boolean
language sql
security definer
set search_path = ''
as $$
  with failed as (
    update public.knowledge_document_versions as version
    set extraction_status = 'failed',
        extraction_error = left(coalesce(nullif(target_error, ''), 'Unknown extraction error'), 2000),
        checksum_sha256 = coalesce(target_checksum_sha256, version.checksum_sha256),
        processing_token = null,
        processing_started_at = null,
        next_retry_at = now() + pg_catalog.make_interval(
          mins => least(60, pg_catalog.power(2, greatest(1, version.processing_attempts))::integer)
        ),
        updated_at = now()
    where version.id = target_version_id
      and version.extraction_status = 'processing'
      and version.processing_token = target_processing_token
    returning 1
  )
  select exists (select 1 from failed);
$$;

revoke all on function public.fail_knowledge_document_extraction(uuid, uuid, text, text) from public;
revoke all on function public.fail_knowledge_document_extraction(uuid, uuid, text, text) from anon;
revoke all on function public.fail_knowledge_document_extraction(uuid, uuid, text, text) from authenticated;
grant execute on function public.fail_knowledge_document_extraction(uuid, uuid, text, text) to service_role;

create view public.knowledge_approved_current_versions
with (security_invoker = true)
as
select
  document.id as document_id,
  document.organization_id,
  document.title,
  document.document_type,
  document.division_id,
  document.folder_id,
  document.category,
  document.tags,
  version.id as version_id,
  version.version_number,
  version.file_path,
  version.file_name,
  version.mime_type,
  version.status,
  version.approved_at,
  version.approved_by,
  version.extraction_status,
  version.extracted_text,
  version.extracted_at,
  version.extractor_version,
  version.checksum_sha256
from public.knowledge_documents as document
join public.knowledge_document_versions as version
  on version.id = document.current_version_id
 and version.organization_id = document.organization_id
where version.status = 'approved'
  and version.extraction_status = 'completed';

revoke all on table public.knowledge_approved_current_versions from public;
revoke all on table public.knowledge_approved_current_versions from anon;
grant select on table public.knowledge_approved_current_versions to authenticated;

comment on table public.knowledge_document_versions is
  'Immutable file versions and governed extracted content for logical Cerebro documents.';
comment on view public.knowledge_approved_current_versions is
  'Current approved and successfully extracted knowledge eligible for future ORVESEN IA retrieval.';

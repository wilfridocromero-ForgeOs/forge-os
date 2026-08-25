-- CEREBRO V2 BLOQUE A: deterministic chunks derived from exact document versions.
-- This migration does not enable pgvector, create embeddings, or enqueue backfill.

alter table public.knowledge_document_versions
  add constraint knowledge_document_versions_org_document_version_key
    unique (organization_id, document_id, id),
  add column chunking_status text not null default 'pending'
    check (chunking_status in ('pending', 'processing', 'completed', 'failed')),
  add column chunking_attempts integer not null default 0
    check (chunking_attempts >= 0),
  add column chunking_started_at timestamptz,
  add column chunking_token uuid,
  add column chunking_error text,
  add column chunked_at timestamptz,
  add column chunker_version text,
  add column chunking_next_retry_at timestamptz,
  add constraint knowledge_document_versions_chunking_processing_check
    check (
      chunking_status <> 'processing'
      or (chunking_started_at is not null and chunking_token is not null)
    ),
  add constraint knowledge_document_versions_chunking_completed_check
    check (
      chunking_status <> 'completed'
      or (
        chunked_at is not null
        and nullif(btrim(chunker_version), '') is not null
        and chunking_token is null
        and chunking_error is null
      )
    ),
  add constraint knowledge_document_versions_chunking_failed_check
    check (chunking_status <> 'failed' or chunking_error is not null);

create index knowledge_document_versions_org_chunking_idx
  on public.knowledge_document_versions (
    organization_id,
    chunking_status,
    chunking_next_retry_at
  );

create table public.knowledge_document_chunks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  document_id uuid not null,
  version_id uuid not null,
  chunk_index integer not null check (chunk_index >= 0),
  content text not null check (nullif(btrim(content), '') is not null),
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  source_checksum_sha256 text not null
    check (source_checksum_sha256 ~ '^[0-9a-f]{64}$'),
  token_count integer not null check (token_count between 1 and 800),
  heading_path text[] not null default '{}'::text[],
  source_start integer,
  source_end integer,
  metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object'),
  chunker_version text not null
    check (char_length(btrim(chunker_version)) between 1 and 100),
  created_at timestamptz not null default now(),
  constraint knowledge_document_chunks_source_range_check
    check (
      (source_start is null and source_end is null)
      or (
        source_start is not null
        and source_end is not null
        and source_start >= 0
        and source_end > source_start
      )
    ),
  constraint knowledge_document_chunks_version_fkey
    foreign key (organization_id, document_id, version_id)
    references public.knowledge_document_versions (organization_id, document_id, id)
    on delete cascade,
  constraint knowledge_document_chunks_generation_index_key
    unique (version_id, chunker_version, chunk_index),
  constraint knowledge_document_chunks_organization_id_id_key
    unique (organization_id, id)
);

create index knowledge_document_chunks_org_document_version_idx
  on public.knowledge_document_chunks (organization_id, document_id, version_id, chunk_index);

create index knowledge_document_chunks_version_generation_idx
  on public.knowledge_document_chunks (version_id, chunker_version, chunk_index);

alter table public.knowledge_document_chunks enable row level security;

create policy "Members read organization knowledge chunks"
on public.knowledge_document_chunks
for select
to authenticated
using (organization_id = (select public.current_user_organization_id()));

revoke all on table public.knowledge_document_chunks from public;
revoke all on table public.knowledge_document_chunks from anon;
revoke all on table public.knowledge_document_chunks from authenticated;
grant select on table public.knowledge_document_chunks to authenticated;
grant select, insert, update, delete on table public.knowledge_document_chunks to service_role;

create or replace function public.claim_knowledge_document_chunking(
  target_version_id uuid,
  target_chunking_token uuid,
  target_chunker_version text
)
returns table (
  version_id uuid,
  organization_id uuid,
  document_id uuid,
  extracted_text text,
  extraction_checksum_sha256 text,
  chunking_attempts integer
)
language sql
security definer
set search_path = ''
as $$
  update public.knowledge_document_versions as version
  set chunking_status = 'processing',
      chunking_error = null,
      chunking_token = target_chunking_token,
      chunking_started_at = now(),
      chunking_attempts = case
        when version.chunker_version is distinct from btrim(target_chunker_version) then 1
        else version.chunking_attempts + 1
      end,
      chunker_version = btrim(target_chunker_version),
      chunking_next_retry_at = null,
      updated_at = now()
  where version.id = target_version_id
    and version.extraction_status = 'completed'
    and nullif(btrim(version.extracted_text), '') is not null
    and nullif(btrim(target_chunker_version), '') is not null
    and char_length(btrim(target_chunker_version)) <= 100
    and (
      version.chunker_version is distinct from btrim(target_chunker_version)
      or version.chunking_attempts < 5
    )
    and (
      version.chunking_status = 'pending'
      or (
        version.chunking_status = 'failed'
        and (
          version.chunking_next_retry_at is null
          or version.chunking_next_retry_at <= now()
        )
      )
      or (
        version.chunking_status = 'processing'
        and version.chunking_started_at < now() - interval '15 minutes'
      )
      or (
        version.chunking_status = 'completed'
        and version.chunker_version is distinct from btrim(target_chunker_version)
      )
    )
  returning
    version.id,
    version.organization_id,
    version.document_id,
    version.extracted_text,
    version.checksum_sha256,
    version.chunking_attempts;
$$;

revoke all on function public.claim_knowledge_document_chunking(uuid, uuid, text) from public;
revoke all on function public.claim_knowledge_document_chunking(uuid, uuid, text) from anon;
revoke all on function public.claim_knowledge_document_chunking(uuid, uuid, text) from authenticated;
grant execute on function public.claim_knowledge_document_chunking(uuid, uuid, text) to service_role;

create or replace function public.complete_knowledge_document_chunking(
  target_version_id uuid,
  target_chunking_token uuid,
  target_chunker_version text,
  target_chunks jsonb
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  selected_version public.knowledge_document_versions%rowtype;
  chunk_count integer;
begin
  if jsonb_typeof(target_chunks) <> 'array' then
    raise exception 'Chunks must be a JSON array' using errcode = '22023';
  end if;

  chunk_count := jsonb_array_length(target_chunks);
  if chunk_count < 1 or chunk_count > 10000 then
    raise exception 'Chunk count must be between 1 and 10000' using errcode = '22023';
  end if;

  select version.*
  into selected_version
  from public.knowledge_document_versions as version
  where version.id = target_version_id
    and version.extraction_status = 'completed'
    and version.chunking_status = 'processing'
    and version.chunking_token = target_chunking_token
  for update;

  if not found then
    return false;
  end if;

  if nullif(btrim(target_chunker_version), '') is null
     or char_length(btrim(target_chunker_version)) > 100 then
    raise exception 'Invalid chunker version' using errcode = '22023';
  end if;

  if selected_version.chunker_version is distinct from btrim(target_chunker_version) then
    raise exception 'Chunker version does not match the active lease' using errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(target_chunks) as chunk (
      chunk_index integer,
      content text,
      content_hash text,
      token_count integer,
      heading_path text[],
      source_start integer,
      source_end integer,
      metadata jsonb
    )
    where chunk.chunk_index is null
       or chunk.chunk_index < 0
       or nullif(btrim(chunk.content), '') is null
       or chunk.content_hash is null
       or chunk.content_hash !~ '^[0-9a-f]{64}$'
       or chunk.token_count is null
       or chunk.token_count not between 1 and 800
       or (chunk.source_start is null) <> (chunk.source_end is null)
       or (chunk.source_start is not null and (chunk.source_start < 0 or chunk.source_end <= chunk.source_start))
       or chunk.metadata is null
       or jsonb_typeof(chunk.metadata) <> 'object'
  ) then
    raise exception 'Invalid chunk payload' using errcode = '22023';
  end if;

  if (
    select count(distinct chunk.chunk_index)
    from jsonb_to_recordset(target_chunks) as chunk (chunk_index integer)
  ) <> chunk_count
  or (
    select min(chunk.chunk_index) <> 0 or max(chunk.chunk_index) <> chunk_count - 1
    from jsonb_to_recordset(target_chunks) as chunk (chunk_index integer)
  ) then
    raise exception 'Chunk indexes must be contiguous and unique from zero' using errcode = '22023';
  end if;

  insert into public.knowledge_document_chunks (
    organization_id,
    document_id,
    version_id,
    chunk_index,
    content,
    content_hash,
    source_checksum_sha256,
    token_count,
    heading_path,
    source_start,
    source_end,
    metadata,
    chunker_version
  )
  select
    selected_version.organization_id,
    selected_version.document_id,
    selected_version.id,
    chunk.chunk_index,
    chunk.content,
    chunk.content_hash,
    selected_version.checksum_sha256,
    chunk.token_count,
    coalesce(chunk.heading_path, '{}'::text[]),
    chunk.source_start,
    chunk.source_end,
    chunk.metadata,
    btrim(target_chunker_version)
  from jsonb_to_recordset(target_chunks) as chunk (
    chunk_index integer,
    content text,
    content_hash text,
    token_count integer,
    heading_path text[],
    source_start integer,
    source_end integer,
    metadata jsonb
  )
  order by chunk.chunk_index
  on conflict (version_id, chunker_version, chunk_index)
  do update set
    content = excluded.content,
    content_hash = excluded.content_hash,
    source_checksum_sha256 = excluded.source_checksum_sha256,
    token_count = excluded.token_count,
    heading_path = excluded.heading_path,
    source_start = excluded.source_start,
    source_end = excluded.source_end,
    metadata = excluded.metadata;

  delete from public.knowledge_document_chunks as chunk
  where chunk.version_id = selected_version.id
    and chunk.chunker_version = btrim(target_chunker_version)
    and chunk.chunk_index >= chunk_count;

  update public.knowledge_document_versions
  set chunking_status = 'completed',
      chunking_error = null,
      chunked_at = now(),
      chunker_version = btrim(target_chunker_version),
      chunking_token = null,
      chunking_started_at = null,
      chunking_next_retry_at = null,
      updated_at = now()
  where id = selected_version.id;

  return true;
end;
$$;

revoke all on function public.complete_knowledge_document_chunking(uuid, uuid, text, jsonb) from public;
revoke all on function public.complete_knowledge_document_chunking(uuid, uuid, text, jsonb) from anon;
revoke all on function public.complete_knowledge_document_chunking(uuid, uuid, text, jsonb) from authenticated;
grant execute on function public.complete_knowledge_document_chunking(uuid, uuid, text, jsonb) to service_role;

create or replace function public.fail_knowledge_document_chunking(
  target_version_id uuid,
  target_chunking_token uuid,
  target_error text
)
returns boolean
language sql
security definer
set search_path = ''
as $$
  with failed as (
    update public.knowledge_document_versions as version
    set chunking_status = 'failed',
        chunking_error = left(coalesce(nullif(target_error, ''), 'Unknown chunking error'), 2000),
        chunking_token = null,
        chunking_started_at = null,
        chunking_next_retry_at = now() + pg_catalog.make_interval(
          mins => least(60, pg_catalog.power(2, greatest(1, version.chunking_attempts))::integer)
        ),
        updated_at = now()
    where version.id = target_version_id
      and version.chunking_status = 'processing'
      and version.chunking_token = target_chunking_token
    returning 1
  )
  select exists (select 1 from failed);
$$;

revoke all on function public.fail_knowledge_document_chunking(uuid, uuid, text) from public;
revoke all on function public.fail_knowledge_document_chunking(uuid, uuid, text) from anon;
revoke all on function public.fail_knowledge_document_chunking(uuid, uuid, text) from authenticated;
grant execute on function public.fail_knowledge_document_chunking(uuid, uuid, text) to service_role;

comment on table public.knowledge_document_chunks is
  'Deterministic, version-scoped Cerebro chunks. Historical generations remain isolated by version_id and chunker_version.';

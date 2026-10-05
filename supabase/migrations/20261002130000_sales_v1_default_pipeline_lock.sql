-- ORVESEN Sales V1 - forward fix M1 for Increment 1: serialize the first
-- creation of an organization's default pipeline.
--
-- Defect (Increment 1, 20261002120000): sales_ensure_default_pipeline relied on
-- INSERT ... ON CONFLICT (organization_id) WHERE is_default DO NOTHING. ON
-- CONFLICT only arbitrates that index, so a concurrent first caller could
-- instead collide on sales_pipelines_active_name_idx and receive a raw 23505.
-- Integrity was never at risk (still exactly one default pipeline); the caller
-- got an error instead of the existing pipeline.
--
-- Fix: when no default pipeline is visible, take one deterministic
-- per-organization transaction advisory lock, re-check, and create only if it
-- is still absent. Everything else is unchanged: signature, authorization
-- (manage_pipeline, founder/admin only), canonical stages, audit event and
-- SALES_* errors. The ON CONFLICT clause stays as a backstop.
--
-- Guarded: the function is replaced only if its current definition is exactly
-- the Increment 1 definition; otherwise SALES_MIGRATION_DRIFT aborts the whole
-- migration. Only this one function changes. No CASCADE. ASCII only.

do $guard$
declare
  current_row record;
begin
  select pg_catalog.md5(replace(proc.prosrc, chr(13), '')) as body_md5,
         proc.prosecdef,
         coalesce(proc.proconfig, '{}') as config,
         pg_catalog.pg_get_userbyid(proc.proowner)::text as owner,
         pg_catalog.pg_get_function_result(proc.oid) as result,
         proc.provolatile::text as volatility
  into current_row
  from pg_catalog.pg_proc as proc
  where proc.oid = pg_catalog.to_regprocedure('public.sales_ensure_default_pipeline()');

  if current_row.body_md5 is distinct from '12c3ea7d7a2c4f27dc67baab17104058'
     or current_row.prosecdef is distinct from true
     or current_row.config is distinct from array['search_path=""']
     or current_row.owner is distinct from 'postgres'
     or current_row.result is distinct from 'jsonb'
     or current_row.volatility is distinct from 'v' then
    raise exception using errcode = '55000', message = 'SALES_MIGRATION_DRIFT',
      detail = 'public.sales_ensure_default_pipeline is not the exact Increment 1 definition';
  end if;
end;
$guard$;

-- Idempotent and concurrency-safe. A visible default pipeline is returned
-- without locking. Otherwise first creation is serialized per organization by
-- a transaction advisory lock and re-checked under it; exactly one caller
-- inserts the pipeline and its canonical stages, the rest return that pipeline.
create or replace function public.sales_ensure_default_pipeline()
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  organization uuid := private.sales_require('manage_pipeline');
  actor uuid := (select auth.uid());
  pipeline public.sales_pipelines;
  created boolean := false;
begin
  select * into pipeline
  from public.sales_pipelines as existing
  where existing.organization_id = organization and existing.is_default;

  if pipeline.id is null then
    -- M1: serialize first creation per organization, then re-check under the lock.
    perform pg_advisory_xact_lock(hashtextextended('orvesen.sales.pipelines:' || organization::text, 0));
    select * into pipeline
    from public.sales_pipelines as existing
    where existing.organization_id = organization and existing.is_default;
  end if;

  if pipeline.id is null then
    insert into public.sales_pipelines (organization_id, name, is_default, created_by)
    values (organization, 'Pipeline principal', true, actor)
    on conflict (organization_id) where is_default do nothing
    returning * into pipeline;

    if pipeline.id is not null then
      created := true;
      insert into public.sales_pipeline_stages (
        organization_id, pipeline_id, key, name, kind, default_probability_bps, position, created_by
      )
      select organization, pipeline.id, canonical.key, canonical.name, canonical.kind,
             canonical.probability, canonical.position, actor
      from (values
        ('new', 'Nuevo', 'open', 1000, 1),
        ('qualified', 'Calificado', 'open', 2500, 2),
        ('proposal', 'Propuesta', 'open', 5000, 3),
        ('negotiation', U&'Negociaci\00F3n', 'open', 7500, 4),
        ('won', 'Ganado', 'won', 10000, 5),
        ('lost', 'Perdido', 'lost', 0, 6)
      ) as canonical(key, name, kind, probability, position);

      perform private.sales_write_audit(
        organization, 'sales.pipeline.created', 'pipeline', pipeline.id,
        jsonb_build_object(
          'name', pipeline.name,
          'is_default', true,
          'stages', (
            select jsonb_agg(jsonb_build_object(
              'id', stage.id, 'key', stage.key, 'kind', stage.kind, 'position', stage.position
            ) order by stage.position)
            from public.sales_pipeline_stages as stage
            where stage.pipeline_id = pipeline.id
          )
        )
      );
    else
      select * into pipeline
      from public.sales_pipelines as existing
      where existing.organization_id = organization and existing.is_default;
      if pipeline.id is null then
        raise exception using errcode = '40001', message = 'SALES_RETRY';
      end if;
    end if;
  end if;

  -- Re-read the pipeline so structure_version reflects the inserted stages.
  select * into pipeline from public.sales_pipelines where id = pipeline.id;

  return jsonb_build_object(
    'was_created', created,
    'pipeline', to_jsonb(pipeline),
    'stages', coalesce((
      select jsonb_agg(to_jsonb(stage) order by stage.position)
      from public.sales_pipeline_stages as stage
      where stage.pipeline_id = pipeline.id and stage.status = 'active'
    ), '[]'::jsonb)
  );
end;
$$;

-- Ownership and privileges are preserved by CREATE OR REPLACE; re-asserted
-- here exactly as in Increment 1.
alter function public.sales_ensure_default_pipeline() owner to postgres;
revoke all on function public.sales_ensure_default_pipeline() from public, anon, authenticated, service_role;
grant execute on function public.sales_ensure_default_pipeline() to authenticated;

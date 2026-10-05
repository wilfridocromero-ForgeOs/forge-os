-- ROLLBACK / RECOVERY for forward fix 20261002130000_sales_v1_default_pipeline_lock.
--
-- Restores public.sales_ensure_default_pipeline to the exact Increment 1
-- definition (which has the M1 race). Manual recovery only, for the case where
-- the fix itself misbehaves; never part of the migration chain and never
-- against production without a separate authorization.
--
-- Fails closed: changes nothing unless the function is exactly the M1
-- definition. One transaction, no CASCADE, no data touched. ASCII only.

begin;

do $$
declare
  current_row record;
begin
  select pg_catalog.md5(replace(proc.prosrc, chr(13), '')) as body_md5, proc.prosecdef,
         coalesce(proc.proconfig, '{}') as config, pg_catalog.pg_get_userbyid(proc.proowner)::text as owner
  into current_row
  from pg_catalog.pg_proc as proc
  where proc.oid = pg_catalog.to_regprocedure('public.sales_ensure_default_pipeline()');
  if current_row.body_md5 is distinct from '71eabecb4cade2f2dd3ff651e8b18199'
     or current_row.prosecdef is distinct from true
     or current_row.config is distinct from array['search_path=""']
     or current_row.owner is distinct from 'postgres' then
    raise exception using errcode = '55000', message = 'SALES_ROLLBACK_BLOCKED',
      detail = 'public.sales_ensure_default_pipeline is not the M1 definition';
  end if;
end;
$$;

-- Exact Increment 1 definition (copied from 20261002120000).
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

alter function public.sales_ensure_default_pipeline() owner to postgres;
revoke all on function public.sales_ensure_default_pipeline() from public, anon, authenticated, service_role;
grant execute on function public.sales_ensure_default_pipeline() to authenticated;

do $$
begin
  if pg_catalog.to_regclass('supabase_migrations.schema_migrations') is not null then
    delete from supabase_migrations.schema_migrations where version = '20261002130000';
  end if;
end;
$$;

-- Postflight: the exact Increment 1 definition and privileges.
do $$
declare
  current_row record;
begin
  select pg_catalog.md5(replace(proc.prosrc, chr(13), '')) as body_md5, proc.prosecdef,
         coalesce(proc.proconfig, '{}') as config, pg_catalog.pg_get_userbyid(proc.proowner)::text as owner,
         pg_catalog.has_function_privilege('authenticated', proc.oid, 'EXECUTE') as auth_exec,
         pg_catalog.has_function_privilege('anon', proc.oid, 'EXECUTE') as anon_exec,
         pg_catalog.has_function_privilege('service_role', proc.oid, 'EXECUTE') as service_exec
  into current_row
  from pg_catalog.pg_proc as proc
  where proc.oid = pg_catalog.to_regprocedure('public.sales_ensure_default_pipeline()');
  if current_row.body_md5 is distinct from '12c3ea7d7a2c4f27dc67baab17104058'
     or current_row.prosecdef is distinct from true
     or current_row.config is distinct from array['search_path=""']
     or current_row.owner is distinct from 'postgres'
     or current_row.auth_exec is distinct from true
     or current_row.anon_exec or current_row.service_exec then
    raise exception using errcode = '55000', message = 'SALES_ROLLBACK_INCOMPLETE';
  end if;
end;
$$;

commit;

-- ROLLBACK / RECOVERY for migration 20261002120000_sales_v1_foundation.
--
-- Manual recovery only. Never part of the migration chain. Never run against
-- production without an explicit, separate authorization.
--
-- Fails closed. The whole script is one transaction and changes nothing when:
-- * any expected Increment 1 object is missing (unknown/partial state);
-- * any unexpected sales_* object exists in any schema (a later increment or
--   drift that this script does not know how to remove);
-- * any Sales table contains rows and the destruction confirmation below was
--   not given in this same transaction;
-- * anything outside Sales depends on a Sales object (no CASCADE is used);
-- * any sales_* object remains after the drops (postflight).
--
-- To confirm destruction of existing Sales rows (audit history included), add
-- this line immediately after BEGIN:
--   select set_config('orvesen.sales_rollback_confirm', 'DESTROY_SALES_V1_INC1_DATA', true);
--
-- ASCII only.

begin;

do $$
declare
  expected_relations text[] := array[
    'public.sales_audit_log',
    'public.sales_audit_log_entity_idx',
    'public.sales_audit_log_id_seq',
    'public.sales_audit_log_org_created_idx',
    'public.sales_audit_log_pkey',
    'public.sales_pipeline_stages',
    'public.sales_pipeline_stages_active_name_idx',
    'public.sales_pipeline_stages_one_active_won_idx',
    'public.sales_pipeline_stages_org_pipeline_idx',
    'public.sales_pipeline_stages_organization_id_id_key',
    'public.sales_pipeline_stages_pipeline_key_key',
    'public.sales_pipeline_stages_pipeline_position_key',
    'public.sales_pipeline_stages_pkey',
    'public.sales_pipelines',
    'public.sales_pipelines_active_name_idx',
    'public.sales_pipelines_one_default_idx',
    'public.sales_pipelines_organization_id_id_key',
    'public.sales_pipelines_pkey'
  ];
  expected_functions text[] := array[
    'private.sales_bump_pipeline_structure()',
    'private.sales_can(text)',
    'private.sales_check_pipeline_structure()',
    'private.sales_clean_name(text)',
    'private.sales_pipeline_stages_guard()',
    'private.sales_pipelines_guard()',
    'private.sales_reject_mutation()',
    'private.sales_require(text)',
    'private.sales_write_audit(uuid,text,text,uuid,jsonb)',
    'public.sales_archive_stage(uuid)',
    'public.sales_create_stage(uuid,text,text,text,integer)',
    'public.sales_ensure_default_pipeline()',
    'public.sales_reorder_stages(uuid,uuid[])',
    'public.sales_update_stage(uuid,jsonb,bigint)'
  ];
  found_relations text[];
  found_functions text[];
  found_types text[];
  has_rows boolean;
begin
  perform set_config('search_path', '', true);

  select coalesce(array_agg(format('%s.%s', namespace.nspname, relation.relname)
           order by format('%s.%s', namespace.nspname, relation.relname) collate "C"), '{}')
  into found_relations
  from pg_catalog.pg_class as relation
  join pg_catalog.pg_namespace as namespace on namespace.oid = relation.relnamespace
  where relation.relname like 'sales\_%'
    and namespace.nspname not in ('pg_catalog', 'information_schema', 'pg_toast');

  -- regprocedure renders schema-qualified names with argument types only
  -- (search_path is empty here).
  select coalesce(array_agg(proc.oid::pg_catalog.regprocedure::text
           order by proc.oid::pg_catalog.regprocedure::text collate "C"), '{}')
  into found_functions
  from pg_catalog.pg_proc as proc
  join pg_catalog.pg_namespace as namespace on namespace.oid = proc.pronamespace
  where proc.proname like 'sales\_%'
    and namespace.nspname not in ('pg_catalog', 'information_schema');

  -- Free-standing types (enums, domains, composites) are not part of Inc1.
  select coalesce(array_agg(format('%s.%s', namespace.nspname, type.typname)), '{}')
  into found_types
  from pg_catalog.pg_type as type
  join pg_catalog.pg_namespace as namespace on namespace.oid = type.typnamespace
  where (type.typname like 'sales\_%' or type.typname like '\_sales\_%')
    and type.typrelid = 0
    and type.typelem = 0
    and namespace.nspname not in ('pg_catalog', 'information_schema');

  if found_relations is distinct from expected_relations then
    raise exception using errcode = '55000', message = 'SALES_ROLLBACK_BLOCKED',
      detail = format('relation inventory mismatch: found %s', found_relations);
  end if;
  if found_functions is distinct from expected_functions then
    raise exception using errcode = '55000', message = 'SALES_ROLLBACK_BLOCKED',
      detail = format('function inventory mismatch: found %s', found_functions);
  end if;
  if cardinality(found_types) > 0 then
    raise exception using errcode = '55000', message = 'SALES_ROLLBACK_BLOCKED',
      detail = format('unexpected types: %s', found_types);
  end if;

  select exists (select 1 from public.sales_audit_log)
      or exists (select 1 from public.sales_pipelines)
      or exists (select 1 from public.sales_pipeline_stages)
  into has_rows;
  if has_rows and coalesce(current_setting('orvesen.sales_rollback_confirm', true), '')
                  <> 'DESTROY_SALES_V1_INC1_DATA' then
    raise exception using errcode = '55000', message = 'SALES_ROLLBACK_BLOCKED',
      detail = 'Sales tables contain rows; destruction was not confirmed in this transaction';
  end if;
end;
$$;

-- Order: RPCs (they return the stage row type), then tables (their policies,
-- triggers, indexes and identity sequence go with them), then the private
-- helpers used by triggers and CHECK constraints. No CASCADE: any foreign
-- dependent fails the script and the transaction rolls back.
drop function public.sales_archive_stage(uuid);
drop function public.sales_reorder_stages(uuid, uuid[]);
drop function public.sales_update_stage(uuid, jsonb, bigint);
drop function public.sales_create_stage(uuid, text, text, text, integer);
drop function public.sales_ensure_default_pipeline();

drop table public.sales_pipeline_stages;
drop table public.sales_pipelines;
drop table public.sales_audit_log;

drop function private.sales_write_audit(uuid, text, text, uuid, jsonb);
drop function private.sales_check_pipeline_structure();
drop function private.sales_bump_pipeline_structure();
drop function private.sales_pipeline_stages_guard();
drop function private.sales_pipelines_guard();
drop function private.sales_reject_mutation();
drop function private.sales_clean_name(text);
drop function private.sales_require(text);
drop function private.sales_can(text);

-- Migration history (present when applied through the Supabase CLI or when the
-- history row was recorded manually after a SQL Editor apply).
do $$
begin
  if pg_catalog.to_regclass('supabase_migrations.schema_migrations') is not null then
    delete from supabase_migrations.schema_migrations where version = '20261002120000';
  end if;
end;
$$;

-- Postflight: nothing named sales_* may remain anywhere.
do $$
declare
  leftovers text[];
begin
  select coalesce(array_agg(item order by item), '{}') into leftovers
  from (
    select format('relation %s.%s', namespace.nspname, relation.relname) as item
    from pg_catalog.pg_class as relation
    join pg_catalog.pg_namespace as namespace on namespace.oid = relation.relnamespace
    where relation.relname like 'sales\_%'
      and namespace.nspname not in ('pg_catalog', 'information_schema', 'pg_toast')
    union all
    select format('function %s.%s', namespace.nspname, proc.proname)
    from pg_catalog.pg_proc as proc
    join pg_catalog.pg_namespace as namespace on namespace.oid = proc.pronamespace
    where proc.proname like 'sales\_%'
      and namespace.nspname not in ('pg_catalog', 'information_schema')
    union all
    select format('type %s.%s', namespace.nspname, type.typname)
    from pg_catalog.pg_type as type
    join pg_catalog.pg_namespace as namespace on namespace.oid = type.typnamespace
    where (type.typname like 'sales\_%' or type.typname like '\_sales\_%')
      and namespace.nspname not in ('pg_catalog', 'information_schema')
    union all
    select format('policy %s', policy.polname)
    from pg_catalog.pg_policy as policy
    where policy.polname like 'sales\_%'
    union all
    select format('trigger %s', trigger.tgname)
    from pg_catalog.pg_trigger as trigger
    where trigger.tgname like 'sales\_%'
  ) as remaining;

  if cardinality(leftovers) > 0 then
    raise exception using errcode = '55000', message = 'SALES_ROLLBACK_INCOMPLETE',
      detail = format('remaining: %s', leftovers);
  end if;
end;
$$;

commit;

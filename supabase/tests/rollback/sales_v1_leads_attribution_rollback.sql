-- ROLLBACK / RECOVERY for migration 20261003120000_sales_v1_leads_attribution.
--
-- Returns the database to the exact Increment 1 state: drops every Increment 2
-- object, restores private.sales_can and the sales_audit_log CHECK constraints
-- byte-exact, and removes the Increment 2 migration-history row.
--
-- Manual recovery only, never part of the migration chain, never against
-- production without a separate authorization. Valid ONLY before real
-- Increment 2 use (approved decision D4): the audit log is append-only, so once
-- lead audit rows exist the Increment 1 constraints cannot be restored, and
-- recovery is a forward fix. There is no override.
--
-- Fails closed. The whole script is one transaction; every lock it needs is
-- taken up front in ACCESS EXCLUSIVE mode (no read-then-upgrade). It changes
-- nothing when:
-- * the Sales inventory is not exactly Increment 1 + Increment 2;
-- * private.sales_can or the audit CHECKs are not the exact Increment 2 definitions;
-- * any lead, touch or lead audit row exists;
-- * anything outside Sales depends on an Increment 2 object (no CASCADE);
-- * the postflight does not find the exact Increment 1 state.
--
-- ASCII only.

begin;

lock table public.sales_audit_log, public.sales_leads, public.sales_lead_touches in access exclusive mode;

do $$
declare
  expected_relations text[] := array[
    'public.sales_audit_log',
    'public.sales_audit_log_entity_idx',
    'public.sales_audit_log_id_seq',
    'public.sales_audit_log_org_created_idx',
    'public.sales_audit_log_pkey',
    'public.sales_lead_attribution',
    'public.sales_lead_touches',
    'public.sales_lead_touches_campaign_idx',
    'public.sales_lead_touches_event_idx',
    'public.sales_lead_touches_idempotency_idx',
    'public.sales_lead_touches_lead_order_idx',
    'public.sales_lead_touches_organization_id_id_key',
    'public.sales_lead_touches_pkey',
    'public.sales_leads',
    'public.sales_leads_active_email_idx',
    'public.sales_leads_active_external_idx',
    'public.sales_leads_active_phone_idx',
    'public.sales_leads_org_status_idx',
    'public.sales_leads_organization_id_id_key',
    'public.sales_leads_pkey',
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
    'private.sales_clean_lead(jsonb)',
    'private.sales_clean_name(text)',
    'private.sales_clean_text(text,integer)',
    'private.sales_clean_touch(jsonb,text[])',
    'private.sales_clean_url(text)',
    'private.sales_click_ids_valid(jsonb)',
    'private.sales_find_replay(uuid,text,text,text,text)',
    'private.sales_ingest_lead_core(uuid,jsonb,jsonb,text,text[])',
    'private.sales_insert_touch(uuid,uuid,jsonb,text,text)',
    'private.sales_lead_result(uuid,boolean)',
    'private.sales_lead_touches_count()',
    'private.sales_lead_touches_guard()',
    'private.sales_leads_guard()',
    'private.sales_lock_organization_leads(uuid)',
    'private.sales_normalize_email(text)',
    'private.sales_normalize_phone(text)',
    'private.sales_pipeline_stages_guard()',
    'private.sales_pipelines_guard()',
    'private.sales_raw_valid(jsonb)',
    'private.sales_reject_mutation()',
    'private.sales_request_hash(jsonb)',
    'private.sales_require(text)',
    'private.sales_transition_lead(uuid,uuid,text,text,text,bigint)',
    'private.sales_write_audit(uuid,text,text,uuid,jsonb)',
    'public.sales_add_lead_touch(uuid,jsonb,text)',
    'public.sales_archive_lead(uuid,text,bigint)',
    'public.sales_archive_stage(uuid)',
    'public.sales_create_stage(uuid,text,text,text,integer)',
    'public.sales_disqualify_lead(uuid,text,text,bigint)',
    'public.sales_ensure_default_pipeline()',
    'public.sales_ingest_lead(jsonb,jsonb,text)',
    'public.sales_qualify_lead(uuid,text,text,bigint)',
    'public.sales_reorder_stages(uuid,uuid[])',
    'public.sales_update_lead(uuid,jsonb,bigint)',
    'public.sales_update_stage(uuid,jsonb,bigint)'
  ];
  expected_constraints text[] := array[
    $c$sales_audit_log_action_check => CHECK ((action = ANY (ARRAY['sales.pipeline.created'::text, 'sales.stage.created'::text, 'sales.stage.updated'::text, 'sales.stage.archived'::text, 'sales.stages.reordered'::text, 'sales.lead.created'::text, 'sales.lead.updated'::text, 'sales.lead.qualified'::text, 'sales.lead.disqualified'::text, 'sales.lead.archived'::text, 'sales.lead.touch_added'::text])))$c$,
    $c$sales_audit_log_check => CHECK (((entity_type = 'pipeline'::text) = (action = ANY (ARRAY['sales.pipeline.created'::text, 'sales.stages.reordered'::text]))))$c$,
    $c$sales_audit_log_details_check => CHECK (((jsonb_typeof(details) = 'object'::text) AND (pg_column_size(details) <= 16384)))$c$,
    $c$sales_audit_log_entity_type_check => CHECK ((entity_type = ANY (ARRAY['pipeline'::text, 'stage'::text, 'lead'::text, 'lead_touch'::text])))$c$,
    $c$sales_audit_log_lead_entity_check => CHECK ((((action = ANY (ARRAY['sales.lead.created'::text, 'sales.lead.updated'::text, 'sales.lead.qualified'::text, 'sales.lead.disqualified'::text, 'sales.lead.archived'::text])) = (entity_type = 'lead'::text)) AND ((action = 'sales.lead.touch_added'::text) = (entity_type = 'lead_touch'::text))))$c$
  ];
  found_relations text[];
  found_functions text[];
  found_types text[];
  found_constraints text[];
  can_md5 text;
  used boolean;
begin
  perform set_config('search_path', '', true);

  select coalesce(array_agg(format('%s.%s', namespace.nspname, relation.relname)
           order by format('%s.%s', namespace.nspname, relation.relname) collate "C"), '{}')
  into found_relations
  from pg_catalog.pg_class as relation
  join pg_catalog.pg_namespace as namespace on namespace.oid = relation.relnamespace
  where relation.relname like 'sales\_%'
    and namespace.nspname not in ('pg_catalog', 'information_schema', 'pg_toast');

  select coalesce(array_agg(proc.oid::pg_catalog.regprocedure::text
           order by proc.oid::pg_catalog.regprocedure::text collate "C"), '{}')
  into found_functions
  from pg_catalog.pg_proc as proc
  join pg_catalog.pg_namespace as namespace on namespace.oid = proc.pronamespace
  where proc.proname like 'sales\_%'
    and namespace.nspname not in ('pg_catalog', 'information_schema');

  select coalesce(array_agg(format('%s.%s', namespace.nspname, type.typname)), '{}')
  into found_types
  from pg_catalog.pg_type as type
  join pg_catalog.pg_namespace as namespace on namespace.oid = type.typnamespace
  where (type.typname like 'sales\_%' or type.typname like '\_sales\_%')
    and type.typrelid = 0
    and type.typelem = 0
    and namespace.nspname not in ('pg_catalog', 'information_schema');

  select coalesce(array_agg(con.conname || ' => ' || pg_catalog.pg_get_constraintdef(con.oid) order by con.conname), '{}')
  into found_constraints
  from pg_catalog.pg_constraint as con
  where con.conrelid = 'public.sales_audit_log'::regclass and con.contype = 'c';

  select pg_catalog.md5(replace(proc.prosrc, chr(13), '')) into can_md5
  from pg_catalog.pg_proc as proc where proc.oid = 'private.sales_can(text)'::regprocedure;

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
  if found_constraints is distinct from expected_constraints then
    raise exception using errcode = '55000', message = 'SALES_ROLLBACK_BLOCKED',
      detail = 'sales_audit_log CHECK constraints are not the Increment 2 definitions';
  end if;
  if can_md5 is distinct from '07a2ea93f0278050caf756eb5903a254' then
    raise exception using errcode = '55000', message = 'SALES_ROLLBACK_BLOCKED',
      detail = 'private.sales_can is not the Increment 2 definition';
  end if;

  select exists (select 1 from public.sales_leads)
      or exists (select 1 from public.sales_lead_touches)
      or exists (select 1 from public.sales_audit_log
                 where entity_type in ('lead', 'lead_touch') or action like 'sales.lead.%')
  into used;
  if used then
    raise exception using errcode = '55000', message = 'SALES_ROLLBACK_BLOCKED',
      detail = 'Increment 2 has been used (leads, touches or lead audit rows exist); recovery is forward-fix only';
  end if;
end;
$$;

-- Order: objects that depend on the Increment 2 tables (view and functions
-- returning their row types), then the tables, then helpers used by triggers
-- and CHECK constraints. No CASCADE.
drop view public.sales_lead_attribution;
drop function public.sales_archive_lead(uuid, text, bigint);
drop function public.sales_disqualify_lead(uuid, text, text, bigint);
drop function public.sales_qualify_lead(uuid, text, text, bigint);
drop function public.sales_update_lead(uuid, jsonb, bigint);
drop function public.sales_add_lead_touch(uuid, jsonb, text);
drop function public.sales_ingest_lead(jsonb, jsonb, text);
drop function private.sales_transition_lead(uuid, uuid, text, text, text, bigint);
drop function private.sales_ingest_lead_core(uuid, jsonb, jsonb, text, text[]);
drop function private.sales_insert_touch(uuid, uuid, jsonb, text, text);
drop function private.sales_lead_result(uuid, boolean);
drop function private.sales_find_replay(uuid, text, text, text, text);
drop function private.sales_lock_organization_leads(uuid);

drop table public.sales_lead_touches;
drop table public.sales_leads;

drop function private.sales_lead_touches_count();
drop function private.sales_lead_touches_guard();
drop function private.sales_leads_guard();
drop function private.sales_clean_touch(jsonb, text[]);
drop function private.sales_clean_lead(jsonb);
drop function private.sales_request_hash(jsonb);
drop function private.sales_raw_valid(jsonb);
drop function private.sales_click_ids_valid(jsonb);
drop function private.sales_clean_url(text);
drop function private.sales_clean_text(text, integer);
drop function private.sales_normalize_phone(text);
drop function private.sales_normalize_email(text);

-- Restore the Increment 1 audit CHECK constraints (same names and expressions
-- as migration 20261002120000).
alter table public.sales_audit_log drop constraint sales_audit_log_lead_entity_check;
alter table public.sales_audit_log drop constraint sales_audit_log_action_check;
alter table public.sales_audit_log add constraint sales_audit_log_action_check check (action in (
    'sales.pipeline.created',
    'sales.stage.created',
    'sales.stage.updated',
    'sales.stage.archived',
    'sales.stages.reordered'
  ));
alter table public.sales_audit_log drop constraint sales_audit_log_entity_type_check;
alter table public.sales_audit_log add constraint sales_audit_log_entity_type_check
  check (entity_type in ('pipeline', 'stage'));

-- Restore the Increment 1 private.sales_can body byte-exact (owner, ACL and
-- configuration are preserved by CREATE OR REPLACE and re-asserted below).
create or replace function private.sales_can(requested_action text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    requested_action in ('read', 'manage_pipeline')
    and (select auth.uid()) is not null
    and exists (
      select 1
      from public.organization_memberships as membership
      where membership.user_id = (select auth.uid())
        and membership.organization_id = public.current_user_organization_id()
        and membership.role in ('founder', 'admin')
    ),
    false
  );
$$;
alter function private.sales_can(text) owner to postgres;
revoke all on function private.sales_can(text) from public, anon, authenticated, service_role;
grant execute on function private.sales_can(text) to authenticated;

do $$
begin
  if pg_catalog.to_regclass('supabase_migrations.schema_migrations') is not null then
    delete from supabase_migrations.schema_migrations where version = '20261003120000';
  end if;
end;
$$;

-- Postflight: exactly the Increment 1 state.
do $$
declare
  inc1_relations text[] := array[
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
  inc1_constraints text[] := array[
    $c$sales_audit_log_action_check => CHECK ((action = ANY (ARRAY['sales.pipeline.created'::text, 'sales.stage.created'::text, 'sales.stage.updated'::text, 'sales.stage.archived'::text, 'sales.stages.reordered'::text])))$c$,
    $c$sales_audit_log_check => CHECK (((entity_type = 'pipeline'::text) = (action = ANY (ARRAY['sales.pipeline.created'::text, 'sales.stages.reordered'::text]))))$c$,
    $c$sales_audit_log_details_check => CHECK (((jsonb_typeof(details) = 'object'::text) AND (pg_column_size(details) <= 16384)))$c$,
    $c$sales_audit_log_entity_type_check => CHECK ((entity_type = ANY (ARRAY['pipeline'::text, 'stage'::text])))$c$
  ];
  found_relations text[];
  found_constraints text[];
  leftovers text[];
  can_row record;
begin
  perform set_config('search_path', '', true);

  select coalesce(array_agg(format('%s.%s', namespace.nspname, relation.relname)
           order by format('%s.%s', namespace.nspname, relation.relname) collate "C"), '{}')
  into found_relations
  from pg_catalog.pg_class as relation
  join pg_catalog.pg_namespace as namespace on namespace.oid = relation.relnamespace
  where relation.relname like 'sales\_%'
    and namespace.nspname not in ('pg_catalog', 'information_schema', 'pg_toast');

  select coalesce(array_agg(con.conname || ' => ' || pg_catalog.pg_get_constraintdef(con.oid) order by con.conname), '{}')
  into found_constraints
  from pg_catalog.pg_constraint as con
  where con.conrelid = 'public.sales_audit_log'::regclass and con.contype = 'c';

  select pg_catalog.md5(replace(proc.prosrc, chr(13), '')) as body_md5, proc.prosecdef,
         coalesce(proc.proconfig, '{}') as config, pg_catalog.pg_get_userbyid(proc.proowner)::text as owner
  into can_row
  from pg_catalog.pg_proc as proc where proc.oid = 'private.sales_can(text)'::regprocedure;

  select coalesce(array_agg(item order by item), '{}') into leftovers
  from (
    select format('function %s', proc.oid::pg_catalog.regprocedure::text) as item
    from pg_catalog.pg_proc as proc
    where proc.proname like 'sales\_%'
      and (proc.proname like 'sales\_lead%' or proc.proname in (
        'sales_normalize_email', 'sales_normalize_phone', 'sales_clean_text', 'sales_clean_url',
        'sales_click_ids_valid', 'sales_raw_valid', 'sales_request_hash', 'sales_clean_lead',
        'sales_clean_touch', 'sales_find_replay', 'sales_insert_touch', 'sales_ingest_lead_core',
        'sales_transition_lead', 'sales_ingest_lead', 'sales_add_lead_touch', 'sales_update_lead',
        'sales_qualify_lead', 'sales_disqualify_lead', 'sales_archive_lead', 'sales_lock_organization_leads'))
    union all
    select format('type %s', type.typname) from pg_catalog.pg_type as type
    where type.typname like 'sales\_lead%' or type.typname like '\_sales\_lead%'
    union all
    select format('policy %s', policy.polname) from pg_catalog.pg_policy as policy where policy.polname like 'sales\_lead%'
    union all
    select format('trigger %s', trigger.tgname) from pg_catalog.pg_trigger as trigger where trigger.tgname like 'sales\_lead%'
    union all
    select format('migration %s', version) from supabase_migrations.schema_migrations
    where pg_catalog.to_regclass('supabase_migrations.schema_migrations') is not null and version = '20261003120000'
  ) as remaining;

  if found_relations is distinct from inc1_relations
     or found_constraints is distinct from inc1_constraints
     or can_row.body_md5 is distinct from '2f61c4f2f9c52c0ab2e7a19495652a33'
     or can_row.prosecdef is distinct from true
     or can_row.config is distinct from array['search_path=""']
     or can_row.owner is distinct from 'postgres'
     or cardinality(leftovers) > 0 then
    raise exception using errcode = '55000', message = 'SALES_ROLLBACK_INCOMPLETE',
      detail = format('relations %s; leftovers %s', found_relations, leftovers);
  end if;
end;
$$;

commit;

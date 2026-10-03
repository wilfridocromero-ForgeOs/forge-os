-- ============================================================================
-- ORVESEN Sales V1 Increment 1 - FUNCTIONAL ACCEPTANCE RUNNER
-- Target: Orvesen Staging (vkvaispeujpsvotojyvz) ONLY, via the Supabase SQL Editor.
-- Code under test: commit 8394c459c32f52b269b4f4da28142e1a09d9245e (branch claude/sales-v1),
--   migration 20261002120000 (sha256 da1bc226...73b2, history md5 ef72b4f0...).
--
-- HOW IT WORKS
--   * One DO block + one final SELECT, in the SQL Editor's single implicit transaction.
--   * Environment guard first (read-only). If this is not the approved post-apply
--     Staging state, the runner reports BLOCKED and writes nothing.
--   * The scenario (synthetic users, organizations, Sales rows) runs inside a
--     PL/pgSQL exception block (= savepoint) that ALWAYS ends by raising a
--     sentinel, so every scenario write is rolled back. Results survive in
--     variables. Only identity-sequence values are consumed.
--   * Product actions run as the impersonated user (role authenticated + JWT sub)
--     through the public Sales RPCs, so RLS and grants apply as in the product.
--   * Commit-time (deferred) invariants are exercised with SET CONSTRAINTS ALL
--     IMMEDIATE checkpoints inside savepoints; nothing is committed.
--   * Concurrency is NOT tested here (single connection); it is proven by the
--     local real-PostgreSQL suite.
-- No real organization data is read for writing, no migration history change,
-- no rollback script, no Production. ASCII only.
-- ============================================================================

do $runner$
declare
  -- Approved Staging state after the Sales Inc1 apply (from the postflight).
  c_expected_digest constant text := '397521f96e0ca6dd75758ed23671176f';
  c_expected_items constant integer := 3877;
  c_expected_history constant bigint := 78;
  -- md5 of the 14 Sales functions (regprocedure, source without CR, definer,
  -- config), derived from the canonical migration applied to a clean PostgreSQL 17.
  c_expected_fn_fingerprint constant text := 'f0caa24672351afd7788dbb756f56c78';

  v_run text := to_char(clock_timestamp() at time zone 'UTC', 'YYYYMMDD"t"HH24MISS') || '-'
                || substr(md5(random()::text || clock_timestamp()::text), 1, 6);
  v_tag text;
  v_checks jsonb := '[]'::jsonb;
  v_warnings jsonb := '[]'::jsonb;
  v_blocked text;
  v_halted text;
  v_env jsonb;
  v_err_ctx text;
  v_digest_sql text;
  v_fp_sql text;
  v_other_sql text;
  v_digest_before jsonb;
  v_other_before text;
  v_hist_before bigint;
  v_sales_before jsonb;
  -- actors and tenants
  v_fa uuid := gen_random_uuid();
  v_fb uuid := gen_random_uuid();
  v_admin uuid := gen_random_uuid();
  v_lead uuid := gen_random_uuid();
  v_member uuid := gen_random_uuid();
  v_ghost uuid := gen_random_uuid();   -- JWT subject with no account and no membership
  v_users uuid[];
  v_org_a uuid;
  v_org_b uuid;
  v_all_orgs uuid[];
  -- scenario objects
  v_pa uuid;
  v_pb uuid;
  v_won uuid;
  v_lost uuid;
  v_lost_b uuid;
  v_follow uuid;
  v_b_stage uuid;
  v_ids uuid[];
  v_ids_b uuid[];
  v_b_md5_before text;
  v_audit_n bigint;
  -- scratch
  v_r jsonb;
  v_r2 jsonb;
  v_txt text;
  v_n bigint;
  v_report jsonb;
  v_summary text;
  v_total integer;
  v_passed integer;
  v_failed integer;
  v_status text;
begin
  -- Fully qualified names only; deterministic regprocedure/regclass rendering.
  perform set_config('search_path', '', true);
  v_tag := 'zz-sales-e2e-' || v_run;
  v_users := array[v_fa, v_fb, v_admin, v_lead, v_member];

  v_digest_sql := $q$
    select jsonb_build_object('digest', pg_catalog.md5(coalesce(string_agg(item, E'\n' order by item collate "C"), '')), 'items', count(*)::int)
    from (
      select 'proc:' || proc.oid::regprocedure::text || ':' || pg_catalog.md5(pg_catalog.pg_get_functiondef(proc.oid))
             || ':' || coalesce(proc.proacl::text, '') || ':' || proc.prosecdef::text as item
      from pg_catalog.pg_proc as proc
      join pg_catalog.pg_namespace as namespace on namespace.oid = proc.pronamespace
      where namespace.nspname in ('public', 'private', 'auth', 'supabase_migrations')
        and proc.proname not like 'sales\_%' and proc.prokind = 'f'
      union all
      select 'rel:' || namespace.nspname || '.' || relation.relname || ':' || relation.relkind::text || ':'
             || coalesce(relation.relacl::text, '') || ':' || relation.relrowsecurity::text
      from pg_catalog.pg_class as relation
      join pg_catalog.pg_namespace as namespace on namespace.oid = relation.relnamespace
      where namespace.nspname in ('public', 'private', 'auth', 'supabase_migrations')
        and relation.relname not like 'sales\_%'
      union all
      select 'col:' || relation.oid::regclass::text || '.' || attribute.attname || ':'
             || pg_catalog.format_type(attribute.atttypid, attribute.atttypmod) || ':' || attribute.attnotnull::text
      from pg_catalog.pg_attribute as attribute
      join pg_catalog.pg_class as relation on relation.oid = attribute.attrelid
      join pg_catalog.pg_namespace as namespace on namespace.oid = relation.relnamespace
      where namespace.nspname in ('public', 'private', 'auth', 'supabase_migrations')
        and relation.relname not like 'sales\_%' and attribute.attnum > 0 and not attribute.attisdropped
      union all
      select 'con:' || con.conrelid::regclass::text || ':' || con.conname || ':' || pg_catalog.pg_get_constraintdef(con.oid)
      from pg_catalog.pg_constraint as con
      join pg_catalog.pg_class as relation on relation.oid = con.conrelid
      join pg_catalog.pg_namespace as namespace on namespace.oid = relation.relnamespace
      where namespace.nspname in ('public', 'private', 'auth', 'supabase_migrations')
        and relation.relname not like 'sales\_%'
      union all
      select 'pol:' || policy.polrelid::regclass::text || ':' || policy.polname
      from pg_catalog.pg_policy as policy where policy.polname not like 'sales\_%'
      union all
      select 'trg:' || trigger.tgrelid::regclass::text || ':' || trigger.tgname
      from pg_catalog.pg_trigger as trigger
      where not trigger.tgisinternal and trigger.tgname not like 'sales\_%'
      union all
      select 'ns:' || namespace.nspname || ':' || coalesce(namespace.nspacl::text, '')
      from pg_catalog.pg_namespace as namespace
      where namespace.nspname in ('public', 'private', 'auth', 'supabase_migrations')
      union all
      select 'defacl:' || coalesce(acl.defaclacl::text, '') || ':' || acl.defaclobjtype::text
      from pg_catalog.pg_default_acl as acl
    ) as items $q$;

  v_fp_sql := $q$
    select pg_catalog.md5(string_agg(p.oid::regprocedure::text || ':' || pg_catalog.md5(replace(p.prosrc, chr(13), ''))
             || ':' || p.prosecdef::text || ':' || coalesce(array_to_string(p.proconfig, ','), ''),
             E'\n' order by p.oid::regprocedure::text collate "C"))
    from pg_catalog.pg_proc p where p.proname like 'sales\_%' $q$;

  -- Identity of every pre-existing tenant row the runner could touch.
  v_other_sql := $q$
    select pg_catalog.md5(coalesce((select string_agg(o.id::text || ':' || coalesce(o.name, ''), ',' order by o.id) from public.organizations o), '')
      || '|' || coalesce((select string_agg(m.user_id::text || ':' || m.organization_id::text || ':' || m.role, ',' order by m.user_id, m.organization_id) from public.organization_memberships m), '')
      || '|' || coalesce((select string_agg(a.user_id::text || ':' || a.organization_id::text, ',' order by a.user_id) from public.user_active_organizations a), '')
      || '|' || (select count(*) from auth.users)::text) $q$;

  -- ==========================================================================
  -- 1. ENVIRONMENT (read-only guard; BLOCKED means nothing is written)
  -- ==========================================================================
  execute v_digest_sql into v_digest_before;
  execute v_fp_sql into v_txt;
  v_env := jsonb_build_object(
    'database', current_database(),
    'server_version', current_setting('server_version'),
    'current_user', current_user::text,
    'staging_fingerprint_versions', (select count(*) from supabase_migrations.schema_migrations
        where version in ('20260801000000', '20260804054000', '20260916090000', '20260917000000', '20260917000100')),
    'email_inc1_md5', (select md5(replace(statements[1], chr(13), '')) from supabase_migrations.schema_migrations where version = '20260926160000'),
    'email_inc2_md5', (select md5(replace(statements[1], chr(13), '')) from supabase_migrations.schema_migrations where version = '20260927120000'),
    'sales_history_rows', (select count(*) from supabase_migrations.schema_migrations where version = '20261002120000'),
    'sales_history_md5', (select md5(replace(statements[1], chr(13), '')) from supabase_migrations.schema_migrations
        where version = '20261002120000' and name = 'sales_v1_foundation'),
    'history_count', (select count(*) from supabase_migrations.schema_migrations),
    'non_sales_catalog', v_digest_before,
    'sales_function_fingerprint', v_txt,
    'outbound_triggers_on_written_tables', coalesce((
      select jsonb_agg(t.tgrelid::regclass::text || ':' || t.tgname || ':' || p.oid::regprocedure::text order by 1)
      from pg_catalog.pg_trigger t join pg_catalog.pg_proc p on p.oid = t.tgfoid
      where not t.tgisinternal
        and t.tgrelid in (select r from unnest(array[to_regclass('auth.users'), to_regclass('public.users'),
                            to_regclass('public.organizations'), to_regclass('public.organization_memberships'),
                            to_regclass('public.user_active_organizations')]) r where r is not null)
        and (p.prosrc ~* '(http|pg_net|net\.|supabase_functions|webhook)' or p.proname ~* 'http')), '[]'::jsonb),
    'prerequisites', has_table_privilege('auth.users', 'INSERT') and pg_has_role('authenticated', 'MEMBER')
        and pg_has_role('anon', 'MEMBER') and pg_has_role('service_role', 'MEMBER'),
    'production_contacted', 'NO');
  v_hist_before := (v_env ->> 'history_count')::bigint;
  v_sales_before := jsonb_build_object(
    'audit', (select count(*) from public.sales_audit_log),
    'pipelines', (select count(*) from public.sales_pipelines),
    'stages', (select count(*) from public.sales_pipeline_stages));
  execute v_other_sql into v_other_before;

  v_checks := v_checks
    || jsonb_build_object('id', 'ENV-01', 'section', 'environment', 'test', 'SQL Editor runs as postgres', 'expected', 'postgres', 'actual', v_env -> 'current_user')
    || jsonb_build_object('id', 'ENV-02', 'section', 'environment', 'test', 'Staging-only migration fingerprint present (5 versions)', 'expected', 5, 'actual', v_env -> 'staging_fingerprint_versions')
    || jsonb_build_object('id', 'ENV-03', 'section', 'environment', 'test', 'Email Inc1/Inc2 recorded byte-exact',
         'expected', '["dbc4208d3b3df5f35248042a7cfe1113", "7e8ec38ab2a5f7bd650bafc740d62525"]'::jsonb,
         'actual', jsonb_build_array(v_env -> 'email_inc1_md5', v_env -> 'email_inc2_md5'))
    || jsonb_build_object('id', 'ENV-04', 'section', 'environment', 'test', 'Sales 20261002120000 recorded exactly once, byte-exact',
         'expected', '{"rows": 1, "md5": "ef72b4f0727cfa6053d2eb8efafd3247"}'::jsonb,
         'actual', jsonb_build_object('rows', v_env -> 'sales_history_rows', 'md5', v_env -> 'sales_history_md5'))
    || jsonb_build_object('id', 'ENV-05', 'section', 'environment', 'test', 'migration history count is the post-apply state', 'expected', c_expected_history, 'actual', v_env -> 'history_count')
    || jsonb_build_object('id', 'ENV-06', 'section', 'environment', 'test', 'non-Sales catalog identical to the post-apply postflight',
         'expected', jsonb_build_object('digest', c_expected_digest, 'items', c_expected_items), 'actual', v_digest_before)
    || jsonb_build_object('id', 'ENV-07', 'section', 'environment', 'test', 'the 14 Sales functions are identical to the canonical migration',
         'expected', c_expected_fn_fingerprint, 'actual', v_env -> 'sales_function_fingerprint')
    || jsonb_build_object('id', 'ENV-08', 'section', 'environment', 'test', 'no trigger on a table the runner writes can make outbound HTTP calls',
         'expected', '[]'::jsonb, 'actual', v_env -> 'outbound_triggers_on_written_tables')
    || jsonb_build_object('id', 'ENV-09', 'section', 'environment', 'test', 'runner prerequisites (insert synthetic auth users; assume API roles)', 'expected', true, 'actual', v_env -> 'prerequisites')
    || jsonb_build_object('id', 'ENV-10', 'section', 'environment', 'test', 'Sales tables hold no rows before the run',
         'expected', '{"audit": 0, "pipelines": 0, "stages": 0}'::jsonb, 'actual', v_sales_before);

  if (v_env ->> 'current_user') <> 'postgres' then
    v_blocked := 'not running as postgres';
  elsif (v_env ->> 'staging_fingerprint_versions')::int <> 5
     or (v_env ->> 'email_inc1_md5') is distinct from 'dbc4208d3b3df5f35248042a7cfe1113'
     or (v_env ->> 'email_inc2_md5') is distinct from '7e8ec38ab2a5f7bd650bafc740d62525' then
    v_blocked := 'Staging fingerprint not found (not Orvesen Staging)';
  elsif (v_env ->> 'sales_history_rows')::int <> 1
     or (v_env ->> 'sales_history_md5') is distinct from 'ef72b4f0727cfa6053d2eb8efafd3247'
     or v_hist_before <> c_expected_history then
    v_blocked := 'Sales Inc1 is not recorded exactly once byte-exact, or migration history is not the post-apply state';
  elsif v_digest_before is distinct from jsonb_build_object('digest', c_expected_digest, 'items', c_expected_items) then
    v_blocked := 'non-Sales catalog differs from the approved post-apply state';
  elsif (v_env ->> 'sales_function_fingerprint') is distinct from c_expected_fn_fingerprint then
    v_blocked := 'Sales functions differ from the canonical migration';
  elsif jsonb_array_length(v_env -> 'outbound_triggers_on_written_tables') > 0 then
    v_blocked := 'a trigger on a written table may call out over HTTP; refusing to write';
  elsif not (v_env ->> 'prerequisites')::boolean then
    v_blocked := 'missing runner prerequisites';
  elsif v_sales_before <> '{"audit": 0, "pipelines": 0, "stages": 0}'::jsonb then
    v_blocked := 'Sales tables already hold rows; this runner expects the pristine post-apply state';
  end if;

  -- ==========================================================================
  -- 2. SECURITY (static, read-only)
  -- ==========================================================================
  if v_blocked is null then
    v_checks := v_checks
      || jsonb_build_object('id', 'SEC-01', 'section', 'security', 'test', 'RLS enabled on the 3 Sales tables', 'expected', 3,
           'actual', (select count(*) from pg_catalog.pg_class where oid in ('public.sales_audit_log'::regclass, 'public.sales_pipelines'::regclass, 'public.sales_pipeline_stages'::regclass) and relrowsecurity))
      || jsonb_build_object('id', 'SEC-02', 'section', 'security', 'test', 'effective table privileges: authenticated SELECT only; anon and service_role nothing',
           'expected', '["authenticated:SELECT:public.sales_audit_log", "authenticated:SELECT:public.sales_pipeline_stages", "authenticated:SELECT:public.sales_pipelines"]'::jsonb,
           'actual', (select jsonb_agg(r || ':' || p || ':' || t order by r collate "C", p collate "C", t collate "C") from unnest(array['anon', 'authenticated', 'service_role']) r,
                      unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) p,
                      unnest(array['public.sales_audit_log', 'public.sales_pipelines', 'public.sales_pipeline_stages']) t
                      where has_table_privilege(r, t, p)))
      || jsonb_build_object('id', 'SEC-03', 'section', 'security', 'test', 'EXECUTE on Sales functions: authenticated = 5 RPCs + sales_can; anon/service_role none',
           'expected', '["authenticated:private.sales_can(text)", "authenticated:public.sales_archive_stage(uuid)", "authenticated:public.sales_create_stage(uuid,text,text,text,integer)", "authenticated:public.sales_ensure_default_pipeline()", "authenticated:public.sales_reorder_stages(uuid,uuid[])", "authenticated:public.sales_update_stage(uuid,jsonb,bigint)"]'::jsonb,
           'actual', (select jsonb_agg(r || ':' || p.oid::regprocedure::text order by r, p.oid::regprocedure::text collate "C")
                      from pg_catalog.pg_proc p, unnest(array['anon', 'authenticated', 'service_role']) r
                      where p.proname like 'sales\_%' and has_function_privilege(r, p.oid, 'EXECUTE')));
  end if;

  -- ==========================================================================
  -- SCENARIO (always rolled back)
  -- ==========================================================================
  if v_blocked is null then
  begin
    -- Impersonation helper; it lives in this savepoint and is rolled back with it.
    -- Returns {"ok": true, "value": ...} or {"ok": false, "error": <message or PERMISSION_DENIED>}.
    execute $f$
      create function pg_temp.sales_e2e_call(p_user uuid, p_role text, p_sql text)
      returns jsonb language plpgsql as $body$
      declare
        result jsonb;
      begin
        perform pg_catalog.set_config('request.jwt.claim.sub', coalesce(p_user::text, ''), true),
                pg_catalog.set_config('request.jwt.claims',
                  case when p_user is null then '' else pg_catalog.json_build_object('sub', p_user, 'role', p_role)::text end, true),
                pg_catalog.set_config('role', p_role, true);
        begin
          execute p_sql into result;
          perform pg_catalog.set_config('role', 'postgres', true);
          return pg_catalog.jsonb_build_object('ok', true, 'value', result);
        exception when others then
          perform pg_catalog.set_config('role', 'postgres', true);
          return pg_catalog.jsonb_build_object('ok', false, 'error',
            case when sqlstate = '42501' and sqlerrm like 'permission denied%' then 'PERMISSION_DENIED' else sqlerrm end);
        end;
      end
      $body$ $f$;

    -- ========================================================================
    -- 3. SETUP: synthetic tenants through the real signup trigger
    -- ========================================================================
    begin
      insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data, created_at, updated_at)
      select u.id, '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated', 'authenticated', v_tag || '-' || u.label || '@example.invalid',
             jsonb_build_object('first_name', 'ZZ SALES E2E ' || u.label, 'organization_name', v_tag || ' ' || u.label), '{}'::jsonb, now(), now()
      from (values (v_fa, 'founder-a'), (v_fb, 'founder-b'), (v_admin, 'admin-a'), (v_lead, 'lead-a'), (v_member, 'member-a')) as u(id, label);

      select a.organization_id into v_org_a from public.user_active_organizations a where a.user_id = v_fa;
      select a.organization_id into v_org_b from public.user_active_organizations a where a.user_id = v_fb;
      if v_org_a is null or v_org_b is null then
        v_warnings := v_warnings || to_jsonb('signup trigger did not provision organizations; provisioned manually'::text);
        if v_org_a is null then
          v_org_a := gen_random_uuid();
          insert into public.organizations (id, name) values (v_org_a, v_tag || ' founder-a');
          insert into public.organization_memberships (user_id, organization_id, role) values (v_fa, v_org_a, 'founder');
          insert into public.user_active_organizations (user_id, organization_id) values (v_fa, v_org_a);
        end if;
        if v_org_b is null then
          v_org_b := gen_random_uuid();
          insert into public.organizations (id, name) values (v_org_b, v_tag || ' founder-b');
          insert into public.organization_memberships (user_id, organization_id, role) values (v_fb, v_org_b, 'founder');
          insert into public.user_active_organizations (user_id, organization_id) values (v_fb, v_org_b);
        end if;
      end if;
      insert into public.organization_memberships (user_id, organization_id, role)
      values (v_admin, v_org_a, 'admin'), (v_lead, v_org_a, 'area_lead'), (v_member, v_org_a, 'member')
      on conflict (user_id, organization_id) do update set role = excluded.role;
      insert into public.user_active_organizations (user_id, organization_id)
      values (v_admin, v_org_a), (v_lead, v_org_a), (v_member, v_org_a)
      on conflict (user_id) do update set organization_id = excluded.organization_id;
      v_all_orgs := array[v_org_a, v_org_b] || coalesce((select array_agg(m.organization_id) from public.organization_memberships m
                     where m.user_id = any (v_users) and m.organization_id not in (v_org_a, v_org_b)), array[]::uuid[]);

      v_checks := v_checks
        || jsonb_build_object('id', 'SET-01', 'section', 'setup', 'test', 'founders A and B own distinct synthetic organizations',
             'expected', '{"a": "founder", "b": "founder", "distinct": true}'::jsonb,
             'actual', jsonb_build_object(
               'a', (select m.role from public.organization_memberships m where m.user_id = v_fa and m.organization_id = v_org_a),
               'b', (select m.role from public.organization_memberships m where m.user_id = v_fb and m.organization_id = v_org_b),
               'distinct', v_org_a <> v_org_b))
        || jsonb_build_object('id', 'SET-02', 'section', 'setup', 'test', 'organization A has admin, area_lead and member test users with A active',
             'expected', '["admin", "area_lead", "member"]'::jsonb,
             'actual', (select jsonb_agg(m.role order by m.role) from public.organization_memberships m
                        join public.user_active_organizations a on a.user_id = m.user_id and a.organization_id = m.organization_id
                        where m.organization_id = v_org_a and m.user_id in (v_admin, v_lead, v_member)))
        || jsonb_build_object('id', 'SET-03', 'section', 'setup', 'test', 'synthetic organizations start with zero Sales rows', 'expected', 0,
             'actual', (select count(*) from public.sales_pipelines where organization_id = any (v_all_orgs))
                       + (select count(*) from public.sales_audit_log where organization_id = any (v_all_orgs)));
    exception when others then
      get stacked diagnostics v_err_ctx = pg_exception_context;
      v_checks := v_checks || jsonb_build_object('id', 'ERR-setup', 'section', 'setup', 'test', 'setup ran without errors',
        'expected', 'no error', 'actual', sqlerrm || ' [' || sqlstate || ']', 'context', left(v_err_ctx, 400));
      v_halted := 'setup';
    end;

    -- ========================================================================
    -- A + D. AUTHORIZATION and DEFAULT PIPELINE
    -- ========================================================================
    if v_halted is null then
    begin
      v_r := pg_temp.sales_e2e_call(v_fa, 'authenticated', 'select public.sales_ensure_default_pipeline()');
      v_pa := (v_r -> 'value' -> 'pipeline' ->> 'id')::uuid;
      v_checks := v_checks || jsonb_build_object('id', 'A-01', 'section', 'authorization', 'test', 'founder A: first ensure creates the default pipeline',
        'expected', '{"ok": true, "was_created": true, "stages": 6}'::jsonb,
        'actual', jsonb_build_object('ok', v_r -> 'ok', 'was_created', v_r -> 'value' -> 'was_created', 'stages', jsonb_array_length(coalesce(v_r -> 'value' -> 'stages', '[]'::jsonb))));
      v_r2 := pg_temp.sales_e2e_call(v_admin, 'authenticated', 'select public.sales_ensure_default_pipeline()');
      v_checks := v_checks || jsonb_build_object('id', 'A-02', 'section', 'authorization', 'test', 'admin A: ensure is allowed and idempotent (same pipeline, not created)',
        'expected', jsonb_build_object('ok', true, 'was_created', false, 'same_pipeline', true),
        'actual', jsonb_build_object('ok', v_r2 -> 'ok', 'was_created', v_r2 -> 'value' -> 'was_created',
                    'same_pipeline', (v_r2 -> 'value' -> 'pipeline' ->> 'id')::uuid = v_pa));

      select s.id into v_won from public.sales_pipeline_stages s where s.pipeline_id = v_pa and s.key = 'won';
      select s.id into v_lost from public.sales_pipeline_stages s where s.pipeline_id = v_pa and s.key = 'lost';
      select array_agg(s.id order by s.position) into v_ids from public.sales_pipeline_stages s where s.pipeline_id = v_pa and s.status = 'active';

      v_checks := v_checks || jsonb_build_object('id', 'D-01', 'section', 'default_pipeline', 'test', 'canonical default pipeline and 6 stages (key, name, kind, probability, position)',
        'expected', jsonb_build_object('pipelines', 1, 'name', 'Pipeline principal', 'is_default', true, 'stages', jsonb_build_array(
            '["new", "Nuevo", "open", 1000, 1]'::jsonb, '["qualified", "Calificado", "open", 2500, 2]'::jsonb,
            '["proposal", "Propuesta", "open", 5000, 3]'::jsonb, jsonb_build_array('negotiation', U&'Negociaci\00F3n', 'open', 7500, 4),
            '["won", "Ganado", "won", 10000, 5]'::jsonb, '["lost", "Perdido", "lost", 0, 6]'::jsonb)),
        'actual', jsonb_build_object(
          'pipelines', (select count(*) from public.sales_pipelines where organization_id = v_org_a),
          'name', (select name from public.sales_pipelines where id = v_pa),
          'is_default', (select is_default from public.sales_pipelines where id = v_pa),
          'stages', (select jsonb_agg(jsonb_build_array(s.key, s.name, s.kind, s.default_probability_bps, s.position) order by s.position)
                     from public.sales_pipeline_stages s where s.pipeline_id = v_pa)));
      v_checks := v_checks || jsonb_build_object('id', 'D-02', 'section', 'default_pipeline', 'test', 'repeated ensure leaves exactly 1 pipeline, 6 stages, 1 audit row',
        'expected', '{"pipelines": 1, "stages": 6, "audit": ["sales.pipeline.created"]}'::jsonb,
        'actual', jsonb_build_object(
          'pipelines', (select count(*) from public.sales_pipelines where organization_id = v_org_a),
          'stages', (select count(*) from public.sales_pipeline_stages where organization_id = v_org_a),
          'audit', (select jsonb_agg(action order by id) from public.sales_audit_log where organization_id = v_org_a)));

      -- Denials: each of the 5 RPCs.
      for v_txt in select unnest(array['area_lead', 'member', 'ghost', 'no_jwt', 'anon', 'service_role']) loop
        v_r := (select jsonb_agg(pg_temp.sales_e2e_call(
                  case v_txt when 'area_lead' then v_lead when 'member' then v_member when 'ghost' then v_ghost else null end,
                  case v_txt when 'anon' then 'anon' when 'service_role' then 'service_role' else 'authenticated' end,
                  sql) -> 'error' order by n)
                from (values
                  (1, 'select public.sales_ensure_default_pipeline()'),
                  (2, format('select to_jsonb(s) from public.sales_create_stage(%L::uuid, %L, %L, %L, null) s', v_pa, 'x_denied', 'Denied', 'open')),
                  (3, format('select to_jsonb(s) from public.sales_update_stage(%L::uuid, %L::jsonb, 1) s', v_won, '{"name": "Denied"}')),
                  (4, format('select jsonb_agg(to_jsonb(s)) from public.sales_reorder_stages(%L::uuid, %L::uuid[]) s', v_pa, v_ids)),
                  (5, format('select to_jsonb(s) from public.sales_archive_stage(%L::uuid) s', v_won))) as calls(n, sql));
        v_checks := v_checks || jsonb_build_object('id', 'A-' || v_txt, 'section', 'authorization',
          'test', v_txt || ': every Sales RPC is denied',
          'expected', (select jsonb_agg(case v_txt when 'area_lead' then 'SALES_FORBIDDEN' when 'member' then 'SALES_FORBIDDEN'
                         when 'ghost' then 'SALES_NO_ACTIVE_ORGANIZATION' when 'no_jwt' then 'SALES_AUTH_REQUIRED' else 'PERMISSION_DENIED' end)
                       from generate_series(1, 5)),
          'actual', v_r);
      end loop;

      v_checks := v_checks || jsonb_build_object('id', 'A-09', 'section', 'authorization', 'test', 'sales_can matrix (read, manage_pipeline, unknown action) per role',
        'expected', '{"founder": [true, true, false], "admin": [true, true, false], "area_lead": [false, false, false], "member": [false, false, false], "ghost": [false, false, false]}'::jsonb,
        'actual', (select jsonb_object_agg(label, (select jsonb_agg(pg_temp.sales_e2e_call(uid, 'authenticated',
                      format('select to_jsonb(private.sales_can(%L))', act)) -> 'value' order by n)
                    from (values (1, 'read'), (2, 'manage_pipeline'), (3, 'manage_everything')) as a(n, act)))
                   from (values ('founder', v_fa), ('admin', v_admin), ('area_lead', v_lead), ('member', v_member), ('ghost', v_ghost)) as u(label, uid)));
      v_checks := v_checks || jsonb_build_object('id', 'A-10', 'section', 'authorization', 'test', 'denied calls changed nothing (still 6 stages, 1 audit row in A)',
        'expected', '{"stages": 6, "audit": 1}'::jsonb,
        'actual', jsonb_build_object('stages', (select count(*) from public.sales_pipeline_stages where organization_id = v_org_a),
                                     'audit', (select count(*) from public.sales_audit_log where organization_id = v_org_a)));
      execute 'set constraints all immediate';
      execute 'set constraints all deferred';
    exception when others then
      get stacked diagnostics v_err_ctx = pg_exception_context;
      v_checks := v_checks || jsonb_build_object('id', 'ERR-authorization', 'section', 'authorization', 'test', 'section ran without unexpected errors',
        'expected', 'no error', 'actual', sqlerrm || ' [' || sqlstate || ']', 'context', left(v_err_ctx, 400));
      v_halted := 'authorization';
    end;
    perform set_config('role', 'postgres', true);
    end if;

    -- ========================================================================
    -- B. MULTI-TENANT ISOLATION
    -- ========================================================================
    if v_halted is null then
    begin
      v_r := pg_temp.sales_e2e_call(v_fb, 'authenticated', 'select public.sales_ensure_default_pipeline()');
      v_pb := (v_r -> 'value' -> 'pipeline' ->> 'id')::uuid;
      select s.id into v_b_stage from public.sales_pipeline_stages s where s.pipeline_id = v_pb and s.key = 'proposal';
      select array_agg(s.id order by s.position) into v_ids_b from public.sales_pipeline_stages s where s.pipeline_id = v_pb;
      select md5(string_agg(to_jsonb(s)::text, ',' order by s.id)) into v_b_md5_before from public.sales_pipeline_stages s where s.organization_id = v_org_b;

      v_checks := v_checks || jsonb_build_object('id', 'B-01', 'section', 'isolation', 'test', 'each founder reads only their own organization''s Sales rows',
        'expected', jsonb_build_object('a', jsonb_build_object('orgs', jsonb_build_array(v_org_a), 'stages', 6, 'audit_orgs', jsonb_build_array(v_org_a)),
                                       'b', jsonb_build_object('orgs', jsonb_build_array(v_org_b), 'stages', 6, 'audit_orgs', jsonb_build_array(v_org_b))),
        'actual', (select jsonb_object_agg(label, pg_temp.sales_e2e_call(uid, 'authenticated',
                     'select jsonb_build_object(''orgs'', (select jsonb_agg(distinct organization_id) from public.sales_pipelines),'
                     || ' ''stages'', (select count(*) from public.sales_pipeline_stages),'
                     || ' ''audit_orgs'', (select jsonb_agg(distinct organization_id) from public.sales_audit_log))') -> 'value')
                   from (values ('a', v_fa), ('b', v_fb)) as u(label, uid)));
      v_checks := v_checks || jsonb_build_object('id', 'B-02', 'section', 'isolation', 'test', 'area_lead, member and ghost read zero Sales rows',
        'expected', '[0, 0, 0]'::jsonb,
        'actual', (select jsonb_agg(pg_temp.sales_e2e_call(uid, 'authenticated',
                     'select to_jsonb((select count(*) from public.sales_pipelines) + (select count(*) from public.sales_pipeline_stages) + (select count(*) from public.sales_audit_log))') -> 'value' order by n)
                   from (values (1, v_lead), (2, v_member), (3, v_ghost)) as u(n, uid)));
      v_checks := v_checks || jsonb_build_object('id', 'B-03', 'section', 'isolation', 'test', 'targeted reads of B ids by founder A return nothing',
        'expected', '0'::jsonb,
        'actual', pg_temp.sales_e2e_call(v_fa, 'authenticated', format(
          'select to_jsonb((select count(*) from public.sales_pipelines where id = %L) + (select count(*) from public.sales_pipeline_stages where pipeline_id = %L))', v_pb, v_pb)) -> 'value');
      v_checks := v_checks || jsonb_build_object('id', 'B-04', 'section', 'isolation', 'test', 'founder A RPCs cannot touch organization B ids',
        'expected', '["SALES_NOT_FOUND", "SALES_NOT_FOUND", "SALES_NOT_FOUND", "SALES_NOT_FOUND", "SALES_INVALID_STAGE_SET"]'::jsonb,
        'actual', (select jsonb_agg(pg_temp.sales_e2e_call(v_fa, 'authenticated', sql) -> 'error' order by n) from (values
          (1, format('select to_jsonb(s) from public.sales_create_stage(%L::uuid, %L, %L, %L, null) s', v_pb, 'intruder', 'Intruder', 'open')),
          (2, format('select to_jsonb(s) from public.sales_update_stage(%L::uuid, %L::jsonb, 1) s', v_b_stage, '{"name": "Owned"}')),
          (3, format('select to_jsonb(s) from public.sales_archive_stage(%L::uuid) s', v_b_stage)),
          (4, format('select jsonb_agg(to_jsonb(s)) from public.sales_reorder_stages(%L::uuid, %L::uuid[]) s', v_pb, v_ids_b)),
          (5, format('select jsonb_agg(to_jsonb(s)) from public.sales_reorder_stages(%L::uuid, %L::uuid[]) s', v_pa,
                     (select array_agg(case when x.ord = 3 then v_b_stage else x.id end order by x.ord) from unnest(v_ids) with ordinality x(id, ord))))) as calls(n, sql)));
      v_checks := v_checks || jsonb_build_object('id', 'B-05', 'section', 'isolation', 'test', 'organization B rows and audit unchanged by A''s attempts',
        'expected', jsonb_build_object('rows', v_b_md5_before, 'audit', 1),
        'actual', jsonb_build_object('rows', (select md5(string_agg(to_jsonb(s)::text, ',' order by s.id)) from public.sales_pipeline_stages s where s.organization_id = v_org_b),
                                     'audit', (select count(*) from public.sales_audit_log where organization_id = v_org_b)));
      execute 'set constraints all immediate';
      execute 'set constraints all deferred';
    exception when others then
      get stacked diagnostics v_err_ctx = pg_exception_context;
      v_checks := v_checks || jsonb_build_object('id', 'ERR-isolation', 'section', 'isolation', 'test', 'section ran without unexpected errors',
        'expected', 'no error', 'actual', sqlerrm || ' [' || sqlstate || ']', 'context', left(v_err_ctx, 400));
    end;
    perform set_config('role', 'postgres', true);
    end if;

    -- ========================================================================
    -- C. DIRECT TABLE WRITES
    -- ========================================================================
    if v_halted is null then
    begin
      v_checks := v_checks || jsonb_build_object('id', 'C-01', 'section', 'direct_writes', 'test', 'authenticated founder: direct INSERT/UPDATE/DELETE/TRUNCATE denied on every Sales table',
        'expected', (select jsonb_agg('PERMISSION_DENIED'::text) from generate_series(1, 12)),
        'actual', (select jsonb_agg(pg_temp.sales_e2e_call(v_fa, 'authenticated', sql) -> 'error' order by n) from (values
          (1, format('insert into public.sales_pipelines (organization_id, name, created_by) values (%L, %L, %L) returning to_jsonb(id)', v_org_a, 'Direct', v_fa)),
          (2, format('update public.sales_pipelines set name = %L where id = %L returning to_jsonb(id)', 'Hacked', v_pa)),
          (3, format('delete from public.sales_pipelines where id = %L returning to_jsonb(id)', v_pa)),
          (4, format('insert into public.sales_pipeline_stages (organization_id, pipeline_id, key, name, kind, default_probability_bps, position, created_by) values (%L, %L, %L, %L, %L, 0, 7, %L) returning to_jsonb(id)', v_org_a, v_pa, 'direct', 'Direct', 'open', v_fa)),
          (5, format('update public.sales_pipeline_stages set name = %L where id = %L returning to_jsonb(id)', 'Hacked', v_won)),
          (6, format('delete from public.sales_pipeline_stages where id = %L returning to_jsonb(id)', v_won)),
          (7, format('insert into public.sales_audit_log (organization_id, actor_user_id, action, entity_type, entity_id) values (%L, %L, %L, %L, %L) returning to_jsonb(id)', v_org_a, v_fa, 'sales.stage.created', 'stage', v_won)),
          (8, 'update public.sales_audit_log set details = ''{}'' returning to_jsonb(id)'),
          (9, 'delete from public.sales_audit_log returning to_jsonb(id)'),
          (10, 'truncate public.sales_audit_log'),
          (11, 'truncate public.sales_pipeline_stages'),
          (12, 'truncate public.sales_pipelines')) as calls(n, sql)));
      v_checks := v_checks || jsonb_build_object('id', 'C-02', 'section', 'direct_writes', 'test', 'anon and service_role: no SELECT and no INSERT',
        'expected', '["PERMISSION_DENIED", "PERMISSION_DENIED", "PERMISSION_DENIED", "PERMISSION_DENIED"]'::jsonb,
        'actual', (select jsonb_agg(pg_temp.sales_e2e_call(null, r, sql) -> 'error' order by r, n) from (values
          (1, 'select to_jsonb(count(*)) from public.sales_pipelines'),
          (2, format('insert into public.sales_pipelines (organization_id, name, created_by) values (%L, %L, %L) returning to_jsonb(id)', v_org_a, 'Direct', v_fa))) as calls(n, sql),
          unnest(array['anon', 'service_role']) r));
      v_checks := v_checks || jsonb_build_object('id', 'C-03', 'section', 'direct_writes', 'test', 'nothing changed (6 stages, names intact, 1 audit row in A)',
        'expected', '{"stages": 6, "won_name": "Ganado", "audit": 1}'::jsonb,
        'actual', jsonb_build_object('stages', (select count(*) from public.sales_pipeline_stages where organization_id = v_org_a),
                                     'won_name', (select name from public.sales_pipeline_stages where id = v_won),
                                     'audit', (select count(*) from public.sales_audit_log where organization_id = v_org_a)));
    exception when others then
      get stacked diagnostics v_err_ctx = pg_exception_context;
      v_checks := v_checks || jsonb_build_object('id', 'ERR-direct_writes', 'section', 'direct_writes', 'test', 'section ran without unexpected errors',
        'expected', 'no error', 'actual', sqlerrm || ' [' || sqlstate || ']', 'context', left(v_err_ctx, 400));
    end;
    perform set_config('role', 'postgres', true);
    end if;

    -- ========================================================================
    -- E. STAGE CREATION
    -- ========================================================================
    if v_halted is null then
    begin
      v_r := pg_temp.sales_e2e_call(v_admin, 'authenticated', format(
        'select to_jsonb(s) from public.sales_create_stage(%L::uuid, %L, %L, %L, 6000) s', v_pa, 'follow_up', '  Seguimiento  ', 'open'));
      v_follow := (v_r -> 'value' ->> 'id')::uuid;
      v_checks := v_checks || jsonb_build_object('id', 'E-01', 'section', 'stage_creation', 'test', 'admin creates an open stage: appended at position 7, name trimmed, version 1',
        'expected', '{"ok": true, "position": 7, "name": "Seguimiento", "version": 1, "probability": 6000}'::jsonb,
        'actual', jsonb_build_object('ok', v_r -> 'ok', 'position', v_r -> 'value' -> 'position', 'name', v_r -> 'value' -> 'name',
                                     'version', v_r -> 'value' -> 'version', 'probability', v_r -> 'value' -> 'default_probability_bps'));
      v_checks := v_checks || jsonb_build_object('id', 'E-02', 'section', 'stage_creation', 'test', 'duplicate key, duplicate name (case-insensitive), second won stage, invalid key are rejected',
        'expected', '["SALES_STAGE_KEY_EXISTS", "SALES_STAGE_NAME_EXISTS", "SALES_WON_STAGE_EXISTS", "SALES_INVALID_INPUT", "SALES_INVALID_INPUT"]'::jsonb,
        'actual', (select jsonb_agg(pg_temp.sales_e2e_call(v_fa, 'authenticated', sql) -> 'error' order by n) from (values
          (1, format('select to_jsonb(s) from public.sales_create_stage(%L::uuid, %L, %L, %L, null) s', v_pa, 'follow_up', 'Otro', 'open')),
          (2, format('select to_jsonb(s) from public.sales_create_stage(%L::uuid, %L, %L, %L, null) s', v_pa, 'other_key', 'SEGUIMIENTO', 'open')),
          (3, format('select to_jsonb(s) from public.sales_create_stage(%L::uuid, %L, %L, %L, null) s', v_pa, 'won_two', 'Ganado 2', 'won')),
          (4, format('select to_jsonb(s) from public.sales_create_stage(%L::uuid, %L, %L, %L, null) s', v_pa, 'Bad-Key', 'Name', 'open')),
          (5, format('select to_jsonb(s) from public.sales_create_stage(%L::uuid, %L, %L, %L, 5000) s', v_pa, 'lost_x', 'Perdido X', 'lost'))) as calls(n, sql)));

      -- 50-stage limit in a nested savepoint that is always rolled back.
      begin
        v_r := (select jsonb_agg(pg_temp.sales_e2e_call(v_fa, 'authenticated', format(
                  'select to_jsonb(s.position) from public.sales_create_stage(%L::uuid, %L, %L, %L, null) s', v_pa, 'extra_' || i, 'Extra ' || i, 'open')) -> 'ok')
                from generate_series(8, 50) i);
        v_checks := v_checks || jsonb_build_object('id', 'E-03', 'section', 'stage_creation', 'test', '50-stage limit: stages 8..50 succeed, the 51st is rejected, positions 1..50',
          'expected', '{"created_ok": true, "limit": "SALES_STAGE_LIMIT", "active": 50, "contiguous": true}'::jsonb,
          'actual', jsonb_build_object(
            'created_ok', (select bool_and(x::text::boolean) from jsonb_array_elements(v_r) x),
            'limit', pg_temp.sales_e2e_call(v_fa, 'authenticated', format(
              'select to_jsonb(s) from public.sales_create_stage(%L::uuid, %L, %L, %L, null) s', v_pa, 'extra_51', 'Extra 51', 'open')) -> 'error',
            'active', (select count(*) from public.sales_pipeline_stages where pipeline_id = v_pa and status = 'active'),
            'contiguous', (select array_agg(position order by position) = array(select generate_series(1, 50))
                           from public.sales_pipeline_stages where pipeline_id = v_pa and status = 'active')));
        execute 'set constraints all immediate';
        raise exception using message = 'SALES_E2E_SUBSCENARIO_ROLLBACK';
      exception when others then
        if sqlerrm <> 'SALES_E2E_SUBSCENARIO_ROLLBACK' then
          v_checks := v_checks || jsonb_build_object('id', 'ERR-stage_limit', 'section', 'stage_creation', 'test', 'limit sub-scenario ran without unexpected errors',
            'expected', 'no error', 'actual', sqlerrm || ' [' || sqlstate || ']');
        end if;
      end;
      execute 'set constraints all deferred';
      v_checks := v_checks || jsonb_build_object('id', 'E-04', 'section', 'stage_creation', 'test', 'limit sub-scenario fully rolled back (7 active stages, 2 audit rows)',
        'expected', '{"active": 7, "audit": 2}'::jsonb,
        'actual', jsonb_build_object('active', (select count(*) from public.sales_pipeline_stages where pipeline_id = v_pa and status = 'active'),
                                     'audit', (select count(*) from public.sales_audit_log where organization_id = v_org_a)));
      execute 'set constraints all immediate';
      execute 'set constraints all deferred';
    exception when others then
      get stacked diagnostics v_err_ctx = pg_exception_context;
      v_checks := v_checks || jsonb_build_object('id', 'ERR-stage_creation', 'section', 'stage_creation', 'test', 'section ran without unexpected errors',
        'expected', 'no error', 'actual', sqlerrm || ' [' || sqlstate || ']', 'context', left(v_err_ctx, 400));
    end;
    perform set_config('role', 'postgres', true);
    end if;

    -- ========================================================================
    -- F. UPDATE / OPTIMISTIC LOCKING
    -- ========================================================================
    if v_halted is null then
    begin
      v_r := pg_temp.sales_e2e_call(v_fa, 'authenticated', format(
        'select to_jsonb(s) from public.sales_update_stage(%L::uuid, %L::jsonb, 1) s', v_follow, '{"name": "Seguimiento activo", "default_probability_bps": 6500}'));
      v_checks := v_checks || jsonb_build_object('id', 'F-01', 'section', 'update', 'test', 'update with the correct expected_version succeeds and bumps version to 2',
        'expected', '{"ok": true, "version": 2, "name": "Seguimiento activo", "probability": 6500}'::jsonb,
        'actual', jsonb_build_object('ok', v_r -> 'ok', 'version', v_r -> 'value' -> 'version', 'name', v_r -> 'value' -> 'name',
                                     'probability', v_r -> 'value' -> 'default_probability_bps'));
      select count(*) into v_audit_n from public.sales_audit_log where organization_id = v_org_a;
      v_checks := v_checks || jsonb_build_object('id', 'F-02', 'section', 'update', 'test', 'stale version conflicts; invalid patches rejected; won probability fixed',
        'expected', '["SALES_VERSION_CONFLICT", "SALES_VERSION_CONFLICT", "SALES_INVALID_INPUT", "SALES_INVALID_INPUT", "SALES_INVALID_INPUT", "SALES_INVALID_INPUT"]'::jsonb,
        'actual', (select jsonb_agg(pg_temp.sales_e2e_call(v_admin, 'authenticated', sql) -> 'error' order by n) from (values
          (1, format('select to_jsonb(s) from public.sales_update_stage(%L::uuid, %L::jsonb, 1) s', v_follow, '{"name": "Stale"}')),
          (2, format('select to_jsonb(s) from public.sales_update_stage(%L::uuid, %L::jsonb, 9) s', v_follow, '{"name": "Future"}')),
          (3, format('select to_jsonb(s) from public.sales_update_stage(%L::uuid, %L::jsonb, 2) s', v_follow, '{"key": "renamed"}')),
          (4, format('select to_jsonb(s) from public.sales_update_stage(%L::uuid, %L::jsonb, 2) s', v_follow, '{"default_probability_bps": 12.5}')),
          (5, format('select to_jsonb(s) from public.sales_update_stage(%L::uuid, %L::jsonb, 2) s', v_follow, '{}')),
          (6, format('select to_jsonb(s) from public.sales_update_stage(%L::uuid, %L::jsonb, 1) s', v_won, '{"default_probability_bps": 9000}'))) as calls(n, sql)));
      v_r := pg_temp.sales_e2e_call(v_admin, 'authenticated', format(
        'select to_jsonb(s) from public.sales_update_stage(%L::uuid, %L::jsonb, 2) s', v_follow, '{"name": "  Seguimiento activo "}'));
      v_checks := v_checks || jsonb_build_object('id', 'F-03', 'section', 'update', 'test', 'no-op update keeps version 2; failures and no-op wrote no audit row',
        'expected', jsonb_build_object('ok', true, 'version', 2, 'audit', v_audit_n),
        'actual', jsonb_build_object('ok', v_r -> 'ok', 'version', (select version from public.sales_pipeline_stages where id = v_follow),
                                     'audit', (select count(*) from public.sales_audit_log where organization_id = v_org_a)));
    exception when others then
      get stacked diagnostics v_err_ctx = pg_exception_context;
      v_checks := v_checks || jsonb_build_object('id', 'ERR-update', 'section', 'update', 'test', 'section ran without unexpected errors',
        'expected', 'no error', 'actual', sqlerrm || ' [' || sqlstate || ']', 'context', left(v_err_ctx, 400));
    end;
    perform set_config('role', 'postgres', true);
    end if;

    -- ========================================================================
    -- H. ARCHIVE GUARDS (before G so that an archived id exists)
    -- ========================================================================
    if v_halted is null then
    begin
      v_checks := v_checks || jsonb_build_object('id', 'H-01', 'section', 'archive', 'test', 'the won stage and the only lost stage cannot be archived',
        'expected', '["SALES_LAST_WON_STAGE", "SALES_LAST_LOST_STAGE"]'::jsonb,
        'actual', jsonb_build_array(
          pg_temp.sales_e2e_call(v_fa, 'authenticated', format('select to_jsonb(s) from public.sales_archive_stage(%L::uuid) s', v_won)) -> 'error',
          pg_temp.sales_e2e_call(v_fa, 'authenticated', format('select to_jsonb(s) from public.sales_archive_stage(%L::uuid) s', v_lost)) -> 'error'));
      v_r := pg_temp.sales_e2e_call(v_fa, 'authenticated', format(
        'select to_jsonb(s) from public.sales_create_stage(%L::uuid, %L, %L, %L, null) s', v_pa, 'lost_b', 'Perdido B', 'lost'));
      v_lost_b := (v_r -> 'value' ->> 'id')::uuid;
      -- Each RPC call is its own statement so that later reads see its effects.
      v_r := pg_temp.sales_e2e_call(v_admin, 'authenticated', format('select to_jsonb(s) from public.sales_archive_stage(%L::uuid) s', v_lost));
      v_r2 := pg_temp.sales_e2e_call(v_fa, 'authenticated', format('select to_jsonb(s) from public.sales_archive_stage(%L::uuid) s', v_lost_b));
      v_checks := v_checks || jsonb_build_object('id', 'H-02', 'section', 'archive', 'test', 'with two lost stages one can be archived; then the remaining one cannot',
        'expected', '{"first": "archived", "second": "SALES_LAST_LOST_STAGE", "active_lost": 1}'::jsonb,
        'actual', jsonb_build_object(
          'first', v_r -> 'value' -> 'status',
          'second', v_r2 -> 'error',
          'active_lost', (select count(*) from public.sales_pipeline_stages where pipeline_id = v_pa and kind = 'lost' and status = 'active')));
      v_r := pg_temp.sales_e2e_call(v_fa, 'authenticated', format('select to_jsonb(s) from public.sales_archive_stage(%L::uuid) s', v_follow));
      v_checks := v_checks || jsonb_build_object('id', 'H-03', 'section', 'archive', 'test', 'archiving an open stage compacts positions to 1..n; re-archive is a no-op',
        'expected', '{"status": "archived", "position": null, "contiguous": true, "rearchive_ok": true}'::jsonb,
        'actual', jsonb_build_object('status', v_r -> 'value' -> 'status', 'position', v_r -> 'value' -> 'position',
          'contiguous', (select min(position) = 1 and max(position) = count(*) and count(distinct position) = count(*)
                         from public.sales_pipeline_stages where pipeline_id = v_pa and status = 'active'),
          'rearchive_ok', pg_temp.sales_e2e_call(v_fa, 'authenticated', format('select to_jsonb(s) from public.sales_archive_stage(%L::uuid) s', v_follow)) -> 'ok'));
      execute 'set constraints all immediate';
      execute 'set constraints all deferred';
    exception when others then
      get stacked diagnostics v_err_ctx = pg_exception_context;
      v_checks := v_checks || jsonb_build_object('id', 'ERR-archive', 'section', 'archive', 'test', 'section ran without unexpected errors',
        'expected', 'no error', 'actual', sqlerrm || ' [' || sqlstate || ']', 'context', left(v_err_ctx, 400));
    end;
    perform set_config('role', 'postgres', true);
    end if;

    -- ========================================================================
    -- G. REORDER
    -- ========================================================================
    if v_halted is null then
    begin
      select array_agg(s.id order by s.position desc) into v_ids from public.sales_pipeline_stages s where s.pipeline_id = v_pa and s.status = 'active';
      v_r := pg_temp.sales_e2e_call(v_fa, 'authenticated', format(
        'select jsonb_agg(s.id order by s.position) from public.sales_reorder_stages(%L::uuid, %L::uuid[]) s', v_pa, v_ids));
      v_checks := v_checks || jsonb_build_object('id', 'G-01', 'section', 'reorder', 'test', 'valid reorder (reversed) is returned and persisted in the requested order',
        'expected', jsonb_build_object('returned', to_jsonb(v_ids), 'persisted', to_jsonb(v_ids)),
        'actual', jsonb_build_object('returned', v_r -> 'value',
          'persisted', (select jsonb_agg(s.id order by s.position) from public.sales_pipeline_stages s where s.pipeline_id = v_pa and s.status = 'active')));
      select count(*) into v_audit_n from public.sales_audit_log where organization_id = v_org_a;
      v_checks := v_checks || jsonb_build_object('id', 'G-02', 'section', 'reorder', 'test', 'missing, duplicate, foreign-org, archived and unknown ids are rejected',
        'expected', '["SALES_INVALID_STAGE_SET", "SALES_INVALID_STAGE_SET", "SALES_INVALID_STAGE_SET", "SALES_INVALID_STAGE_SET", "SALES_INVALID_STAGE_SET", "SALES_INVALID_INPUT"]'::jsonb,
        'actual', (select jsonb_agg(pg_temp.sales_e2e_call(v_fa, 'authenticated', format(
                     'select jsonb_agg(s.id) from public.sales_reorder_stages(%L::uuid, %L::uuid[]) s', v_pa, ids)) -> 'error' order by n) from (values
          (1, v_ids[2:]),
          (2, array[v_ids[1]] || v_ids[1:array_length(v_ids, 1) - 1]),
          (3, v_ids[1:array_length(v_ids, 1) - 1] || v_b_stage),
          (4, v_ids[1:array_length(v_ids, 1) - 1] || v_follow),
          (5, v_ids || gen_random_uuid()),
          (6, array[]::uuid[])) as calls(n, ids)));
      v_r2 := jsonb_build_object(
        'persisted', (select jsonb_agg(s.id order by s.position) from public.sales_pipeline_stages s where s.pipeline_id = v_pa and s.status = 'active'),
        'audit', (select count(*) from public.sales_audit_log where organization_id = v_org_a),
        'versions', (select jsonb_agg(s.version order by s.position) from public.sales_pipeline_stages s where s.pipeline_id = v_pa and s.status = 'active'));
      -- The no-op call is its own statement so that the following read sees its effects.
      v_r := pg_temp.sales_e2e_call(v_fa, 'authenticated', format(
        'select jsonb_agg(s.id) from public.sales_reorder_stages(%L::uuid, %L::uuid[]) s', v_pa, v_ids));
      v_checks := v_checks || jsonb_build_object('id', 'G-03', 'section', 'reorder', 'test', 'rejected reorders changed nothing and wrote no audit row; identical order is a no-op (no audit, no version bump)',
        'expected', jsonb_build_object('persisted', to_jsonb(v_ids), 'audit', v_audit_n, 'noop_ok', true, 'audit_after_noop', v_audit_n,
                                       'versions_after_noop', v_r2 -> 'versions'),
        'actual', (v_r2 - 'versions') || jsonb_build_object(
          'noop_ok', v_r -> 'ok',
          'audit_after_noop', (select count(*) from public.sales_audit_log where organization_id = v_org_a),
          'versions_after_noop', (select jsonb_agg(s.version order by s.position) from public.sales_pipeline_stages s where s.pipeline_id = v_pa and s.status = 'active')));
      execute 'set constraints all immediate';
      execute 'set constraints all deferred';
    exception when others then
      get stacked diagnostics v_err_ctx = pg_exception_context;
      v_checks := v_checks || jsonb_build_object('id', 'ERR-reorder', 'section', 'reorder', 'test', 'section ran without unexpected errors',
        'expected', 'no error', 'actual', sqlerrm || ' [' || sqlstate || ']', 'context', left(v_err_ctx, 400));
    end;
    perform set_config('role', 'postgres', true);
    end if;

    -- ========================================================================
    -- I. COMMIT-TIME INVARIANTS (owner-level writes bypassing the RPCs)
    -- ========================================================================
    if v_halted is null then
    begin
      begin
        execute 'set constraints all immediate';
        v_txt := 'OK';
      exception when others then v_txt := sqlerrm;
      end;
      execute 'set constraints all deferred';
      v_checks := v_checks || jsonb_build_object('id', 'CHK-01', 'section', 'invariants', 'test', 'all state produced through the RPCs satisfies the commit-time invariants',
        'expected', 'OK', 'actual', v_txt);
      v_r := '[]'::jsonb;
      -- I-1: archive the won stage directly.
      begin
        update public.sales_pipeline_stages set status = 'archived', position = null, archived_at = now(), archived_by = v_fa where id = v_won;
        execute 'set constraints all immediate';
        v_r := v_r || to_jsonb('NO ERROR'::text);
      exception when others then v_r := v_r || to_jsonb(sqlerrm);
      end;
      execute 'set constraints all deferred';
      -- I-2: archive the last lost stage directly.
      begin
        update public.sales_pipeline_stages set status = 'archived', position = null, archived_at = now(), archived_by = v_fa where id = v_lost_b;
        execute 'set constraints all immediate';
        v_r := v_r || to_jsonb('NO ERROR'::text);
      exception when others then v_r := v_r || to_jsonb(sqlerrm);
      end;
      execute 'set constraints all deferred';
      -- I-3: a second active won stage.
      begin
        insert into public.sales_pipeline_stages (organization_id, pipeline_id, key, name, kind, default_probability_bps, position, created_by)
        values (v_org_a, v_pa, 'won_two', 'Ganado 2', 'won', 10000,
                (select count(*) + 1 from public.sales_pipeline_stages where pipeline_id = v_pa and status = 'active'), v_fa);
        v_r := v_r || to_jsonb('NO ERROR'::text);
      exception when others then
        get stacked diagnostics v_txt = constraint_name;
        v_r := v_r || to_jsonb(coalesce(nullif(v_txt, ''), sqlerrm));
      end;
      -- I-4: delete, identity change and restore are rejected.
      begin
        delete from public.sales_pipeline_stages where id = v_follow;
        v_r := v_r || to_jsonb('NO ERROR'::text);
      exception when others then v_r := v_r || to_jsonb(sqlerrm);
      end;
      begin
        update public.sales_pipeline_stages set key = 'renamed' where id = v_won;
        v_r := v_r || to_jsonb('NO ERROR'::text);
      exception when others then v_r := v_r || to_jsonb(sqlerrm);
      end;
      begin
        update public.sales_pipeline_stages set status = 'active', position = 99, archived_at = null, archived_by = null where id = v_follow;
        v_r := v_r || to_jsonb('NO ERROR'::text);
      exception when others then v_r := v_r || to_jsonb(sqlerrm);
      end;
      v_checks := v_checks || jsonb_build_object('id', 'I-01', 'section', 'invariants', 'test', 'owner-level writes that break invariants fail closed',
        'expected', '["SALES_TERMINAL_STAGE_INVARIANT", "SALES_TERMINAL_STAGE_INVARIANT", "sales_pipeline_stages_one_active_won_idx", "SALES_IMMUTABLE", "SALES_IMMUTABLE", "SALES_IMMUTABLE"]'::jsonb,
        'actual', v_r);
      v_checks := v_checks || jsonb_build_object('id', 'I-02', 'section', 'invariants', 'test', 'pipeline still valid after the failed attempts (1 won, 1 lost, contiguous)',
        'expected', '{"won": 1, "lost": 1, "contiguous": true}'::jsonb,
        'actual', (select jsonb_build_object('won', count(*) filter (where kind = 'won'), 'lost', count(*) filter (where kind = 'lost'),
                     'contiguous', min(position) = 1 and max(position) = count(*) and count(distinct position) = count(*))
                   from public.sales_pipeline_stages where pipeline_id = v_pa and status = 'active'));
      execute 'set constraints all immediate';
      execute 'set constraints all deferred';
    exception when others then
      get stacked diagnostics v_err_ctx = pg_exception_context;
      v_checks := v_checks || jsonb_build_object('id', 'ERR-invariants', 'section', 'invariants', 'test', 'section ran without unexpected errors',
        'expected', 'no error', 'actual', sqlerrm || ' [' || sqlstate || ']', 'context', left(v_err_ctx, 400));
    end;
    perform set_config('role', 'postgres', true);
    end if;

    -- ========================================================================
    -- J. AUDIT
    -- ========================================================================
    if v_halted is null then
    begin
      v_checks := v_checks || jsonb_build_object('id', 'J-01', 'section', 'audit', 'test', 'exactly one audit row per successful mutation, in order, with the acting user',
        'expected', jsonb_build_array(
          jsonb_build_array('sales.pipeline.created', 'pipeline', v_pa, v_fa),
          jsonb_build_array('sales.stage.created', 'stage', v_follow, v_admin),
          jsonb_build_array('sales.stage.updated', 'stage', v_follow, v_fa),
          jsonb_build_array('sales.stage.created', 'stage', v_lost_b, v_fa),
          jsonb_build_array('sales.stage.archived', 'stage', v_lost, v_admin),
          jsonb_build_array('sales.stage.archived', 'stage', v_follow, v_fa),
          jsonb_build_array('sales.stages.reordered', 'pipeline', v_pa, v_fa)),
        'actual', (select jsonb_agg(jsonb_build_array(action, entity_type, entity_id, actor_user_id) order by id)
                   from public.sales_audit_log where organization_id = v_org_a));
      v_checks := v_checks || jsonb_build_object('id', 'J-02', 'section', 'audit', 'test', 'update audit details record the change and versions',
        'expected', '{"version_from": 1, "version_to": 2, "changes": {"name": {"from": "Seguimiento", "to": "Seguimiento activo"}, "default_probability_bps": {"from": 6000, "to": 6500}}}'::jsonb,
        'actual', (select details - 'pipeline_id' from public.sales_audit_log where organization_id = v_org_a and action = 'sales.stage.updated'));
      v_r := jsonb_build_array(
        pg_temp.sales_e2e_call(null, 'postgres', format('update public.sales_audit_log set details = %L where organization_id = %L returning to_jsonb(id)', '{"forged": true}', v_org_a)) -> 'error',
        pg_temp.sales_e2e_call(null, 'postgres', format('delete from public.sales_audit_log where organization_id = %L returning to_jsonb(id)', v_org_a)) -> 'error',
        pg_temp.sales_e2e_call(null, 'postgres', 'truncate public.sales_audit_log') -> 'error',
        pg_temp.sales_e2e_call(v_fa, 'authenticated', 'update public.sales_audit_log set details = ''{}'' returning to_jsonb(id)') -> 'error',
        pg_temp.sales_e2e_call(v_fa, 'authenticated', 'delete from public.sales_audit_log returning to_jsonb(id)') -> 'error');
      v_checks := v_checks || jsonb_build_object('id', 'J-03', 'section', 'audit', 'test', 'audit is append-only: owner UPDATE/DELETE/TRUNCATE rejected by trigger; authenticated denied',
        'expected', '["SALES_IMMUTABLE", "SALES_IMMUTABLE", "SALES_IMMUTABLE", "PERMISSION_DENIED", "PERMISSION_DENIED"]'::jsonb,
        'actual', v_r);
      v_checks := v_checks || jsonb_build_object('id', 'J-04', 'section', 'audit', 'test', 'audit rows intact after the attempts (7 in A, 1 in B, none forged)',
        'expected', '{"a": 7, "b": 1, "forged": 0}'::jsonb,
        'actual', jsonb_build_object('a', (select count(*) from public.sales_audit_log where organization_id = v_org_a),
                                     'b', (select count(*) from public.sales_audit_log where organization_id = v_org_b),
                                     'forged', (select count(*) from public.sales_audit_log where details ? 'forged')));
    exception when others then
      get stacked diagnostics v_err_ctx = pg_exception_context;
      v_checks := v_checks || jsonb_build_object('id', 'ERR-audit', 'section', 'audit', 'test', 'section ran without unexpected errors',
        'expected', 'no error', 'actual', sqlerrm || ' [' || sqlstate || ']', 'context', left(v_err_ctx, 400));
    end;
    perform set_config('role', 'postgres', true);
    end if;

    -- Always discard every scenario write.
    raise exception using message = 'SALES_E2E_ROLLBACK_SENTINEL';
  exception when others then
    if sqlerrm <> 'SALES_E2E_ROLLBACK_SENTINEL' then
      get stacked diagnostics v_err_ctx = pg_exception_context;
      v_checks := v_checks || jsonb_build_object('id', 'ERR-runner', 'section', 'runner', 'test', 'scenario ran without an unhandled error',
        'expected', 'no error', 'actual', sqlerrm || ' [' || sqlstate || ']', 'context', left(v_err_ctx, 400));
    end if;
  end;
  end if;

  -- ==========================================================================
  -- K. POST-ROLLBACK VERIFICATION (outside the scenario savepoint)
  -- ==========================================================================
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claim.sub', '', true), set_config('request.jwt.claims', '', true);
  if v_blocked is null then
    v_checks := v_checks || jsonb_build_object('id', 'K-01', 'section', 'cleanup', 'test', 'no synthetic user, organization, membership or Sales row of this run remains',
      'expected', '{"auth_users": 0, "organizations": 0, "memberships": 0, "active_orgs": 0, "sales_audit": 0, "sales_pipelines": 0, "sales_stages": 0}'::jsonb,
      'actual', jsonb_build_object(
        'auth_users', (select count(*) from auth.users u where u.id = any (v_users) or u.email like v_tag || '%'),
        'organizations', (select count(*) from public.organizations o where o.name like v_tag || '%' or o.id = any (coalesce(v_all_orgs, array[]::uuid[]))),
        'memberships', (select count(*) from public.organization_memberships m where m.user_id = any (v_users)),
        'active_orgs', (select count(*) from public.user_active_organizations a where a.user_id = any (v_users)),
        'sales_audit', (select count(*) from public.sales_audit_log),
        'sales_pipelines', (select count(*) from public.sales_pipelines),
        'sales_stages', (select count(*) from public.sales_pipeline_stages)));
    v_checks := v_checks || jsonb_build_object('id', 'K-02', 'section', 'cleanup', 'test', 'migration history unchanged (count and Sales row)',
      'expected', jsonb_build_object('count', v_hist_before, 'sales_md5', 'ef72b4f0727cfa6053d2eb8efafd3247'),
      'actual', jsonb_build_object('count', (select count(*) from supabase_migrations.schema_migrations),
        'sales_md5', (select md5(replace(statements[1], chr(13), '')) from supabase_migrations.schema_migrations where version = '20261002120000')));
    execute v_digest_sql into v_r;
    v_checks := v_checks || jsonb_build_object('id', 'K-03', 'section', 'cleanup', 'test', 'non-Sales catalog unchanged', 'expected', v_digest_before, 'actual', v_r);
    execute v_other_sql into v_txt;
    v_checks := v_checks || jsonb_build_object('id', 'K-04', 'section', 'cleanup', 'test', 'all pre-existing organizations, memberships, active orgs and auth user count identical',
      'expected', v_other_before, 'actual', v_txt);
  end if;

  -- ==========================================================================
  -- REPORT
  -- ==========================================================================
  v_checks := coalesce((select jsonb_agg(c || jsonb_build_object('status',
                 case when c -> 'expected' = c -> 'actual' then 'PASS' else 'FAIL' end) order by o)
               from jsonb_array_elements(v_checks) with ordinality t(c, o)), '[]'::jsonb);
  v_total := jsonb_array_length(v_checks);
  v_passed := (select count(*) from jsonb_array_elements(v_checks) c where c ->> 'status' = 'PASS');
  v_failed := v_total - v_passed;
  v_status := case when v_blocked is not null then 'BLOCKED' when v_failed = 0 and v_halted is null then 'PASS' else 'FAIL' end;

  v_report := jsonb_build_object(
    'suite', 'sales_v1_inc1_functional_acceptance',
    'environment', 'staging',
    'run_id', v_run,
    'status', v_status,
    'checks_total', v_total,
    'passed', v_passed,
    'failed', v_failed,
    'blocked_reason', v_blocked,
    'halted_after_section', v_halted,
    'warnings', v_warnings,
    'persistence', jsonb_build_object('committed_writes', 'NONE',
      'strategy', 'all scenario writes ran inside a savepoint that was always rolled back; only identity-sequence values were consumed'),
    'production_contacted', 'NO',
    'environment_detail', v_env,
    'failures', coalesce((select jsonb_agg(c order by o) from jsonb_array_elements(v_checks) with ordinality t(c, o) where c ->> 'status' <> 'PASS'), '[]'::jsonb),
    'checks', v_checks);

  v_summary := 'SALES INC1 FUNCTIONAL ACCEPTANCE: ' || v_status || chr(10)
    || v_passed || '/' || v_total || ' checks passed' || chr(10)
    || 'Production contacted: NO' || chr(10)
    || 'Staging writes committed: NONE (run ' || v_run || ' rolled back)'
    || case when v_blocked is not null then chr(10) || 'BLOCKED: ' || v_blocked else '' end
    || case when v_halted is not null then chr(10) || 'HALTED after section: ' || v_halted else '' end;

  perform set_config('orvesen.sales_e2e_summary', v_summary, true);
  perform set_config('orvesen.sales_e2e_report', v_report::text, true);
end
$runner$;

select current_setting('orvesen.sales_e2e_summary') as summary,
       jsonb_pretty(current_setting('orvesen.sales_e2e_report')::jsonb) as report;

-- ============================================================================
-- ORVESEN Email Marketing V1 (Increments 1-2) - HUMAN ACCEPTANCE TEST RUNNER
-- Target: Orvesen Staging (vkvaispeujpsvotojyvz) ONLY, via the Supabase SQL Editor.
-- Code under test: commit 208a29d8fe4b0c74005f6b930a9fa65882a6961c (branch claude/v1).
--
-- HOW IT WORKS
--   * One DO block + one final SELECT, in the SQL Editor's single implicit transaction.
--   * Environment guard first: if this is not Staging with Inc1+Inc2 recorded
--     byte-exact, the runner reports BLOCKED and writes nothing.
--   * The whole scenario (synthetic users/orgs, CRM leads, contacts, consent,
--     lists, tags, fields, segment, suppressions, audit) runs inside a PL/pgSQL
--     exception block (= savepoint) that ALWAYS ends by raising a sentinel, so
--     every scenario write is rolled back. The report survives in a variable.
--   * Every product action uses the public RPCs as the impersonated user
--     (role authenticated + JWT sub), so RLS, grants, consent and suppression
--     rules apply exactly as in the product. Verifications read tables as the
--     SQL Editor owner role.
--   * Every negative / security case runs in its own nested savepoint and is
--     checked for the expected error AND for zero mutations (scenario snapshot).
--   * Output: one row -> summary (text) + report (JSON).
-- No sending, no provider, no secrets, no Production. Nothing is committed.
-- ============================================================================

do $runner$
declare
  v_run text := to_char(clock_timestamp() at time zone 'UTC', 'YYYYMMDD"t"HH24MISS') || '-'
                || substr(md5(random()::text || clock_timestamp()::text), 1, 6);
  v_tag text;
  v_checks jsonb := '[]'::jsonb;
  v_warnings jsonb := '[]'::jsonb;
  v_skipped jsonb := '[]'::jsonb;
  v_halted text;
  v_blocked text;
  v_env jsonb := '{}'::jsonb;
  v_ids jsonb := '{}'::jsonb;
  v_final_pre jsonb := '{}'::jsonb;
  v_lift_support text := 'NOT_TESTED';
  v_err_ctx text;
  -- actors and tenants
  v_fa uuid := gen_random_uuid();
  v_fb uuid := gen_random_uuid();
  v_admin uuid := gen_random_uuid();
  v_member uuid := gen_random_uuid();
  v_lead uuid := gen_random_uuid();
  v_org_a uuid;
  v_org_b uuid;
  v_orgs uuid[];
  v_all_orgs uuid[];
  v_human_org uuid;
  -- scenario objects
  v_cl_a bigint;
  v_cl_a_noemail bigint;
  v_cl_b bigint;
  v_c_main uuid;
  v_c_low uuid;
  v_c_notag uuid;
  v_c_optout uuid;
  v_c_b uuid;
  v_list_a uuid;
  v_list_b uuid;
  v_tag_a uuid;
  v_tag_b uuid;
  v_tag_admin uuid;
  v_f_orders uuid;
  v_f_since uuid;
  v_f_plan uuid;
  v_seg public.email_segments%rowtype;
  v_seg2 public.email_segments%rowtype;
  v_sup_row public.email_suppressions%rowtype;
  v_sup_main uuid;
  v_sup_optout uuid;
  v_sup_complaint uuid;
  v_consent_main uuid;
  v_def jsonb;
  -- scratch
  v_res jsonb;
  v_res2 jsonb;
  v_txt text;
  v_n bigint;
  v_b boolean;
  v_id uuid;
  v_id2 uuid;
  v_snap_before jsonb;
  v_snap_after jsonb;
  v_other_before jsonb;
  v_other_after jsonb;
  v_human_before jsonb;
  v_human_after jsonb;
  v_hist_before bigint;
  v_audit_before bigint;
  v_cases jsonb := '[]'::jsonb;
  v_tc record;
  v_ok boolean;
  v_report jsonb;
  v_summary text;
  v_total integer;
  v_passed integer;
  v_failed integer;
  v_status text;
  v_email_main text;
  v_email_b text;
  -- expected artefacts of the commit under test
  v_inc1_names text[] := array['email_normalize_address', 'email_address_hash', 'email_can', 'email_require',
    'email_reject_mutation', 'email_contacts_guard', 'email_contact_consents_guard', 'email_suppressions_guard',
    'email_write_audit', 'email_is_sendable', 'email_clean_name', 'email_clean_locale', 'email_clean_timezone',
    'email_request_hash', 'email_add_suppression', 'email_archive_contact', 'email_create_contact',
    'email_lift_suppression', 'email_record_consent', 'email_revoke_consent', 'email_update_contact'];
  v_inc2_names text[] := array['email_catalog_guard', 'email_segments_versioning', 'email_custom_value_is_valid',
    'email_contact_field_values_guard', 'email_clean_label', 'email_clean_description', 'email_clean_uuid_batch',
    'email_is_uuid_text', 'email_segment_invalid', 'email_segment_validate', 'email_segment_rule_matches',
    'email_segment_matches', 'email_preview', 'email_create_list', 'email_archive_list', 'email_add_list_members',
    'email_remove_list_members', 'email_create_tag', 'email_archive_tag', 'email_add_contact_tags',
    'email_remove_contact_tags', 'email_create_custom_field', 'email_archive_custom_field', 'email_set_contact_fields',
    'email_create_segment', 'email_update_segment', 'email_archive_segment', 'email_preview_audience',
    'email_preview_segment', 'email_import_contacts_from_crm'];
  v_inc1_fp_expected constant text := 'bea78511eb8edb8959f98dd7e835cc3b';
  v_inc2_fp_expected constant text := 'a5c722084c60b6e4fe82eb57d0130b0c';
  v_tables text[] := array['email_audit_log', 'email_contacts', 'email_contact_consents', 'email_suppressions',
    'email_lists', 'email_list_members', 'email_tags', 'email_contact_tags', 'email_custom_field_definitions',
    'email_contact_field_values', 'email_segments', 'email_contact_crm_links'];
  v_fp_sql constant text := $q$
    select md5(coalesce(string_agg(n.nspname || '.' || p.proname || '(' || pg_catalog.pg_get_function_identity_arguments(p.oid) || '):'
             || md5(replace(p.prosrc, chr(13), '')) || ':' || p.prosecdef::text || ':' || coalesce(array_to_string(p.proconfig, ','), ''),
             '|' order by (n.nspname || '.' || p.proname || '(' || pg_catalog.pg_get_function_identity_arguments(p.oid) || ')') collate "C"), ''))
    from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private') and p.proname = any ($1)
  $q$;
  -- per-tenant counts (param: uuid[] of organizations)
  v_counts_sql constant text := $q$
    select jsonb_build_object(
      'contacts', (select count(*) from public.email_contacts where organization_id = any ($1)),
      'consents', (select count(*) from public.email_contact_consents where organization_id = any ($1)),
      'suppressions', (select count(*) from public.email_suppressions where organization_id = any ($1)),
      'suppressions_active', (select count(*) from public.email_suppressions where organization_id = any ($1) and lifted_at is null),
      'audit', (select count(*) from public.email_audit_log where organization_id = any ($1)),
      'lists', (select count(*) from public.email_lists where organization_id = any ($1)),
      'list_members', (select count(*) from public.email_list_members where organization_id = any ($1)),
      'tags', (select count(*) from public.email_tags where organization_id = any ($1)),
      'contact_tags', (select count(*) from public.email_contact_tags where organization_id = any ($1)),
      'fields', (select count(*) from public.email_custom_field_definitions where organization_id = any ($1)),
      'field_values', (select count(*) from public.email_contact_field_values where organization_id = any ($1)),
      'segments', (select count(*) from public.email_segments where organization_id = any ($1)),
      'crm_links', (select count(*) from public.email_contact_crm_links where organization_id = any ($1)))
  $q$;
  -- content fingerprints, so a negative test that silently mutates is caught
  v_md5_sql constant text := $q$
    select jsonb_build_object(
      'contacts_md5', (select md5(coalesce(string_agg(id::text || email_normalized || status || version::text
          || coalesce(first_name, '') || coalesce(last_name, ''), ',' order by id), '')) from public.email_contacts where organization_id = any ($1)),
      'consents_md5', (select md5(coalesce(string_agg(id::text || action || source || consent_text_version || occurred_at::text, ',' order by id), ''))
          from public.email_contact_consents where organization_id = any ($1)),
      'suppressions_md5', (select md5(coalesce(string_agg(id::text || reason || coalesce(lifted_at::text, '-'), ',' order by id), ''))
          from public.email_suppressions where organization_id = any ($1)),
      'lists_md5', (select md5(coalesce(string_agg(id::text || name || status, ',' order by id), '')) from public.email_lists where organization_id = any ($1)),
      'tags_md5', (select md5(coalesce(string_agg(id::text || name || status, ',' order by id), '')) from public.email_tags where organization_id = any ($1)),
      'fields_md5', (select md5(coalesce(string_agg(id::text || key || label || field_type || options::text || status, ',' order by id), ''))
          from public.email_custom_field_definitions where organization_id = any ($1)),
      'field_values_md5', (select md5(coalesce(string_agg(contact_id::text || field_id::text || value::text, ',' order by contact_id, field_id), ''))
          from public.email_contact_field_values where organization_id = any ($1)),
      'segments_md5', (select md5(coalesce(string_agg(id::text || name || status || version::text || definition::text, ',' order by id), ''))
          from public.email_segments where organization_id = any ($1)))
  $q$;
  -- rows of every OTHER organization (param: uuid[] of scenario organizations)
  v_other_sql constant text := $q$
    select jsonb_build_object(
      'contacts', (select count(*) from public.email_contacts where organization_id <> all ($1)),
      'consents', (select count(*) from public.email_contact_consents where organization_id <> all ($1)),
      'suppressions', (select count(*) from public.email_suppressions where organization_id <> all ($1)),
      'suppressions_active', (select count(*) from public.email_suppressions where organization_id <> all ($1) and lifted_at is null),
      'audit', (select count(*) from public.email_audit_log where organization_id <> all ($1)),
      'lists', (select count(*) from public.email_lists where organization_id <> all ($1)),
      'list_members', (select count(*) from public.email_list_members where organization_id <> all ($1)),
      'tags', (select count(*) from public.email_tags where organization_id <> all ($1)),
      'contact_tags', (select count(*) from public.email_contact_tags where organization_id <> all ($1)),
      'fields', (select count(*) from public.email_custom_field_definitions where organization_id <> all ($1)),
      'field_values', (select count(*) from public.email_contact_field_values where organization_id <> all ($1)),
      'segments', (select count(*) from public.email_segments where organization_id <> all ($1)),
      'crm_links', (select count(*) from public.email_contact_crm_links where organization_id <> all ($1)),
      'max_audit_id_md5', (select md5(coalesce(string_agg(id::text, ',' order by id), '')) from public.email_audit_log where organization_id <> all ($1)))
  $q$;
begin
  -- Fully qualified names only; also makes catalog text rendering deterministic.
  perform set_config('search_path', '', true);
  v_tag := 'zz-email-e2e-' || v_run;
  v_email_main := v_tag || '-rosa@example.invalid';
  v_email_b := v_tag || '-bruno@example.invalid';

  -- ==========================================================================
  -- 1. ENVIRONMENT (read-only guard; BLOCKED means nothing is written)
  -- ==========================================================================
  v_env := jsonb_build_object(
    'database', current_database(),
    'server_version', current_setting('server_version'),
    'current_user', current_user::text,
    'migration_history_count', (select count(*) from supabase_migrations.schema_migrations),
    'staging_fingerprint_versions', (select count(*) from supabase_migrations.schema_migrations
        where version in ('20260801000000', '20260804054000', '20260916090000', '20260917000000', '20260917000100')),
    'inc1_recorded_md5', (select md5(replace(statements[1], chr(13), '')) from supabase_migrations.schema_migrations where version = '20260926160000'),
    'inc2_recorded_md5', (select md5(replace(statements[1], chr(13), '')) from supabase_migrations.schema_migrations where version = '20260927120000'),
    'production_contacted', 'NO');
  v_hist_before := (v_env ->> 'migration_history_count')::bigint;

  v_checks := v_checks || jsonb_build_object('id', 'ENV-01', 'section', 'environment', 'kind', 'ASSERTION',
    'test', 'SQL Editor runs as postgres', 'expected', 'postgres', 'actual', v_env -> 'current_user');
  v_checks := v_checks || jsonb_build_object('id', 'ENV-02', 'section', 'environment', 'kind', 'ASSERTION',
    'test', 'Staging-only migration fingerprint present (5 versions)', 'expected', 5, 'actual', v_env -> 'staging_fingerprint_versions');
  v_checks := v_checks || jsonb_build_object('id', 'ENV-03', 'section', 'environment', 'kind', 'ASSERTION',
    'test', 'Inc1 recorded byte-exact (commit 0b64966)', 'expected', 'dbc4208d3b3df5f35248042a7cfe1113', 'actual', v_env -> 'inc1_recorded_md5');
  v_checks := v_checks || jsonb_build_object('id', 'ENV-04', 'section', 'environment', 'kind', 'ASSERTION',
    'test', 'Inc2 recorded byte-exact (commit 208a29d)', 'expected', '7e8ec38ab2a5f7bd650bafc740d62525', 'actual', v_env -> 'inc2_recorded_md5');
  v_checks := v_checks || jsonb_build_object('id', 'ENV-05', 'section', 'environment', 'kind', 'ASSERTION',
    'test', 'runner prerequisites: may insert synthetic auth users/clients and assume authenticated/anon',
    'expected', true, 'actual', has_table_privilege('auth.users', 'INSERT') and has_table_privilege('public.clients', 'INSERT')
      and pg_has_role('authenticated', 'MEMBER') and pg_has_role('anon', 'MEMBER'));

  -- Tables the runner writes to (outside email_*) must not have triggers that can
  -- reach the network: a rollback cannot undo an outbound HTTP call.
  v_env := v_env || jsonb_build_object('outbound_triggers_on_written_tables', coalesce((
    select jsonb_agg(t.tgrelid::regclass::text || ':' || t.tgname || ':' || p.oid::regprocedure::text order by 1)
    from pg_catalog.pg_trigger t join pg_catalog.pg_proc p on p.oid = t.tgfoid
    where not t.tgisinternal
      and t.tgrelid in (select r from unnest(array[to_regclass('auth.users'), to_regclass('public.users'), to_regclass('public.clients'),
                          to_regclass('public.organizations'), to_regclass('public.organization_memberships'),
                          to_regclass('public.user_active_organizations')]) r where r is not null)
      and (p.prosrc ~* '(http|pg_net|net\.|supabase_functions|webhook)' or p.proname ~* 'http')), '[]'::jsonb));
  v_checks := v_checks || jsonb_build_object('id', 'ENV-10', 'section', 'environment', 'kind', 'ASSERTION',
    'test', 'no trigger on the tables the runner writes can make outbound HTTP calls', 'expected', '[]'::jsonb,
    'actual', v_env -> 'outbound_triggers_on_written_tables');

  if (v_env ->> 'current_user') <> 'postgres' then
    v_blocked := 'not running as postgres';
  elsif (v_env ->> 'staging_fingerprint_versions')::int <> 5 then
    v_blocked := 'Staging fingerprint not found (not Orvesen Staging)';
  elsif (v_env ->> 'inc1_recorded_md5') is distinct from 'dbc4208d3b3df5f35248042a7cfe1113'
     or (v_env ->> 'inc2_recorded_md5') is distinct from '7e8ec38ab2a5f7bd650bafc740d62525' then
    v_blocked := 'Increment 1/2 not recorded with the expected checksums';
  elsif not (has_table_privilege('auth.users', 'INSERT') and has_table_privilege('public.clients', 'INSERT')
             and pg_has_role('authenticated', 'MEMBER') and pg_has_role('anon', 'MEMBER')) then
    v_blocked := 'missing runner prerequisites';
  elsif jsonb_array_length(v_env -> 'outbound_triggers_on_written_tables') > 0 then
    v_blocked := 'a trigger on a written table may call out over HTTP (see ENV-10); refusing to write';
  end if;

  if v_blocked is null then
    execute v_fp_sql into v_txt using v_inc1_names;
    v_checks := v_checks || jsonb_build_object('id', 'ENV-06', 'section', 'environment', 'kind', 'ASSERTION',
      'test', 'Inc1 functions identical to the commit (source, security definer, search_path)', 'expected', v_inc1_fp_expected, 'actual', v_txt);
    execute v_fp_sql into v_txt using v_inc2_names;
    v_checks := v_checks || jsonb_build_object('id', 'ENV-07', 'section', 'environment', 'kind', 'ASSERTION',
      'test', 'Inc2 functions identical to the commit (source, security definer, search_path)', 'expected', v_inc2_fp_expected, 'actual', v_txt);
    v_checks := v_checks || jsonb_build_object('id', 'ENV-08', 'section', 'environment', 'kind', 'ASSERTION',
      'test', 'exactly the 12 Inc1-2 email tables exist (no Inc3 objects)', 'expected', to_jsonb((select array_agg(t order by t collate "C") from unnest(v_tables) t)),
      'actual', to_jsonb((select array_agg(c.relname::text order by c.relname::text collate "C") from pg_catalog.pg_class c
        join pg_catalog.pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind in ('r', 'p') and c.relname like 'email\_%')));
    v_checks := v_checks || jsonb_build_object('id', 'ENV-09', 'section', 'environment', 'kind', 'ASSERTION',
      'test', 'email functions in public/private = 21 (Inc1) + 30 (Inc2)', 'expected', 51,
      'actual', (select count(*) from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
                 where n.nspname in ('public', 'private') and p.proname like 'email\_%'));

    select o.id into v_human_org from public.organizations o where o.name = 'zz-human-email-qa-001-owner - ORVESEN';
    if v_human_org is null then
      v_warnings := v_warnings || to_jsonb('Human QA org zz-human-email-qa-001 not found; its untouched-check is skipped'::text);
    else
      execute v_counts_sql into v_human_before using array[v_human_org];
      execute v_md5_sql into v_res using array[v_human_org];
      v_human_before := v_human_before || v_res;
    end if;
  end if;

  -- ==========================================================================
  -- 2. SECURITY (static grants / RLS / definer hygiene; read-only)
  -- ==========================================================================
  if v_blocked is null then
    v_checks := v_checks || jsonb_build_object('id', 'SEC-01', 'section', 'security', 'kind', 'SECURITY',
      'test', 'RLS enabled on all 12 email tables', 'expected', 12,
      'actual', (select count(*) from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace
                 where n.nspname = 'public' and c.relname = any (v_tables) and c.relrowsecurity));
    v_checks := v_checks || jsonb_build_object('id', 'SEC-02', 'section', 'security', 'kind', 'SECURITY',
      'test', 'authenticated has NO direct INSERT/UPDATE/DELETE/TRUNCATE on email tables (RPC only)', 'expected', '[]'::jsonb,
      'actual', coalesce((select jsonb_agg(t || ':' || p order by t, p) from unnest(v_tables) t, unnest(array['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) p
                 where has_table_privilege('authenticated', 'public.' || t, p)), '[]'::jsonb));
    v_checks := v_checks || jsonb_build_object('id', 'SEC-03', 'section', 'security', 'kind', 'SECURITY',
      'test', 'anon has no privilege at all on email tables', 'expected', '[]'::jsonb,
      'actual', coalesce((select jsonb_agg(t || ':' || p order by t, p) from unnest(v_tables) t, unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) p
                 where has_table_privilege('anon', 'public.' || t, p)), '[]'::jsonb));
    v_checks := v_checks || jsonb_build_object('id', 'SEC-04', 'section', 'security', 'kind', 'SECURITY',
      'test', 'service_role has no direct DML on email tables', 'expected', '[]'::jsonb,
      'actual', coalesce((select jsonb_agg(t || ':' || p order by t, p) from unnest(v_tables) t, unnest(array['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) p
                 where has_table_privilege('service_role', 'public.' || t, p)), '[]'::jsonb));
    v_checks := v_checks || jsonb_build_object('id', 'SEC-05', 'section', 'security', 'kind', 'SECURITY',
      'test', 'authenticated may SELECT (RLS-filtered) all 12 email tables', 'expected', 12,
      'actual', (select count(*) from unnest(v_tables) t where has_table_privilege('authenticated', 'public.' || t, 'SELECT')));
    v_checks := v_checks || jsonb_build_object('id', 'SEC-06', 'section', 'security', 'kind', 'SECURITY',
      'test', 'public email RPCs: 24, all SECURITY DEFINER with search_path=""',
      'expected', jsonb_build_object('rpcs', 24, 'non_compliant', 0),
      'actual', (select jsonb_build_object('rpcs', count(*), 'non_compliant', count(*) filter (where not p.prosecdef
                   or not coalesce(p.proconfig @> array['search_path=""'], false)))
                 from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'public' and p.proname like 'email\_%'));
    v_checks := v_checks || jsonb_build_object('id', 'SEC-07', 'section', 'security', 'kind', 'SECURITY',
      'test', 'EXECUTE on public email RPCs: authenticated 24, anon 0, service_role 0',
      'expected', jsonb_build_object('authenticated', 24, 'anon', 0, 'service_role', 0),
      'actual', (select jsonb_build_object(
                   'authenticated', count(*) filter (where has_function_privilege('authenticated', p.oid, 'EXECUTE')),
                   'anon', count(*) filter (where has_function_privilege('anon', p.oid, 'EXECUTE')),
                   'service_role', count(*) filter (where has_function_privilege('service_role', p.oid, 'EXECUTE')))
                 from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'public' and p.proname like 'email\_%'));
    v_checks := v_checks || jsonb_build_object('id', 'SEC-08', 'section', 'security', 'kind', 'SECURITY',
      'test', 'private email helpers not executable by API roles (only email_can for RLS policies)',
      'expected', '["authenticated:email_can"]'::jsonb,
      'actual', coalesce((select jsonb_agg(r || ':' || p.proname order by r, p.proname)
                 from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace,
                      unnest(array['anon', 'authenticated', 'service_role']) r
                 where n.nspname = 'private' and p.proname like 'email\_%' and has_function_privilege(r, p.oid, 'EXECUTE')), '[]'::jsonb));
    v_checks := v_checks || jsonb_build_object('id', 'SEC-09', 'section', 'security', 'kind', 'SECURITY',
      'test', 'no email function contains a platform_owner cross-tenant bypass', 'expected', 0,
      'actual', (select count(*) from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
                 where n.nspname in ('public', 'private') and p.proname like 'email\_%' and p.prosrc ilike '%platform_owner%'));
  end if;

  -- ==========================================================================
  -- SCENARIO (always rolled back)
  -- ==========================================================================
  if v_blocked is null then
  begin

    -- ========================================================================
    -- 3. SETUP: synthetic tenants through the real signup trigger + CRM leads
    -- ========================================================================
    begin
      insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data, created_at, updated_at)
      select u.id, '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated', 'authenticated', v_tag || '-' || u.label || '@example.invalid',
             jsonb_build_object('first_name', 'ZZ E2E ' || u.label, 'organization_name', v_tag || ' ' || u.label), '{}'::jsonb, now(), now()
      from (values (v_fa, 'founder-a'), (v_fb, 'founder-b'), (v_admin, 'admin-a'), (v_member, 'member-a'), (v_lead, 'lead-a')) as u(id, label);

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
      -- admin / member / area_lead of organization A, with A active.
      insert into public.organization_memberships (user_id, organization_id, role)
      values (v_admin, v_org_a, 'admin'), (v_member, v_org_a, 'member'), (v_lead, v_org_a, 'area_lead')
      on conflict (user_id, organization_id) do update set role = excluded.role;
      insert into public.user_active_organizations (user_id, organization_id)
      values (v_admin, v_org_a), (v_member, v_org_a), (v_lead, v_org_a)
      on conflict (user_id) do update set organization_id = excluded.organization_id;
      v_orgs := array[v_org_a, v_org_b];
      v_all_orgs := array[v_org_a, v_org_b] || coalesce((select array_agg(m.organization_id) from public.organization_memberships m
                     where m.user_id in (v_admin, v_member, v_lead) and m.organization_id <> v_org_a), array[]::uuid[]);

      -- CRM leads, created directly as controlled setup (CRM is not under test).
      insert into public.clients (organization_id, owner_id, company_name, contact_name, email)
      values (v_org_a, v_fa, 'Panaderia Rosa (' || v_tag || ')', 'Rosa Beltran', v_email_main) returning id into v_cl_a;
      insert into public.clients (organization_id, owner_id, company_name, contact_name, email)
      values (v_org_a, v_fa, 'Obrador sin email (' || v_tag || ')', 'Sin Email', null) returning id into v_cl_a_noemail;
      insert into public.clients (organization_id, owner_id, company_name, contact_name, email)
      values (v_org_b, v_fb, 'Panaderia Bruno (' || v_tag || ')', 'Bruno Sanz', v_email_b) returning id into v_cl_b;

      execute v_other_sql into v_other_before using v_all_orgs;

      v_checks := v_checks || jsonb_build_object('id', 'SET-01', 'section', 'setup', 'kind', 'SETUP',
        'test', 'QA founders own distinct QA organizations named with the run id',
        'expected', jsonb_build_object('a_founder', 'founder', 'b_founder', 'founder', 'distinct', true, 'names_tagged', true),
        'actual', jsonb_build_object(
          'a_founder', (select m.role from public.organization_memberships m where m.user_id = v_fa and m.organization_id = v_org_a),
          'b_founder', (select m.role from public.organization_memberships m where m.user_id = v_fb and m.organization_id = v_org_b),
          'distinct', v_org_a <> v_org_b,
          'names_tagged', (select bool_and(o.name like v_tag || '%') from public.organizations o where o.id in (v_org_a, v_org_b))));
      v_checks := v_checks || jsonb_build_object('id', 'SET-02', 'section', 'setup', 'kind', 'SETUP',
        'test', 'organization A has admin, member and area_lead test users with A active',
        'expected', '["admin", "area_lead", "member"]'::jsonb,
        'actual', (select jsonb_agg(m.role order by m.role) from public.organization_memberships m
                   join public.user_active_organizations a on a.user_id = m.user_id and a.organization_id = m.organization_id
                   where m.organization_id = v_org_a and m.user_id in (v_admin, v_member, v_lead)));
      v_checks := v_checks || jsonb_build_object('id', 'SET-03', 'section', 'setup', 'kind', 'SETUP',
        'test', 'CRM leads created (A: with email + without email; B: one lead)', 'expected', 3,
        'actual', (select count(*) from public.clients c where c.id in (v_cl_a, v_cl_a_noemail, v_cl_b)));
      execute v_counts_sql into v_res using v_all_orgs;
      v_checks := v_checks || jsonb_build_object('id', 'SET-04', 'section', 'setup', 'kind', 'SETUP',
        'test', 'scenario organizations start with zero email rows',
        'expected', '{"contacts":0,"consents":0,"suppressions":0,"suppressions_active":0,"audit":0,"lists":0,"list_members":0,"tags":0,"contact_tags":0,"fields":0,"field_values":0,"segments":0,"crm_links":0}'::jsonb,
        'actual', v_res);
      v_ids := jsonb_build_object('run_id', v_run, 'tag', v_tag, 'org_a', v_org_a, 'org_b', v_org_b,
        'founder_a', v_fa, 'founder_b', v_fb, 'client_a', v_cl_a, 'client_b', v_cl_b);
    exception when others then
      get stacked diagnostics v_err_ctx = pg_exception_context;
      v_checks := v_checks || jsonb_build_object('id', 'ERR-setup', 'section', 'setup', 'kind', 'ERROR',
        'test', 'section ran without unexpected errors', 'expected', 'no error', 'actual', sqlerrm || ' [' || sqlstate || ']',
        'status', 'FAIL', 'context', left(v_err_ctx, 400));
    end;
    perform set_config('role', 'postgres', true);
    v_checks := (select jsonb_agg(case when c ? 'status' then c else c || jsonb_build_object('status',
                   case when c -> 'expected' = c -> 'actual' then 'PASS' else 'FAIL' end) end order by o) from jsonb_array_elements(v_checks) with ordinality t(c, o));
    if exists (select 1 from jsonb_array_elements(v_checks) c where c ->> 'section' = 'setup' and c ->> 'status' = 'FAIL') then
      v_halted := 'setup';
    end if;

    -- ========================================================================
    -- 4. CRM IMPORT (founder A) - explicit import, never consent
    -- ========================================================================
    if v_halted is null then
      begin
        perform set_config('request.jwt.claim.sub', v_fa::text, true),
                set_config('request.jwt.claims', json_build_object('sub', v_fa, 'role', 'authenticated')::text, true),
                set_config('role', 'authenticated', true);
        v_res := public.email_import_contacts_from_crm(array[v_cl_a, v_cl_a_noemail, v_cl_b]);
        v_checks := v_checks || jsonb_build_object('id', 'CRM-01', 'section', 'crm_import', 'kind', 'ACTION',
          'test', 'founder A imports [own lead, own lead without email, B''s lead]: only the own lead with email becomes a contact',
          'expected', '{"requested":3,"created":1,"linked_existing":0,"already_linked":0,"skipped_not_found":1,"skipped_no_email":1,"skipped_invalid_email":0,"skipped_archived":0,"consent_recorded":false}'::jsonb,
          'actual', v_res - 'batch_id');

        perform set_config('role', 'postgres', true);
        select c.id into v_c_main from public.email_contacts c where c.organization_id = v_org_a and c.email_normalized = v_email_main;
        v_checks := v_checks || jsonb_build_object('id', 'CRM-02', 'section', 'crm_import', 'kind', 'ASSERTION',
          'test', 'imported contact exists, active, source=import, name from CRM',
          'expected', jsonb_build_object('status', 'active', 'source', 'import', 'first_name', 'Rosa Beltran', 'last_name', null),
          'actual', (select jsonb_build_object('status', c.status, 'source', c.source, 'first_name', c.first_name, 'last_name', c.last_name)
                     from public.email_contacts c where c.id = v_c_main));
        v_checks := v_checks || jsonb_build_object('id', 'CRM-03', 'section', 'crm_import', 'kind', 'ASSERTION',
          'test', 'append-only CRM link client -> contact recorded', 'expected', 1,
          'actual', (select count(*) from public.email_contact_crm_links l where l.organization_id = v_org_a and l.client_id = v_cl_a and l.contact_id = v_c_main));
        v_checks := v_checks || jsonb_build_object('id', 'CRM-04', 'section', 'crm_import', 'kind', 'ISOLATION',
          'test', 'organization B''s CRM lead was NOT imported into A (nor anywhere)', 'expected', 0,
          'actual', (select count(*) from public.email_contacts c where c.email_normalized = v_email_b));
        v_checks := v_checks || jsonb_build_object('id', 'CRM-05', 'section', 'crm_import', 'kind', 'ASSERTION',
          'test', 'import does NOT grant consent (0 consent rows)', 'expected', 0,
          'actual', (select count(*) from public.email_contact_consents k where k.contact_id = v_c_main));
        v_checks := v_checks || jsonb_build_object('id', 'CRM-06', 'section', 'crm_import', 'kind', 'ASSERTION',
          'test', 'imported contact is NOT sendable: CONSENT_MISSING',
          'expected', '{"sendable":false,"reason_code":"CONSENT_MISSING"}'::jsonb,
          'actual', (select jsonb_build_object('sendable', s.sendable, 'reason_code', s.reason_code)
                     from private.email_is_sendable(v_org_a, v_c_main, 'marketing') s));
        select count(*) into v_audit_before from public.email_audit_log where organization_id = v_org_a;
        execute v_counts_sql into v_snap_before using v_orgs;

        perform set_config('role', 'authenticated', true);
        v_res := public.email_preview_audience(jsonb_build_object('version', 'segment.v1', 'match', 'all',
          'rules', jsonb_build_array(jsonb_build_object('type', 'field', 'field', 'email_domain', 'op', 'eq', 'value', 'example.invalid'))), 10);
        v_checks := v_checks || jsonb_build_object('id', 'CRM-07', 'section', 'crm_import', 'kind', 'ASSERTION',
          'test', 'ad-hoc preview: contact matches but is not sendable (CONSENT_MISSING)',
          'expected', jsonb_build_object('matched', 1, 'sendable', 0, 'not_sendable_by_reason', jsonb_build_object('CONSENT_MISSING', 1),
                        'sample', jsonb_build_array(jsonb_build_array(v_c_main, 'CONSENT_MISSING'))),
          'actual', jsonb_build_object('matched', v_res -> 'matched', 'sendable', v_res -> 'sendable', 'not_sendable_by_reason', v_res -> 'not_sendable_by_reason',
                        'sample', (select jsonb_agg(jsonb_build_array(s ->> 'contact_id', s ->> 'reason_code')) from jsonb_array_elements(v_res -> 'sample') s)));
        v_res := public.email_import_contacts_from_crm(array[v_cl_a]);
        v_checks := v_checks || jsonb_build_object('id', 'CRM-08', 'section', 'crm_import', 'kind', 'ASSERTION',
          'test', 'import replay is idempotent (already_linked, no new contact)',
          'expected', '{"created":0,"already_linked":1,"linked_existing":0}'::jsonb,
          'actual', jsonb_build_object('created', v_res -> 'created', 'already_linked', v_res -> 'already_linked', 'linked_existing', v_res -> 'linked_existing'));

        perform set_config('role', 'postgres', true);
        execute v_counts_sql into v_snap_after using v_orgs;
        v_checks := v_checks || jsonb_build_object('id', 'CRM-09', 'section', 'crm_import', 'kind', 'AUDIT',
          'test', 'preview wrote nothing; import replay wrote only its import_completed audit entry',
          'expected', v_snap_before || jsonb_build_object('audit', (v_snap_before ->> 'audit')::int + 1), 'actual', v_snap_after);
      exception when others then
        get stacked diagnostics v_err_ctx = pg_exception_context;
        v_checks := v_checks || jsonb_build_object('id', 'ERR-crm_import', 'section', 'crm_import', 'kind', 'ERROR',
          'test', 'section ran without unexpected errors', 'expected', 'no error', 'actual', sqlerrm || ' [' || sqlstate || ']',
          'status', 'FAIL', 'context', left(v_err_ctx, 400));
      end;
      perform set_config('role', 'postgres', true);
      v_checks := (select jsonb_agg(case when c ? 'status' then c else c || jsonb_build_object('status',
                     case when c -> 'expected' = c -> 'actual' then 'PASS' else 'FAIL' end) end order by o) from jsonb_array_elements(v_checks) with ordinality t(c, o));
      if exists (select 1 from jsonb_array_elements(v_checks) c where c ->> 'section' = 'crm_import' and c ->> 'status' = 'FAIL') then
        v_halted := 'crm_import';
      end if;
    else
      v_skipped := v_skipped || '"crm_import"'::jsonb;
    end if;

    -- ========================================================================
    -- 5. CONSENT (founder A) - explicit, evidenced, idempotent
    -- ========================================================================
    if v_halted is null then
      begin
        perform set_config('request.jwt.claim.sub', v_fa::text, true),
                set_config('request.jwt.claims', json_build_object('sub', v_fa, 'role', 'authenticated')::text, true),
                set_config('role', 'authenticated', true);
        select r.consent_id, r.was_created into v_consent_main, v_b
        from public.email_record_consent(
          p_contact_id => v_c_main, p_method => 'written', p_source => 'Formulario web ' || v_tag,
          p_consent_text => 'Acepto recibir emails de marketing de la panaderia', p_consent_text_version => 'v1',
          p_occurred_at => now() - interval '1 day',
          p_evidence => jsonb_build_object('form_id', v_tag, 'ip', '203.0.113.10', 'captured_by', 'e2e-runner'),
          p_purpose => 'marketing', p_idempotency_key => 'e2e-consent-' || v_run) r;
        v_checks := v_checks || jsonb_build_object('id', 'CON-01', 'section', 'consent', 'kind', 'ACTION',
          'test', 'explicit consent with evidence recorded', 'expected', true, 'actual', v_b);
        select r.consent_id, r.was_created into v_id, v_b
        from public.email_record_consent(
          p_contact_id => v_c_main, p_method => 'written', p_source => 'Formulario web ' || v_tag,
          p_consent_text => 'Acepto recibir emails de marketing de la panaderia', p_consent_text_version => 'v1',
          p_occurred_at => now() - interval '1 day',
          p_evidence => jsonb_build_object('form_id', v_tag, 'ip', '203.0.113.10', 'captured_by', 'e2e-runner'),
          p_purpose => 'marketing', p_idempotency_key => 'e2e-consent-' || v_run) r;
        v_checks := v_checks || jsonb_build_object('id', 'CON-02', 'section', 'consent', 'kind', 'ASSERTION',
          'test', 'consent replay with the same idempotency key returns the same row',
          'expected', jsonb_build_object('was_created', false, 'same_id', true), 'actual', jsonb_build_object('was_created', v_b, 'same_id', v_id = v_consent_main));

        perform set_config('role', 'postgres', true);
        v_checks := v_checks || jsonb_build_object('id', 'CON-03', 'section', 'consent', 'kind', 'ASSERTION',
          'test', 'ledger row holds the evidence, actor and address',
          'expected', jsonb_build_object('rows', 1, 'action', 'granted', 'method', 'written', 'version', 'v1', 'form_id', v_tag,
                        'actor_type', 'user', 'recorded_by_founder_a', true, 'address', v_email_main),
          'actual', (select jsonb_build_object('rows', count(*) over (), 'action', k.action, 'method', k.method, 'version', k.consent_text_version,
                        'form_id', k.evidence ->> 'form_id', 'actor_type', k.actor_type, 'recorded_by_founder_a', k.recorded_by = v_fa,
                        'address', k.email_normalized)
                     from public.email_contact_consents k where k.contact_id = v_c_main limit 1));
        v_checks := v_checks || jsonb_build_object('id', 'CON-04', 'section', 'consent', 'kind', 'ASSERTION',
          'test', 'contact is now SENDABLE, backed by that consent',
          'expected', jsonb_build_object('sendable', true, 'reason_code', 'SENDABLE', 'consent_id', v_consent_main),
          'actual', (select jsonb_build_object('sendable', s.sendable, 'reason_code', s.reason_code, 'consent_id', s.consent_id)
                     from private.email_is_sendable(v_org_a, v_c_main, 'marketing') s));
      exception when others then
        get stacked diagnostics v_err_ctx = pg_exception_context;
        v_checks := v_checks || jsonb_build_object('id', 'ERR-consent', 'section', 'consent', 'kind', 'ERROR',
          'test', 'section ran without unexpected errors', 'expected', 'no error', 'actual', sqlerrm || ' [' || sqlstate || ']',
          'status', 'FAIL', 'context', left(v_err_ctx, 400));
      end;
      perform set_config('role', 'postgres', true);
      v_checks := (select jsonb_agg(case when c ? 'status' then c else c || jsonb_build_object('status',
                     case when c -> 'expected' = c -> 'actual' then 'PASS' else 'FAIL' end) end order by o) from jsonb_array_elements(v_checks) with ordinality t(c, o));
      if exists (select 1 from jsonb_array_elements(v_checks) c where c ->> 'section' = 'consent' and c ->> 'status' = 'FAIL') then
        v_halted := 'consent';
      end if;
    else
      v_skipped := v_skipped || '"consent"'::jsonb;
    end if;

    -- ========================================================================
    -- 6. AUDIENCES (founder A): list, members, tag, assignment + 2 decoys
    -- ========================================================================
    if v_halted is null then
      begin
        perform set_config('request.jwt.claim.sub', v_fa::text, true),
                set_config('request.jwt.claims', json_build_object('sub', v_fa, 'role', 'authenticated')::text, true),
                set_config('role', 'authenticated', true);
        select r.list_id, r.was_created into v_list_a, v_b from public.email_create_list('Clientes Panaderias ' || v_tag, 'Lista e2e') r;
        v_checks := v_checks || jsonb_build_object('id', 'AUD-01', 'section', 'audiences', 'kind', 'ACTION',
          'test', 'create list', 'expected', true, 'actual', v_b);
        select r.list_id, r.was_created into v_id, v_b from public.email_create_list(upper('Clientes Panaderias ' || v_tag)) r;
        v_checks := v_checks || jsonb_build_object('id', 'AUD-02', 'section', 'audiences', 'kind', 'ASSERTION',
          'test', 'create list is idempotent by name (case-insensitive)',
          'expected', jsonb_build_object('was_created', false, 'same_id', true), 'actual', jsonb_build_object('was_created', v_b, 'same_id', v_id = v_list_a));

        -- decoys: consented, in the list, but each fails one segment rule
        select r.contact_id into v_c_low from public.email_create_contact(v_tag || '-tomas@example.invalid', 'Tomas', 'Vidal') r;
        select r.contact_id into v_c_notag from public.email_create_contact(v_tag || '-ines@example.invalid', 'Ines', 'Mora') r;
        perform public.email_record_consent(v_c_low, 'written', 'Formulario web ' || v_tag, 'Acepto recibir emails', 'v1', now() - interval '1 day');
        perform public.email_record_consent(v_c_notag, 'written', 'Formulario web ' || v_tag, 'Acepto recibir emails', 'v1', now() - interval '1 day');

        v_res := public.email_add_list_members(v_list_a, array[v_c_main]);
        v_checks := v_checks || jsonb_build_object('id', 'AUD-03', 'section', 'audiences', 'kind', 'ACTION',
          'test', 'add contact to list', 'expected', '{"added":1,"already_member":0,"skipped_archived":0,"skipped_not_found":0}'::jsonb, 'actual', v_res);
        v_res := public.email_add_list_members(v_list_a, array[v_c_main]);
        v_checks := v_checks || jsonb_build_object('id', 'AUD-04', 'section', 'audiences', 'kind', 'ASSERTION',
          'test', 'add member replay is idempotent', 'expected', '{"added":0,"already_member":1,"skipped_archived":0,"skipped_not_found":0}'::jsonb, 'actual', v_res);
        v_res := public.email_add_list_members(v_list_a, array[v_c_low, v_c_notag, gen_random_uuid()]);
        v_checks := v_checks || jsonb_build_object('id', 'AUD-05', 'section', 'audiences', 'kind', 'ASSERTION',
          'test', 'add decoys + one nonexistent contact id: decoys added, unknown id skipped (not an error)',
          'expected', '{"added":2,"already_member":0,"skipped_archived":0,"skipped_not_found":1}'::jsonb, 'actual', v_res);

        select r.tag_id, r.was_created into v_tag_a, v_b from public.email_create_tag('Cliente VIP ' || v_tag) r;
        v_checks := v_checks || jsonb_build_object('id', 'AUD-06', 'section', 'audiences', 'kind', 'ACTION',
          'test', 'create tag', 'expected', true, 'actual', v_b);
        select r.tag_id, r.was_created into v_id, v_b from public.email_create_tag(lower('Cliente VIP ' || v_tag)) r;
        v_checks := v_checks || jsonb_build_object('id', 'AUD-07', 'section', 'audiences', 'kind', 'ASSERTION',
          'test', 'create tag is idempotent by name', 'expected', jsonb_build_object('was_created', false, 'same_id', true),
          'actual', jsonb_build_object('was_created', v_b, 'same_id', v_id = v_tag_a));
        v_res := public.email_add_contact_tags(v_tag_a, array[v_c_main]);
        v_checks := v_checks || jsonb_build_object('id', 'AUD-08', 'section', 'audiences', 'kind', 'ACTION',
          'test', 'assign tag', 'expected', '{"added":1,"already_tagged":0,"skipped_archived":0,"skipped_not_found":0}'::jsonb, 'actual', v_res);
        v_res := public.email_add_contact_tags(v_tag_a, array[v_c_main]);
        v_checks := v_checks || jsonb_build_object('id', 'AUD-09', 'section', 'audiences', 'kind', 'ASSERTION',
          'test', 'assign tag replay is idempotent', 'expected', '{"added":0,"already_tagged":1,"skipped_archived":0,"skipped_not_found":0}'::jsonb, 'actual', v_res);
        perform public.email_add_contact_tags(v_tag_a, array[v_c_low]);

        perform set_config('role', 'postgres', true);
        v_checks := v_checks || jsonb_build_object('id', 'AUD-10', 'section', 'audiences', 'kind', 'ASSERTION',
          'test', 'state: 3 list members; VIP tag on main + low decoy only',
          'expected', jsonb_build_object('members', 3, 'tagged', jsonb_build_array(v_c_main, v_c_low)),
          'actual', jsonb_build_object('members', (select count(*) from public.email_list_members m where m.list_id = v_list_a),
                      'tagged', (select jsonb_agg(t.contact_id order by case t.contact_id when v_c_main then 1 else 2 end)
                                 from public.email_contact_tags t where t.tag_id = v_tag_a)));
      exception when others then
        get stacked diagnostics v_err_ctx = pg_exception_context;
        v_checks := v_checks || jsonb_build_object('id', 'ERR-audiences', 'section', 'audiences', 'kind', 'ERROR',
          'test', 'section ran without unexpected errors', 'expected', 'no error', 'actual', sqlerrm || ' [' || sqlstate || ']',
          'status', 'FAIL', 'context', left(v_err_ctx, 400));
      end;
      perform set_config('role', 'postgres', true);
      v_checks := (select jsonb_agg(case when c ? 'status' then c else c || jsonb_build_object('status',
                     case when c -> 'expected' = c -> 'actual' then 'PASS' else 'FAIL' end) end order by o) from jsonb_array_elements(v_checks) with ordinality t(c, o));
      if exists (select 1 from jsonb_array_elements(v_checks) c where c ->> 'section' = 'audiences' and c ->> 'status' = 'FAIL') then
        v_halted := 'audiences';
      end if;
    else
      v_skipped := v_skipped || '"audiences"'::jsonb;
    end if;

    -- ========================================================================
    -- 7. CUSTOM FIELDS (founder A): typed definitions + values
    -- ========================================================================
    if v_halted is null then
      begin
        perform set_config('request.jwt.claim.sub', v_fa::text, true),
                set_config('request.jwt.claims', json_build_object('sub', v_fa, 'role', 'authenticated')::text, true),
                set_config('role', 'authenticated', true);
        select r.field_id into v_f_orders from public.email_create_custom_field('pedidos_mensuales', 'Pedidos mensuales estimados', 'number', '[]'::jsonb) r;
        select r.field_id into v_f_since from public.email_create_custom_field('cliente_desde', 'Cliente desde', 'date', '[]'::jsonb) r;
        select r.field_id into v_f_plan from public.email_create_custom_field('plan_interes', 'Plan de interes', 'select', '["basico", "premium"]'::jsonb) r;
        v_checks := v_checks || jsonb_build_object('id', 'CF-01', 'section', 'custom_fields', 'kind', 'ACTION',
          'test', 'three typed fields created', 'expected', true, 'actual', v_f_orders is not null and v_f_since is not null and v_f_plan is not null);
        v_checks := v_checks || jsonb_build_object('id', 'CF-02', 'section', 'custom_fields', 'kind', 'ASSERTION',
          'test', 'identical re-definition is idempotent (same ids, was_created=false)',
          'expected', '[false, false, false, true]'::jsonb,
          'actual', jsonb_build_array(
            (select r.was_created from public.email_create_custom_field('pedidos_mensuales', 'Pedidos mensuales estimados', 'number', '[]'::jsonb) r),
            (select r.was_created from public.email_create_custom_field('cliente_desde', 'Cliente desde', 'date', '[]'::jsonb) r),
            (select r.was_created from public.email_create_custom_field('plan_interes', 'Plan de interes', 'select', '["basico", "premium"]'::jsonb) r),
            (select r.field_id = v_f_plan from public.email_create_custom_field('plan_interes', 'Plan de interes', 'select', '["basico", "premium"]'::jsonb) r)));
        v_res := public.email_set_contact_fields(v_c_main, '{"pedidos_mensuales": 120, "cliente_desde": "2024-03-15", "plan_interes": "premium"}'::jsonb);
        v_checks := v_checks || jsonb_build_object('id', 'CF-03', 'section', 'custom_fields', 'kind', 'ACTION',
          'test', 'assign pedidos_mensuales=120, cliente_desde=2024-03-15, plan_interes=premium', 'expected', '{"set":3,"cleared":0}'::jsonb, 'actual', v_res);
        v_res := public.email_set_contact_fields(v_c_main, '{"pedidos_mensuales": 120, "cliente_desde": "2024-03-15", "plan_interes": "premium"}'::jsonb);
        v_checks := v_checks || jsonb_build_object('id', 'CF-04', 'section', 'custom_fields', 'kind', 'ASSERTION',
          'test', 'same values again is a no-op', 'expected', '{"set":0,"cleared":0}'::jsonb, 'actual', v_res);
        perform public.email_set_contact_fields(v_c_low, '{"pedidos_mensuales": 80}'::jsonb);
        perform public.email_set_contact_fields(v_c_notag, '{"pedidos_mensuales": 150}'::jsonb);

        perform set_config('role', 'postgres', true);
        v_checks := v_checks || jsonb_build_object('id', 'CF-05', 'section', 'custom_fields', 'kind', 'ASSERTION',
          'test', 'definitions are typed as requested',
          'expected', '{"cliente_desde": ["date", []], "pedidos_mensuales": ["number", []], "plan_interes": ["select", ["basico", "premium"]]}'::jsonb,
          'actual', (select jsonb_object_agg(d.key, jsonb_build_array(d.field_type, d.options)) from public.email_custom_field_definitions d where d.organization_id = v_org_a));
        v_checks := v_checks || jsonb_build_object('id', 'CF-06', 'section', 'custom_fields', 'kind', 'ASSERTION',
          'test', 'stored values keep their JSON types',
          'expected', '{"cliente_desde": ["2024-03-15", "string"], "pedidos_mensuales": [120, "number"], "plan_interes": ["premium", "string"]}'::jsonb,
          'actual', (select jsonb_object_agg(d.key, jsonb_build_array(v.value, jsonb_typeof(v.value)))
                     from public.email_contact_field_values v join public.email_custom_field_definitions d on d.id = v.field_id and d.organization_id = v.organization_id
                     where v.contact_id = v_c_main));
      exception when others then
        get stacked diagnostics v_err_ctx = pg_exception_context;
        v_checks := v_checks || jsonb_build_object('id', 'ERR-custom_fields', 'section', 'custom_fields', 'kind', 'ERROR',
          'test', 'section ran without unexpected errors', 'expected', 'no error', 'actual', sqlerrm || ' [' || sqlstate || ']',
          'status', 'FAIL', 'context', left(v_err_ctx, 400));
      end;
      perform set_config('role', 'postgres', true);
      v_checks := (select jsonb_agg(case when c ? 'status' then c else c || jsonb_build_object('status',
                     case when c -> 'expected' = c -> 'actual' then 'PASS' else 'FAIL' end) end order by o) from jsonb_array_elements(v_checks) with ordinality t(c, o));
      if exists (select 1 from jsonb_array_elements(v_checks) c where c ->> 'section' = 'custom_fields' and c ->> 'status' = 'FAIL') then
        v_halted := 'custom_fields';
      end if;
    else
      v_skipped := v_skipped || '"custom_fields"'::jsonb;
    end if;

    -- ========================================================================
    -- 8. SEGMENT (founder A): list AND VIP tag AND pedidos_mensuales > 100
    -- ========================================================================
    if v_halted is null then
      begin
        perform set_config('request.jwt.claim.sub', v_fa::text, true),
                set_config('request.jwt.claims', json_build_object('sub', v_fa, 'role', 'authenticated')::text, true),
                set_config('role', 'authenticated', true);
        v_def := jsonb_build_object('version', 'segment.v1', 'match', 'all', 'rules', jsonb_build_array(
          jsonb_build_object('type', 'list', 'op', 'in', 'list_id', v_list_a),
          jsonb_build_object('type', 'tag', 'op', 'has', 'tag_id', v_tag_a),
          jsonb_build_object('type', 'custom_field', 'key', 'pedidos_mensuales', 'op', 'gt', 'value', 100)));
        v_seg := public.email_create_segment('Panaderias VIP +100 pedidos ' || v_tag, v_def, 'Segmento e2e');
        v_checks := v_checks || jsonb_build_object('id', 'SEG-01', 'section', 'segment', 'kind', 'ACTION',
          'test', 'segment.v1 created (version 1, active, definition stored as sent)',
          'expected', jsonb_build_object('version', 1, 'status', 'active', 'definition', v_def),
          'actual', jsonb_build_object('version', v_seg.version, 'status', v_seg.status, 'definition', v_seg.definition));

        perform set_config('role', 'postgres', true);
        execute v_counts_sql into v_snap_before using v_orgs;
        execute v_md5_sql into v_res using v_orgs;
        v_snap_before := v_snap_before || v_res;
        perform set_config('role', 'authenticated', true);
        v_res := public.email_preview_segment(v_seg.id, 10);
        v_res2 := public.email_preview_segment(v_seg.id, 10);
        v_checks := v_checks || jsonb_build_object('id', 'SEG-02', 'section', 'segment', 'kind', 'ASSERTION',
          'test', 'preview: matched=1, sendable=1 (decoys excluded by the tag rule and the >100 rule)',
          'expected', jsonb_build_object('segment_id', v_seg.id, 'version', 1, 'matched', 1, 'sendable', 1, 'not_sendable_by_reason', '{}'::jsonb,
                        'sample', jsonb_build_array(jsonb_build_array(v_c_main, 'SENDABLE'))),
          'actual', (v_res - 'sample') || jsonb_build_object('sample',
                        (select jsonb_agg(jsonb_build_array(s ->> 'contact_id', s ->> 'reason_code')) from jsonb_array_elements(v_res -> 'sample') s)));
        v_checks := v_checks || jsonb_build_object('id', 'SEG-03', 'section', 'segment', 'kind', 'ASSERTION',
          'test', 'preview is deterministic (second call identical)', 'expected', true, 'actual', v_res = v_res2);
        v_res2 := public.email_preview_audience(v_def, 10);
        v_checks := v_checks || jsonb_build_object('id', 'SEG-04', 'section', 'segment', 'kind', 'ASSERTION',
          'test', 'ad-hoc preview of the same definition gives the same audience', 'expected', v_res - 'segment_id' - 'version', 'actual', v_res2);

        perform set_config('role', 'postgres', true);
        execute v_counts_sql into v_snap_after using v_orgs;
        execute v_md5_sql into v_res using v_orgs;
        v_snap_after := v_snap_after || v_res;
        v_checks := v_checks || jsonb_build_object('id', 'SEG-05', 'section', 'segment', 'kind', 'AUDIT',
          'test', 'previews are read-only: no audit, no new segment version, no mutation at all',
          'expected', v_snap_before, 'actual', v_snap_after);

        perform set_config('role', 'authenticated', true);
        v_seg2 := public.email_update_segment(v_seg.id, jsonb_build_object('description', 'Segmento e2e (editado)'), 1);
        v_checks := v_checks || jsonb_build_object('id', 'SEG-06', 'section', 'segment', 'kind', 'ACTION',
          'test', 'explicit edit with expected version 1 bumps the version to 2', 'expected', 2, 'actual', v_seg2.version);
      exception when others then
        get stacked diagnostics v_err_ctx = pg_exception_context;
        v_checks := v_checks || jsonb_build_object('id', 'ERR-segment', 'section', 'segment', 'kind', 'ERROR',
          'test', 'section ran without unexpected errors', 'expected', 'no error', 'actual', sqlerrm || ' [' || sqlstate || ']',
          'status', 'FAIL', 'context', left(v_err_ctx, 400));
      end;
      perform set_config('role', 'postgres', true);
      v_checks := (select jsonb_agg(case when c ? 'status' then c else c || jsonb_build_object('status',
                     case when c -> 'expected' = c -> 'actual' then 'PASS' else 'FAIL' end) end order by o) from jsonb_array_elements(v_checks) with ordinality t(c, o));
      if exists (select 1 from jsonb_array_elements(v_checks) c where c ->> 'section' = 'segment' and c ->> 'status' = 'FAIL') then
        v_halted := 'segment';
      end if;
    else
      v_skipped := v_skipped || '"segment"'::jsonb;
    end if;

    -- ========================================================================
    -- 9. SUPPRESSION (founder A): membership vs sendability, lift, Inc1 rules
    -- ========================================================================
    if v_halted is null then
      begin
        perform set_config('request.jwt.claim.sub', v_fa::text, true),
                set_config('request.jwt.claims', json_build_object('sub', v_fa, 'role', 'authenticated')::text, true),
                set_config('role', 'authenticated', true);
        select r.suppression_id, r.was_created into v_sup_main, v_b
        from public.email_add_suppression(v_email_main, 'manual', 'Cliente pidio pausar emails ' || v_tag) r;
        v_checks := v_checks || jsonb_build_object('id', 'SUP-01', 'section', 'suppression', 'kind', 'ACTION',
          'test', 'manual suppression added through the public RPC', 'expected', true, 'actual', v_b);
        perform set_config('role', 'postgres', true);
        select count(*) into v_audit_before from public.email_audit_log where organization_id = v_org_a;
        perform set_config('role', 'authenticated', true);
        select r.suppression_id, r.was_created into v_id, v_b from public.email_add_suppression(upper(v_email_main), 'manual') r;
        perform set_config('role', 'postgres', true);
        v_checks := v_checks || jsonb_build_object('id', 'SUP-02', 'section', 'suppression', 'kind', 'ASSERTION',
          'test', 'suppression replay (address in upper case) is idempotent and writes no audit',
          'expected', jsonb_build_object('was_created', false, 'same_id', true, 'new_audit', 0),
          'actual', jsonb_build_object('was_created', v_b, 'same_id', v_id = v_sup_main,
                      'new_audit', (select count(*) from public.email_audit_log where organization_id = v_org_a) - v_audit_before));

        perform set_config('role', 'authenticated', true);
        v_res := public.email_preview_segment(v_seg.id, 10);
        v_checks := v_checks || jsonb_build_object('id', 'SUP-03', 'section', 'suppression', 'kind', 'ASSERTION',
          'test', 'after suppression: still matched=1 but sendable=0, reason SUPPRESSED',
          'expected', jsonb_build_object('matched', 1, 'sendable', 0, 'not_sendable_by_reason', jsonb_build_object('SUPPRESSED', 1),
                        'sample', jsonb_build_array(jsonb_build_array(v_c_main, 'SUPPRESSED'))),
          'actual', jsonb_build_object('matched', v_res -> 'matched', 'sendable', v_res -> 'sendable', 'not_sendable_by_reason', v_res -> 'not_sendable_by_reason',
                        'sample', (select jsonb_agg(jsonb_build_array(s ->> 'contact_id', s ->> 'reason_code')) from jsonb_array_elements(v_res -> 'sample') s)));
        perform set_config('role', 'postgres', true);
        v_checks := v_checks || jsonb_build_object('id', 'SUP-04', 'section', 'suppression', 'kind', 'ASSERTION',
          'test', 'sendability check reports the suppression',
          'expected', '{"sendable":false,"reason_code":"SUPPRESSED","suppression_reason":"manual"}'::jsonb,
          'actual', (select jsonb_build_object('sendable', s.sendable, 'reason_code', s.reason_code, 'suppression_reason', s.suppression_reason)
                     from private.email_is_sendable(v_org_a, v_c_main, 'marketing') s));
        v_checks := v_checks || jsonb_build_object('id', 'SUP-05', 'section', 'suppression', 'kind', 'ASSERTION',
          'test', 'suppression deletes nothing: contact, consent history, list, tag, fields, segment membership intact',
          'expected', jsonb_build_object('contact_status', 'active', 'consent_rows', 1, 'latest_consent', 'granted', 'in_list', true,
                        'has_tag', true, 'field_values', 3, 'segment_matched', 1),
          'actual', jsonb_build_object(
            'contact_status', (select c.status from public.email_contacts c where c.id = v_c_main),
            'consent_rows', (select count(*) from public.email_contact_consents k where k.contact_id = v_c_main),
            'latest_consent', (select k.action from public.email_contact_consents k where k.contact_id = v_c_main order by k.ledger_position desc limit 1),
            'in_list', exists (select 1 from public.email_list_members m where m.list_id = v_list_a and m.contact_id = v_c_main),
            'has_tag', exists (select 1 from public.email_contact_tags t where t.tag_id = v_tag_a and t.contact_id = v_c_main),
            'field_values', (select count(*) from public.email_contact_field_values v where v.contact_id = v_c_main),
            'segment_matched', v_res -> 'matched'));

        -- Inc1 provides email_lift_suppression: lift the manual suppression safely.
        perform set_config('role', 'authenticated', true);
        v_sup_row := public.email_lift_suppression(v_sup_main, 'Cliente confirmo por telefono que quiere recibir emails de nuevo');
        v_lift_support := 'SUPPORTED';
        v_checks := v_checks || jsonb_build_object('id', 'SUP-06', 'section', 'suppression', 'kind', 'ACTION',
          'test', 'supported lift of a manual suppression (founder, written reason)',
          'expected', jsonb_build_object('lifted', true, 'lifted_by_founder_a', true), 'actual', jsonb_build_object('lifted', v_sup_row.lifted_at is not null, 'lifted_by_founder_a', v_sup_row.lifted_by = v_fa));
        v_res := public.email_preview_segment(v_seg.id, 10);
        v_checks := v_checks || jsonb_build_object('id', 'SUP-07', 'section', 'suppression', 'kind', 'ASSERTION',
          'test', 'after lift: matched=1, sendable=1 again (SENDABLE)',
          'expected', jsonb_build_object('matched', 1, 'sendable', 1, 'sample', jsonb_build_array(jsonb_build_array(v_c_main, 'SENDABLE'))),
          'actual', jsonb_build_object('matched', v_res -> 'matched', 'sendable', v_res -> 'sendable',
                        'sample', (select jsonb_agg(jsonb_build_array(s ->> 'contact_id', s ->> 'reason_code')) from jsonb_array_elements(v_res -> 'sample') s)));

        -- Opt-out path (Inc1): revocation creates an unsubscribed suppression.
        select r.contact_id into v_c_optout from public.email_create_contact(v_tag || '-pablo@example.invalid', 'Pablo', 'Serra') r;
        perform public.email_record_consent(v_c_optout, 'written', 'Formulario web ' || v_tag, 'Acepto recibir emails', 'v1', now() - interval '2 days');
        select r.suppression_id into v_sup_optout from public.email_revoke_consent(v_c_optout, 'user_request', 'Pidio la baja por email') r;
        -- Complaint suppression on a decoy (never liftable).
        select r.suppression_id into v_sup_complaint from public.email_add_suppression(v_tag || '-ines@example.invalid', 'complaint', 'Queja e2e') r;
        perform set_config('role', 'postgres', true);
        v_checks := v_checks || jsonb_build_object('id', 'SUP-08', 'section', 'suppression', 'kind', 'ASSERTION',
          'test', 'revocation -> unsubscribed suppression; contact not sendable; ledger keeps grant + revoke',
          'expected', '{"suppression":"unsubscribed","reason_code":"SUPPRESSED","ledger":["granted","revoked"]}'::jsonb,
          'actual', jsonb_build_object(
            'suppression', (select s.reason from public.email_suppressions s where s.id = v_sup_optout),
            'reason_code', (select s.reason_code from private.email_is_sendable(v_org_a, v_c_optout, 'marketing') s),
            'ledger', (select jsonb_agg(k.action order by k.ledger_position) from public.email_contact_consents k where k.contact_id = v_c_optout)));
      exception when others then
        get stacked diagnostics v_err_ctx = pg_exception_context;
        v_checks := v_checks || jsonb_build_object('id', 'ERR-suppression', 'section', 'suppression', 'kind', 'ERROR',
          'test', 'section ran without unexpected errors', 'expected', 'no error', 'actual', sqlerrm || ' [' || sqlstate || ']',
          'status', 'FAIL', 'context', left(v_err_ctx, 400));
      end;
      perform set_config('role', 'postgres', true);
      v_checks := (select jsonb_agg(case when c ? 'status' then c else c || jsonb_build_object('status',
                     case when c -> 'expected' = c -> 'actual' then 'PASS' else 'FAIL' end) end order by o) from jsonb_array_elements(v_checks) with ordinality t(c, o));
      if exists (select 1 from jsonb_array_elements(v_checks) c where c ->> 'section' = 'suppression' and c ->> 'status' = 'FAIL') then
        v_halted := 'suppression';
      end if;
    else
      v_skipped := v_skipped || '"suppression"'::jsonb;
    end if;

    -- ========================================================================
    -- 10. ISOLATION (founder B builds its own tenant; RLS both ways)
    -- ========================================================================
    if v_halted is null then
      begin
        perform set_config('request.jwt.claim.sub', v_fb::text, true),
                set_config('request.jwt.claims', json_build_object('sub', v_fb, 'role', 'authenticated')::text, true),
                set_config('role', 'authenticated', true);
        select r.list_id, r.was_created into v_list_b, v_b from public.email_create_list('Clientes Panaderias ' || v_tag) r;
        select r.tag_id into v_tag_b from public.email_create_tag('Cliente VIP ' || v_tag) r;
        v_checks := v_checks || jsonb_build_object('id', 'ISO-01', 'section', 'isolation', 'kind', 'ISOLATION',
          'test', 'B can create the same list/tag names as A: names are tenant-scoped (new ids)',
          'expected', jsonb_build_object('list_created', true, 'list_differs', true, 'tag_differs', true),
          'actual', jsonb_build_object('list_created', v_b, 'list_differs', v_list_b <> v_list_a, 'tag_differs', v_tag_b <> v_tag_a));
        select r.was_created into v_b from public.email_create_custom_field('pedidos_mensuales', 'Pedidos (texto en B)', 'text', '[]'::jsonb) r;
        v_checks := v_checks || jsonb_build_object('id', 'ISO-02', 'section', 'isolation', 'kind', 'ISOLATION',
          'test', 'B defines pedidos_mensuales with another type: field keys are tenant-scoped', 'expected', true, 'actual', v_b);
        v_res := public.email_import_contacts_from_crm(array[v_cl_b, v_cl_a]);
        v_checks := v_checks || jsonb_build_object('id', 'ISO-03', 'section', 'isolation', 'kind', 'ISOLATION',
          'test', 'B imports [own lead, A''s lead]: A''s lead is indistinguishable from unknown',
          'expected', '{"created":1,"skipped_not_found":1,"consent_recorded":false}'::jsonb,
          'actual', jsonb_build_object('created', v_res -> 'created', 'skipped_not_found', v_res -> 'skipped_not_found', 'consent_recorded', v_res -> 'consent_recorded'));
        select c.id into v_c_b from public.email_contacts c where c.email_normalized = v_email_b;
        v_res := public.email_add_list_members(v_list_b, array[v_c_b, v_c_main]);
        v_checks := v_checks || jsonb_build_object('id', 'ISO-04', 'section', 'isolation', 'kind', 'ISOLATION',
          'test', 'B adds [own contact, A''s contact] to its list: A''s contact is skipped as not found',
          'expected', '{"added":1,"already_member":0,"skipped_archived":0,"skipped_not_found":1}'::jsonb, 'actual', v_res);
        v_res := public.email_preview_audience(jsonb_build_object('version', 'segment.v1', 'match', 'all',
          'rules', jsonb_build_array(jsonb_build_object('type', 'field', 'field', 'email_domain', 'op', 'eq', 'value', 'example.invalid'))), 50);
        v_checks := v_checks || jsonb_build_object('id', 'ISO-05', 'section', 'isolation', 'kind', 'ISOLATION',
          'test', 'B''s broad preview sees only B''s single (unconsented) contact',
          'expected', jsonb_build_object('matched', 1, 'sendable', 0, 'sample', jsonb_build_array(v_c_b)),
          'actual', jsonb_build_object('matched', v_res -> 'matched', 'sendable', v_res -> 'sendable',
                      'sample', (select jsonb_agg(s ->> 'contact_id') from jsonb_array_elements(v_res -> 'sample') s)));
        v_checks := v_checks || jsonb_build_object('id', 'ISO-06', 'section', 'isolation', 'kind', 'ISOLATION',
          'test', 'RLS: B reads zero rows of A in all 12 email tables',
          'expected', '{"audit":0,"contacts":0,"consents":0,"suppressions":0,"lists":0,"list_members":0,"tags":0,"contact_tags":0,"fields":0,"field_values":0,"segments":0,"crm_links":0}'::jsonb,
          'actual', jsonb_build_object(
            'audit', (select count(*) from public.email_audit_log where organization_id = v_org_a),
            'contacts', (select count(*) from public.email_contacts where organization_id = v_org_a),
            'consents', (select count(*) from public.email_contact_consents where organization_id = v_org_a),
            'suppressions', (select count(*) from public.email_suppressions where organization_id = v_org_a),
            'lists', (select count(*) from public.email_lists where organization_id = v_org_a),
            'list_members', (select count(*) from public.email_list_members where organization_id = v_org_a),
            'tags', (select count(*) from public.email_tags where organization_id = v_org_a),
            'contact_tags', (select count(*) from public.email_contact_tags where organization_id = v_org_a),
            'fields', (select count(*) from public.email_custom_field_definitions where organization_id = v_org_a),
            'field_values', (select count(*) from public.email_contact_field_values where organization_id = v_org_a),
            'segments', (select count(*) from public.email_segments where organization_id = v_org_a),
            'crm_links', (select count(*) from public.email_contact_crm_links where organization_id = v_org_a)));
        v_checks := v_checks || jsonb_build_object('id', 'ISO-07', 'section', 'isolation', 'kind', 'ISOLATION',
          'test', 'RLS sanity: B does read its own rows (filter is tenant-based, not deny-all)',
          'expected', '{"contacts":1,"lists":1,"total_contacts_visible":1}'::jsonb,
          'actual', jsonb_build_object('contacts', (select count(*) from public.email_contacts where organization_id = v_org_b),
                      'lists', (select count(*) from public.email_lists where organization_id = v_org_b),
                      'total_contacts_visible', (select count(*) from public.email_contacts)));

        perform set_config('request.jwt.claim.sub', v_fa::text, true),
                set_config('request.jwt.claims', json_build_object('sub', v_fa, 'role', 'authenticated')::text, true);
        v_checks := v_checks || jsonb_build_object('id', 'ISO-08', 'section', 'isolation', 'kind', 'ISOLATION',
          'test', 'RLS: A reads zero rows of B and exactly its own 4 contacts overall',
          'expected', '{"b_contacts":0,"b_lists":0,"b_fields":0,"b_audit":0,"total_contacts_visible":4}'::jsonb,
          'actual', jsonb_build_object('b_contacts', (select count(*) from public.email_contacts where organization_id = v_org_b),
                      'b_lists', (select count(*) from public.email_lists where organization_id = v_org_b),
                      'b_fields', (select count(*) from public.email_custom_field_definitions where organization_id = v_org_b),
                      'b_audit', (select count(*) from public.email_audit_log where organization_id = v_org_b),
                      'total_contacts_visible', (select count(*) from public.email_contacts)));

        -- member / area_lead of A: RLS denies reads entirely (email is founder/admin only)
        perform set_config('request.jwt.claim.sub', v_member::text, true),
                set_config('request.jwt.claims', json_build_object('sub', v_member, 'role', 'authenticated')::text, true);
        v_n := (select count(*) from public.email_contacts) + (select count(*) from public.email_audit_log) + (select count(*) from public.email_segments);
        perform set_config('request.jwt.claim.sub', v_lead::text, true),
                set_config('request.jwt.claims', json_build_object('sub', v_lead, 'role', 'authenticated')::text, true);
        v_n := v_n + (select count(*) from public.email_contacts) + (select count(*) from public.email_contact_consents) + (select count(*) from public.email_suppressions);
        v_checks := v_checks || jsonb_build_object('id', 'ISO-09', 'section', 'isolation', 'kind', 'SECURITY',
          'test', 'RLS: member and area_lead of A read zero email rows', 'expected', 0, 'actual', v_n);
        -- admin of A: allowed to read and manage
        perform set_config('request.jwt.claim.sub', v_admin::text, true),
                set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
        v_res := public.email_preview_segment(v_seg.id, 0);
        select r.tag_id, r.was_created into v_tag_admin, v_b from public.email_create_tag('Etiqueta admin ' || v_tag) r;
        v_checks := v_checks || jsonb_build_object('id', 'ISO-10', 'section', 'isolation', 'kind', 'SECURITY',
          'test', 'admin of A may preview (sample 0) and manage (create tag)',
          'expected', '{"matched":1,"sample":[],"tag_created":true}'::jsonb,
          'actual', jsonb_build_object('matched', v_res -> 'matched', 'sample', v_res -> 'sample', 'tag_created', v_b));
      exception when others then
        get stacked diagnostics v_err_ctx = pg_exception_context;
        v_checks := v_checks || jsonb_build_object('id', 'ERR-isolation', 'section', 'isolation', 'kind', 'ERROR',
          'test', 'section ran without unexpected errors', 'expected', 'no error', 'actual', sqlerrm || ' [' || sqlstate || ']',
          'status', 'FAIL', 'context', left(v_err_ctx, 400));
      end;
      perform set_config('role', 'postgres', true);
      v_checks := (select jsonb_agg(case when c ? 'status' then c else c || jsonb_build_object('status',
                     case when c -> 'expected' = c -> 'actual' then 'PASS' else 'FAIL' end) end order by o) from jsonb_array_elements(v_checks) with ordinality t(c, o));
      if exists (select 1 from jsonb_array_elements(v_checks) c where c ->> 'section' = 'isolation' and c ->> 'status' = 'FAIL') then
        v_halted := 'isolation';
      end if;
    else
      v_skipped := v_skipped || '"isolation"'::jsonb;
    end if;

    -- ========================================================================
    -- 11. NEGATIVE / CONFLICT / CROSS-TENANT / ROLE / DML / OWNER-IMMUTABILITY
    --     Each case: own savepoint, expected error, and ZERO mutations.
    -- ========================================================================
    if v_halted is null then
      v_cases := jsonb_build_array(
        -- invalid custom field values (founder A)
        jsonb_build_object('id', 'NEG-01', 'section', 'negative_tests', 'test', 'number field with text', 'actor', v_fa,
          'stmt', format('select public.email_set_contact_fields(%L::uuid, %L::jsonb)', v_c_main, '{"pedidos_mensuales": "ciento veinte"}'), 'expected', 'EMAIL_INVALID_FIELD_VALUE'),
        jsonb_build_object('id', 'NEG-02', 'section', 'negative_tests', 'test', 'impossible date 2024-02-30', 'actor', v_fa,
          'stmt', format('select public.email_set_contact_fields(%L::uuid, %L::jsonb)', v_c_main, '{"cliente_desde": "2024-02-30"}'), 'expected', 'EMAIL_INVALID_FIELD_VALUE'),
        jsonb_build_object('id', 'NEG-03', 'section', 'negative_tests', 'test', 'date in wrong format 15/03/2024', 'actor', v_fa,
          'stmt', format('select public.email_set_contact_fields(%L::uuid, %L::jsonb)', v_c_main, '{"cliente_desde": "15/03/2024"}'), 'expected', 'EMAIL_INVALID_FIELD_VALUE'),
        jsonb_build_object('id', 'NEG-04', 'section', 'negative_tests', 'test', 'select option that does not exist', 'actor', v_fa,
          'stmt', format('select public.email_set_contact_fields(%L::uuid, %L::jsonb)', v_c_main, '{"plan_interes": "enterprise"}'), 'expected', 'EMAIL_INVALID_FIELD_VALUE'),
        jsonb_build_object('id', 'NEG-05', 'section', 'negative_tests', 'test', 'mixed batch (valid pedidos=999 + invalid option): all-or-nothing, 120 kept', 'actor', v_fa,
          'stmt', format('select public.email_set_contact_fields(%L::uuid, %L::jsonb)', v_c_main, '{"cliente_desde": "2024-03-15", "pedidos_mensuales": 999, "plan_interes": "gold"}'), 'expected', 'EMAIL_INVALID_FIELD_VALUE'),
        jsonb_build_object('id', 'NEG-06', 'section', 'negative_tests', 'test', 'unknown custom field key', 'actor', v_fa,
          'stmt', format('select public.email_set_contact_fields(%L::uuid, %L::jsonb)', v_c_main, '{"campo_inexistente": 1}'), 'expected', 'EMAIL_UNKNOWN_FIELD'),
        jsonb_build_object('id', 'NEG-07', 'section', 'negative_tests', 'test', 'set fields on a nonexistent contact', 'actor', v_fa,
          'stmt', format('select public.email_set_contact_fields(%L::uuid, %L::jsonb)', gen_random_uuid(), '{"pedidos_mensuales": 1}'), 'expected', 'EMAIL_CONTACT_NOT_FOUND'),
        jsonb_build_object('id', 'NEG-08', 'section', 'negative_tests', 'test', 'record consent for a nonexistent contact', 'actor', v_fa,
          'stmt', format('select public.email_record_consent(%L::uuid, %L, %L, %L, %L, now() - interval %L)', gen_random_uuid(), 'written', 'e2e', 'Acepto', 'v1', '1 hour'), 'expected', 'EMAIL_CONTACT_NOT_FOUND'),
        jsonb_build_object('id', 'NEG-09', 'section', 'negative_tests', 'test', 'add member to a nonexistent list', 'actor', v_fa,
          'stmt', format('select public.email_add_list_members(%L::uuid, array[%L]::uuid[])', gen_random_uuid(), v_c_main), 'expected', 'EMAIL_LIST_NOT_FOUND'),
        jsonb_build_object('id', 'NEG-10', 'section', 'negative_tests', 'test', 'assign a nonexistent tag', 'actor', v_fa,
          'stmt', format('select public.email_add_contact_tags(%L::uuid, array[%L]::uuid[])', gen_random_uuid(), v_c_main), 'expected', 'EMAIL_TAG_NOT_FOUND'),
        jsonb_build_object('id', 'NEG-11', 'section', 'negative_tests', 'test', 'preview a nonexistent segment', 'actor', v_fa,
          'stmt', format('select public.email_preview_segment(%L::uuid, 5)', gen_random_uuid()), 'expected', 'EMAIL_SEGMENT_NOT_FOUND'),
        jsonb_build_object('id', 'NEG-12', 'section', 'negative_tests', 'test', 'malformed segment: version segment.v2', 'actor', v_fa,
          'stmt', format('select public.email_create_segment(%L, %L::jsonb)', 'NEG12 ' || v_tag, jsonb_build_object('version', 'segment.v2', 'match', 'all', 'rules', jsonb_build_array(jsonb_build_object('type', 'list', 'op', 'in', 'list_id', v_list_a)))), 'expected', 'EMAIL_INVALID_SEGMENT'),
        jsonb_build_object('id', 'NEG-13', 'section', 'negative_tests', 'test', 'malformed segment: match "some"', 'actor', v_fa,
          'stmt', format('select public.email_create_segment(%L, %L::jsonb)', 'NEG13 ' || v_tag, jsonb_build_object('version', 'segment.v1', 'match', 'some', 'rules', jsonb_build_array(jsonb_build_object('type', 'list', 'op', 'in', 'list_id', v_list_a)))), 'expected', 'EMAIL_INVALID_SEGMENT'),
        jsonb_build_object('id', 'NEG-14', 'section', 'negative_tests', 'test', 'malformed segment: empty rules', 'actor', v_fa,
          'stmt', format('select public.email_create_segment(%L, %L::jsonb)', 'NEG14 ' || v_tag, '{"version": "segment.v1", "match": "all", "rules": []}'), 'expected', 'EMAIL_INVALID_SEGMENT'),
        jsonb_build_object('id', 'NEG-15', 'section', 'negative_tests', 'test', 'malformed segment: unknown rule type', 'actor', v_fa,
          'stmt', format('select public.email_create_segment(%L, %L::jsonb)', 'NEG15 ' || v_tag, '{"version": "segment.v1", "match": "all", "rules": [{"type": "score", "op": "gt", "value": 1}]}'), 'expected', 'EMAIL_INVALID_SEGMENT'),
        jsonb_build_object('id', 'NEG-16', 'section', 'negative_tests', 'test', 'malformed segment: unknown custom field key', 'actor', v_fa,
          'stmt', format('select public.email_create_segment(%L, %L::jsonb)', 'NEG16 ' || v_tag, '{"version": "segment.v1", "match": "all", "rules": [{"type": "custom_field", "key": "no_existe", "op": "gt", "value": 1}]}'), 'expected', 'EMAIL_INVALID_SEGMENT'),
        jsonb_build_object('id', 'NEG-17', 'section', 'negative_tests', 'test', 'malformed segment: gt on a select field', 'actor', v_fa,
          'stmt', format('select public.email_create_segment(%L, %L::jsonb)', 'NEG17 ' || v_tag, '{"version": "segment.v1", "match": "all", "rules": [{"type": "custom_field", "key": "plan_interes", "op": "gt", "value": "premium"}]}'), 'expected', 'EMAIL_INVALID_SEGMENT'),
        jsonb_build_object('id', 'NEG-18', 'section', 'negative_tests', 'test', 'malformed segment: number rule with a string value', 'actor', v_fa,
          'stmt', format('select public.email_create_segment(%L, %L::jsonb)', 'NEG18 ' || v_tag, '{"version": "segment.v1", "match": "all", "rules": [{"type": "custom_field", "key": "pedidos_mensuales", "op": "gt", "value": "cien"}]}'), 'expected', 'EMAIL_INVALID_SEGMENT'),
        jsonb_build_object('id', 'NEG-19', 'section', 'negative_tests', 'test', 'malformed segment: list_id is not a uuid', 'actor', v_fa,
          'stmt', format('select public.email_create_segment(%L, %L::jsonb)', 'NEG19 ' || v_tag, '{"version": "segment.v1", "match": "all", "rules": [{"type": "list", "op": "in", "list_id": "not-a-uuid"}]}'), 'expected', 'EMAIL_INVALID_SEGMENT'),
        jsonb_build_object('id', 'NEG-20', 'section', 'negative_tests', 'test', 'cross-organization reference: segment on B''s list', 'actor', v_fa,
          'stmt', format('select public.email_create_segment(%L, %L::jsonb)', 'NEG20 ' || v_tag, jsonb_build_object('version', 'segment.v1', 'match', 'all', 'rules', jsonb_build_array(jsonb_build_object('type', 'list', 'op', 'in', 'list_id', v_list_b)))), 'expected', 'EMAIL_INVALID_SEGMENT'),
        jsonb_build_object('id', 'NEG-21', 'section', 'negative_tests', 'test', 'cross-organization reference: segment on B''s tag', 'actor', v_fa,
          'stmt', format('select public.email_create_segment(%L, %L::jsonb)', 'NEG21 ' || v_tag, jsonb_build_object('version', 'segment.v1', 'match', 'all', 'rules', jsonb_build_array(jsonb_build_object('type', 'tag', 'op', 'has', 'tag_id', v_tag_b)))), 'expected', 'EMAIL_INVALID_SEGMENT'),
        jsonb_build_object('id', 'NEG-22', 'section', 'negative_tests', 'test', 'cross-organization reference: ad-hoc preview on B''s list', 'actor', v_fa,
          'stmt', format('select public.email_preview_audience(%L::jsonb, 5)', jsonb_build_object('version', 'segment.v1', 'match', 'all', 'rules', jsonb_build_array(jsonb_build_object('type', 'list', 'op', 'in', 'list_id', v_list_b)))), 'expected', 'EMAIL_INVALID_SEGMENT'),
        jsonb_build_object('id', 'NEG-23', 'section', 'negative_tests', 'test', 'create contact with an invalid address', 'actor', v_fa,
          'stmt', 'select public.email_create_contact(''no-es-un-email'')', 'expected', 'EMAIL_INVALID_ADDRESS'),
        jsonb_build_object('id', 'NEG-24', 'section', 'negative_tests', 'test', 'preview sample_size 51 (max 50)', 'actor', v_fa,
          'stmt', format('select public.email_preview_segment(%L::uuid, 51)', v_seg.id), 'expected', 'EMAIL_INVALID_ARGUMENT'),
        jsonb_build_object('id', 'NEG-25', 'section', 'negative_tests', 'test', 'select field without options', 'actor', v_fa,
          'stmt', 'select public.email_create_custom_field(''nivel'', ''Nivel'', ''select'', ''[]''::jsonb)', 'expected', 'EMAIL_INVALID_ARGUMENT'),
        jsonb_build_object('id', 'NEG-26', 'section', 'negative_tests', 'test', 'consent dated one day in the future', 'actor', v_fa,
          'stmt', format('select public.email_record_consent(%L::uuid, %L, %L, %L, %L, now() + interval %L)', v_c_low, 'written', 'e2e', 'Acepto', 'v1', '1 day'), 'expected', 'EMAIL_INVALID_ARGUMENT'),
        jsonb_build_object('id', 'NEG-27', 'section', 'negative_tests', 'test', 'consent with an unsupported method', 'actor', v_fa,
          'stmt', format('select public.email_record_consent(%L::uuid, %L, %L, %L, %L, now() - interval %L)', v_c_low, 'fax', 'e2e', 'Acepto', 'v1', '1 hour'), 'expected', 'EMAIL_INVALID_ARGUMENT'),
        jsonb_build_object('id', 'NEG-28', 'section', 'negative_tests', 'test', 'suppression with an unsupported reason', 'actor', v_fa,
          'stmt', format('select public.email_add_suppression(%L, %L)', v_email_main, 'spam_trap'), 'expected', 'EMAIL_INVALID_ARGUMENT'),
        jsonb_build_object('id', 'NEG-29', 'section', 'negative_tests', 'test', 'add an empty batch of members', 'actor', v_fa,
          'stmt', format('select public.email_add_list_members(%L::uuid, array[]::uuid[])', v_list_a), 'expected', 'EMAIL_INVALID_ARGUMENT'),
        -- deliberate conflicts where the contract is NOT idempotent
        jsonb_build_object('id', 'CNF-01', 'section', 'negative_tests', 'test', 'conflict: second segment with the same name (other case)', 'actor', v_fa,
          'stmt', format('select public.email_create_segment(%L, %L::jsonb)', lower('Panaderias VIP +100 pedidos ' || v_tag), v_def), 'expected', 'EMAIL_SEGMENT_NAME_CONFLICT'),
        jsonb_build_object('id', 'CNF-02', 'section', 'negative_tests', 'test', 'conflict: stale segment version (expects 1, is 2)', 'actor', v_fa,
          'stmt', format('select public.email_update_segment(%L::uuid, %L::jsonb, 1)', v_seg.id, '{"description": "stale"}'), 'expected', 'EMAIL_SEGMENT_VERSION_CONFLICT'),
        jsonb_build_object('id', 'CNF-03', 'section', 'negative_tests', 'test', 'conflict: consent idempotency key reused with a different payload', 'actor', v_fa,
          'stmt', format('select public.email_record_consent(%L::uuid, %L, %L, %L, %L, now() - interval %L, %L::jsonb, %L, %L)', v_c_main, 'written', 'Otro formulario', 'Otro texto', 'v2', '1 day', '{}', 'marketing', 'e2e-consent-' || v_run), 'expected', 'EMAIL_IDEMPOTENCY_CONFLICT'),
        jsonb_build_object('id', 'CNF-04', 'section', 'negative_tests', 'test', 'conflict: same field key with a different type', 'actor', v_fa,
          'stmt', 'select public.email_create_custom_field(''pedidos_mensuales'', ''Pedidos mensuales estimados'', ''text'', ''[]''::jsonb)', 'expected', 'EMAIL_FIELD_KEY_CONFLICT'),
        -- suppression / consent lifecycle rules (Inc1)
        jsonb_build_object('id', 'SUPN-01', 'section', 'suppression', 'test', 'lifting an already lifted suppression', 'actor', v_fa,
          'stmt', format('select public.email_lift_suppression(%L::uuid, %L)', v_sup_main, 'Segundo intento de levantar'), 'expected', 'EMAIL_SUPPRESSION_ALREADY_LIFTED'),
        jsonb_build_object('id', 'SUPN-02', 'section', 'suppression', 'test', 'unsubscribed cannot be lifted without a newer consent', 'actor', v_fa,
          'stmt', format('select public.email_lift_suppression(%L::uuid, %L)', v_sup_optout, 'Intento de levantar la baja'), 'expected', 'EMAIL_SUPPRESSION_REQUIRES_NEW_CONSENT'),
        jsonb_build_object('id', 'SUPN-03', 'section', 'suppression', 'test', 'backdated re-consent cannot override the opt-out', 'actor', v_fa,
          'stmt', format('select public.email_record_consent(%L::uuid, %L, %L, %L, %L, now() - interval %L)', v_c_optout, 'written', 'e2e', 'Acepto', 'v1', '1 day'), 'expected', 'EMAIL_CONSENT_PREDATES_REVOCATION'),
        jsonb_build_object('id', 'SUPN-04', 'section', 'suppression', 'test', 'complaint suppressions are never liftable', 'actor', v_fa,
          'stmt', format('select public.email_lift_suppression(%L::uuid, %L)', v_sup_complaint, 'Intento de levantar la queja'), 'expected', 'EMAIL_SUPPRESSION_NOT_LIFTABLE'),
        jsonb_build_object('id', 'SUPN-05', 'section', 'suppression', 'test', 'lift requires a written reason (>= 10 chars)', 'actor', v_fa,
          'stmt', format('select public.email_lift_suppression(%L::uuid, %L)', v_sup_optout, 'ok'), 'expected', 'EMAIL_INVALID_ARGUMENT'),
        -- cross-tenant use of A's ids by founder B
        jsonb_build_object('id', 'XT-01', 'section', 'isolation', 'test', 'B adds A''s contact to A''s list', 'actor', v_fb,
          'stmt', format('select public.email_add_list_members(%L::uuid, array[%L]::uuid[])', v_list_a, v_c_main), 'expected', 'EMAIL_LIST_NOT_FOUND'),
        jsonb_build_object('id', 'XT-02', 'section', 'isolation', 'test', 'B assigns A''s tag', 'actor', v_fb,
          'stmt', format('select public.email_add_contact_tags(%L::uuid, array[%L]::uuid[])', v_tag_a, v_c_main), 'expected', 'EMAIL_TAG_NOT_FOUND'),
        jsonb_build_object('id', 'XT-03', 'section', 'isolation', 'test', 'B sets fields on A''s contact', 'actor', v_fb,
          'stmt', format('select public.email_set_contact_fields(%L::uuid, %L::jsonb)', v_c_main, '{"pedidos_mensuales": "x"}'), 'expected', 'EMAIL_CONTACT_NOT_FOUND'),
        jsonb_build_object('id', 'XT-04', 'section', 'isolation', 'test', 'B records consent for A''s contact', 'actor', v_fb,
          'stmt', format('select public.email_record_consent(%L::uuid, %L, %L, %L, %L, now() - interval %L)', v_c_main, 'written', 'e2e', 'Acepto', 'v1', '1 hour'), 'expected', 'EMAIL_CONTACT_NOT_FOUND'),
        jsonb_build_object('id', 'XT-05', 'section', 'isolation', 'test', 'B revokes consent of A''s contact', 'actor', v_fb,
          'stmt', format('select public.email_revoke_consent(%L::uuid, %L)', v_c_main, 'user_request'), 'expected', 'EMAIL_CONTACT_NOT_FOUND'),
        jsonb_build_object('id', 'XT-06', 'section', 'isolation', 'test', 'B archives A''s contact', 'actor', v_fb,
          'stmt', format('select public.email_archive_contact(%L::uuid)', v_c_main), 'expected', 'EMAIL_CONTACT_NOT_FOUND'),
        jsonb_build_object('id', 'XT-07', 'section', 'isolation', 'test', 'B previews A''s segment', 'actor', v_fb,
          'stmt', format('select public.email_preview_segment(%L::uuid, 5)', v_seg.id), 'expected', 'EMAIL_SEGMENT_NOT_FOUND'),
        jsonb_build_object('id', 'XT-08', 'section', 'isolation', 'test', 'B edits A''s segment', 'actor', v_fb,
          'stmt', format('select public.email_update_segment(%L::uuid, %L::jsonb)', v_seg.id, '{"description": "hack"}'), 'expected', 'EMAIL_SEGMENT_NOT_FOUND'),
        jsonb_build_object('id', 'XT-09', 'section', 'isolation', 'test', 'B archives A''s list', 'actor', v_fb,
          'stmt', format('select public.email_archive_list(%L::uuid)', v_list_a), 'expected', 'EMAIL_LIST_NOT_FOUND'),
        jsonb_build_object('id', 'XT-10', 'section', 'isolation', 'test', 'B lifts A''s suppression', 'actor', v_fb,
          'stmt', format('select public.email_lift_suppression(%L::uuid, %L)', v_sup_optout, 'Intento cruzado de levantar'), 'expected', 'EMAIL_SUPPRESSION_NOT_FOUND'),
        jsonb_build_object('id', 'XT-11', 'section', 'isolation', 'test', 'B previews an audience on A''s list', 'actor', v_fb,
          'stmt', format('select public.email_preview_audience(%L::jsonb, 5)', jsonb_build_object('version', 'segment.v1', 'match', 'all', 'rules', jsonb_build_array(jsonb_build_object('type', 'list', 'op', 'in', 'list_id', v_list_a)))), 'expected', 'EMAIL_INVALID_SEGMENT'),
        jsonb_build_object('id', 'XT-12', 'section', 'isolation', 'test', 'B archives A''s custom field', 'actor', v_fb,
          'stmt', format('select public.email_archive_custom_field(%L::uuid)', v_f_orders), 'expected', 'EMAIL_FIELD_NOT_FOUND'),
        -- roles without email permissions (organization A)
        jsonb_build_object('id', 'ROLE-01', 'section', 'security', 'test', 'member cannot preview', 'actor', v_member,
          'stmt', format('select public.email_preview_segment(%L::uuid, 5)', v_seg.id), 'expected', 'EMAIL_ACCESS_DENIED'),
        jsonb_build_object('id', 'ROLE-02', 'section', 'security', 'test', 'member cannot create a list', 'actor', v_member,
          'stmt', 'select public.email_create_list(''member list'')', 'expected', 'EMAIL_ACCESS_DENIED'),
        jsonb_build_object('id', 'ROLE-03', 'section', 'security', 'test', 'member cannot add a suppression', 'actor', v_member,
          'stmt', format('select public.email_add_suppression(%L, %L)', v_email_main, 'manual'), 'expected', 'EMAIL_ACCESS_DENIED'),
        jsonb_build_object('id', 'ROLE-04', 'section', 'security', 'test', 'area_lead cannot lift a suppression', 'actor', v_lead,
          'stmt', format('select public.email_lift_suppression(%L::uuid, %L)', v_sup_optout, 'Intento de area lead'), 'expected', 'EMAIL_ACCESS_DENIED'),
        jsonb_build_object('id', 'ROLE-05', 'section', 'security', 'test', 'area_lead cannot import from CRM', 'actor', v_lead,
          'stmt', format('select public.email_import_contacts_from_crm(array[%s]::bigint[])', v_cl_a), 'expected', 'EMAIL_ACCESS_DENIED'),
        jsonb_build_object('id', 'ROLE-06', 'section', 'security', 'test', 'area_lead cannot record consent', 'actor', v_lead,
          'stmt', format('select public.email_record_consent(%L::uuid, %L, %L, %L, %L, now() - interval %L)', v_c_low, 'written', 'e2e', 'Acepto', 'v1', '1 hour'), 'expected', 'EMAIL_ACCESS_DENIED'),
        jsonb_build_object('id', 'ROLE-07', 'section', 'security', 'test', 'anon cannot execute email RPCs (create list)', 'actor', 'anon',
          'stmt', 'select public.email_create_list(''anon list'')', 'expected', 'permission denied for function email_create_list'),
        jsonb_build_object('id', 'ROLE-08', 'section', 'security', 'test', 'anon cannot execute email RPCs (preview)', 'actor', 'anon',
          'stmt', format('select public.email_preview_segment(%L::uuid, 5)', v_seg.id), 'expected', 'permission denied for function email_preview_segment'),
        jsonb_build_object('id', 'ROLE-09', 'section', 'security', 'test', 'anon cannot execute email RPCs (consent)', 'actor', 'anon',
          'stmt', format('select public.email_record_consent(%L::uuid, %L, %L, %L, %L, now())', v_c_low, 'written', 'e2e', 'Acepto', 'v1'), 'expected', 'permission denied for function email_record_consent'),
        -- direct DML as an authenticated founder must be impossible (RPC only)
        jsonb_build_object('id', 'DML-01', 'section', 'security', 'test', 'founder direct INSERT into email_lists', 'actor', v_fa,
          'stmt', format('insert into public.email_lists (organization_id, name, created_by) values (%L::uuid, %L, %L::uuid)', v_org_a, 'direct ' || v_tag, v_fa), 'expected', 'permission denied for table email_lists'),
        jsonb_build_object('id', 'DML-02', 'section', 'security', 'test', 'founder direct UPDATE of email_contacts', 'actor', v_fa,
          'stmt', format('update public.email_contacts set first_name = %L where id = %L::uuid', 'Hack', v_c_main), 'expected', 'permission denied for table email_contacts'),
        jsonb_build_object('id', 'DML-03', 'section', 'security', 'test', 'founder direct DELETE from email_audit_log', 'actor', v_fa,
          'stmt', format('delete from public.email_audit_log where organization_id = %L::uuid', v_org_a), 'expected', 'permission denied for table email_audit_log'),
        jsonb_build_object('id', 'DML-04', 'section', 'security', 'test', 'founder direct INSERT of a suppression', 'actor', v_fa,
          'stmt', format('insert into public.email_suppressions (organization_id, email_normalized, reason, source, actor_type) values (%L::uuid, %L, %L, %L, %L)', v_org_a, 'x-' || v_email_main, 'manual', 'manual', 'user'), 'expected', 'permission denied for table email_suppressions'),
        jsonb_build_object('id', 'DML-05', 'section', 'security', 'test', 'founder direct DELETE of consent ledger rows', 'actor', v_fa,
          'stmt', format('delete from public.email_contact_consents where organization_id = %L::uuid', v_org_a), 'expected', 'permission denied for table email_contact_consents'),
        jsonb_build_object('id', 'DML-06', 'section', 'security', 'test', 'founder direct UPDATE of a segment', 'actor', v_fa,
          'stmt', format('update public.email_segments set name = %L where id = %L::uuid', 'hack', v_seg.id), 'expected', 'permission denied for table email_segments'),
        jsonb_build_object('id', 'DML-07', 'section', 'security', 'test', 'founder direct INSERT of a field value', 'actor', v_fa,
          'stmt', format('insert into public.email_contact_field_values (organization_id, contact_id, field_id, value) values (%L::uuid, %L::uuid, %L::uuid, %L::jsonb)', v_org_a, v_c_low, v_f_plan, '"premium"'), 'expected', 'permission denied for table email_contact_field_values'),
        jsonb_build_object('id', 'DML-08', 'section', 'security', 'test', 'founder cannot call the private sendability engine', 'actor', v_fa,
          'stmt', format('select private.email_is_sendable(%L::uuid, %L::uuid, %L)', v_org_a, v_c_main, 'marketing'), 'expected', 'permission denied for*'),
        -- Inc1 invariants still hold for the table owner (Inc2 did not weaken them)
        jsonb_build_object('id', 'INV-01', 'section', 'inc1_invariants', 'test', 'owner cannot UPDATE the audit log', 'actor', 'postgres',
          'stmt', format('update public.email_audit_log set details = %L::jsonb where organization_id = %L::uuid', '{}', v_org_a), 'expected', 'EMAIL_AUDIT_IMMUTABLE'),
        jsonb_build_object('id', 'INV-02', 'section', 'inc1_invariants', 'test', 'owner cannot DELETE the audit log', 'actor', 'postgres',
          'stmt', format('delete from public.email_audit_log where organization_id = %L::uuid', v_org_a), 'expected', 'EMAIL_AUDIT_IMMUTABLE'),
        jsonb_build_object('id', 'INV-03', 'section', 'inc1_invariants', 'test', 'owner cannot UPDATE the consent ledger', 'actor', 'postgres',
          'stmt', format('update public.email_contact_consents set source = %L where contact_id = %L::uuid', 'hack', v_c_main), 'expected', 'EMAIL_CONSENT_LEDGER_APPEND_ONLY'),
        jsonb_build_object('id', 'INV-04', 'section', 'inc1_invariants', 'test', 'owner cannot DELETE the consent ledger', 'actor', 'postgres',
          'stmt', format('delete from public.email_contact_consents where organization_id = %L::uuid', v_org_a), 'expected', 'EMAIL_CONSENT_LEDGER_APPEND_ONLY'),
        jsonb_build_object('id', 'INV-05', 'section', 'inc1_invariants', 'test', 'owner cannot DELETE suppressions', 'actor', 'postgres',
          'stmt', format('delete from public.email_suppressions where organization_id = %L::uuid', v_org_a), 'expected', 'EMAIL_SUPPRESSION_DELETE_FORBIDDEN'),
        jsonb_build_object('id', 'INV-06', 'section', 'inc1_invariants', 'test', 'owner cannot re-activate a lifted suppression', 'actor', 'postgres',
          'stmt', format('update public.email_suppressions set lifted_at = null, lifted_by = null, lift_reason = null where id = %L::uuid', v_sup_main), 'expected', 'EMAIL_SUPPRESSION_ALREADY_LIFTED'),
        jsonb_build_object('id', 'INV-07', 'section', 'inc1_invariants', 'test', 'owner cannot DELETE contacts', 'actor', 'postgres',
          'stmt', format('delete from public.email_contacts where organization_id = %L::uuid', v_org_a), 'expected', 'EMAIL_CONTACT_DELETE_FORBIDDEN'),
        jsonb_build_object('id', 'INV-08', 'section', 'inc1_invariants', 'test', 'owner cannot change a contact''s address identity', 'actor', 'postgres',
          'stmt', format('update public.email_contacts set email = %L, email_normalized = %L where id = %L::uuid', 'x-' || v_email_main, 'x-' || v_email_main, v_c_main), 'expected', 'EMAIL_CONTACT_IDENTITY_IMMUTABLE'),
        jsonb_build_object('id', 'INV-09', 'section', 'inc1_invariants', 'test', 'owner cannot DELETE CRM links (append-only)', 'actor', 'postgres',
          'stmt', format('delete from public.email_contact_crm_links where organization_id = %L::uuid', v_org_a), 'expected', 'EMAIL_CRM_LINK_APPEND_ONLY'),
        jsonb_build_object('id', 'INV-10', 'section', 'inc1_invariants', 'test', 'owner cannot DELETE catalog rows (lists)', 'actor', 'postgres',
          'stmt', format('delete from public.email_lists where organization_id = %L::uuid', v_org_a), 'expected', 'EMAIL_CATALOG_DELETE_FORBIDDEN'),
        jsonb_build_object('id', 'INV-11', 'section', 'inc1_invariants', 'test', 'owner cannot retype a custom field', 'actor', 'postgres',
          'stmt', format('update public.email_custom_field_definitions set field_type = %L where id = %L::uuid', 'text', v_f_orders), 'expected', 'EMAIL_CATALOG_FIELD_IMMUTABLE'),
        jsonb_build_object('id', 'INV-12', 'section', 'inc1_invariants', 'test', 'owner cannot move a field value to another contact', 'actor', 'postgres',
          'stmt', format('update public.email_contact_field_values set contact_id = %L::uuid where contact_id = %L::uuid and field_id = %L::uuid', v_c_optout, v_c_main, v_f_orders), 'expected', 'EMAIL_FIELD_VALUE_IDENTITY_IMMUTABLE')
      );

      for v_tc in select * from jsonb_to_recordset(v_cases) as x(id text, section text, test text, actor text, stmt text, expected text) loop
        perform set_config('role', 'postgres', true);
        execute v_counts_sql into v_snap_before using v_orgs;
        execute v_md5_sql into v_res using v_orgs;
        v_snap_before := v_snap_before || v_res;
        if v_tc.actor = 'anon' then
          perform set_config('request.jwt.claim.sub', '', true), set_config('request.jwt.claims', '', true), set_config('role', 'anon', true);
        elsif v_tc.actor <> 'postgres' then
          perform set_config('request.jwt.claim.sub', v_tc.actor, true),
                  set_config('request.jwt.claims', json_build_object('sub', v_tc.actor, 'role', 'authenticated')::text, true),
                  set_config('role', 'authenticated', true);
        end if;
        begin
          execute v_tc.stmt;
          v_txt := 'NO_ERROR';
        exception when others then
          v_txt := sqlerrm;
        end;
        perform set_config('role', 'postgres', true);
        execute v_counts_sql into v_snap_after using v_orgs;
        execute v_md5_sql into v_res using v_orgs;
        v_snap_after := v_snap_after || v_res;
        v_ok := (v_txt = v_tc.expected or (right(v_tc.expected, 1) = '*' and v_txt like left(v_tc.expected, -1) || '%'))
                and v_snap_before = v_snap_after;
        v_checks := v_checks || jsonb_build_object('id', v_tc.id, 'section', v_tc.section,
          'kind', case when v_tc.section = 'security' then 'SECURITY' when v_tc.section = 'isolation' then 'ISOLATION' else 'NEGATIVE TEST' end,
          'test', v_tc.test || ' -> rejected, nothing changed',
          'expected', jsonb_build_object('error', v_tc.expected, 'mutations', 'none'),
          'actual', jsonb_build_object('error', v_txt, 'mutations', case when v_snap_before = v_snap_after then to_jsonb('none'::text)
                      else (select jsonb_object_agg(k, jsonb_build_array(v_snap_before -> k, v_snap_after -> k)) from jsonb_object_keys(v_snap_after) k
                            where v_snap_before -> k is distinct from v_snap_after -> k) end),
          'status', case when v_ok then 'PASS' else 'FAIL' end);
      end loop;
      perform set_config('role', 'postgres', true);

      -- the all-or-nothing batch really kept the old value
      v_checks := v_checks || jsonb_build_object('id', 'NEG-30', 'section', 'negative_tests', 'kind', 'NEGATIVE TEST',
        'test', 'after all negative tests, main contact still has pedidos_mensuales=120, plan=premium, 1 consent',
        'expected', '{"pedidos_mensuales":120,"plan_interes":"premium","consents":1}'::jsonb,
        'actual', jsonb_build_object(
          'pedidos_mensuales', (select v.value from public.email_contact_field_values v where v.contact_id = v_c_main and v.field_id = v_f_orders),
          'plan_interes', (select v.value from public.email_contact_field_values v where v.contact_id = v_c_main and v.field_id = v_f_plan),
          'consents', (select count(*) from public.email_contact_consents k where k.contact_id = v_c_main)),
        'status', 'PENDING');
      v_checks := jsonb_set(v_checks, array[(jsonb_array_length(v_checks) - 1)::text, 'status'],
        to_jsonb(case when v_checks -> -1 -> 'expected' = v_checks -> -1 -> 'actual' then 'PASS' else 'FAIL' end));
    else
      v_skipped := v_skipped || '"negative_tests"'::jsonb;
    end if;

    -- ========================================================================
    -- 12. AUDIT (complete, ordered, attributed, no plaintext addresses)
    -- ========================================================================
    if v_halted is null then
      begin
        perform set_config('role', 'postgres', true);
        v_checks := v_checks || jsonb_build_object('id', 'AUDIT-01', 'section', 'audit', 'kind', 'AUDIT',
          'test', 'organization A audit trail: complete and in logical order',
          'expected', '["email.contact.created", "email.crm.import_completed", "email.crm.import_completed", "email.consent.granted",
            "email.list.created", "email.contact.created", "email.contact.created", "email.consent.granted", "email.consent.granted",
            "email.list.members_added", "email.list.members_added", "email.tag.created", "email.tag.assigned", "email.tag.assigned",
            "email.custom_field.created", "email.custom_field.created", "email.custom_field.created",
            "email.contact.fields_updated", "email.contact.fields_updated", "email.contact.fields_updated",
            "email.segment.created", "email.segment.updated", "email.suppression.created", "email.suppression.lifted",
            "email.contact.created", "email.consent.granted", "email.consent.revoked", "email.suppression.created",
            "email.suppression.created", "email.tag.created"]'::jsonb,
          'actual', (select jsonb_agg(a.action order by a.id) from public.email_audit_log a where a.organization_id = v_org_a));
        v_checks := v_checks || jsonb_build_object('id', 'AUDIT-02', 'section', 'audit', 'kind', 'AUDIT',
          'test', 'organization B audit trail: only B''s own actions',
          'expected', '["email.list.created", "email.tag.created", "email.custom_field.created", "email.contact.created", "email.crm.import_completed", "email.list.members_added"]'::jsonb,
          'actual', (select jsonb_agg(a.action order by a.id) from public.email_audit_log a where a.organization_id = v_org_b));
        v_checks := v_checks || jsonb_build_object('id', 'AUDIT-03', 'section', 'audit', 'kind', 'AUDIT',
          'test', 'every entry is attributed to the real actor (founder A; the last one to admin A; B to founder B)',
          'expected', '{"a_founder":29,"a_admin":1,"a_other":0,"b_founder":6,"b_other":0}'::jsonb,
          'actual', jsonb_build_object(
            'a_founder', (select count(*) from public.email_audit_log a where a.organization_id = v_org_a and a.actor_user_id = v_fa and a.actor_type = 'user'),
            'a_admin', (select count(*) from public.email_audit_log a where a.organization_id = v_org_a and a.actor_user_id = v_admin),
            'a_other', (select count(*) from public.email_audit_log a where a.organization_id = v_org_a and a.actor_user_id is distinct from v_fa and a.actor_user_id is distinct from v_admin),
            'b_founder', (select count(*) from public.email_audit_log a where a.organization_id = v_org_b and a.actor_user_id = v_fb),
            'b_other', (select count(*) from public.email_audit_log a where a.organization_id = v_org_b and a.actor_user_id is distinct from v_fb)));
        v_checks := v_checks || jsonb_build_object('id', 'AUDIT-04', 'section', 'audit', 'kind', 'AUDIT',
          'test', 'audit entries point at the right entities',
          'expected', '{"consent":true,"segment_created":true,"segment_updated":true,"suppression_created":true,"suppression_lifted":true,"list":true}'::jsonb,
          'actual', jsonb_build_object(
            'consent', exists (select 1 from public.email_audit_log a where a.organization_id = v_org_a and a.action = 'email.consent.granted' and a.entity_id = v_consent_main),
            'segment_created', exists (select 1 from public.email_audit_log a where a.organization_id = v_org_a and a.action = 'email.segment.created' and a.entity_id = v_seg.id),
            'segment_updated', exists (select 1 from public.email_audit_log a where a.organization_id = v_org_a and a.action = 'email.segment.updated' and a.entity_id = v_seg.id),
            'suppression_created', exists (select 1 from public.email_audit_log a where a.organization_id = v_org_a and a.action = 'email.suppression.created' and a.entity_id = v_sup_main),
            'suppression_lifted', exists (select 1 from public.email_audit_log a where a.organization_id = v_org_a and a.action = 'email.suppression.lifted' and a.entity_id = v_sup_main),
            'list', exists (select 1 from public.email_audit_log a where a.organization_id = v_org_a and a.action = 'email.list.created' and a.entity_id = v_list_a)));
        v_checks := v_checks || jsonb_build_object('id', 'AUDIT-05', 'section', 'audit', 'kind', 'AUDIT',
          'test', 'no audit entry stores a plaintext email address', 'expected', 0,
          'actual', (select count(*) from public.email_audit_log a where a.organization_id = any (v_orgs) and a.details::text like '%@%'));
      exception when others then
        get stacked diagnostics v_err_ctx = pg_exception_context;
        v_checks := v_checks || jsonb_build_object('id', 'ERR-audit', 'section', 'audit', 'kind', 'ERROR',
          'test', 'section ran without unexpected errors', 'expected', 'no error', 'actual', sqlerrm || ' [' || sqlstate || ']',
          'status', 'FAIL', 'context', left(v_err_ctx, 400));
      end;
    else
      v_skipped := v_skipped || '"audit"'::jsonb;
    end if;

    -- ========================================================================
    -- 13. FINAL STATE (before rollback)
    -- ========================================================================
    perform set_config('role', 'postgres', true);
    if v_halted is null then
      begin
        execute v_counts_sql into v_res using array[v_org_a];
        execute v_counts_sql into v_res2 using array[v_org_b];
        v_final_pre := jsonb_build_object('org_a', v_res, 'org_b', v_res2);
        v_checks := v_checks || jsonb_build_object('id', 'FIN-01', 'section', 'final_state', 'kind', 'FINAL STATE',
          'test', 'organization A final counts',
          'expected', '{"contacts":4,"consents":5,"suppressions":3,"suppressions_active":2,"audit":30,"lists":1,"list_members":3,"tags":2,"contact_tags":2,"fields":3,"field_values":5,"segments":1,"crm_links":1}'::jsonb,
          'actual', v_res);
        v_checks := v_checks || jsonb_build_object('id', 'FIN-02', 'section', 'final_state', 'kind', 'FINAL STATE',
          'test', 'organization B final counts',
          'expected', '{"contacts":1,"consents":0,"suppressions":0,"suppressions_active":0,"audit":6,"lists":1,"list_members":1,"tags":1,"contact_tags":0,"fields":1,"field_values":0,"segments":0,"crm_links":1}'::jsonb,
          'actual', v_res2);
        v_checks := v_checks || jsonb_build_object('id', 'FIN-03', 'section', 'final_state', 'kind', 'FINAL STATE',
          'test', 'main contact ends SENDABLE and in the segment (version 2)',
          'expected', jsonb_build_object('reason_code', 'SENDABLE', 'segment_version', 2),
          'actual', jsonb_build_object('reason_code', (select s.reason_code from private.email_is_sendable(v_org_a, v_c_main, 'marketing') s),
                      'segment_version', (select s.version from public.email_segments s where s.id = v_seg.id)));
        execute v_other_sql into v_other_after using v_all_orgs;
        v_checks := v_checks || jsonb_build_object('id', 'FIN-04', 'section', 'isolation', 'kind', 'ISOLATION',
          'test', 'no email row of any other organization was created or changed during the run',
          'expected', v_other_before, 'actual', v_other_after);
        v_checks := v_checks || jsonb_build_object('id', 'FIN-05', 'section', 'isolation', 'kind', 'ISOLATION',
          'test', 'no scenario address exists outside organizations A/B; helper orgs of admin/member/lead hold no email rows',
          'expected', '{"foreign_scenario_contacts":0,"helper_org_rows":0}'::jsonb,
          'actual', jsonb_build_object(
            'foreign_scenario_contacts', (select count(*) from public.email_contacts c where c.email_normalized like v_tag || '%' and c.organization_id <> all (v_orgs)),
            'helper_org_rows', (select count(*) from public.email_contacts c where c.organization_id = any (v_all_orgs) and c.organization_id <> all (v_orgs))
              + (select count(*) from public.email_audit_log a where a.organization_id = any (v_all_orgs) and a.organization_id <> all (v_orgs))));
      exception when others then
        get stacked diagnostics v_err_ctx = pg_exception_context;
        v_checks := v_checks || jsonb_build_object('id', 'ERR-final_state', 'section', 'final_state', 'kind', 'ERROR',
          'test', 'section ran without unexpected errors', 'expected', 'no error', 'actual', sqlerrm || ' [' || sqlstate || ']',
          'status', 'FAIL', 'context', left(v_err_ctx, 400));
      end;
    else
      v_skipped := v_skipped || '"final_state"'::jsonb;
    end if;

    v_ids := v_ids || jsonb_build_object('contact_main', v_c_main, 'list_a', v_list_a, 'tag_a', v_tag_a, 'segment_a', v_seg.id,
      'suppression_main', v_sup_main, 'consent_main', v_consent_main, 'note', 'all ids were rolled back and no longer exist');

    -- Always discard every scenario write.
    raise exception using message = 'E2E_ROLLBACK_SENTINEL';
  exception when others then
    if sqlerrm <> 'E2E_ROLLBACK_SENTINEL' then
      get stacked diagnostics v_err_ctx = pg_exception_context;
      v_checks := v_checks || jsonb_build_object('id', 'ERR-runner', 'section', 'runner', 'kind', 'ERROR',
        'test', 'scenario ran without an unhandled error', 'expected', 'no error', 'actual', sqlerrm || ' [' || sqlstate || ']',
        'status', 'FAIL', 'context', left(v_err_ctx, 400));
    end if;
  end;
  end if;

  -- ==========================================================================
  -- 14. POST-ROLLBACK VERIFICATION (outside the scenario savepoint)
  -- ==========================================================================
  perform set_config('role', 'postgres', true);
  if v_blocked is null then
    v_checks := v_checks || jsonb_build_object('id', 'RB-01', 'section', 'final_state', 'kind', 'FINAL STATE',
      'test', 'rollback: no synthetic user, organization, CRM lead or email row of this run remains',
      'expected', '{"auth_users":0,"organizations":0,"clients":0,"email_contacts":0,"email_audit":0}'::jsonb,
      'actual', jsonb_build_object(
        'auth_users', (select count(*) from auth.users u where u.email like v_tag || '%'),
        'organizations', (select count(*) from public.organizations o where o.name like v_tag || '%'),
        'clients', (select count(*) from public.clients c where c.company_name like '%' || v_tag || '%'),
        'email_contacts', (select count(*) from public.email_contacts c where c.email_normalized like v_tag || '%'),
        'email_audit', (select count(*) from public.email_audit_log a where a.organization_id = any (coalesce(v_all_orgs, array[]::uuid[])))));
    v_checks := v_checks || jsonb_build_object('id', 'RB-02', 'section', 'final_state', 'kind', 'FINAL STATE',
      'test', 'migration history unchanged', 'expected', v_hist_before, 'actual', (select count(*) from supabase_migrations.schema_migrations));
    if v_other_before is not null then
      execute v_other_sql into v_other_after using v_all_orgs;
      v_checks := v_checks || jsonb_build_object('id', 'RB-03', 'section', 'final_state', 'kind', 'FINAL STATE',
        'test', 'all other organizations'' email data identical to before the run', 'expected', v_other_before, 'actual', v_other_after);
    end if;
    if v_human_org is not null then
      execute v_counts_sql into v_human_after using array[v_human_org];
      execute v_md5_sql into v_res using array[v_human_org];
      v_human_after := v_human_after || v_res;
      v_checks := v_checks || jsonb_build_object('id', 'RB-04', 'section', 'final_state', 'kind', 'ISOLATION',
        'test', 'human QA org zz-human-email-qa-001 (Lucia) untouched', 'expected', v_human_before, 'actual', v_human_after);
    end if;
  end if;

  -- ==========================================================================
  -- REPORT
  -- ==========================================================================
  v_checks := coalesce((select jsonb_agg(case when c ? 'status' then c else c || jsonb_build_object('status',
                 case when c -> 'expected' = c -> 'actual' then 'PASS' else 'FAIL' end) end order by o)
               from jsonb_array_elements(v_checks) with ordinality t(c, o)), '[]'::jsonb);
  v_total := jsonb_array_length(v_checks);
  v_passed := (select count(*) from jsonb_array_elements(v_checks) c where c ->> 'status' = 'PASS');
  v_failed := v_total - v_passed;
  v_status := case when v_blocked is not null then 'BLOCKED' when v_failed = 0 and v_halted is null then 'PASS' else 'FAIL' end;

  v_report := jsonb_build_object(
    'suite', 'email_marketing_v1_inc1_inc2_human_acceptance',
    'environment', 'staging',
    'run_id', v_run,
    'status', v_status,
    'tests_total', v_total,
    'passed', v_passed,
    'failed', v_failed,
    'warnings', jsonb_array_length(v_warnings),
    'blocked_reason', v_blocked,
    'halted_after_section', v_halted,
    'skipped_sections', v_skipped,
    'lift_suppression', v_lift_support,
    'persistence', jsonb_build_object('committed_writes', 'NONE',
      'strategy', 'all scenario writes ran inside a savepoint that was always rolled back; only identity-sequence values were consumed'),
    'production_contacted', 'NO',
    'environment_detail', v_env,
    'failures', coalesce((select jsonb_agg(c order by o) from jsonb_array_elements(v_checks) with ordinality t(c, o) where c ->> 'status' <> 'PASS'), '[]'::jsonb),
    'warnings_detail', v_warnings,
    'sections', coalesce((select jsonb_object_agg(s.section, jsonb_build_object(
        'passed', s.passed, 'failed', s.failed, 'checks', s.checks))
      from (select c ->> 'section' as section,
                   count(*) filter (where c ->> 'status' = 'PASS') as passed,
                   count(*) filter (where c ->> 'status' <> 'PASS') as failed,
                   jsonb_agg(jsonb_build_object('id', c -> 'id', 'kind', c -> 'kind', 'test', c -> 'test', 'expected', c -> 'expected',
                     'actual', c -> 'actual', 'status', c -> 'status') || case when c ? 'context' then jsonb_build_object('context', c -> 'context') else '{}'::jsonb end
                     order by o) as checks
            from jsonb_array_elements(v_checks) with ordinality t(c, o)
            group by c ->> 'section') s), '{}'::jsonb),
    'final_state', jsonb_build_object('before_rollback', v_final_pre, 'after_rollback', 'no rows of this run remain (see RB-*)',
      'scenario_ids', v_ids));

  v_summary := 'EMAIL MARKETING INC1-2 ACCEPTANCE: ' || v_status || chr(10)
    || v_passed || '/' || v_total || ' checks passed' || chr(10)
    || 'Production contacted: NO' || chr(10)
    || 'Staging writes committed: NONE (run ' || v_run || ' rolled back)'
    || case when v_blocked is not null then chr(10) || 'BLOCKED: ' || v_blocked else '' end
    || case when v_halted is not null then chr(10) || 'HALTED after section: ' || v_halted else '' end;

  perform set_config('orvesen.email_e2e_summary', v_summary, true);
  perform set_config('orvesen.email_e2e_report', v_report::text, true);
end
$runner$;

select current_setting('orvesen.email_e2e_summary') as summary,
       jsonb_pretty(current_setting('orvesen.email_e2e_report')::jsonb) as report;

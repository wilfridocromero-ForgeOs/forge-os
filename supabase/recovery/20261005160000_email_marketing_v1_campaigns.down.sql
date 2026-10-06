-- ORVESEN Email Marketing V1 - Increment 3c: controlled STAGING recovery.
--
-- Reverses supabase/migrations/20261005160000_email_marketing_v1_campaigns.sql
-- and restores the exact Increment 3a state: email_campaigns and every
-- Increment 3c function are removed, and the email_audit_log entity-type
-- check gets back its Increment 3a definition. private.email_can is not
-- touched (Increment 3c never changed it; recovery refuses if it differs from
-- the Increment 3a definition).
--
-- STAGING ONLY. Production is forward-fix only: never run this there.
-- ORDER: recover Increment 3c before Increment 3a (the Increment 3a recovery
-- refuses while 20261005160000 is recorded or any Increment 3c object exists).
--
-- OPERATIONAL PRECONDITION: EMAIL INC3C RECOVERY REQUIRES A MIGRATION/DDL FREEZE.
-- For the whole recovery window: no migration may be running; no
-- schema-changing DDL may be running; nobody performs schema changes in the
-- SQL Editor; migration/deployment automation (CI, supabase db push, branch
-- deploys) is paused. The safety invariant is
--   operational freeze + technical pre-check + recovery locks,
-- not SQL alone. The pre-check is byte for byte the hardened Increment 3a
-- pre-check (visibility first, pg_locks alone, only a visible autovacuum
-- worker exempt, pg_stat_clear_snapshot() before each run); it runs before
-- any lock and again once every lock is held, and never terminates sessions.
-- RESIDUAL LIMITATION: SQL cannot completely detect or serialize against
-- arbitrary uncommitted DDL already executing in another session. The freeze
-- is what closes that gap.
--
-- Lock order (lock_timeout = 10s; a timeout changes nothing: it aborts the
-- transaction, or, if the client continues, the destructive statement finds
-- the lock missing and refuses):
--   1. supabase_migrations.schema_migrations  EXCLUSIVE (when it exists);
--   2. public.email_campaigns                 ACCESS EXCLUSIVE;
--   3. public.email_audit_log                 ACCESS EXCLUSIVE, UP FRONT: the
--      CHECK restore needs it, so it is never upgraded later (no Inc3a L-B).
-- Always this order, so two recoveries cannot deadlock each other.
--
-- Fails closed. It refuses to run, changing nothing, if any of
-- these holds:
-- * EMAIL_RECOVERY_REFUSED_CONCURRENT_ACTIVITY: the pre-check found
--   concurrent schema activity (before locking, or again with every lock held);
-- * EMAIL_RECOVERY_REFUSED_LATER_MIGRATION: the migration history records a
--   version after 20261005160000;
-- * EMAIL_RECOVERY_REFUSED_UNKNOWN_MIGRATION: the history records any version
--   outside the frozen Increment 3a REVIEWED RECOVERY BASELINE, Increment 3a,
--   the REVIEWED INC3C WINDOW (versions between 3a and 3c reviewed before
--   applying 3c; refresh it from the target right before applying 3c) and
--   Increment 3c;
-- * EMAIL_RECOVERY_REFUSED_UNEXPECTED_STATE: private.email_can is not the
--   Increment 3a definition; or the email_audit_log entity-type CHECK, the set
--   of email_* relations, the set of email_* functions, or the columns,
--   triggers, policies or indexes of email_campaigns differ from the exact
--   Increment 3c inventory; or a function outside Increment 3c references
--   email_campaigns or calls an Increment 3c function; or any object outside
--   Increment 3c depends (pg_depend) on email_campaigns, its row type or an
--   Increment 3c function;
-- * EMAIL_RECOVERY_REFUSED_INCOMPLETE_PRECONDITIONS: raised by the final,
--   destructive statement when this transaction did not pass every check
--   above, in order, or this session does not hold every recovery lock (a
--   client continued after a refusal or a failed LOCK); nothing is changed;
-- * EMAIL_RECOVERY_REFUSED_DATA_PRESENT: any campaign row or any audit row of
--   entity type 'campaign' exists. The audit log is immutable, so such rows can
--   never be removed and the Increment 3a check could not be restored around
--   them; recovering a Staging database that holds campaign data requires an
--   explicit, separate decision.
--
-- Run the whole file at once (Supabase SQL Editor); with psql also pass
-- -v ON_ERROR_STOP=1 (never ON_ERROR_ROLLBACK) as defense in depth. It is one
-- transaction, and its all-or-nothing guarantee does not depend on the client
-- stopping at the first error: every change is made by ONE final statement,
-- which refuses (EMAIL_RECOVERY_REFUSED_INCOMPLETE_PRECONDITIONS) unless every
-- check above passed, in order, in this same transaction and this session
-- still holds every recovery lock.

begin;

-- Give up (and change nothing) rather than queue indefinitely behind readers.
set local lock_timeout = '10s';
-- Check sequence of THIS transaction (see the destructive phase). Reset first,
-- so no stale value (an earlier run in this transaction, a role or database
-- default) can count.
set local orvesen.email_inc3c_recovery = '';
-- Concurrent schema-activity check (before any lock). Part of the safety invariant
-- "migration/DDL freeze + this check + recovery locks"; see the header. It
-- only reads pg_locks, pg_stat_activity and pg_prepared_xacts and never
-- signals or terminates another session.
do $$
declare
  this_database oid := (select d.oid from pg_catalog.pg_database as d where d.datname = pg_catalog.current_database());
begin
  -- pg_stat_activity is cached for the rest of the transaction on first
  -- access; discard that copy so this check reads current activity (the
  -- second run would otherwise repeat the first run's view).
  perform pg_catalog.pg_stat_clear_snapshot();
  if exists (select 1 from pg_catalog.pg_prepared_xacts as x where x.database = pg_catalog.current_database()) then
    raise exception using errcode = '55000', message = 'EMAIL_RECOVERY_REFUSED_CONCURRENT_ACTIVITY',
      detail = 'A prepared transaction exists and may hold schema changes; resolve it, keep the freeze and retry.';
  end if;
  -- Visibility first. A session this role may not inspect is reported with
  -- query '<insufficient privilege>' and NULL state and backend_type, so it is
  -- refused here, before any filter on those columns could discard it.
  if exists (
    select 1 from pg_catalog.pg_stat_activity as a
    where a.pid <> pg_catalog.pg_backend_pid()
      and a.datid = this_database
      and (coalesce(a.query, '<insufficient privilege>') = '<insufficient privilege>' or a.backend_type is null)
  ) then
    raise exception using errcode = '55000', message = 'EMAIL_RECOVERY_REFUSED_CONCURRENT_ACTIVITY',
      detail = 'Another session in this database is not fully visible to this role (run recovery as a role that can see every session, e.g. a member of pg_read_all_stats); keep the freeze and retry.';
  end if;
  -- Locks are read from pg_locks alone (visible to every role). The only
  -- exemption is a session POSITIVELY visible as an autovacuum worker; a
  -- lock whose session cannot be identified counts.
  if exists (
    select 1 from pg_catalog.pg_locks as l
    where l.pid is distinct from pg_catalog.pg_backend_pid()
      and l.locktype = 'relation' and l.relation = to_regclass('supabase_migrations.schema_migrations')
      and l.mode <> 'AccessShareLock'
      and not exists (select 1 from pg_catalog.pg_stat_activity as a
                      where a.pid = l.pid and a.backend_type = 'autovacuum worker')
  ) then
    raise exception using errcode = '55000', message = 'EMAIL_RECOVERY_REFUSED_CONCURRENT_ACTIVITY',
      detail = 'Another session writes or locks the migration history (a migration may be running); keep the freeze and retry.';
  end if;
  if exists (
    select 1 from pg_catalog.pg_locks as l
    where l.pid is distinct from pg_catalog.pg_backend_pid()
      and l.locktype = 'relation' and l.database = this_database
      and l.mode in ('ShareUpdateExclusiveLock', 'ShareLock', 'ShareRowExclusiveLock', 'ExclusiveLock', 'AccessExclusiveLock')
      and not exists (select 1 from pg_catalog.pg_stat_activity as a
                      where a.pid = l.pid and a.backend_type = 'autovacuum worker')
  ) then
    raise exception using errcode = '55000', message = 'EMAIL_RECOVERY_REFUSED_CONCURRENT_ACTIVITY',
      detail = 'Another session holds or awaits a schema-level table lock (DDL may be running); keep the freeze and retry.';
  end if;
  -- Every remaining session is fully visible (checked above).
  if exists (
    select 1 from pg_catalog.pg_stat_activity as a
    where a.pid <> pg_catalog.pg_backend_pid()
      and a.datid = this_database
      and a.state in ('active', 'idle in transaction', 'idle in transaction (aborted)', 'fastpath function call')
      and regexp_replace(a.query, '--[^\n]*|/\*([^*]|\*+[^*/])*\*+/', ' ', 'g')
          ~* '(^|;)\s*(create|alter|drop|comment\s+on|grant|revoke|truncate|reindex|cluster|refresh\s+materialized|security\s+label|import\s+foreign)\M'
  ) then
    raise exception using errcode = '55000', message = 'EMAIL_RECOVERY_REFUSED_CONCURRENT_ACTIVITY',
      detail = 'Another session in a transaction runs schema-changing SQL; keep the freeze and retry.';
  end if;
  -- Last: record that this check passed (verified by the destructive phase).
  perform pg_catalog.set_config('orvesen.email_inc3c_recovery',
    coalesce(pg_catalog.current_setting('orvesen.email_inc3c_recovery', true), '') || 'precheck/', true);
end;
$$;
do $$
begin
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    lock table supabase_migrations.schema_migrations in exclusive mode;
  end if;
end;
$$;
lock table public.email_campaigns in access exclusive mode;
lock table public.email_audit_log in access exclusive mode;

-- Concurrent schema-activity check (repeated with every lock held). Part of the safety invariant
-- "migration/DDL freeze + this check + recovery locks"; see the header. It
-- only reads pg_locks, pg_stat_activity and pg_prepared_xacts and never
-- signals or terminates another session.
do $$
declare
  this_database oid := (select d.oid from pg_catalog.pg_database as d where d.datname = pg_catalog.current_database());
begin
  -- pg_stat_activity is cached for the rest of the transaction on first
  -- access; discard that copy so this check reads current activity (the
  -- second run would otherwise repeat the first run's view).
  perform pg_catalog.pg_stat_clear_snapshot();
  if exists (select 1 from pg_catalog.pg_prepared_xacts as x where x.database = pg_catalog.current_database()) then
    raise exception using errcode = '55000', message = 'EMAIL_RECOVERY_REFUSED_CONCURRENT_ACTIVITY',
      detail = 'A prepared transaction exists and may hold schema changes; resolve it, keep the freeze and retry.';
  end if;
  -- Visibility first. A session this role may not inspect is reported with
  -- query '<insufficient privilege>' and NULL state and backend_type, so it is
  -- refused here, before any filter on those columns could discard it.
  if exists (
    select 1 from pg_catalog.pg_stat_activity as a
    where a.pid <> pg_catalog.pg_backend_pid()
      and a.datid = this_database
      and (coalesce(a.query, '<insufficient privilege>') = '<insufficient privilege>' or a.backend_type is null)
  ) then
    raise exception using errcode = '55000', message = 'EMAIL_RECOVERY_REFUSED_CONCURRENT_ACTIVITY',
      detail = 'Another session in this database is not fully visible to this role (run recovery as a role that can see every session, e.g. a member of pg_read_all_stats); keep the freeze and retry.';
  end if;
  -- Locks are read from pg_locks alone (visible to every role). The only
  -- exemption is a session POSITIVELY visible as an autovacuum worker; a
  -- lock whose session cannot be identified counts.
  if exists (
    select 1 from pg_catalog.pg_locks as l
    where l.pid is distinct from pg_catalog.pg_backend_pid()
      and l.locktype = 'relation' and l.relation = to_regclass('supabase_migrations.schema_migrations')
      and l.mode <> 'AccessShareLock'
      and not exists (select 1 from pg_catalog.pg_stat_activity as a
                      where a.pid = l.pid and a.backend_type = 'autovacuum worker')
  ) then
    raise exception using errcode = '55000', message = 'EMAIL_RECOVERY_REFUSED_CONCURRENT_ACTIVITY',
      detail = 'Another session writes or locks the migration history (a migration may be running); keep the freeze and retry.';
  end if;
  if exists (
    select 1 from pg_catalog.pg_locks as l
    where l.pid is distinct from pg_catalog.pg_backend_pid()
      and l.locktype = 'relation' and l.database = this_database
      and l.mode in ('ShareUpdateExclusiveLock', 'ShareLock', 'ShareRowExclusiveLock', 'ExclusiveLock', 'AccessExclusiveLock')
      and not exists (select 1 from pg_catalog.pg_stat_activity as a
                      where a.pid = l.pid and a.backend_type = 'autovacuum worker')
  ) then
    raise exception using errcode = '55000', message = 'EMAIL_RECOVERY_REFUSED_CONCURRENT_ACTIVITY',
      detail = 'Another session holds or awaits a schema-level table lock (DDL may be running); keep the freeze and retry.';
  end if;
  -- Every remaining session is fully visible (checked above).
  if exists (
    select 1 from pg_catalog.pg_stat_activity as a
    where a.pid <> pg_catalog.pg_backend_pid()
      and a.datid = this_database
      and a.state in ('active', 'idle in transaction', 'idle in transaction (aborted)', 'fastpath function call')
      and regexp_replace(a.query, '--[^\n]*|/\*([^*]|\*+[^*/])*\*+/', ' ', 'g')
          ~* '(^|;)\s*(create|alter|drop|comment\s+on|grant|revoke|truncate|reindex|cluster|refresh\s+materialized|security\s+label|import\s+foreign)\M'
  ) then
    raise exception using errcode = '55000', message = 'EMAIL_RECOVERY_REFUSED_CONCURRENT_ACTIVITY',
      detail = 'Another session in a transaction runs schema-changing SQL; keep the freeze and retry.';
  end if;
  -- Last: record that this check passed (verified by the destructive phase).
  perform pg_catalog.set_config('orvesen.email_inc3c_recovery',
    coalesce(pg_catalog.current_setting('orvesen.email_inc3c_recovery', true), '') || 'precheck/', true);
end;
$$;

do $$
begin
  -- No later migration may exist: it could depend on Increment 3c objects in
  -- ways PostgreSQL does not track.
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    if exists (select 1 from supabase_migrations.schema_migrations as history
               where history.version > '20261005160000') then
      raise exception using errcode = '55000', message = 'EMAIL_RECOVERY_REFUSED_LATER_MIGRATION',
        detail = 'A migration after 20261005160000 is recorded; revert it first.';
    end if;
  end if;
  -- Every recorded version must be reviewed: the frozen Increment 3a baseline,
  -- Increment 3a, the reviewed Increment 3c window, or Increment 3c itself.
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    if exists (select 1 from supabase_migrations.schema_migrations as history
               where history.version <> all (array[
        -- BEGIN REVIEWED RECOVERY BASELINE
        '20260801000000', '20260804024641', '20260804024801', '20260804032506', '20260804034711',
        '20260804040409', '20260804053330', '20260804053623', '20260804053742', '20260804054000',
        '20260805043427', '20260805214000', '20260805214901', '20260805225901', '20260805230703',
        '20260805231035', '20260806001003', '20260806001619', '20260812152424', '20260812163716',
        '20260812220748', '20260813163650', '20260813171737', '20260813221029', '20260814024158',
        '20260815152136', '20260816120000', '20260816163000', '20260817041053', '20260817043432',
        '20260817045223', '20260817051504', '20260817052316', '20260817054006', '20260817055247',
        '20260818035929', '20260820215916', '20260820223846', '20260821001924', '20260821041044',
        '20260821043453', '20260821140738', '20260821144709', '20260824040734', '20260824061821',
        '20260825023927', '20260825034138', '20260825143548', '20260825150527', '20260825152706',
        '20260825211531', '20260825222738', '20260828025626', '20260828032216', '20260829042134',
        '20260830033635', '20260831052721', '20260831053555', '20260831142311', '20260831145554',
        '20260901020615', '20260901023430', '20260901170000', '20260901180001', '20260901222338',
        '20260902', '20260904110000', '20260904111500', '20260905120000', '20260909214636',
        '20260913155327', '20260915184800', '20260916090000', '20260917000000', '20260917000100',
        '20260926160000', '20260927120000', '20260929120000'
        -- END REVIEWED RECOVERY BASELINE
        , '20261005160000'
        ]::text[])
                 and history.version <> all (array[
        -- BEGIN REVIEWED INC3C WINDOW
        -- END REVIEWED INC3C WINDOW
        ]::text[])) then
      raise exception using errcode = '55000', message = 'EMAIL_RECOVERY_REFUSED_UNKNOWN_MIGRATION',
        detail = 'A migration unknown when Increment 3c was applied is recorded; revert it first.';
    end if;
  end if;
  if (select md5(replace(p.prosrc, chr(13), '')) from pg_catalog.pg_proc as p
      where p.oid = 'private.email_can(text)'::regprocedure) is distinct from 'b271addc73f72916f81abb858e4bcf36' then
    raise exception using errcode = '55000', message = 'EMAIL_RECOVERY_REFUSED_UNEXPECTED_STATE',
      detail = 'private.email_can is not the Increment 3a definition; a later change must be reverted first.';
  end if;
  if exists (select 1 from public.email_campaigns)
     or exists (select 1 from public.email_audit_log where entity_type = 'campaign') then
    raise exception using errcode = '55000', message = 'EMAIL_RECOVERY_REFUSED_DATA_PRESENT',
      detail = 'Increment 3c data exists; recovery of this database needs an explicit decision.';
  end if;
  -- Exact Increment 3c inventory (C collation order).
  if (select array_agg(t order by t collate "C") from (select (regexp_matches(pg_catalog.pg_get_constraintdef(c.oid), '''([a-z_]+)''', 'g'))[1] as t
      from pg_catalog.pg_constraint as c where c.conname = 'email_audit_log_entity_type_check' and c.conrelid = 'public.email_audit_log'::regclass) as allowed) is distinct from array[
        'campaign', 'consent', 'contact', 'crm_import', 'custom_field', 'list', 'segment', 'sender_domain',
        'sender_identity', 'suppression', 'tag', 'template', 'template_version']::text[] then
    raise exception using errcode = '55000', message = 'EMAIL_RECOVERY_REFUSED_UNEXPECTED_STATE',
      detail = 'email_audit_log entity-type CHECK differs from the Increment 3c state; a later change must be reverted first.';
  end if;
  if (select array_agg(c.relname::text order by c.relname::text collate "C") from pg_catalog.pg_class as c
      join pg_catalog.pg_namespace as n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm', 'f') and c.relname like 'email\_%') is distinct from array[
        'email_audit_log', 'email_campaigns', 'email_contact_consents', 'email_contact_crm_links',
        'email_contact_field_values', 'email_contact_tags', 'email_contacts',
        'email_custom_field_definitions', 'email_list_members', 'email_lists', 'email_segments',
        'email_sender_domains', 'email_sender_identities', 'email_suppressions', 'email_tags',
        'email_template_versions', 'email_templates']::text[] then
    raise exception using errcode = '55000', message = 'EMAIL_RECOVERY_REFUSED_UNEXPECTED_STATE',
      detail = 'The set of email_* relations differs from the Increment 3c state; a later change must be reverted first.';
  end if;
  if (select array_agg(n.nspname || '.' || p.proname order by n.nspname || '.' || p.proname collate "C")
      from pg_catalog.pg_proc as p join pg_catalog.pg_namespace as n on n.oid = p.pronamespace
      where n.nspname in ('public', 'private') and p.proname like 'email\_%') is distinct from array[
        'private.email_address_hash', 'private.email_campaign_readiness_report',
        'private.email_campaigns_guard', 'private.email_can', 'private.email_catalog_guard',
        'private.email_clean_description', 'private.email_clean_label', 'private.email_clean_locale',
        'private.email_clean_name', 'private.email_clean_timezone', 'private.email_clean_uuid_batch',
        'private.email_contact_consents_guard', 'private.email_contact_field_values_guard',
        'private.email_contacts_guard', 'private.email_content_invalid', 'private.email_content_text',
        'private.email_content_validate', 'private.email_custom_value_is_valid',
        'private.email_from_name_is_valid', 'private.email_header_text_is_valid',
        'private.email_header_text_problem', 'private.email_is_sendable', 'private.email_is_uuid_text',
        'private.email_json_int_between', 'private.email_merge_tag_paths',
        'private.email_normalize_address', 'private.email_normalize_domain', 'private.email_preview',
        'private.email_preview_footer', 'private.email_reject_mutation',
        'private.email_rendered_header_is_safe', 'private.email_request_hash', 'private.email_require',
        'private.email_resolve_merge_values', 'private.email_segment_invalid',
        'private.email_segment_matches', 'private.email_segment_rule_matches',
        'private.email_segment_validate', 'private.email_segments_versioning',
        'private.email_sender_domains_archive_guard', 'private.email_sender_identities_domain_guard',
        'private.email_sender_identities_versioning', 'private.email_suppressions_guard',
        'private.email_template_content_hash', 'private.email_template_merge_paths',
        'private.email_template_versions_advance', 'private.email_template_versions_guard',
        'private.email_templates_latest_guard', 'private.email_text_has_header_unsafe_chars',
        'private.email_text_has_raw_html', 'private.email_text_has_unsafe_chars',
        'private.email_url_is_allowed', 'private.email_write_audit', 'public.email_add_contact_tags',
        'public.email_add_list_members', 'public.email_add_suppression',
        'public.email_archive_campaign', 'public.email_archive_contact',
        'public.email_archive_custom_field', 'public.email_archive_list',
        'public.email_archive_segment', 'public.email_archive_sender_domain',
        'public.email_archive_sender_identity', 'public.email_archive_tag',
        'public.email_archive_template', 'public.email_campaign_preview_input',
        'public.email_campaign_readiness', 'public.email_create_campaign',
        'public.email_create_contact', 'public.email_create_custom_field', 'public.email_create_list',
        'public.email_create_segment', 'public.email_create_sender_domain',
        'public.email_create_sender_identity', 'public.email_create_tag',
        'public.email_create_template', 'public.email_create_template_version',
        'public.email_import_contacts_from_crm', 'public.email_lift_suppression',
        'public.email_preview_audience', 'public.email_preview_segment', 'public.email_record_consent',
        'public.email_remove_contact_tags', 'public.email_remove_list_members',
        'public.email_revoke_consent', 'public.email_set_contact_fields',
        'public.email_update_campaign', 'public.email_update_contact', 'public.email_update_segment',
        'public.email_update_sender_identity', 'public.email_validate_content']::text[] then
    raise exception using errcode = '55000', message = 'EMAIL_RECOVERY_REFUSED_UNEXPECTED_STATE',
      detail = 'The set of email_* functions differs from the Increment 3c state; a later change must be reverted first.';
  end if;
  if (select array_agg(c.relname || '.' || a.attname order by c.relname || '.' || a.attname collate "C")
      from pg_catalog.pg_attribute as a join pg_catalog.pg_class as c on c.oid = a.attrelid
      join pg_catalog.pg_namespace as n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = 'email_campaigns' and a.attnum > 0 and not a.attisdropped) is distinct from array[
        'email_campaigns.archived_at', 'email_campaigns.archived_by',
        'email_campaigns.audience_definition', 'email_campaigns.audience_sha256',
        'email_campaigns.created_at', 'email_campaigns.created_by', 'email_campaigns.description',
        'email_campaigns.id', 'email_campaigns.name', 'email_campaigns.name_normalized',
        'email_campaigns.organization_id', 'email_campaigns.sender_identity_id',
        'email_campaigns.status', 'email_campaigns.template_id', 'email_campaigns.template_version',
        'email_campaigns.updated_at', 'email_campaigns.version']::text[] then
    raise exception using errcode = '55000', message = 'EMAIL_RECOVERY_REFUSED_UNEXPECTED_STATE',
      detail = 'The columns of email_campaigns differ from the Increment 3c state; a later change must be reverted first.';
  end if;
  if (select array_agg(c.relname || '.' || t.tgname order by c.relname || '.' || t.tgname collate "C")
      from pg_catalog.pg_trigger as t join pg_catalog.pg_class as c on c.oid = t.tgrelid
      join pg_catalog.pg_namespace as n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = 'email_campaigns' and not t.tgisinternal) is distinct from array[
        'email_campaigns.email_campaigns_guard', 'email_campaigns.email_campaigns_no_truncate']::text[] then
    raise exception using errcode = '55000', message = 'EMAIL_RECOVERY_REFUSED_UNEXPECTED_STATE',
      detail = 'The triggers on email_campaigns differ from the Increment 3c state; a later change must be reverted first.';
  end if;
  if (select array_agg(p.tablename || '.' || p.policyname order by p.tablename || '.' || p.policyname collate "C")
      from pg_catalog.pg_policies as p where p.schemaname = 'public' and p.tablename = 'email_campaigns') is distinct from array[
        'email_campaigns.email_campaigns_select']::text[] then
    raise exception using errcode = '55000', message = 'EMAIL_RECOVERY_REFUSED_UNEXPECTED_STATE',
      detail = 'The policies on email_campaigns differ from the Increment 3c state; a later change must be reverted first.';
  end if;
  if (select array_agg(i.tablename || '.' || i.indexname order by i.tablename || '.' || i.indexname collate "C")
      from pg_catalog.pg_indexes as i where i.schemaname = 'public' and i.tablename = 'email_campaigns') is distinct from array[
        'email_campaigns.email_campaigns_active_name_key',
        'email_campaigns.email_campaigns_organization_id_id_key',
        'email_campaigns.email_campaigns_pkey', 'email_campaigns.email_campaigns_sender_idx',
        'email_campaigns.email_campaigns_template_idx']::text[] then
    raise exception using errcode = '55000', message = 'EMAIL_RECOVERY_REFUSED_UNEXPECTED_STATE',
      detail = 'The indexes on email_campaigns differ from the Increment 3c state; a later change must be reverted first.';
  end if;
  -- No function outside Increment 3c may reference email_campaigns or call an
  -- Increment 3c function (function bodies are not tracked as dependencies).
  if exists (
    select 1 from pg_catalog.pg_proc as p join pg_catalog.pg_namespace as n on n.oid = p.pronamespace
    where (p.prosrc ~ 'email_campaigns\M'
           or p.prosrc ~ '(email_campaign_readiness_report|email_campaigns_guard|email_preview_footer|email_resolve_merge_values|email_template_merge_paths|email_archive_campaign|email_campaign_preview_input|email_campaign_readiness|email_create_campaign|email_update_campaign)\M')
      and (n.nspname || '.' || p.proname) <> all (array[
        'private.email_campaign_readiness_report', 'private.email_campaigns_guard',
        'private.email_preview_footer', 'private.email_resolve_merge_values',
        'private.email_template_merge_paths', 'public.email_archive_campaign',
        'public.email_campaign_preview_input', 'public.email_campaign_readiness',
        'public.email_create_campaign', 'public.email_update_campaign']::text[])
  ) then
    raise exception using errcode = '55000', message = 'EMAIL_RECOVERY_REFUSED_UNEXPECTED_STATE',
      detail = 'A function outside Increment 3c references email_campaigns or an Increment 3c function; revert it first.';
  end if;
  -- Last: record that this check passed (verified by the destructive phase).
  perform pg_catalog.set_config('orvesen.email_inc3c_recovery',
    coalesce(pg_catalog.current_setting('orvesen.email_inc3c_recovery', true), '') || 'state/', true);
end;
$$;

-- Dependency completeness: nothing outside Increment 3c may depend (pg_depend)
-- on email_campaigns, its row type or an Increment 3c function (views,
-- foreign keys, policies, defaults, triggers, atomic function bodies...).
do $$
declare
  inc3c_tables oid[] := array(
    select c.oid from pg_catalog.pg_class as c join pg_catalog.pg_namespace as n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'email_campaigns');
  inc3c_functions oid[] := array(
    select p.oid from pg_catalog.pg_proc as p join pg_catalog.pg_namespace as n on n.oid = p.pronamespace
    where (n.nspname || '.' || p.proname) = any (array[
      'private.email_campaign_readiness_report', 'private.email_campaigns_guard',
      'private.email_preview_footer', 'private.email_resolve_merge_values',
      'private.email_template_merge_paths', 'public.email_archive_campaign',
      'public.email_campaign_preview_input', 'public.email_campaign_readiness',
      'public.email_create_campaign', 'public.email_update_campaign']::text[]));
  inc3c_types oid[] := array(
    select t.oid from pg_catalog.pg_type as t join pg_catalog.pg_class as c on t.oid in (c.reltype, (select r.typarray from pg_catalog.pg_type as r where r.oid = c.reltype))
    where c.oid = any (inc3c_tables));
begin
  if exists (
    select 1 from pg_catalog.pg_depend as d
    where d.deptype = 'n'
      and ((d.refclassid = 'pg_catalog.pg_class'::regclass and d.refobjid = any (inc3c_tables))
        or (d.refclassid = 'pg_catalog.pg_proc'::regclass and d.refobjid = any (inc3c_functions))
        or (d.refclassid = 'pg_catalog.pg_type'::regclass and d.refobjid = any (inc3c_types)))
      and not (
        (d.classid = 'pg_catalog.pg_class'::regclass and (d.objid = any (inc3c_tables)
          or exists (select 1 from pg_catalog.pg_index as i where i.indexrelid = d.objid and i.indrelid = any (inc3c_tables))))
        or (d.classid = 'pg_catalog.pg_proc'::regclass and d.objid = any (inc3c_functions))
        or (d.classid = 'pg_catalog.pg_type'::regclass and d.objid = any (inc3c_types))
        or (d.classid = 'pg_catalog.pg_constraint'::regclass
            and exists (select 1 from pg_catalog.pg_constraint as k where k.oid = d.objid and k.conrelid = any (inc3c_tables)))
        or (d.classid = 'pg_catalog.pg_trigger'::regclass
            and exists (select 1 from pg_catalog.pg_trigger as g where g.oid = d.objid and g.tgrelid = any (inc3c_tables)))
        or (d.classid = 'pg_catalog.pg_policy'::regclass
            and exists (select 1 from pg_catalog.pg_policy as y where y.oid = d.objid and y.polrelid = any (inc3c_tables)))
        or (d.classid = 'pg_catalog.pg_attrdef'::regclass
            and exists (select 1 from pg_catalog.pg_attrdef as f where f.oid = d.objid and f.adrelid = any (inc3c_tables))))
  ) then
    raise exception using errcode = '55000', message = 'EMAIL_RECOVERY_REFUSED_UNEXPECTED_STATE',
      detail = 'An object outside Increment 3c depends on email_campaigns, its row type or an Increment 3c function; revert it first.';
  end if;
  -- Last: record that this check passed (verified by the destructive phase).
  perform pg_catalog.set_config('orvesen.email_inc3c_recovery',
    coalesce(pg_catalog.current_setting('orvesen.email_inc3c_recovery', true), '') || 'dependencies/', true);
end;
$$;

-- Destructive phase: ONE statement. Every change below is inside this block,
-- so it is all-or-nothing by itself, whatever the client does after an error.
-- It first verifies that THIS transaction passed every check above, in order,
-- then that this session still holds every recovery lock in its exact mode
-- (email_audit_log ACCESS EXCLUSIVE was taken up front, so the CHECK restore
-- below needs no lock upgrade).
do $recovery$
begin
  if coalesce(pg_catalog.current_setting('orvesen.email_inc3c_recovery', true), '')
     is distinct from 'precheck/precheck/state/dependencies/' then
    raise exception using errcode = '55000', message = 'EMAIL_RECOVERY_REFUSED_INCOMPLETE_PRECONDITIONS',
      detail = 'Not every check of this recovery passed in this transaction (did the client continue after an error?); nothing was changed.';
  end if;
  if exists (
    select 1
    from (values
      ('supabase_migrations.schema_migrations', 'ExclusiveLock'),
      ('public.email_campaigns', 'AccessExclusiveLock'),
      ('public.email_audit_log', 'AccessExclusiveLock')) as required (relation_name, lock_mode)
    where (required.relation_name <> 'supabase_migrations.schema_migrations'
           or to_regclass(required.relation_name) is not null)
      and not exists (
        select 1 from pg_catalog.pg_locks as l
        where l.pid = pg_catalog.pg_backend_pid() and l.locktype = 'relation' and l.granted
          and l.relation = to_regclass(required.relation_name) and l.mode = required.lock_mode)
  ) then
    raise exception using errcode = '55000', message = 'EMAIL_RECOVERY_REFUSED_INCOMPLETE_PRECONDITIONS',
      detail = 'A recovery lock is not held by this transaction (did a LOCK fail and the client continue?); nothing was changed.';
  end if;

  -- RPCs first: two of them return the email_campaigns row type.
  drop function public.email_create_campaign(text, text);
  drop function public.email_update_campaign(uuid, jsonb, bigint);
  drop function public.email_archive_campaign(uuid);
  drop function public.email_campaign_readiness(uuid);
  drop function public.email_campaign_preview_input(uuid, uuid);

  -- The table (its policy, triggers, indexes and constraints go with it).
  drop table public.email_campaigns;

  -- Private helpers and the trigger function.
  drop function private.email_campaigns_guard();
  drop function private.email_campaign_readiness_report(uuid, uuid);
  drop function private.email_resolve_merge_values(uuid, uuid, uuid);
  drop function private.email_template_merge_paths(text, text, jsonb);
  drop function private.email_preview_footer();

  -- Increment 3a definition of the audit entity-type check.
  alter table public.email_audit_log
    drop constraint email_audit_log_entity_type_check,
    add constraint email_audit_log_entity_type_check check (entity_type in (
      'contact', 'consent', 'suppression',
      'list', 'tag', 'custom_field', 'segment', 'crm_import',
      'sender_domain', 'sender_identity', 'template', 'template_version'
    ));

  -- Forget the migration in the Supabase history (absent outside Supabase).
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    delete from supabase_migrations.schema_migrations where version = '20261005160000';
  end if;

  -- Consume the sequence: it cannot authorize anything else in this transaction.
  perform pg_catalog.set_config('orvesen.email_inc3c_recovery', '', true);
end;
$recovery$;

commit;

-- ORVESEN Email Marketing V1 - Increment 3a: controlled STAGING recovery.
--
-- Reverses supabase/migrations/20261004150000_email_marketing_v1_senders_templates.sql
-- and restores the exact Increment 1-2 state: every Increment 3a table,
-- function, trigger and policy is removed, private.email_can gets back its
-- Increment 1 source byte for byte (runner fingerprint bea78511...), and the
-- email_audit_log entity-type check gets back its Increment 2 definition.
--
-- STAGING ONLY. Production is forward-fix only: never run this there.
--
-- OPERATIONAL PRECONDITION: EMAIL INC3A RECOVERY REQUIRES A MIGRATION/DDL FREEZE.
-- For the whole recovery window: no migration may be running; no
-- schema-changing DDL may be running; nobody performs schema changes in the
-- SQL Editor; migration/deployment automation (CI, supabase db push, branch
-- deploys) is paused. The safety invariant is
--   operational freeze + technical pre-check + recovery locks,
-- not SQL alone. The pre-check (run before any lock and again once every
-- lock is held; each run first discards the cached activity snapshot with
-- pg_stat_clear_snapshot(), so the second run reads current activity, still
-- only at that instant) refuses on: a prepared transaction; FIRST, any other session
-- in this database that this role cannot fully see (query '<insufficient
-- privilege>' / NULL backend_type), before any filter on state or
-- backend_type, so run recovery as a role that can see every session (e.g. a
-- member of pg_read_all_stats) or it refuses; any lock (from pg_locks alone)
-- by another session writing or locking the migration history, or holding or
-- awaiting a schema-level table lock (SHARE UPDATE EXCLUSIVE or stronger),
-- unless that session is positively visible as an autovacuum worker; another
-- visible session in a transaction whose current or last statement is
-- schema-changing SQL. It never terminates sessions.
-- RESIDUAL LIMITATION: SQL cannot completely detect or serialize against
-- arbitrary uncommitted DDL already executing in another session. Uncommitted
-- catalog rows are invisible here, statements such as CREATE FUNCTION hold no
-- lasting table lock, an idle transaction's earlier DDL is not visible once
-- a later statement ran, and a session may start DDL after the last check.
-- The freeze is what closes that gap.
--
-- Lock order (lock_timeout = 10s; a timeout changes nothing: it aborts the
-- transaction, or, if the client continues, the destructive statement finds
-- the lock missing and refuses):
--   1. supabase_migrations.schema_migrations  EXCLUSIVE (when it exists): the
--      history validated below cannot change before the destructive steps;
--   2. the four Increment 3a tables              ACCESS EXCLUSIVE;
--   3. public.email_audit_log                    EXCLUSIVE.
-- Always this order, so two recoveries cannot deadlock each other.
--
-- Fails closed. It refuses to run, changing nothing, if any of
-- these holds:
-- * EMAIL_RECOVERY_REFUSED_CONCURRENT_ACTIVITY: the pre-check above found
--   concurrent schema activity (before locking, or again with every lock held);
-- * EMAIL_RECOVERY_REFUSED_LATER_MIGRATION: the migration history records a
--   version after 20261004150000 (it may depend on Increment 3a objects);
-- * EMAIL_RECOVERY_REFUSED_UNKNOWN_MIGRATION: the history records any version
--   outside the REVIEWED RECOVERY BASELINE plus Increment 3a. The baseline
--   shipped with the code is a BUILD-TIME snapshot (2026-09-29), not
--   guaranteed apply-time history: immediately before applying Increment 3a
--   to a real environment, refresh it from that environment and regenerate
--   this allowlist (supabase/tests/email_marketing_v1_recovery_baseline.mjs);
-- * EMAIL_RECOVERY_REFUSED_UNEXPECTED_STATE: private.email_can is not the
--   exact Increment 3a definition; or the email_audit_log entity-type CHECK,
--   the set of email_* relations, the set of email_* functions, or the
--   columns, triggers, policies or indexes of the Increment 3a tables differ
--   from the exact Increment 3a inventory; or a function outside Increment 3a
--   references an Increment 3a table or calls an Increment 3a function; or a
--   surviving function or policy uses an email_can action introduced by
--   Increment 3a (manage_senders, manage_content, manage_campaigns); or any
--   object outside Increment 3a depends (pg_depend) on an Increment 3a table,
--   row type or function; or a view, rule, column default, CHECK constraint,
--   trigger WHEN clause or atomic function body that depends on email_can or
--   email_require uses one of those actions (index expressions and generated columns cannot call
--   email_can, which is not immutable; an action computed at run time, e.g.
--   'manage_' || x, cannot be detected);
-- * EMAIL_RECOVERY_REFUSED_INCOMPLETE_PRECONDITIONS: raised by the final,
--   destructive statement when this transaction did not pass every check
--   above, in order, or this session does not hold every recovery lock (a
--   client continued after a refusal or a failed LOCK); nothing is changed;
-- * EMAIL_RECOVERY_REFUSED_DATA_PRESENT: any Increment 3a data exists. The
--   audit log is immutable, so audit rows of the new entity types can never be
--   removed and the Increment 2 check could not be restored around them;
--   recovering a Staging database that already holds such data requires an
--   explicit, separate decision.
--
-- Run the whole file at once (Supabase SQL Editor); with psql also pass
-- -v ON_ERROR_STOP=1 (never ON_ERROR_ROLLBACK) as defense in depth. It is one
-- transaction, and its all-or-nothing guarantee does not depend on the client
-- stopping at the first error: every change is made by ONE final statement,
-- which refuses (EMAIL_RECOVERY_REFUSED_INCOMPLETE_PRECONDITIONS) unless every
-- check above passed, in order, in this same transaction and this session
-- still holds every recovery lock. A client that rolls back only the failing
-- statement and continues (psql ON_ERROR_ROLLBACK, GUIs that roll back to a
-- savepoint on error) therefore still changes nothing after any refusal, and
-- a failure inside that final statement undoes all of it.

begin;

-- No migration-history write, Increment 3a write or email audit write can race
-- with the checks below. Give up (and change nothing) rather than queue
-- indefinitely behind readers.
set local lock_timeout = '10s';
-- Check sequence of THIS transaction (see the destructive phase). Reset first,
-- so no stale value (an earlier run in this transaction, a role or database
-- default) can count.
set local orvesen.email_inc3a_recovery = '';
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
  perform pg_catalog.set_config('orvesen.email_inc3a_recovery',
    coalesce(pg_catalog.current_setting('orvesen.email_inc3a_recovery', true), '') || 'precheck/', true);
end;
$$;
do $$
begin
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    lock table supabase_migrations.schema_migrations in exclusive mode;
  end if;
end;
$$;
lock table public.email_sender_domains, public.email_sender_identities, public.email_templates,
  public.email_template_versions in access exclusive mode;
lock table public.email_audit_log in exclusive mode;

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
  perform pg_catalog.set_config('orvesen.email_inc3a_recovery',
    coalesce(pg_catalog.current_setting('orvesen.email_inc3a_recovery', true), '') || 'precheck/', true);
end;
$$;

do $$
begin
  -- No later migration may exist: it could depend on Increment 3a objects in
  -- ways PostgreSQL does not track (function bodies, added columns/triggers).
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    if exists (select 1 from supabase_migrations.schema_migrations as history
               where history.version > '20261004150000') then
      raise exception using errcode = '55000', message = 'EMAIL_RECOVERY_REFUSED_LATER_MIGRATION',
        detail = 'A migration after 20261004150000 is recorded; revert it first.';
    end if;
  end if;
  -- Every recorded version must be in the reviewed recovery baseline (a
  -- build-time snapshot, refreshed from the target right before applying
  -- Increment 3a) or be Increment 3a itself: this also catches lower-versioned
  -- migrations applied afterwards.
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
        '20260926160000', '20260927120000', '20261002120000', '20261002130000', '20261003120000',
        '20261004150000'
        -- END REVIEWED RECOVERY BASELINE
        ]::text[])) then
      raise exception using errcode = '55000', message = 'EMAIL_RECOVERY_REFUSED_UNKNOWN_MIGRATION',
        detail = 'A migration unknown when Increment 3a was applied is recorded; revert it first.';
    end if;
  end if;
  -- The database must be in the exact Increment 3a state: if a later migration
  -- redefined email_can, reverting it here would silently break that migration.
  if (select md5(replace(p.prosrc, chr(13), '')) from pg_catalog.pg_proc as p
      where p.oid = 'private.email_can(text)'::regprocedure) is distinct from 'b271addc73f72916f81abb858e4bcf36' then
    raise exception using errcode = '55000', message = 'EMAIL_RECOVERY_REFUSED_UNEXPECTED_STATE',
      detail = 'private.email_can is not the Increment 3a definition; a later change must be reverted first.';
  end if;
  if exists (select 1 from public.email_sender_domains)
     or exists (select 1 from public.email_sender_identities)
     or exists (select 1 from public.email_templates)
     or exists (select 1 from public.email_template_versions)
     or exists (select 1 from public.email_audit_log
                where entity_type in ('sender_domain', 'sender_identity', 'template', 'template_version')) then
    raise exception using errcode = '55000', message = 'EMAIL_RECOVERY_REFUSED_DATA_PRESENT',
      detail = 'Increment 3a data exists; recovery of this database needs an explicit decision.';
  end if;
  -- Exact Increment 3a object inventory (C collation order, so the result
  -- never depends on the database locale). Anything added, removed or
  -- evolved since Increment 3a makes recovery refuse.
  if (select array_agg(t order by t collate "C") from (select (regexp_matches(pg_catalog.pg_get_constraintdef(c.oid), '''([a-z_]+)''', 'g'))[1] as t
      from pg_catalog.pg_constraint as c where c.conname = 'email_audit_log_entity_type_check' and c.conrelid = 'public.email_audit_log'::regclass) as allowed) is distinct from array[
        'consent', 'contact', 'crm_import', 'custom_field', 'list', 'segment', 'sender_domain',
        'sender_identity', 'suppression', 'tag', 'template', 'template_version']::text[] then
    raise exception using errcode = '55000', message = 'EMAIL_RECOVERY_REFUSED_UNEXPECTED_STATE',
      detail = 'email_audit_log entity-type CHECK differs from the Increment 3a state; a later change must be reverted first.';
  end if;
  if (select array_agg(c.relname::text order by c.relname::text collate "C") from pg_catalog.pg_class as c
      join pg_catalog.pg_namespace as n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm', 'f') and c.relname like 'email\_%') is distinct from array[
        'email_audit_log', 'email_contact_consents', 'email_contact_crm_links',
        'email_contact_field_values', 'email_contact_tags', 'email_contacts',
        'email_custom_field_definitions', 'email_list_members', 'email_lists', 'email_segments',
        'email_sender_domains', 'email_sender_identities', 'email_suppressions', 'email_tags',
        'email_template_versions', 'email_templates']::text[] then
    raise exception using errcode = '55000', message = 'EMAIL_RECOVERY_REFUSED_UNEXPECTED_STATE',
      detail = 'The set of email_* relations differs from the Increment 3a state; a later change must be reverted first.';
  end if;
  if (select array_agg(n.nspname || '.' || p.proname order by n.nspname || '.' || p.proname collate "C")
      from pg_catalog.pg_proc as p join pg_catalog.pg_namespace as n on n.oid = p.pronamespace
      where n.nspname in ('public', 'private') and p.proname like 'email\_%') is distinct from array[
        'private.email_address_hash', 'private.email_can', 'private.email_catalog_guard',
        'private.email_clean_description', 'private.email_clean_label', 'private.email_clean_locale',
        'private.email_clean_name', 'private.email_clean_timezone', 'private.email_clean_uuid_batch',
        'private.email_contact_consents_guard', 'private.email_contact_field_values_guard',
        'private.email_contacts_guard', 'private.email_content_invalid', 'private.email_content_text',
        'private.email_content_validate', 'private.email_custom_value_is_valid',
        'private.email_from_name_is_valid', 'private.email_header_text_is_valid',
        'private.email_header_text_problem', 'private.email_is_sendable', 'private.email_is_uuid_text',
        'private.email_json_int_between', 'private.email_merge_tag_paths',
        'private.email_normalize_address', 'private.email_normalize_domain', 'private.email_preview',
        'private.email_reject_mutation', 'private.email_rendered_header_is_safe',
        'private.email_request_hash', 'private.email_require', 'private.email_segment_invalid',
        'private.email_segment_matches', 'private.email_segment_rule_matches',
        'private.email_segment_validate', 'private.email_segments_versioning',
        'private.email_sender_domains_archive_guard', 'private.email_sender_identities_domain_guard',
        'private.email_sender_identities_versioning', 'private.email_suppressions_guard',
        'private.email_template_content_hash', 'private.email_template_versions_advance',
        'private.email_template_versions_guard', 'private.email_templates_latest_guard',
        'private.email_text_has_header_unsafe_chars', 'private.email_text_has_raw_html',
        'private.email_text_has_unsafe_chars', 'private.email_url_is_allowed',
        'private.email_write_audit', 'public.email_add_contact_tags', 'public.email_add_list_members',
        'public.email_add_suppression', 'public.email_archive_contact',
        'public.email_archive_custom_field', 'public.email_archive_list', 'public.email_archive_segment',
        'public.email_archive_sender_domain', 'public.email_archive_sender_identity',
        'public.email_archive_tag', 'public.email_archive_template', 'public.email_create_contact',
        'public.email_create_custom_field', 'public.email_create_list', 'public.email_create_segment',
        'public.email_create_sender_domain', 'public.email_create_sender_identity',
        'public.email_create_tag', 'public.email_create_template',
        'public.email_create_template_version', 'public.email_import_contacts_from_crm',
        'public.email_lift_suppression', 'public.email_preview_audience', 'public.email_preview_segment',
        'public.email_record_consent', 'public.email_remove_contact_tags',
        'public.email_remove_list_members', 'public.email_revoke_consent',
        'public.email_set_contact_fields', 'public.email_update_contact', 'public.email_update_segment',
        'public.email_update_sender_identity', 'public.email_validate_content']::text[] then
    raise exception using errcode = '55000', message = 'EMAIL_RECOVERY_REFUSED_UNEXPECTED_STATE',
      detail = 'The set of email_* functions differs from the Increment 3a state; a later change must be reverted first.';
  end if;
  if (select array_agg(c.relname || '.' || a.attname order by c.relname || '.' || a.attname collate "C")
      from pg_catalog.pg_attribute as a join pg_catalog.pg_class as c on c.oid = a.attrelid
      join pg_catalog.pg_namespace as n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = any (array['email_sender_domains', 'email_sender_identities', 'email_templates', 'email_template_versions']) and a.attnum > 0 and not a.attisdropped) is distinct from array[
        'email_sender_domains.archived_at', 'email_sender_domains.archived_by',
        'email_sender_domains.created_at', 'email_sender_domains.created_by',
        'email_sender_domains.domain', 'email_sender_domains.id', 'email_sender_domains.organization_id',
        'email_sender_domains.status', 'email_sender_domains.verification_status',
        'email_sender_identities.address', 'email_sender_identities.archived_at',
        'email_sender_identities.archived_by', 'email_sender_identities.created_at',
        'email_sender_identities.created_by', 'email_sender_identities.domain_id',
        'email_sender_identities.from_name', 'email_sender_identities.id',
        'email_sender_identities.local_part', 'email_sender_identities.organization_id',
        'email_sender_identities.reply_to', 'email_sender_identities.status',
        'email_sender_identities.updated_at', 'email_sender_identities.version',
        'email_template_versions.content', 'email_template_versions.content_sha256',
        'email_template_versions.created_at', 'email_template_versions.created_by',
        'email_template_versions.id', 'email_template_versions.merge_tag_count',
        'email_template_versions.merge_tags_sha256', 'email_template_versions.organization_id',
        'email_template_versions.preheader', 'email_template_versions.subject',
        'email_template_versions.template_id', 'email_template_versions.version_number',
        'email_templates.archived_at', 'email_templates.archived_by', 'email_templates.created_at',
        'email_templates.created_by', 'email_templates.description', 'email_templates.id',
        'email_templates.latest_version', 'email_templates.name', 'email_templates.name_normalized',
        'email_templates.organization_id', 'email_templates.status', 'email_templates.updated_at']::text[] then
    raise exception using errcode = '55000', message = 'EMAIL_RECOVERY_REFUSED_UNEXPECTED_STATE',
      detail = 'The columns of the Increment 3a tables differs from the Increment 3a state; a later change must be reverted first.';
  end if;
  if (select array_agg(c.relname || '.' || t.tgname order by c.relname || '.' || t.tgname collate "C")
      from pg_catalog.pg_trigger as t join pg_catalog.pg_class as c on c.oid = t.tgrelid
      join pg_catalog.pg_namespace as n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = any (array['email_sender_domains', 'email_sender_identities', 'email_templates', 'email_template_versions']) and not t.tgisinternal) is distinct from array[
        'email_sender_domains.email_sender_domains_archive_guard',
        'email_sender_domains.email_sender_domains_guard',
        'email_sender_domains.email_sender_domains_no_truncate',
        'email_sender_identities.email_sender_identities_domain_guard',
        'email_sender_identities.email_sender_identities_guard',
        'email_sender_identities.email_sender_identities_no_truncate',
        'email_sender_identities.email_sender_identities_versioning',
        'email_template_versions.email_template_versions_advance',
        'email_template_versions.email_template_versions_guard',
        'email_template_versions.email_template_versions_immutable',
        'email_template_versions.email_template_versions_no_truncate',
        'email_templates.email_templates_guard', 'email_templates.email_templates_latest_guard',
        'email_templates.email_templates_no_truncate']::text[] then
    raise exception using errcode = '55000', message = 'EMAIL_RECOVERY_REFUSED_UNEXPECTED_STATE',
      detail = 'The triggers on the Increment 3a tables differs from the Increment 3a state; a later change must be reverted first.';
  end if;
  if (select array_agg(p.tablename || '.' || p.policyname order by p.tablename || '.' || p.policyname collate "C")
      from pg_catalog.pg_policies as p where p.schemaname = 'public' and p.tablename = any (array['email_sender_domains', 'email_sender_identities', 'email_templates', 'email_template_versions'])) is distinct from array[
        'email_sender_domains.email_sender_domains_select',
        'email_sender_identities.email_sender_identities_select',
        'email_template_versions.email_template_versions_select',
        'email_templates.email_templates_select']::text[] then
    raise exception using errcode = '55000', message = 'EMAIL_RECOVERY_REFUSED_UNEXPECTED_STATE',
      detail = 'The policies on the Increment 3a tables differs from the Increment 3a state; a later change must be reverted first.';
  end if;
  if (select array_agg(i.tablename || '.' || i.indexname order by i.tablename || '.' || i.indexname collate "C")
      from pg_catalog.pg_indexes as i where i.schemaname = 'public' and i.tablename = any (array['email_sender_domains', 'email_sender_identities', 'email_templates', 'email_template_versions'])) is distinct from array[
        'email_sender_domains.email_sender_domains_active_domain_key',
        'email_sender_domains.email_sender_domains_organization_id_id_key',
        'email_sender_domains.email_sender_domains_pkey',
        'email_sender_identities.email_sender_identities_active_address_key',
        'email_sender_identities.email_sender_identities_domain_idx',
        'email_sender_identities.email_sender_identities_organization_id_id_key',
        'email_sender_identities.email_sender_identities_pkey',
        'email_template_versions.email_template_versions_organization_id_id_key',
        'email_template_versions.email_template_versions_organization_id_template_id_version_key',
        'email_template_versions.email_template_versions_pkey',
        'email_templates.email_templates_active_name_key',
        'email_templates.email_templates_organization_id_id_key', 'email_templates.email_templates_pkey']::text[] then
    raise exception using errcode = '55000', message = 'EMAIL_RECOVERY_REFUSED_UNEXPECTED_STATE',
      detail = 'The indexes on the Increment 3a tables differs from the Increment 3a state; a later change must be reverted first.';
  end if;
  -- No function outside the Increment 3a set (and email_can itself) may
  -- reference its tables, call its functions, or use the email_can actions it
  -- introduced (function bodies are not tracked as dependencies).
  if exists (
    select 1 from pg_catalog.pg_proc as p join pg_catalog.pg_namespace as n on n.oid = p.pronamespace
    where ((p.prosrc ~ 'email_(sender_domains|sender_identities|templates|template_versions)\M'
           or p.prosrc ~ '(email_content_invalid|email_content_text|email_content_validate|email_from_name_is_valid|email_header_text_is_valid|email_header_text_problem|email_json_int_between|email_merge_tag_paths|email_normalize_domain|email_rendered_header_is_safe|email_sender_domains_archive_guard|email_sender_identities_domain_guard|email_sender_identities_versioning|email_template_content_hash|email_template_versions_advance|email_template_versions_guard|email_templates_latest_guard|email_text_has_header_unsafe_chars|email_text_has_raw_html|email_text_has_unsafe_chars|email_url_is_allowed|email_archive_sender_domain|email_archive_sender_identity|email_archive_template|email_create_sender_domain|email_create_sender_identity|email_create_template|email_create_template_version|email_update_sender_identity|email_validate_content)\M')
           or p.prosrc ~ 'manage_(senders|content|campaigns)')
      and (n.nspname || '.' || p.proname) <> all (array[
        'private.email_can', 'private.email_content_invalid', 'private.email_content_text',
        'private.email_content_validate', 'private.email_from_name_is_valid',
        'private.email_header_text_is_valid', 'private.email_header_text_problem',
        'private.email_json_int_between', 'private.email_merge_tag_paths',
        'private.email_normalize_domain', 'private.email_rendered_header_is_safe',
        'private.email_sender_domains_archive_guard', 'private.email_sender_identities_domain_guard',
        'private.email_sender_identities_versioning', 'private.email_template_content_hash',
        'private.email_template_versions_advance', 'private.email_template_versions_guard',
        'private.email_templates_latest_guard', 'private.email_text_has_header_unsafe_chars',
        'private.email_text_has_raw_html', 'private.email_text_has_unsafe_chars',
        'private.email_url_is_allowed', 'public.email_archive_sender_domain',
        'public.email_archive_sender_identity', 'public.email_archive_template',
        'public.email_create_sender_domain', 'public.email_create_sender_identity',
        'public.email_create_template', 'public.email_create_template_version',
        'public.email_update_sender_identity', 'public.email_validate_content']::text[])
  ) then
    raise exception using errcode = '55000', message = 'EMAIL_RECOVERY_REFUSED_UNEXPECTED_STATE',
      detail = 'A function outside Increment 3a references an Increment 3a table, function or email_can action; revert it first.';
  end if;
  -- No policy may use the email_can actions introduced by Increment 3a: after
  -- recovery they would silently deny everyone.
  if exists (
    select 1 from pg_catalog.pg_policies as pol
    where coalesce(pol.qual, '') ~ 'manage_(senders|content|campaigns)'
       or coalesce(pol.with_check, '') ~ 'manage_(senders|content|campaigns)'
  ) then
    raise exception using errcode = '55000', message = 'EMAIL_RECOVERY_REFUSED_UNEXPECTED_STATE',
      detail = 'A policy uses an email_can action introduced by Increment 3a; revert it first.';
  end if;
  -- Last: record that this check passed (verified by the destructive phase).
  perform pg_catalog.set_config('orvesen.email_inc3a_recovery',
    coalesce(pg_catalog.current_setting('orvesen.email_inc3a_recovery', true), '') || 'state/', true);
end;
$$;

-- Dependency completeness. PostgreSQL records dependencies for views, rules,
-- column defaults, CHECK constraints, trigger WHEN clauses, policies and
-- SQL-standard (BEGIN ATOMIC) function bodies, so these checks use pg_depend
-- rather than text search. Plain SQL/PL/pgSQL bodies are not tracked; the
-- text checks above cover them.
do $$
declare
  inc3a_tables oid[] := array(
    select c.oid from pg_catalog.pg_class as c join pg_catalog.pg_namespace as n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname in ('email_sender_domains', 'email_sender_identities', 'email_templates', 'email_template_versions'));
  inc3a_functions oid[] := array(
    select p.oid from pg_catalog.pg_proc as p join pg_catalog.pg_namespace as n on n.oid = p.pronamespace
    where (n.nspname || '.' || p.proname) = any (array[
      'private.email_content_invalid', 'private.email_content_text',
      'private.email_content_validate', 'private.email_from_name_is_valid',
      'private.email_header_text_is_valid', 'private.email_header_text_problem',
      'private.email_json_int_between', 'private.email_merge_tag_paths',
      'private.email_normalize_domain', 'private.email_rendered_header_is_safe',
      'private.email_sender_domains_archive_guard',
      'private.email_sender_identities_domain_guard',
      'private.email_sender_identities_versioning', 'private.email_template_content_hash',
      'private.email_template_versions_advance', 'private.email_template_versions_guard',
      'private.email_templates_latest_guard', 'private.email_text_has_header_unsafe_chars',
      'private.email_text_has_raw_html', 'private.email_text_has_unsafe_chars',
      'private.email_url_is_allowed', 'public.email_archive_sender_domain',
      'public.email_archive_sender_identity', 'public.email_archive_template',
      'public.email_create_sender_domain', 'public.email_create_sender_identity',
      'public.email_create_template', 'public.email_create_template_version',
      'public.email_update_sender_identity', 'public.email_validate_content']::text[]));
  inc3a_types oid[] := array(
    select t.oid from pg_catalog.pg_type as t join pg_catalog.pg_class as c on t.oid in (c.reltype, (select r.typarray from pg_catalog.pg_type as r where r.oid = c.reltype))
    where c.oid = any (inc3a_tables));
begin
  -- Nothing outside Increment 3a may depend on its tables, row types or
  -- functions (views, foreign keys, policies, defaults, triggers, atomic
  -- function bodies...): dropping them would break it or fail.
  if exists (
    select 1 from pg_catalog.pg_depend as d
    where d.deptype = 'n'
      and ((d.refclassid = 'pg_catalog.pg_class'::regclass and d.refobjid = any (inc3a_tables))
        or (d.refclassid = 'pg_catalog.pg_proc'::regclass and d.refobjid = any (inc3a_functions))
        or (d.refclassid = 'pg_catalog.pg_type'::regclass and d.refobjid = any (inc3a_types)))
      and not (
        (d.classid = 'pg_catalog.pg_class'::regclass and (d.objid = any (inc3a_tables)
          or exists (select 1 from pg_catalog.pg_index as i where i.indexrelid = d.objid and i.indrelid = any (inc3a_tables))))
        or (d.classid = 'pg_catalog.pg_proc'::regclass and d.objid = any (inc3a_functions))
        or (d.classid = 'pg_catalog.pg_type'::regclass and d.objid = any (inc3a_types))
        or (d.classid = 'pg_catalog.pg_constraint'::regclass
            and exists (select 1 from pg_catalog.pg_constraint as k where k.oid = d.objid and k.conrelid = any (inc3a_tables)))
        or (d.classid = 'pg_catalog.pg_trigger'::regclass
            and exists (select 1 from pg_catalog.pg_trigger as g where g.oid = d.objid and g.tgrelid = any (inc3a_tables)))
        or (d.classid = 'pg_catalog.pg_policy'::regclass
            and exists (select 1 from pg_catalog.pg_policy as y where y.oid = d.objid and y.polrelid = any (inc3a_tables)))
        or (d.classid = 'pg_catalog.pg_attrdef'::regclass
            and exists (select 1 from pg_catalog.pg_attrdef as f where f.oid = d.objid and f.adrelid = any (inc3a_tables))))
  ) then
    raise exception using errcode = '55000', message = 'EMAIL_RECOVERY_REFUSED_UNEXPECTED_STATE',
      detail = 'An object outside Increment 3a depends on an Increment 3a table, type or function; revert it first.';
  end if;
  -- Objects that call private.email_can or private.email_require (the Inc1
  -- helper that passes the action through to email_can): every dependent kind
  -- PostgreSQL can record is inspected through its own deparsed definition
  -- (atomic function bodies, whose prosrc is empty, through
  -- pg_get_functiondef). Only the quoted action literal is matched, which
  -- deparsing never schema-qualifies, so the result does not depend on
  -- search_path. An unknown kind refuses (fail closed).
  if exists (
    select 1 from pg_catalog.pg_depend as d
    where d.refclassid = 'pg_catalog.pg_proc'::regclass and d.refobjid in ('private.email_can(text)'::regprocedure, 'private.email_require(text)'::regprocedure)
      and d.classid not in ('pg_catalog.pg_rewrite'::regclass, 'pg_catalog.pg_attrdef'::regclass,
        'pg_catalog.pg_constraint'::regclass, 'pg_catalog.pg_trigger'::regclass, 'pg_catalog.pg_policy'::regclass,
        'pg_catalog.pg_proc'::regclass)
  ) then
    raise exception using errcode = '55000', message = 'EMAIL_RECOVERY_REFUSED_UNEXPECTED_STATE',
      detail = 'An object of an unexpected kind depends on private.email_can or private.email_require; review and revert it first.';
  end if;
  if exists (
    select 1 from pg_catalog.pg_depend as d
    where d.refclassid = 'pg_catalog.pg_proc'::regclass and d.refobjid in ('private.email_can(text)'::regprocedure, 'private.email_require(text)'::regprocedure)
      and coalesce(case
        when d.classid = 'pg_catalog.pg_rewrite'::regclass then pg_catalog.pg_get_ruledef(d.objid)
        when d.classid = 'pg_catalog.pg_attrdef'::regclass then
          (select pg_catalog.pg_get_expr(f.adbin, f.adrelid) from pg_catalog.pg_attrdef as f where f.oid = d.objid)
        when d.classid = 'pg_catalog.pg_constraint'::regclass then pg_catalog.pg_get_constraintdef(d.objid)
        when d.classid = 'pg_catalog.pg_trigger'::regclass then pg_catalog.pg_get_triggerdef(d.objid)
        when d.classid = 'pg_catalog.pg_policy'::regclass then
          (select coalesce(pg_catalog.pg_get_expr(y.polqual, y.polrelid), '') || ' '
                  || coalesce(pg_catalog.pg_get_expr(y.polwithcheck, y.polrelid), '')
           from pg_catalog.pg_policy as y where y.oid = d.objid)
        when d.classid = 'pg_catalog.pg_proc'::regclass then pg_catalog.pg_get_functiondef(d.objid)
      end, '') ~ 'manage_(senders|content|campaigns)'
  ) then
    raise exception using errcode = '55000', message = 'EMAIL_RECOVERY_REFUSED_UNEXPECTED_STATE',
      detail = 'A view, rule, default, CHECK constraint, trigger WHEN clause, policy or atomic function uses an email_can action introduced by Increment 3a; revert it first.';
  end if;
  -- Last: record that this check passed (verified by the destructive phase).
  perform pg_catalog.set_config('orvesen.email_inc3a_recovery',
    coalesce(pg_catalog.current_setting('orvesen.email_inc3a_recovery', true), '') || 'dependencies/', true);
end;
$$;

-- Destructive phase: ONE statement. Every change below is inside this block,
-- so it is all-or-nothing by itself, whatever the client does after an error.
-- It first verifies that THIS transaction passed every check above, in order:
-- each check records its success as its last action, and a refused check is
-- rolled back together with its record, also by a client that rolls back only
-- the failing statement. It then verifies that this session still holds every
-- recovery lock: a LOCK that failed and was rolled back is not held, and no
-- later statement takes these locks, so a lock held here was held during the
-- re-check with every lock held and the checks after it.
do $recovery$
begin
  if coalesce(pg_catalog.current_setting('orvesen.email_inc3a_recovery', true), '')
     is distinct from 'precheck/precheck/state/dependencies/' then
    raise exception using errcode = '55000', message = 'EMAIL_RECOVERY_REFUSED_INCOMPLETE_PRECONDITIONS',
      detail = 'Not every check of this recovery passed in this transaction (did the client continue after an error?); nothing was changed.';
  end if;
  if exists (
    select 1
    from (values
      ('supabase_migrations.schema_migrations', 'ExclusiveLock'),
      ('public.email_sender_domains', 'AccessExclusiveLock'),
      ('public.email_sender_identities', 'AccessExclusiveLock'),
      ('public.email_templates', 'AccessExclusiveLock'),
      ('public.email_template_versions', 'AccessExclusiveLock'),
      ('public.email_audit_log', 'ExclusiveLock')) as required (relation_name, lock_mode)
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

  -- RPCs first: several return the Increment 3a table row types.
  drop function public.email_create_sender_domain(text);
  drop function public.email_archive_sender_domain(uuid);
  drop function public.email_create_sender_identity(uuid, text, text, text);
  drop function public.email_update_sender_identity(uuid, jsonb, bigint);
  drop function public.email_archive_sender_identity(uuid);
  drop function public.email_create_template(text, text);
  drop function public.email_archive_template(uuid);
  drop function public.email_create_template_version(uuid, text, text, jsonb, integer);
  drop function public.email_validate_content(text, text, jsonb);

  -- Tables (their policies, triggers, indexes and constraints go with them).
  drop table public.email_template_versions;
  drop table public.email_templates;
  drop table public.email_sender_identities;
  drop table public.email_sender_domains;

  -- Private helpers and trigger functions.
  drop function private.email_template_versions_advance();
  drop function private.email_template_versions_guard();
  drop function private.email_templates_latest_guard();
  drop function private.email_sender_identities_versioning();
  drop function private.email_sender_identities_domain_guard();
  drop function private.email_sender_domains_archive_guard();
  drop function private.email_content_validate(uuid, text, text, jsonb);
  drop function private.email_json_int_between(jsonb, integer, integer);
  drop function private.email_content_text(uuid, text, jsonb, integer, boolean);
  drop function private.email_merge_tag_paths(uuid, text, text);
  drop function private.email_content_invalid(text, text);
  drop function private.email_template_content_hash(text, text, jsonb);
  drop function private.email_url_is_allowed(text, boolean);
  drop function private.email_header_text_is_valid(text, integer);
  drop function private.email_header_text_problem(text, integer);
  drop function private.email_from_name_is_valid(text);
  drop function private.email_text_has_raw_html(text);
  drop function private.email_rendered_header_is_safe(text);
  drop function private.email_text_has_header_unsafe_chars(text);
  drop function private.email_text_has_unsafe_chars(text, boolean);
  drop function private.email_normalize_domain(text);

  -- Increment 2 definition of the audit entity-type check.
  alter table public.email_audit_log
    drop constraint email_audit_log_entity_type_check,
    add constraint email_audit_log_entity_type_check check (entity_type in (
      'contact', 'consent', 'suppression',
      'list', 'tag', 'custom_field', 'segment', 'crm_import'
    ));

  -- Not indented: the function body below is compared byte for byte.
-- Increment 1 source of email_can, byte for byte.
create or replace function private.email_can(requested_action text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    requested_action in (
      'read',
      'manage_contacts',
      'manage_consent',
      'manage_suppressions',
      'lift_suppression'
    )
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

alter function private.email_can(text) owner to postgres;
revoke all on function private.email_can(text) from public, anon, authenticated, service_role;
grant execute on function private.email_can(text) to authenticated;

  -- Forget the migration in the Supabase history (absent outside Supabase).
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    delete from supabase_migrations.schema_migrations where version = '20261004150000';
  end if;

  -- Consume the sequence: it cannot authorize anything else in this transaction.
  perform pg_catalog.set_config('orvesen.email_inc3a_recovery', '', true);
end;
$recovery$;

commit;

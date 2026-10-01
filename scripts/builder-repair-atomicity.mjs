// Emits the SQL for the forward-migration ATOMICITY / PREFLIGHT suite (round-2 finding F2).
//
//   node scripts/builder-repair-atomicity.mjs <outDir>
//
// Produces:
//   atomicity-seed.sql        one repair-compatible draft + one C.8-accepted/repair-invalid draft
//   atomicity-cleanup.sql     removes ONLY the incompatible draft
//   atomicity-fingerprint.sql a single md5 of every builder-relevant function and constraint
//
// The fingerprint is what makes the claim measurable: "the schema was left at the
// pre-migration state" is a comparison of two fingerprints, not an assertion.

import { buildServerValidationFixtures } from "../src/features/builder/document/landingServerValidationFixtures.js";

const outDir = process.argv[2] ?? ".";
const fixtures = buildServerValidationFixtures();

const compatible = fixtures.find((f) => f.id === "05-pattern-one-region").document;

// C.8 accepts a Pattern node style VALUE it never checked; the repair rejects it. This is the
// exact row shape that made the round-2 migration abort halfway through.
//
// The compatible row must be a document C.8 ALSO accepts (a single Pattern, no independent
// Block, no reused id) — otherwise the seed itself cannot be stored at the C.8 state, which is
// the whole precondition of this suite. Fixture 02 is deliberately NOT used: it is the D3 shape
// that C.8 rejects, i.e. it is the migration's INPUT, not its precondition.
const incompatible = JSON.parse(JSON.stringify(compatible));
{
  const pattern = incompatible.sections[0].composition.find((node) => node.pattern);
  pattern.style = { ...(pattern.style ?? {}), align: "middle" };
}

const literal = (value) => `'${JSON.stringify(value).replace(/'/g, "''")}'::jsonb`;
const OWNER = "00000000-0000-4000-8000-0000000a0001";
const ORG_ASSET_OK = "00000000-0000-4000-8000-0000000a0002";
const ORG_ASSET_BAD = "00000000-0000-4000-8000-0000000a0003";

const seed = `\\pset pager off
\\set ON_ERROR_STOP on
-- ===========================================================================
-- Atomicity suite seed: an organization-local author, one repair-COMPATIBLE draft and one
-- draft that C.8 accepts but the repaired validator rejects.
-- ===========================================================================
do $seed$
declare
  v_owner uuid := '${OWNER}';
  v_org uuid;
begin
  insert into auth.users (id, email, raw_user_meta_data)
    values (v_owner, 'repair-atomicity@local', jsonb_build_object('first_name', 'Atomicity'))
    on conflict (id) do nothing;
  select organization_id into v_org from public.users where id = v_owner;
  if v_org is null then raise exception 'atomicity seed: the signup trigger provisioned no organization'; end if;

  insert into public.builder_assets (id, organization_id, asset_type, name, created_by, lifecycle)
    values ('${ORG_ASSET_OK}', v_org, 'landing_page', 'atomicity compatible', v_owner, 'draft')
    on conflict (id) do nothing;
  update public.builder_asset_drafts
     set document = ${literal(compatible)}, schema_version = 2, revision = 2, updated_at = now()
   where asset_id = '${ORG_ASSET_OK}';

  insert into public.builder_assets (id, organization_id, asset_type, name, created_by, lifecycle)
    values ('${ORG_ASSET_BAD}', v_org, 'landing_page', 'atomicity incompatible', v_owner, 'draft')
    on conflict (id) do nothing;
  update public.builder_asset_drafts
     set document = ${literal(incompatible)}, schema_version = 2, revision = 2, updated_at = now()
   where asset_id = '${ORG_ASSET_BAD}';
end
$seed$;

select 'SEED ' ||
       (select count(*) from public.builder_asset_drafts where asset_id = '${ORG_ASSET_OK}')::text || ' ' ||
       (select count(*) from public.builder_asset_drafts where asset_id = '${ORG_ASSET_BAD}')::text as seeded;
`;

const cleanup = `\\pset pager off
\\set ON_ERROR_STOP on
-- Only the DRAFT row is removed: it is the sole thing the preflight inspects, and the
-- published-version immutability trigger (builder_asset_versions_are_immutable) deliberately
-- forbids deleting the asset row that would cascade into builder_asset_versions.
delete from public.builder_asset_drafts where asset_id = '${ORG_ASSET_BAD}';
select 'CLEANUP ' || count(*)::text as remaining_incompatible
from public.builder_asset_drafts where asset_id = '${ORG_ASSET_BAD}';
`;

const fingerprint = `select md5(string_agg(line, '|' order by line)) as fingerprint from (
  select 'private ' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ') ' || md5(pg_get_functiondef(p.oid)) as line
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'private' and p.proname like 'builder%'
  union all
  select 'public ' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ') ' || md5(pg_get_functiondef(p.oid))
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('save_builder_asset_draft','publish_builder_landing','get_published_builder_landing','builder_create_initial_asset_version')
  union all
  select 'drafts-con ' || conname || ' ' || pg_get_constraintdef(oid)
    from pg_constraint where conrelid = 'public.builder_asset_drafts'::regclass
  union all
  select 'versions-con ' || conname || ' ' || pg_get_constraintdef(oid)
    from pg_constraint where conrelid = 'public.builder_asset_versions'::regclass
) x;
`;
// NOTE: the fingerprint covers SCHEMA only (functions + constraints). Row counts are excluded
// on purpose: seeding and cleaning the fixture rows must not move it, or the comparison could
// not distinguish "the schema rolled back" from "the data changed". Data survival is asserted
// separately by an explicit count.

const { mkdirSync, writeFileSync } = await import("node:fs");
const { resolve } = await import("node:path");
mkdirSync(outDir, { recursive: true });
writeFileSync(resolve(outDir, "atomicity-seed.sql"), seed);
writeFileSync(resolve(outDir, "atomicity-cleanup.sql"), cleanup);
writeFileSync(resolve(outDir, "atomicity-fingerprint.sql"), fingerprint);
console.log(`wrote atomicity seed/cleanup/fingerprint into ${resolve(outDir)}`);

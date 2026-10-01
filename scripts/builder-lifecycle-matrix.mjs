// Emits the SQL for the local save -> read-back -> publish -> public-read lifecycle, Form
// asset creation, and the negative database tests.
//
//   node scripts/builder-lifecycle-matrix.mjs <outDir>
//
// Documents come from the same permanent corpus as the verdict matrix, so the lifecycle
// exercises exactly the shapes the Builder produces. Everything runs inside one transaction
// that is rolled back, so no probe data is left behind.

import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildServerValidationFixtures } from "../src/features/builder/document/landingServerValidationFixtures.js";

const outDir = resolve(process.argv[2] ?? ".");
mkdirSync(outDir, { recursive: true });

const fixtures = buildServerValidationFixtures();
const fixture = (id) => {
  const found = fixtures.find((candidate) => candidate.id === id);
  if (!found) throw new Error(`unknown fixture ${id}`);
  return found.document;
};

const literal = (value) => `'${JSON.stringify(value).replace(/'/g, "''")}'::jsonb`;

// SABOTAGE ONLY (mutant S17): emits a lifecycle whose negative-control matcher accepts ANY
// exception. The matcher self-test below must then report RED. Never used in a normal run.
const loosenMatcher = process.argv.includes("--loosen-matcher");

const d3Document = fixture("02-d3-pattern-plus-text");
const legacyDocument = fixture("13-legacy-resolve-landing-drop");
const validForm = fixture("14-valid-form");
const invalidLanding = [
  "15-duplicate-source-ids",
  "16-invalid-pattern-ownership",
  "17-invalid-block-shape",
  "20-malformed-landing",
  "38-v2-design-system-missing",
  "39-v2-seo-title-missing",
  "40-v2-locale-missing",
].map((id) => ({ id, document: fixture(id) }));
const malformedForm = fixture("19-malformed-form");
const mismatch = fixture("18-schema-version-mismatch");

// R4 parity fixtures. `v2NoTitle` is rejected at SAVE by the new native v2 envelope check;
// `v1NoTitle` is the residual schema-v1 case, which the frozen v1 validator still accepts
// (its `jsonb_typeof(...) <> 'string'` is NULL for an absent key), and which the repaired
// publication guard must now refuse to PUBLISH.
const v2NoTitle = JSON.parse(JSON.stringify(d3Document));
delete v2NoTitle.settings.seo.title;
const v1NoTitle = JSON.parse(JSON.stringify(fixture("01-landing-v1-control")));
delete v1NoTitle.settings.seo.title;

const invalidRows = invalidLanding
  .map((entry) => `    ('${entry.id}', ${literal(entry.document)})`)
  .join(",\n");

const sql = `\\pset pager off
\\set ON_ERROR_STOP off

-- ===========================================================================
-- Builder persistence lifecycle + negative database tests.
-- ONE transaction, rolled back at the end, so no probe data is ever left behind.
-- ===========================================================================
begin;

-- ===========================================================================
-- The negative-control matcher (round-2 F9B). A negative test passes ONLY when the failure
-- is the expected one: the SQLSTATE and the violated constraint must both match. Before this,
-- "when others then ... PASS" counted a permission error, a lock timeout or an unrelated
-- constraint as a successful negative control.
-- ===========================================================================
create or replace function pg_temp.control_verdict(
  expected_state text, expected_constraints text, got_state text, got_constraint text)
returns text language sql immutable as $$
  select case
    when ${loosenMatcher
      ? `true -- SABOTAGE S17: accept any exception as a pass`
      : `got_state = expected_state
         and coalesce(got_constraint, '') = any (string_to_array(expected_constraints, ','))`}
    then 'PASS' else 'FAIL' end;
$$;

create temp table lifecycle_result(step text, expectation text, verdict text, detail text);

do $lifecycle$
declare
  v_org uuid := '00000000-0000-4000-8000-000000000901';
  v_owner uuid := '00000000-0000-4000-8000-000000000902';
  v_asset uuid := '00000000-0000-4000-8000-000000000903';
  v_form_asset uuid := '00000000-0000-4000-8000-000000000904';
  v_slug text := 'orvesen-matrix-probe';
  v_doc jsonb := ${literal(d3Document)};
  v_form jsonb := ${literal(validForm)};
  v_mismatch jsonb := ${literal(mismatch)};
  v_malformed_form jsonb := ${literal(malformedForm)};
  v_v2_no_title jsonb := ${literal(v2NoTitle)};
  v_v1_no_title jsonb := ${literal(v1NoTitle)};
  v_state text;
  v_constraint text;
  v_msg text;
  v_saved jsonb;
  v_published jsonb;
  v_revision bigint;
  v_count integer;
  v_text text;
  v_pattern_before text;
  v_pattern_after text;
  v_block_before text;
  v_block_after text;
  v_order_before text;
  v_order_after text;
  bad record;
begin
  -- ---------------------------------------------------------------- identity
  -- Use the real signup path: the on_auth_user_created trigger provisions the
  -- profile, the organization, the founder membership and the active-organization row.
  begin
    insert into auth.users (id, email, raw_user_meta_data)
      values (v_owner, 'matrix-probe@example.com', jsonb_build_object('first_name', 'Matrix'));
    select organization_id into v_org from public.users where id = v_owner;
    -- The RPC reads the caller from auth.uid(), which reads this claim.
    perform set_config('request.jwt.claim.sub', v_owner::text, true);
    insert into lifecycle_result values ('seed', 'identity provisioned through the signup trigger',
      case when v_org is null then 'FAIL' else 'PASS' end, coalesce(v_org::text, 'no organization'));
    insert into lifecycle_result values ('authorization', 'the caller can manage the organization',
      case when public.can_manage_organization(v_org) then 'PASS' else 'FAIL' end,
      'auth.uid resolvable=' || (auth.uid() is not null)::text);
    if v_org is null then return; end if;
  exception when others then
    insert into lifecycle_result values ('seed', 'identity provisioned through the signup trigger', 'FAIL', SQLERRM);
    return;
  end;

  -- ------------------------------------------- Form asset creation (defect 3)
  -- The bootstrap trigger inserts the first draft row, which must satisfy the
  -- document CHECK. Under C.8 this failed for every Form document.
  begin
    insert into public.builder_assets (id, organization_id, asset_type, name, created_by, lifecycle)
      values (v_form_asset, v_org, 'form', 'matrix probe form', v_owner, 'draft');
    select count(*) into v_count from public.builder_asset_drafts where asset_id = v_form_asset;
    insert into lifecycle_result values (
      'form-create',
      'builder_create_initial_asset_version accepts a valid Form',
      case when v_count = 1 then 'PASS' else 'FAIL' end,
      'draft rows=' || v_count::text);
  exception when others then
    insert into lifecycle_result values ('form-create', 'bootstrap trigger accepts a valid Form', 'FAIL', SQLERRM);
  end;

  -- ------------------------------------------------------- landing asset + save
  begin
    insert into public.builder_assets (id, organization_id, asset_type, name, created_by, lifecycle)
      values (v_asset, v_org, 'landing_page', 'matrix probe landing', v_owner, 'draft');
    insert into lifecycle_result values ('landing-create', 'landing asset + draft created', 'PASS', '-');
  exception when others then
    insert into lifecycle_result values ('landing-create', 'landing asset + draft created', 'FAIL', SQLERRM);
    return;
  end;

  perform set_config('request.jwt.claim.sub', v_owner::text, true);

  begin
    select (public.save_builder_asset_draft(v_asset, 1, 2, v_doc)).revision into v_revision;
    insert into lifecycle_result values ('save', 'save_builder_asset_draft accepts the real D3 document',
      case when v_revision = 2 then 'PASS' else 'FAIL' end, 'revision=' || coalesce(v_revision::text, 'null'));
  exception when others then
    insert into lifecycle_result values ('save', 'save_builder_asset_draft accepts the real D3 document', 'FAIL', SQLERRM);
  end;

  -- ------------------------------------------------------------------ read-back
  select document into v_saved from public.builder_asset_drafts where asset_id = v_asset;
  insert into lifecycle_result values ('read-back', 'persisted document is byte-identical to what was sent',
    case when v_saved = v_doc then 'PASS' else 'FAIL' end,
    case when v_saved = v_doc then 'no validation-only transformation persisted' else 'document differs' end);
  insert into lifecycle_result values ('stored-version', 'schema_version column and document agree on 2',
    case when (select schema_version from public.builder_asset_drafts where asset_id = v_asset) = 2
              and v_saved->>'schema_version' = '2' then 'PASS' else 'FAIL' end, '-');

  select count(*) into v_count from public.builder_asset_drafts where asset_id = v_asset;
  insert into lifecycle_result values ('one-draft-row', 'exactly one draft row', case when v_count = 1 then 'PASS' else 'FAIL' end, v_count::text);

  select count(*) into v_count from jsonb_array_elements(v_saved->'sections');
  insert into lifecycle_result values ('section-count', 'exactly one Section persisted (no extra projected Section)',
    case when v_count = 1 then 'PASS' else 'FAIL' end, v_count::text);

  select count(*) into v_count
  from jsonb_array_elements(v_saved->'sections') s
  where s ? 'composition' and jsonb_array_length(coalesce(s->'regions','[]'::jsonb)) = 1;
  insert into lifecycle_result values ('no-projection', 'no synthetic projection Region persisted',
    case when v_count = 0 then 'PASS' else 'FAIL' end, 'projected-shaped sections=' || v_count::text);

  insert into lifecycle_result values ('no-composition-loss', 'a composition area is still a composition area',
    case when jsonb_typeof(v_saved#>'{sections,0,composition}') = 'array' then 'PASS' else 'FAIL' end,
    coalesce(jsonb_typeof(v_saved#>'{sections,0,composition}'), 'missing'));

  -- duplicate ids anywhere in the persisted document
  select count(*) into v_count from (
    select id_value from (
      select s->>'id' as id_value from jsonb_array_elements(v_saved->'sections') s
      union all
      select n->>'id' from jsonb_array_elements(v_saved->'sections') s,
             jsonb_array_elements(coalesce(s->'composition','[]'::jsonb)) n
      union all
      select r->>'id' from jsonb_array_elements(v_saved->'sections') s,
             jsonb_array_elements(coalesce(s->'composition','[]'::jsonb)) n,
             jsonb_array_elements(coalesce(n->'regions','[]'::jsonb)) r
      union all
      select b->>'id' from jsonb_array_elements(v_saved->'sections') s,
             jsonb_array_elements(coalesce(s->'composition','[]'::jsonb)) n,
             jsonb_array_elements(coalesce(n->'regions','[]'::jsonb)) r,
             jsonb_array_elements(coalesce(r->'blocks','[]'::jsonb)) b
    ) ids
    where id_value is not null
    group by id_value having count(*) > 1
  ) dupes;
  insert into lifecycle_result values ('no-duplicate-ids', 'no duplicate ids persisted',
    case when v_count = 0 then 'PASS' else 'FAIL' end, 'duplicates=' || v_count::text);

  -- Pattern identity + its Regions survive
  select (select n->>'pattern' from jsonb_array_elements(v_doc->'sections'->0->'composition') n where n ? 'pattern' limit 1) into v_pattern_before;
  select (select n->>'pattern' from jsonb_array_elements(v_saved->'sections'->0->'composition') n where n ? 'pattern' limit 1) into v_pattern_after;
  insert into lifecycle_result values ('pattern-identity', 'Pattern identity preserved',
    case when v_pattern_before is not null and v_pattern_before = v_pattern_after then 'PASS' else 'FAIL' end,
    coalesce(v_pattern_before, 'none') || ' -> ' || coalesce(v_pattern_after, 'none'));

  select (select jsonb_agg(jsonb_build_object('id', r->>'id', 'span', r->'span') order by r_ord)
          from jsonb_array_elements(n->'regions') with ordinality as regions(r, r_ord))::text into v_text
  from jsonb_array_elements(v_doc->'sections'->0->'composition') n where n ? 'pattern' limit 1;
  select (select jsonb_agg(jsonb_build_object('id', r->>'id', 'span', r->'span') order by r_ord)
          from jsonb_array_elements(n->'regions') with ordinality as regions(r, r_ord))::text into v_block_before
  from jsonb_array_elements(v_saved->'sections'->0->'composition') n where n ? 'pattern' limit 1;
  insert into lifecycle_result values ('pattern-regions', 'Pattern Regions (ids and spans) preserved',
    case when v_text is not null and v_text = v_block_before then 'PASS' else 'FAIL' end,
    coalesce(v_text, 'none') || ' -> ' || coalesce(v_block_before, 'none'));

  -- independent Block identity + it is still a DIRECT composition child
  select (select n->>'id' from jsonb_array_elements(v_doc->'sections'->0->'composition') n
          where not (n ? 'regions') and n ? 'type' limit 1) into v_order_before;
  select (select n->>'id' from jsonb_array_elements(v_saved->'sections'->0->'composition') n
          where not (n ? 'regions') and n ? 'type' limit 1) into v_order_after;
  insert into lifecycle_result values ('independent-block', 'independent Block id preserved as a direct composition child',
    case when v_order_before is not null and v_order_before = v_order_after then 'PASS' else 'FAIL' end,
    coalesce(v_order_before, 'none') || ' -> ' || coalesce(v_order_after, 'none'));

  insert into lifecycle_result values ('no-nested-block', 'the independent Block is not nested inside the Pattern',
    case when exists (
      select 1 from jsonb_array_elements(v_saved->'sections'->0->'composition') n
      where n ? 'pattern'
        and exists (
          select 1 from jsonb_array_elements(coalesce(n->'regions','[]'::jsonb)) r,
                        jsonb_array_elements(coalesce(r->'blocks','[]'::jsonb)) b
          where b->>'id' = v_order_before
        )
    ) then 'FAIL' else 'PASS' end, coalesce(v_order_before, 'none'));

  -- composition order preserved
  select (select jsonb_agg(n->>'id' order by ord) from jsonb_array_elements(v_doc->'sections'->0->'composition') with ordinality as nodes(n, ord))::text
    into v_order_before;
  select (select jsonb_agg(n->>'id' order by ord) from jsonb_array_elements(v_saved->'sections'->0->'composition') with ordinality as nodes(n, ord))::text
    into v_order_after;
  insert into lifecycle_result values ('composition-order', 'composition order preserved',
    case when v_order_before = v_order_after then 'PASS' else 'FAIL' end,
    coalesce(v_order_before, '-') || ' -> ' || coalesce(v_order_after, '-'));

  -- --------------------------------------------------------------- publish + read
  begin
    select (public.publish_builder_landing(v_asset, 2, v_slug)).draft_revision into v_revision;
    insert into lifecycle_result values ('publish', 'publish_builder_landing accepts the stored draft',
      case when v_revision = 2 then 'PASS' else 'FAIL' end, 'draft_revision=' || coalesce(v_revision::text, 'null'));
  exception when others then
    insert into lifecycle_result values ('publish', 'publish_builder_landing accepts the stored draft', 'FAIL', SQLERRM);
  end;

  begin
    select document into v_published from public.get_published_builder_landing(v_slug);
    insert into lifecycle_result values ('public-read', 'get_published_builder_landing returns the document',
      case when v_published is not null then 'PASS' else 'FAIL' end,
      case when v_published is null then 'no row' else 'row returned' end);
    insert into lifecycle_result values ('public-read-identical', 'published document is identical to the saved draft',
      case when v_published = v_doc then 'PASS' else 'FAIL' end, '-');
    insert into lifecycle_result values ('published-version', 'published snapshot declares schema_version 2',
      case when v_published->>'schema_version' = '2' then 'PASS' else 'FAIL' end,
      coalesce(v_published->>'schema_version', 'null'));
  exception when others then
    insert into lifecycle_result values ('public-read', 'get_published_builder_landing returns the document', 'FAIL', SQLERRM);
  end;

  -- ------------------------------------------------- negative database tests
  -- Each negative control asserts the EXPECTED SQLSTATE and the EXPECTED violated constraint.
  for bad in
    select * from (values
${invalidRows}
    ) as invalid(id, doc)
  loop
    begin
      update public.builder_asset_drafts set document = bad.doc where asset_id = v_asset;
      insert into lifecycle_result values ('reject-' || bad.id,
        'expected SQLSTATE 23514 on builder_asset_drafts_document_check', 'FAIL', 'accepted');
    exception when others then
      get stacked diagnostics v_state = returned_sqlstate, v_constraint = constraint_name, v_msg = message_text;
      insert into lifecycle_result values ('reject-' || bad.id,
        'expected SQLSTATE 23514 on builder_asset_drafts_document_check',
        pg_temp.control_verdict('23514', 'builder_asset_drafts_document_check', v_state, v_constraint),
        v_state || ' ' || coalesce(v_constraint, '-') || ' :: ' || left(coalesce(v_msg, ''), 70));
    end;
  end loop;

  -- malformed Form, and a landing document whose version disagrees with the column
  begin
    update public.builder_asset_drafts set document = v_malformed_form where asset_id = v_form_asset;
    insert into lifecycle_result values ('reject-malformed-form',
      'expected SQLSTATE 23514 on builder_asset_drafts_document_check', 'FAIL', 'accepted');
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_constraint = constraint_name, v_msg = message_text;
    insert into lifecycle_result values ('reject-malformed-form',
      'expected SQLSTATE 23514 on builder_asset_drafts_document_check',
      pg_temp.control_verdict('23514', 'builder_asset_drafts_document_check', v_state, v_constraint),
      v_state || ' ' || coalesce(v_constraint, '-') || ' :: ' || left(coalesce(v_msg, ''), 70));
  end;

  begin
    update public.builder_asset_drafts set document = v_mismatch, schema_version = 2 where asset_id = v_asset;
    insert into lifecycle_result values ('reject-version-agreement',
      'expected SQLSTATE 23514 on the version-agreement CHECK', 'FAIL', 'accepted');
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_constraint = constraint_name, v_msg = message_text;
    insert into lifecycle_result values ('reject-version-agreement',
      'expected SQLSTATE 23514 on the version-agreement CHECK',
      pg_temp.control_verdict('23514',
        'builder_asset_drafts_document_version_check,builder_asset_drafts_check', v_state, v_constraint),
      v_state || ' ' || coalesce(v_constraint, '-') || ' :: ' || left(coalesce(v_msg, ''), 70));
  end;

  -- an unsupported document type must fail closed
  begin
    update public.builder_asset_drafts
       set document = jsonb_set(v_doc, '{document_type}', '"not_a_document_type"'),
           schema_version = 2
     where asset_id = v_asset;
    insert into lifecycle_result values ('reject-unknown-type',
      'expected SQLSTATE 23514 on builder_asset_drafts_document_check', 'FAIL', 'accepted');
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_constraint = constraint_name, v_msg = message_text;
    insert into lifecycle_result values ('reject-unknown-type',
      'expected SQLSTATE 23514 on builder_asset_drafts_document_check',
      pg_temp.control_verdict('23514', 'builder_asset_drafts_document_check', v_state, v_constraint),
      v_state || ' ' || coalesce(v_constraint, '-') || ' :: ' || left(coalesce(v_msg, ''), 70));
  end;

  -- ------------------------------------------------------------------ R4 parity
  -- A published landing document must NEVER be unreadable. Two shapes are checked:
  --   * v2 missing settings.seo.title -> refused at SAVE by the native v2 envelope (R3);
  --   * v1 missing settings.seo.title -> the frozen v1 validator still accepts it, so the
  --     repaired PUBLICATION guard is the thing that must refuse it (R4). Before the repair
  --     this published successfully and then returned NO ROW from the public read.
  begin
    update public.builder_asset_drafts
       set document = v_v2_no_title, schema_version = 2, revision = 2, updated_at = now()
     where asset_id = v_asset;
    insert into lifecycle_result values ('parity-v2-no-title-save',
      'a v2 draft with no seo.title is refused at SAVE', 'FAIL', 'accepted');
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_constraint = constraint_name;
    insert into lifecycle_result values ('parity-v2-no-title-save',
      'a v2 draft with no seo.title is refused at SAVE',
      pg_temp.control_verdict('23514', 'builder_asset_drafts_document_check', v_state, v_constraint),
      v_state || ' ' || coalesce(v_constraint, '-'));
  end;

  begin
    insert into public.builder_assets (id, organization_id, asset_type, name, created_by, lifecycle)
      values ('00000000-0000-4000-8000-000000000906', v_org, 'landing_page', 'matrix probe v1 no title', v_owner, 'draft');
    perform public.save_builder_asset_draft('00000000-0000-4000-8000-000000000906', 1, 1, v_v1_no_title);
    insert into lifecycle_result values ('parity-v1-no-title-save',
      'the frozen v1 chain still accepts it (pre-existing v1 NULL hole, out of scope)',
      case when exists (select 1 from public.builder_asset_drafts
                        where asset_id = '00000000-0000-4000-8000-000000000906'
                          and revision = 2) then 'PASS' else 'FAIL' end,
      'revision=' || coalesce((select revision::text from public.builder_asset_drafts
                               where asset_id = '00000000-0000-4000-8000-000000000906'), 'null'));
  exception when others then
    insert into lifecycle_result values ('parity-v1-no-title-save',
      'the frozen v1 chain still accepts it (pre-existing v1 NULL hole, out of scope)', 'FAIL', SQLERRM);
  end;

  begin
    perform public.publish_builder_landing('00000000-0000-4000-8000-000000000906', 2, 'orvesen-matrix-probe-v1');
    insert into lifecycle_result values ('parity-v1-no-title-publish',
      'a v1 draft with no seo.title must NOT publish', 'FAIL', 'published');
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text;
    insert into lifecycle_result values ('parity-v1-no-title-publish',
      'a v1 draft with no seo.title must NOT publish',
      case when v_state = '22023' and v_msg like '%BUILDER_DOCUMENT_INVALID%' then 'PASS' else 'FAIL' end,
      v_state || ' ' || left(coalesce(v_msg, ''), 60));
  end;

  -- The published state and the public read must agree. v_asset was published earlier in this
  -- block; assert that every asset carrying a published_version_id is readable by slug.
  select count(*) into v_count
  from public.builder_assets asset
  where asset.published_version_id is not null
    and asset.public_slug is not null
    and not exists (select 1 from public.get_published_builder_landing(asset.public_slug));
  insert into lifecycle_result values ('parity-published-implies-readable',
    'no asset is published without being readable by public slug',
    case when v_count = 0 then 'PASS' else 'FAIL' end, 'unreadable published assets=' || v_count::text);

  -- ------------------------------------------------------------------ matcher self test
  -- The matcher must DISCRIMINATE. A deliberately wrong expectation about the very same
  -- failure must be reported FAIL; if it is not, the negative controls above prove nothing.
  insert into lifecycle_result values ('matcher-selftest',
    'a wrong SQLSTATE expectation must be reported FAIL',
    case when pg_temp.control_verdict('42501', 'some_other_constraint', '23514',
             'builder_asset_drafts_document_check') = 'FAIL' then 'PASS' else 'FAIL' end,
    'expected FAIL for a mismatched expectation');
  insert into lifecycle_result values ('matcher-selftest-match',
    'the matching expectation must be reported PASS',
    pg_temp.control_verdict('23514', 'builder_asset_drafts_document_check', '23514',
      'builder_asset_drafts_document_check'), 'expected PASS for a matching expectation');

  -- the legacy pre-D3 document must also save (same defect class, older producer)
  begin
    insert into public.builder_assets (id, organization_id, asset_type, name, created_by, lifecycle)
      values ('00000000-0000-4000-8000-000000000905', v_org, 'landing_page', 'matrix probe legacy', v_owner, 'draft');
    perform public.save_builder_asset_draft('00000000-0000-4000-8000-000000000905', 1, 2, ${literal(legacyDocument)});
    insert into lifecycle_result values ('save-legacy', 'pre-D3 legacy schema-v2 document also saves', 'PASS', '-');
  exception when others then
    insert into lifecycle_result values ('save-legacy', 'pre-D3 legacy schema-v2 document also saves', 'FAIL', SQLERRM);
  end;

  raise notice 'lifecycle complete';
end
$lifecycle$;

select step, expectation, verdict, detail from lifecycle_result order by step;

\\echo ''
select 'LIFECYCLE ' || count(*) filter (where verdict = 'PASS') || ' ' || count(*) filter (where verdict = 'FAIL')
    || ' ' || count(*) filter (where verdict is null) || ' ' || count(*) as summary
from lifecycle_result;

-- Nothing the probe created may persist.
rollback;
`;

writeFileSync(resolve(outDir, "matrix-lifecycle.sql"), sql);
console.log(`wrote ${resolve(outDir, "matrix-lifecycle.sql")}`);

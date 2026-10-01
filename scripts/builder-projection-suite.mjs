// Emits the SQL half of the PROJECTION / SYNTHETIC-ID suite (round-2 findings F1, R1).
//
//   node scripts/builder-projection-suite.mjs <outDir>
//
// Produces `matrix-projection.sql`:
//   * termination + NULL-safety of the salted collision search (kills the S11 mutant);
//   * the hard fail-closed bound on that search (kills the S12 mutant);
//   * the salt step and the salt increment, asserted against the REAL helper function;
//   * determinism (I5), no source/synthetic collision (I6), and block coverage/order (I1)
//     for the dedicated-surface documents the validator delegates.
//
// Every assertion is measured through the deployed functions, not by pattern-matching the
// migration text.

import { buildServerValidationFixtures } from "../src/features/builder/document/landingServerValidationFixtures.js";

const outDir = process.argv[2] ?? ".";
const fixtures = buildServerValidationFixtures();
const literal = (value) => `'${JSON.stringify(value).replace(/'/g, "''")}'::jsonb`;

const rows = fixtures
  .map((f) => `  ('${f.id}', ${literal(f.document)}, ${f.expect.server}, '${f.clientValidator}')`)
  .join(",\n");

const NULL_ID_FIXTURES = [
  "25-dedicated-header-missing-region-id",
  "26-dedicated-footer-missing-region-id",
  "27-dedicated-footer-missing-block-id",
  "28-dedicated-footer-null-region-id",
].map((id) => `'${id}'`).join(",");

const sql = `\\pset pager off
\\set ON_ERROR_STOP off

-- ===========================================================================
-- Builder landing v2 projection â€” synthetic-identity suite (round-2 F1 / R1).
-- Each row is one measured assertion about the DEPLOYED functions.
-- ===========================================================================
create temp table fixture(id text, doc jsonb, expect_server boolean, validator text);
insert into fixture(id, doc, expect_server, validator) values
${rows};

create temp table proj(name text, verdict text, detail text);

-- ---------------------------------------------------------------------------
-- A. TERMINATION. A dedicated Header/Footer Section with an absent or JSON-null id used to
--    append SQL NULL to the collision set; \`x = ANY(array_with_NULL)\` is NULL, so
--    \`EXIT WHEN NOT (...)\` never fired. The projection must now COMPLETE for these
--    documents. With the R1 bound in place a regression cannot hang this suite: it raises
--    and is reported as FAIL with the reason.
-- ---------------------------------------------------------------------------
do $termination$
declare f record; projected jsonb;
begin
  for f in select id, doc from fixture where id in (${NULL_ID_FIXTURES}) order by id loop
    begin
      projected := private.builder_landing_document_v2_projection(f.doc);
      insert into proj values ('A termination: projection completes for ' || f.id,
        case when projected is not null then 'PASS' else 'FAIL' end,
        'sections=' || coalesce(jsonb_array_length(projected->'sections'), -1)::text);
    exception when others then
      insert into proj values ('A termination: projection completes for ' || f.id, 'FAIL', 'raised: ' || sqlerrm);
    end;
  end loop;
end
$termination$;

-- The same documents must FAIL CLOSED at the document validator (never accepted, never hung).
do $closed$
declare f record; verdict boolean;
begin
  for f in select id, doc from fixture where id in (${NULL_ID_FIXTURES}) order by id loop
    begin
      verdict := private.builder_landing_document_is_valid(f.doc);
      insert into proj values ('A fail-closed: validator rejects ' || f.id,
        case when verdict is false then 'PASS' else 'FAIL' end, 'verdict=' || coalesce(verdict::text,'null'));
    exception when others then
      insert into proj values ('A fail-closed: validator rejects ' || f.id, 'FAIL', 'raised: ' || sqlerrm);
    end;
  end loop;
end
$closed$;

-- A dedicated Section that is otherwise valid must still be ACCEPTED (no over-rejection).
do $accepted$
declare verdict boolean;
begin
  begin
    select private.builder_landing_document_is_valid(doc) into verdict
    from fixture where id = '21-dedicated-footer';
    insert into proj values ('A no over-rejection: valid dedicated Footer still accepted',
      case when verdict is true then 'PASS' else 'FAIL' end, 'verdict=' || coalesce(verdict::text,'null'));
  exception when others then
    insert into proj values ('A no over-rejection: valid dedicated Footer still accepted', 'FAIL', 'raised: ' || sqlerrm);
  end;
end
$accepted$;

-- ---------------------------------------------------------------------------
-- B. HARD BOUND. A document that plants 200 predictions of the digest must terminate and
--    fail closed, not spin and not silently find an unbounded salt. Without the bound the
--    search returns a projection (S12), so "raised" is the PASS condition here.
-- ---------------------------------------------------------------------------
do $bound$
declare
  area_id text := '00000000-0000-4000-8000-0000000b0001';
  hostile jsonb;
  projected jsonb;
begin
  select jsonb_build_object(
    'schema_version','2','document_type','landing_page','locale','es',
    'settings', jsonb_build_object(
      'seo', jsonb_build_object('title','t','description','d'),
      'design_system', jsonb_build_object('colors','{}'::jsonb,'typography','{}'::jsonb,
        'buttons','{}'::jsonb,'radii','{}'::jsonb,'spacing','{}'::jsonb,'content_widths','{}'::jsonb)),
    'sections', jsonb_build_array(jsonb_build_object(
      'id', area_id, 'layout','stack','regions','[]'::jsonb,
      'composition', (
        select jsonb_agg(jsonb_build_object(
                 'id', private.builder_landing_projection_region_id(area_id, s),
                 'type','text','schema_version',1,
                 'content', jsonb_build_object('text','candidate-' || s::text)))
        from generate_series(0, 199) s))))
  into hostile;
  begin
    projected := private.builder_landing_document_v2_projection(hostile);
    insert into proj values ('B bound: 200 planted candidates fail closed',
      'FAIL', 'returned a projection instead of raising');
  exception when others then
    insert into proj values ('B bound: 200 planted candidates fail closed',
      case when sqlerrm like '%SEARCH_EXHAUSTED%' then 'PASS' else 'FAIL' end, sqlerrm);
  end;
end
$bound$;

-- ---------------------------------------------------------------------------
-- C. SALT STEP + INCREMENT, asserted against the real helper (no re-implementation).
-- ---------------------------------------------------------------------------
do $salt$
declare
  doc jsonb; area_id text; chosen text; expected text;
begin
  select f.doc into doc from fixture f where f.id = '29-projection-id-collision-at-salt-0';
  area_id := doc#>>'{sections,0,id}';
  expected := private.builder_landing_projection_region_id(area_id, 1);
  chosen := private.builder_landing_document_v2_projection(doc)#>>'{sections,0,regions,0,id}';
  insert into proj values ('C salt step: salt-0 collision takes salt 1',
    case when chosen = expected then 'PASS' else 'FAIL' end,
    'chosen=' || coalesce(chosen,'null') || ' expected=' || expected);

  select f.doc into doc from fixture f where f.id = '30-projection-id-collision-needs-salt-increment';
  area_id := doc#>>'{sections,0,id}';
  expected := private.builder_landing_projection_region_id(area_id, 2);
  chosen := private.builder_landing_document_v2_projection(doc)#>>'{sections,0,regions,0,id}';
  insert into proj values ('C salt increment: salt-0+1 collisions take salt 2',
    case when chosen = expected then 'PASS' else 'FAIL' end,
    'chosen=' || coalesce(chosen,'null') || ' expected=' || expected);

  -- The chosen id must never be any id present in the source document (I6).
  select f.doc into doc from fixture f where f.id = '30-projection-id-collision-needs-salt-increment';
  chosen := private.builder_landing_document_v2_projection(doc)#>>'{sections,0,regions,0,id}';
  insert into proj values ('C I6: the chosen id is absent from the source id set',
    case when not exists (
      select 1 from jsonb_array_elements(doc->'sections') s
      cross join lateral jsonb_array_elements(coalesce(s->'composition','[]'::jsonb)) n
      where n->>'id' = chosen
    ) then 'PASS' else 'FAIL' end, 'chosen=' || coalesce(chosen,'null'));
end
$salt$;

-- ---------------------------------------------------------------------------
-- D. I5 DETERMINISM on every landing fixture.
-- ---------------------------------------------------------------------------
insert into proj
select 'D I5 determinism',
       case when bool_and(same) then 'PASS' else 'FAIL' end,
       count(*) filter (where not same)::text || ' of ' || count(*)::text || ' fixtures differ'
from (
  select private.builder_landing_document_v2_projection(f.doc)
       = private.builder_landing_document_v2_projection(f.doc) as same
  from fixture f where f.validator = 'landing'
) x;

-- ---------------------------------------------------------------------------
-- E. I6 no synthesized id equals a source id, for every VALID landing fixture.
--    A delegated dedicated Section is excluded: its ids are the source ids on purpose.
-- ---------------------------------------------------------------------------
insert into proj
select 'E I6 no synthesized id collides',
       case when bool_and(coalesce(ok, false)) then 'PASS' else 'FAIL' end,
       count(*) filter (where not ok)::text || ' of ' || count(*)::text || ' fixtures collide'
from (
  select not exists (
    select 1
    from jsonb_array_elements(private.builder_landing_document_v2_projection(f.doc)->'sections') p(ps)
    join jsonb_array_elements(f.doc->'sections') src(ss) on ss->>'id' = ps->>'id'
    where not (
        jsonb_array_length(coalesce(ss->'regions','[]'::jsonb)) = 1
        and jsonb_array_length(coalesce(ss#>'{regions,0,blocks}','[]'::jsonb)) = 1
        and (ss#>>'{regions,0,blocks,0,type}') in ('site_header','site_footer'))
      and ps#>'{regions,0,id}' is not null
      and exists (
        select 1 from jsonb_array_elements(f.doc->'sections') s2
        cross join lateral jsonb_array_elements(coalesce(s2->'composition','[]'::jsonb)) n
        where n->>'id' = ps#>>'{regions,0,id}')
  ) as ok
  from fixture f where f.validator = 'landing' and f.expect_server
) x;

-- ---------------------------------------------------------------------------
-- F. The dedicated Section must be delegated VERBATIM (its ids are the source ids by design),
--    and there is still exactly one projected Section per source area â€” so the R1 fix cannot
--    have quietly changed the delegation contract.
-- ---------------------------------------------------------------------------
insert into proj
select 'F delegation: the dedicated Section is projected verbatim',
       case when bool_and(verbatim) then 'PASS' else 'FAIL' end,
       count(*) filter (where not verbatim)::text || ' of ' || count(*)::text || ' mismatch'
from (
  select (private.builder_landing_document_v2_projection(f.doc)->'sections'->1)
       = (f.doc->'sections'->1) as verbatim
  from fixture f where f.id in (${NULL_ID_FIXTURES})
) x;

insert into proj
select 'F one projected Section per source area',
       case when bool_and(coalesce(ok, false)) then 'PASS' else 'FAIL' end,
       count(*) filter (where not ok)::text || ' of ' || count(*)::text || ' mismatch'
from (
  select jsonb_array_length(private.builder_landing_document_v2_projection(f.doc)->'sections')
       = jsonb_array_length(f.doc->'sections') as ok
  from fixture f where f.id in (${NULL_ID_FIXTURES})
) x;

-- ---------------------------------------------------------------------------
-- G. ROUND-3 M1.5: every authoritative gate verdict must be a real boolean. A gate that
--    returns SQL NULL is accepted by every "if not <verdict> then raise" guard in this chain
--    (NOT NULL is NULL) and by a CHECK constraint (NULL passes), so a NULL verdict is a
--    NULL-as-success hazard, not an absence of information.
-- ---------------------------------------------------------------------------
insert into proj
select 'G gates are total (no SQL NULL verdict)',
       case when count(*) filter (where landing is null or chk is null) = 0 then 'PASS' else 'FAIL' end,
       count(*) filter (where landing is null or chk is null)::text || ' of ' || count(*)::text || ' rows indeterminate'
from (
  select private.builder_landing_document_is_valid(f.doc) as landing,
         private.builder_document_is_valid(f.doc) as chk
  from fixture f
) x;

select name, verdict, detail from proj order by name;

\\echo ''
select 'PROJECTION '
    || count(*) filter (where verdict = 'PASS') || ' '
    || count(*) filter (where verdict = 'FAIL') || ' '
    || count(*) filter (where verdict is null) || ' '
    || count(*) as summary
from proj;
`;

const { mkdirSync, writeFileSync } = await import("node:fs");
const { resolve } = await import("node:path");
mkdirSync(outDir, { recursive: true });
writeFileSync(resolve(outDir, "matrix-projection.sql"), sql);
console.log(`wrote ${resolve(outDir, "matrix-projection.sql")} (${fixtures.length} fixtures)`);




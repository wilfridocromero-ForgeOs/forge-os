// Emits the SQL half of the permanent server-validation matrix.
//
// The corpus itself lives in `src/features/builder/document/landingServerValidationFixtures.js`
// so the client half and the server half can never drift apart. This script only serialises
// it; it runs no database and makes no judgement.
//
//   node scripts/builder-forward-migration-matrix.mjs <outDir>
//
// Produces:
//   matrix-verdicts.sql    â€“ always runnable; server verdict per fixture vs expectation
//   matrix-invariants.sql  â€“ requires the forward migration (the named projection function)
//
// Run it through `scripts/builder-forward-migration-matrix.ps1`.

import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildServerValidationFixtures } from "../src/features/builder/document/landingServerValidationFixtures.js";

const outDir = resolve(process.argv[2] ?? ".");
mkdirSync(outDir, { recursive: true });

const fixtures = buildServerValidationFixtures();
const literal = (value) => `'${JSON.stringify(value).replace(/'/g, "''")}'::jsonb`;

const rows = fixtures
  .map(
    (fixture) =>
      `  ('${fixture.id}', ${literal(fixture.document)}, ${fixture.expect.server}, '${fixture.clientValidator}')`,
  )
  .join(",\n");

const verdicts = `\\pset pager off
\\set ON_ERROR_STOP off

-- ===========================================================================
-- Builder landing persistence â€” server verdict matrix.
-- Each row: what the server says about a fixture, against what the corpus claims.
--   landing_gate  = private.builder_landing_document_is_valid  (what save + publish call)
--   check_gate    = private.builder_document_is_valid          (what the drafts CHECK calls)
--
-- ROUND-3 M1: a verdict is TRI-STATE. The corpus is accounted for in exactly three
-- categories â€” ok IS TRUE (pass), ok IS FALSE (fail), ok IS NULL (indeterminate) â€” and the
-- summary carries all three plus the observed total, so no row can quietly leave the
-- denominator. An indeterminate verdict is NEVER a pass: NOT NULL is NULL in every
-- production guard in this chain, so an indeterminate verdict is a NULL-as-success hazard.
-- ===========================================================================
\\echo EXPECTED_FIXTURES ${fixtures.length}
create temp table fixture(id text, doc jsonb, expect_server boolean, validator text);
insert into fixture(id, doc, expect_server, validator) values
${rows};

-- The live drafts CHECK is the dispatcher when the forward migration is present, and the
-- C.8 dispatcher-only predicate before it. Mirrored here so the SAME file is meaningful
-- before and after the repair: that is what makes the RED baseline honest.
do $bridge$
begin
  if to_regprocedure('private.builder_document_is_valid(jsonb)') is null then
    execute $def$
      create or replace function pg_temp.check_gate(candidate jsonb) returns boolean
      language sql immutable as 'select private.builder_landing_document_is_valid(candidate)'
    $def$;
  else
    execute $def$
      create or replace function pg_temp.check_gate(candidate jsonb) returns boolean
      language sql immutable as 'select private.builder_document_is_valid(candidate)'
    $def$;
  end if;
end
$bridge$;

with evaluated as (
  select f.id,
         f.validator,
         f.expect_server,
         private.builder_landing_document_is_valid(f.doc) as landing_gate,
         pg_temp.check_gate(f.doc)                         as check_gate
  from fixture f
)
select e.id, e.validator, e.expect_server, e.landing_gate, e.check_gate,
       -- NULL-aware: if either gate is indeterminate the verdict itself is indeterminate,
       -- never a pass and never silently dropped.
       case
         when e.landing_gate is null or e.check_gate is null then null
         when e.validator = 'form'
           -- A Form is never routed through the landing validator, and the CHECK
           -- dispatcher is what decides it.
           then (e.check_gate = e.expect_server and e.landing_gate = false)
         else (e.landing_gate = e.expect_server and e.check_gate = e.expect_server)
       end as ok
into temp table judged
from evaluated e;

select id,
       expect_server as expected,
       landing_gate,
       check_gate,
       case when ok is null then 'INDETERMINATE' when ok then 'PASS' else 'FAIL' end as verdict,
       case when landing_gate is null then 'landing_gate returned SQL NULL' else '' end
         || case when check_gate is null then ' check_gate returned SQL NULL' else '' end as null_detail
from judged
order by id;

\\echo ''
select 'SUMMARY '
    || count(*) filter (where ok is true) || ' '
    || count(*) filter (where ok is false) || ' '
    || count(*) filter (where ok is null) || ' '
    || count(*) as summary
from judged;
`;

// Self-test (ROUND-3 M1 item 7, M1.6): the summary expression above must never turn a corpus
// that contains a NON-TRUE verdict into an all-pass summary, and a fully-true corpus must only
// be GREEN when its size equals the EXPECTED corpus size. This is asserted on synthetic tables,
// so it holds even when the real corpus has no NULL and no failure.
//
// The adjudicator below is generated from ONE template so the self-test cannot drift away from
// the real acceptance rule: GREEN requires
//     fail_count = 0 AND null_count = 0 AND observed_count = expected_corpus_size
// and the synthetic fixtures exercise exactly the ways that can be violated. Each case declares
// the outcome its corpus REQUIRES, and the case PASSes only when the adjudicator's `green` flag
// equals it - so a self-test can never pass by asserting the wrong direction:
//     GREEN   a corpus that must be accepted
//     RED     a corpus that must be refused (fail_count > 0, null_count > 0, or a size that
//             does not equal the expected corpus size)
//     an EMPTY corpus must be RED rather than vacuously clean, so the row-count assertion lives
//     inside the same aggregate as the requirement
const verdictTemplate = (tag, requirement, trues, falses, nulls, expected) => `create temp table selftest_corpus(ok boolean);
insert into selftest_corpus
select true from generate_series(1, ${trues})
union all select false from generate_series(1, ${falses})
union all select null from generate_series(1, ${nulls});
with summary as (
  select count(*) filter (where ok is true) as pass_count,
         count(*) filter (where ok is false) as fail_count,
         count(*) filter (where ok is null) as null_count,
         count(*) as observed_count
  from selftest_corpus
),
adjudicated as (
  select pass_count, fail_count, null_count, observed_count,
         (fail_count = 0
          and null_count = 0
          and observed_count = ${expected}
          and observed_count = pass_count + fail_count + null_count) as green
  from summary
)
select '${tag} ' || case when (
         case '${requirement}'
           -- The row count is asserted INSIDE the same aggregate as the requirement, never as a
           -- separate "count(*) = 1 and ..." clause; that form is vacuously true for an EMPTY
           -- set, which is how an empty corpus could have been reported as clean.
           when 'GREEN' then (count(*) = 1) and bool_and(green)
           else (count(*) = 1) and bool_and(not green)
         end) then 'PASS' else 'FAIL' end
from adjudicated;
drop table selftest_corpus;
`;

const verdictSelfTest = `
-- M1.6 self-test C1: 38 TRUE + 1 NULL must be RED. NULL is not a verdict: it must keep the
-- corpus out of the denominator's "accepted" bucket and out of GREEN.
${verdictTemplate("SELFTEST_NULL_SUMMARY", "RED", 38, 0, 1, 38)}
-- M1.6 self-test C1b: what the OLD NULL-blind expression would have produced for C1, computed
-- here so the discrimination is visible rather than asserted in prose. It reads '38 0' - i.e.
-- "38 passed, 0 failed" - which is exactly the false GREEN round 3 measured.
create temp table selftest_nullblind(ok boolean);
insert into selftest_nullblind select true from generate_series(1, 38)
union all select null;
select 'SELFTEST_NULLBLIND_SUMMARY ' ||
       case when (count(*) filter (where ok) || ' ' || count(*) filter (where not ok)) = '38 0'
            then 'PASS' else 'FAIL' end
from selftest_nullblind;
drop table selftest_nullblind;
-- M1.6 self-test C2: 38 TRUE + 1 FALSE must be RED.
${verdictTemplate("SELFTEST_FALSE_SUMMARY", "RED", 38, 1, 0, 38)}
-- M1.6 self-test C3: 39 TRUE at expected corpus size 39 is GREEN.
${verdictTemplate("SELFTEST_TRUE39_GREEN", "GREEN", 39, 0, 0, 39)}
-- M1.6 self-test C3N: 39 TRUE at expected corpus size 38 is RED - corpus conservation refuses a
-- run that observed MORE rows than the fixture source declares.
${verdictTemplate("SELFTEST_TRUE39_CONSERVATION", "RED", 39, 0, 0, 38)}
-- M1.6 self-test C4: an EMPTY corpus must be RED, not vacuously clean. Conservation collapses to
-- 0 = 0 and a NULL-blind "no failures" reading turns 0 rows into a pass, so a run that executed
-- no fixture at all has to fail closed.
${verdictTemplate("SELFTEST_EMPTY_CORPUS_RED", "RED", 0, 0, 0, 38)}
`;

// ---------------------------------------------------------------------------
// Invariants. These need the named projection, so they only run after the forward
// migration. They are the mechanical form of the projection contract I1-I7.
// ---------------------------------------------------------------------------
const invariants = `\\pset pager off
\\set ON_ERROR_STOP off

create temp table fixture(id text, doc jsonb, expect_server boolean, validator text);
insert into fixture(id, doc, expect_server, validator) values
${rows};

-- A dedicated Header/Footer Section is delegated WHOLESALE by the projection, so its Region
-- and Block ids are the source ids by design rather than synthesized. The invariants must know
-- the difference, or the delegated path looks like a collision.
create or replace function pg_temp.is_dedicated(section_value jsonb)
returns boolean language sql immutable as $fn$
  select jsonb_array_length(coalesce(section_value->'regions', '[]'::jsonb)) = 1
     and jsonb_array_length(coalesce(section_value#>'{regions,0,blocks}', '[]'::jsonb)) = 1
     and (section_value#>>'{regions,0,blocks,0,type}') in ('site_header','site_footer');
$fn$;

-- Source Block ids of one area, in composition order (Pattern Regions flattened first).
-- A dedicated Section contributes its own Region's Blocks, which is what the projection emits.
create or replace function pg_temp.area_block_ids(section_value jsonb)
returns jsonb language sql immutable as $fn$
  select case when pg_temp.is_dedicated(section_value) then (
           select coalesce(jsonb_agg(block->>'id' order by block_ord), '[]'::jsonb)
           from jsonb_array_elements(section_value#>'{regions,0,blocks}') with ordinality as blocks(block, block_ord)
         ) else (
           select coalesce(jsonb_agg(block_value->>'id' order by node_ord, region_ord, block_ord), '[]'::jsonb)
  from jsonb_array_elements(coalesce(section_value->'composition', '[]'::jsonb))
       with ordinality as nodes(node, node_ord)
  cross join lateral (
    select 1 as region_ord, b as block_value, b_ord as block_ord
    from jsonb_array_elements(
      case when nodes.node ? 'pattern' then '[]'::jsonb else jsonb_build_array(nodes.node) end
    ) with ordinality as independent(b, b_ord)
    union all
    select regions.r_ord as region_ord, blk as block_value, blocks.blk_ord as block_ord
    from jsonb_array_elements(coalesce(nodes.node->'regions', '[]'::jsonb))
         with ordinality as regions(r, r_ord)
    cross join lateral jsonb_array_elements(coalesce(regions.r->'blocks', '[]'::jsonb))
         with ordinality as blocks(blk, blk_ord)
  ) expanded
  ) end;
$fn$;

-- Ids present anywhere in the SOURCE document.
create or replace function pg_temp.source_ids(candidate jsonb)
returns text[] language sql immutable as $fn$
  select coalesce(array_agg(x), array[]::text[]) from (
    select s->>'id' as x from jsonb_array_elements(candidate->'sections') s
    union all
    select r->>'id' from jsonb_array_elements(candidate->'sections') s,
           jsonb_array_elements(coalesce(s->'regions','[]'::jsonb)) r
    union all
    select b->>'id' from jsonb_array_elements(candidate->'sections') s,
           jsonb_array_elements(coalesce(s->'regions','[]'::jsonb)) r,
           jsonb_array_elements(coalesce(r->'blocks','[]'::jsonb)) b
    union all
    select n->>'id' from jsonb_array_elements(candidate->'sections') s,
           jsonb_array_elements(coalesce(s->'composition','[]'::jsonb)) n
    union all
    select r->>'id' from jsonb_array_elements(candidate->'sections') s,
           jsonb_array_elements(coalesce(s->'composition','[]'::jsonb)) n,
           jsonb_array_elements(coalesce(n->'regions','[]'::jsonb)) r
    union all
    select b->>'id' from jsonb_array_elements(candidate->'sections') s,
           jsonb_array_elements(coalesce(s->'composition','[]'::jsonb)) n,
           jsonb_array_elements(coalesce(n->'regions','[]'::jsonb)) r,
           jsonb_array_elements(coalesce(r->'blocks','[]'::jsonb)) b
  ) all_ids
  where x is not null;
$fn$;

-- Concatenated SOURCE Block ids across every area, in composition order.
create or replace function pg_temp.source_block_ids(candidate jsonb)
returns jsonb language sql immutable as $fn$
  select coalesce(jsonb_agg(value order by section_ord, block_ord), '[]'::jsonb)
  from jsonb_array_elements(candidate->'sections') with ordinality as sections(section_value, section_ord)
  cross join lateral jsonb_array_elements(pg_temp.area_block_ids(sections.section_value))
       with ordinality as blocks(value, block_ord);
$fn$;

-- Concatenated PROJECTED Block ids across every projected Section, in order.
create or replace function pg_temp.projected_block_ids(candidate jsonb)
returns jsonb language sql immutable as $fn$
  select coalesce(jsonb_agg(block->>'id' order by section_ord, block_ord), '[]'::jsonb)
  from jsonb_array_elements(private.builder_landing_document_v2_projection(candidate)->'sections')
       with ordinality as sections(section_value, section_ord)
  cross join lateral jsonb_array_elements(coalesce(sections.section_value#>'{regions,0,blocks}', '[]'::jsonb))
       with ordinality as blocks(block, block_ord);
$fn$;

create temp table inv(name text, verdict text, detail text);

-- I1 â€” every source Block exactly once, in composition order (this is what S4 and S5 break).
insert into inv
select 'I1 every source Block exactly once, in composition order',
       case when bool_and(source_ids = projected_ids) then 'PASS' else 'FAIL' end,
       count(*) filter (where source_ids <> projected_ids)::text || ' of ' || count(*)::text || ' fixtures mismatch'
from (
  select pg_temp.source_block_ids(f.doc) as source_ids,
         pg_temp.projected_block_ids(f.doc) as projected_ids
  from fixture f where f.validator = 'landing' and f.expect_server
) x;

-- I4 â€” the projected Section may only assert what is true of itself.
insert into inv
select 'I4 every projected Section is stack with exactly one span-12 Region',
       case when bool_and(coalesce(ok, false)) then 'PASS' else 'FAIL' end,
       count(*) filter (where not ok)::text || ' of ' || count(*)::text || ' projected Sections violate it'
from (
  select (s.projected_section->>'layout' = 'stack'
          and jsonb_array_length(s.projected_section->'regions') = 1
          and (s.projected_section#>'{regions,0,span}')::int = 12) as ok
  from fixture f
  cross join lateral jsonb_array_elements(
    private.builder_landing_document_v2_projection(f.doc)->'sections') as s(projected_section)
  where f.validator = 'landing'
) x;

insert into inv
select 'I4 exactly one projected Section per source area',
       case when bool_and(coalesce(ok, false)) then 'PASS' else 'FAIL' end,
       count(*) filter (where not ok)::text || ' of ' || count(*)::text || ' fixtures mismatch'
from (
  select jsonb_array_length(private.builder_landing_document_v2_projection(f.doc)->'sections')
       = jsonb_array_length(f.doc->'sections') as ok
  from fixture f where f.validator = 'landing'
) x;

-- I6 â€” no synthesized identity may equal any source id (this is what S2 and S3 break).
-- A delegated dedicated Section is excluded: its ids are the source ids on purpose.
insert into inv
select 'I6 no synthesized Region id equals any source id',
       case when bool_and(coalesce(ok, false)) then 'PASS' else 'FAIL' end,
       count(*) filter (where not ok)::text || ' of ' || count(*)::text || ' fixtures collide'
from (
  select not exists (
    select 1
    from jsonb_array_elements(private.builder_landing_document_v2_projection(f.doc)->'sections') p(projected_section)
    join jsonb_array_elements(f.doc->'sections') src(source_section)
      on src.source_section->>'id' = p.projected_section->>'id'
    where not pg_temp.is_dedicated(src.source_section)
      and projected_section#>'{regions,0,id}' is not null
      and (projected_section#>>'{regions,0,id}') = any (pg_temp.source_ids(f.doc))
  ) as ok
  from fixture f where f.validator = 'landing'
) x;

-- I5 â€” the projection is a pure function of its input (this is what S6 breaks).
insert into inv
select 'I5 projection is deterministic for identical input',
       case when bool_and(same) then 'PASS' else 'FAIL' end,
       count(*) filter (where not same)::text || ' of ' || count(*)::text || ' fixtures differ between calls'
from (
  select private.builder_landing_document_v2_projection(f.doc)
       = private.builder_landing_document_v2_projection(f.doc) as same
  from fixture f where f.validator = 'landing'
) x;

insert into inv
select 'I5 helper: same input same id, different area different id, salt changes id',
       case when same and distinct_area and salt_differs then 'PASS' else 'FAIL' end,
       'same=' || same::text || ' distinct=' || distinct_area::text || ' salt=' || salt_differs::text
from (
  select
    private.builder_landing_projection_region_id('11111111-1111-4111-8111-111111111111', 0)
      = private.builder_landing_projection_region_id('11111111-1111-4111-8111-111111111111', 0) as same,
    private.builder_landing_projection_region_id('11111111-1111-4111-8111-111111111111', 0)
      <> private.builder_landing_projection_region_id('22222222-2222-4222-8222-222222222222', 0) as distinct_area,
    private.builder_landing_projection_region_id('11111111-1111-4111-8111-111111111111', 0)
      <> private.builder_landing_projection_region_id('11111111-1111-4111-8111-111111111111', 1) as salt_differs
) x;

-- I6 â€” a document that CONTAINS the salt-0 candidate must shift, deterministically.
create temp table poisoned as
with probe as (
  select f.doc,
         private.builder_landing_projection_region_id(f.doc->'sections'->0->>'id', 0) as candidate_0,
         private.builder_landing_projection_region_id(f.doc->'sections'->0->>'id', 1) as candidate_1
  from fixture f
  where f.id = '05-pattern-one-region'
)
select p.candidate_0, p.candidate_1,
       jsonb_set(
         jsonb_set(p.doc, '{sections,0,composition}',
           (p.doc->'sections'->0->'composition')
           || jsonb_build_array(jsonb_build_object(
                'id', p.candidate_0, 'type', 'text', 'schema_version', 1,
                'content', jsonb_build_object('text', 'adversarial')))),
         '{schema_version}', '2'::jsonb) as hostile
from probe p;

insert into inv
select 'I6 salted search shifts to the next candidate when salt 0 is a real source id',
       case when bool_and(coalesce(ok, false)) then 'PASS' else 'FAIL' end,
       'c0=' || (select candidate_0 from poisoned) || ' c1=' || (select candidate_1 from poisoned)
         || ' chosen=' || coalesce((select chosen from (
              select (select projected_section#>>'{regions,0,id}'
                      from jsonb_array_elements(
                        private.builder_landing_document_v2_projection(t.hostile)->'sections') p(projected_section)
                      limit 1) as chosen
              from poisoned t) d), 'none')
from (
  select (select projected_section#>>'{regions,0,id}'
          from jsonb_array_elements(
            private.builder_landing_document_v2_projection(t.hostile)->'sections') p(projected_section)
          limit 1) = t.candidate_1 as ok
  from poisoned t
) x;

-- I2 â€” the projection must be acceptable to the delegated v1 validator.
insert into inv
select 'I2 the projection is v1-valid for every valid landing fixture',
       case when bool_and(coalesce(ok, false)) then 'PASS' else 'FAIL' end,
       count(*) filter (where not ok)::text || ' of ' || count(*)::text || ' fixtures rejected'
from (
  select private.builder_landing_document_v1_is_valid(
           private.builder_landing_document_v2_projection(f.doc)) as ok
  from fixture f where f.validator = 'landing' and f.expect_server
) x;

select name, verdict, detail from inv order by name;

\\echo ''
select 'INVARIANTS ' || count(*) filter (where verdict = 'PASS') || ' ' || count(*) filter (where verdict = 'FAIL') || ' ' || count(*) filter (where verdict is null) || ' ' || count(*) as summary
from inv;
`;

writeFileSync(resolve(outDir, "matrix-verdicts.sql"), verdicts + verdictSelfTest);
writeFileSync(resolve(outDir, "matrix-invariants.sql"), invariants);

console.log(`fixtures: ${fixtures.length}`);
console.log(`wrote ${resolve(outDir, "matrix-verdicts.sql")}`);
console.log(`wrote ${resolve(outDir, "matrix-invariants.sql")}`);



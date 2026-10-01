// Generates the S1-S8 sabotage mutants for the forward migration.
//
// Each mutant is produced by ONE documented textual change to the REAL projection extracted
// from the forward migration, so a mutant can never drift into being a different function by
// accident. Anything else would make a "RED" result meaningless.
//
//   node scripts/builder-sabotage-mutants.mjs <outDir>

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const outDir = resolve(process.argv[2] ?? ".");
mkdirSync(outDir, { recursive: true });

const MIGRATION = "supabase/migrations/20260918000000_builder_landing_v2_projection_repair.sql";
const migration = readFileSync(MIGRATION, "utf8");

const extract = (name) => {
  const start = migration.indexOf(`create or replace function ${name}(`);
  if (start < 0) throw new Error(`${name} not found in the forward migration`);
  const end = migration.indexOf("$$;", start);
  if (end < 0) throw new Error(`${name} body not terminated`);
  return migration.slice(start, end + 3);
};

const projection = extract("private.builder_landing_document_v2_projection");

// The exact Pass-2 fragment the correct projection uses. Every mutation below is expressed as
// a change to THIS text, and the generator refuses to run if it no longer matches.
const CORRECT_PASS2 = `    area_blocks := '[]'::jsonb;
    for node in select value from jsonb_array_elements(coalesce(section_value->'composition', '[]'::jsonb)) loop
      if node ? 'pattern' then
        for region in select value from jsonb_array_elements(coalesce(node->'regions', '[]'::jsonb)) loop
          for block in select value from jsonb_array_elements(coalesce(region->'blocks', '[]'::jsonb)) loop
            area_blocks := area_blocks || jsonb_build_array(block);
          end loop;
        end loop;
      else
        area_blocks := area_blocks || jsonb_build_array(node);
      end if;
    end loop;`;

if (!projection.includes(CORRECT_PASS2)) {
  throw new Error("the projection's Pass 2 fragment changed; update the sabotage generator");
}
const CORRECT_SALT = `    salt := 0;`;
const CORRECT_REGION = `          jsonb_build_object('id', projected_region_id, 'span', 12, 'blocks', area_blocks)`;
const CORRECT_REGION_ID_SEED = `      projected_region_id := private.builder_landing_projection_region_id(section_value->>'id', salt);`;
const CORRECT_LAYOUT = `        'layout', 'stack',`;

// Defect 1 reproduced: keep the area's own layout AND emit one Region per composition node.
const S1_PASS2 = `    projected_regions := '[]'::jsonb;
    for node in select value from jsonb_array_elements(coalesce(section_value->'composition', '[]'::jsonb)) loop
      node_blocks := '[]'::jsonb;
      if node ? 'pattern' then
        for region in select value from jsonb_array_elements(coalesce(node->'regions', '[]'::jsonb)) loop
          for block in select value from jsonb_array_elements(coalesce(region->'blocks', '[]'::jsonb)) loop
            node_blocks := node_blocks || jsonb_build_array(block);
          end loop;
        end loop;
      else
        node_blocks := jsonb_build_array(node);
      end if;
      salt := 0;
      loop
        projected_region_id := private.builder_landing_projection_region_id(
          (section_value->>'id') || ':' || (node->>'id'), salt);
        exit when not coalesce(projected_region_id = any(all_ids), false);
        salt := salt + 1;
        -- Every generated mutant must TERMINATE: the round-2 bound is kept here so S1 fails
        -- closed instead of wedging the suite. S1 mutates the LAYOUT contract, not termination.
        if salt > 128 then
          raise exception using errcode = '22023',
            message = 'BUILDER_PROJECTION_REGION_ID_SEARCH_EXHAUSTED';
        end if;
      end loop;
      projected_regions := projected_regions || jsonb_build_array(
        jsonb_build_object('id', projected_region_id, 'span', 12, 'blocks', node_blocks));
    end loop;`;

// Defect 1's structural window: assert the SOURCE layout, and place the multi-Region list.
const S1 = projection
  .replace(CORRECT_PASS2, S1_PASS2)
  .replace(CORRECT_LAYOUT, `        'layout', section_value->>'layout',`)
  .replace(CORRECT_REGION, `          jsonb_build_object('id', projected_region_id, 'span', 12, 'blocks', area_blocks)`)
  .replace(
    `        'regions', jsonb_build_array(
          jsonb_build_object('id', projected_region_id, 'span', 12, 'blocks', area_blocks)
        )`,
    `        'regions', projected_regions`,
  )
  .replace(
    `  area_blocks jsonb;`,
    `  area_blocks jsonb;
  projected_regions jsonb;
  node_blocks jsonb;`,
  );

// Defect 2a: the synthetic Region id IS the id of the Block it wraps.
const S2 = projection.replace(
  CORRECT_REGION,
  `          jsonb_build_object('id', coalesce(area_blocks->0->>'id', projected_region_id), 'span', 12, 'blocks', area_blocks)`,
);

// Defect 2b: an empty composition reuses the Section id as its Region id.
//
// The override is applied AT THE POINT OF USE. An earlier version assigned
// `projected_region_id := section_value->>'id'` before the salted search, where the search
// immediately overwrote it — a no-op mutation, i.e. a malformed mutant rather than a kill.
const S3_REGION = `          jsonb_build_object('id', case when jsonb_array_length(area_blocks) = 0 then section_value->>'id' else projected_region_id end, 'span', 12, 'blocks', area_blocks)`;
const S3 = projection.replace(CORRECT_REGION, S3_REGION);

// Coverage loss: the first Region of every Pattern is dropped with its Blocks.
//
// Anchored INSIDE the Pass-2 fragment. Anchoring on the bare `coalesce(node->'regions', ...)`
// text matched Pass 1 first (different indentation), so it mutated only the id-collection pass
// and changed no behaviour — another malformed mutant.
const S4_PASS2 = CORRECT_PASS2.replace(
  `for region in select value from jsonb_array_elements(coalesce(node->'regions', '[]'::jsonb)) loop`,
  `for region in select value from jsonb_array_elements(coalesce(node->'regions', '[]'::jsonb) - 0) loop`,
);
if (S4_PASS2 === CORRECT_PASS2) throw new Error("S4 mutation did not apply inside Pass 2");
const S4 = projection.replace(CORRECT_PASS2, S4_PASS2);

// Order loss: independent Blocks are emitted before every Pattern's Blocks.
const S5_PASS2 = `    area_blocks := '[]'::jsonb;
    for node in select value from jsonb_array_elements(coalesce(section_value->'composition', '[]'::jsonb)) loop
      if not (node ? 'pattern') then
        area_blocks := area_blocks || jsonb_build_array(node);
      end if;
    end loop;
    for node in select value from jsonb_array_elements(coalesce(section_value->'composition', '[]'::jsonb)) loop
      if node ? 'pattern' then
        for region in select value from jsonb_array_elements(coalesce(node->'regions', '[]'::jsonb)) loop
          for block in select value from jsonb_array_elements(coalesce(region->'blocks', '[]'::jsonb)) loop
            area_blocks := area_blocks || jsonb_build_array(block);
          end loop;
        end loop;
      end if;
    end loop;`;
const S5 = projection.replace(CORRECT_PASS2, S5_PASS2);

// Nondeterminism: the salted search starts from a random salt, so identical input yields a
// different (still collision-free) identity on each call.
const S6 = projection.replace(CORRECT_SALT, `    salt := (random() * 100000)::integer;`)
  .replace(CORRECT_REGION_ID_SEED, CORRECT_REGION_ID_SEED);

// Defect 3 restored: the drafts CHECK routes every document through the landing validator.
const S8 = `alter table public.builder_asset_drafts drop constraint if exists builder_asset_drafts_document_check;

alter table public.builder_asset_drafts add constraint builder_asset_drafts_document_check
  check (private.builder_landing_document_is_valid(document));
`;

// Dedicated-surface exemption removed: the Pattern-owned style ban becomes unconditional again,
// which is exactly C.8's ordering defect - a valid Header/Footer can no longer be saved.
const v2Validator = extract("private.builder_landing_document_v2_is_valid");
const CONDITIONAL_BAN = `      if not dedicated
         and ((s->'style') ? 'content_width' or (s->'style') ? 'align')
      then return false; end if;`;
if (!v2Validator.includes(CONDITIONAL_BAN)) {
  throw new Error("S9: the conditional ownership ban changed; update the sabotage generator");
}
const S9 = v2Validator.replace(
  CONDITIONAL_BAN,
  `      if (s->'style') ? 'content_width' or (s->'style') ? 'align' then return false; end if;`,
);

// Pattern style VALUES no longer checked: the false acceptance the review measured.
const S10 = extract("private.builder_landing_document_pattern_v2_is_valid")
  .replace(
    `  if node ? 'style' and not private.builder_landing_style_is_valid(node->'style') then return false; end if;`,
    `  if node ? 'style' and jsonb_typeof(node->'style') <> 'object' then return false; end if;`,
  );

const mutants = [
  ["S1", "restore the stack + multiple projected Regions defect (area layout reused)", S1],
  ["S2", "reuse the wrapped Block id as the synthetic Region id", S2],
  ["S3", "reuse the Section id for an empty-composition synthetic Region", S3],
  ["S4", "lose the first Pattern Region and its Blocks during projection", S4],
  ["S5", "reorder composition: independent Blocks before Pattern Blocks", S5],
  ["S6", "make the synthetic id search start from a random salt", S6],
  ["S8", "restore the dispatcher-only drafts CHECK (Form routed through landing)", S8],
  ["S9", "remove the dedicated-surface exemption from the ownership ban", S9],
  ["S10", "stop validating Pattern node style VALUES", S10],
];

const projections = new Set(["S1", "S2", "S3", "S4", "S5", "S6"]);

for (const [name, description, sql] of mutants) {
  if (projections.has(name) && sql === projection) {
    throw new Error(`${name}: the mutation did not apply — the projection text changed`);
  }
  writeFileSync(
    resolve(outDir, `${name}.sql`),
    `-- SABOTAGE ${name}: ${description}\n-- Generated by scripts/builder-sabotage-mutants.mjs. Not for deployment.\n${sql}\n`,
  );
}

// ---------------------------------------------------------------------------
// ROUND-2 mutants. S11-S16 are single-point edits of the CURRENT migration; S17 is a mutation
// of the LIFECYCLE HARNESS (a flag), because a weak negative-control matcher cannot be modelled
// by writing SQL to a database.
// ---------------------------------------------------------------------------
const ARRAY_REMOVE = `  all_ids := array_remove(all_ids, NULL);\n\n`;
if (!projection.includes(ARRAY_REMOVE)) throw new Error("S11: array_remove line changed");
const NULL_SAFE_EXIT = `      exit when not coalesce(projected_region_id = any(all_ids), false);`;
if (!projection.includes(NULL_SAFE_EXIT)) throw new Error("S11: NULL-safe exit changed");

// S11 — restore the NULL-sensitive exit predicate and drop the NULL filter. The bound is KEPT so
// the mutant terminates: it raises the exhaustion error instead of returning a projection, which
// is exactly what the projection suite's termination assertion detects.
const S11 = projection
  .replace(ARRAY_REMOVE, "")
  .replace(NULL_SAFE_EXIT, `      exit when not (projected_region_id = any(all_ids));`);

// S12 — remove the hard bound. The search then silently walks past the 128th candidate.
const SALT_BOUND = `      salt := salt + 1;\n      if salt > 128 then\n        raise exception using errcode = '22023',\n          message = 'BUILDER_PROJECTION_REGION_ID_SEARCH_EXHAUSTED',\n          detail = 'the salted collision search exceeded 128 candidates for one projected area';\n      end if;`;
if (!projection.includes(SALT_BOUND)) throw new Error("S12: salt bound text changed");
const S12 = projection.replace(SALT_BOUND, `      salt := salt + 1;`);

// S14 — ONLY the round-2 R5 hole returns: a string `background` is no longer required to be a
// legal token (the rest of the shared helper, including the object form, stays intact). This is
// deliberately narrower than S10, which removes the whole style-value delegation.
const STRING_BACKGROUND = `        if jsonb_typeof(entry.value) <> 'string'\n           or (entry.value #>> '{}') !~ '^[a-z][a-z0-9_-]{0,47}$'\n        then return false; end if;`;
const styleHelper = extract("private.builder_landing_style_is_valid");
if (!styleHelper.includes(STRING_BACKGROUND)) throw new Error("S14: string-background rule changed");
const S14 = styleHelper.replace(STRING_BACKGROUND, `        if false then return false; end if;`);

// S15 — a solid background no longer needs a colour token (the round-2 R6 hole). The rule now
// also carries the ROUND-4 F1 JSON-string guard, so the mutant removes the WHOLE condition: the
// key name and the regex are the stable anchors, and the full predicate is recovered by locating
// `if background->>'type' = 'solid'` and its terminating `then return false; end if;`.
const SOLID_RULE_HEAD = `      if background->>'type' = 'solid'`;
const SOLID_RULE_TAIL = `      then return false; end if;`;
const solidStart = styleHelper.indexOf(SOLID_RULE_HEAD);
if (solidStart < 0) throw new Error("S15: the solid-colour rule head changed");
const solidEnd = styleHelper.indexOf(SOLID_RULE_TAIL, solidStart);
if (solidEnd < 0) throw new Error("S15: the solid-colour rule tail changed");
const SOLID_RULE = styleHelper.slice(solidStart, solidEnd + SOLID_RULE_TAIL.length);
if (!SOLID_RULE.includes(`coalesce(background->>'color','') !~ '^[a-z][a-z0-9_-]{0,47}$'`)) {
  throw new Error("S15: the solid-colour token regex is no longer inside the rule");
}
const S15 = styleHelper.replace(SOLID_RULE, "");

// S16 — the publication guard goes back to accepting an indeterminate (NULL) verdict.
const PUBLISH_GUARD = `or not coalesce(private.builder_landing_publication_metadata_v1_is_valid(target_draft.document), false) then`;
const repairedPublish = extract("public.publish_builder_landing");
if (!repairedPublish.includes(PUBLISH_GUARD)) throw new Error("S16: publication guard changed");
const S16 = repairedPublish.replace(
  PUBLISH_GUARD,
  `or not private.builder_landing_publication_metadata_v1_is_valid(target_draft.document) then`,
);

// S13 — strip BOTH transaction statements and append a late failure. Everything the file did
// before the failure is then already committed, which is the half-applied schema the atomicity
// suite must detect.
const S13 = `${migration.replace(/^begin;\s*$/m, "").replace(/^commit;\s*$/m, "")}
-- SABOTAGE S13: a late failure with NO wrapping transaction.
do $s13$ begin raise exception 'SABOTAGE_S13_LATE_FAILURE'; end $s13$;
`;

// S13-control — the SAME late failure, but injected INSIDE the file's transaction (immediately
// before `commit;`). This is the "restore" half of the S13 kill: the atomicity suite must report
// GREEN for it (the transaction rolls everything back, so the fingerprint must not move). A
// failure appended AFTER `commit;` would prove nothing, because the repair would already have
// been committed.
const S13_CONTROL = migration.replace(
  /^commit;\s*$/m,
  `-- S13 CONTROL: the same late failure, injected INSIDE the file's transaction.
do $s13c$ begin raise exception 'SABOTAGE_S13_CONTROL_LATE_FAILURE'; end $s13c$;

commit;`,
);

// ---------------------------------------------------------------------------
// ROUND-3 mutants (M1 item 6, M2). S18 makes an authoritative verdict INDETERMINATE; S19-S22
// weaken the client's background type contract that M2 implemented.
// ---------------------------------------------------------------------------

// S18 — one corpus entry gets an SQL NULL gate verdict. NULL is not a verdict: it is accepted by
// every `if not <verdict> then raise` guard and by a CHECK constraint, so the harness must count
// it, refuse GREEN, and the product must still fail closed.
const S18 = `-- SABOTAGE S18: make the drafts CHECK verdict indeterminate (SQL NULL) for one corpus entry.
create or replace function private.builder_document_is_valid(candidate jsonb)
returns boolean
language plpgsql
immutable
security invoker
set search_path = ''
as $$
begin
  if candidate is not null
     and candidate->>'document_type' = 'landing_page'
     and candidate#>>'{sections,0,composition,0,style,background}' = 'surface'
  then
    return null;   -- fixture 32 (a CLIENT-VALID document) becomes indeterminate
  end if;
  if candidate is null or jsonb_typeof(candidate) <> 'object' then return false; end if;
  if candidate->>'document_type' = 'form' then
    return coalesce(private.builder_form_document_v1_is_valid(candidate), false);
  end if;
  if candidate->>'document_type' = 'landing_page' then
    return coalesce(private.builder_landing_document_is_valid(candidate), false);
  end if;
  return false;
exception when others then return false;
end;
$$;
`;

const styleText = extract("private.builder_landing_style_is_valid");
// S20 — the rule now carries the ROUND-4 F1 JSON-string guard, so it is recovered by anchor:
// locate the `if background ? 'overlay_color'` head and its terminating `then return false;`.
const OVERLAY_COLOR_HEAD = `        if background ? 'overlay_color'`;
const OVERLAY_COLOR_TAIL = `        then return false; end if;`;
const overlayStart = styleText.indexOf(OVERLAY_COLOR_HEAD);
if (overlayStart < 0) throw new Error("S20: the overlay_color rule head changed");
const overlayEnd = styleText.indexOf(OVERLAY_COLOR_TAIL, overlayStart);
if (overlayEnd < 0) throw new Error("S20: the overlay_color rule tail changed");
const OVERLAY_COLOR_RULE = styleText.slice(overlayStart, overlayEnd + OVERLAY_COLOR_TAIL.length);
if (!OVERLAY_COLOR_RULE.includes(`!~ '^[a-z][a-z0-9_-]{0,47}$'`)) {
  throw new Error("S20: the overlay_color token regex is no longer inside the rule");
}
const OVERLAY_OPACITY_RULE = `        if background ? 'overlay_opacity' then
          if jsonb_typeof(background->'overlay_opacity') <> 'number'
             or (background->>'overlay_opacity')::numeric <> trunc((background->>'overlay_opacity')::numeric)
             or (background->>'overlay_opacity')::integer not in (0,10,20,30,40,50,60,70,80)
          then return false; end if;
        end if;`;
if (!styleText.includes(OVERLAY_OPACITY_RULE)) throw new Error("S21: the overlay_opacity rule changed");
const PER_TYPE_TABLE = `        when 'none'        then array['type']
        when 'transparent' then array['type']
        when 'solid'       then array['type','color']`;
if (!styleText.includes(PER_TYPE_TABLE)) throw new Error("S19: the none/transparent/solid key table changed");
const IMAGE_GRADIENT_TABLE = `        when 'image'       then array['type','url','fit','position','overlay_color','overlay_opacity']
        else                    array['type','gradient']`;
if (!styleText.includes(IMAGE_GRADIENT_TABLE)) throw new Error("S22: the image/gradient key table changed");

const ALL_EIGHT = "array['type','color','url','fit','position','overlay_color','overlay_opacity','gradient']";

// S19 — none/transparent/solid lose their per-type key restriction.
const S19 = styleText.replace(
  PER_TYPE_TABLE,
  `        when 'none'        then ${ALL_EIGHT}
        when 'transparent' then ${ALL_EIGHT}
        when 'solid'       then ${ALL_EIGHT}`,
);

// S20 — overlay_color is no longer validated.
const S20 = styleText.replace(OVERLAY_COLOR_RULE, "");

// S21 — overlay_opacity is no longer validated or bounded.
const S21 = styleText.replace(OVERLAY_OPACITY_RULE, "");

// S22 — image/gradient lose their per-type key restriction.
const S22 = styleText.replace(
  IMAGE_GRADIENT_TABLE,
  `        when 'image'       then ${ALL_EIGHT}
        else                    ${ALL_EIGHT}`,
);

// ---------------------------------------------------------------------------
// ROUND-4 F1 mutants. Both revert ONLY the JSON-string type guards, so they model the exact
// defect the repair removed: `->>` stringifies a JSON boolean to a token-shaped text and the
// regex accepts it. Fixtures 61-64 are the corpus entries that must catch them.
// ---------------------------------------------------------------------------

// S23 — `background.color` and `background.overlay_color` lose the string-type guard.
// The two guards are disabled by name, so this mutant cannot silently become a no-op.
const COLOR_GUARD = `(jsonb_typeof(background->'color') is not null\n            and jsonb_typeof(background->'color') <> 'string')`;
const OVERLAY_GUARD = `jsonb_typeof(background->'overlay_color') <> 'string'`;
if (!styleText.includes(COLOR_GUARD)) throw new Error("S23: the colour string guard changed");
if (!styleText.includes(OVERLAY_GUARD)) throw new Error("S23: the overlay string guard changed");
const S23 = styleText.replace(COLOR_GUARD, `(false)`).replace(OVERLAY_GUARD, `false`);
if (S23 === styleText) throw new Error("S23: the mutation did not apply");

// S24 — the AREA responsive `spacing` override loses the string-type guard.
const AREA_SPACING_MARKER = `-- ROUND-4 F1, third site:`;
const AREA_SPACING_RULE = `           or (bp.bv ? 'spacing'
               and ((jsonb_typeof(bp.bv->'spacing') is not null
                     and jsonb_typeof(bp.bv->'spacing') <> 'string')
                    or (bp.bv->>'spacing') !~ '^[a-z][a-z0-9_-]{0,47}$'))`;
const v2ValidatorText = extract("private.builder_landing_document_v2_is_valid");
const markerIdx = v2ValidatorText.indexOf(AREA_SPACING_MARKER);
if (markerIdx < 0) throw new Error("S24: the area-responsive F1 marker changed");
const ruleIdx = v2ValidatorText.indexOf(AREA_SPACING_RULE, markerIdx);
if (ruleIdx < 0) throw new Error("S24: the area-responsive spacing rule changed");
const S24 = v2ValidatorText.slice(0, ruleIdx) + v2ValidatorText.slice(ruleIdx + AREA_SPACING_RULE.length);

// ---------------------------------------------------------------------------
// ROUND-6 mutants. Each removes ONLY the null-safety guard this pass added, restoring the
// NULL-blind membership/type test, so the corpus fixtures 65-74 and 77-79 must turn RED.
// ---------------------------------------------------------------------------

// Rewrite `jsonb_typeof(<expr>) is not null and jsonb_typeof(<expr>) <> 'string'` to `false`
// (guard disabled, membership arm still applies) and `jsonb_typeof(<expr>) is distinct from
// 'number'` to `false` (FALSE OR NULL is NULL, i.e. the pre-fix skip).
const disableTypeGuard = (sql, expr) => {
  const safe = `(jsonb_typeof(${expr}) is not null\n                                     and jsonb_typeof(${expr}) <> 'string')`;
  const distinct = `jsonb_typeof(${expr}) is distinct from 'number'`;
  let out = sql;
  if (out.includes(safe)) out = out.split(safe).join(`(false)`);
  if (out.includes(distinct)) out = out.split(distinct).join(`false`);
  if (out === sql) throw new Error(`ROUND-6: guard for ${expr} not found`);
  return out;
};

// S25 — the AREA responsive `layout`/`align` null-safety guards.
const S25_a = disableTypeGuard(v2ValidatorText, `bp.bv->'layout'`);
const S25 = disableTypeGuard(S25_a, `bp.bv->'align'`);

// Drop the FIRST line of a two-line required-string guard, leaving the original NULL-blind
// membership test. `if <typeguard>` is removed and the following `or <membership>` becomes the
// bare `if <membership>`. Anchored on the guard's own first line, so a silent no-op is impossible.
const revertRequiredString = (sql, firstLineFragment) => {
  const lines = sql.split("\n");
  const idx = lines.findIndex((l) => l.includes(firstLineFragment));
  if (idx < 0) throw new Error(`S26: guard line not found: ${firstLineFragment}`);
  if (!/^\s*if\s/.test(lines[idx])) throw new Error(`S26: unexpected guard head: ${lines[idx]}`);
  const next = lines[idx + 1];
  if (!/^\s*or\s/.test(next)) throw new Error(`S26: expected an OR continuation, got: ${next}`);
  const indent = lines[idx].match(/^\s*/)[0];
  lines[idx] = indent + "if " + next.trim().replace(/^or\s+/, "");
  lines.splice(idx + 1, 1);
  return lines.join("\n");
};
// The required-presence guards live in two different functions and must be reverted in the one
// that owns each: Section `layout` in the document validator; Pattern node `layout` and the
// Pattern Region `span` in the pattern validator.
const patternValidatorText = extract("private.builder_landing_document_pattern_v2_is_valid");
const S26_doc = revertRequiredString(v2ValidatorText, "jsonb_typeof(s->'layout') is distinct from 'string'");
const S26_pat_a = revertRequiredString(patternValidatorText, "jsonb_typeof(node->'layout') is distinct from 'string'");
const S26_pat = disableTypeGuard(S26_pat_a, `region->'span'`);
if (S26_doc === v2ValidatorText) throw new Error("S26: the section layout guard did not change");
if (S26_pat === patternValidatorText) throw new Error("S26: the pattern layout / span guards did not change");
// Reassemble the migration with BOTH mutant function bodies in place. A FUNCTION replacer is
// required: `String.replace(str, str)` treats `$$` in the replacement as an escape and would
// corrupt the PL/pgSQL function terminators.
const S26 = migration
  .replace(v2ValidatorText, () => S26_doc)
  .replace(patternValidatorText, () => S26_pat);
if (S26 === migration) throw new Error("S26: replacement failed");

// S27 — the exact-JSON-type guard on the top-level `schema_version`.
const S27 = v2ValidatorText.split(`  if jsonb_typeof(candidate->'schema_version') <> 'number'\n     or candidate->>'schema_version' <> '2'\n  then return false; end if;`).join(`  if candidate->>'schema_version' <> '2' then return false; end if;`);
if (S27 === v2ValidatorText) throw new Error("S27: the schema_version guard changed");

const round6Mutants = [
  ["S25", "drop the null-safety guard on AREA responsive layout/align (JSON null accepted)", S25, "migration"],
  ["S26", "drop the required-string guards on Section/Pattern layout and the Region span presence guard", S26, "migration"],
  ["S27", "drop the exact-JSON-type guard on top-level schema_version (string \"2\" accepted)", S27, "migration"],
];

const round3Mutants = [
  ["S18", "make an authoritative verdict indeterminate (SQL NULL) for one corpus entry", S18, "migration"],
  ["S19", "permit an illegal key for none/transparent/solid backgrounds", S19, "migration"],
  ["S20", "bypass overlay_color validation", S20, "migration"],
  ["S21", "bypass overlay_opacity validation and range", S21, "migration"],
  ["S22", "weaken the per-type key restriction for image/gradient", S22, "migration"],
  // ROUND-4 F1
  ["S23", "drop the JSON-string guard on background.color/overlay_color (booleans accepted)", S23, "migration"],
  ["S24", "drop the JSON-string guard on the area responsive spacing override", S24, "migration"],
  // ROUND-6
  ...round6Mutants,
];

const round2Mutants = [
  ["S11", "reintroduce the NULL-sensitive salt exit (and drop the NULL filter)", S11, "migration"],
  ["S12", "remove the hard bound on the salted search", S12, "migration"],
  ["S13", "strip the transaction and fail late (half-applied schema)", S13, "atomicity"],
  ["S13-control", "the same late failure WITH the transaction (must stay atomic)", S13_CONTROL, "atomicity-control"],
  ["S14", "stop validating Pattern node style VALUES", S14, "migration"],
  ["S15", "allow a solid background with no valid colour token", S15, "migration"],
  ["S16", "restore NULL publication-metadata acceptance in publish", S16, "migration"],
  ...round3Mutants,
];

const kinds = [
  ["S1", "migration"], ["S2", "migration"], ["S3", "migration"], ["S4", "migration"],
  ["S5", "migration"], ["S6", "migration"], ["S7", "migration"], ["S8", "migration"],
  ["S9", "migration"], ["S10", "migration"],
  ...round2Mutants.map(([name, , , kind]) => [name, kind]),
  // S17 mutates the lifecycle HARNESS, not the schema: the sabotage runner regenerates the
  // lifecycle with --loosen-matcher instead of applying a file.
  ["S17", "lifecycle"],
];
writeFileSync(resolve(outDir, "mutant-kinds.json"), JSON.stringify(Object.fromEntries(kinds), null, 2));

for (const [name, description, sql, kind] of round2Mutants) {
  if (kind === "migration" && sql === migration) {
    throw new Error(`${name}: the mutation did not apply — the migration text changed`);
  }
  writeFileSync(
    resolve(outDir, `${name}.sql`),
    `-- SABOTAGE ${name}: ${description}\n-- Generated by scripts/builder-sabotage-mutants.mjs. Not for deployment.\n${sql}\n`,
  );
}

// S7 mutates the REPAIRED publish function (the one that now carries the R4 guard). There is no
// S7-restore file any more: restoration is re-applying the real migration, which recreates the
// correct publish. A stale restore file would silently reinstate C.8's NULL-permissive guard.
const THE_CALL = "private.builder_landing_document_is_valid(target_draft.document)";
if (!repairedPublish.includes(THE_CALL)) throw new Error("S7: publish validation call not found");
writeFileSync(resolve(outDir, "S7.sql"), `-- SABOTAGE S7: publish uses the v1-only validator while save uses the corrected one
-- Generated by scripts/builder-sabotage-mutants.mjs. Not for deployment.
${repairedPublish.replace(THE_CALL, "private.builder_landing_document_v1_is_valid(target_draft.document)")}
`);

console.log(`wrote ${mutants.length + round2Mutants.length + 1} mutant files (S1-S16) + mutant-kinds.json into ${outDir}`);
console.log("S17 (lifecycle matcher) is generated by running builder-lifecycle-matrix.mjs with --loosen-matcher");

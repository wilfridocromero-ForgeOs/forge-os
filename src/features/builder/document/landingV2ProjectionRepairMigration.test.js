import assert from "node:assert/strict";
import test from "node:test";
import { readFile, readdir } from "node:fs/promises";

// ---------------------------------------------------------------------------
// Forward corrective migration â€” static contract.
//
// C.8 (20260916090000) is a FROZEN historical migration: Staging reports it as applied, so it
// is never edited and its semantics are never rewritten. The repair lives in the forward
// migration instead. This suite pins both halves of that arrangement:
//   * C.8 still contains its original (defective) projection, so a later edit cannot quietly
//     rewrite history;
//   * the forward migration supersedes exactly the defective behaviour, and nothing else.
//
// The RUNTIME half of the proof is `scripts/builder-forward-migration-matrix.ps1` plus
// `scripts/builder-lifecycle-matrix.mjs`, which need a real PostgreSQL.
// ---------------------------------------------------------------------------

const C8 = "20260916090000_builder_landing_document_v2_persistence.sql";
const FORWARD = "20260918000000_builder_landing_v2_projection_repair.sql";

const migrationDir = new URL("../../../../supabase/migrations/", import.meta.url);
const c8 = await readFile(new URL(C8, migrationDir), "utf8");
const forward = await readFile(new URL(FORWARD, migrationDir), "utf8");
const files = (await readdir(migrationDir)).filter((name) => name.endsWith(".sql")).sort();

const functionBody = (source, name) => {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} must be defined`);
  const end = source.indexOf("$$;", start);
  assert.notEqual(end, -1, `${name} body must terminate`);
  return source.slice(start, end);
};

test("C.8 is frozen: its original projection is still present and unmodified", () => {
  // If any of these disappear, someone rewrote an applied migration instead of forwarding.
  assert.match(c8, /legacy_region := legacy_region \|\| \(node->'regions'\)/, "C.8's Pattern-Region projection must remain as history");
  assert.match(c8, /'id', node->>'id'/, "C.8's synthetic Region id must remain as history");
  assert.match(c8, /layout_value := s->>'layout'/, "C.8's area-layout reuse must remain as history");
  assert.match(c8, /builder_asset_drafts_document_check\s*\n\s*check \(private\.builder_landing_document_is_valid\(document\)\)/);
});

test("the forward migration is a NEW file that sorts after every applied migration", () => {
  assert.ok(files.includes(FORWARD), `${FORWARD} must exist`);
  assert.notEqual(FORWARD, C8);
  const index = files.indexOf(FORWARD);
  assert.equal(index, files.length - 1, "the repair must sort last in the chain");
  for (const applied of [
    C8,
    "20260917000000_orvesen_baseline_completion.sql",
    "20260917000100_orvesen_auth_bootstrap_triggers.sql",
  ]) {
    assert.ok(files.indexOf(applied) < index, `${FORWARD} must sort after ${applied}`);
  }
});

test("defect 1 fix: the projected Section is always stack with exactly one span-12 Region", () => {
  const projection = functionBody(forward, "private.builder_landing_document_v2_projection");
  assert.match(projection, /'layout', 'stack'/, "the projected layout must be stack");
  assert.match(projection, /jsonb_build_object\('id', projected_region_id, 'span', 12, 'blocks', area_blocks\)/);
  assert.doesNotMatch(projection, /layout_value/, "the area layout must never be reused as projected structure");
  assert.doesNotMatch(projection, /legacy_region/, "the legacy accumulation must be gone");
  // It may not READ the source layout: that is the category error being fixed.
  assert.doesNotMatch(projection, /section_value\s*->>\s*'layout'/, "the projection must not read the source layout");
  assert.doesNotMatch(projection, /section_value#>?>\{?'?layout/, "the projection must not read the source layout");
  assert.match(projection, /'layout', 'stack'/, "the only layout the projection may assert is the hardcoded stack");
});

test("defect 1 fix: a Pattern contributes its Regions' Blocks, an independent Block itself", () => {
  const projection = functionBody(forward, "private.builder_landing_document_v2_projection");
  assert.match(projection, /if node \? 'pattern' then/);
  assert.match(projection, /area_blocks := area_blocks \|\| jsonb_build_array\(block\)/);
  assert.match(projection, /area_blocks := area_blocks \|\| jsonb_build_array\(node\)/);
});

test("defect 2 fix: synthetic Region ids are deterministic, random-free and proven collision-free", () => {
  const helper = functionBody(forward, "private.builder_landing_projection_region_id");
  assert.match(helper, /md5\(\s*'orvesen:landing-v2-projection:region:'/, "the derivation must be the agreed namespace");
  assert.match(helper, /coalesce\(area_id, ''\)/, "the area identity must take part");
  assert.match(helper, /coalesce\(salt, 0\)::text/, "the salt must take part");
  // Version/variant nibbles that the v1 id regex accepts, and that no client id uses (client
  // ids are v4 from crypto.randomUUID).
  assert.match(helper, /'-5'/, "version nibble must be 5");
  assert.match(helper, /'-a'/, "variant nibble must be a");
  assert.doesNotMatch(helper, /random|gen_random_uuid|now\(\)|clock_timestamp/, "no randomness or clock");

  const projection = functionBody(forward, "private.builder_landing_document_v2_projection");
  // Pass 1 collects the COMPLETE source id set...
  assert.match(projection, /all_ids := all_ids \|\| \(section_value->>'id'\)/);
  assert.match(projection, /all_ids := all_ids \|\| \(node->>'id'\)/);
  assert.match(projection, /all_ids := all_ids \|\| \(region->>'id'\)/);
  assert.match(projection, /all_ids := all_ids \|\| \(block->>'id'\)/);
  // ...and Pass 2 increments the salt until the candidate is free of ALL of them.
  assert.match(projection, /salt := 0;/);
  assert.match(projection, /projected_region_id := private\.builder_landing_projection_region_id\(section_value->>'id', salt\)/);
  assert.match(projection, /salt := salt \+ 1;/);
  // The old collision sources must be gone.
  assert.doesNotMatch(projection, /'id', section_value->>'id', 'span'/, "the Section id must not be reused as a Region id");
});

// ---------------------------------------------------------------------------
// ROUND-2 R1. The termination contract is asserted as a CONTRACT, not by re-pinning one line
// of text: the effective collision set must contain no NULL, the exit predicate must be
// NULL-safe, and the search must be hard-bounded so a regression fails closed instead of
// spinning. The behavioural half of this (a document that used to wedge the backend, plus a
// document that plants 200 digest predictions) is executed against a real PostgreSQL by
// `scripts/builder-projection-suite.mjs`, which is where the mutant S11/S12 kills happen.
// ---------------------------------------------------------------------------
test("R1: the salted search cannot be poisoned by a NULL and cannot run unbounded", () => {
  const projection = functionBody(forward, "private.builder_landing_document_v2_projection");
  // A NULL in the collision set makes `x = ANY(...)` NULL, and `EXIT WHEN NULL` never fires.
  assert.match(projection, /all_ids := array_remove\(all_ids, NULL\)/,
    "the effective collision set must be free of NULL");
  assert.match(projection, /exit when not coalesce\(projected_region_id = any\(all_ids\), false\)/,
    "the exit predicate must be NULL-safe");
  assert.doesNotMatch(projection, /exit when not \(projected_region_id = any\(all_ids\)\);/,
    "the NULL-sensitive exit predicate must be gone");
  // A hard, fail-closed bound: exhausting it raises, and the caller turns that into `false`.
  assert.match(projection, /if salt > 128 then/, "the search must be bounded");
  assert.match(projection, /BUILDER_PROJECTION_REGION_ID_SEARCH_EXHAUSTED/, "the bound must fail closed loudly");

  // The reachable path must not be able to produce a NULL in the first place: a dedicated
  // Section's Region and Block ids are validated natively, with the same id regex the v1
  // chain uses.
  const v2 = functionBody(forward, "private.builder_landing_document_v2_is_valid");
  const dedicatedBlock = v2.slice(v2.indexOf("if dedicated then"));
  assert.match(dedicatedBlock, /ident := s#>>'\{regions,0,id\}';/);
  assert.match(dedicatedBlock, /ident := s#>>'\{regions,0,blocks,0,id\}';/);
  assert.match(dedicatedBlock, /!~\*\s*\n\s*'\^\[0-9a-f\]\{8\}/,
    "the dedicated Region and Block ids must be validated, not merely counted");
});

test("defect 3 fix: the drafts CHECK dispatches on document type and fails closed", () => {
  const dispatcher = functionBody(forward, "private.builder_document_is_valid");
  // ROUND-3 M1.5: the dispatch returns are coalesced, so an indeterminate (SQL NULL) verdict
  // from either authority is a REJECTION rather than a skipped guard.
  assert.match(dispatcher, /if candidate->>'document_type' = 'form' then\s*\n\s*return coalesce\(private\.builder_form_document_v1_is_valid\(candidate\), false\);/,
    "a Form verdict must be fail-closed (TRUE accepts; FALSE and NULL reject)");
  assert.match(dispatcher, /if candidate->>'document_type' = 'landing_page' then\s*\n\s*return coalesce\(private\.builder_landing_document_is_valid\(candidate\), false\);/,
    "a landing verdict must be fail-closed (TRUE accepts; FALSE and NULL reject)");
  assert.match(dispatcher, /return false;/, "an unsupported document type must fail closed");
  assert.doesNotMatch(dispatcher, /builder_landing_document_v1_is_valid\(candidate\)/, "a Form must never be routed through the landing chain");

  // Dropped BY NAME, never by matching a definition: the definition-matching loop is exactly
  // the mechanism that stripped the Form branch in C.8. The drop and the add are one
  // statement so the table is never observable without a document CHECK.
  assert.match(forward, /alter table public\.builder_asset_drafts\s*\n\s*drop constraint if exists builder_asset_drafts_document_check,/);
  assert.doesNotMatch(forward, /pg_get_constraintdef/, "the repair must not repeat C.8's definition-matching drop");
  assert.doesNotMatch(forward, /\$migration\$/, "no dynamic constraint sweep");
  assert.match(forward, /add constraint builder_asset_drafts_document_check\s*\n\s*check \(private\.builder_document_is_valid\(document\) is true\)/);
  // The domain check C.8 removed without replacement is restored.
  assert.match(forward, /add constraint builder_asset_drafts_schema_version_check\s*\n\s*check \(schema_version in \(1, 2\)\)/);
});

test("the review findings that this migration closes stay closed", () => {
  // CRITICAL: a dedicated Header/Footer Section must be exempt from the Pattern-owned style
  // ban, which means `dedicated` must be decided BEFORE that ban and the ban must be conditional.
  const v2 = functionBody(forward, "private.builder_landing_document_v2_is_valid");
  assert.match(v2, /if not dedicated\s*\n\s*and \(\(s->'style'\) \? 'content_width' or \(s->'style'\) \? 'align'\)\s*\n\s*then return false; end if;/);
  assert.ok(
    v2.indexOf("dedicated := jsonb_array_length(s->'regions') = 1") < v2.indexOf("if not dedicated"),
    "`dedicated` must be computed before the ownership ban",
  );
  // HIGH: the v2 style/responsive allowlists must carry the client's extra keys.
  const styleHelper = functionBody(forward, "private.builder_landing_style_is_valid");
  for (const key of ["'line_height'", "'letter_spacing'", "'appearance'"]) {
    assert.ok(styleHelper.includes(key), `style allowlist must include ${key}`);
  }
  const responsiveHelper = functionBody(forward, "private.builder_landing_responsive_style_is_valid");
  for (const key of ["'line_height'", "'letter_spacing'"]) {
    assert.ok(responsiveHelper.includes(key), `responsive allowlist must include ${key}`);
  }
  // HIGH: Pattern style VALUES are enforced natively, not only key-checked. The v1 appearance
  // rule is reused rather than copied.
  const pattern = functionBody(forward, "private.builder_landing_document_pattern_v2_is_valid");
  assert.match(pattern, /not private\.builder_landing_style_is_valid\(node->'style'\)/);
  assert.match(styleHelper, /private\.builder_visual_appearance_v1_is_valid\(entry\.value\)/);
  // HIGH: the projection drops only the three keys v1's older SECTION allowlist predates.
  const projection = functionBody(forward, "private.builder_landing_document_v2_projection");
  assert.match(projection, /\(section_value->'style'\) - 'line_height' - 'letter_spacing' - 'appearance'/);
  // MEDIUM: the type dispatcher resolves its dependency at CALL time.
  assert.match(forward, /create or replace function private\.builder_document_is_valid\(candidate jsonb\)\s*\nreturns boolean\s*\nlanguage plpgsql/);
});

test("every native v2 rule is preserved in the replaced validator", () => {
  const v2 = functionBody(forward, "private.builder_landing_document_v2_is_valid");
  for (const [label, pattern] of [
    ["section key set", /key <> all\(array\['id','label','anchor','layout','style','responsive','regions','composition'\]\)/],
    ["COMPOSITION_REQUIRED", /if not has_composition then return false; end if;/],
    ["LEGACY_REGIONS_IN_V2", /if jsonb_array_length\(s->'regions'\) <> 0 then return false; end if;/],
    ["pattern-owned area style (exempt for a dedicated surface)", /if not dedicated\s*\n\s*and \(\(s->'style'\) \? 'content_width' or \(s->'style'\) \? 'align'\)\s*\n\s*then return false; end if;/],
    ["dedicated surface ban", /if b->>'type' in \('site_header','site_footer'\) then return false; end if;/],
    ["malformed mixed node", /if node \? 'regions' then return false; end if;/],
    ["block ceiling", /block_count > 500/],
    ["pattern ceiling", /pattern_count > 128/],
    ["composition ceiling", /composition_count > 256/],
    ["byte ceiling", /pg_column_size\(candidate\) > 524288/],
    ["pattern validator delegation", /private\.builder_landing_document_pattern_v2_is_valid\(node\)/],
    ["block validator delegation", /private\.builder_landing_document_block_v2_is_valid\(/],
    ["v1 delegation on the projection", /private\.builder_landing_document_v1_is_valid\(\s*private\.builder_landing_document_v2_projection\(candidate\)/],
    ["fails closed", /exception when others then return false;/],
  ]) {
    assert.match(v2, pattern, `${label} must be preserved`);
  }
  // Global id uniqueness across every node kind is still enforced natively.
  const appends = (v2.match(/ids := array_append\(ids, ident\)/g) || []).length;
  assert.ok(appends >= 6, `every id kind must still join the shared list, found ${appends}`);
});

test("the projection is documented as validation-only and never persisted", () => {
  assert.match(forward, /never persisted/i);
  assert.match(forward, /RULE-TRANSFER VEHICLE/);
  const projection = functionBody(forward, "private.builder_landing_document_v2_projection");
  assert.doesNotMatch(projection, /insert into|update public\.|delete from/i, "the projection must not write");
});

test("security posture: private, revoked, invoker, no new client surface", () => {
  for (const [name, signature] of [
    ["private.builder_landing_projection_region_id", "text, integer"],
    ["private.builder_landing_document_v2_projection", "jsonb"],
    ["private.builder_landing_document_v2_is_valid", "jsonb"],
    ["private.builder_document_is_valid", "jsonb"],
  ]) {
    assert.match(
      forward,
      new RegExp(`alter function ${name.replace(/\./g, "\\.")}\\(${signature.replace(/[()]/g, "\\$&")}\\) owner to postgres;`),
      `${name} must be owned by postgres`,
    );
    assert.match(
      forward,
      new RegExp(`revoke all on function ${name.replace(/\./g, "\\.")}\\(${signature.replace(/[()]/g, "\\$&")}\\) from public, anon, authenticated, service_role;`),
      `${name} must be revoked from every client role`,
    );
  }
  assert.doesNotMatch(forward, /grant (all|insert|update|delete) on (table )?public\./i, "no new write surface");
  assert.doesNotMatch(forward, /grant execute/i, "no new execute grant");
});

test("nothing outside the three defects is touched", () => {
  // The shared rule chain, the metadata validator, the dispatcher and both RPCs are untouched.
  assert.doesNotMatch(forward, /create or replace function private\.builder_landing_document_v1_is_valid/);
  assert.doesNotMatch(forward, /builder_landing_document_v1_is_valid_before_header/);
  assert.doesNotMatch(forward, /create or replace function private\.builder_landing_publication_metadata_v1_is_valid/);
  assert.doesNotMatch(forward, /create or replace function private\.builder_landing_document_is_valid/);
  assert.doesNotMatch(forward, /create or replace function public\.save_builder_asset_draft/);
  assert.doesNotMatch(forward, /create or replace function public\.get_published_builder_landing/);
  assert.doesNotMatch(forward, /create or replace function private\.builder_form_document_v1_is_valid/);
  assert.doesNotMatch(forward, /create or replace function private\.builder_landing_document_form_references/);
  // The two v2 node validators ARE intentionally superseded: the review proved their narrow
  // allowlists falsely rejected editor-written style keys, and that a Pattern node's style
  // VALUES were enforced by nothing. Everything else v2-side is left alone.
  assert.match(forward, /create or replace function private\.builder_landing_document_pattern_v2_is_valid/);
  assert.match(forward, /create or replace function private\.builder_landing_document_block_v2_is_valid/);
  // ROUND-2 R4: `publish_builder_landing` IS deliberately re-created, because its publication
  // guard had to become explicitly boolean/fail-closed. The re-creation must keep every other
  // guarantee of C.8's body.
  assert.match(forward, /create or replace function public\.publish_builder_landing/);
  const publish = functionBody(forward, "public.publish_builder_landing");
  assert.match(publish, /not coalesce\(private\.builder_landing_publication_metadata_v1_is_valid\(target_draft\.document\), false\)/,
    "an indeterminate publication verdict must block publication");
  for (const [label, pattern] of [
    ["authentication", /BUILDER_ACCESS_DENIED/],
    ["asset type and lifecycle", /BUILDER_PUBLISH_ASSET_INVALID/],
    ["optimistic concurrency", /BUILDER_PUBLISH_CONFLICT/],
    ["form references", /BUILDER_FORM_REFERENCE_INVALID/],
    ["slug required", /BUILDER_PUBLIC_SLUG_REQUIRED/],
    ["slug invalid", /BUILDER_PUBLIC_SLUG_INVALID/],
    ["slug taken", /BUILDER_PUBLIC_SLUG_TAKEN/],
    ["slug immutable", /BUILDER_PUBLIC_SLUG_IMMUTABLE/],
    ["document invalid", /BUILDER_DOCUMENT_INVALID/],
    ["version numbering", /coalesce\(max\(version\.version_number\), 0\) \+ 1/],
    ["published snapshot insert", /insert into public\.builder_asset_versions/],
  ]) {
    assert.match(publish, pattern, `publish must still enforce ${label}`);
  }
  // No table other than the drafts document CHECK is altered.
  const alters = forward.match(/alter table public\.\w+/g) || [];
  assert.deepEqual([...new Set(alters)], ["alter table public.builder_asset_drafts"]);
});

// ---------------------------------------------------------------------------
// ROUND-2 R2. The file must be one transaction with a preflight that refuses to change the
// constraint while an incompatible row exists. The behavioural half (an abort leaves the exact
// pre-migration schema, and a late failure rolls back) is measured by
// `scripts/builder-repair-atomicity.ps1`; this pins the structure that makes it possible.
// ---------------------------------------------------------------------------
test("R2: the migration is one transaction with a fail-closed preflight", () => {
  const code = forward.split("\n").filter((line) => !line.trim().startsWith("--"));
  const beginAt = code.findIndex((line) => /^begin;\s*$/.test(line));
  const commitAt = code.findIndex((line) => /^commit;\s*$/.test(line));
  assert.ok(beginAt >= 0, "the file must open a transaction");
  assert.ok(commitAt > beginAt, "the file must commit the transaction");
  assert.equal(code.slice(beginAt + 1, commitAt).filter((line) => /^commit;\s*$/.test(line)).length, 0,
    "there must be exactly one commit");

  assert.match(forward, /BUILDER_REPAIR_PREFLIGHT_INCOMPATIBLE_ROWS/, "the preflight must name its refusal");
  assert.match(forward, /satisfy the live C\.8 document CHECK but are rejected by the repaired validator/,
    "the preflight must state the C.8-accepted / repair-rejected relation");
  assert.match(forward, /NEVER REWRITES A CUSTOMER DOCUMENT/,
    "the preflight must not silently rewrite documents");
  assert.match(forward, /no document has been rewritten/i,
    "the abort must state that nothing was rewritten");
  assert.ok(forward.indexOf("BUILDER_REPAIR_PREFLIGHT_INCOMPATIBLE_ROWS") < forward.indexOf("alter table public.builder_asset_drafts"),
    "the preflight must precede the constraint change");
  const alterBlock = forward.slice(forward.indexOf("alter table public.builder_asset_drafts"),
    forward.indexOf("add constraint builder_asset_drafts_schema_version_check"));
  assert.equal((alterBlock.match(/alter table/g) || []).length, 1, "the constraint change must be one statement");
});

// ---------------------------------------------------------------------------
// ROUND-2 R3/R5/R6. The native v2 envelope must be null-safe, and the shared style helper must
// enforce the string form of `background` and a colour for a solid surface.
// ---------------------------------------------------------------------------
test("R3/R5/R6: null-safe v2 envelope and complete background rules", () => {
  const v2 = functionBody(forward, "private.builder_landing_document_v2_is_valid");
  assert.match(v2, /is distinct from 'object'/, "presence must be asserted null-safely");
  assert.match(v2, /jsonb_typeof\(candidate->'locale'\) is distinct from 'string'/, "locale presence");
  assert.match(v2, /jsonb_typeof\(candidate#>'\{settings,seo\}'\) is distinct from 'object'/, "seo presence");
  assert.match(v2, /jsonb_typeof\(candidate#>'\{settings,seo,title\}'\) is distinct from 'string'/, "seo.title presence");
  assert.match(v2, /jsonb_typeof\(candidate#>'\{settings,design_system\}'\) is distinct from 'object'/, "design_system presence");
  assert.match(v2, /foreach design_category in array array\['colors','typography','buttons','radii','spacing','content_widths'\]/,
    "all six design_system categories must be asserted");

  const styleHelper = functionBody(forward, "private.builder_landing_style_is_valid");
  // ROUND-4 F1: a solid background must require a valid colour token AND — before the token
  // regex is consulted — that the value is a JSON STRING. `->>` stringifies a JSON boolean to
  // the text 'true', which the token pattern matches, so the guard-less form accepted
  // `{"color": true}` while the client's `validToken` (a typeof check) rejects it.
  assert.match(styleHelper, /background->>'type' = 'solid'[\s\S]{0,400}?coalesce\(background->>'color',''\) !~ '\^\[a-z\]\[a-z0-9_-\]\{0,47\}\$'/,
    "a solid background must still require a valid colour token");
  assert.match(styleHelper, /jsonb_typeof\(background->'color'\) is not null\s*\n\s*and jsonb_typeof\(background->'color'\) <> 'string'/,
    "F1: a solid background colour must be a JSON string, not a boolean or other value");
  assert.match(styleHelper, /jsonb_typeof\(background->'overlay_color'\) <> 'string'/,
    "F1: overlay_color must be a JSON string");
  assert.match(functionBody(forward, "private.builder_landing_document_v2_is_valid"),
    /jsonb_typeof\(bp\.bv->'spacing'\) is not null/,
    "F1: the area responsive spacing override must be a JSON string");
  assert.match(styleHelper, /else\s*\n\s*-- R5:/, "the string form of background must be handled");

  // ROUND-3 M2: the client's per-type key contract (landingDocument.js:329-355) and its overlay
  // value rules (landingDocument.js:405-433) must be implemented, not just a global key list.
  const allowedKeys = styleHelper.slice(styleHelper.indexOf("allowed_keys := case"));
  for (const [label, fragment] of [
    ["none", "when 'none'        then array['type']"],
    ["transparent", "when 'transparent' then array['type']"],
    ["solid", "when 'solid'       then array['type','color']"],
    ["image", "when 'image'       then array['type','url','fit','position','overlay_color','overlay_opacity']"],
    ["gradient", "else                    array['type','gradient']"],
  ]) {
    assert.ok(allowedKeys.includes(fragment), `the per-type key table must restrict type=${label}`);
  }
  assert.match(styleHelper, /key <> all\(allowed_keys\)/,
    "the per-type key table must actually be enforced");
  assert.match(styleHelper, /overlay_color/,
    "overlay_color must be validated");
  assert.match(styleHelper, /background \? 'overlay_opacity' then/,
    "overlay_opacity must be validated");
  assert.match(styleHelper, /not in \(0,10,20,30,40,50,60,70,80\)/,
    "overlay_opacity must be bounded to the client's discrete set");

  // ROUND-3 LOW-1: a whitespace-only locale is rejected by the v2-native envelope.
  assert.match(v2, /btrim\(coalesce\(candidate->>'locale',''\)\) = ''/, "a blank locale must be rejected");
  // ROUND-3 M1.5: the CHECK asserts `is true`, so a NULL verdict cannot pass it.
  assert.match(forward, /check \(private\.builder_document_is_valid\(document\) is true\)/,
    "the drafts CHECK must not rely on NULL-passes semantics");
});

test("the projection stays semantically honest about dedicated Header/Footer Sections", () => {
  const projection = functionBody(forward, "private.builder_landing_document_v2_projection");
  assert.match(projection, /jsonb_build_array\(section_value\);/, "a dedicated Section is delegated wholesale, as C.8 did");
});



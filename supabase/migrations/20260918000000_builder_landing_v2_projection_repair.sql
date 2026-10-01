-- ===========================================================================
-- ORVESEN Builder — forward corrective migration.
--
-- Repairs three defects proven in 20260916090000_builder_landing_document_v2_persistence.sql
-- ("C.8"), which is now a FROZEN historical migration: Staging reports
-- `20260916090000` as applied, so C.8 is never edited and its semantics are never
-- rewritten. This migration supersedes exactly the defective behaviour and nothing else.
--
-- DEFECT 1 — region budget vs area layout.
--   C.8 re-parented a Pattern's Regions onto the projected legacy Section (C.8:367) and
--   added one pseudo-Region per independent Block (C.8:383-389), while keeping the v2
--   AREA's own `layout` as the legacy Section layout (C.8:405). The delegated v1 validator
--   requires `stack` => exactly one Region (20260902_...:56), so any `stack` area holding
--   more than one projected Region was rejected. A v2 area's layout belongs to the area;
--   Region ownership belongs to the Pattern. The projection conflated the two.
--
-- DEFECT 2 — synthetic Region ids collided with the nodes they wrapped.
--   An independent Block's pseudo-Region reused the Block's own id (C.8:383-389) and the
--   empty-composition placeholder reused the Section id (C.8:397-399). Section, Region and
--   Block ids share ONE document-wide namespace (20260902_...:55,104,112), so both were
--   rejected as duplicates.
--
-- DEFECT 3 — the drafts document CHECK lost its document-type dispatch.
--   C.8's definition-matching drop loop (C.8:511-531) matched the pre-C.8
--   `landing_v1_valid OR form_v1_valid` constraint and replaced it with a dispatcher-only
--   CHECK, routing Form documents through the LANDING validator. A valid Form draft was
--   therefore rejected inside `builder_create_initial_asset_version()`, so a Form asset
--   could not even be created.
--
-- THE CORRECTED PROJECTION CONTRACT
--   The projection is a RULE-TRANSFER VEHICLE, never a persisted or rendered model
--   (C.8:418 already stated "the copy is never persisted"; this migration makes it
--   structural by moving it into its own function that is only ever called by the
--   validator). It may assert only what is TRUE OF THE PROJECTED OBJECT:
--
--     I1  every source Block appears exactly once, unchanged, in composition order;
--     I2  a natively valid v2 document is not falsely rejected;
--     I3  an invalid document is not falsely accepted (the native checks run first, and
--         every Block is exposed to the shared content rules);
--     I4  projected structural assertions are true of the projected structure — always
--         `layout = stack` with exactly ONE Region of `span = 12`;
--     I5  the projection is a pure, deterministic function of its input;
--     I6  no synthesized id can equal any id in the source document;
--     I7  the projection is never persisted;
--     I8  schema-v1 behaviour is untouched: the v1 chain, the metadata validator, the
--         dispatcher, both RPCs, the read predicate, grants and RLS are not modified.
--
--   Two passes: Pass 1 collects the COMPLETE source id set; Pass 2 emits one projected
--   legacy Section per area whose single Region carries every Block of that area in
--   composition order (a Pattern contributes its Regions' Blocks in Region order, an
--   independent Block contributes itself).
-- ===========================================================================
--
-- ===========================================================================
-- ROUND-2 CORRECTIVE PASS (this file is the candidate, not yet applied anywhere).
-- Six defects found by the independent round-2 review are repaired here, in place, so
-- there is exactly ONE forward migration and no second supersession layer.
--
--   R1 (CRITICAL, termination)  The salted collision search could never terminate.
--      Pass 1 appended SQL NULL for a dedicated Header/Footer Section whose Region or
--      Block `id` is absent, and `x = ANY(array_containing_NULL)` is NULL rather than
--      FALSE, so `EXIT WHEN NOT (...)` never fired: the loop was bounded only by integer
--      overflow (~50h at the measured rate). Repaired four ways: the dedicated ids are
--      now validated natively (so the reachable path cannot produce NULL at all);
--      `array_remove(all_ids, NULL)` empties the effective collision set of NULLs; the
--      exit predicate is NULL-safe via `coalesce(..., false)`; and the search carries a
--      hard, fail-closed bound. A legitimate document needs salt 0 or 1 — only an
--      adversary can plant many candidates, and that must terminate rather than spin.
--
--   R2 (HIGH, atomicity)  A validating `add constraint` aborts on any stored row that
--      C.8 accepted and this migration rejects, and the runner (`psql -f`, no
--      --single-transaction) left the schema HALF-APPLIED: repaired functions present,
--      C.8's dispatcher-only CHECK still live and the Form defect still unfixed. The
--      whole file is now ONE transaction, and an explicit PREFLIGHT runs before the
--      constraint is touched, aborting with the offending rows listed. Nothing before
--      COMMIT is persistent, so an abort leaves the schema exactly at the pre-migration
--      C.8 state. Documented at section 4b.
--
--   R3 (MEDIUM, envelope)  `settings.design_system`, one of its six categories,
--      `settings.seo`, `settings.seo.title`/`description` or `locale` could be ABSENT
--      and still pass, because the delegated v1 rules test `jsonb_typeof(...) <> 'object'`
--      which is NULL (not TRUE) for an absent key. The v2 envelope is now asserted
--      natively with the null-safe `IS DISTINCT FROM`, without touching the frozen v1
--      chain. See section 3.
--
--   R4 (MEDIUM, publication parity)  `publish_builder_landing` tested
--      `NOT builder_landing_publication_metadata_v1_is_valid(...)`; that helper returns
--      SQL NULL for an absent `seo.title`, so `NOT NULL` = NULL and the guard did not
--      fire: the document published and then returned NO ROW from the public read
--      (a published page nobody can see). The publication guard is now explicitly
--      boolean/fail-closed. See section 5.
--
--   R5 (MEDIUM, pattern background)  A Pattern node's `style.background` given as a plain
--      string bypassed every value rule, because the shared helper only validated the
--      object form. See section 2b.
--
--   R6 (MEDIUM, solid background)  `{type:"solid"}` accepted any colour token, or none.
--      The shared helper now requires a valid token colour for a solid surface. Real
--      producers always write `{type:"solid", color:<token>}` (landingPatterns.js:565,580
--      and LandingPageEditor.jsx:542,2171,2339), and the client's own rule is
--      `if (type === "solid" && !validToken(color))` (landingDocument.js:357-365); the
--      server additionally requires the colour to be PRESENT, which is recorded as a
--      known server-stricter divergence in the fixture corpus. See section 2b.
--
-- Files changed by this pass, and nothing else: this migration, the fixture corpus,
-- the two forward-migration node tests, and the matrix/lifecycle/sabotage harnesses.
-- C.8 (20260916090000) remains byte-identical; no schema-v1 validator is modified.
--
-- RUNNER REQUIREMENT: apply with ON_ERROR_STOP=1. The file is a single transaction, but
-- psql without ON_ERROR_STOP would keep issuing statements inside an aborted transaction
-- and could report success on a COMMIT that PostgreSQL turns into a ROLLBACK.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. Deterministic, collision-free synthetic Region identity.
--
--    Random-free: md5 of a fixed namespaced string. Deterministic and stable for
--    identical input. md5 lives in pg_catalog, so it resolves under `search_path = ''`
--    and needs neither pgcrypto nor uuid-ossp.
--
--    The digest is rearranged into the UUID layout the v1 validator's id regex accepts,
--    with the version nibble forced to 5 and the variant nibble to 'a'. Client ids come
--    from crypto.randomUUID(), i.e. version 4, so a version-5 id is visibly not a client
--    id — a recognition aid only. The GUARANTEE is not the nibble and not probability:
--    the caller checks the candidate against the complete source id set and increments
--    `salt` until it is free.
-- ---------------------------------------------------------------------------

create or replace function private.builder_landing_projection_region_id(area_id text, salt integer)
returns text
language sql
immutable
security invoker
set search_path = ''
as $$
  select substr(digest, 1, 8) || '-' || substr(digest, 9, 4) || '-5' || substr(digest, 14, 3)
      || '-a' || substr(digest, 18, 3) || '-' || substr(digest, 21, 12)
  from (
    select md5(
      'orvesen:landing-v2-projection:region:' || coalesce(area_id, '') || ':' || coalesce(salt, 0)::text
    ) as digest
  ) as hashed;
$$;

-- ---------------------------------------------------------------------------
-- 2. The corrected projection.
--
--    Pure: it reads nothing but its argument and is never persisted. It does not validate
--    — the validator has already run every native v2 rule before calling it, and the v1
--    chain it feeds performs the shared content rules.
--
--    A dedicated Header/Footer Section stays delegated wholesale, exactly as C.8:315-329
--    did: it is a protected single surface in both schemas.
-- ---------------------------------------------------------------------------

create or replace function private.builder_landing_document_v2_projection(candidate jsonb)
returns jsonb
language plpgsql
immutable
security invoker
set search_path = ''
as $$
declare
  section_value jsonb; node jsonb; region jsonb; block jsonb;
  all_ids text[] := array[]::text[];
  projected_sections jsonb := '[]'::jsonb;
  area_blocks jsonb;
  projected_region_id text;
  salt integer;
  dedicated boolean;
begin
  -- PASS 1 — every identity in the source document, so a synthesized id can be proven
  -- free of ALL of them rather than merely unlikely to collide.
  for section_value in select value from jsonb_array_elements(coalesce(candidate->'sections', '[]'::jsonb)) loop
    all_ids := all_ids || (section_value->>'id');
    for region in select value from jsonb_array_elements(coalesce(section_value->'regions', '[]'::jsonb)) loop
      all_ids := all_ids || (region->>'id');
      for block in select value from jsonb_array_elements(coalesce(region->'blocks', '[]'::jsonb)) loop
        all_ids := all_ids || (block->>'id');
      end loop;
    end loop;
    for node in select value from jsonb_array_elements(coalesce(section_value->'composition', '[]'::jsonb)) loop
      all_ids := all_ids || (node->>'id');
      for region in select value from jsonb_array_elements(coalesce(node->'regions', '[]'::jsonb)) loop
        all_ids := all_ids || (region->>'id');
        for block in select value from jsonb_array_elements(coalesce(region->'blocks', '[]'::jsonb)) loop
          all_ids := all_ids || (block->>'id');
        end loop;
      end loop;
    end loop;
  end loop;

  -- R1: an absent `id` used to append SQL NULL here. `x = ANY(array_with_NULL)` is NULL
  -- rather than FALSE, and `EXIT WHEN NOT (NULL)` never fires, so a single NULL turned the
  -- Pass-2 search below into a non-terminating loop. The effective collision set is
  -- therefore a set of REAL ids only: NULLs are removed once, after the collection pass.
  all_ids := array_remove(all_ids, NULL);

  -- PASS 2 — one projected legacy Section per composition area.
  for section_value in select value from jsonb_array_elements(coalesce(candidate->'sections', '[]'::jsonb)) loop
    dedicated := jsonb_array_length(coalesce(section_value->'regions', '[]'::jsonb)) = 1
      and jsonb_array_length(coalesce(section_value#>'{regions,0,blocks}', '[]'::jsonb)) = 1
      and (section_value#>>'{regions,0,blocks,0,type}') in ('site_header', 'site_footer');

    if dedicated then
      projected_sections := projected_sections || jsonb_build_array(section_value);
      continue;
    end if;

    -- Every Block of the area, in composition order: a Pattern contributes its Regions'
    -- Blocks (Region order, then Block order), an independent Block contributes itself.
    area_blocks := '[]'::jsonb;
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
    end loop;

    -- Deterministic salted search against the COMPLETE source id set.
    --
    -- R1: the exit predicate is NULL-SAFE (`coalesce(..., false)`) and the search is
    -- HARD-BOUNDED. A real document needs salt 0 or salt 1; the bound is a fail-closed
    -- anti-abuse guard for a document that plants hundreds of predictions of the digest,
    -- which no client can produce. Exhausting it aborts instead of spinning, and the
    -- caller (private.builder_landing_document_v2_is_valid) turns that into `false`.
    salt := 0;
    loop
      projected_region_id := private.builder_landing_projection_region_id(section_value->>'id', salt);
      exit when not coalesce(projected_region_id = any(all_ids), false);
      salt := salt + 1;
      if salt > 128 then
        raise exception using errcode = '22023',
          message = 'BUILDER_PROJECTION_REGION_ID_SEARCH_EXHAUSTED',
          detail = 'the salted collision search exceeded 128 candidates for one projected area';
      end if;
    end loop;

    projected_sections := projected_sections || jsonb_build_array(
      jsonb_build_object(
        'id', section_value->>'id',
        -- I4: the projected Section owns exactly one Region, so `stack` is the true
        -- statement about the projected object. The area's own layout is validated
        -- natively by the v2 validator and is deliberately NOT reused here.
        'layout', 'stack',
        'regions', jsonb_build_array(
          jsonb_build_object('id', projected_region_id, 'span', 12, 'blocks', area_blocks)
        )
      )
      -- The v1 SECTION style allowlist predates `line_height`, `letter_spacing` and
      -- `appearance`. All three are validated natively above (and by the v1 wrapper for
      -- `appearance`), so they are dropped from the PROJECTION only, never from the stored
      -- document, rather than being rejected by an older allowlist.
      || (case when section_value ? 'style'
               then jsonb_build_object('style',
                      (section_value->'style') - 'line_height' - 'letter_spacing' - 'appearance')
               else '{}'::jsonb end)
      || (case when section_value ? 'responsive' then jsonb_build_object('responsive', section_value->'responsive') else '{}'::jsonb end)
    );
  end loop;

  -- The v1 validator requires `schema_version = 1`; this copy is never persisted (I7).
  return jsonb_build_object(
    'schema_version', '1',
    'document_type', candidate->>'document_type',
    'locale', candidate->'locale',
    'settings', candidate->'settings',
    'sections', projected_sections
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 2b. Shared native style rules.
--
--     The v2 validators previously checked only style/responsive KEY allowlists and left the
--     VALUES to the delegated v1 rules. That left two holes:
--       * the key allowlists were NARROWER than the client's STYLE_KEYS, so a style key the
--         Builder itself writes (`line_height`, `letter_spacing`, `appearance`) made a valid
--         document fail closed;
--       * a Pattern node's `style` was never delegated at all (the projection transfers the
--         AREA style), so its VALUES were enforced by nothing - a false acceptance.
--     Both are closed here, once, for areas and Pattern nodes alike. The value tables mirror
--     the client's STYLE_KEYS / RESPONSIVE_STYLE_KEYS (landingDocument.js) and the v1 rule
--     table (20260902_...:59-83); `appearance` reuses the authoritative v1 helper.
-- ---------------------------------------------------------------------------

create or replace function private.builder_landing_style_is_valid(style jsonb)
returns boolean
language plpgsql
immutable
security invoker
set search_path = ''
as $$
declare
  entry record;
  token text;
  background jsonb;
  allowed_keys text[];
begin
  if style is null then return true; end if;
  if jsonb_typeof(style) <> 'object' then return false; end if;
  -- The client's STYLE_KEYS, exactly.
  if exists (
    select 1 from jsonb_object_keys(style) key
    where key <> all(array[
      'background','color','spacing','radius','content_width','align','text_variant','text_size',
      'text_weight','font_family','line_height','letter_spacing','max_width','border','shadow',
      'padding_top','padding_bottom','appearance'
    ])
  ) then return false; end if;

  for entry in select key, value from jsonb_each(style) loop
    if entry.key = 'background' then
      if jsonb_typeof(entry.value) = 'object' then
      background := entry.value;
      -- ROUND-3 M2: the object form is validated against the client's AUTHORITATIVE contract
      -- (src/features/builder/document/landingDocument.js:290-433), not just a key allowlist:
      --   * the overall closed key set;
      --   * a price-list of legal `type` values;
      --   * `keysByType`, the per-type key restriction (landingDocument.js:329-355), so
      --     {type:"none",color:...}, {type:"solid",...,url:...} and every other cross-type
      --     mixture the client rejects is rejected here too;
      --   * the per-type VALUE rules (solid colour token, image url/fit/position,
      --     overlay_color token, overlay_opacity in the client's discrete 0..80 set,
      --     gradient name).
      -- This is V2-native: the frozen v1 rules are untouched, so schema-v1 documents behave
      -- exactly as before.
      if exists (
        select 1 from jsonb_object_keys(background) key
        where key <> all(array['type','color','url','fit','position','overlay_color','overlay_opacity','gradient'])
      ) then return false; end if;
      if coalesce(background->>'type','') not in ('none','transparent','solid','image','gradient') then return false; end if;
      allowed_keys := case background->>'type'
        when 'none'        then array['type']
        when 'transparent' then array['type']
        when 'solid'       then array['type','color']
        when 'image'       then array['type','url','fit','position','overlay_color','overlay_opacity']
        else                    array['type','gradient']
      end;
      if exists (
        select 1 from jsonb_object_keys(background) key where key <> all(allowed_keys)
      ) then return false; end if;
      -- R6: a solid surface must name a colour, and it must be a legal design token.
      -- The client rejects only a PRESENT invalid token (`validToken(undefined)` is true),
      -- so requiring the colour is deliberately server-stricter; every real producer writes
      -- one (landingPatterns.js:565,580; LandingPageEditor.jsx:542,2171,2339), and the
      -- stricter form is recorded as a known divergence in the fixture corpus.
      -- ROUND-4 F1: the colour must be a JSON STRING before the token regex is applied.
      -- `->>` stringifies a JSON boolean, so `{"color": true}` became the text 'true', which
      -- matches the token pattern and was ACCEPTED here while the client's `validToken` (a
      -- typeof check) rejects it - a server-weaker false acceptance.
      -- The guard fires for a PRESENT value of any non-string type (boolean, number, array,
      -- object, JSON null). For an ABSENT key jsonb_typeof is SQL NULL, so `is not null` is
      -- false and only the unchanged `coalesce(background->>'color','') !~ ...` term decides -
      -- which is TRUE for an absent key, i.e. reject. That preserves the existing, deliberately
      -- server-stricter missing-colour rule and its recorded known divergence exactly.
      -- Either way the outcome is fail-closed; only the WRONG-JSON-TYPE case changes.
      if background->>'type' = 'solid'
         and (
           (jsonb_typeof(background->'color') is not null
            and jsonb_typeof(background->'color') <> 'string')
           or coalesce(background->>'color','') !~ '^[a-z][a-z0-9_-]{0,47}$'
         )
      then return false; end if;
      if background->>'type' = 'image' then
        if coalesce(background->>'url','') !~ '^https://[^[:space:]]+$'
           or coalesce(background->>'fit','cover') not in ('cover','contain')
           or coalesce(background->>'position','center') not in ('center','top','bottom','left','right')
        then return false; end if;
        -- ROUND-4 F1: same string-type guard as `color`. The key is known PRESENT here (the
        -- enclosing `background ? 'overlay_color'`), so jsonb_typeof is never SQL NULL.
        if background ? 'overlay_color'
           and (
             jsonb_typeof(background->'overlay_color') <> 'string'
             or (background->>'overlay_color') !~ '^[a-z][a-z0-9_-]{0,47}$'
           )
        then return false; end if;
        if background ? 'overlay_opacity' then
          if jsonb_typeof(background->'overlay_opacity') <> 'number'
             or (background->>'overlay_opacity')::numeric <> trunc((background->>'overlay_opacity')::numeric)
             or (background->>'overlay_opacity')::integer not in (0,10,20,30,40,50,60,70,80)
          then return false; end if;
        end if;
      end if;
      if background->>'type' = 'gradient'
         and coalesce(background->>'gradient','') not in ('none','aurora','gold_dusk','graphite','soft_light')
      then return false; end if;
      else
        -- R5: the STRING form of `background` is a design token. It previously fell
        -- through every rule — and a Pattern node's style is dropped from the projection,
        -- so for a Pattern nothing else ever saw it — so any value at all was accepted.
        if jsonb_typeof(entry.value) <> 'string'
           or (entry.value #>> '{}') !~ '^[a-z][a-z0-9_-]{0,47}$'
        then return false; end if;
      end if;
    elsif entry.key = 'appearance' then
      -- Validated by the single authoritative implementation, not a second copy.
      if not private.builder_visual_appearance_v1_is_valid(entry.value) then return false; end if;
    else
      if jsonb_typeof(entry.value) <> 'string' then return false; end if;
      token := entry.value #>> '{}';
      if entry.key = 'align' and token not in ('start','center','end') then return false; end if;
      if entry.key = 'text_variant' and token not in ('lead','body','small') then return false; end if;
      if entry.key = 'text_size' and token not in ('xs','sm','md','lg','xl','2xl') then return false; end if;
      if entry.key = 'text_weight' and token not in ('regular','medium','semibold','bold') then return false; end if;
      if entry.key = 'font_family' and token not in ('inherit','sans','serif','mono','display') then return false; end if;
      if entry.key = 'line_height' and token not in ('tight','normal','relaxed') then return false; end if;
      if entry.key = 'letter_spacing' and token not in ('tight','normal','wide') then return false; end if;
      if entry.key = 'max_width' and token not in ('none','narrow','standard','wide') then return false; end if;
      if entry.key = 'border' and token not in ('none','subtle','standard') then return false; end if;
      if entry.key = 'shadow' and token not in ('none','subtle','soft','medium','elevated') then return false; end if;
      if entry.key = 'radius' and token not in ('none','sm','md','lg','pill') then return false; end if;
      if entry.key in ('padding_top','padding_bottom') and token not in ('none','xs','sm','md','lg','xl') then return false; end if;
      if entry.key in ('color','spacing','content_width') and token !~ '^[a-z][a-z0-9_-]{0,47}$' then return false; end if;
    end if;
  end loop;
  return true;
exception when others then return false;
end;
$$;

-- Breakpoint overrides: the client's RESPONSIVE_STYLE_KEYS, with values.
create or replace function private.builder_landing_responsive_style_is_valid(breakpoint jsonb)
returns boolean
language plpgsql
immutable
security invoker
set search_path = ''
as $$
declare
  entry record;
  token text;
begin
  if breakpoint is null then return true; end if;
  if jsonb_typeof(breakpoint) <> 'object' then return false; end if;
  if exists (
    select 1 from jsonb_object_keys(breakpoint) key
    where key <> all(array[
      'layout','span','align','spacing','hidden','text_variant','text_size','line_height',
      'letter_spacing','max_width','padding_top','padding_bottom'
    ])
  ) then return false; end if;

  for entry in select key, value from jsonb_each(breakpoint) loop
    if entry.key = 'span' then
      if jsonb_typeof(entry.value) <> 'number'
         or (entry.value #>> '{}')::numeric <> trunc((entry.value #>> '{}')::numeric)
         or (entry.value #>> '{}')::integer not between 1 and 12
      then return false; end if;
    elsif entry.key = 'hidden' then
      if jsonb_typeof(entry.value) <> 'boolean' then return false; end if;
    else
      if jsonb_typeof(entry.value) <> 'string' then return false; end if;
      token := entry.value #>> '{}';
      if entry.key = 'layout' and token not in ('stack','columns') then return false; end if;
      if entry.key = 'align' and token not in ('start','center','end') then return false; end if;
      if entry.key = 'text_variant' and token not in ('lead','body','small') then return false; end if;
      if entry.key = 'text_size' and token not in ('xs','sm','md','lg','xl','2xl') then return false; end if;
      if entry.key = 'line_height' and token not in ('tight','normal','relaxed') then return false; end if;
      if entry.key = 'letter_spacing' and token not in ('tight','normal','wide') then return false; end if;
      if entry.key = 'max_width' and token not in ('none','narrow','standard','wide') then return false; end if;
      if entry.key in ('padding_top','padding_bottom') and token not in ('none','xs','sm','md','lg','xl') then return false; end if;
      if entry.key = 'spacing' and token !~ '^[a-z][a-z0-9_-]{0,47}$' then return false; end if;
    end if;
  end loop;
  return true;
exception when others then return false;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2c. Pattern-node validator: same rules as C.8, plus style/responsive VALUES.
--
--     C.8:127-211 checked the style KEY allowlist only, and the projection never carries a
--     node's style, so `{align:"middle"}` was accepted by the server and rejected by the
--     client. The key set is also widened to the client's STYLE_KEYS, matching the area.
-- ---------------------------------------------------------------------------

create or replace function private.builder_landing_document_pattern_v2_is_valid(node jsonb)
returns boolean
language plpgsql
immutable
security invoker
set search_path = ''
as $$
declare
  region jsonb;
  region_count integer := 0;
  spans integer := 0;
begin
  if node is null or jsonb_typeof(node) <> 'object' then return false; end if;
  -- Closed key set: `id,pattern,layout,style,responsive,regions`.
  if exists (
    select 1 from jsonb_object_keys(node) key
    where key <> all(array['id','pattern','layout','style','responsive','regions'])
  ) then return false; end if;
  if coalesce(node->>'id','') !~*
    '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  then return false; end if;

  -- A Pattern identity is a label, not a uuid: a migrated legacy Pattern carries
  -- `legacy:<sectionId>`, an authored one carries a catalog id.
  if jsonb_typeof(node->'pattern') <> 'string'
     or char_length(node->>'pattern') not between 1 and 120
  then return false; end if;

  -- ROUND-6 MEDIUM 2: this required-presence membership test was NULL-blind in the same way:
  -- `node->>'layout'` is SQL NULL when the key is ABSENT or JSON null, and `NULL not in (...)`
  -- is NULL, so the guard was skipped and the Pattern node was accepted while the client
  -- rejects both. A Pattern node's `layout` is REQUIRED by the client, so here the absence case
  -- is rejected by the membership arm once the type arm has run (NULL is not one of the two
  -- legal strings). The type arm only makes the rejection explicit and type-exact.
  if jsonb_typeof(node->'layout') is distinct from 'string'
     or node->>'layout' not in ('stack','columns')
  then return false; end if;

  if node ? 'style' and not private.builder_landing_style_is_valid(node->'style') then return false; end if;

  if node ? 'responsive' then
    if jsonb_typeof(node->'responsive') <> 'object'
       or exists (
         select 1 from jsonb_object_keys(node->'responsive') key
         where key <> all(array['tablet','mobile'])
       )
    then return false; end if;
    -- PATTERN responsive keys (PATTERN_RESPONSIVE_KEYS in landingComposition.js), with values.
    if exists (
      select 1 from jsonb_each(node->'responsive') as bp(bk, bv)
      where jsonb_typeof(bp.bv) <> 'object'
         or exists (
           select 1 from jsonb_object_keys(bp.bv) key
           where key <> all(array['layout','align','spacing','hidden','padding_top','padding_bottom'])
         )
         -- ROUND-6: these PATTERN-override value checks are PRE-EXISTING and deliberately KEPT.
         -- They are NOT introduced here and NOT relaxed here: the membership/enum arms below are
         -- byte-identical to C.8 and to the pre-ROUND-6 candidate. They make the server STRICTER
         -- (not weaker) than the client on this mount: the client's pattern-responsive validator
         -- checks KEYS ONLY (recorded divergence 37), so it accepts `layout:true`, `align:{}`,
         -- `spacing:true`, `hidden:"yes"` and an absent override, while the server rejects a
         -- PRESENT illegal value and accepts an ABSENT one. Measured, not assumed: 38 such
         -- server-stricter cells over 54 probes, 0 server-weaker. The AREA-level predicate is the
         -- one that carried the ROUND-6 NULL-blind false acceptance, and it is guarded where it
         -- lives; this block needs no type guard because a present member is already constrained
         -- and an absent key is left to `bp.bv ? '<key>'` being false.
         or (bp.bv ? 'layout' and bp.bv->>'layout' not in ('stack','columns'))
         or (bp.bv ? 'align' and bp.bv->>'align' not in ('start','center','end'))
         or (bp.bv ? 'hidden' and jsonb_typeof(bp.bv->'hidden') <> 'boolean')
         -- ROUND-4 F1 deliberately does NOT add a string-type guard to `spacing` here. The
         -- client's pattern-responsive validator checks KEYS only (recorded divergence
         -- 37-known-divergence-pattern-responsive-bad-value), so it ACCEPTS a boolean
         -- `spacing`; guarding it would make the server stricter than the client and
         -- introduce a new divergence instead of restoring agreement. Measured, not assumed:
         -- client verdict for `{tablet:{spacing:true}}` is VALID.
         or (bp.bv ? 'spacing' and (bp.bv->>'spacing') !~ '^[a-z][a-z0-9_-]{0,47}$')
         or (bp.bv ? 'padding_top' and bp.bv->>'padding_top' not in ('none','xs','sm','md','lg','xl'))
         or (bp.bv ? 'padding_bottom' and bp.bv->>'padding_bottom' not in ('none','xs','sm','md','lg','xl'))
    ) then return false; end if;
  end if;

  if jsonb_typeof(node->'regions') <> 'array' then return false; end if;
  for region in select value from jsonb_array_elements(node->'regions') loop
    region_count := region_count + 1;
    if region_count > 12 then return false; end if;
    if jsonb_typeof(region) <> 'object'
       or exists (
         select 1 from jsonb_object_keys(region) key
         where key <> all(array['id','span','blocks'])
       )
       or coalesce(region->>'id','') !~*
         '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       -- ROUND-6 MEDIUM 2: `jsonb_typeof(region->'span') <> 'number'` is NULL-propagating when
       -- the key is ABSENT or JSON null, and the whole OR then evaluates to NULL, which is not
       -- TRUE - so an absent `span` slipped through and was accepted while the client rejects it
       -- (a Region span is required, 1..12). `is distinct from 'number'` is null-safe and TRUE
       -- for absent/null alike, so the presence requirement now fails closed.
       or jsonb_typeof(region->'span') is distinct from 'number'
       or (region->>'span')::numeric <> trunc((region->>'span')::numeric)
       or (region->>'span')::integer not between 1 and 12
       or jsonb_typeof(region->'blocks') <> 'array'
    then return false; end if;
    spans := spans + (region->>'span')::integer;
  end loop;

  if region_count < 1 then return false; end if;
  if node->>'layout' = 'columns' and spans <> 12 then return false; end if;
  return true;
exception when others then return false;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2d. Block validator: same rules as C.8:56-117, with the client's style/responsive keys.
--
--     C.8 accepted the closed key set, id, type, schema_version and a content object, but its
--     style allowlist omitted `line_height`, `letter_spacing` and `appearance` - keys the
--     Builder itself writes - so a valid Block was rejected. Values are now shared with the
--     area rules through the helpers above; the v1 wrapper still re-validates and strips them.
-- ---------------------------------------------------------------------------

create or replace function private.builder_landing_document_block_v2_is_valid(block jsonb)
returns boolean
language plpgsql
immutable
security invoker
set search_path = ''
as $$
begin
  if block is null or jsonb_typeof(block) <> 'object' then return false; end if;
  -- Closed key set. `id,type,schema_version,content,style,responsive`.
  if exists (
    select 1 from jsonb_object_keys(block) key
    where key <> all(array['id','type','schema_version','content','style','responsive'])
  ) then return false; end if;
  if coalesce(block->>'id','') !~*
    '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  then return false; end if;
  if block->>'type' <> all(array[
    'heading','text','image','action_group','form_reference','logo','feature_item',
    'stat','testimonial','video','pricing_card','faq_item','divider','spacer','social_links'
  ]) then return false; end if;
  if block->>'schema_version' <> '1' then return false; end if;
  if jsonb_typeof(block->'content') <> 'object' then return false; end if;

  if block ? 'style' and not private.builder_landing_style_is_valid(block->'style') then return false; end if;

  if block ? 'responsive' then
    if jsonb_typeof(block->'responsive') <> 'object'
       or exists (
         select 1 from jsonb_object_keys(block->'responsive') key
         where key <> all(array['tablet','mobile'])
       )
    then return false; end if;
    if exists (
      select 1 from jsonb_each(block->'responsive') as bp(bk, bv)
      where not private.builder_landing_responsive_style_is_valid(bp.bv)
    ) then return false; end if;
  end if;

  return true;
exception when others then return false;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. The v2 validator, with the native rules UNCHANGED.
--
--    Every native rule of C.8:217-431 is preserved verbatim — the envelope, the v2 section
--    key set, COMPOSITION_REQUIRED, LEGACY_REGIONS_IN_V2, the Pattern-owned area style ban,
--    the dedicated-surface delegation, the ceilings, GLOBAL id uniqueness across every node
--    kind, and the two nested validators. The ONLY change is that the projection is no
--    longer built inline: it is named, pure, and independently testable.
--
--    The native checks still run FIRST and still fail closed, so the projection is only
--    ever reached by a document that already satisfies every v2 rule.
-- ---------------------------------------------------------------------------

create or replace function private.builder_landing_document_v2_is_valid(candidate jsonb)
returns boolean
language plpgsql
immutable
security invoker
set search_path = ''
as $$
declare
  s jsonb; node jsonb; r jsonb; b jsonb;
  ids text[] := array[]::text[];
  ident text;
  section_count integer := 0;
  pattern_count integer := 0;
  block_count integer := 0;
  composition_count integer;
  dedicated boolean;
  has_composition boolean;
  design_category text;
begin
  if candidate is null or jsonb_typeof(candidate) <> 'object' then return false; end if;
  -- Delegated to the v1 validator, but the size ceiling has to hold for v2 as well.
  if pg_column_size(candidate) > 524288 then return false; end if;

  -- --- Envelope -----------------------------------------------------------
  -- ROUND-6 MEDIUM 2: `candidate->>'schema_version'` is TEXT coercion, so the JSON string "2"
  -- satisfied it and was treated as equivalent to the number 2 - the client requires
  -- `document.schema_version === 2` (a NUMBER) and rejects the string form. Assert the exact
  -- JSON type first. `is distinct from 'string'` is deliberately NOT used here: for this field
  -- the client rejects BOTH absence and JSON null, so a null-propagating `<> 'number'` is not
  -- enough either. A plain `jsonb_typeof(...) <> 'number'` is correct because the member is
  -- REQUIRED - absent and null both fail the type test, which is what the client wants.
  if jsonb_typeof(candidate->'schema_version') <> 'number'
     or candidate->>'schema_version' <> '2'
  then return false; end if;
  if candidate->>'document_type' <> 'landing_page' then return false; end if;
  if exists (
    select 1 from jsonb_object_keys(candidate) key
    where key <> all(array['schema_version','document_type','locale','settings','sections'])
  ) then return false; end if;
  if jsonb_typeof(candidate->'sections') <> 'array' then return false; end if;
  if jsonb_array_length(candidate->'sections') > 50 then return false; end if;

  -- --- Envelope, asserted NATIVELY and null-safely (R3) --------------------
  --
  -- The delegated v1 rules express presence as `jsonb_typeof(candidate#>…) <> 'object'`.
  -- For an ABSENT key `jsonb_typeof` is SQL NULL, so that comparison is NULL and an OR of
  -- NULLs is not TRUE: a document with no `design_system`, no `seo`, no `locale` or no
  -- `seo.title` slipped through and was SAVED, PUBLISHED and SERVED. `IS DISTINCT FROM`
  -- is null-safe, so the v2 envelope now fails closed on every one of those. This adds
  -- only presence/type/length assertions for keys v2 always carries; every value rule
  -- stays delegated to the single v1 implementation, and no v1 object is modified.
  if jsonb_typeof(candidate->'locale') is distinct from 'string'
     or char_length(coalesce(candidate->>'locale','')) not between 1 and 16
     -- ROUND-3 LOW-1: the client requires a non-blank locale
     -- (`validText(document.locale, 16, false)`, landingDocument.js:2107-2118), so a
     -- whitespace-only locale is rejected here too. V2-native; the frozen v1 rule is untouched.
     or btrim(coalesce(candidate->>'locale','')) = ''
  then return false; end if;
  if jsonb_typeof(candidate->'settings') is distinct from 'object' then return false; end if;
  if jsonb_typeof(candidate#>'{settings,seo}') is distinct from 'object' then return false; end if;
  if jsonb_typeof(candidate#>'{settings,seo,title}') is distinct from 'string'
     or char_length(coalesce(candidate#>>'{settings,seo,title}','')) > 120
  then return false; end if;
  if jsonb_typeof(candidate#>'{settings,seo,description}') is distinct from 'string'
     or char_length(coalesce(candidate#>>'{settings,seo,description}','')) > 300
  then return false; end if;
  if jsonb_typeof(candidate#>'{settings,design_system}') is distinct from 'object' then return false; end if;
  foreach design_category in array array['colors','typography','buttons','radii','spacing','content_widths'] loop
    if jsonb_typeof(candidate#>array['settings','design_system',design_category]) is distinct from 'object'
    then return false; end if;
  end loop;

  -- --- Sections -----------------------------------------------------------
  for s in select value from jsonb_array_elements(candidate->'sections') loop
    section_count := section_count + 1;

    if jsonb_typeof(s) <> 'object' then return false; end if;
    -- A v2 Section is a composition AREA: content_width/align belong to its Patterns,
    -- so the v2 key set is the v1 one plus `composition`.
    if exists (
      select 1 from jsonb_object_keys(s) key
      where key <> all(array['id','label','anchor','layout','style','responsive','regions','composition'])
    ) then return false; end if;
    if coalesce(s->>'id','') !~*
      '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    then return false; end if;
    ident := s->>'id'; if ident = any(ids) then return false; end if; ids := array_append(ids, ident);

    -- ROUND-6 MEDIUM 2: same NULL-blind membership test as the Pattern node's `layout`. The
    -- client requires a Section layout and rejects both absence and JSON null; today the
    -- delegated v1 rule happens to catch this, so no document is falsely accepted through it —
    -- the guard makes the rule type-exact at the point that owns it instead of relying on a
    -- downstream copy, which is the shape this migration exists to remove.
    if jsonb_typeof(s->'layout') is distinct from 'string'
       or s->>'layout' not in ('stack','columns')
    then return false; end if;
    if s ? 'label' and (jsonb_typeof(s->'label') <> 'string' or char_length(s->>'label') > 120) then return false; end if;
    if s ? 'anchor' and (jsonb_typeof(s->'anchor') <> 'string' or s->>'anchor' !~ '^[a-z0-9]+(-[a-z0-9]+)*$') then return false; end if;

    if jsonb_typeof(s->'regions') <> 'array' then return false; end if;
    -- A dedicated Header/Footer Section is a protected single surface and stays a dedicated
    -- Section in both schemas; every other Section must be a composition area.
    -- Computed HERE, before the style rules, because the style-ownership ban below has to
    -- know whether this Section is a dedicated surface.
    dedicated := jsonb_array_length(s->'regions') = 1
      and jsonb_array_length(coalesce(s#>'{regions,0,blocks}', '[]'::jsonb)) = 1
      and (s#>>'{regions,0,blocks,0,type}') in ('site_header','site_footer');

    if s ? 'style' then
      if jsonb_typeof(s->'style') <> 'object'
         or exists (
           select 1 from jsonb_object_keys(s->'style') key
           where key <> all(array[
             'background','color','spacing','radius','content_width','align','text_variant',
             'text_size','text_weight','font_family','line_height','letter_spacing','max_width',
             'border','shadow','padding_top','padding_bottom','appearance'
           ])
         )
      then return false; end if;
      -- Style ownership (D3): the AREA owns page-level style; width and alignment are the
      -- Pattern's, so the area may not declare them. Mirrors PATTERN_OWNED_STYLE_KEYS +
      -- PATTERN_STYLE_OWNED_BY_NODE.
      --
      -- A dedicated Header/Footer Section is EXEMPT: there the Section IS the protected
      -- surface, and the real producers put exactly these keys on it
      -- (createLandingPattern("site_footer") and the editor's Header palette). C.8 applied
      -- the ban before computing `dedicated`, so a valid Header or Footer could never be
      -- saved or published - the same false-rejection class this migration exists to remove.
      if not dedicated
         and ((s->'style') ? 'content_width' or (s->'style') ? 'align')
      then return false; end if;
      if not private.builder_landing_style_is_valid(s->'style') then return false; end if;
    end if;

    if s ? 'responsive' then
      if jsonb_typeof(s->'responsive') <> 'object'
         or exists (
           select 1 from jsonb_object_keys(s->'responsive') key
           where key <> all(array['tablet','mobile'])
         )
      then return false; end if;
      if exists (
        select 1 from jsonb_each(s->'responsive') as bp(bk, bv)
        where jsonb_typeof(bp.bv) <> 'object'
           or exists (
             select 1 from jsonb_object_keys(bp.bv) key
             where key <> all(array['layout','span','align','spacing','hidden'])
           )
           -- ROUND-6 MEDIUM 1: the AREA-level `layout`/`align` memberships were NULL-blind.
           -- `bp.bv->>'layout'` is SQL NULL for a JSON null, and `NULL not in (...)` is NULL
           -- (not TRUE), so the invalid branch was skipped and a document the client rejects
           -- was accepted - the same semantic family as the F1 `spacing` guard below. The guard
           -- fires only for a key PRESENT with a non-string value; an ABSENT key leaves
           -- jsonb_typeof SQL NULL, so the guard is false and the membership check is skipped,
           -- exactly as the client treats an absent override as "no override".
           or (bp.bv ? 'layout' and ((jsonb_typeof(bp.bv->'layout') is not null
                                     and jsonb_typeof(bp.bv->'layout') <> 'string')
                                    or bp.bv->>'layout' not in ('stack','columns')))
           or (bp.bv ? 'align' and ((jsonb_typeof(bp.bv->'align') is not null
                                     and jsonb_typeof(bp.bv->'align') <> 'string')
                                    or bp.bv->>'align' not in ('start','center','end')))
           -- ROUND-4 F1, third site: this block validated `spacing` by KEY only, so a JSON
           -- boolean/null/array was accepted here while the client's `validToken` (a typeof
           -- check, applied to every remaining style/responsive key) rejects it - a false
           -- acceptance. The gap is pre-existing in the frozen C.8 controller
           -- (20260916090000_...:298-305 is textually identical); it is repaired here because
           -- it is the same root cause, the same token family and the same client contract.
           -- `is not null and <> 'string'` leaves an ABSENT key exactly as it was.
           or (bp.bv ? 'spacing'
               and ((jsonb_typeof(bp.bv->'spacing') is not null
                     and jsonb_typeof(bp.bv->'spacing') <> 'string')
                    or (bp.bv->>'spacing') !~ '^[a-z][a-z0-9_-]{0,47}$'))
      ) then return false; end if;
    end if;

    if jsonb_typeof(s->'regions') <> 'array' then return false; end if;
    if dedicated then
      -- Delegated wholesale, regions and blocks included. Its ids still have to be
      -- counted here: the projection does not re-walk it.
      -- R1: they also have to be VALIDATED here. `#>>` yields SQL NULL for an absent or
      -- JSON-null id, and Pass 1 of the projection used to turn that into a NULL element
      -- of the collision set, which made the salted search non-terminating. Asserting the
      -- ids natively means the reachable path cannot produce a NULL at all; the projection
      -- keeps its own NULL-safety as defence in depth.
      ident := s#>>'{regions,0,id}';
      if coalesce(ident,'') !~*
        '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      then return false; end if;
      if ident = any(ids) then return false; end if; ids := array_append(ids, ident);
      ident := s#>>'{regions,0,blocks,0,id}';
      if coalesce(ident,'') !~*
        '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      then return false; end if;
      if ident = any(ids) then return false; end if; ids := array_append(ids, ident);
      block_count := block_count + 1;
      continue;
    end if;

    -- LEGACY_REGIONS_IN_V2 / COMPOSITION_REQUIRED, plus the client's own rule that an
    -- empty v2 area is expressed as an empty composition array, never as `regions: []`.
    has_composition := (s ? 'composition');
    if not has_composition then return false; end if;
    if jsonb_array_length(s->'regions') <> 0 then return false; end if;
    if jsonb_typeof(s->'composition') <> 'array' then return false; end if;
    composition_count := jsonb_array_length(s->'composition');
    if composition_count > 256 then return false; end if;

    for node in select value from jsonb_array_elements(s->'composition') loop
      if jsonb_typeof(node) <> 'object' then return false; end if;
      ident := node->>'id'; if ident = any(ids) then return false; end if; ids := array_append(ids, ident);

      if node ? 'pattern' then
        -- --- Pattern node -------------------------------------------------
        pattern_count := pattern_count + 1;
        if pattern_count > 128 then return false; end if;
        if not private.builder_landing_document_pattern_v2_is_valid(node) then return false; end if;
        for r in select value from jsonb_array_elements(node->'regions') loop
          ident := r->>'id'; if ident = any(ids) then return false; end if; ids := array_append(ids, ident);
          for b in select value from jsonb_array_elements(r->'blocks') loop
            block_count := block_count + 1;
            if block_count > 500 then return false; end if;
            if not private.builder_landing_document_block_v2_is_valid(b) then return false; end if;
            ident := b->>'id'; if ident = any(ids) then return false; end if; ids := array_append(ids, ident);
            -- A dedicated Header/Footer is a Section by contract; as composition content
            -- it would be a second, unprotected surface.
            if b->>'type' in ('site_header','site_footer') then return false; end if;
          end loop;
        end loop;
        continue;
      end if;

      -- --- Independent composition Block ----------------------------------
      if not private.builder_landing_document_block_v2_is_valid(node) then return false; end if;
      if node->>'type' in ('site_header','site_footer') then return false; end if;
      block_count := block_count + 1;
      if block_count > 500 then return false; end if;
      -- A Block owns no Regions. A node with a `regions` key and no `pattern` key is a
      -- malformed mixed shape and must not be read as either kind.
      if node ? 'regions' then return false; end if;
    end loop;
  end loop;

  -- --- Delegation to the deployed v1 validator, through the named projection -------
  --
  -- The envelope, `settings` (including `locale`, `seo` and `design_system`) and the
  -- delegated section/region/block rule families are validated by the single v1
  -- implementation. Passing the v2 candidate directly to the v1 validator was the original
  -- bug; passing a projection that violates v1's own structural invariants was the second.
  if not private.builder_landing_document_v1_is_valid(
    private.builder_landing_document_v2_projection(candidate)
  ) then return false; end if;

  return true;
exception when others then return false;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Restore document-type dispatch for the drafts document CHECK (defect 3).
--
--    `builder_asset_drafts` holds TWO document types. The pre-C.8 constraint dispatched on
--    the document; C.8 replaced it with a dispatcher-only predicate whose '1' branch is the
--    LANDING validator, so every valid Form draft was rejected.
--
--    This drops the constraint BY ITS KNOWN NAME — deliberately not by matching its
--    definition, which is the mechanism that silently stripped the Form branch in the first
--    place. `drop constraint if exists` also makes the replacement correct whichever shape the
--    constraint currently has (C.8's dispatcher-only predicate, or the pre-C.8
--    landing-OR-form disjunction).
--
--    DEPENDENCY: this migration must run AFTER C.8, which creates
--    `private.builder_landing_document_is_valid`, the v2 block/pattern validators and
--    `builder_asset_drafts`. It sorts later in the chain, and its function bodies resolve
--    their dependencies at CALL time, but it is NOT a substitute for C.8 on a database where
--    C.8 has not run.
-- ---------------------------------------------------------------------------

-- plpgsql, not SQL: a SQL body is resolved at CREATE time, so it would fail on a database
-- where C.8 has not run. This order always has C.8 applied first (it sorts earlier in the
-- chain), but the body is written so the dependency is resolved at CALL time regardless.
create or replace function private.builder_document_is_valid(candidate jsonb)
returns boolean
language plpgsql
immutable
security invoker
set search_path = ''
as $$
begin
  if candidate is null or jsonb_typeof(candidate) <> 'object' then return false; end if;
  -- ROUND-3 M1.5: an authoritative verdict must be TRI-STATEFUL-SAFE. A plpgsql `return <expr>`
  -- hands SQL NULL straight back to the caller, and every production guard in this chain is
  -- written `if not <verdict> then raise`, where `NOT NULL` is NULL and the guard is SKIPPED -
  -- an indeterminate verdict would therefore be accepted. `coalesce(..., false)` makes this
  -- entry point total: TRUE accepts, FALSE and NULL both reject.
  if candidate->>'document_type' = 'form' then
    return coalesce(private.builder_form_document_v1_is_valid(candidate), false);
  end if;
  if candidate->>'document_type' = 'landing_page' then
    return coalesce(private.builder_landing_document_is_valid(candidate), false);
  end if;
  -- Unsupported or absent document type: fail closed, never fall through to a validator that
  -- was not chosen for it.
  return false;
exception when others then return false;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4b. PREFLIGHT (R2) — refuse to change the constraint if any stored row would be
--     rejected by the repaired validator.
--
--     WHY HERE AND NOT EARLIER: the check has to be made by the REPAIRED predicate itself
--     (a second, hand-copied predicate would be a second oracle that can drift — exactly
--     the failure mode this migration exists to remove), and that predicate is defined by
--     the statements above. The file is ONE transaction (`begin;` at the top, `commit;` at
--     the end), so NOTHING before `commit` is persistent: when this block raises,
--     PostgreSQL rolls back every statement of the file together, and the database is left
--     in exactly the pre-migration C.8 state. The atomicity suite proves that property
--     against a seeded database, including a deliberately injected late failure.
--
--     WHICH ROWS THIS CATCHES: the live `builder_asset_drafts_document_check` has been
--     enforced since C.8 was applied, so every stored row satisfies C.8's predicate by
--     construction. `NOT private.builder_document_is_valid(document)` therefore selects
--     exactly the rows that C.8 accepts and this migration would reject — the rows that
--     would make a validating `add constraint` abort halfway through the repair.
--
--     THIS MIGRATION NEVER REWRITES A CUSTOMER DOCUMENT. It reports and aborts.
-- ---------------------------------------------------------------------------
do $preflight$
declare
  offending record;
  offending_count integer := 0;
  report text := '';
begin
  for offending in
    select draft.asset_id,
           draft.organization_id,
           draft.schema_version,
           draft.revision,
           left(coalesce(draft.document->>'document_type', '(none)'), 48) as document_type
    from public.builder_asset_drafts draft
    where not private.builder_document_is_valid(draft.document)
    order by draft.asset_id
  loop
    offending_count := offending_count + 1;
    if offending_count <= 25 then
      report := report || format(
        E'\n  asset_id=%s organization_id=%s schema_version=%s revision=%s document_type=%s',
        offending.asset_id, offending.organization_id, offending.schema_version,
        offending.revision, offending.document_type);
    end if;
  end loop;

  if offending_count > 0 then
    raise exception using
      errcode = '23514',
      message = 'BUILDER_REPAIR_PREFLIGHT_INCOMPATIBLE_ROWS',
      detail = format(
        '%s stored builder_asset_drafts row(s) satisfy the live C.8 document CHECK but are rejected by the repaired validator.%s%s',
        offending_count,
        report,
        case when offending_count > 25 then E'\n  (list truncated at 25 rows)' else '' end),
      hint = 'Revalidate or correct these drafts with the Builder, or quarantine them, then re-run this migration. No schema change has been made and no document has been rewritten.';
  end if;
end
$preflight$;

-- One atomic statement: the table must never be observable without a document CHECK, even
-- when the runner applies this file without a wrapping transaction.
--
-- The constraint is dropped BY ITS KNOWN NAME, deliberately never by matching its definition:
-- C.8's definition-matching loop is exactly what silently stripped the Form branch.
--
-- `schema_version` also regains a domain check. C.8's definitional loop matched
-- `%schema_version = 1%` and removed it without a replacement (it restored the analogous
-- check for versions but not for drafts), leaving the column constrained only indirectly.
--
-- ROUND-3 M1.5: the predicate is asserted as `is true`, so the CHECK can never pass by
-- evaluating to SQL NULL. A CHECK constraint treats NULL as success, which is exactly how an
-- indeterminate validator verdict would have become an accepted document.
alter table public.builder_asset_drafts
  drop constraint if exists builder_asset_drafts_document_check,
  add constraint builder_asset_drafts_document_check
    check (private.builder_document_is_valid(document) is true),
  drop constraint if exists builder_asset_drafts_schema_version_check,
  add constraint builder_asset_drafts_schema_version_check
    check (schema_version in (1, 2));

-- ---------------------------------------------------------------------------
-- 5. Publication guard is explicitly boolean / fail-closed (R4).
--
--    C.8's `publish_builder_landing` tested
--
--      `or not private.builder_landing_publication_metadata_v1_is_valid(target_draft.document)`
--
--    That helper builds its answer from `jsonb_typeof(candidate#>'{settings,seo,title}') = 'string'`.
--    For an ABSENT title the comparison is SQL NULL and the AND-chain is NULL, so the helper
--    returns NULL, `NOT NULL` is NULL, the whole OR is NULL and `IF NULL` is not TRUE: the
--    guard did NOT fire. Measured consequence on the round-2 candidate: SAVE accepted,
--    PUBLISH accepted, `get_published_builder_landing` returned NO ROW — a published page
--    that nobody can see, because the read predicate's `AND <NULL>` excludes the row.
--
--    `coalesce(..., false)` makes the guard explicitly boolean: an indeterminate publication
--    verdict now BLOCKS publication, so a document can never reach the published state and
--    then disappear from the public read. The invariant is
--
--        publish succeeded  =>  the public read returns the document.
--
--    Deliberately NOT repaired by editing `builder_landing_publication_metadata_v1_is_valid`:
--    that helper is shared with the frozen schema-v1 chain and with the
--    `builder_asset_drafts_publication_metadata_check` table constraint, where a NULL result
--    currently means "pass". Changing it would tighten the v1 SAVE path, which is out of
--    scope for this pass; the call site is the narrow, correct place.
--
--    Everything else in this function is byte-identical to C.8: authentication, organization
--    isolation, asset type/lifecycle, optimistic concurrency (BUILDER_PUBLISH_CONFLICT),
--    form-reference validation, slug normalisation, immutability and version numbering.
-- ---------------------------------------------------------------------------
create or replace function public.publish_builder_landing(
  target_asset_id uuid,
  expected_revision bigint,
  requested_public_slug text default null
)
returns table (
  public_slug text,
  published_version_id uuid,
  published_at timestamptz,
  version_number integer,
  draft_revision bigint
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  caller_organization_id uuid := public.current_user_organization_id();
  target_asset public.builder_assets;
  target_draft public.builder_asset_drafts;
  created_version public.builder_asset_versions;
  normalized_slug text;
  next_version_number integer;
  referenced_form_id uuid;
begin
  if caller_id is null or caller_organization_id is null then
    raise exception using errcode = '42501', message = 'BUILDER_ACCESS_DENIED';
  end if;

  select asset.* into target_asset
  from public.builder_assets asset
  where asset.id = target_asset_id and asset.organization_id = caller_organization_id
  for update;

  if target_asset.id is null or not public.can_manage_organization(target_asset.organization_id) then
    raise exception using errcode = '42501', message = 'BUILDER_ACCESS_DENIED';
  end if;
  if target_asset.asset_type <> 'landing_page' or target_asset.lifecycle = 'archived' then
    raise exception using errcode = '23514', message = 'BUILDER_PUBLISH_ASSET_INVALID';
  end if;

  select draft.* into target_draft
  from public.builder_asset_drafts draft
  where draft.asset_id = target_asset.id and draft.organization_id = target_asset.organization_id
  for update;

  if target_draft.asset_id is null then
    raise exception using errcode = 'P0002', message = 'BUILDER_DRAFT_NOT_FOUND';
  end if;
  if target_draft.revision <> expected_revision then
    raise exception using errcode = '40001', message = 'BUILDER_PUBLISH_CONFLICT';
  end if;
  -- Both supported versions, and the stored column must agree with the stored document,
  -- exactly as at save time. R4: the publication-metadata term is coalesced so an
  -- indeterminate (NULL) verdict blocks publication instead of silently passing.
  if target_draft.schema_version not in (1, 2)
     or coalesce(target_draft.document->>'schema_version', '') <> target_draft.schema_version::text
     or not coalesce(private.builder_landing_document_is_valid(target_draft.document), false)
     or not coalesce(private.builder_landing_publication_metadata_v1_is_valid(target_draft.document), false) then
    raise exception using errcode = '22023', message = 'BUILDER_DOCUMENT_INVALID';
  end if;

  for referenced_form_id in
    select reference.form_asset_id from private.builder_landing_document_form_references(target_draft.document) reference
  loop
    if not exists (
      select 1 from public.builder_assets form_asset
      where form_asset.id = referenced_form_id
        and form_asset.organization_id = target_asset.organization_id
        and form_asset.asset_type = 'form'
        and form_asset.lifecycle = 'draft'
    ) then
      raise exception using errcode = '23514', message = 'BUILDER_FORM_REFERENCE_INVALID';
    end if;
  end loop;

  if target_asset.public_slug is null then
    if requested_public_slug is null then
      raise exception using errcode = '22023', message = 'BUILDER_PUBLIC_SLUG_REQUIRED';
    end if;
    normalized_slug := private.builder_normalize_public_slug(requested_public_slug);
    if normalized_slug is null
       or char_length(normalized_slug) not between 3 and 80
       or normalized_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$'
       or normalized_slug = any(array[
         'admin','api','app','assets','builder','calendario','configuracion',
         'construir','discovery','login','orvesen-ia','p','proyectos','register',
         'site','sites','www'
       ]) then
      raise exception using errcode = '22023', message = 'BUILDER_PUBLIC_SLUG_INVALID';
    end if;
    if exists (select 1 from public.builder_assets asset where asset.public_slug = normalized_slug and asset.id <> target_asset.id) then
      raise exception using errcode = '23505', message = 'BUILDER_PUBLIC_SLUG_TAKEN';
    end if;
  else
    normalized_slug := target_asset.public_slug;
    if requested_public_slug is not null
       and private.builder_normalize_public_slug(requested_public_slug) is distinct from target_asset.public_slug then
      raise exception using errcode = '23514', message = 'BUILDER_PUBLIC_SLUG_IMMUTABLE';
    end if;
  end if;

  select coalesce(max(version.version_number), 0) + 1 into next_version_number
  from public.builder_asset_versions version
  where version.asset_id = target_asset.id and version.organization_id = target_asset.organization_id;

  insert into public.builder_asset_versions (
    organization_id, asset_id, version_number, state, schema_version, document, created_by
  ) values (
    target_asset.organization_id, target_asset.id, next_version_number, 'published',
    target_draft.schema_version, target_draft.document, caller_id
  ) returning * into created_version;

  update public.builder_assets asset
  set published_version_id = created_version.id,
      public_slug = normalized_slug,
      published_at = now()
  where asset.id = target_asset.id and asset.organization_id = target_asset.organization_id
  returning * into target_asset;

  return query select target_asset.public_slug, created_version.id, target_asset.published_at, created_version.version_number, target_draft.revision;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Ownership and grants.
--
--    Same posture as every other private helper in the chain: owned by postgres, revoked
--    from every client role, no new execute grant and no new client-callable surface.
-- ---------------------------------------------------------------------------

alter function private.builder_landing_projection_region_id(text, integer) owner to postgres;
alter function private.builder_landing_style_is_valid(jsonb) owner to postgres;
alter function private.builder_landing_responsive_style_is_valid(jsonb) owner to postgres;
alter function private.builder_landing_document_pattern_v2_is_valid(jsonb) owner to postgres;
alter function private.builder_landing_document_block_v2_is_valid(jsonb) owner to postgres;
alter function private.builder_landing_document_v2_projection(jsonb) owner to postgres;
alter function private.builder_landing_document_v2_is_valid(jsonb) owner to postgres;
alter function private.builder_document_is_valid(jsonb) owner to postgres;
-- The publication guard is re-created above (R4); `create or replace` preserves its ACL, so
-- this re-asserts C.8's posture rather than widening it: owner postgres, revoked from public
-- and anon, and — crucially — NOT revoked from `authenticated`, which keeps C.8's grant.
alter function public.publish_builder_landing(uuid, bigint, text) owner to postgres;

revoke all on function private.builder_landing_projection_region_id(text, integer) from public, anon, authenticated, service_role;
revoke all on function private.builder_landing_style_is_valid(jsonb) from public, anon, authenticated, service_role;
revoke all on function private.builder_landing_responsive_style_is_valid(jsonb) from public, anon, authenticated, service_role;
revoke all on function private.builder_landing_document_pattern_v2_is_valid(jsonb) from public, anon, authenticated, service_role;
revoke all on function private.builder_landing_document_block_v2_is_valid(jsonb) from public, anon, authenticated, service_role;
revoke all on function private.builder_landing_document_v2_projection(jsonb) from public, anon, authenticated, service_role;
revoke all on function private.builder_landing_document_v2_is_valid(jsonb) from public, anon, authenticated, service_role;
revoke all on function private.builder_document_is_valid(jsonb) from public, anon, authenticated, service_role;
revoke all on function public.publish_builder_landing(uuid, bigint, text) from public, anon;

-- ---------------------------------------------------------------------------
-- 7. Commit.
--
--    Everything above is one transaction. If any statement failed — the preflight, the
--    constraint replacement, or an intentionally injected late failure — the database is
--    left exactly as it was before this file ran: C.8's constraint, C.8's validators, no
--    `private.builder_document_is_valid`, no projection, no new helpers. The atomicity
--    suite (`scripts/builder-repair-atomicity.ps1`) measures that property on a seeded
--    database rather than asserting it.
-- ---------------------------------------------------------------------------
commit;

-- ORVESEN Builder — schema v2 persistence (C.8)
--
-- WHY THIS MIGRATION EXISTS
-- -------------------------
-- Builder schema v2 puts a Section's content in `composition[]` (Pattern nodes and
-- independent Blocks) instead of `regions[]`. Every server-side persistence path was
-- written before that model existed and assumed v1 in three independent ways:
--
--   1. `save_builder_asset_draft` rejected `requested_schema_version <> 1`;
--   2. `builder_asset_drafts` and `builder_asset_versions` carried
--      `schema_version = 1` column checks plus v1-validator document checks;
--   3. form/dependency traversal walked `section -> regions -> blocks` only.
--
-- The result was that the client could produce a valid v2 document and the database
-- would reject it with BUILDER_DOCUMENT_INVALID, so v2 edits never persisted.
--
-- This migration adds a v2-aware validator and routes every persistence path through a
-- shared dispatcher. It does NOT touch historical migrations, does NOT rewrite stored
-- documents, and does NOT migrate any v1 draft to v2. Opening and saving an untouched
-- v1 page keeps it v1.
--
-- VALIDATION ARCHITECTURE
-- -----------------------
--   private.builder_landing_document_block_v2_is_valid(jsonb)      one Block
--   private.builder_landing_document_pattern_v2_is_valid(jsonb)    one Pattern node
--   private.builder_landing_document_v2_is_valid(jsonb)            a whole v2 document
--   private.builder_landing_document_is_valid(jsonb)               version dispatcher
--
-- The v2 validator duplicates NO v1 rule. It enforces the v2-specific structure and the
-- v2-specific section rules, then PROJECTS the document onto a legacy-safe shape and
-- delegates the delegated rule families to the already-deployed v1 validator:
--
--   * a Pattern node's own Regions and Blocks are delegated BY REFERENCE, so region
--     shape, block shape, block content, style values, responsive overrides, the
--     500-block limit and cross-node duplicate ids are the v1 implementation's job;
--   * the document envelope, `settings`, `seo` and `design_system` are delegated as a,
--     copy so the server's most complex and most security-sensitive validation exists
--     exactly once;
--   * an independent composition Block is validated by the shared block validator, which
--     is the same rule set the client applies to the same object.
--
-- A v2 Section is checked against the v2 key set BEFORE projection (`label` and `anchor`
-- are legal on a v2 Section but not on a v1 one), so no v2 document is ever rejected by a
-- v1-shaped allowlist, and no v1 document can be smuggled through as v2.

-- ---------------------------------------------------------------------------
-- 1. Block validator, shared by both schema versions
--
-- The rule set matches the client's `validateBlockNode` (landingComposition.js):
-- closed keys, uuid id, known type with the block's own schema version, object content,
-- a bounded style and a bounded responsive. It is deliberately identical to the
-- delegation the v1 validator already performs for the same object, so a block cannot
-- become valid in v2 while being invalid in v1.
-- ---------------------------------------------------------------------------

create or replace function private.builder_landing_document_block_v2_is_valid(block jsonb)
returns boolean
language sql
immutable
security invoker
set search_path = ''
as $$
  select block is not null
    and jsonb_typeof(block) = 'object'
    -- Closed key set. `id,type,schema_version,content,style,responsive`.
    and not exists (
      select 1 from jsonb_object_keys(block) key
      where key <> all(array['id','type','schema_version','content','style','responsive'])
    )
    and coalesce(block->>'id','') ~*
      '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    and block->>'type' = any(array[
      'heading','text','image','action_group','form_reference','logo','feature_item',
      'stat','testimonial','video','pricing_card','faq_item','divider','spacer','social_links'
    ])
    and block->>'schema_version' = '1'
    and jsonb_typeof(block->'content') = 'object'
    -- Style: same key set the v1 validator enforces, so the value rules it applies are
    -- reached for both versions.
    and (
      not (block ? 'style')
      or (
        jsonb_typeof(block->'style') = 'object'
        and not exists (
          select 1 from jsonb_object_keys(block->'style') key
          where key <> all(array[
            'background','color','spacing','radius','content_width','align','text_variant',
            'text_size','text_weight','font_family','max_width','border','shadow',
            'padding_top','padding_bottom'
          ])
        )
      )
    )
    -- Responsive: the client's RESPONSIVE_KEYS plus the RESPONSIVE_STYLE_KEYS the v1
    -- validator itself accepts inside a breakpoint.
    and (
      not (block ? 'responsive')
      or (
        jsonb_typeof(block->'responsive') = 'object'
        and not exists (
          select 1 from jsonb_object_keys(block->'responsive') key
          where key <> all(array['tablet','mobile'])
        )
        and not exists (
          select 1 from jsonb_each(block->'responsive') as bp(bk, bv)
          where jsonb_typeof(bp.bv) <> 'object'
             or exists (
               select 1 from jsonb_object_keys(bp.bv) key
               where key <> all(array[
                 'layout','span','align','spacing','hidden','padding_top','padding_bottom',
                 'content_width','max_width','text_variant','text_size','text_weight','font_family'
               ])
             )
        )
      )
    );
$$;

-- ---------------------------------------------------------------------------
-- 2. Pattern-node validator
--
-- Mirrors the client's `validatePatternNode`: closed keys, uuid id, an identity string,
-- a layout, a bounded responsive whose breakpoints carry the PATTERN responsive keys, a
-- style, and 1..12 Regions whose spans total 12 when the layout is `columns`.
-- ---------------------------------------------------------------------------

create or replace function private.builder_landing_document_pattern_v2_is_valid(node jsonb)
returns boolean
language plpgsql
immutable
security invoker
set search_path = ''
as $$
declare
  r jsonb;
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

  if node->>'layout' not in ('stack','columns') then return false; end if;

  if node ? 'style' then
    if jsonb_typeof(node->'style') <> 'object'
       or exists (
         select 1 from jsonb_object_keys(node->'style') key
         where key <> all(array[
           'background','color','spacing','radius','content_width','align','text_variant',
           'text_size','text_weight','font_family','max_width','border','shadow',
           'padding_top','padding_bottom'
         ])
       )
    then return false; end if;
  end if;

  if node ? 'responsive' then
    if jsonb_typeof(node->'responsive') <> 'object'
       or exists (
         select 1 from jsonb_object_keys(node->'responsive') key
         where key <> all(array['tablet','mobile'])
       )
    then return false; end if;
    -- PATTERN responsive keys (PATTERN_RESPONSIVE_KEYS in landingComposition.js).
    if exists (
      select 1 from jsonb_each(node->'responsive') as bp(bk, bv)
      where jsonb_typeof(bp.bv) <> 'object'
         or exists (
           select 1 from jsonb_object_keys(bp.bv) key
           where key <> all(array['layout','align','spacing','hidden','padding_top','padding_bottom'])
         )
    ) then return false; end if;
  end if;

  if jsonb_typeof(node->'regions') <> 'array' then return false; end if;
  for r in select value from jsonb_array_elements(node->'regions') loop
    region_count := region_count + 1;
    if region_count > 12 then return false; end if;
    if jsonb_typeof(r) <> 'object'
       or exists (
         select 1 from jsonb_object_keys(r) key
         where key <> all(array['id','span','blocks'])
       )
       or coalesce(r->>'id','') !~*
         '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       or jsonb_typeof(r->'span') <> 'number'
       or (r->>'span')::numeric <> trunc((r->>'span')::numeric)
       or (r->>'span')::integer not between 1 and 12
       or jsonb_typeof(r->'blocks') <> 'array'
    then return false; end if;
    spans := spans + (r->>'span')::integer;
  end loop;

  if region_count < 1 then return false; end if;
  if node->>'layout' = 'columns' and spans <> 12 then return false; end if;
  return true;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Schema v2 document validator
-- ---------------------------------------------------------------------------

create or replace function private.builder_landing_document_v2_is_valid(candidate jsonb)
returns boolean
language plpgsql
immutable
security invoker
set search_path = ''
as $$
declare
  s jsonb; node jsonb; blk jsonb; r jsonb; b jsonb;
  ids text[] := array[]::text[];
  ident text;
  legacy_sections jsonb := '[]'::jsonb;
  legacy_region jsonb;
  rebuilt jsonb;
  section_count integer := 0;
  pattern_count integer := 0;
  block_count integer := 0;
  composition_count integer;
  spans integer;
  layout_value text;
  dedicated boolean;
  has_composition boolean;
begin
  if candidate is null or jsonb_typeof(candidate) <> 'object' then return false; end if;
  -- Delegated to the v1 validator, but the size ceiling has to hold for v2 as well.
  if pg_column_size(candidate) > 524288 then return false; end if;

  -- --- Envelope -----------------------------------------------------------
  if candidate->>'schema_version' <> '2' then return false; end if;
  if candidate->>'document_type' <> 'landing_page' then return false; end if;
  if exists (
    select 1 from jsonb_object_keys(candidate) key
    where key <> all(array['schema_version','document_type','locale','settings','sections'])
  ) then return false; end if;
  if jsonb_typeof(candidate->'sections') <> 'array' then return false; end if;
  if jsonb_array_length(candidate->'sections') > 50 then return false; end if;

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

    if s->>'layout' not in ('stack','columns') then return false; end if;
    if s ? 'label' and (jsonb_typeof(s->'label') <> 'string' or char_length(s->>'label') > 120) then return false; end if;
    if s ? 'anchor' and (jsonb_typeof(s->'anchor') <> 'string' or s->>'anchor' !~ '^[a-z0-9]+(-[a-z0-9]+)*$') then return false; end if;

    if s ? 'style' then
      if jsonb_typeof(s->'style') <> 'object'
         or exists (
           select 1 from jsonb_object_keys(s->'style') key
           where key <> all(array[
             'background','color','spacing','radius','content_width','align','text_variant',
             'text_size','text_weight','font_family','max_width','border','shadow',
             'padding_top','padding_bottom'
           ])
         )
      then return false; end if;
      -- Style ownership (D3): the AREA owns page-level style; width and alignment are
      -- the Pattern's, so the area may not declare them. Mirrors
      -- PATTERN_OWNED_STYLE_KEYS + PATTERN_STYLE_OWNED_BY_NODE.
      if (s->'style') ? 'content_width' or (s->'style') ? 'align' then return false; end if;
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
      ) then return false; end if;
    end if;

    if jsonb_typeof(s->'regions') <> 'array' then return false; end if;
    -- A dedicated Header/Footer Section is a protected single surface and stays a
    -- dedicated Section in both schemas; every other Section must be a composition area.
    dedicated := jsonb_array_length(s->'regions') = 1
      and jsonb_array_length(s#>'{regions,0,blocks}') = 1
      and (s#>>'{regions,0,blocks,0,type}') in ('site_header','site_footer');

    if dedicated then
      -- The whole Section is delegated, regions and blocks included.
      legacy_sections := legacy_sections || jsonb_build_array(s);
      -- Its ids still have to be counted here: the projection does not carry them.
      ident := s#>>'{regions,0,id}';
      if ident is not null then
        if ident = any(ids) then return false; end if; ids := array_append(ids, ident);
      end if;
      ident := s#>>'{regions,0,blocks,0,id}';
      if ident is not null then
        if ident = any(ids) then return false; end if; ids := array_append(ids, ident);
      end if;
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

    legacy_region := '[]'::jsonb;
    layout_value := s->>'layout';

    for node in select value from jsonb_array_elements(s->'composition') loop
      if jsonb_typeof(node) <> 'object' then return false; end if;
      ident := node->>'id'; if ident = any(ids) then return false; end if; ids := array_append(ids, ident);

      if node ? 'pattern' then
        -- --- Pattern node -------------------------------------------------
        pattern_count := pattern_count + 1;
        if pattern_count > 128 then return false; end if;
        if not private.builder_landing_document_pattern_v2_is_valid(node) then return false; end if;
        -- Its Regions join the projection BY REFERENCE (spans accumulate below), so the
        -- v1 validator applies the region/block/content/style rules to their real values.
        for r in select value from jsonb_array_elements(node->'regions') loop
          ident := r->>'id'; if ident = any(ids) then return false; end if; ids := array_append(ids, ident);
          spans := 0;
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
        legacy_region := legacy_region || (node->'regions');
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
      -- Mirrors the v1 Section rules: a stack Section holds exactly one Region, a
      -- columns Section holds between one and twelve.
      if layout_value = 'stack' and jsonb_array_length(legacy_region) >= 1 then return false; end if;
      if jsonb_array_length(legacy_region) >= 12 then return false; end if;
      legacy_region := legacy_region || jsonb_build_array(
        jsonb_build_object(
          'id', node->>'id',
          'span', case when layout_value = 'stack' then 12 else 4 end,
          'blocks', jsonb_build_array(node)
        )
      );
    end loop;

    if jsonb_array_length(legacy_region) < 1 then
      -- A composition area with no nodes at all cannot be projected onto the v1 shape,
      -- which requires at least one Region. Empty compositions are stored and remain
      -- valid for the client; the projection gives them a placeholder Region that is
      -- only ever a validation artefact and never written back to the document.
      legacy_region := jsonb_build_array(
        jsonb_build_object('id', s->>'id', 'span', 12, 'blocks', '[]'::jsonb)
      );
    end if;

    legacy_sections := legacy_sections || jsonb_build_array(
      jsonb_build_object(
        'id', s->>'id',
        'layout', layout_value,
        'regions', legacy_region
      )
      || (case when s ? 'style' then jsonb_build_object('style', s->'style') else '{}'::jsonb end)
      || (case when s ? 'responsive' then jsonb_build_object('responsive', s->'responsive') else '{}'::jsonb end)
    );
  end loop;

  -- --- Delegation to the deployed v1 validator ----------------------------
  --
  -- The envelope, `settings` (including `locale`, `seo` and `design_system`) and the
  -- delegated section/region/block rule families are validated by the single v1
  -- implementation. A copy is made because the v1 validator requires
  -- `schema_version = 1`; the copy is never persisted.
  rebuilt := jsonb_build_object(
    'schema_version', '1',
    'document_type', candidate->>'document_type',
    'locale', candidate->'locale',
    'settings', candidate->'settings',
    'sections', legacy_sections
  );
  if not private.builder_landing_document_v1_is_valid(rebuilt) then return false; end if;

  return true;
exception when others then return false;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Version dispatcher
--
-- One entry point for every persistence path. Unsupported versions fail closed.
-- ---------------------------------------------------------------------------

create or replace function private.builder_landing_document_is_valid(candidate jsonb)
returns boolean
language sql
immutable
security invoker
set search_path = ''
as $$
  select case candidate->>'schema_version'
    when '1' then private.builder_landing_document_v1_is_valid(candidate)
    when '2' then private.builder_landing_document_v2_is_valid(candidate)
    else false
  end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Form-reference traversal, shared by save and publish
--
-- v1 kept block content in `section.regions[]`; v2 keeps it in `section.composition[]`,
-- either inside a Pattern node's own Regions or as an independent Block. One traversal
-- for both shapes and both schemas, so a form reference can never be missed merely
-- because its Block moved into composition.
-- ---------------------------------------------------------------------------

create or replace function private.builder_landing_document_form_references(candidate jsonb)
returns table (form_asset_id uuid)
language sql
immutable
security invoker
set search_path = ''
as $$
  with blocks as (
    -- v1 Regions, plus the Regions of every v2 composition node (Pattern nodes carry
    -- Regions; an independent Block carries none, so this arm contributes nothing for it).
    select blk as block
    from jsonb_array_elements(coalesce(candidate->'sections', '[]'::jsonb)) as section_value(section)
    cross join lateral jsonb_array_elements(coalesce(section->'regions', '[]'::jsonb)) as region_value(region)
    cross join lateral jsonb_array_elements(coalesce(region->'blocks', '[]'::jsonb)) as block_value(blk)

    union all

    select blk as block
    from jsonb_array_elements(coalesce(candidate->'sections', '[]'::jsonb)) as section_value(section)
    cross join lateral jsonb_array_elements(coalesce(section->'composition', '[]'::jsonb)) as node_value(node)
    cross join lateral jsonb_array_elements(coalesce(node->'regions', '[]'::jsonb)) as region_value(region)
    cross join lateral jsonb_array_elements(coalesce(region->'blocks', '[]'::jsonb)) as block_value(blk)

    union all

    -- An independent composition Block is itself the Block.
    select node as block
    from jsonb_array_elements(coalesce(candidate->'sections', '[]'::jsonb)) as section_value(section)
    cross join lateral jsonb_array_elements(coalesce(section->'composition', '[]'::jsonb)) as node_value(node)
    where node ? 'type'
      and not (node ? 'regions')
  )
  select distinct (block#>>'{content,asset_id}')::uuid
  from blocks
  where block->>'type' = 'form_reference'
    and coalesce(block#>>'{content,asset_id}', '') <> ''
    and block#>'{content,asset_id}' <> 'null'::jsonb;
$$;

-- ---------------------------------------------------------------------------
-- 6. Draft document constraint: accept either valid schema version
--
-- The v1-only document and version checks are dropped BY DEFINITION rather than by
-- guessed name: both were created inline, so their names come from Postgres defaults and
-- a `drop constraint if exists <guess>` would silently no-op and leave the v1-only rule
-- in force. Dropping by definition is name-agnostic and therefore correct regardless of
-- how the constraint was originally named.
-- ---------------------------------------------------------------------------

do $migration$
declare
  target record;
begin
  for target in
    select con.conname
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
    where nsp.nspname = 'public'
      and rel.relname = 'builder_asset_drafts'
      and con.contype = 'c'
      and (
        pg_get_constraintdef(con.oid) ilike '%builder_landing_document_v1_is_valid%'
        or pg_get_constraintdef(con.oid) ilike '%schema_version = 1%'
      )
  loop
    execute format('alter table public.builder_asset_drafts drop constraint %I', target.conname);
  end loop;
end
$migration$;

alter table public.builder_asset_drafts add constraint builder_asset_drafts_document_check
  check (private.builder_landing_document_is_valid(document));

-- The stored version must agree with the document it describes, in both versions.
alter table public.builder_asset_drafts add constraint builder_asset_drafts_document_version_check
  check ((document->>'schema_version')::integer = schema_version);

-- ---------------------------------------------------------------------------
-- 7. Version document constraint
--
-- Published versions are immutable snapshots of a draft, so they must accept both
-- versions too, or publishing a valid v2 draft would fail at the insert.
-- ---------------------------------------------------------------------------

do $migration$
declare
  target record;
begin
  for target in
    select con.conname
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
    where nsp.nspname = 'public'
      and rel.relname = 'builder_asset_versions'
      and con.contype = 'c'
      and pg_get_constraintdef(con.oid) ilike '%schema_version = 1%'
  loop
    execute format('alter table public.builder_asset_versions drop constraint %I', target.conname);
  end loop;
end
$migration$;

alter table public.builder_asset_versions add constraint builder_asset_versions_schema_version_check
  check (schema_version in (1, 2));

-- The version's document must declare the version its column claims. This mirrors the
-- pre-existing inline check, which required exactly that.
alter table public.builder_asset_versions add constraint builder_asset_versions_document_version_check
  check (
    jsonb_typeof(document) = 'object'
    and jsonb_typeof(document -> 'schema_version') = 'number'
    and (document ->> 'schema_version')::integer = schema_version
  );

-- ---------------------------------------------------------------------------
-- 8. save_builder_asset_draft — accept v1 and v2
--
-- Every guarantee of the v1 implementation is preserved: authentication, organization
-- isolation, asset ownership, asset type/lifecycle, revision checking with optimistic
-- concurrency, BUILDER_DRAFT_CONFLICT, form-reference validation and dependency rebuild.
-- Only the version gate and the traversal changed.
-- ---------------------------------------------------------------------------

create or replace function public.save_builder_asset_draft(
  target_asset_id uuid,
  expected_revision bigint,
  requested_schema_version integer,
  requested_document jsonb
)
returns public.builder_asset_drafts
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  caller_organization_id uuid := public.current_user_organization_id();
  target_asset public.builder_assets;
  saved_draft public.builder_asset_drafts;
  referenced_form_id uuid;
begin
  if caller_id is null or caller_organization_id is null then raise exception using errcode = '42501', message = 'BUILDER_ACCESS_DENIED'; end if;
  select asset.* into target_asset from public.builder_assets asset
  where asset.id = target_asset_id and asset.organization_id = caller_organization_id for update;
  if target_asset.id is null or not public.can_manage_organization(target_asset.organization_id) then raise exception using errcode = '42501', message = 'BUILDER_ACCESS_DENIED'; end if;
  if target_asset.asset_type <> 'landing_page' or target_asset.lifecycle <> 'draft' then raise exception using errcode = '23514', message = 'BUILDER_DRAFT_ASSET_INVALID'; end if;

  -- The declared version must be a supported version AND must agree with the document it
  -- describes, so a caller cannot label a v2 document as v1 (or the reverse) to slip past
  -- the wrong validator.
  if requested_schema_version is null or requested_schema_version not in (1, 2) then
    raise exception using errcode = '22023', message = 'BUILDER_DOCUMENT_INVALID';
  end if;
  if coalesce(requested_document->>'schema_version', '') <> requested_schema_version::text then
    raise exception using errcode = '22023', message = 'BUILDER_DOCUMENT_INVALID';
  end if;
  if not private.builder_landing_document_is_valid(requested_document) then
    raise exception using errcode = '22023', message = 'BUILDER_DOCUMENT_INVALID';
  end if;

  for referenced_form_id in
    select reference.form_asset_id from private.builder_landing_document_form_references(requested_document) reference
  loop
    if not exists (
      select 1 from public.builder_assets form_asset
      where form_asset.id = referenced_form_id and form_asset.organization_id = target_asset.organization_id
        and form_asset.asset_type = 'form' and form_asset.lifecycle = 'draft'
    ) then raise exception using errcode = '23514', message = 'BUILDER_FORM_REFERENCE_INVALID'; end if;
  end loop;

  update public.builder_asset_drafts draft
  set document = requested_document, schema_version = requested_schema_version,
      revision = draft.revision + 1, updated_by = caller_id, updated_at = now()
  where draft.asset_id = target_asset.id and draft.organization_id = target_asset.organization_id
    and draft.revision = expected_revision
  returning * into saved_draft;
  if saved_draft.asset_id is null then
    if exists (select 1 from public.builder_asset_drafts draft where draft.asset_id = target_asset.id) then
      raise exception using errcode = '40001', message = 'BUILDER_DRAFT_CONFLICT';
    end if;
    raise exception using errcode = 'P0002', message = 'BUILDER_DRAFT_NOT_FOUND';
  end if;
  delete from public.builder_asset_dependencies dependency
  where dependency.organization_id = target_asset.organization_id and dependency.source_asset_id = target_asset.id;
  insert into public.builder_asset_dependencies (organization_id, source_asset_id, target_asset_id, dependency_type)
  select distinct target_asset.organization_id, target_asset.id, reference.form_asset_id, 'form_reference'
  from private.builder_landing_document_form_references(requested_document) reference;
  return saved_draft;
end;
$$;

-- ---------------------------------------------------------------------------
-- 9. publish_builder_landing — accept v1 and v2
--
-- Without this, a v2 draft would save and then fail to publish, or publish with its
-- composition stripped. Only the version gate, the traversal and the read predicate
-- changed; slug handling, version numbering and the immutability contract are untouched.
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
  -- exactly as at save time.
  if target_draft.schema_version not in (1, 2)
     or coalesce(target_draft.document->>'schema_version', '') <> target_draft.schema_version::text
     or not private.builder_landing_document_is_valid(target_draft.document)
     or not private.builder_landing_publication_metadata_v1_is_valid(target_draft.document) then
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
-- 10. get_published_builder_landing — read either version
--
-- The read predicate also required v1, so an already-published v2 page would return no
-- rows and the public site would 404.
-- ---------------------------------------------------------------------------

create or replace function public.get_published_builder_landing(requested_public_slug text)
returns table (public_slug text, document jsonb, published_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select asset.public_slug, version.document, asset.published_at
  from public.builder_assets asset
  join public.builder_asset_versions version
    on version.id = asset.published_version_id
   and version.asset_id = asset.id
   and version.organization_id = asset.organization_id
   and version.state = 'published'
  where requested_public_slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'
    and asset.public_slug = requested_public_slug
    and asset.asset_type = 'landing_page'
    and asset.lifecycle = 'draft'
    and asset.published_version_id is not null
    and version.schema_version in (1, 2)
    and private.builder_landing_document_is_valid(version.document)
    and private.builder_landing_publication_metadata_v1_is_valid(version.document)
  limit 1;
$$;

-- ---------------------------------------------------------------------------
-- 11. Ownership and grants
--
-- Same shape as the existing functions: owned by postgres, executable only by the
-- roles that already had access. The v2 helpers are private and are revoked from every
-- client role, so no generic write or validation endpoint is exposed.
-- ---------------------------------------------------------------------------

alter function private.builder_landing_document_block_v2_is_valid(jsonb) owner to postgres;
alter function private.builder_landing_document_pattern_v2_is_valid(jsonb) owner to postgres;
alter function private.builder_landing_document_v2_is_valid(jsonb) owner to postgres;
alter function private.builder_landing_document_is_valid(jsonb) owner to postgres;
alter function private.builder_landing_document_form_references(jsonb) owner to postgres;
alter function public.save_builder_asset_draft(uuid, bigint, integer, jsonb) owner to postgres;
alter function public.publish_builder_landing(uuid, bigint, text) owner to postgres;
alter function public.get_published_builder_landing(text) owner to postgres;

revoke all on function private.builder_landing_document_block_v2_is_valid(jsonb) from public, anon, authenticated, service_role;
revoke all on function private.builder_landing_document_pattern_v2_is_valid(jsonb) from public, anon, authenticated, service_role;
revoke all on function private.builder_landing_document_v2_is_valid(jsonb) from public, anon, authenticated, service_role;
revoke all on function private.builder_landing_document_is_valid(jsonb) from public, anon, authenticated, service_role;
revoke all on function private.builder_landing_document_form_references(jsonb) from public, anon, authenticated, service_role;
revoke all on function public.save_builder_asset_draft(uuid, bigint, integer, jsonb) from public, anon;
revoke all on function public.publish_builder_landing(uuid, bigint, text) from public, anon;
revoke all on function public.get_published_builder_landing(text) from public;

grant execute on function public.save_builder_asset_draft(uuid, bigint, integer, jsonb) to authenticated;
grant execute on function public.publish_builder_landing(uuid, bigint, text) to authenticated;
grant execute on function public.get_published_builder_landing(text) to anon, authenticated;

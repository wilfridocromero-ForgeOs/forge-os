// Landing composition model (schema v2) and the explicit v1 -> v2 migration.
//
// Why this module exists
// ----------------------
// In schema v1 a Section is overloaded three ways: the page's structural unit, the
// page's *visual* unit (background, content width, padding, spacing), and — because
// `createLandingPattern` expands to a plain Section — the identity of a Pattern.
// Because a Section is the only node that can be the parent of a Region, and a
// Region is the only node that can be the parent of a Block, an individual element
// used to have exactly two possible homes: inside a Pattern's Region (so the
// Pattern owns it), or inside a Section of its own (so it renders as a whole
// page-sized visual band).
//
// Schema v2 adds the missing composition layer:
//
//   Document
//     sections[]
//       Section                         the *visual composition area*: page rhythm,
//         composition[]                 background, border, radius, shadow
//           PatternNode                 a reusable composition: pattern_id plus its
//             regions[]                 own layout, style and responsive
//               blocks[]
//           Block                       an independent primitive, first-class
//           Block
//           PatternNode
//
// Responsibilities after v2:
//   Section     page-level visual area + ordered composition
//   PatternNode reusable composition (owns its regions, layout, width, align, rhythm)
//   Region      layout structure *inside* a Pattern
//   Block       independent primitive
//
// This module owns the v2 node vocabulary, the composition validator and the pure
// migration. It deliberately does not render, persist or transport anything: it is
// the model layer only (Increment A). The live editor, drag/drop, renderer and
// autosave keep working on the v1 shape until later increments move them.
//
// It is standalone on purpose: the canonical key sets, block registry and style
// validators live in `landingDocument.js`, and this module receives them from there
// (see `configureLandingComposition`). That keeps the dependency one-way and avoids
// an import cycle between the document validator and the composition model.

export const LANDING_SCHEMA_VERSION_V1 = 1;
export const LANDING_SCHEMA_VERSION_V2 = 2;

const ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const validId = (value) => typeof value === "string" && ID_PATTERN.test(value);
const plainObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const ownKeysValid = (value, allowed) => Object.keys(value).every((key) => allowed.has(key));
const clone = (value) => structuredClone(value);

// Generic RFC-4122 v4 id, used only when a caller supplies no id factory. It is the
// same shape `createBuilderId()` produces, so a migrated document validates
// wherever a directly created one does.
const randomDocumentId = () => {
  if (typeof globalThis.crypto?.randomUUID === "function") return globalThis.crypto.randomUUID();
  const bytes = new Uint8Array(16);
  if (typeof globalThis.crypto?.getRandomValues === "function") globalThis.crypto.getRandomValues(bytes);
  else for (let index = 0; index < bytes.length; index += 1) bytes[index] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, "0"));
  return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10).join("")}`;
};

// ---------------------------------------------------------------------------
// Node vocabulary
// ---------------------------------------------------------------------------

// `pattern` is the composition node's identity. It is deliberately never guessed:
// a migrated legacy Section cannot be proven equivalent to a catalog Pattern, so it
// receives an explicit legacy identity instead of a catalog pattern_id.
export const LEGACY_PATTERN_PREFIX = "legacy:";

// A composition node is one of two things. The `pattern` key is what decides which,
// so the two shapes stay decidable without inspecting the body.
export const PATTERN_NODE_KEYS = new Set(["id", "pattern", "layout", "style", "responsive", "regions"]);

// The breakpoints a Pattern node may override. The OUTER keys of `responsive` are
// breakpoints; `PATTERN_RESPONSIVE_KEYS` describes what may be overridden INSIDE each
// one. Conflating the two rejected every real override, which also made the
// corresponding test vacuous: it only asserted the failure case.
export const PATTERN_RESPONSIVE_BREAKPOINTS = new Set(["tablet", "mobile"]);

// A Pattern node owns its own responsive behaviour, exactly as a v1 Pattern Section
// did, so migration carries it across unchanged.
export const PATTERN_RESPONSIVE_KEYS = new Set(["layout", "align", "spacing", "hidden", "padding_top", "padding_bottom"]);

// Style ownership after D3: these belong to a Pattern node, so a v2 composition
// Section may not also declare them. One visual property, one owner — otherwise a
// later v2 renderer would apply the same width/alignment twice.
//
// Scope, corrected in Increment C.2: a Pattern owns its own WIDTH and ALIGNMENT, which
// is what "the Pattern is the reusable visual module" means. It does NOT own the page's
// vertical RHYTHM. `padding_top` / `padding_bottom` / `spacing` stay on the composition
// AREA, because after v2 an area can hold several nodes: the page rhythm belongs to the
// page area, between areas and around them, not to one Pattern inside it. Keeping them
// pattern-owned made the read layer resolve the migrated Section's own rhythm away — the
// markup then advertised no `data-padding-top` at all, so a v2 page silently lost the
// vertical rhythm the v1 page had (the "migrated Pattern must not get SHORTER" half of
// the same rule that says it must not get taller).
export const PATTERN_OWNED_STYLE_KEYS = Object.freeze(["content_width", "align"]);

export const COMPOSITION_ERROR = Object.freeze({
  COMPOSITION_REQUIRED: "COMPOSITION_REQUIRED",
  COMPOSITION_EMPTY: "COMPOSITION_EMPTY",
  MAX_COMPOSITION_NODES: "MAX_COMPOSITION_NODES",
  MAX_PATTERNS: "MAX_PATTERNS",
  INVALID_COMPOSITION_NODE: "INVALID_COMPOSITION_NODE",
  INVALID_PATTERN_NODE: "INVALID_PATTERN_NODE",
  INVALID_PATTERN_IDENTITY: "INVALID_PATTERN_IDENTITY",
  INVALID_PATTERN_LAYOUT: "INVALID_PATTERN_LAYOUT",
  INVALID_PATTERN_RESPONSIVE: "INVALID_PATTERN_RESPONSIVE",
  INVALID_PATTERN_REGIONS: "INVALID_PATTERN_REGIONS",
  INVALID_PATTERN_REGION: "INVALID_PATTERN_REGION",
  PATTERN_STYLE_OWNED_BY_NODE: "PATTERN_STYLE_OWNED_BY_NODE",
  DEDICATED_SURFACE_NOT_IN_COMPOSITION: "DEDICATED_SURFACE_NOT_IN_COMPOSITION",
  MIXED_SCHEMA_SHAPES: "MIXED_SCHEMA_SHAPES",
  COMPOSITION_IN_V1: "COMPOSITION_IN_V1",
  LEGACY_REGIONS_IN_V2: "LEGACY_REGIONS_IN_V2",
});

export const compositionMessage = (code) => ({
  [COMPOSITION_ERROR.COMPOSITION_REQUIRED]: "Una sección v2 necesita una composición.",
  [COMPOSITION_ERROR.COMPOSITION_EMPTY]: "Una composición no puede estar vacía.",
  [COMPOSITION_ERROR.MAX_COMPOSITION_NODES]: "La composición supera el máximo de elementos.",
  [COMPOSITION_ERROR.MAX_PATTERNS]: "La página supera el máximo de Patterns.",
  [COMPOSITION_ERROR.INVALID_COMPOSITION_NODE]: "La composición contiene un nodo no válido.",
  [COMPOSITION_ERROR.INVALID_PATTERN_NODE]: "El nodo Pattern no es válido.",
  [COMPOSITION_ERROR.INVALID_PATTERN_IDENTITY]: "El Pattern no tiene una identidad válida.",
  [COMPOSITION_ERROR.INVALID_PATTERN_LAYOUT]: "El layout del Pattern no es válido.",
  [COMPOSITION_ERROR.INVALID_PATTERN_RESPONSIVE]: "La respuesta responsive del Pattern no es válida.",
  [COMPOSITION_ERROR.INVALID_PATTERN_REGIONS]: "Las regiones del Pattern no son válidas.",
  [COMPOSITION_ERROR.INVALID_PATTERN_REGION]: "Una región del Pattern no es válida.",
  [COMPOSITION_ERROR.PATTERN_STYLE_OWNED_BY_NODE]: "Ese estilo pertenece al Pattern, no al área.",
  [COMPOSITION_ERROR.DEDICATED_SURFACE_NOT_IN_COMPOSITION]: "El Header y el Footer tienen su propia sección.",
  [COMPOSITION_ERROR.MIXED_SCHEMA_SHAPES]: "El documento mezcla la forma v1 y la forma v2.",
  [COMPOSITION_ERROR.COMPOSITION_IN_V1]: "Un documento v1 no puede declarar composición.",
  [COMPOSITION_ERROR.LEGACY_REGIONS_IN_V2]: "Una sección v2 no puede declarar regiones propias.",
}[code] || "La composición del documento no es válida.");

// ---------------------------------------------------------------------------
// Wiring: the document validator injects its canonical rules exactly once.
// ---------------------------------------------------------------------------

const RULES = {
  blockKeys: null,
  regionKeys: null,
  blockRegistry: null,
  validateStyle: null,
  validateResponsive: null,
  limits: null,
};

export function configureLandingComposition(rules) {
  if (!plainObject(rules)) throw new Error("BUILDER_COMPOSITION_RULES_REQUIRED");
  for (const key of Object.keys(RULES)) {
    if (rules[key] === undefined || rules[key] === null) throw new Error(`BUILDER_COMPOSITION_RULE_MISSING:${key}`);
  }
  Object.assign(RULES, rules);
  return true;
}

export const compositionRulesConfigured = () => Object.values(RULES).every((value) => value !== null && value !== undefined);

// ---------------------------------------------------------------------------
// D4 — one boundary, one owner
//
// The canonical owner of the boundary shared by two adjacent composition nodes is
// the FOLLOWING node: the edge above node i means "insert before node i". Node 0
// therefore owns no leading boundary, and the end of the composition is the
// Section's trailing boundary. Ordering then reads forward only, which removes the
// two-owner seam that made a drop's direction ambiguous.
//
// The live drop system still uses the v1 targets; these helpers exist so later
// increments have exactly one place to compute boundary ownership from.
// ---------------------------------------------------------------------------

export function compositionBoundaryOwner(composition, index) {
  if (!Array.isArray(composition)) return null;
  if (!Number.isInteger(index) || index < 1 || index >= composition.length) return null;
  return composition[index];
}

export function compositionIndexForNode(composition, nodeId) {
  if (!Array.isArray(composition) || typeof nodeId !== "string" || !nodeId) return null;
  const index = composition.findIndex((node) => node?.id === nodeId);
  return index < 0 ? null : index;
}

export const compositionNodeIds = (composition) => (Array.isArray(composition) ? composition : [])
  .map((node) => (plainObject(node) && typeof node.id === "string" ? node.id : null))
  .filter(Boolean);

// ---------------------------------------------------------------------------
// Node predicates and constructors
// ---------------------------------------------------------------------------

export const isPatternCompositionNode = (node) => plainObject(node)
  && Object.prototype.hasOwnProperty.call(node, "pattern")
  && Array.isArray(node.regions);

export const isBlockCompositionNode = (node) => plainObject(node)
  && typeof node.type === "string"
  && !Object.prototype.hasOwnProperty.call(node, "pattern");

export const isDedicatedSurfaceBlock = (block) => block?.type === "site_header" || block?.type === "site_footer";

export const isLegacyPatternIdentity = (pattern) => typeof pattern === "string" && pattern.startsWith(LEGACY_PATTERN_PREFIX);

export const legacyIdentityForSection = (sectionId) => `${LEGACY_PATTERN_PREFIX}${sectionId}`;

// A Section is a *composition area* when it declares `composition`. A v1 Section
// keeps `regions` and no `composition`; the two shapes are never mixed.
export const isCompositionSection = (section) => plainObject(section)
  && Object.prototype.hasOwnProperty.call(section, "composition");

// Wrap an existing pattern (anything shaped like a v1 Pattern Section: layout,
// regions, optional style/responsive) as a first-class composition node.
//
// An identity is never invented when the pattern already has one. `createId` is
// injected so the caller controls id generation (migration passes its own so a
// migration run is reproducible).
export function toPatternNode(pattern, patternId, { createId = randomDocumentId } = {}) {
  if (!pattern || typeof pattern !== "object") throw new Error("BUILDER_PATTERN_REQUIRED");
  if (typeof patternId !== "string" || !patternId.length) throw new Error("BUILDER_PATTERN_ID_REQUIRED");
  if (!Array.isArray(pattern.regions) || !pattern.regions.length) throw new Error("BUILDER_PATTERN_REGIONS_REQUIRED");
  const id = typeof pattern.id === "string" && pattern.id
    ? pattern.id
    : typeof createId === "function" ? createId() : null;
  if (typeof id !== "string" || !id.length) throw new Error("BUILDER_PATTERN_NODE_ID_REQUIRED");
  const style = splitPatternStyle(pattern.style).patternStyle;
  return {
    id,
    pattern: patternId,
    // The node owns responsive behaviour (including its internal layout), because
    // that is what describes the composition rather than the page area.
    layout: pattern.layout === "columns" ? "columns" : "stack",
    // D3: only the PATTERN-owned style travels with the node. A catalog pattern is
    // authored as a v1 Section, so its `style` also carries page-level rhythm; keeping
    // those keys on the node would claim the very properties the AREA owns, and the read
    // layer resolves ownership by key — so a wrapped Pattern would silently blank out the
    // area's own page rhythm. The split is shared with migration so both paths agree.
    ...(style !== undefined ? { style } : {}),
    ...(pattern.responsive !== undefined ? { responsive: clone(pattern.responsive) } : {}),
    regions: clone(pattern.regions),
  };
}

// A composition area containing exactly the given nodes, in order. Kept here so the
// shape of a migrated/new area is written down in exactly one place.
export const createCompositionSection = (nodes, { id, layout = "stack", ...rest } = {}) => ({
  id,
  layout,
  regions: [],
  composition: clone(nodes),
  ...rest,
});

// ---------------------------------------------------------------------------
// Composition validation
//
// Reuses the existing Block registry/version/style/responsive rules verbatim and
// the existing Region rules (span 1..12, spans total 12 for columns, one region per
// stack), so v2 cannot drift from what Patterns already guarantee.
// ---------------------------------------------------------------------------

export function validatePatternRegions(regions, layout, errors, path) {
  if (!Array.isArray(regions) || regions.length < 1 || regions.length > 12) {
    errors.push({ path, code: COMPOSITION_ERROR.INVALID_PATTERN_REGIONS });
    return { spans: 0, blocks: 0, regionIds: [] };
  }
  if (layout === "stack" && regions.length !== 1) {
    errors.push({ path, code: "STACK_REQUIRES_ONE_REGION" });
  }
  let spans = 0;
  let blocks = 0;
  const regionIds = [];
  for (const [index, region] of regions.entries()) {
    const regionPath = `${path}.${index}`;
    if (!plainObject(region) || !ownKeysValid(region, RULES.regionKeys) || !validId(region.id)
      || !Number.isInteger(region.span) || region.span < 1 || region.span > 12
      || !Array.isArray(region.blocks)) {
      errors.push({ path: regionPath, code: COMPOSITION_ERROR.INVALID_PATTERN_REGION });
      continue;
    }
    spans += region.span;
    regionIds.push(region.id);
    blocks += region.blocks.length;
  }
  if (layout === "columns" && spans !== 12) {
    errors.push({ path, code: "COLUMN_SPANS_MUST_TOTAL_12" });
  }
  return { spans, blocks, regionIds };
}

// Validate one independent primitive, with exactly the rules a v1 Block already has.
export function validateBlockNode(block, errors, path) {
  if (!plainObject(block) || !ownKeysValid(block, RULES.blockKeys) || !validId(block.id)) {
    errors.push({ path, code: "INVALID_BLOCK" });
    return false;
  }
  const definition = RULES.blockRegistry[block.type];
  if (!definition) {
    errors.push({ path: `${path}.type`, code: "UNKNOWN_BLOCK" });
  } else if (block.schema_version !== definition.version) {
    errors.push({ path: `${path}.schema_version`, code: "INVALID_BLOCK_VERSION" });
  } else {
    definition.validate(block.content, errors, `${path}.content`);
  }
  RULES.validateStyle(block.style, errors, `${path}.style`);
  RULES.validateResponsive(block.responsive, errors, `${path}.responsive`);
  return true;
}

function validatePatternNode(node, errors, path) {
  if (!plainObject(node) || !ownKeysValid(node, PATTERN_NODE_KEYS) || !validId(node.id)) {
    errors.push({ path, code: COMPOSITION_ERROR.INVALID_PATTERN_NODE });
    return;
  }
  if (typeof node.pattern !== "string" || !node.pattern.length || node.pattern.length > 120) {
    errors.push({ path: `${path}.pattern`, code: COMPOSITION_ERROR.INVALID_PATTERN_IDENTITY });
  }
  if (!["stack", "columns"].includes(node.layout)) {
    errors.push({ path: `${path}.layout`, code: COMPOSITION_ERROR.INVALID_PATTERN_LAYOUT });
  }
  if (node.responsive !== undefined) {
    if (!plainObject(node.responsive) || !ownKeysValid(node.responsive, PATTERN_RESPONSIVE_BREAKPOINTS)) {
      errors.push({ path: `${path}.responsive`, code: COMPOSITION_ERROR.INVALID_PATTERN_RESPONSIVE });
    } else {
      // Each breakpoint's override is checked against the pattern-level style keys.
      for (const [breakpoint, override] of Object.entries(node.responsive)) {
        if (!plainObject(override) || !ownKeysValid(override, PATTERN_RESPONSIVE_KEYS)) {
          errors.push({ path: `${path}.responsive.${breakpoint}`, code: COMPOSITION_ERROR.INVALID_PATTERN_RESPONSIVE });
        }
      }
    }
  }
  RULES.validateStyle(node.style, errors, `${path}.style`);
  validatePatternRegions(node.regions, node.layout, errors, `${path}.regions`);
}

// Validate `section.composition` and account every id and block it contains against
// the shared document spaces, so v2 keeps global id uniqueness and the same block
// and size limits as v1.
export function validateLandingComposition(section, sectionPath, errors, ids, counters) {
  const path = `${sectionPath}.composition`;
  const composition = section.composition;

  // An EMPTY composition is valid. That is a deliberate design decision, not a loosened
  // rule: removing a Pattern — or moving the last node to another area — must leave a
  // usable visual area behind, otherwise the only way to empty a layer would be to
  // destroy it. The Section stays a composition area with nothing in it, which is
  // exactly the state the user can drop into next. Only a NON-array composition is
  // malformed.
  if (!Array.isArray(composition)) {
    errors.push({ path, code: COMPOSITION_ERROR.COMPOSITION_EMPTY });
    return;
  }
  if (composition.length > RULES.limits.composition) {
    errors.push({ path, code: COMPOSITION_ERROR.MAX_COMPOSITION_NODES });
  }

  // Style ownership (D3): pattern-level width/alignment must live on the Pattern
  // node, so a composition area may not also declare them.
  for (const key of PATTERN_OWNED_STYLE_KEYS) {
    if (plainObject(section.style) && section.style[key] !== undefined) {
      errors.push({ path: `${sectionPath}.style.${key}`, code: COMPOSITION_ERROR.PATTERN_STYLE_OWNED_BY_NODE });
    }
  }

  for (const [index, node] of composition.entries()) {
    const nodePath = `${path}.${index}`;
    if (!plainObject(node)) {
      errors.push({ path: nodePath, code: COMPOSITION_ERROR.INVALID_COMPOSITION_NODE });
      continue;
    }

    if (Object.prototype.hasOwnProperty.call(node, "pattern")) {
      if (!validId(node.id)) {
        errors.push({ path: nodePath, code: COMPOSITION_ERROR.INVALID_PATTERN_NODE });
        continue;
      }
      if (ids.has(node.id)) errors.push({ path: `${nodePath}.id`, code: "DUPLICATE_ID" });
      ids.add(node.id);
      counters.patterns += 1;
      validatePatternNode(node, errors, nodePath);
      accountPatternRegions(node, nodePath, errors, ids, counters);
      continue;
    }

    if (typeof node.type !== "string") {
      // A node that is neither a Pattern (no `pattern` key) nor a primitive.
      errors.push({ path: nodePath, code: COMPOSITION_ERROR.INVALID_COMPOSITION_NODE });
      continue;
    }
    if (!validId(node.id)) {
      errors.push({ path: `${nodePath}.id`, code: "INVALID_BLOCK" });
      continue;
    }
    if (ids.has(node.id)) errors.push({ path: `${nodePath}.id`, code: "DUPLICATE_ID" });
    ids.add(node.id);
    counters.blocks += 1;

    // A dedicated Header/Footer is its own protected Section by contract. Letting
    // one appear as a composition child would create a second, unprotected surface.
    if (isDedicatedSurfaceBlock(node)) {
      errors.push({ path: `${nodePath}.type`, code: COMPOSITION_ERROR.DEDICATED_SURFACE_NOT_IN_COMPOSITION });
    }
    validateBlockNode(node, errors, nodePath);
  }
}

// A Pattern node's regions and blocks join the same global id space and block count
// as a v1 Section's regions and blocks.
export function accountPatternRegions(node, nodePath, errors, ids, counters) {
  if (!Array.isArray(node?.regions)) return;
  for (const [regionIndex, region] of node.regions.entries()) {
    if (!plainObject(region)) continue;
    if (validId(region.id)) {
      if (ids.has(region.id)) errors.push({ path: `${nodePath}.regions.${regionIndex}.id`, code: "DUPLICATE_ID" });
      ids.add(region.id);
    }
    if (!Array.isArray(region.blocks)) continue;
    for (const [blockIndex, block] of region.blocks.entries()) {
      counters.blocks += 1;
      if (!plainObject(block)) continue;
      if (validId(block.id)) {
        if (ids.has(block.id)) errors.push({ path: `${nodePath}.regions.${regionIndex}.blocks.${blockIndex}.id`, code: "DUPLICATE_ID" });
        ids.add(block.id);
      }
      if (isDedicatedSurfaceBlock(block)) {
        errors.push({ path: `${nodePath}.regions.${regionIndex}.blocks.${blockIndex}.type`, code: COMPOSITION_ERROR.DEDICATED_SURFACE_NOT_IN_COMPOSITION });
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Pure v1 -> v2 migration
//
// Deterministic, total and non-mutating. It never invents a catalog identity: a
// legacy anonymous Section is migrated with an explicit legacy identity, because
// "this region tree happens to look like hero_split" is not proof of equivalence.
//
// What moves where (D3):
//   - the Section keeps being the visual composition area. Navigation metadata
//     (label, anchor) and the whole `style` are preserved, so page rhythm and area
//     appearance are untouched.
//   - a Pattern-like Section's layout/regions/responsive are wrapped into a
//     PatternNode that ALSO receives that same style, so the Pattern carries every
//     pattern-owned property it had before. Nothing is dropped and nothing is
//     doubled: the copies are identical, and the later renderer increment reads
//     pattern-owned values from the node.
//   - a dedicated Header/Footer Section is left exactly as it is: it is a protected
//     single-surface structure, and wrapping it would place it inside a composition.
//   - a generic legacy Section becomes composition-wrapped too, because
//     `composition` is how v2 expresses independent content. Its Region is what
//     keeps those blocks together, and the area keeps owning the rhythm.
//
// The Pattern node reuses the legacy Section's id, which is exactly why migration
// needs no id generator and is fully deterministic.
// ---------------------------------------------------------------------------

// Split a legacy Section's style between the two owners it is being separated into.
//
// In v1 one `style` object carried both page-level and pattern-level properties,
// because the Pattern *was* the Section. After v2 they have different owners (D3), so
// the same values are routed to the node that would have owned them:
//
//   patternStyle  -> the Pattern node: how the composition itself looks
//   areaStyle     -> the area Section: page-level appearance and page rhythm only
//
// The pattern keeps the properties it owns (width, alignment) and the area keeps
// everything else, including the page's vertical rhythm. Keeping the rhythm on BOTH
// owners (which is what this function used to do) is not harmless: the read layer
// resolves pattern-owned keys away from the area, so a duplicated rhythm key made the
// migrated Section advertise no `data-padding-*` at all and the v2 page silently lost the
// vertical rhythm the v1 page had. Duplicating was also not needed for compatibility —
// the same values reach the same rendered element either way, because the area renders
// the Section's `data-padding-*` while the pattern's own rhythm has no CSS rule in v2.
function splitPatternStyle(style) {
  if (!plainObject(style)) return { patternStyle: undefined, areaStyle: undefined };
  const patternStyle = {};
  const areaStyle = {};
  for (const [key, value] of Object.entries(style)) {
    if (PATTERN_OWNED_STYLE_KEYS.includes(key)) patternStyle[key] = clone(value);
    else areaStyle[key] = clone(value);
  }
  return {
    patternStyle: Object.keys(patternStyle).length ? patternStyle : undefined,
    areaStyle: Object.keys(areaStyle).length ? areaStyle : undefined,
  };
}

export function migrateLandingDocumentV1ToV2(document, options = {}) {
  if (!plainObject(document)) throw new Error("BUILDER_DOCUMENT_REQUIRED");
  if (!Array.isArray(document.sections)) throw new Error("BUILDER_DOCUMENT_SECTIONS_REQUIRED");

  if (document.schema_version === LANDING_SCHEMA_VERSION_V2) return clone(document);
  if (document.schema_version !== LANDING_SCHEMA_VERSION_V1) throw new Error("BUILDER_DOCUMENT_SCHEMA_UNSUPPORTED");

  const createId = typeof options.createId === "function" ? options.createId : randomDocumentId;
  const migrated = { ...clone(document), schema_version: LANDING_SCHEMA_VERSION_V2 };
  migrated.sections = document.sections.map((section) => migrateSection(section, options, createId));
  return migrated;
}

function migrateSection(section, options, createId) {
  const copy = clone(section);

  // Protected single-surface structures keep their dedicated shape. Wrapping them
  // would place a Header/Footer inside a composition, which is exactly what its
  // contract forbids.
  if (isDedicatedSurfaceSection(copy)) return copy;

  const regions = copy.regions;
  if (!Array.isArray(regions) || !regions.length) {
    // Structurally invalid input is passed through rather than repaired, so the
    // validator reports it instead of migration inventing a shape.
    return copy;
  }

  const { patternStyle, areaStyle } = splitPatternStyle(copy.style);
  const patternNode = {
    // The composition node needs its own identity: it lives in the same global id
    // space as the Section that contains it, so it may not reuse the area's id.
    id: createId(),
    pattern: composePatternIdentity(copy, regions, options),
    layout: copy.layout === "columns" ? "columns" : "stack",
    regions: clone(regions),
  };
  if (patternStyle !== undefined) patternNode.style = patternStyle;
  if (copy.responsive !== undefined) {
    const responsive = patternResponsiveFrom(copy.responsive);
    if (Object.keys(responsive).length) patternNode.responsive = responsive;
  }

  const migrated = {
    id: copy.id,
    layout: "stack",
    regions: [],
    composition: [patternNode],
  };
  if (copy.label !== undefined) migrated.label = copy.label;
  if (copy.anchor !== undefined) migrated.anchor = copy.anchor;
  if (areaStyle !== undefined) migrated.style = areaStyle;
  return migrated;
}

function isDedicatedSurfaceSection(section) {
  if (!Array.isArray(section.regions) || section.regions.length !== 1) return false;
  const blocks = section.regions[0]?.blocks;
  if (!Array.isArray(blocks) || blocks.length !== 1) return false;
  return isDedicatedSurfaceBlock(blocks[0]);
}

function patternResponsiveFrom(responsive) {
  const result = {};
  for (const [breakpoint, override] of Object.entries(responsive || {})) {
    if (!plainObject(override)) continue;
    const kept = {};
    for (const [key, value] of Object.entries(override)) {
      if (PATTERN_RESPONSIVE_KEYS.has(key)) kept[key] = clone(value);
    }
    if (Object.keys(kept).length) result[breakpoint] = kept;
  }
  return result;
}

// Identity without guessing. `options.identifyPattern` may supply a proven catalog
// id through an explicit, reviewed mapping. Without proof the node carries an
// explicit legacy identity, so nothing downstream can mistake it for a catalog
// Pattern.
function composePatternIdentity(section, regions, options) {
  if (typeof options.identifyPattern === "function") {
    const identified = options.identifyPattern(section, regions);
    if (typeof identified === "string" && identified.length && !isLegacyPatternIdentity(identified)) return identified;
  }
  return legacyIdentityForSection(section.id);
}

// ---------------------------------------------------------------------------
// Compatibility entry point
//
// v1 documents remain valid and readable through this explicit path. It is a
// *read* helper: it never writes, never persists and never touches storage.
// ---------------------------------------------------------------------------

export function readLandingDocument(document) {
  if (!plainObject(document)) return { ok: false, migrated: false, code: "BUILDER_DOCUMENT_REQUIRED" };
  if (document.schema_version === LANDING_SCHEMA_VERSION_V2) {
    return { ok: true, migrated: false, document: clone(document) };
  }
  try {
    return { ok: true, migrated: true, document: migrateLandingDocumentV1ToV2(document) };
  } catch (error) {
    return { ok: false, migrated: false, code: error?.message || "BUILDER_DOCUMENT_MIGRATION_FAILED" };
  }
}

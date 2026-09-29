// Builder DnD V3 — semantic DropIntent vocabulary.
//
// D1 foundation. This module is PURE: no DOM, no document access, no imports from the
// legacy DnD layer. It defines WHAT a drop means, so that the resolving layer can name an
// intent instead of handing a DOM-derived scalar target to the mutation layer.
//
// Why a vocabulary at all: the legacy model expressed destinations as scalar kinds
// ("section-after" with an index that later had to be rewritten into "composition-before"),
// so one physical boundary carried two names and ownership had to be re-derived at drop
// time. Here each destination has exactly one semantic name and exactly one owner, and the
// layer that applies it never has to ask a question about the DOM.

export const DROP_INTENT = Object.freeze({
  // A primitive or Pattern becomes a child of the area's own composition, sibling to Patterns.
  INSERT_IN_COMPOSITION: "INSERT_IN_COMPOSITION",
  // A primitive or block becomes content owned by a Pattern's region.
  INSERT_IN_PATTERN: "INSERT_IN_PATTERN",
  // An existing composition node (Pattern or independent Block) moves within its area.
  REORDER_COMPOSITION_NODE: "REORDER_COMPOSITION_NODE",
  // An existing Pattern-owned block moves between slots inside its Pattern.
  MOVE_BLOCK_WITHIN_PATTERN: "MOVE_BLOCK_WITHIN_PATTERN",
  // Pattern-owned content reorders without changing ownership.
  REORDER_PATTERN_CONTENT: "REORDER_PATTERN_CONTENT",
  // A refusal is a first-class outcome, never a silent null. The legacy resolver returned
  // `null` and the caller had to guess whether that meant "no target", "no-op" or "bug".
  REFUSED: "REFUSED",
});

export const DROP_INTENT_SCOPE = Object.freeze({
  COMPOSITION: "composition",
  PATTERN: "pattern",
  CANVAS: "canvas",
  NONE: "none",
});

// Which semantic scope each intent belongs to. This is the ONLY place that mapping exists,
// and it is used to assert that an intent's scope can never be promoted or demoted by
// geometry: an intent derived from a pattern-owned surface is pattern-scoped forever.
export const INTENT_SCOPE = Object.freeze({
  INSERT_IN_COMPOSITION: DROP_INTENT_SCOPE.COMPOSITION,
  INSERT_IN_PATTERN: DROP_INTENT_SCOPE.PATTERN,
  REORDER_COMPOSITION_NODE: DROP_INTENT_SCOPE.COMPOSITION,
  MOVE_BLOCK_WITHIN_PATTERN: DROP_INTENT_SCOPE.PATTERN,
  REORDER_PATTERN_CONTENT: DROP_INTENT_SCOPE.PATTERN,
  REFUSED: DROP_INTENT_SCOPE.NONE,
});

// The intent types that change the document's composition array, and the ones that only
// rearrange existing nodes. Kept as data so the applier (D2+) can dispatch without
// re-deciding anything about intent.
export const COMPOSITION_INTENT_TYPES = Object.freeze([
  DROP_INTENT.INSERT_IN_COMPOSITION,
  DROP_INTENT.REORDER_COMPOSITION_NODE,
]);

export const PATTERN_INTENT_TYPES = Object.freeze([
  DROP_INTENT.INSERT_IN_PATTERN,
  DROP_INTENT.MOVE_BLOCK_WITHIN_PATTERN,
  DROP_INTENT.REORDER_PATTERN_CONTENT,
]);

export const DROP_REFUSAL_CODE = Object.freeze({
  // Caller error: the resolver was given something structurally impossible.
  INPUT_INVALID: "INPUT_INVALID",
  SURFACE_INVALID: "SURFACE_INVALID",
  PAYLOAD_INVALID: "PAYLOAD_INVALID",
  // A surface was declared with contradictory ownership (two scopes at once).
  SURFACE_OWNERSHIP_CONFLICT: "SURFACE_OWNERSHIP_CONFLICT",
  // A pattern surface supplied pattern axes that are not integers, or missing entirely.
  PATTERN_TARGET_INVALID: "PATTERN_TARGET_INVALID",
  COMPOSITION_TARGET_INVALID: "COMPOSITION_TARGET_INVALID",
  // Nothing was under the pointer and no declared fallback surface was in range.
  NO_SURFACE_IN_RANGE: "NO_SURFACE_IN_RANGE",
  // The payload kind cannot be expressed by the surface that was hit.
  PAYLOAD_NOT_ACCEPTED_BY_SURFACE: "PAYLOAD_NOT_ACCEPTED_BY_SURFACE",
});

const REFUSAL_CODES = new Set(Object.values(DROP_REFUSAL_CODE));
const INTENT_TYPES = new Set(Object.values(DROP_INTENT));

const isPlainObject = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const isNonEmptyString = (value) => typeof value === "string" && value.length > 0;
const isIndex = (value) => Number.isInteger(value) && value >= 0;

export const semanticScopeOfIntent = (type) => INTENT_SCOPE[type] ?? DROP_INTENT_SCOPE.NONE;

export const makeRefusal = (code, because = "", detail = undefined) => Object.freeze({
  type: DROP_INTENT.REFUSED,
  code: REFUSAL_CODES.has(code) ? code : DROP_REFUSAL_CODE.INPUT_INVALID,
  because: typeof because === "string" ? because : "",
  ...(detail === undefined ? {} : { detail }),
});

export const makeIntent = (type, fields = {}) => Object.freeze({ type, ...fields });

export const makeInsertInComposition = ({ sectionId, anchorIndex, payload }) => makeIntent(DROP_INTENT.INSERT_IN_COMPOSITION, {
  scope: DROP_INTENT_SCOPE.COMPOSITION,
  sectionId, anchorIndex, payload,
});

export const makeInsertInPattern = ({ sectionId, patternNodeId, regionId, slotIndex, payload }) => makeIntent(DROP_INTENT.INSERT_IN_PATTERN, {
  scope: DROP_INTENT_SCOPE.PATTERN,
  sectionId, patternNodeId, regionId, slotIndex, payload,
});

export const makeReorderCompositionNode = ({ sectionId, nodeId, toIndex, payload }) => makeIntent(DROP_INTENT.REORDER_COMPOSITION_NODE, {
  scope: DROP_INTENT_SCOPE.COMPOSITION,
  sectionId, nodeId, toIndex, payload,
});

export const makeMoveBlockWithinPattern = ({ sectionId, patternNodeId, regionId, blockId, toSlot, payload }) => makeIntent(DROP_INTENT.MOVE_BLOCK_WITHIN_PATTERN, {
  scope: DROP_INTENT_SCOPE.PATTERN,
  sectionId, patternNodeId, regionId, blockId, toSlot, payload,
});

export const makeReorderPatternContent = ({ sectionId, patternNodeId, regionId, fromSlot, toSlot, payload }) => makeIntent(DROP_INTENT.REORDER_PATTERN_CONTENT, {
  scope: DROP_INTENT_SCOPE.PATTERN,
  sectionId, patternNodeId, regionId, fromSlot, toSlot, payload,
});

export const isRefusal = (intent) => Boolean(intent) && intent.type === DROP_INTENT.REFUSED;

// Structural validation. A refusal is valid by construction; every other intent must carry a
// complete, well-typed owner. This is the function that makes "invalid input fails safely and
// explicitly" true rather than aspirational: the resolver and its tests both call it.
export function validateDropIntent(intent) {
  if (!isPlainObject(intent)) return { valid: false, code: DROP_REFUSAL_CODE.INPUT_INVALID };
  if (!INTENT_TYPES.has(intent.type)) return { valid: false, code: DROP_REFUSAL_CODE.INPUT_INVALID };
  if (intent.type === DROP_INTENT.REFUSED) {
    return REFUSAL_CODES.has(intent.code)
      ? { valid: true }
      : { valid: false, code: DROP_REFUSAL_CODE.INPUT_INVALID };
  }
  if (!isPlainObject(intent.payload) || !isNonEmptyString(intent.payload.kind)) {
    return { valid: false, code: DROP_REFUSAL_CODE.PAYLOAD_INVALID };
  }
  const scope = intent.scope;
  if (scope === DROP_INTENT_SCOPE.COMPOSITION || intent.type === DROP_INTENT.INSERT_IN_COMPOSITION || intent.type === DROP_INTENT.REORDER_COMPOSITION_NODE) {
    if (scope !== DROP_INTENT_SCOPE.COMPOSITION) return { valid: false, code: DROP_REFUSAL_CODE.SURFACE_OWNERSHIP_CONFLICT };
    // A canvas-owned surface legitimately carries `sectionId: null`: the page canvas is owned by
    // no Section, and expressing that as a null anchor is honest rather than inventing an owner.
    // Any other non-string is still invalid.
    if (intent.sectionId !== null && !isNonEmptyString(intent.sectionId)) return { valid: false, code: DROP_REFUSAL_CODE.COMPOSITION_TARGET_INVALID };
    if (intent.type === DROP_INTENT.INSERT_IN_COMPOSITION && !isIndex(intent.anchorIndex)) return { valid: false, code: DROP_REFUSAL_CODE.COMPOSITION_TARGET_INVALID };
    if (intent.type === DROP_INTENT.REORDER_COMPOSITION_NODE) {
      if (!isNonEmptyString(intent.nodeId) || !isIndex(intent.toIndex)) return { valid: false, code: DROP_REFUSAL_CODE.COMPOSITION_TARGET_INVALID };
    }
    return { valid: true };
  }
  if (scope === DROP_INTENT_SCOPE.PATTERN || PATTERN_INTENT_TYPES.includes(intent.type)) {
    if (scope !== DROP_INTENT_SCOPE.PATTERN) return { valid: false, code: DROP_REFUSAL_CODE.SURFACE_OWNERSHIP_CONFLICT };
    if (!isNonEmptyString(intent.sectionId) || !isNonEmptyString(intent.patternNodeId) || !isNonEmptyString(intent.regionId)) {
      return { valid: false, code: DROP_REFUSAL_CODE.PATTERN_TARGET_INVALID };
    }
    if (intent.type === DROP_INTENT.INSERT_IN_PATTERN && !isIndex(intent.slotIndex)) return { valid: false, code: DROP_REFUSAL_CODE.PATTERN_TARGET_INVALID };
    if (intent.type === DROP_INTENT.MOVE_BLOCK_WITHIN_PATTERN && (!isNonEmptyString(intent.blockId) || !isIndex(intent.toSlot))) {
      return { valid: false, code: DROP_REFUSAL_CODE.PATTERN_TARGET_INVALID };
    }
    if (intent.type === DROP_INTENT.REORDER_PATTERN_CONTENT && (!isIndex(intent.fromSlot) || !isIndex(intent.toSlot))) {
      return { valid: false, code: DROP_REFUSAL_CODE.PATTERN_TARGET_INVALID };
    }
    return { valid: true };
  }
  return { valid: false, code: DROP_REFUSAL_CODE.SURFACE_OWNERSHIP_CONFLICT };
}

export const isV3DropIntent = (intent) => validateDropIntent(intent).valid && !isRefusal(intent);

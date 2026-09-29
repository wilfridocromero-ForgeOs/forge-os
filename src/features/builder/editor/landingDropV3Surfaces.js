// Builder DnD V3 — declared Drop Surfaces.
//
// D1 foundation. A Drop Surface is the ONLY thing a drop can mean. It is a declaration, not
// a measurement: the component that owns the space renders the surface and states its role,
// its semantic owner and its priority. Geometry (the rect) is attached to the declaration so
// the pure resolver can answer "which declared surface is under this point?", but geometry
// never creates a surface, never upgrades one, and never moves ownership between scopes.
//
// This replaces three things from the legacy layer:
//   - special DOM target kinds ("section-before"/"section-after"/"composition-before" with an
//     index that had to be rewritten later by resolveCompositionBoundary);
//   - ownership derived from zone metadata at hit time;
//   - tolerance constants as the mechanism that decided which owner won.
//
// It is PURE: no DOM, no document access. Adding a role requires: a vocabulary entry here, an
// ownership rule, a priority entry, a mapping in landingDropV3Resolve, and a test.

export const SURFACE_ROLE = Object.freeze({
  // A slot in the area's own composition, between or beside its nodes. Free composition space
  // is expressed with this role, which is what makes "drop next to a Pattern" a first-class
  // destination instead of an edge band you have to hit.
  COMPOSITION_SLOT: "composition-slot",
  // The slot after the last composition node, still owned by the area.
  COMPOSITION_END: "composition-end",
  // A slot in the area after every Section, owned by no Section.
  CANVAS_END: "canvas-end",
  // A slot inside a Pattern's region, owned by that Pattern.
  PATTERN_SLOT: "pattern-slot",
  // The trailing slot inside a Pattern's region (still Pattern-owned, distinct role because
  // the applier treats an append differently from an insert-before-node).
  PATTERN_END: "pattern-end",
});

export const SURFACE_SCOPE = Object.freeze({
  COMPOSITION: "composition",
  PATTERN: "pattern",
  CANVAS: "canvas",
});

// Which scope each role belongs to. Ownership is a property of the DECLARATION, so a surface
// cannot become composition-owned by being closer to the pointer, and a pattern surface cannot
// be captured by a composition fallback. This table is the single source of that rule.
export const ROLE_SCOPE = Object.freeze({
  [SURFACE_ROLE.COMPOSITION_SLOT]: SURFACE_SCOPE.COMPOSITION,
  [SURFACE_ROLE.COMPOSITION_END]: SURFACE_SCOPE.COMPOSITION,
  [SURFACE_ROLE.CANVAS_END]: SURFACE_SCOPE.CANVAS,
  [SURFACE_ROLE.PATTERN_SLOT]: SURFACE_SCOPE.PATTERN,
  [SURFACE_ROLE.PATTERN_END]: SURFACE_SCOPE.PATTERN,
});

// THE priority table. Centralized, declarative, and the only place ordering is decided.
//
// Semantics: priority breaks ties BETWEEN surfaces of DIFFERENT roles. It is never consulted
// before scope, and it can never move a drop across scopes (see resolveAnchor).
//
// Rationale for the order: a Pattern's own internal slot is the more specific declaration, so
// it outranks the area's slot. A terminal slot outranks a generic slot so that appending is
// reachable at the end. The canvas is the least specific destination in the system.
export const SURFACE_PRIORITY = Object.freeze({
  [SURFACE_ROLE.PATTERN_SLOT]: 300,
  [SURFACE_ROLE.PATTERN_END]: 280,
  [SURFACE_ROLE.COMPOSITION_SLOT]: 200,
  [SURFACE_ROLE.COMPOSITION_END]: 180,
  [SURFACE_ROLE.CANVAS_END]: 100,
});

export const DROP_SURFACE_ERROR = Object.freeze({
  SURFACE_INVALID: "SURFACE_INVALID",
  SURFACE_ID_REQUIRED: "SURFACE_ID_REQUIRED",
  SURFACE_ROLE_UNKNOWN: "SURFACE_ROLE_UNKNOWN",
  SURFACE_RECT_INVALID: "SURFACE_RECT_INVALID",
  SURFACE_OWNERSHIP_CONFLICT: "SURFACE_OWNERSHIP_CONFLICT",
  SURFACE_ACCEPTS_INVALID: "SURFACE_ACCEPTS_INVALID",
});

const isPlainObject = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const isNonEmptyString = (value) => typeof value === "string" && value.length > 0;
const isFiniteNumber = (value) => typeof value === "number" && Number.isFinite(value);
const isIndex = (value) => Number.isInteger(value) && value >= 0;

export const scopeOfRole = (role) => ROLE_SCOPE[role] ?? null;
export const priorityOfRole = (role) => SURFACE_PRIORITY[role] ?? 0;

export const isValidSurfaceRole = (role) => Object.prototype.hasOwnProperty.call(ROLE_SCOPE, role);

// A rect in ONE captured coordinate frame (viewport coordinates from a single frame). The
// resolver never mixes frames; the caller is responsible for capturing rects and the pointer
// in the same frame, and D5 adds the drift guard that enforces it.
export const isValidSurfaceRect = (rect) => isPlainObject(rect)
  && isFiniteNumber(rect.top) && isFiniteNumber(rect.bottom)
  && isFiniteNumber(rect.left) && isFiniteNumber(rect.right)
  && rect.bottom >= rect.top && rect.right >= rect.left;

export const surfaceWidth = (rect) => rect.right - rect.left;
export const surfaceHeight = (rect) => rect.bottom - rect.top;
export const surfaceArea = (rect) => surfaceWidth(rect) * surfaceHeight(rect);

// Containment is HALF-OPEN: inclusive at top/left, exclusive at bottom/right. This is the ONE
// convention for boundary pointers, and it is what lets declared surfaces tile the canvas
// without overlapping: the row that starts where the previous one ends owns the shared edge,
// so no point ever belongs to two surfaces and "the pointer was exactly on the seam" has a
// single defined answer instead of a tolerance guess.
export const surfaceContainsPoint = (surface, point) => Boolean(surface && surface.rect && point)
  && isFiniteNumber(point.x) && isFiniteNumber(point.y)
  && point.x >= surface.rect.left && point.x < surface.rect.right
  && point.y >= surface.rect.top && point.y < surface.rect.bottom;

// Vertical distance from a point to a rect: 0 when inside vertically. Used only by the
// declared fallback, and only AFTER the hit test, so it can never outrank a containing
// surface.
export const surfaceVerticalDistance = (surface, point) => {
  if (!surface || !surface.rect || !point || !isFiniteNumber(point.y)) return Number.POSITIVE_INFINITY;
  if (point.y < surface.rect.top) return surface.rect.top - point.y;
  if (point.y > surface.rect.bottom) return point.y - surface.rect.bottom;
  return 0;
};

// The deterministic total order. Two surfaces can never compare equal: surfaceId is unique by
// construction, so the ordering is total and therefore resolution is reproducible.
export const surfaceSortCompare = (left, right) => {
  if (left.priority !== right.priority) return right.priority - left.priority;
  const areaDelta = surfaceArea(left.rect) - surfaceArea(right.rect);
  if (areaDelta !== 0) return areaDelta;
  return left.surfaceId < right.surfaceId ? -1 : left.surfaceId > right.surfaceId ? 1 : 0;
};

export const sortSurfaces = (surfaces) => [...surfaces].sort(surfaceSortCompare);

// Validation of a DECLARATION. It proves exactly one semantic owner and a role/target
// agreement, which is what makes "every declared surface has exactly one semantic owner" an
// enforced invariant rather than a convention.
export function validateDropSurface(input) {
  if (!isPlainObject(input)) return { valid: false, code: DROP_SURFACE_ERROR.SURFACE_INVALID };
  if (!isNonEmptyString(input.surfaceId)) return { valid: false, code: DROP_SURFACE_ERROR.SURFACE_ID_REQUIRED };
  if (!isValidSurfaceRole(input.role)) return { valid: false, code: DROP_SURFACE_ERROR.SURFACE_ROLE_UNKNOWN };
  if (!isValidSurfaceRect(input.rect)) return { valid: false, code: DROP_SURFACE_ERROR.SURFACE_RECT_INVALID };
  if (input.accepts !== undefined && (!Array.isArray(input.accepts) || input.accepts.some((kind) => !isNonEmptyString(kind)))) {
    return { valid: false, code: DROP_SURFACE_ERROR.SURFACE_ACCEPTS_INVALID };
  }
  const scope = scopeOfRole(input.role);

  // A surface may not declare a scope of its own that disagrees with its role: that would be
  // two sources of truth for ownership.
  if (input.scope !== undefined && input.scope !== scope) {
    return { valid: false, code: DROP_SURFACE_ERROR.SURFACE_OWNERSHIP_CONFLICT };
  }

  if (scope === SURFACE_SCOPE.COMPOSITION) {
    if (!isNonEmptyString(input.sectionId)) return { valid: false, code: DROP_SURFACE_ERROR.SURFACE_INVALID };
    if (!isIndex(input.anchorIndex)) return { valid: false, code: DROP_SURFACE_ERROR.SURFACE_INVALID };
    // A composition surface that also claims Pattern ownership is a conflict, not a fallback.
    if (input.patternNodeId !== undefined || input.regionId !== undefined) {
      return { valid: false, code: DROP_SURFACE_ERROR.SURFACE_OWNERSHIP_CONFLICT };
    }
    return { valid: true };
  }

  if (scope === SURFACE_SCOPE.PATTERN) {
    if (!isNonEmptyString(input.sectionId)) return { valid: false, code: DROP_SURFACE_ERROR.SURFACE_INVALID };
    if (!isNonEmptyString(input.patternNodeId) || !isNonEmptyString(input.regionId)) {
      return { valid: false, code: DROP_SURFACE_ERROR.SURFACE_INVALID };
    }
    if (!isIndex(input.slotIndex)) return { valid: false, code: DROP_SURFACE_ERROR.SURFACE_INVALID };
    if (input.anchorIndex !== undefined) {
      return { valid: false, code: DROP_SURFACE_ERROR.SURFACE_OWNERSHIP_CONFLICT };
    }
    return { valid: true };
  }

  if (scope === SURFACE_SCOPE.CANVAS) {
    // The canvas is owned by no Section, so it must not claim one.
    if (input.sectionId !== undefined && input.sectionId !== null) {
      return { valid: false, code: DROP_SURFACE_ERROR.SURFACE_OWNERSHIP_CONFLICT };
    }
    return { valid: true };
  }

  return { valid: false, code: DROP_SURFACE_ERROR.SURFACE_ROLE_UNKNOWN };
}

const surfaceError = (code) => {
  const error = new Error(code);
  error.code = code;
  return error;
};

// Builds a frozen, normalized declaration. Throws a typed error instead of returning a
// half-built surface, so an invalid declaration cannot silently participate in resolution.
// The rect is deep-frozen too: a resolver run must not be influenced by later mutation of a
// rect object the caller still holds.
export function makeDropSurface(input) {
  const verdict = validateDropSurface(input);
  if (!verdict.valid) throw surfaceError(verdict.code);
  const scope = scopeOfRole(input.role);
  const normalized = {
    surfaceId: input.surfaceId,
    role: input.role,
    scope,
    priority: isFiniteNumber(input.priority) ? input.priority : priorityOfRole(input.role),
    rect: Object.freeze({ top: input.rect.top, bottom: input.rect.bottom, left: input.rect.left, right: input.rect.right }),
    accepts: Object.freeze(Array.isArray(input.accepts) ? [...input.accepts] : []),
  };
  if (scope === SURFACE_SCOPE.COMPOSITION) {
    normalized.sectionId = input.sectionId;
    normalized.anchorIndex = input.anchorIndex;
  } else if (scope === SURFACE_SCOPE.PATTERN) {
    normalized.sectionId = input.sectionId;
    normalized.patternNodeId = input.patternNodeId;
    normalized.regionId = input.regionId;
    normalized.slotIndex = input.slotIndex;
  }
  if (isPlainObject(input.gap)) {
    normalized.gap = { fromNodeId: input.gap.fromNodeId ?? null, toNodeId: input.gap.toNodeId ?? null };
  }
  return Object.freeze(normalized);
}

export const makeCompositionSurface = ({ surfaceId, rect, sectionId, anchorIndex, accepts, priority, gap, role = SURFACE_ROLE.COMPOSITION_SLOT }) => makeDropSurface({
  surfaceId, role, rect, sectionId, anchorIndex, accepts, priority, gap,
});

export const makeCompositionEndSurface = ({ surfaceId, rect, sectionId, anchorIndex, accepts, priority, gap }) => makeDropSurface({
  surfaceId, role: SURFACE_ROLE.COMPOSITION_END, rect, sectionId, anchorIndex, accepts, priority, gap,
});

export const makeCanvasEndSurface = ({ surfaceId, rect, accepts, priority }) => makeDropSurface({
  surfaceId, role: SURFACE_ROLE.CANVAS_END, rect, accepts, priority,
});

export const makePatternSurface = ({ surfaceId, rect, sectionId, patternNodeId, regionId, slotIndex, accepts, priority, role = SURFACE_ROLE.PATTERN_SLOT }) => makeDropSurface({
  surfaceId, role, rect, sectionId, patternNodeId, regionId, slotIndex, accepts, priority,
});

export const makePatternEndSurface = ({ surfaceId, rect, sectionId, patternNodeId, regionId, slotIndex, accepts, priority }) => makeDropSurface({
  surfaceId, role: SURFACE_ROLE.PATTERN_END, rect, sectionId, patternNodeId, regionId, slotIndex, accepts, priority,
});

// Normalizes a declared set, reporting rejected declarations rather than dropping them
// silently, so "invalid input fails safely and explicitly" holds for the surface set too.
export function normalizeSurfaces(surfaces) {
  const valid = [];
  const rejected = [];
  const list = Array.isArray(surfaces) ? surfaces : [];
  for (let i = 0; i < list.length; i += 1) {
    const candidate = list[i];
    const verdict = validateDropSurface(candidate);
    if (!verdict.valid) {
      rejected.push({ index: i, code: verdict.code, surfaceId: isPlainObject(candidate) ? candidate.surfaceId ?? null : null });
      continue;
    }
    valid.push(makeDropSurface(candidate));
  }
  return { valid: sortSurfaces(valid), rejected };
}

export const surfacesContainingPoint = (surfaces, point) => sortSurfaces(surfaces).filter((surface) => surfaceContainsPoint(surface, point));

// Convenience for callers and tests: the declared owner of a surface, as data.
export const ownerOfSurface = (surface) => {
  if (!surface) return null;
  if (surface.scope === SURFACE_SCOPE.COMPOSITION) {
    return { scope: surface.scope, sectionId: surface.sectionId, anchorIndex: surface.anchorIndex };
  }
  if (surface.scope === SURFACE_SCOPE.PATTERN) {
    return { scope: surface.scope, sectionId: surface.sectionId, patternNodeId: surface.patternNodeId, regionId: surface.regionId, slotIndex: surface.slotIndex };
  }
  return { scope: surface.scope };
};

// Builder DnD V3 — pure semantic resolver (D1).
//
// Inputs:  a pointer in ONE captured frame, a set of DECLARED surfaces, and optionally a
//          payload and a document.
// Outputs: exactly one DropIntent, or a typed REFUSED intent. Never `null`.
//
// PURITY CONTRACT (enforced by tests): this module reads nothing global, touches no DOM,
// writes to no document, and for identical inputs always returns an identical, deeply equal
// result. A document may be passed for future legality checks, but nothing here mutates it.
//
// RESOLUTION ORDER — explicit, total, and the only place ambiguity is settled:
//   1. Validate the request. Invalid input refuses with a typed code; it never guesses.
//   2. Normalize the declared surfaces. Invalid declarations are reported, not dropped.
//   3. HIT TEST. Among surfaces that CONTAIN the pointer, take the deterministic first
//      (priority, then smallest area, then surfaceId). Scope is already fixed by the
//      surface's declaration, so a containing hit can never be re-owned by distance.
//   4. DECLARED FALLBACK (only when nothing contains the pointer). Prefer the nearest
//      COMPOSITION surface within maxGapDistance — this is what makes free composition space
//      a legitimate destination instead of a dead zone. If no composition surface is in
//      range, fall back to the nearest CANVAS surface within maxGapDistance.
//   5. Refuse with NO_SURFACE_IN_RANGE.
//
// Two invariants this order exists to guarantee:
//   - A PATTERN surface can only ever produce a pattern-scoped intent, and a COMPOSITION
//     surface can only ever produce a composition-scoped intent. Step 4 never consults a
//     pattern surface, so "Pattern steals a composition drop" and "composition steals a
//     Pattern drop" are both structurally impossible rather than tolerance-dependent.
//   - There is no conversion step equivalent to the legacy resolveCompositionBoundary: the
//     surface's role maps to one intent type through DECLARED_INTENT_BY_ROLE and nothing else.

import {
  DROP_INTENT,
  DROP_REFUSAL_CODE,
  makeInsertInComposition,
  makeInsertInPattern,
  makeMoveBlockWithinPattern,
  makeRefusal,
  makeReorderCompositionNode,
  makeReorderPatternContent,
  validateDropIntent,
} from "./landingDropV3Intent.js";
import {
  SURFACE_ROLE,
  SURFACE_SCOPE,
  normalizeSurfaces,
  scopeOfRole,
  sortSurfaces,
  surfaceContainsPoint,
  surfaceVerticalDistance,
} from "./landingDropV3Surfaces.js";

// The declared fallback distance. Unlike the legacy tolerances (ZONE_HIT_TOLERANCE,
// CONTENT_TAIL_TOLERANCE) this never decides OWNERSHIP — it only decides whether free space is
// close enough to a declared composition slot to mean "append here". It is a parameter with a
// published default so it can be tested and tuned, not a private constant.
export const DEFAULT_MAX_GAP_DISTANCE = 96;

// A refusal reason, as data, so a failed drop can say why by construction.
export const ANCHOR_REASON = Object.freeze({
  CONTAINED: "contained",
  FALLBACK_NEAREST_COMPOSITION: "fallback-nearest-composition",
  FALLBACK_CANVAS: "fallback-canvas",
  NO_SURFACE: "no-surface",
  INPUT_INVALID: "input-invalid",
  SURFACE_INVALID: "surface-invalid",
});

// The ONE mapping from a declared role to the intent type it means. No index rewriting, no
// metadata-driven conversion, no scalar target vocabulary.
export const DECLARED_INTENT_BY_ROLE = Object.freeze({
  [SURFACE_ROLE.PATTERN_SLOT]: DROP_INTENT.INSERT_IN_PATTERN,
  [SURFACE_ROLE.PATTERN_END]: DROP_INTENT.INSERT_IN_PATTERN,
  [SURFACE_ROLE.COMPOSITION_SLOT]: DROP_INTENT.INSERT_IN_COMPOSITION,
  [SURFACE_ROLE.COMPOSITION_END]: DROP_INTENT.INSERT_IN_COMPOSITION,
  [SURFACE_ROLE.CANVAS_END]: DROP_INTENT.INSERT_IN_COMPOSITION,
});

// Payload kinds whose drop is a MOVE of an existing node rather than an insert. Kept as data
// so the mapping is testable and the applier (D2+) never re-decides it.
export const MOVE_PAYLOAD_KINDS = Object.freeze(["block"]);

const isPlainObject = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const isFiniteNumber = (value) => typeof value === "number" && Number.isFinite(value);
const isIndex = (value) => Number.isInteger(value) && value >= 0;

const nearestInScope = (surfaces, point, scope) => surfaces
  .filter((surface) => surface.scope === scope)
  .map((surface) => ({ surface, distance: surfaceVerticalDistance(surface, point) }))
  // Ties on distance are broken by the same total order the hit test uses, so the fallback is
  // deterministic for the same reason the hit test is.
  .filter((entry) => entry.distance <= 0 || Number.isFinite(entry.distance))
  .sort((left, right) => {
    if (left.distance !== right.distance) return left.distance - right.distance;
    return sortSurfaces([left.surface, right.surface])[0] === left.surface ? -1 : 1;
  })[0] ?? null;

const resolveChosen = (choice, surfaces) => {
  const hit = surfaces.filter((surface) => surfaceContainsPoint(surface, choice.point));
  if (hit.length) return { surface: hit[0], reason: ANCHOR_REASON.CONTAINED, contains: true };

  // The declared fallback. Scope is NEVER consulted as a preference here: the nearest declared
  // surface in range wins on distance, and its own declaration decides the meaning. A Pattern
  // surface is still not eligible, because the fallback exists to make free composition space a
  // destination, not to re-scope a gesture that landed inside a Pattern.
  const candidates = [];
  for (const scope of [SURFACE_SCOPE.COMPOSITION, SURFACE_SCOPE.CANVAS]) {
    const entry = nearestInScope(surfaces, choice.point, scope);
    if (entry && entry.distance <= choice.maxGapDistance) candidates.push({ scope, ...entry });
  }
  if (!candidates.length) return { surface: null, reason: ANCHOR_REASON.NO_SURFACE };
  candidates.sort((left, right) => {
    if (left.distance !== right.distance) return left.distance - right.distance;
    if (left.surface.priority !== right.surface.priority) return right.surface.priority - left.surface.priority;
    return left.surface.surfaceId < right.surface.surfaceId ? -1 : 1;
  });
  const winner = candidates[0];
  return {
    surface: winner.surface,
    reason: winner.scope === SURFACE_SCOPE.CANVAS ? ANCHOR_REASON.FALLBACK_CANVAS : ANCHOR_REASON.FALLBACK_NEAREST_COMPOSITION,
    contains: false,
    distance: winner.distance,
  };
};

// Pure: which declared surface does this pointer mean, and why.
export function resolveAnchor({ point, surfaces, scopeFilter = null, maxGapDistance = DEFAULT_MAX_GAP_DISTANCE } = {}) {
  const request = { point, scopeFilter, maxGapDistance };
  if (!isPlainObject(point) || !isFiniteNumber(point.x) || !isFiniteNumber(point.y)) {
    return { surface: null, reason: ANCHOR_REASON.INPUT_INVALID, contains: false, rejected: [], request };
  }
  if (!isFiniteNumber(maxGapDistance) || maxGapDistance < 0) {
    return { surface: null, reason: ANCHOR_REASON.INPUT_INVALID, contains: false, rejected: [], request };
  }
  const { valid, rejected } = normalizeSurfaces(surfaces);
  const allowed = scopeFilter === null || scopeFilter === undefined
    ? valid
    : valid.filter((surface) => surface.scope === scopeFilter);
  if (!allowed.length) {
    return { surface: null, reason: rejected.length ? ANCHOR_REASON.SURFACE_INVALID : ANCHOR_REASON.NO_SURFACE, contains: false, rejected, request };
  }
  const chosen = resolveChosen({ point, maxGapDistance }, allowed);
  return { surface: chosen.surface, reason: chosen.reason, contains: chosen.contains === true, distance: chosen.distance ?? 0, rejected, request };
}

const resolveSurfaceAxis = (surface) => {
  const scope = surface.scope;
  if (scope === SURFACE_SCOPE.COMPOSITION) {
    return { sectionId: surface.sectionId, anchorIndex: surface.anchorIndex };
  }
  if (scope === SURFACE_SCOPE.PATTERN) {
    return { sectionId: surface.sectionId, patternNodeId: surface.patternNodeId, regionId: surface.regionId, slotIndex: surface.slotIndex };
  }
  return {};
};

// Pure: which DropIntent does a chosen surface mean?
//
// Order of decisions, all declared:
//   1. No surface            -> REFUSED(NO_SURFACE_IN_RANGE).
//   2. Payload present and not accepted by the surface -> REFUSED(PAYLOAD_NOT_ACCEPTED_BY_SURFACE).
//   3. Payload is a MOVE (payload.kind in MOVE_PAYLOAD_KINDS) -> REORDER_COMPOSITION_NODE.
//   4. Otherwise the surface's declared role names the insert intent.
export function resolveIntentForSurface({ surface, payload = null, nodeId = null } = {}) {
  if (!isPlainObject(surface)) return makeRefusal(DROP_REFUSAL_CODE.NO_SURFACE_IN_RANGE, "no declared surface is in range");
  const accepts = Array.isArray(surface.accepts) ? surface.accepts : [];
  if (isPlainObject(payload) && typeof payload.kind === "string" && accepts.length && !accepts.includes(payload.kind)) {
    return makeRefusal(
      DROP_REFUSAL_CODE.PAYLOAD_NOT_ACCEPTED_BY_SURFACE,
      `${payload.kind} is not accepted by ${surface.surfaceId}`,
      { surfaceId: surface.surfaceId, role: surface.role, accepts },
    );
  }
  const axis = resolveSurfaceAxis(surface);
  const intentPayload = isPlainObject(payload) ? { kind: payload.kind, id: payload.id ?? null } : { kind: "palette-block", id: null };

  if (isPlainObject(payload) && MOVE_PAYLOAD_KINDS.includes(payload.kind)) {
    const movedId = typeof payload.id === "string" && payload.id.length ? payload.id : nodeId;
    if (surface.scope !== SURFACE_SCOPE.COMPOSITION) {
      // Moving an existing node inside a Pattern is a different intent, and D1 does not guess:
      // it refuses explicitly rather than silently re-scoping the gesture.
      return makeRefusal(
        DROP_REFUSAL_CODE.PAYLOAD_NOT_ACCEPTED_BY_SURFACE,
        "moving an existing node requires a composition-scope surface",
        { surfaceId: surface.surfaceId, scope: surface.scope },
      );
    }
    if (typeof movedId !== "string" || !movedId.length || !isIndex(surface.anchorIndex)) {
      return makeRefusal(DROP_REFUSAL_CODE.COMPOSITION_TARGET_INVALID, "a move needs a node id and an anchor index", { surfaceId: surface.surfaceId });
    }
    return makeReorderCompositionNode({ sectionId: surface.sectionId, nodeId: movedId, toIndex: surface.anchorIndex, payload: intentPayload });
  }

  const intentType = DECLARED_INTENT_BY_ROLE[surface.role] ?? null;
  if (intentType === null) {
    return makeRefusal(DROP_REFUSAL_CODE.SURFACE_OWNERSHIP_CONFLICT, `role ${surface.role} has no declared intent`, { surfaceId: surface.surfaceId });
  }
  if (intentType === DROP_INTENT.INSERT_IN_PATTERN) {
    if (!isIndex(surface.slotIndex)) {
      return makeRefusal(DROP_REFUSAL_CODE.PATTERN_TARGET_INVALID, "a pattern surface needs an integer slotIndex", { surfaceId: surface.surfaceId });
    }
    return makeInsertInPattern({
      sectionId: axis.sectionId,
      patternNodeId: axis.patternNodeId,
      regionId: axis.regionId,
      slotIndex: axis.slotIndex,
      payload: intentPayload,
    });
  }
  if (intentType === DROP_INTENT.INSERT_IN_COMPOSITION) {
    if (surface.scope === SURFACE_SCOPE.CANVAS) {
      // The canvas owns no Section: an insert there is a new Section, which D1 expresses as a
      // composition insert with no Section anchor and no index. The applier decides placement.
      return makeInsertInComposition({ sectionId: null, anchorIndex: 0, payload: intentPayload });
    }
    if (!isIndex(surface.anchorIndex)) {
      return makeRefusal(DROP_REFUSAL_CODE.COMPOSITION_TARGET_INVALID, "a composition surface needs an integer anchorIndex", { surfaceId: surface.surfaceId });
    }
    return makeInsertInComposition({ sectionId: surface.sectionId, anchorIndex: surface.anchorIndex, payload: intentPayload });
  }
  return makeRefusal(DROP_REFUSAL_CODE.SURFACE_OWNERSHIP_CONFLICT, `role ${surface.role} has no declared intent`, { surfaceId: surface.surfaceId });
}

// The single entry point. Pure, total, and deterministic.
//
// `document` is accepted for signature stability and future legality checks; D1 never reads or
// writes it. `scopeFilter` narrows the surface set for callers that have already decided which
// scope a gesture belongs to (for example a keyboard-driven insert), and it can only narrow:
// it can never move ownership.
export function dropIntentForPointer({ point, surfaces, payload = null, scopeFilter = null, maxGapDistance = DEFAULT_MAX_GAP_DISTANCE, document = null } = {}) {
  void document;
  const anchor = resolveAnchor({ point, surfaces, scopeFilter, maxGapDistance });
  if (!anchor.surface) {
    const code = anchor.reason === ANCHOR_REASON.INPUT_INVALID ? DROP_REFUSAL_CODE.INPUT_INVALID : DROP_REFUSAL_CODE.NO_SURFACE_IN_RANGE;
    return {
      intent: makeRefusal(code, anchor.reason === ANCHOR_REASON.INPUT_INVALID ? "the pointer is not a finite point" : "no declared surface is in range"),
      anchor,
    };
  }
  const intent = resolveIntentForSurface({ surface: anchor.surface, payload });
  return { intent, anchor };
}

// Convenience for callers that only want the intent. Same purity and totality.
export function resolveDropIntent(request) {
  return dropIntentForPointer(request).intent;
}

// Exposed so tests can assert the resolver's contract without re-deriving it.
export function describeAnchorForLog(anchor) {
  if (!isPlainObject(anchor)) return null;
  return {
    reason: anchor.reason,
    contains: anchor.contains === true,
    distance: anchor.distance ?? 0,
    surfaceId: anchor.surface ? anchor.surface.surfaceId : null,
    role: anchor.surface ? anchor.surface.role : null,
    scope: anchor.surface ? scopeOfRole(anchor.surface.role) : null,
    owner: anchor.surface ? anchor.surface.sectionId ?? null : null,
    rejected: Array.isArray(anchor.rejected) ? anchor.rejected.length : 0,
  };
}

export { validateDropIntent };

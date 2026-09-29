// Builder DnD V3 — legacy-target adapter (D1 compatibility evidence only).
//
// PURPOSE, AND ITS LIMITS. This module exists to answer one question honestly: for the drop
// destinations the legacy engine could already express, does the V3 resolver agree? It
// translates a LEGACY target (a scalar kind plus axes, as produced by the old geometry layer)
// into a DECLARED V3 surface so both can be compared on the same fixture.
//
// It is NOT on the live DnD path. Nothing in the application imports it. It does not read the
// DOM, and it does not call the legacy resolver — callers pass the legacy result in.
//
// The translation is deliberately LOSSY in one direction and that loss is the point: several
// legacy kinds collapse into the same V3 surface, because in V3 they were never different
// destinations. Where the translation cannot be performed without inventing information (a
// Pattern slot for a block whose owning Pattern cannot be determined), it refuses instead of
// guessing.

import {
  SURFACE_ROLE,
  SURFACE_SCOPE,
  makeCompositionEndSurface,
  makeCompositionSurface,
  makeCanvasEndSurface,
  makeDropSurface,
  makePatternEndSurface,
  makePatternSurface,
} from "./landingDropV3Surfaces.js";
import { DROP_REFUSAL_CODE, makeRefusal } from "./landingDropV3Intent.js";

// Legacy kinds this adapter understands, and whether V3 keeps them as distinct destinations.
export const LEGACY_KIND_MAP = Object.freeze({
  "composition-before": { role: SURFACE_ROLE.COMPOSITION_SLOT, note: "already compositional; the only legacy kind V3 keeps as-is" },
  "composition-end": { role: SURFACE_ROLE.COMPOSITION_END, note: "terminal composition slot" },
  "section-before": { role: SURFACE_ROLE.COMPOSITION_SLOT, note: "collapses: an edge band becomes the area's own composition slot at the same anchor" },
  "section-after": { role: SURFACE_ROLE.COMPOSITION_SLOT, note: "collapses: same surface as section-before, different anchor index" },
  "section": { role: SURFACE_ROLE.COMPOSITION_SLOT, note: "a whole-Section drop is a composition insert at the area anchor" },
  "block-before": { role: SURFACE_ROLE.PATTERN_SLOT, note: "Pattern-owned only when the block's owning Pattern is resolvable" },
  "block-after": { role: SURFACE_ROLE.PATTERN_SLOT, note: "Pattern-owned only when the block's owning Pattern is resolvable" },
  "region-end": { role: SURFACE_ROLE.PATTERN_END, note: "trailing slot of the region's Pattern" },
  "canvas-end": { role: SURFACE_ROLE.CANVAS_END, note: "owned by no Section in both models" },
});

const isPlainObject = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const isIndex = (value) => Number.isInteger(value) && value >= 0;

// Maps regionId -> owning Pattern node id, by walking the document's v2 composition shape.
// The legacy target vocabulary carried no pattern identity at all, which is exactly the gap
// that made ownership ambiguous; this only recovers it when the document genuinely states it.
export function buildRegionOwnerIndex(document) {
  const owners = new Map();
  const sections = isPlainObject(document) && Array.isArray(document.sections) ? document.sections : [];
  for (const section of sections) {
    if (!isPlainObject(section) || !Array.isArray(section.composition)) continue;
    for (const node of section.composition) {
      if (!isPlainObject(node) || !Array.isArray(node.regions)) continue;
      for (const region of node.regions) {
        if (isPlainObject(region) && typeof region.id === "string" && region.id.length) {
          owners.set(region.id, node.id ?? null);
        }
      }
    }
  }
  return owners;
}

const legacyAnchorIndex = (target) => {
  if (isIndex(target.index)) return target.index;
  // The legacy border names carried no index for Section edges; V3 needs one. The legacy
  // *effect* was "insert at the Section's edge", which in composition terms is anchor 0 for a
  // leading edge and the node count for a trailing edge — and the legacy engine obtained that
  // number from DOM metadata (compositionNodeCount) that V3 refuses to read. So the caller
  // supplies it, and when it is absent we say so rather than invent it.
  return null;
};

// Returns { ok: true, surface } or { ok: false, code, because }.
export function surfaceFromLegacyTarget(target, options = {}) {
  const rect = options.rect;
  const surfaceId = options.surfaceId;
  const accepts = options.accepts ?? ["palette-block"];
  if (!isPlainObject(target)) return { ok: false, code: DROP_REFUSAL_CODE.INPUT_INVALID, because: "target must be an object" };
  if (typeof target.kind !== "string" || !target.kind.length) return { ok: false, code: DROP_REFUSAL_CODE.INPUT_INVALID, because: "target.kind is required" };
  if (!isPlainObject(rect)) return { ok: false, code: DROP_REFUSAL_CODE.INPUT_INVALID, because: "a rect is required to declare a surface" };
  if (typeof surfaceId !== "string" || !surfaceId.length) return { ok: false, code: DROP_REFUSAL_CODE.INPUT_INVALID, because: "a surfaceId is required" };

  const spec = LEGACY_KIND_MAP[target.kind];
  if (!spec) return { ok: false, code: DROP_REFUSAL_CODE.SURFACE_OWNERSHIP_CONFLICT, because: `legacy kind ${target.kind} has no V3 role` };

  if (spec.role === SURFACE_ROLE.CANVAS_END) {
    return { ok: true, surface: makeCanvasEndSurface({ surfaceId, rect, accepts }) };
  }

  if (spec.role === SURFACE_ROLE.PATTERN_SLOT || spec.role === SURFACE_ROLE.PATTERN_END) {
    const regionId = target.regionId;
    if (typeof regionId !== "string" || !regionId.length) {
      return { ok: false, code: DROP_REFUSAL_CODE.PATTERN_TARGET_INVALID, because: "a Pattern surface needs a regionId" };
    }
    const owners = options.regionOwners ?? new Map();
    const patternNodeId = owners.get(regionId) ?? options.patternNodeId ?? null;
    if (typeof patternNodeId !== "string" || !patternNodeId.length) {
      // Refuse rather than guess. The legacy model had no Pattern identity here, so inventing
      // one would be exactly the ambiguity V3 exists to remove.
      return { ok: false, code: DROP_REFUSAL_CODE.PATTERN_TARGET_INVALID, because: `no owning Pattern is resolvable for region ${regionId}` };
    }
    const slotIndex = isIndex(target.index) ? target.index : options.slotIndex;
    if (!isIndex(slotIndex)) {
      return { ok: false, code: DROP_REFUSAL_CODE.PATTERN_TARGET_INVALID, because: "a Pattern surface needs a slot index" };
    }
    const factory = spec.role === SURFACE_ROLE.PATTERN_END ? makePatternEndSurface : makePatternSurface;
    return { ok: true, surface: factory({ surfaceId, rect, sectionId: target.sectionId ?? options.sectionId ?? null, patternNodeId, regionId, slotIndex, accepts }) };
  }

  // Composition-scope roles. sectionId is mandatory; the anchor index may come from the legacy
  // index or from the caller's document-derived node count.
  const anchorIndex = legacyAnchorIndex(target) ?? options.anchorIndex;
  if (typeof target.sectionId !== "string" || !target.sectionId.length) {
    return { ok: false, code: DROP_REFUSAL_CODE.COMPOSITION_TARGET_INVALID, because: "a composition surface needs a sectionId" };
  }
  if (!isIndex(anchorIndex)) {
    return { ok: false, code: DROP_REFUSAL_CODE.COMPOSITION_TARGET_INVALID, because: "a composition surface needs an integer anchorIndex" };
  }
  const factory = spec.role === SURFACE_ROLE.COMPOSITION_END ? makeCompositionEndSurface : makeCompositionSurface;
  return { ok: true, surface: factory({ surfaceId, rect, sectionId: target.sectionId, anchorIndex, accepts }) };
}

// Builds a full surface set from legacy zone records, reporting what could not be expressed.
export function surfacesFromLegacyZones(zones, options = {}) {
  const regionOwners = options.regionOwners ?? new Map();
  const surfaces = [];
  const refused = [];
  const list = Array.isArray(zones) ? zones : [];
  for (let i = 0; i < list.length; i += 1) {
    const zone = list[i];
    const target = isPlainObject(zone) && zone.data ? zone.data : zone;
    const rect = isPlainObject(zone) && zone.rect ? zone.rect : options.rect;
    const result = surfaceFromLegacyTarget(target, {
      rect,
      surfaceId: `legacy-${i}-${isPlainObject(target) ? target.kind : "unknown"}`,
      regionOwners,
      anchorIndex: options.anchorIndex,
      slotIndex: options.slotIndex,
      sectionId: options.sectionId,
      accepts: options.accepts,
    });
    if (result.ok) surfaces.push(result.surface);
    else refused.push({ index: i, kind: isPlainObject(target) ? target.kind ?? null : null, code: result.code, because: result.because });
  }
  return { surfaces, refused };
}

// The shared-language comparison. Given a legacy outcome and a V3 anchor+intent, decide
// whether V3 retained or retired the legacy behaviour.
//
// A difference is NOT automatically a failure: it is acceptable when the legacy behaviour
// contradicts the V3 architecture or the product requirement (free composition space must be
// a legitimate target; ownership must not be decided by tolerance).
export const LEGACY_VERDICT = Object.freeze({
  RETAIN: "LEGACY_BEHAVIOR_RETAIN",
  RETIRE: "LEGACY_BEHAVIOR_RETIRE",
});

export function compareLegacyAndV3({ legacyTarget, v3Intent, v3Reason = null }) {
  const legacyKind = isPlainObject(legacyTarget) ? legacyTarget.kind ?? null : null;
  const refusal = isPlainObject(v3Intent) && v3Intent.type === "REFUSED";

  if (legacyKind === null && refusal) {
    return { verdict: LEGACY_VERDICT.RETAIN, why: "both models refuse: nothing was under the pointer" };
  }
  if (legacyKind === null && !refusal) {
    return {
      verdict: LEGACY_VERDICT.RETIRE,
      why: "legacy resolved nothing (no surface in range / tolerance miss) while V3 names a destination; the product requires free composition space to be a legitimate target, so V3 supersedes the miss",
      code: "FREE_SPACE_IS_A_DESTINATION",
    };
  }
  if (legacyKind !== null && refusal) {
    return {
      verdict: LEGACY_VERDICT.RETIRE,
      why: `legacy resolved ${legacyKind} but V3 refuses; either the declaration is missing from the surface set or the legacy target encoded no resolvable owner`,
      code: "DECLARATION_MISSING_OR_OWNER_UNRESOLVABLE",
    };
  }

  const mapped = LEGACY_KIND_MAP[legacyKind] ?? null;
  const v3Type = v3Intent.type;
  const expectedType = mapped ? expectedIntentForRole(mapped.role) : null;
  if (expectedType && v3Type === expectedType) {
    return { verdict: LEGACY_VERDICT.RETAIN, why: `${legacyKind} maps to ${mapped.role} and V3 produced ${v3Type}` };
  }
  return {
    verdict: LEGACY_VERDICT.RETIRE,
    why: `${legacyKind} would map to ${mapped ? mapped.role : "no role"} but V3 produced ${v3Type}`,
    code: "INTENT_FAMILY_DIFFERS",
  };
}

const expectedIntentForRole = (role) => {
  if (role === SURFACE_ROLE.PATTERN_SLOT || role === SURFACE_ROLE.PATTERN_END) return "INSERT_IN_PATTERN";
  if (role === SURFACE_ROLE.CANVAS_END) return "INSERT_IN_COMPOSITION";
  return "INSERT_IN_COMPOSITION";
};

// A refusal for the case the adapter itself cannot express. Exported so the comparison matrix
// can record it explicitly instead of treating it as an absence.
export const adapterRefusal = (because) => makeRefusal(DROP_REFUSAL_CODE.PATTERN_TARGET_INVALID, because);

export { SURFACE_SCOPE, makeDropSurface };

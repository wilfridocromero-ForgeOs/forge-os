// Deterministic landing drop resolver.
//
// This module is the single decision layer between "the pointer asked for this
// drop" and "the document changes". It is the model contract that a programmatic
// operator (Orb) can call directly, without any pointer geometry, without a DOM
// and without React:
//
//   resolveLandingDrop(document, payload, candidate, options)
//     -> { ok: true,  document, operation }
//     -> { ok: false, code, message }
//
// Contract:
// - pure: the input document is never mutated and never moved between realms;
// - total: ordinary invalid/refused requests are *returned*, never thrown;
// - explicit: an applied mutation is structurally distinguishable from a
//   semantic no-op/refusal;
// - stable: a semantic no-op resolves to the original document reference, so
//   callers can use reference identity to decide whether anything happened.
//
// Document-independent *compatibility* (which payload may land on which kind of
// target) lives here too, so the interactive gate `isValidLandingDrop` and the
// resolver share exactly one rule table. Document-dependent *feasibility* (the
// Footer contract, missing ids, same-parent ordering) is decided by
// `inspectLandingDrop` against the real document instead of being predicted by a
// document-independent gate.

import { assertLandingDocument, createPrimitiveBlock } from "../document/landingDocument.js";
import {
  LANDING_SCHEMA_VERSION_V2,
  isCompositionSection,
  isDedicatedSurfaceBlock,
  migrateLandingDocumentV1ToV2,
  toPatternNode,
} from "../document/landingComposition.js";
import { findCompositionNode, moveCompositionNode } from "../document/landingCompositionOperations.js";
import { enforceSiteFooterOrder, insertSectionWithFooterContract, inspectSiteFooter, sectionContainsSiteFooter } from "../document/landingOperations.js";
import { sameLandingDropTarget } from "./landingAutoScroll.js";

export const LANDING_DROP_OPERATION = "landing.drop";

export const LANDING_DROP_REFUSAL = Object.freeze({
  PAYLOAD_MISSING: "LANDING_DROP_PAYLOAD_MISSING",
  TARGET_MISSING: "LANDING_DROP_TARGET_MISSING",
  TARGET_KIND_INVALID: "LANDING_DROP_TARGET_KIND_INVALID",
  KIND_UNSUPPORTED: "LANDING_DROP_KIND_UNSUPPORTED",
  INCOMPATIBLE_TARGET: "LANDING_DROP_INCOMPATIBLE_TARGET",
  SECTION_NOT_FOUND: "LANDING_DROP_SECTION_NOT_FOUND",
  REGION_NOT_FOUND: "LANDING_DROP_REGION_NOT_FOUND",
  BLOCK_NOT_FOUND: "LANDING_DROP_BLOCK_NOT_FOUND",
  SECTION_LOCKED: "LANDING_DROP_SECTION_LOCKED",
  FOOTER_ALREADY_EXISTS: "LANDING_DROP_FOOTER_ALREADY_EXISTS",
  FOOTER_POSITION_LOCKED: "LANDING_DROP_FOOTER_POSITION_LOCKED",
  SHAPE_INVALID: "LANDING_DROP_SHAPE_INVALID",
});

export const LANDING_DROP_NOOP = Object.freeze({
  DOCUMENT_UNCHANGED: "LANDING_DROP_DOCUMENT_UNCHANGED",
});

const MESSAGES = Object.freeze({
  [LANDING_DROP_REFUSAL.PAYLOAD_MISSING]: "El arrastre no tiene un elemento válido.",
  [LANDING_DROP_REFUSAL.TARGET_MISSING]: "La zona de destino ya no existe.",
  [LANDING_DROP_REFUSAL.TARGET_KIND_INVALID]: "Esa zona de destino no es válida.",
  [LANDING_DROP_REFUSAL.KIND_UNSUPPORTED]: "Ese elemento no se puede arrastrar.",
  [LANDING_DROP_REFUSAL.INCOMPATIBLE_TARGET]: "Ese elemento no puede colocarse aquí.",
  [LANDING_DROP_REFUSAL.SECTION_NOT_FOUND]: "La sección ya no existe. Recarga la página.",
  [LANDING_DROP_REFUSAL.REGION_NOT_FOUND]: "La zona de destino ya no existe.",
  [LANDING_DROP_REFUSAL.BLOCK_NOT_FOUND]: "El elemento ya no existe.",
  [LANDING_DROP_REFUSAL.SECTION_LOCKED]: "El Footer siempre ocupa el final de la página.",
  [LANDING_DROP_REFUSAL.FOOTER_ALREADY_EXISTS]: "La página ya tiene un Footer.",
  [LANDING_DROP_REFUSAL.FOOTER_POSITION_LOCKED]: "El Footer siempre ocupa el final de la página.",
  [LANDING_DROP_REFUSAL.SHAPE_INVALID]: "La edición produciría un documento no válido.",
  [LANDING_DROP_NOOP.DOCUMENT_UNCHANGED]: "El elemento ya estaba en esa posición.",
});

// Document-independent drag payload kinds and drop target kinds. Exported so the
// drag encoding layer, the resolver and tests all agree on one table.
export const LANDING_DRAG_KINDS = Object.freeze(["palette-block", "palette-pattern", "block", "section"]);
export const LANDING_TARGET_KINDS = Object.freeze([
  "block-before",
  "block-after",
  "region-end",
  // Composition scope (schema v2). ONE boundary has exactly ONE owner, and the owner
  // is always the FOLLOWING node: `composition-before(index)` means "insert so that
  // the node currently at `index` ends up after me". The terminal boundary after the
  // last node is the same kind at `index === composition.length`, which keeps a single
  // owner rule instead of introducing a competing `composition-after` for the same edge.
  "composition-before",
  "section-before",
  "section-after",
  "canvas-end",
]);

const dragKinds = new Set(LANDING_DRAG_KINDS);
const targetKinds = new Set(LANDING_TARGET_KINDS);

const refuse = (code, message) => ({ ok: false, code, message: message || MESSAGES[code] || code });
const structuralRefusal = (verdict) => (!verdict || verdict.ok ? null : refuse(verdict.code, verdict.message));

// ---------------------------------------------------------------------------
// Compatibility: which payload may land on which kind of target.
// ---------------------------------------------------------------------------

export function isLandingDropPayload(payload) {
  return Boolean(payload) && dragKinds.has(payload.kind) && typeof payload.id === "string" && payload.id.length > 0;
}

export function isLandingDropTarget(target) {
  if (!target || !targetKinds.has(target.kind)) return false;
  // A composition boundary without an index is not a destination: the index IS the
  // boundary. Rejecting it here keeps a malformed zone from being advertised and then
  // refused at drop time.
  if (target.kind === "composition-before" && !Number.isInteger(target.index)) return false;
  return true;
}

export function isCompatibleLandingDrop(payload, target) {
  if (!isLandingDropPayload(payload) || !isLandingDropTarget(target)) return false;
  if (payload.kind === "section") return target.kind.startsWith("section-") && payload.id !== target.sectionId;
  if (payload.kind === "palette-pattern") return target.kind.startsWith("section-") || target.kind.startsWith("block-") || target.kind === "region-end" || target.kind === "canvas-end" || target.kind === "composition-before";
  // A palette element dropped on a Composition boundary becomes an INDEPENDENT
  // composition child of that area — a sibling of the Patterns, not a new Section and
  // not a member of any Pattern. A palette element dropped on a block/region line is
  // still the internal Pattern gesture.
  if (payload.kind === "palette-block") return target.kind === "composition-before" || target.kind === "block-before" || target.kind === "block-after" || target.kind === "region-end" || target.kind === "section-before" || target.kind === "section-after" || target.kind === "canvas-end";
  if (payload.kind === "block") return target.kind === "block-before" || target.kind === "block-after" || target.kind === "region-end" || target.kind === "composition-before";
  return false;
}

// ---------------------------------------------------------------------------
// Document lookups
// ---------------------------------------------------------------------------

// Region and block lookups must search BOTH shapes. In v1 a region lives directly on
// the Section; in v2 a Pattern's regions live inside a composition node. Missing the
// second case is what made internal insertion into a v2 Pattern unreachable.
const regionsOf = (section) => [
  ...(section.regions || []),
  ...(section.composition || []).flatMap((node) => (Array.isArray(node.regions) ? node.regions : [])),
];

const locateRegion = (document, regionId) => document.sections.flatMap(regionsOf).find((region) => region.id === regionId);
const locateRegionSection = (document, regionId) => document.sections.find((section) => regionsOf(section).some((region) => region.id === regionId));
const locateBlockRegion = (document, blockId) => document.sections.flatMap(regionsOf).find((region) => region.blocks.some((block) => block.id === blockId));

// An internal signal, never exported and never visible to callers: the resolver converts
// it into the public `{ ok:false, code, message }` refusal. Using a typed error keeps the
// mutation body's control flow honest — every early exit is labelled with *why* the
// document-dependent contract refused it, instead of collapsing into an untyped `null`
// that callers have to guess about. Defined here (not next to the applier) so the
// composition helpers below can refuse with the same typed signal.
const LANDING_REFUSAL = Symbol("landingDropRefusal");

function landRefusal(code, message) {
  const failure = refuse(code, message);
  const error = new Error(failure.message);
  error[LANDING_REFUSAL] = failure;
  return error;
}

// A dedicated Header/Footer Section: one Region holding exactly one surface block. It is
// a protected structure and can never be a composition area.
const isDedicatedSurfaceSection = (section) => Boolean(section)
  && section.regions?.length === 1
  && section.regions[0]?.blocks?.length === 1
  && isDedicatedSurfaceBlock(section.regions[0].blocks[0]);

// The composition area a drop targets, upgrading the document if the area is still a
// legacy v1 Section.
//
// This is the ONE place a v1 page becomes v2, and it is deliberately an explicit
// document mutation performed while applying a drop:
//   - never on render,
//   - never on load,
//   - never merely because a page was viewed,
//   - always as part of the same gesture that needed it.
//
// It migrates the whole document rather than one Section, because the schema forbids
// mixing shapes: a v2 Section beside a legacy one is `LEGACY_REGIONS_IN_V2`. The
// migration is the pure, tested v1 -> v2 conversion, so Header/Footer stay dedicated,
// Pattern appearance is preserved, and Pattern node ids are drawn from the caller's id
// factory — which is what makes the result deterministic for a given editor.
function materializeComposition(document, sectionId, createId) {
  const existing = document.sections.find((section) => section.id === sectionId);
  if (!existing) throw landRefusal(LANDING_DROP_REFUSAL.SECTION_NOT_FOUND);
  if (isCompositionSection(existing)) return document;
  if (isDedicatedSurfaceSection(existing)) throw landRefusal(LANDING_DROP_REFUSAL.SECTION_LOCKED);
  void createId;
  if (document.schema_version === LANDING_SCHEMA_VERSION_V2) {
    // v2 already, but this Section is neither a composition area nor a dedicated
    // surface: that shape is invalid and must not be silently repaired.
    throw landRefusal(LANDING_DROP_REFUSAL.SHAPE_INVALID, "La sección no es un área de composición.");
  }
  const upgraded = migrateLandingDocumentV1ToV2(document, { createId });
  if (!upgraded.sections.some((section) => section.id === sectionId && isCompositionSection(section))) {
    throw landRefusal(LANDING_DROP_REFUSAL.SHAPE_INVALID, "La sección no se pudo convertir en área de composición.");
  }
  return upgraded;
}

// Insert an independent composition node at an exact index. The node is never a
// Region child and never gets a Section of its own: it becomes a direct child of the
// area, a sibling of the Patterns.
function insertCompositionNodeAt(document, sectionId, index, node, createId) {
  const upgraded = materializeComposition(document, sectionId, createId);
  const section = upgraded.sections.find((candidate) => candidate.id === sectionId);
  if (!section || !Array.isArray(section.composition)) throw landRefusal(LANDING_DROP_REFUSAL.SECTION_NOT_FOUND);
  const at = Math.max(0, Math.min(index, section.composition.length));
  section.composition.splice(at, 0, node);
  return assertLandingDocument(upgraded);
}

// ---------------------------------------------------------------------------
// Feasibility: the document-dependent part of the decision.
//
// This mirrors the applier's own preconditions against the untouched source
// document, so a drop can never be advertised as valid and then refused, nor
// advertised as invalid and then applied. It never clones the document, so it is
// cheap enough to run for every candidate zone on every dragover tick.
// ---------------------------------------------------------------------------

export function inspectLandingDrop(document, payload, target) {
  if (!isLandingDropPayload(payload)) return { ok: false, code: LANDING_DROP_REFUSAL.PAYLOAD_MISSING };
  if (!target) return { ok: false, code: LANDING_DROP_REFUSAL.TARGET_MISSING };
  if (!isLandingDropTarget(target)) return { ok: false, code: LANDING_DROP_REFUSAL.TARGET_KIND_INVALID };
  if (!document?.sections) return { ok: false, code: LANDING_DROP_REFUSAL.SHAPE_INVALID };
  if (!isCompatibleLandingDrop(payload, target)) return { ok: false, code: LANDING_DROP_REFUSAL.INCOMPATIBLE_TARGET };

  if (payload.kind === "section") {
    const source = document.sections.find((section) => section.id === payload.id);
    if (!source) return { ok: false, code: LANDING_DROP_REFUSAL.SECTION_NOT_FOUND };
    if (!document.sections.some((section) => section.id === target.sectionId)) return { ok: false, code: LANDING_DROP_REFUSAL.SECTION_NOT_FOUND };
    if (sectionContainsSiteFooter(source)) return { ok: false, code: LANDING_DROP_REFUSAL.SECTION_LOCKED };
    return { ok: true };
  }

  if (payload.kind === "palette-block" && payload.id === "site_footer") {
    if (!target.regionId && !target.blockId && target.kind !== "canvas-end") return { ok: false, code: LANDING_DROP_REFUSAL.INCOMPATIBLE_TARGET };
    if (inspectSiteFooter(document).count) return { ok: false, code: LANDING_DROP_REFUSAL.FOOTER_ALREADY_EXISTS };
    return { ok: true };
  }

  // Composition scope. The destination is a visual composition AREA, and the drop
  // becomes an independent child of it. Feasibility is the document-side question
  // "could this area accept this node at this index?", answered without mutating.
  if (target.kind === "composition-before") {
    const section = document.sections.find((candidate) => candidate.id === target.sectionId);
    if (!section) return { ok: false, code: LANDING_DROP_REFUSAL.SECTION_NOT_FOUND };
    // A dedicated Header/Footer is a protected single surface, never a composition area.
    if (isDedicatedSurfaceSection(section)) return { ok: false, code: LANDING_DROP_REFUSAL.SECTION_LOCKED };
    if (!Number.isInteger(target.index) || target.index < 0) return { ok: false, code: LANDING_DROP_REFUSAL.SHAPE_INVALID };
    // The index is bounded by the length the area will have when the drop runs. A v1
    // Section has no composition array yet, but its whole region tree migrates into
    // exactly ONE implicit Pattern node — so its terminal boundary is at 1, not 0.
    // Bounding by 0 here is what made dropping below a legacy Pattern impossible.
    const length = Array.isArray(section.composition) ? section.composition.length : section.regions?.length ? 1 : 0;
    if (target.index > length) return { ok: false, code: LANDING_DROP_REFUSAL.SHAPE_INVALID };
    // Dragging an EXISTING composition node (an independent Block or a Pattern) to a
    // composition boundary is a move. Its feasibility is simply that the node exists:
    // the operation itself preserves every sibling.
    if (payload.kind === "block") {
      const located = findCompositionNode(document, payload.id);
      if (!located) return { ok: false, code: LANDING_DROP_REFUSAL.BLOCK_NOT_FOUND };
      return { ok: true };
    }
    return { ok: true };
  }

  if (payload.kind === "palette-block") {
    if (target.kind === "canvas-end") return { ok: true };
    // Standalone content: the element lands in a fresh normal Section next to the
    // boundary it was dropped on, so only that boundary has to exist.
    if (target.kind === "section-before" || target.kind === "section-after") {
      if (!target.sectionId) return { ok: false, code: LANDING_DROP_REFUSAL.SECTION_NOT_FOUND };
      if (!document.sections.some((section) => section.id === target.sectionId)) return { ok: false, code: LANDING_DROP_REFUSAL.SECTION_NOT_FOUND };
      return { ok: true };
    }
    if (!target.regionId) return { ok: false, code: LANDING_DROP_REFUSAL.REGION_NOT_FOUND };
    if (!locateRegion(document, target.regionId)) return { ok: false, code: LANDING_DROP_REFUSAL.REGION_NOT_FOUND };
    if (target.blockId && !locateBlockRegion(document, target.blockId)) return { ok: false, code: LANDING_DROP_REFUSAL.BLOCK_NOT_FOUND };
    return { ok: true };
  }

  if (payload.kind === "block") {
    const source = locateBlockRegion(document, payload.id);
    if (!source) return { ok: false, code: LANDING_DROP_REFUSAL.BLOCK_NOT_FOUND };
    const block = source.blocks.find((item) => item.id === payload.id);
    if (!block) return { ok: false, code: LANDING_DROP_REFUSAL.BLOCK_NOT_FOUND };
    // The dedicated Footer is the terminal structural boundary: it can never be
    // dragged out of its own section.
    if (block.type === "site_footer") return { ok: false, code: LANDING_DROP_REFUSAL.FOOTER_POSITION_LOCKED };
    if (!target.regionId) return { ok: false, code: LANDING_DROP_REFUSAL.REGION_NOT_FOUND };
    const targetRegion = locateRegion(document, target.regionId);
    if (!targetRegion) return { ok: false, code: LANDING_DROP_REFUSAL.REGION_NOT_FOUND };
    if (target.blockId && !targetRegion.blocks.some((item) => item.id === target.blockId)) return { ok: false, code: LANDING_DROP_REFUSAL.BLOCK_NOT_FOUND };
    return { ok: true };
  }

  // palette-pattern: the section itself is produced by the caller, so only the
  // destination can be inspected here. A Footer pattern stays feasible while the
  // document has no Footer yet; the applier then owns the placement contract.
  if (target.kind === "canvas-end") return { ok: true };
  if (target.blockId) {
    const owner = document.sections.find((section) => section.regions.some((region) => region.blocks.some((block) => block.id === target.blockId)));
    if (!owner) return { ok: false, code: LANDING_DROP_REFUSAL.BLOCK_NOT_FOUND };
    return { ok: true };
  }
  if (target.regionId) {
    if (!locateRegion(document, target.regionId)) return { ok: false, code: LANDING_DROP_REFUSAL.REGION_NOT_FOUND };
    return { ok: true };
  }
  if (target.sectionId) {
    if (!document.sections.some((section) => section.id === target.sectionId)) return { ok: false, code: LANDING_DROP_REFUSAL.SECTION_NOT_FOUND };
    return { ok: true };
  }
  return { ok: false, code: LANDING_DROP_REFUSAL.INCOMPATIBLE_TARGET };
}

// ---------------------------------------------------------------------------
// Decision cache.
//
// The interactive gate receives `(payload, target)` only, with no document, so
// the resolver publishes its document-aware verdict here, keyed by object
// identity: document -> payload -> target. Identity keys are safe because every
// mutation path replaces the document with a fresh immutable clone, and the drag
// layer reuses one payload object and one target object per gesture.
// ---------------------------------------------------------------------------

const decisions = new WeakMap();
const appliedDrops = new WeakMap();

const readDecision = (document, payload, target) => decisions.get(document)?.get(payload)?.get(target);

function writeDecision(document, payload, target, verdict) {
  if (!document || typeof document !== "object" || !payload || typeof payload !== "object" || !target || typeof target !== "object") return;
  let byPayload = decisions.get(document);
  if (!byPayload) { byPayload = new WeakMap(); decisions.set(document, byPayload); }
  let byTarget = byPayload.get(payload);
  if (!byTarget) { byTarget = new WeakMap(); byPayload.set(payload, byTarget); }
  byTarget.set(target, verdict);
}

// A target key aliasing the same request shape, so the applier can answer
// "was this drop a no-op?" for the target object the caller actually passed.
const keyForDrop = (document, payload, target) => {
  const existing = appliedDrops.get(document)?.get(payload);
  if (existing) for (const key of existing.keys()) if (key === target || sameLandingDropTarget(key, target)) return key;
  return target;
};

function writeRecord(document, payload, key, record) {
  if (!document || typeof document !== "object" || !payload || typeof payload !== "object" || !key || typeof key !== "object") return;
  let byPayload = appliedDrops.get(document);
  if (!byPayload) { byPayload = new WeakMap(); appliedDrops.set(document, byPayload); }
  let byTarget = byPayload.get(payload);
  if (!byTarget) { byTarget = new Map(); byPayload.set(payload, byTarget); }
  byTarget.set(key, record);
}

// Published feasibility verdict for the interactive gate. Returns `null` when the
// request was never inspected against this document, so the caller can fall back
// to the document-independent compatibility rules.
export function landingDropVerdict(document, payload, target) {
  const cached = readDecision(document, payload, target);
  if (cached) return cached.ok;
  return null;
}

// Whether the last applied drop for this exact request was a semantic no-op.
export function isLandingDropNoOp(document, payload, target) {
  const record = appliedDrops.get(document)?.get(payload)?.get(keyForDrop(document, payload, target));
  return record ? record.noOp : null;
}

export function isLandingDropApplied(document, payload, target) {
  const record = appliedDrops.get(document)?.get(payload)?.get(keyForDrop(document, payload, target));
  return record ? record.applied : null;
}

// ---------------------------------------------------------------------------
// Applicator: the only place a drop mutates structure. Preserved verbatim from
// the previous `applyLandingDrop` body so every existing placement, reorder and
// Footer invariant behaves identically.
// ---------------------------------------------------------------------------

const createSingleBlockSection = (block, createId) => ({ id: createId(), layout: "stack", regions: [{ id: createId(), span: 12, blocks: [block] }] });

function applyDrop(document, payload, target, { createPattern, createId }) {
  // --- Composition scope (schema v2) ---------------------------------------
  //
  // A primitive dropped on a Composition boundary becomes an INDEPENDENT child of that
  // visual area: a sibling of the Patterns, never a member of one, never wrapped in a
  // synthetic Region, and never given a Section of its own. This is the path that
  // replaces the old "one primitive => one giant Section" behaviour.
  //
  // If the area is still a legacy v1 Section, the same gesture upgrades the document
  // (see `materializeComposition`) — one operation, one history entry.
  if (target.kind === "composition-before") {
    const section = document.sections.find((candidate) => candidate.id === target.sectionId);
    if (!section) throw landRefusal(LANDING_DROP_REFUSAL.SECTION_NOT_FOUND);
    if (isDedicatedSurfaceSection(section)) throw landRefusal(LANDING_DROP_REFUSAL.SECTION_LOCKED);
    if (payload.kind === "section") throw landRefusal(LANDING_DROP_REFUSAL.INCOMPATIBLE_TARGET);
    if (!Number.isInteger(target.index) || target.index < 0) throw landRefusal(LANDING_DROP_REFUSAL.SHAPE_INVALID);

    if (payload.kind === "palette-block") {
      if (payload.id === "site_footer") throw landRefusal(LANDING_DROP_REFUSAL.INCOMPATIBLE_TARGET);
      const node = createPrimitiveBlock(payload.id, createId());
      return insertCompositionNodeAt(document, target.sectionId, target.index, node, createId);
    }

    if (payload.kind === "palette-pattern") {
      const pattern = createPattern?.(payload.id);
      if (!pattern) throw landRefusal(LANDING_DROP_REFUSAL.SHAPE_INVALID, "El patrón solicitado no existe.");
      if (sectionContainsSiteFooter(pattern)) {
        // The Footer is terminal by contract; it does not become a composition child.
        if (inspectSiteFooter(document).count) throw landRefusal(LANDING_DROP_REFUSAL.FOOTER_ALREADY_EXISTS);
        insertSectionWithFooterContract(document, pattern, document.sections.length);
        return assertLandingDocument(document);
      }
      const node = toPatternNode(pattern, payload.id, { createId });
      return insertCompositionNodeAt(document, target.sectionId, target.index, node, createId);
    }

    if (payload.kind === "block") {
      // Moving an EXISTING independent Block between composition positions. This is the
      // same node, so it is a move, not an insert: identity is preserved and no copy is
      // created. `index` is the position in the list the caller saw.
      const located = findCompositionNode(document, payload.id);
      if (!located) throw landRefusal(LANDING_DROP_REFUSAL.BLOCK_NOT_FOUND);
      if (located.sectionId === target.sectionId) {
        return moveCompositionNode(document, payload.id, target.sectionId, target.index);
      }
      // A Pattern is moved with the same operation, so a Pattern and a Block share one
      // code path and neither can disturb the other's siblings.
      return moveCompositionNode(document, payload.id, target.sectionId, target.index);
    }

    throw landRefusal(LANDING_DROP_REFUSAL.INCOMPATIBLE_TARGET);
  }

  if (payload.kind === "palette-block" && payload.id === "site_footer") {
    const section = createSingleBlockSection(createPrimitiveBlock("site_footer", createId()), createId);
    insertSectionWithFooterContract(document, section, document.sections.length);
    return assertLandingDocument(document);
  }

  if (payload.kind === "section") {
    const from = document.sections.findIndex((section) => section.id === payload.id);
    const targetIndex = document.sections.findIndex((section) => section.id === target.sectionId);
    if (from < 0 || targetIndex < 0) throw landRefusal(LANDING_DROP_REFUSAL.SECTION_NOT_FOUND);
    if (sectionContainsSiteFooter(document.sections[from])) throw landRefusal(LANDING_DROP_REFUSAL.SECTION_LOCKED);
    const [section] = document.sections.splice(from, 1);
    let insertion = document.sections.findIndex((item) => item.id === target.sectionId);
    if (target.kind === "section-after") insertion += 1;
    insertSectionWithFooterContract(document, section, insertion);
    return assertLandingDocument(document);
  }

  if (payload.kind === "palette-pattern") {
    const section = createPattern?.(payload.id);
    if (!section) throw landRefusal(LANDING_DROP_REFUSAL.SHAPE_INVALID, "El patrón solicitado no existe.");
    if (sectionContainsSiteFooter(section)) {
      if (inspectSiteFooter(document).count) throw landRefusal(LANDING_DROP_REFUSAL.FOOTER_ALREADY_EXISTS);
      insertSectionWithFooterContract(document, section, document.sections.length);
      return assertLandingDocument(document);
    }
    if (target.blockId) {
      const ownerIndex = document.sections.findIndex((item) => item.regions.some((region) => region.blocks.some((block) => block.id === target.blockId)));
      if (ownerIndex < 0) throw landRefusal(LANDING_DROP_REFUSAL.BLOCK_NOT_FOUND);
      const owner = document.sections[ownerIndex];
      if (sectionContainsSiteFooter(owner)) {
        insertSectionWithFooterContract(document, section, ownerIndex);
        return assertLandingDocument(document);
      }
      const ownerRegion = owner.regions.find((region) => region.blocks.some((block) => block.id === target.blockId));
      const blockIndex = ownerRegion.blocks.findIndex((block) => block.id === target.blockId);
      const splitIndex = blockIndex + (target.kind === "block-after" ? 1 : 0);

      if (owner.regions.length !== 1) {
        insertSectionWithFooterContract(document, section, ownerIndex + (target.kind === "block-after" ? 1 : 0));
        return assertLandingDocument(document);
      }
      if (splitIndex === 0) {
        insertSectionWithFooterContract(document, section, ownerIndex);
        return assertLandingDocument(document);
      }
      if (splitIndex === ownerRegion.blocks.length) {
        insertSectionWithFooterContract(document, section, ownerIndex + 1);
        return assertLandingDocument(document);
      }

      const trailing = structuredClone(owner);
      trailing.id = createId();
      trailing.regions[0].id = createId();
      trailing.regions[0].blocks = ownerRegion.blocks.splice(splitIndex);
      insertSectionWithFooterContract(document, section, ownerIndex + 1);
      insertSectionWithFooterContract(document, trailing, ownerIndex + 2);
      return assertLandingDocument(document);
    }
    let insertion = document.sections.length;
    if (target.regionId) {
      const ownerIndex = document.sections.findIndex((item) => item.regions.some((region) => region.id === target.regionId));
      if (ownerIndex >= 0) insertion = ownerIndex + 1;
    }
    if (target.sectionId) {
      insertion = document.sections.findIndex((item) => item.id === target.sectionId);
      if (target.kind === "section-after") insertion += 1;
    }
    insertSectionWithFooterContract(document, section, insertion);
    return assertLandingDocument(document);
  }

  // Standalone page content. A palette element dropped on a Section boundary is
  // not part of any Pattern: it becomes its own normal Section holding that single
  // element, placed exactly at the boundary the user aimed at. This is the only
  // difference from the `canvas-end` case, which appends that Section last.
  if (payload.kind === "palette-block" && (target.kind === "section-before" || target.kind === "section-after")) {
    const boundaryIndex = document.sections.findIndex((section) => section.id === target.sectionId);
    if (boundaryIndex < 0) throw landRefusal(LANDING_DROP_REFUSAL.SECTION_NOT_FOUND);
    const section = createSingleBlockSection(createPrimitiveBlock(payload.id, createId()), createId);
    insertSectionWithFooterContract(document, section, boundaryIndex + (target.kind === "section-after" ? 1 : 0));
    return assertLandingDocument(document);
  }

  if (payload.kind === "palette-block" && target.kind === "canvas-end") {
    const section = createSingleBlockSection(createPrimitiveBlock(payload.id, createId()), createId);
    insertSectionWithFooterContract(document, section, document.sections.length);
    return assertLandingDocument(document);
  }

  const targetRegion = locateRegion(document, target.regionId);
  if (!targetRegion) throw landRefusal(LANDING_DROP_REFUSAL.REGION_NOT_FOUND);
  const targetSection = locateRegionSection(document, target.regionId);
  if (sectionContainsSiteFooter(targetSection)) {
    if (payload.kind === "palette-block") {
      const section = createSingleBlockSection(createPrimitiveBlock(payload.id, createId()), createId);
      insertSectionWithFooterContract(document, section, targetSection ? document.sections.indexOf(targetSection) : document.sections.length);
      return assertLandingDocument(document);
    }
    const source = locateBlockRegion(document, payload.id);
    const block = source?.blocks.find((item) => item.id === payload.id);
    if (!source || !block) throw landRefusal(LANDING_DROP_REFUSAL.BLOCK_NOT_FOUND);
    if (block.type === "site_footer") throw landRefusal(LANDING_DROP_REFUSAL.FOOTER_POSITION_LOCKED);
    source.blocks.splice(source.blocks.findIndex((item) => item.id === payload.id), 1);
    const section = createSingleBlockSection(block, createId);
    insertSectionWithFooterContract(document, section, inspectSiteFooter(document).location?.sectionIndex ?? document.sections.length);
    return assertLandingDocument(document);
  }
  let insertion = targetRegion.blocks.length;
  if (target.blockId) {
    insertion = targetRegion.blocks.findIndex((block) => block.id === target.blockId);
    if (insertion < 0) throw landRefusal(LANDING_DROP_REFUSAL.BLOCK_NOT_FOUND);
    if (target.kind === "block-after") insertion += 1;
  }
  if (payload.kind === "palette-block") {
    targetRegion.blocks.splice(insertion, 0, createPrimitiveBlock(payload.id, createId()));
    return assertLandingDocument(document);
  }
  const source = locateBlockRegion(document, payload.id);
  if (!source) throw landRefusal(LANDING_DROP_REFUSAL.BLOCK_NOT_FOUND);
  const sourceIndex = source.blocks.findIndex((block) => block.id === payload.id);
  const [block] = source.blocks.splice(sourceIndex, 1);
  if (block.type === "site_footer") throw landRefusal(LANDING_DROP_REFUSAL.FOOTER_POSITION_LOCKED);
  // `insertion` was measured on the block list as it was *before* the splice
  // above. Removing the block shifts every later index down by one, so the
  // insertion point must be decremented — but only when the removal happened in
  // the very list we are about to insert into. For a cross-region or cross-
  // section move `source !== targetRegion`, there is no shift in the target list,
  // and `block-after(B)` / `block-before(B)` / `region-end` already name the exact
  // final position. Applying the adjustment there would place the block one slot
  // too late.
  if (source === targetRegion && sourceIndex < insertion) insertion -= 1;
  targetRegion.blocks.splice(Math.max(0, insertion), 0, block);
  return assertLandingDocument(document);
}

// ---------------------------------------------------------------------------
// Semantic equivalence. A drop that produces a document equal to the input is a
// no-op: it must not allocate a new document, history entry, dirty flag,
// revision or autosave.
// ---------------------------------------------------------------------------

function deepEqual(left, right) {
  if (left === right) return true;
  if (left === null || right === null || typeof left !== "object" || typeof right !== "object") return false;
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
    return left.every((value, index) => deepEqual(value, right[index]));
  }
  if (left instanceof Date || right instanceof Date) return left instanceof Date && right instanceof Date && left.getTime() === right.getTime();
  const keys = Object.keys(left);
  if (keys.length !== Object.keys(right).length) return false;
  return keys.every((key) => Object.prototype.hasOwnProperty.call(right, key) && deepEqual(left[key], right[key]));
}

const describeOperation = (payload, target, effect) => ({
  type: LANDING_DROP_OPERATION,
  effect,
  payload: { kind: payload.kind, id: payload.id },
  target: {
    kind: target.kind,
    ...(target.blockId ? { blockId: target.blockId } : {}),
    ...(target.sectionId ? { sectionId: target.sectionId } : {}),
    ...(target.regionId ? { regionId: target.regionId } : {}),
    // Composition targets carry the exact insertion index, so the recorded operation
    // states where the node went — which is what makes redo deterministic and lets a
    // later semantic operator (Orb) replay the decision without geometry.
    ...(Number.isInteger(target.index) ? { index: target.index } : {}),
  },
});

const effectOf = (payload, target) => {
  if (payload.kind === "section") return "move-section";
  if (payload.kind === "palette-pattern") return "insert-section";
  if (payload.kind === "block") return "move-block";
  if (target.kind === "composition-before") return "insert-block";
  return target.kind === "canvas-end" ? "insert-section" : "insert-block";
};

// ---------------------------------------------------------------------------
// Public resolver
//
// Options:
// - `createPattern(id)` supplies the Section a palette pattern resolves to. It is
//   the caller's own factory, must be pure, and signals "unknown pattern" by
//   returning a falsy value rather than throwing. The resolver never mutates or
//   inspects it beyond that call.
// - `createId()` supplies fresh document ids for inserted structure.
// ---------------------------------------------------------------------------

export function resolveLandingDrop(document, payload, candidate, options = {}) {
  const target = candidate;
  const { createPattern, createId = () => crypto.randomUUID() } = options;

  const payloadRefusal = describePayloadRefusal(payload);
  if (payloadRefusal) return payloadRefusal;
  if (!target) return refuse(LANDING_DROP_REFUSAL.TARGET_MISSING);
  if (!isLandingDropTarget(target)) return refuse(LANDING_DROP_REFUSAL.TARGET_KIND_INVALID);
  if (!isCompatibleLandingDrop(payload, target)) return refuse(LANDING_DROP_REFUSAL.INCOMPATIBLE_TARGET);

  const verdict = inspectLandingDrop(document, payload, target);
  writeDecision(document, payload, target, verdict);
  const refusal = structuralRefusal(verdict);
  if (refusal) return refusal;

  let next;
  try {
    next = structuredClone(document);
    enforceSiteFooterOrder(next);
  } catch {
    const failure = refuse(LANDING_DROP_REFUSAL.SHAPE_INVALID);
    writeRecord(document, payload, target, { applied: false, noOp: true, code: failure.code });
    return failure;
  }

  let applied;
  try {
    applied = applyDrop(next, payload, target, { createPattern, createId });
  } catch (error) {
    // Either the applicator labelled its own document-dependent refusal, or a
    // caller-supplied `createPattern` factory threw. A throwing factory is a
    // programming error rather than a refused drop, but the resolver still
    // reports instead of propagating it.
    const failure = error?.[LANDING_REFUSAL] || refuseShape(error);
    writeRecord(document, payload, target, { applied: false, noOp: true, code: failure.code });
    return failure;
  }

  if (deepEqual(applied, document)) {
    // Recognised, but the document is already in the requested shape.
    writeRecord(document, payload, target, { applied: false, noOp: true, code: LANDING_DROP_NOOP.DOCUMENT_UNCHANGED });
    return { ok: true, document, operation: { ...describeOperation(payload, target, effectOf(payload, target)), effect: "no-op" }, noOp: true, code: LANDING_DROP_NOOP.DOCUMENT_UNCHANGED };
  }

  writeRecord(document, payload, target, { applied: true, noOp: false, code: null });
  return { ok: true, document: applied, operation: describeOperation(payload, target, effectOf(payload, target)), noOp: false, code: null };
}

function refuseShape(error) {
  const message = typeof error?.message === "string" ? error.message : "";
  const code = message.split(":")[0].trim();
  if (code === "BUILDER_SITE_FOOTER_ALREADY_EXISTS") return refuse(LANDING_DROP_REFUSAL.FOOTER_ALREADY_EXISTS);
  if (code === "BUILDER_SITE_FOOTER_REQUIRES_DEDICATED_SECTION") return refuse(LANDING_DROP_REFUSAL.SECTION_LOCKED);
  return refuse(LANDING_DROP_REFUSAL.SHAPE_INVALID, message || MESSAGES[LANDING_DROP_REFUSAL.SHAPE_INVALID]);
}

function describePayloadRefusal(payload) {
  if (!payload || typeof payload !== "object") return refuse(LANDING_DROP_REFUSAL.PAYLOAD_MISSING);
  if (!dragKinds.has(payload.kind)) return refuse(LANDING_DROP_REFUSAL.KIND_UNSUPPORTED);
  if (typeof payload.id !== "string" || !payload.id.length) return refuse(LANDING_DROP_REFUSAL.PAYLOAD_MISSING);
  return null;
}

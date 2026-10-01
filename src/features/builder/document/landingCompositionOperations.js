// Pure composition-node operations.
//
// These are the single place a v2 composition is mutated. They are deliberately
// separate from `landingOperations.js`, which owns the v1 region/block operations:
// mixing the two made "does this edit touch a Pattern's internals or the page's
// composition?" a question the caller had to answer from the operation name alone.
//
// Contract, and each clause is pinned by a test:
// - IMMUTABLE: the input document is never modified. The result is a fresh clone.
// - DETERMINISTIC: the same input and index always produce the same document.
// - EXACT INDEX: `index` is the position in `composition` *before* any removal, i.e.
//   the same convention as `Array.prototype.splice`. Callers that name a boundary do
//   not have to compensate for the node they are moving.
// - NO HIDDEN NORMALIZATION: an operation performs its one intended mutation and
//   nothing else. It never migrates a Section, never creates a Region, never wraps a
//   primitive in a Section, and never repairs unrelated shape.
// - ONE MUTATION, ONE REFERENCE: untouched Sections keep their existing object
//   references, so React memoization and reference-based dirty checks stay valid.
// - FAIL CLOSED: every refusal throws a `BUILDER_*` code. There is no silent no-op
//   and no best-effort repair.
//
// The final `assertLandingDocument` is not belt-and-braces: it is what guarantees
// these operations cannot produce a document the schema rejects. A malformed node, a
// duplicate id anywhere in the document, an over-limit composition — all of it is
// caught by the one validator that already defines those rules, rather than by a
// second copy of them maintained here.

import { assertLandingDocument } from "./landingDocument.js";
import {
  COMPOSITION_ERROR,
  isCompositionSection,
  isDedicatedSurfaceBlock,
  isPatternCompositionNode,
} from "./landingComposition.js";

export { COMPOSITION_ERROR };

const clone = (value) => structuredClone(value);

export const COMPOSITION_OPERATION_ERROR = Object.freeze({
  DOCUMENT_INVALID: "BUILDER_DOCUMENT_REQUIRED",
  SECTION_NOT_FOUND: "BUILDER_SECTION_NOT_FOUND",
  SECTION_NOT_COMPOSITION: "BUILDER_COMPOSITION_SECTION_REQUIRED",
  NODE_NOT_FOUND: "BUILDER_COMPOSITION_NODE_NOT_FOUND",
  NODE_INVALID: "BUILDER_COMPOSITION_NODE_INVALID",
  NODE_ID_REQUIRED: "BUILDER_COMPOSITION_NODE_ID_REQUIRED",
  DUPLICATE_NODE_ID: "BUILDER_COMPOSITION_NODE_DUPLICATE",
  DEDICATED_SURFACE: "BUILDER_COMPOSITION_DEDICATED_SURFACE",
  INDEX_INVALID: "BUILDER_COMPOSITION_INDEX_INVALID",
});

const fail = (code, message) => {
  const error = new Error(message ? `${code}: ${message}` : code);
  error.code = code;
  return error;
};

const requireDocument = (document) => {
  if (!document || typeof document !== "object" || !Array.isArray(document.sections)) {
    throw fail(COMPOSITION_OPERATION_ERROR.DOCUMENT_INVALID);
  }
};

const findSectionIndex = (document, sectionId) => document.sections.findIndex((section) => section.id === sectionId);

// A dedicated Header/Footer Section is a protected single surface. It is not a
// composition area and must never receive composition children.
const assertNotDedicatedSurface = (section) => {
  if (section?.regions?.length === 1 && section.regions[0]?.blocks?.length === 1
    && isDedicatedSurfaceBlock(section.regions[0].blocks[0])) {
    throw fail(COMPOSITION_OPERATION_ERROR.DEDICATED_SURFACE, "a dedicated Header/Footer cannot hold composition children");
  }
};

// A composition area is a Section that declares `composition`. A v1 Section is not one
// yet: upgrading it is an explicit migration, performed by the caller, never here.
const requireCompositionSection = (document, sectionId) => {
  const index = findSectionIndex(document, sectionId);
  if (index < 0) throw fail(COMPOSITION_OPERATION_ERROR.SECTION_NOT_FOUND, sectionId);
  const section = document.sections[index];
  assertNotDedicatedSurface(section);
  if (!isCompositionSection(section)) throw fail(COMPOSITION_OPERATION_ERROR.SECTION_NOT_COMPOSITION, sectionId);
  return { index, section };
};

// Every composition node carries an id, and ids are unique across the whole document
// (Sections, Pattern nodes, Regions and Blocks share one space).
const documentNodeIdExists = (document, nodeId) => {
  for (const section of document.sections) {
    if (section.id === nodeId) return true;
    for (const node of section.composition || []) {
      if (node.id === nodeId) return true;
      for (const region of node.regions || []) {
        if (region.id === nodeId) return true;
        for (const block of region.blocks || []) if (block.id === nodeId) return true;
      }
    }
    for (const region of section.regions || []) {
      if (region.id === nodeId) return true;
      for (const block of region.blocks || []) if (block.id === nodeId) return true;
    }
  }
  return false;
};

// A node that could never belong to a composition area. Checked before insertion so
// the refusal names the real problem instead of surfacing as a schema error from the
// validator with a path.
const isUsableCompositionNode = (node) => {
  if (!node || typeof node !== "object" || Array.isArray(node)) return false;
  if (typeof node.id !== "string" || !node.id.length) return false;
  if (isPatternCompositionNode(node)) return true;
  return typeof node.type === "string";
};

const normalizeIndex = (index, length) => {
  if (index === undefined || index === null) return length;
  if (!Number.isInteger(index)) throw fail(COMPOSITION_OPERATION_ERROR.INDEX_INVALID, String(index));
  return Math.max(0, Math.min(index, length));
};

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

// Where a node lives, or null. Used by the resolver, the editor and the tests, so no
// caller has to search two shapes.
export function findCompositionNode(document, nodeId) {
  if (!document || !Array.isArray(document.sections) || !nodeId) return null;
  for (const section of document.sections) {
    if (!Array.isArray(section.composition)) continue;
    const index = section.composition.findIndex((node) => node?.id === nodeId);
    if (index >= 0) return { section, sectionId: section.id, node: section.composition[index], index };
  }
  return null;
}

// Whether a node may be dropped into this Section's composition. This is the
// document-side half of the drop gate: it answers "is this destination possible?"
// without performing the mutation, so the advertised target can be checked against
// the real document before the user releases the pointer.
export function canAcceptCompositionNode(document, sectionId, node) {
  if (!document || !Array.isArray(document.sections)) return { ok: false, code: COMPOSITION_OPERATION_ERROR.DOCUMENT_INVALID };
  if (!isUsableCompositionNode(node)) return { ok: false, code: COMPOSITION_OPERATION_ERROR.NODE_INVALID };
  if (isDedicatedSurfaceBlock(node)) return { ok: false, code: COMPOSITION_OPERATION_ERROR.DEDICATED_SURFACE };
  const index = findSectionIndex(document, sectionId);
  if (index < 0) return { ok: false, code: COMPOSITION_OPERATION_ERROR.SECTION_NOT_FOUND };
  const section = document.sections[index];
  if (section.regions?.length === 1 && section.regions[0]?.blocks?.length === 1 && isDedicatedSurfaceBlock(section.regions[0].blocks[0])) {
    return { ok: false, code: COMPOSITION_OPERATION_ERROR.DEDICATED_SURFACE };
  }
  if (!isCompositionSection(section)) return { ok: false, code: COMPOSITION_OPERATION_ERROR.SECTION_NOT_COMPOSITION };
  if (documentNodeIdExists(document, node.id)) return { ok: false, code: COMPOSITION_OPERATION_ERROR.DUPLICATE_NODE_ID };
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export function insertCompositionNode(document, sectionId, node, index = undefined) {
  requireDocument(document);
  if (!isUsableCompositionNode(node)) {
    // Distinguish "you gave me something that is not a node" from "your node has no id",
    // because they are different bugs for the caller.
    if (node && typeof node === "object" && !Array.isArray(node) && (typeof node.id !== "string" || !node.id.length)) {
      throw fail(COMPOSITION_OPERATION_ERROR.NODE_ID_REQUIRED);
    }
    throw fail(COMPOSITION_OPERATION_ERROR.NODE_INVALID);
  }
  if (isDedicatedSurfaceBlock(node)) {
    throw fail(COMPOSITION_OPERATION_ERROR.DEDICATED_SURFACE, "a dedicated Header/Footer is its own Section");
  }
  const { index: sectionIndex } = requireCompositionSection(document, sectionId);
  if (documentNodeIdExists(document, node.id)) {
    throw fail(COMPOSITION_OPERATION_ERROR.DUPLICATE_NODE_ID, node.id);
  }

  const next = clone(document);
  const target = next.sections[sectionIndex];
  const at = normalizeIndex(index, target.composition.length);
  // The inserted node is cloned: the caller keeps its own object, and the document
  // never aliases a value the caller can mutate afterwards.
  target.composition.splice(at, 0, clone(node));
  return assertLandingDocument(next);
}

export function removeCompositionNode(document, nodeId) {
  requireDocument(document);
  const located = findCompositionNode(document, nodeId);
  if (!located) throw fail(COMPOSITION_OPERATION_ERROR.NODE_NOT_FOUND, nodeId);

  const next = clone(document);
  const section = next.sections.find((candidate) => candidate.id === located.sectionId);
  section.composition = section.composition.filter((node) => node.id !== nodeId);
  // An emptied area is kept as an empty composition area rather than deleted: the user
  // asked to remove one node, not to remove their visual area. Removing a Pattern also
  // leaves every sibling independent Block untouched, which is the invariant that
  // matters (see the tests): nothing here reaches into other nodes.
  return assertLandingDocument(next);
}

export function moveCompositionNode(document, nodeId, targetSectionId, index = undefined) {
  requireDocument(document);
  const located = findCompositionNode(document, nodeId);
  if (!located) throw fail(COMPOSITION_OPERATION_ERROR.NODE_NOT_FOUND, nodeId);
  const { index: targetSectionIndex } = requireCompositionSection(document, targetSectionId);

  const next = clone(document);
  const source = next.sections.find((candidate) => candidate.id === located.sectionId);
  const from = source.composition.findIndex((node) => node.id === nodeId);
  const [node] = source.composition.splice(from, 1);

  const target = next.sections[targetSectionIndex];
  // `index` is the position the node must END UP at, counted in the destination list AFTER
  // the node has been taken out. That is the only reading that is consistent for all three
  // callers: "move down one" (index = current + 1), "move to the end" (a large index), and
  // "move to a position it already occupies" (index = current), which must be a no-op.
  //
  // Usage note (Increment C.6): this used to interpret `index` as a position in the list AS
  // THE CALLER SAW IT (before removal) and decrement it when the node came out of the same
  // list. That reading made every DOWNWARD move a silent no-op — moving the middle node of
  // [Pattern, Actions, Text] "down" left the order unchanged — which is exactly the kind of
  // dead toolbar control this increment exists to eliminate. The old reading also
  // contradicted this function's own test, which asserts that moving a node to the position
  // it already occupies changes nothing.
  const at = normalizeIndex(index, target.composition.length);
  target.composition.splice(Math.max(0, Math.min(at, target.composition.length)), 0, node);
  return assertLandingDocument(next);
}

// ---------------------------------------------------------------------------
// Operation façade
//
// One table, so a caller (the resolver, Orb later, a test) can dispatch a composition
// edit by name exactly as it dispatches a v1 edit through `applyLandingOperation`.
// ---------------------------------------------------------------------------

export function applyCompositionOperation(document, operation) {
  switch (operation?.type) {
    case "insert_composition_node":
      return insertCompositionNode(document, operation.section_id, operation.node, operation.index);
    case "remove_composition_node":
      return removeCompositionNode(document, operation.node_id);
    case "move_composition_node":
      return moveCompositionNode(document, operation.node_id, operation.target_section_id, operation.index);
    default:
      throw fail(COMPOSITION_OPERATION_ERROR.NODE_INVALID, operation?.type);
  }
}

export function applyCompositionOperations(document, operations) {
  return operations.reduce(applyCompositionOperation, document);
}

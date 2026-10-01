// Builder DnD V3 — D3 deterministic applier.
//
// PURE. No DOM, no geometry, no persistence, no resolver logic. Given a document and a DropIntent it
// returns either a new validated document or a typed refusal. Nothing else in D3 is allowed to
// change a document.
//
// It deliberately does NOT introduce a parallel mutation architecture: the single supported intent —
// INSERT_IN_COMPOSITION with a palette block — is performed by the EXISTING composition operations
// (insertCompositionNode, which itself calls materializeComposition for a v1 Section). For a v1
// document it delegates to the existing, tested resolveLandingDrop composition path rather than
// writing a second migration mechanism.
//
// D3 supports exactly one intent type. Everything else refuses with a typed code instead of being
// approximated, so widening the blast radius is a deliberate act rather than an accident.

import { DROP_INTENT, DROP_REFUSAL_CODE, isRefusal, makeIntent } from "./landingDropV3Intent.js";
import { createPrimitiveBlock, createLandingDocument } from "../document/landingDocument.js";
import { insertCompositionNode } from "../document/landingCompositionOperations.js";
import { resolveLandingDrop } from "./landingDropResolver.js";
import { validateLandingDocument } from "../document/landingDocument.js";

export const APPLY_ERROR = Object.freeze({
  INTENT_INVALID: "INTENT_INVALID",
  INTENT_UNSUPPORTED: "INTENT_UNSUPPORTED",
  PAYLOAD_UNSUPPORTED: "PAYLOAD_UNSUPPORTED",
  DOCUMENT_INVALID: "DOCUMENT_INVALID",
  SECTION_NOT_FOUND: "SECTION_NOT_FOUND",
  SECTION_LOCKED: "SECTION_LOCKED",
  ANCHOR_INVALID: "ANCHOR_INVALID",
  NODE_ID_REQUIRED: "NODE_ID_REQUIRED",
  OPERATION_FAILED: "OPERATION_FAILED",
  RESULT_INVALID: "RESULT_INVALID",
});

export const D3_SUPPORTED_INTENTS = Object.freeze([DROP_INTENT.INSERT_IN_COMPOSITION]);
export const D3_SUPPORTED_PAYLOAD_KIND = "palette-block";

// The element types this slice accepts. They are the acceptance elements from the D3 brief; anything
// else is refused rather than silently inserted, so adding a type is a reviewed change.
export const D3_SUPPORTED_BLOCK_TYPES = Object.freeze(["text", "action_group", "image"]);

const isPlainObject = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const isNonEmptyString = (value) => typeof value === "string" && value.length > 0;
const isIndex = (value) => Number.isInteger(value) && value >= 0;

const refusal = (code, because, detail) => ({
  ok: false,
  intent: isPlainObject(detail?.intent) ? detail.intent : null,
  code,
  because: because ?? "",
});

// A node is an INDEPENDENT composition child when it is a primitive block with no regions array —
// the same discriminator the read layer and the renderer use, so "independent" means one thing in
// this codebase.
const isIndependentCompositionNode = (node) => isPlainObject(node) && !Array.isArray(node.regions) && isNonEmptyString(node.id);

export function applyDropIntent(document, intent, { createId, now = null } = {}) {
  void now;
  if (!isPlainObject(intent)) return refusal(APPLY_ERROR.INTENT_INVALID, "the intent is not an object");
  if (isRefusal(intent)) return refusal(intent.code ?? DROP_REFUSAL_CODE.INPUT_INVALID, `the resolver refused: ${intent.because ?? ""}`);
  if (!D3_SUPPORTED_INTENTS.includes(intent.type)) {
    return refusal(APPLY_ERROR.INTENT_UNSUPPORTED, `${intent.type} is not implemented in this slice`, { intent });
  }
  if (typeof createId !== "function") return refusal(APPLY_ERROR.NODE_ID_REQUIRED, "a createId factory is required");

  const payload = intent.payload ?? null;
  if (!isPlainObject(payload) || payload.kind !== D3_SUPPORTED_PAYLOAD_KIND) {
    return refusal(APPLY_ERROR.PAYLOAD_UNSUPPORTED, `only ${D3_SUPPORTED_PAYLOAD_KIND} payloads are supported`, { intent });
  }
  if (!isNonEmptyString(payload.id) || !D3_SUPPORTED_BLOCK_TYPES.includes(payload.id)) {
    return refusal(APPLY_ERROR.PAYLOAD_UNSUPPORTED, `${payload.id} is not one of ${D3_SUPPORTED_BLOCK_TYPES.join(", ")}`, { intent });
  }
  if (!isPlainObject(document) || !Array.isArray(document.sections)) {
    return refusal(APPLY_ERROR.DOCUMENT_INVALID, "the document has no sections", { intent });
  }
  if (!isNonEmptyString(intent.sectionId)) return refusal(APPLY_ERROR.SECTION_NOT_FOUND, "the intent names no Section", { intent });
  const section = document.sections.find((candidate) => candidate?.id === intent.sectionId) ?? null;
  if (!section) return refusal(APPLY_ERROR.SECTION_NOT_FOUND, intent.sectionId, { intent });
  if (!isIndex(intent.anchorIndex)) return refusal(APPLY_ERROR.ANCHOR_INVALID, "the anchor index is not a non-negative integer", { intent });

  // v1 Section: the destination exists (D2 declares it at anchor 1) but the document has no
  // composition array yet, so there is nothing for insertCompositionNode to insert into. Rather than
  // writing a second migration path, delegate to the EXISTING composition drop path, which performs
  // materializeComposition (v1 -> v2) and the insertion in one validated step.
  const isLegacySection = !Array.isArray(section.composition);
  if (isLegacySection) {
    const legacyDecision = resolveLandingDrop(
      document,
      payload,
      { kind: "composition-before", sectionId: intent.sectionId, index: intent.anchorIndex },
      { createId },
    );
    if (!legacyDecision?.ok) {
      return refusal(APPLY_ERROR.OPERATION_FAILED, `the composition bootstrap refused: ${legacyDecision?.code ?? "unknown"}`, { intent });
    }
    const next = legacyDecision.document;
    const verdict = validateLandingDocument(next);
    if (!verdict.valid) return refusal(APPLY_ERROR.RESULT_INVALID, JSON.stringify(verdict.errors ?? []).slice(0, 300), { intent });
    const migratedSection = next.sections.find((candidate) => candidate?.id === intent.sectionId) ?? null;
    const inserted = migratedSection?.composition?.[intent.anchorIndex] ?? null;
    return {
      ok: true,
      document: next,
      sectionId: intent.sectionId,
      anchorIndex: intent.anchorIndex,
      insertedNodeId: inserted?.id ?? null,
      operation: "bootstrap-and-insert",
      migratedToV2: true,
    };
  }

  // v2 area: the plain, deterministic composition insertion.
  let node = null;
  try {
    node = createPrimitiveBlock(payload.id, createId());
  } catch (error) {
    return refusal(APPLY_ERROR.PAYLOAD_UNSUPPORTED, error?.message ?? "the block could not be created", { intent });
  }
  let next;
  try {
    next = insertCompositionNode(document, intent.sectionId, node, intent.anchorIndex);
  } catch (error) {
    return refusal(APPLY_ERROR.OPERATION_FAILED, error?.code ?? error?.message ?? "the composition operation failed", { intent });
  }
  const verdict = validateLandingDocument(next);
  if (!verdict.valid) return refusal(APPLY_ERROR.RESULT_INVALID, JSON.stringify(verdict.errors ?? []).slice(0, 300), { intent });

  // Post-conditions, asserted rather than assumed: the inserted node must be a DIRECT composition
  // child at the advertised anchor, and it must not be Pattern-owned content.
  const targetSection = next.sections.find((candidate) => candidate?.id === intent.sectionId) ?? null;
  const placed = targetSection?.composition?.[intent.anchorIndex] ?? null;
  if (!isIndependentCompositionNode(placed) || placed.id !== node.id) {
    return refusal(APPLY_ERROR.RESULT_INVALID, "the inserted node is not the independent composition child at the advertised anchor", { intent });
  }
  const patternOwned = (targetSection.composition ?? []).some((candidate) => Array.isArray(candidate?.regions)
    && candidate.regions.some((region) => (region?.blocks ?? []).some((block) => block?.id === node.id)));
  if (patternOwned) return refusal(APPLY_ERROR.RESULT_INVALID, "the inserted node ended up inside a Pattern", { intent });

  return {
    ok: true,
    document: next,
    sectionId: intent.sectionId,
    anchorIndex: intent.anchorIndex,
    insertedNodeId: node.id,
    operation: "insert-block",
    migratedToV2: false,
  };
}

// The selection the editor should end up with: the inserted primitive, addressed the way the
// existing selection model addresses an independent composition Block.
export const selectionForAppliedIntent = (result) => {
  if (!result?.ok || !isNonEmptyString(result.insertedNodeId)) return null;
  return { level: "block", sectionId: result.sectionId, blockId: result.insertedNodeId };
};

// Convenience for tests and for the adapter: build the intent shape the applier accepts.
export const compositionInsertIntent = ({ sectionId, anchorIndex, blockType }) => makeIntent(DROP_INTENT.INSERT_IN_COMPOSITION, {
  scope: "composition",
  sectionId,
  anchorIndex,
  payload: { kind: D3_SUPPORTED_PAYLOAD_KIND, id: blockType },
});

export { isIndependentCompositionNode as __isIndependentCompositionNode, createLandingDocument as __createLandingDocument };

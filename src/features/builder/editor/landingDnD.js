// Landing drag & drop interaction layer.
//
// Rule ownership moved to the deterministic model layer:
// `landingDropResolver.js` owns payload encoding rules, payload/target
// compatibility, the document-dependent feasibility verdict and the pure
// `resolveLandingDrop` decision. This module keeps the drag payload transport
// (MIME type, encode/decode) and the historical `applyLandingDrop` façade so the
// existing editor and tests keep working unchanged.

import {
  isCompatibleLandingDrop,
  isLandingDropPayload,
  landingDropVerdict,
  resolveLandingDrop,
} from "./landingDropResolver.js";

export {
  LANDING_DRAG_KINDS,
  LANDING_TARGET_KINDS,
  isCompatibleLandingDrop,
  isLandingDropPayload,
  isLandingDropTarget,
  resolveLandingDrop,
  inspectLandingDrop,
  isLandingDropApplied,
  isLandingDropNoOp,
  landingDropVerdict,
  LANDING_DROP_NOOP,
  LANDING_DROP_OPERATION,
  LANDING_DROP_REFUSAL,
} from "./landingDropResolver.js";

export const LANDING_DRAG_TYPE = "application/x-orvesen-landing-item";

export function encodeLandingDrag(payload) {
  if (!isLandingDropPayload(payload)) throw new Error("BUILDER_DRAG_PAYLOAD_INVALID");
  return JSON.stringify(payload);
}

export function decodeLandingDrag(value) {
  try {
    const payload = JSON.parse(value);
    return isLandingDropPayload(payload) ? payload : null;
  } catch { return null; }
}

// Interactive gate: "may this payload land on this candidate at all?".
//
// It is deliberately document-independent. When the caller passes the document
// the request is being evaluated against and the resolver has already published
// a document-aware verdict for that exact request, that verdict is authoritative,
// so the gate can never advertise a drop the resolver would refuse. Without a
// published verdict it falls back to the shared compatibility rules.
export function isValidLandingDrop(payload, target, document) {
  if (!isCompatibleLandingDrop(payload, target)) return false;
  const verdict = document ? landingDropVerdict(document, payload, target) : null;
  return verdict === null ? true : verdict === true;
}

// Compatibility façade over the deterministic resolver.
//
// Returns the resolved document: a new immutable document when the drop applied,
// or the *original reference* when the request was refused or resolved to a
// semantic no-op. Callers keep using reference identity to decide whether a
// mutation happened.
export function applyLandingDrop(document, payload, target, options = {}) {
  const result = resolveLandingDrop(document, payload, target, options);
  return result.ok ? result.document : document;
}

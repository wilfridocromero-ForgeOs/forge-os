import { assertLandingDocument, createPrimitiveBlock } from "../document/landingDocument.js";

export const LANDING_DRAG_TYPE = "application/x-orvesen-landing-item";
const clone = (value) => structuredClone(value);
const validKinds = new Set(["palette-block", "palette-pattern", "block", "section"]);
const validTargets = new Set(["block-before", "block-after", "region-end", "section-before", "section-after", "canvas-end"]);

export function encodeLandingDrag(payload) {
  if (!payload || !validKinds.has(payload.kind) || typeof payload.id !== "string") throw new Error("BUILDER_DRAG_PAYLOAD_INVALID");
  return JSON.stringify(payload);
}

export function decodeLandingDrag(value) {
  try {
    const payload = JSON.parse(value);
    return payload && validKinds.has(payload.kind) && typeof payload.id === "string" ? payload : null;
  } catch { return null; }
}

export function isValidLandingDrop(payload, target) {
  if (!payload || !target || !validTargets.has(target.kind)) return false;
  if (payload.kind === "section") return target.kind.startsWith("section-") && payload.id !== target.sectionId;
  if (payload.kind === "palette-pattern") return target.kind.startsWith("section-") || ["region-end", "canvas-end"].includes(target.kind);
  if (payload.kind === "palette-block") return ["block-before", "block-after", "region-end", "canvas-end"].includes(target.kind);
  if (payload.kind === "block") return ["block-before", "block-after", "region-end"].includes(target.kind);
  return false;
}

function locateRegion(document, regionId) {
  return document.sections.flatMap((section) => section.regions).find((region) => region.id === regionId);
}

function locateBlockRegion(document, blockId) {
  return document.sections.flatMap((section) => section.regions).find((region) => region.blocks.some((block) => block.id === blockId));
}

export function applyLandingDrop(document, payload, target, { createPattern, createId = () => crypto.randomUUID() } = {}) {
  if (!isValidLandingDrop(payload, target)) return document;
  const next = clone(document);
  if (payload.kind === "section") {
    const from = next.sections.findIndex((section) => section.id === payload.id);
    const targetIndex = next.sections.findIndex((section) => section.id === target.sectionId);
    if (from < 0 || targetIndex < 0) return document;
    const [section] = next.sections.splice(from, 1);
    let insertion = next.sections.findIndex((item) => item.id === target.sectionId);
    if (target.kind === "section-after") insertion += 1;
    next.sections.splice(insertion, 0, section);
    return assertLandingDocument(next);
  }
  if (payload.kind === "palette-pattern") {
    const section = createPattern?.(payload.id);
    if (!section) return document;
    let insertion = next.sections.length;
    if (target.sectionId) {
      insertion = next.sections.findIndex((item) => item.id === target.sectionId);
      if (target.kind === "section-after") insertion += 1;
    }
    next.sections.splice(insertion, 0, section);
    return assertLandingDocument(next);
  }
  if (payload.kind === "palette-block" && target.kind === "canvas-end") {
    next.sections.push({ id: createId(), layout: "stack", regions: [{ id: createId(), span: 12, blocks: [createPrimitiveBlock(payload.id, createId())] }] });
    return assertLandingDocument(next);
  }
  const targetRegion = locateRegion(next, target.regionId);
  if (!targetRegion) return document;
  let insertion = targetRegion.blocks.length;
  if (target.blockId) {
    insertion = targetRegion.blocks.findIndex((block) => block.id === target.blockId);
    if (insertion < 0) return document;
    if (target.kind === "block-after") insertion += 1;
  }
  if (payload.kind === "palette-block") {
    targetRegion.blocks.splice(insertion, 0, createPrimitiveBlock(payload.id, createId()));
    return assertLandingDocument(next);
  }
  const source = locateBlockRegion(next, payload.id);
  if (!source) return document;
  const sourceIndex = source.blocks.findIndex((block) => block.id === payload.id);
  const [block] = source.blocks.splice(sourceIndex, 1);
  if (source === targetRegion && sourceIndex < insertion) insertion -= 1;
  targetRegion.blocks.splice(Math.max(0, insertion), 0, block);
  return assertLandingDocument(next);
}

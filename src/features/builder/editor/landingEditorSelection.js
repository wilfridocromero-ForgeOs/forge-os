import { getHeaderElementId, getHeaderNavItemElementId, headerElementExists } from "./landingHeaderEditing.js";
import {
  findFooterElement,
  FOOTER_ELEMENT_TYPES,
  getFooterElementId,
  getFooterGroupElementId,
} from "./landingFooterEditing.js";

const SELECTION_LEVELS = new Set(["section", "group", "block", "element"]);
const runtimeElementIds = new WeakMap();
let runtimeElementSequence = 0;

const present = (value) => typeof value === "string" && value.length > 0;

export function getActionElementId(action, blockId = "block") {
  if (present(action?.id)) return action.id;
  if (!action || typeof action !== "object") return null;
  let id = runtimeElementIds.get(action);
  if (!id) {
    runtimeElementSequence += 1;
    id = `editor-button-${blockId}-${runtimeElementSequence}`;
    runtimeElementIds.set(action, id);
  }
  return id;
}

function actionBlocks(document) {
  const blocks = new Map();
  for (const section of document?.sections || []) for (const region of section.regions || []) {
    for (const block of region.blocks || []) if (block.type === "action_group") blocks.set(block.id, block);
  }
  return blocks;
}

const actionSignature = (action) => JSON.stringify(action);

export function carryActionElementIds(previousDocument, nextDocument) {
  const previousBlocks = actionBlocks(previousDocument);
  for (const [blockId, nextBlock] of actionBlocks(nextDocument)) {
    const previousBlock = previousBlocks.get(blockId);
    if (!previousBlock) continue;
    const previousActions = previousBlock.content?.actions || [];
    const nextActions = nextBlock.content?.actions || [];
    const appendedAction = nextActions.length === previousActions.length + 1 && previousActions.every(
      (action, index) => actionSignature(action) === actionSignature(nextActions[index]),
    );
    if (appendedAction) {
      previousActions.forEach((action, index) => {
        const nextAction = nextActions[index];
        if (nextAction && typeof nextAction === "object" && !present(nextAction.id)) {
          runtimeElementIds.set(nextAction, getActionElementId(action, blockId));
        }
      });
      continue;
    }
    if (previousActions.length !== nextActions.length) continue;
    const previous = previousActions.map((action, index) => ({
      action,
      id: getActionElementId(action, blockId),
      index,
      signature: actionSignature(action),
      used: false,
    }));
    const assignments = new Map();

    // Preserve the same slot first; then recognize unchanged actions that moved.
    nextActions.forEach((action, index) => {
      const candidate = previous[index];
      if (candidate && candidate.signature === actionSignature(action)) {
        candidate.used = true;
        assignments.set(index, candidate.id);
      }
    });
    nextActions.forEach((action, index) => {
      if (assignments.has(index)) return;
      const signature = actionSignature(action);
      const candidate = previous.find((item) => !item.used && item.signature === signature);
      if (candidate) {
        candidate.used = true;
        assignments.set(index, candidate.id);
      }
    });

    // A single edited action is unambiguous when the collection length is stable.
    const unmatchedPrevious = previous.filter((item) => !item.used);
    const unmatchedNext = nextActions.map((action, index) => ({ action, index })).filter(({ index }) => !assignments.has(index));
    if (unmatchedPrevious.length === 1 && unmatchedNext.length === 1) {
      unmatchedPrevious[0].used = true;
      assignments.set(unmatchedNext[0].index, unmatchedPrevious[0].id);
    }

    for (const [index, id] of assignments) {
      const action = nextActions[index];
      if (action && typeof action === "object" && !present(action.id)) runtimeElementIds.set(action, id);
    }
  }
  return nextDocument;
}

function locateSection(document, sectionId) {
  const section = (document?.sections || []).find((candidate) => candidate.id === sectionId);
  return section ? { section } : {};
}

function locateGroup(document, regionId) {
  for (const section of document?.sections || []) {
    const region = (section.regions || []).find((candidate) => candidate.id === regionId);
    if (region) return { section, region };
  }
  return {};
}

function locateBlock(document, blockId) {
  for (const section of document?.sections || []) for (const region of section.regions || []) {
    const block = (region.blocks || []).find((candidate) => candidate.id === blockId);
    if (block) return { section, region, block };
  }
  return {};
}

function locate(document, selection) {
  if (!document || !selection) return {};
  if (selection.level === "section") return locateSection(document, selection.sectionId);
  if (selection.level === "group") return locateGroup(document, selection.regionId);
  const found = locateBlock(document, selection.blockId);
  if (selection.level === "block" || !found.block) return found;
  if (selection.level === "element" && selection.elementType === "button" && found.block.type === "action_group") {
    const elementIndex = (found.block.content?.actions || []).findIndex(
      (action) => getActionElementId(action, found.block.id) === selection.elementId,
    );
    if (elementIndex >= 0) return { ...found, element: found.block.content.actions[elementIndex], elementIndex };
  }
  if (selection.level === "element" && selection.elementType === "nav_item" && found.block.type === "site_header") {
    const elementIndex = (found.block.content?.nav_items || []).findIndex(
      (item, index) => getHeaderNavItemElementId(item, found.block.id, index) === selection.elementId,
    );
    if (elementIndex >= 0 && found.block.content.nav_items[elementIndex].enabled) {
      return { ...found, element: found.block.content.nav_items[elementIndex], elementIndex };
    }
  }
  if (selection.level === "element" && found.block.type === "site_header") {
    const expectedId = getHeaderElementId(found.block.id, selection.elementType);
    if (expectedId === selection.elementId && headerElementExists(found.block.content, selection.elementType)) {
      const element = selection.elementType === "brand"
        ? { brand_name: found.block.content.brand_name, logo_url: found.block.content.logo_url, logo_size: found.block.content.logo_size }
        : selection.elementType === "navigation"
          ? found.block.content.nav_items
          : found.block.content.cta;
      return { ...found, element };
    }
  }
  if (selection.level === "element" && found.block.type === "site_footer") {
    const footerElement = findFooterElement(
      found.block.content,
      found.block.id,
      selection.elementType,
      selection.elementId,
    );
    if (
      [FOOTER_ELEMENT_TYPES.linkItem, FOOTER_ELEMENT_TYPES.legalItem].includes(selection.elementType)
      && footerElement.element?.enabled === false
    ) return found;
    return { ...found, ...footerElement };
  }
  return found;
}

export function createSectionSelection(sectionId) {
  return present(sectionId) ? { level: "section", sectionId } : null;
}

export function createGroupSelection(sectionId, regionId) {
  return present(sectionId) && present(regionId) ? { level: "group", sectionId, regionId } : null;
}

export function createBlockSelection(sectionId, regionId, blockId) {
  return present(sectionId) && present(regionId) && present(blockId)
    ? { level: "block", sectionId, regionId, blockId }
    : null;
}

export function createElementSelection({ sectionId, regionId, blockId, elementId, elementType }) {
  return [sectionId, regionId, blockId, elementId, elementType].every(present)
    ? { level: "element", sectionId, regionId, blockId, elementId, elementType }
    : null;
}

export function normalizeBuilderSelection(selection, document) {
  if (!selection) return null;
  if (SELECTION_LEVELS.has(selection.level)) {
    if (selection.level === "section") return createSectionSelection(selection.sectionId);
    if (selection.level === "group") return createGroupSelection(selection.sectionId, selection.regionId);
    if (selection.level === "block") return createBlockSelection(selection.sectionId, selection.regionId, selection.blockId);
    return createElementSelection(selection);
  }

  // Temporary compatibility for callers/tests created before the canonical hierarchy.
  if (selection.kind === "section" && present(selection.id)) return createSectionSelection(selection.id);
  if (selection.kind === "block" && present(selection.id)) {
    for (const section of document?.sections || []) for (const region of section.regions || []) {
      if (region.blocks?.some((block) => block.id === selection.id)) return createBlockSelection(section.id, region.id, selection.id);
    }
  }
  return null;
}

export function reconcileBuilderSelection(selection, document) {
  const normalized = normalizeBuilderSelection(selection, document);
  if (!normalized) return null;
  const found = locate(document, normalized);
  if (normalized.level === "section") return found.section ? createSectionSelection(found.section.id) : null;
  if (normalized.level === "group") return found.region
    ? createGroupSelection(found.section.id, found.region.id)
    : locateSection(document, normalized.sectionId).section ? createSectionSelection(normalized.sectionId) : null;
  if (normalized.level === "block") {
    if (found.block) return createBlockSelection(found.section.id, found.region.id, found.block.id);
    const group = createGroupSelection(normalized.sectionId, normalized.regionId);
    return locate(document, group).region ? group : locate(document, createSectionSelection(normalized.sectionId)).section ? createSectionSelection(normalized.sectionId) : null;
  }
  if (found.element) return createElementSelection({ sectionId: found.section.id, regionId: found.region.id, blockId: found.block.id, elementId: normalized.elementId, elementType: normalized.elementType });
  const block = found.block
    ? createBlockSelection(found.section.id, found.region.id, found.block.id)
    : createBlockSelection(normalized.sectionId, normalized.regionId, normalized.blockId);
  if (locate(document, block).block) return block;
  return reconcileBuilderSelection(block, document);
}

export function findBuilderSelection(document, selection) {
  const normalized = reconcileBuilderSelection(selection, document);
  if (!normalized || normalized.level !== normalizeBuilderSelection(selection, document)?.level) return null;
  return locate(document, normalized);
}

export function getSelectionPath(selection, document) {
  const normalized = reconcileBuilderSelection(selection, document);
  if (!normalized) return [];
  const found = locate(document, normalized);
  const path = [createSectionSelection(normalized.sectionId)];
  if (["group", "block", "element"].includes(normalized.level)) path.push(createGroupSelection(normalized.sectionId, normalized.regionId));
  if (["block", "element"].includes(normalized.level)) path.push(createBlockSelection(normalized.sectionId, normalized.regionId, normalized.blockId));
  if (normalized.level === "element" && normalized.elementType === "nav_item") {
    path.push(createElementSelection({
      sectionId: normalized.sectionId,
      regionId: normalized.regionId,
      blockId: normalized.blockId,
      elementId: getHeaderElementId(normalized.blockId, "navigation"),
      elementType: "navigation",
    }));
  }
  if (normalized.level === "element" && found.block?.type === "site_footer") {
    if ([FOOTER_ELEMENT_TYPES.linkGroup, FOOTER_ELEMENT_TYPES.linkItem].includes(normalized.elementType)) {
      path.push(createElementSelection({
        sectionId: normalized.sectionId,
        regionId: normalized.regionId,
        blockId: normalized.blockId,
        elementId: getFooterElementId(normalized.blockId, FOOTER_ELEMENT_TYPES.navigation),
        elementType: FOOTER_ELEMENT_TYPES.navigation,
      }));
    }
    if (normalized.elementType === FOOTER_ELEMENT_TYPES.linkItem && found.footerGroup) {
      path.push(createElementSelection({
        sectionId: normalized.sectionId,
        regionId: normalized.regionId,
        blockId: normalized.blockId,
        elementId: getFooterGroupElementId(found.footerGroup, normalized.blockId, found.footerGroupIndex),
        elementType: FOOTER_ELEMENT_TYPES.linkGroup,
      }));
    }
    if (normalized.elementType === FOOTER_ELEMENT_TYPES.legalItem) {
      path.push(createElementSelection({
        sectionId: normalized.sectionId,
        regionId: normalized.regionId,
        blockId: normalized.blockId,
        elementId: getFooterElementId(normalized.blockId, FOOTER_ELEMENT_TYPES.bottom),
        elementType: FOOTER_ELEMENT_TYPES.bottom,
      }));
    }
  }
  if (normalized.level === "element") path.push(normalized);
  return path.filter(Boolean);
}

export function selectParent(selection, document) {
  const path = getSelectionPath(selection, document);
  return path.length > 1 ? path.at(-2) : null;
}

export function resolveBuilderSelectionTarget(target) {
  if (!target?.closest) return null;
  if (target.closest("[data-builder-editor-control]")) return undefined;
  const selectable = target.closest("[data-builder-selectable][data-selection-level]");
  if (!selectable) return null;
  const level = selectable.dataset?.selectionLevel;
  const sectionId = selectable.dataset?.sectionId || selectable.closest('[data-selection-level="section"]')?.dataset?.sectionId;
  const regionId = selectable.dataset?.regionId || selectable.closest('[data-selection-level="group"]')?.dataset?.regionId;
  const blockId = selectable.dataset?.blockId || selectable.closest('[data-selection-level="block"]')?.dataset?.blockId;
  const { elementId, elementType } = selectable.dataset || {};
  const dedicatedSurfaceBlockId = selectable.dataset?.headerSurfaceBlockId || selectable.dataset?.footerSurfaceBlockId;
  const dedicatedSurfaceRegionId = selectable.dataset?.headerSurfaceRegionId || selectable.dataset?.footerSurfaceRegionId;
  if (level === "section" && present(dedicatedSurfaceBlockId)) {
    return createBlockSelection(sectionId, dedicatedSurfaceRegionId, dedicatedSurfaceBlockId);
  }
  if (level === "element") return createElementSelection({ sectionId, regionId, blockId, elementId, elementType });
  if (level === "block") return createBlockSelection(sectionId, regionId, blockId);
  if (level === "group") return createGroupSelection(sectionId, regionId);
  if (level === "section") return createSectionSelection(sectionId);
  return null;
}

export const resolveLandingCanvasSelection = resolveBuilderSelectionTarget;

import { applyLandingOperation, applyLandingOperations, enforceSiteFooterOrder, insertSectionWithFooterContract, inspectSiteFooter, sectionContainsSiteFooter } from "../document/landingOperations.js";
import { assertLandingDocument } from "../document/landingDocument.js";
import { carryActionElementIds, findBuilderSelection, normalizeBuilderSelection, reconcileBuilderSelection } from "./landingEditorSelection.js";
import { createMutationFailure } from "./landingMutationFailure.js";

const MAX_HISTORY = 100;
const clone = (value) => structuredClone(value);

export function createLandingEditorState(draft) {
  assertLandingDocument(draft.document);
  const document = clone(draft.document);
  const footer = inspectSiteFooter(document);
  const footerOrderChanged = footer.count === 1 && footer.location.sectionIndex !== document.sections.length - 1;
  enforceSiteFooterOrder(document);
  return { document, revision: draft.revision, past: [], future: [], selection: null, preview: "desktop", dirty: footerOrderChanged, lastGroup: null, lastChangedAt: 0, lastFailure: null };
}

function commit(state, document, group, at = Date.now()) {
  assertLandingDocument(document);
  carryActionElementIds(state.document, document);
  const grouped = group && group === state.lastGroup && at - state.lastChangedAt < 700;
  const past = grouped ? state.past : [...state.past, clone(state.document)].slice(-MAX_HISTORY);
  return { ...state, document, past, future: [], selection: reconcileBuilderSelection(state.selection, document), dirty: true, lastGroup: group || null, lastChangedAt: at, lastFailure: null };
}

// A refused mutation keeps the previous state exactly as it was — document,
// history, revision and dirty flag — and only records why it was refused.
function refuse(state, error, operation) {
  return { ...state, lastFailure: createMutationFailure(error, { operation }) };
}

export function landingEditorReducer(state, action) {
  switch (action.type) {
    case "select": return { ...state, selection: reconcileBuilderSelection(normalizeBuilderSelection(action.selection, state.document), state.document) };
    case "preview": return { ...state, preview: action.preview, selection: reconcileBuilderSelection(state.selection, state.document) };
    case "operation": try { return commit(state, applyLandingOperation(state.document, action.operation), action.group, action.at); } catch (error) { return refuse(state, error, action.operation); }
    case "operations": try { return commit(state, applyLandingOperations(state.document, action.operations), action.group, action.at); } catch (error) { return refuse(state, error, action.operations); }
    case "replace": try { return commit(state, enforceSiteFooterOrder(clone(action.document)), action.group, action.at); } catch (error) { return refuse(state, error, null); }
    case "clear_failure": return state.lastFailure === null ? state : { ...state, lastFailure: null };
    // A drop the deterministic resolver refused. Like any other refused mutation
    // it changes nothing else: no document, history, revision or dirty flag.
    case "drop_failure": return refuse(state, action.decision, action.operation);
    case "undo": if (!state.past.length) return state; else { const document = clone(state.past.at(-1)); carryActionElementIds(state.document, document); return { ...state, document, past: state.past.slice(0, -1), future: [clone(state.document), ...state.future].slice(0, MAX_HISTORY), selection: reconcileBuilderSelection(state.selection, document), dirty: true, lastGroup: null }; }
    case "redo": if (!state.future.length) return state; else { const document = clone(state.future[0]); carryActionElementIds(state.document, document); return { ...state, document, past: [...state.past, clone(state.document)].slice(-MAX_HISTORY), future: state.future.slice(1), selection: reconcileBuilderSelection(state.selection, document), dirty: true, lastGroup: null }; }
    case "saved": return action.document === state.document ? { ...state, revision: action.revision, dirty: false } : { ...state, revision: action.revision };
    case "remote": return createLandingEditorState(action.draft);
    default: return state;
  }
}

export function findEditorSelection(document, selection) {
  const found = findBuilderSelection(document, selection);
  if (!found) return null;
  if (selection?.level === "section" || selection?.kind === "section") return found.section;
  if (selection?.level === "group") return { ...found.section, section: found.section, region: found.region, regions: [found.region] };
  return found;
}

const freshId = () => crypto.randomUUID();
const renewBlock = (block) => ({ ...clone(block), id: freshId() });
export function duplicateEditorSelection(document, selection) {
  const next = clone(document);
  const normalized = normalizeBuilderSelection(selection, document);
  if (normalized?.level === "section") {
    const index = next.sections.findIndex((section) => section.id === normalized.sectionId); if (index < 0) return document;
    if (sectionContainsSiteFooter(next.sections[index])) return document;
    const copy = clone(next.sections[index]); copy.id = freshId(); copy.regions = copy.regions.map((region) => ({ ...region, id: freshId(), blocks: region.blocks.map(renewBlock) }));
    insertSectionWithFooterContract(next, copy, index + 1); return assertLandingDocument(next);
  }
  if (normalized?.level === "block") for (const section of next.sections) for (const region of section.regions) {
    const index = region.blocks.findIndex((block) => block.id === normalized.blockId); if (index >= 0) { if (region.blocks[index].type === "site_footer" || sectionContainsSiteFooter(section)) return document; region.blocks.splice(index + 1, 0, renewBlock(region.blocks[index])); return assertLandingDocument(next); }
  }
  return document;
}

export function moveEditorSelection(document, selection, delta) {
  const next = clone(document);
  const normalized = normalizeBuilderSelection(selection, document);
  if (normalized?.level === "section") {
    const index = next.sections.findIndex((section) => section.id === normalized.sectionId); const target = index + delta;
    if (index < 0 || target < 0 || target >= next.sections.length) return document;
    if (sectionContainsSiteFooter(next.sections[index])) return document;
    const [item] = next.sections.splice(index, 1); insertSectionWithFooterContract(next, item, target); return assertLandingDocument(next);
  }
  if (normalized?.level === "block") for (const section of next.sections) for (const region of section.regions) {
    const index = region.blocks.findIndex((block) => block.id === normalized.blockId); const target = index + delta;
    if (index >= 0) { if (region.blocks[index].type === "site_footer" || sectionContainsSiteFooter(section) || target < 0 || target >= region.blocks.length) return document; const [item] = region.blocks.splice(index, 1); region.blocks.splice(target, 0, item); return assertLandingDocument(next); }
  }
  return document;
}

import { applyLandingOperation, applyLandingOperations } from "../document/landingOperations.js";
import { assertLandingDocument } from "../document/landingDocument.js";

const MAX_HISTORY = 100;
const clone = (value) => structuredClone(value);

export function createLandingEditorState(draft) {
  assertLandingDocument(draft.document);
  return { document: clone(draft.document), revision: draft.revision, past: [], future: [], selection: null, preview: "desktop", dirty: false, lastGroup: null, lastChangedAt: 0 };
}

function commit(state, document, group, at = Date.now()) {
  assertLandingDocument(document);
  const grouped = group && group === state.lastGroup && at - state.lastChangedAt < 700;
  const past = grouped ? state.past : [...state.past, clone(state.document)].slice(-MAX_HISTORY);
  return { ...state, document, past, future: [], dirty: true, lastGroup: group || null, lastChangedAt: at };
}

function safely(state, producer) { try { return producer(); } catch { return state; } }

export function landingEditorReducer(state, action) {
  switch (action.type) {
    case "select": return { ...state, selection: action.selection };
    case "preview": return { ...state, preview: action.preview };
    case "operation": return safely(state, () => commit(state, applyLandingOperation(state.document, action.operation), action.group, action.at));
    case "operations": return safely(state, () => commit(state, applyLandingOperations(state.document, action.operations), action.group, action.at));
    case "replace": return safely(state, () => commit(state, clone(action.document), action.group, action.at));
    case "undo": if (!state.past.length) return state; else return { ...state, document: clone(state.past.at(-1)), past: state.past.slice(0, -1), future: [clone(state.document), ...state.future].slice(0, MAX_HISTORY), dirty: true, lastGroup: null };
    case "redo": if (!state.future.length) return state; else return { ...state, document: clone(state.future[0]), past: [...state.past, clone(state.document)].slice(-MAX_HISTORY), future: state.future.slice(1), dirty: true, lastGroup: null };
    case "saved": return action.document === state.document ? { ...state, revision: action.revision, dirty: false } : { ...state, revision: action.revision };
    case "remote": return createLandingEditorState(action.draft);
    default: return state;
  }
}

export function findEditorSelection(document, selection) {
  if (!selection) return null;
  if (selection.kind === "section") return document.sections.find((section) => section.id === selection.id) || null;
  for (const section of document.sections) for (const region of section.regions) {
    const block = region.blocks.find((item) => item.id === selection.id);
    if (block) return { block, section, region };
  }
  return null;
}

const freshId = () => crypto.randomUUID();
const renewBlock = (block) => ({ ...clone(block), id: freshId() });
export function duplicateEditorSelection(document, selection) {
  const next = clone(document);
  if (selection?.kind === "section") {
    const index = next.sections.findIndex((section) => section.id === selection.id); if (index < 0) return document;
    const copy = clone(next.sections[index]); copy.id = freshId(); copy.regions = copy.regions.map((region) => ({ ...region, id: freshId(), blocks: region.blocks.map(renewBlock) }));
    next.sections.splice(index + 1, 0, copy); return assertLandingDocument(next);
  }
  if (selection?.kind === "block") for (const section of next.sections) for (const region of section.regions) {
    const index = region.blocks.findIndex((block) => block.id === selection.id); if (index >= 0) { region.blocks.splice(index + 1, 0, renewBlock(region.blocks[index])); return assertLandingDocument(next); }
  }
  return document;
}

export function moveEditorSelection(document, selection, delta) {
  const next = clone(document);
  if (selection?.kind === "section") {
    const index = next.sections.findIndex((section) => section.id === selection.id); const target = index + delta;
    if (index < 0 || target < 0 || target >= next.sections.length) return document;
    const [item] = next.sections.splice(index, 1); next.sections.splice(target, 0, item); return assertLandingDocument(next);
  }
  if (selection?.kind === "block") for (const section of next.sections) for (const region of section.regions) {
    const index = region.blocks.findIndex((block) => block.id === selection.id); const target = index + delta;
    if (index >= 0) { if (target < 0 || target >= region.blocks.length) return document; const [item] = region.blocks.splice(index, 1); region.blocks.splice(target, 0, item); return assertLandingDocument(next); }
  }
  return document;
}

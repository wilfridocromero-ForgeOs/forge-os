import assert from "node:assert/strict";
import test from "node:test";
import { createLandingDocument } from "../document/landingDocument.js";
import { createHeroPattern } from "../document/landingPatterns.js";
import { createLandingEditorState, duplicateEditorSelection, landingEditorReducer, moveEditorSelection } from "./landingEditorState.js";

const draft = () => ({ revision: 4, document: { ...createLandingDocument(), sections: [createHeroPattern(), createHeroPattern()] } });

test("editor history groups typing and supports undo/redo without mutating the draft", () => {
  const input = draft();
  const block = input.document.sections[0].regions[0].blocks[0];
  let state = createLandingEditorState(input);
  state = landingEditorReducer(state, { type: "operation", operation: { type: "update_block_content", block_id: block.id, changes: { text: "A" } }, group: "typing", at: 100 });
  state = landingEditorReducer(state, { type: "operation", operation: { type: "update_block_content", block_id: block.id, changes: { text: "AB" } }, group: "typing", at: 200 });
  assert.equal(state.past.length, 1);
  assert.equal(input.document.sections[0].regions[0].blocks[0].content.text, "Una propuesta clara para avanzar");
  state = landingEditorReducer(state, { type: "undo" });
  assert.equal(state.document.sections[0].regions[0].blocks[0].content.text, "Una propuesta clara para avanzar");
  state = landingEditorReducer(state, { type: "redo" });
  assert.equal(state.document.sections[0].regions[0].blocks[0].content.text, "AB");
});

test("preview and selection remain editor-only state", () => {
  const state = createLandingEditorState(draft());
  const selected = landingEditorReducer(state, { type: "select", selection: { kind: "section", id: state.document.sections[0].id } });
  const mobile = landingEditorReducer(selected, { type: "preview", preview: "mobile" });
  assert.deepEqual(mobile.document, state.document);
  assert.equal(mobile.preview, "mobile");
  assert.equal(mobile.dirty, false);
});

test("duplicate and reorder create valid immutable documents with fresh ids", () => {
  const state = createLandingEditorState(draft());
  const firstId = state.document.sections[0].id;
  const duplicated = duplicateEditorSelection(state.document, { kind: "section", id: firstId });
  assert.equal(duplicated.sections.length, 3);
  assert.notEqual(duplicated.sections[1].id, firstId);
  assert.notEqual(duplicated.sections[1].regions[0].blocks[0].id, state.document.sections[0].regions[0].blocks[0].id);
  const moved = moveEditorSelection(duplicated, { kind: "section", id: firstId }, 1);
  assert.equal(moved.sections[1].id, firstId);
  assert.equal(state.document.sections.length, 2);
});

test("action alignment remains in the canonical document across save and reload", () => {
  const initial = draft();
  const action = initial.document.sections[0].regions[0].blocks.find((block) => block.type === "action_group");
  let state = createLandingEditorState(initial);
  state = landingEditorReducer(state, { type: "operation", operation: { type: "update_block_style", block_id: action.id, changes: { align: "center" } }, group: "style" });
  const reloaded = createLandingEditorState({ revision: 5, document: structuredClone(state.document) });
  const persisted = reloaded.document.sections[0].regions[0].blocks.find((block) => block.id === action.id);
  assert.equal(persisted.style.align, "center");
});

import assert from "node:assert/strict";
import test from "node:test";
import { createLandingDocument, createPrimitiveBlock, validateLandingDocument } from "../document/landingDocument.js";
import { createHeroPattern, createLandingPattern } from "../document/landingPatterns.js";
import { createLandingEditorState, duplicateEditorSelection, landingEditorReducer, moveEditorSelection } from "./landingEditorState.js";
import { createBlockSelection, createElementSelection, createGroupSelection, createSectionSelection, getActionElementId } from "./landingEditorSelection.js";
import { resetHeaderNavItemStyle, updateHeaderNavItemStyle, updateHeaderNavStyle } from "./landingHeaderEditing.js";

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
  const selected = landingEditorReducer(state, { type: "select", selection: createSectionSelection(state.document.sections[0].id) });
  const mobile = landingEditorReducer(selected, { type: "preview", preview: "mobile" });
  assert.deepEqual(mobile.document, state.document);
  assert.deepEqual(mobile.selection, selected.selection);
  assert.equal(selected.revision, state.revision);
  assert.equal(selected.dirty, false);
  assert.equal(mobile.preview, "mobile");
  assert.equal(mobile.dirty, false);
});

test("granular selection is serializable and never dirties or revisions the document", () => {
  const state = createLandingEditorState(draft());
  const section = state.document.sections[0];
  const region = section.regions[0];
  const block = region.blocks.find((item) => item.type === "action_group");
  const elementId = getActionElementId(block.content.actions[0], block.id);
  const selection = createElementSelection({ sectionId: section.id, regionId: region.id, blockId: block.id, elementId, elementType: "button" });
  const selected = landingEditorReducer(state, { type: "select", selection });
  assert.doesNotThrow(() => JSON.stringify(selected.selection));
  assert.deepEqual(selected.document, state.document);
  assert.equal(selected.revision, state.revision);
  assert.equal(selected.dirty, false);
});

test("selected Button keeps its session identity through immutable content edits", () => {
  let state = createLandingEditorState(draft());
  const section = state.document.sections[0];
  const region = section.regions[0];
  const block = region.blocks.find((item) => item.type === "action_group");
  const elementId = getActionElementId(block.content.actions[0], block.id);
  state = landingEditorReducer(state, { type: "select", selection: createElementSelection({ sectionId: section.id, regionId: region.id, blockId: block.id, elementId, elementType: "button" }) });
  state = landingEditorReducer(state, { type: "operation", operation: { type: "update_block_content", block_id: block.id, changes: { actions: [{ ...block.content.actions[0], label: "Continuar" }] } } });
  assert.equal(state.selection.level, "element");
  assert.equal(state.selection.elementId, elementId);
  assert.equal("id" in state.document.sections[0].regions[0].blocks.find((item) => item.id === block.id).content.actions[0], false);
});

test("removing a selected legacy Button falls back to its Actions Block", () => {
  const input = draft();
  const block = input.document.sections[0].regions[0].blocks.find((item) => item.type === "action_group");
  block.content.actions.push(structuredClone(block.content.actions[0]));
  let state = createLandingEditorState(input);
  const section = state.document.sections[0];
  const region = section.regions[0];
  const selectedBlock = region.blocks.find((item) => item.id === block.id);
  const elementId = getActionElementId(selectedBlock.content.actions[0], selectedBlock.id);
  state = landingEditorReducer(state, { type: "select", selection: createElementSelection({ sectionId: section.id, regionId: region.id, blockId: selectedBlock.id, elementId, elementType: "button" }) });
  state = landingEditorReducer(state, { type: "operation", operation: { type: "update_block_content", block_id: selectedBlock.id, changes: { actions: [structuredClone(selectedBlock.content.actions[1])] } } });
  assert.deepEqual(state.selection, createBlockSelection(section.id, region.id, selectedBlock.id));
});

test("structural deletion reconciles stale block selection to its valid Group", () => {
  let state = createLandingEditorState(draft());
  const section = state.document.sections[0];
  const region = section.regions[0];
  const block = region.blocks[0];
  state = landingEditorReducer(state, { type: "select", selection: createBlockSelection(section.id, region.id, block.id) });
  state = landingEditorReducer(state, { type: "operation", operation: { type: "remove_block", block_id: block.id } });
  assert.deepEqual(state.selection, createGroupSelection(section.id, region.id));
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

test("Header Nav global style, item override and reset survive confirmed-document roundtrips", () => {
  const initial = draft();
  const region = initial.document.sections[0].regions[0];
  const header = createPrimitiveBlock("site_header", "99999999-9999-4999-8999-999999999999");
  region.blocks.push(header);
  let state = createLandingEditorState(initial);

  let content = updateHeaderNavStyle(header.content, {
    font_family: "sans",
    font_size: "lg",
    background: "surface",
    border: "subtle",
    radius: "pill",
  });
  content = updateHeaderNavItemStyle(content, "nav-contacto", {
    font_weight: "bold",
    background: "primary",
  });
  state = landingEditorReducer(state, {
    type: "operation",
    operation: {
      type: "update_block_content",
      block_id: header.id,
      changes: { nav_style: content.nav_style, nav_items: content.nav_items },
    },
    group: "header-nav",
  });
  assert.equal(state.dirty, true);
  assert.deepEqual(validateLandingDocument(state.document), { valid: true, errors: [] });

  const afterReload = createLandingEditorState({ revision: 5, document: structuredClone(state.document) });
  const persisted = afterReload.document.sections[0].regions[0].blocks.find((block) => block.id === header.id);
  assert.deepEqual(persisted.content.nav_style, content.nav_style);
  assert.deepEqual(persisted.content.nav_items.find((item) => item.id === "nav-contacto").style, {
    font_weight: "bold",
    background: "primary",
  });

  const reset = resetHeaderNavItemStyle(persisted.content, "nav-contacto");
  state = landingEditorReducer(afterReload, {
    type: "operation",
    operation: {
      type: "update_block_content",
      block_id: header.id,
      changes: { nav_items: reset.nav_items },
    },
    group: "header-nav-item-reset",
  });
  const afterResetReload = createLandingEditorState({ revision: 6, document: structuredClone(state.document) });
  const resetItem = afterResetReload.document.sections[0].regions[0].blocks.find((block) => block.id === header.id).content.nav_items.find((item) => item.id === "nav-contacto");
  assert.equal("style" in resetItem, false);
  assert.equal(resetItem.label, "Contacto");
  assert.deepEqual(resetItem.target, { type: "section", anchor: "contacto" });
  assert.equal(resetItem.enabled, true);
  assert.deepEqual(validateLandingDocument(afterResetReload.document), { valid: true, errors: [] });
});

test("heading can reach a real empty string and undo/redo preserves it", () => {
  const initial = draft(); const heading = initial.document.sections[0].regions[0].blocks.find((block) => block.type === "heading");
  let state = createLandingEditorState(initial);
  for (const [index, text] of ["abc", "ab", "a", ""].entries()) state = landingEditorReducer(state, { type: "operation", operation: { type: "update_block_content", block_id: heading.id, changes: { text } }, group: "typing", at: 1000 + index * 800 });
  assert.equal(state.document.sections[0].regions[0].blocks.find((block) => block.id === heading.id).content.text, "");
  assert.match(JSON.stringify(state.document), /"text":""/);
  state = landingEditorReducer(state, { type: "undo" }); assert.equal(state.document.sections[0].regions[0].blocks.find((block) => block.id === heading.id).content.text, "a");
  state = landingEditorReducer(state, { type: "redo" }); assert.equal(state.document.sections[0].regions[0].blocks.find((block) => block.id === heading.id).content.text, "");
});

test("editor duplicate and move helpers preserve the unique final Footer boundary", () => {
  const footer = createLandingPattern("footer_simple");
  const document = { ...createLandingDocument(), sections:[createHeroPattern(),footer] };
  const footerBlock = footer.regions[0].blocks[0];

  assert.equal(duplicateEditorSelection(document,createSectionSelection(footer.id)),document);
  assert.equal(duplicateEditorSelection(document,createBlockSelection(footer.id,footer.regions[0].id,footerBlock.id)),document);
  assert.equal(moveEditorSelection(document,createSectionSelection(footer.id),-1),document);
  assert.equal(moveEditorSelection(document,createBlockSelection(footer.id,footer.regions[0].id,footerBlock.id),-1),document);

  const contentSection = document.sections[0];
  const cannotCross = moveEditorSelection(document,createSectionSelection(contentSection.id),1);
  assert.equal(cannotCross.sections.at(-1).id,footer.id);
  assert.equal(cannotCross.sections.at(-2).id,contentSection.id);

  const duplicateContent = duplicateEditorSelection(document,createSectionSelection(contentSection.id));
  assert.equal(duplicateContent.sections.at(-1).id,footer.id);
  assert.equal(duplicateContent.sections.length,3);
});

test("editor load moves one misplaced site Footer to the final boundary and marks the canonical document dirty", () => {
  const first = createHeroPattern();
  const footer = createLandingPattern("footer_simple");
  const trailing = createHeroPattern();
  const input = { revision: 9, document: { ...createLandingDocument(), sections:[first,footer,trailing] } };
  const original = structuredClone(input.document);

  const state = createLandingEditorState(input);

  assert.deepEqual(state.document.sections.map((section) => section.id), [first.id,trailing.id,footer.id]);
  assert.deepEqual(state.document.sections.at(-1), original.sections[1]);
  assert.deepEqual(input.document, original);
  assert.equal(state.revision, 9);
  assert.equal(state.dirty, true);
  assert.deepEqual(state.past, []);
  assert.deepEqual(state.future, []);
});

test("editor load leaves an already-final site Footer clean", () => {
  const first = createHeroPattern();
  const footer = createLandingPattern("footer_simple");
  const input = { revision: 10, document: { ...createLandingDocument(), sections:[first,footer] } };

  const state = createLandingEditorState(input);

  assert.deepEqual(state.document, input.document);
  assert.notEqual(state.document, input.document);
  assert.equal(state.dirty, false);
});

test("editor ingress rejects duplicate or mixed Footer structures and canonicalizes replace", () => {
  const first = createHeroPattern();
  const footer = createLandingPattern("footer_simple");
  const duplicate = createLandingPattern("footer_business");
  assert.throws(()=>createLandingEditorState({revision:1,document:{...createLandingDocument(),sections:[first,footer,duplicate]}}),/BUILDER_SITE_FOOTER_ALREADY_EXISTS/);

  const mixed = structuredClone(footer);
  mixed.regions[0].blocks.push(createPrimitiveBlock("text","60000000-0000-4000-8000-000000000010"));
  assert.throws(()=>createLandingEditorState({revision:1,document:{...createLandingDocument(),sections:[first,mixed]}}),/BUILDER_SITE_FOOTER_REQUIRES_DEDICATED_SECTION/);

  const state = createLandingEditorState({revision:2,document:{...createLandingDocument(),sections:[first,footer]}});
  const trailing = createHeroPattern();
  const replaced = landingEditorReducer(state,{type:"replace",document:{...createLandingDocument(),sections:[footer,trailing]},group:"replace",at:10});
  assert.deepEqual(replaced.document.sections.map((section)=>section.id),[trailing.id,footer.id]);
  assert.equal(replaced.dirty,true);
});

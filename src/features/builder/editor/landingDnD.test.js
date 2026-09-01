import assert from "node:assert/strict";
import test from "node:test";
import { createLandingDocument } from "../document/landingDocument.js";
import { createHeroPattern } from "../document/landingPatterns.js";
import { applyLandingDrop, decodeLandingDrag, encodeLandingDrag, isValidLandingDrop } from "./landingDnD.js";
import { createLandingEditorState, landingEditorReducer } from "./landingEditorState.js";

const documentWithSections = () => ({ ...createLandingDocument(), sections: [createHeroPattern(), createHeroPattern()] });

test("drag payload is typed and malformed payloads fail closed", () => {
  const payload = { kind: "palette-block", id: "heading" };
  assert.deepEqual(decodeLandingDrag(encodeLandingDrag(payload)), payload);
  assert.equal(decodeLandingDrag("not-json"), null);
  assert.equal(isValidLandingDrop({ kind: "section", id: "a" }, { kind: "region-end", regionId: "b" }), false);
});

test("palette blocks insert before, after and at region end", () => {
  const input = documentWithSections(); const region = input.sections[0].regions[0]; const target = region.blocks[1];
  const before = applyLandingDrop(input, { kind: "palette-block", id: "text" }, { kind: "block-before", blockId: target.id, regionId: region.id }, { createId: () => "00000000-0000-4000-8000-000000000001" });
  assert.equal(before.sections[0].regions[0].blocks[1].id, "00000000-0000-4000-8000-000000000001");
  const end = applyLandingDrop(before, { kind: "palette-block", id: "heading" }, { kind: "region-end", regionId: region.id }, { createId: () => "00000000-0000-4000-8000-000000000002" });
  assert.equal(end.sections[0].regions[0].blocks.at(-1).id, "00000000-0000-4000-8000-000000000002");
  assert.equal(input.sections[0].regions[0].blocks.length, 3);
});

test("an empty canvas accepts a palette block by creating canonical structure", () => {
  const ids = ["00000000-0000-4000-8000-000000000011", "00000000-0000-4000-8000-000000000012", "00000000-0000-4000-8000-000000000013"];
  const result = applyLandingDrop(createLandingDocument(), { kind: "palette-block", id: "heading" }, { kind: "canvas-end" }, { createId: () => ids.shift() });
  assert.equal(result.sections.length, 1);
  assert.equal(result.sections[0].regions[0].blocks[0].type, "heading");
});

test("blocks reorder and move across regions without changing identity", () => {
  const input = documentWithSections(); const source = input.sections[0].regions[0]; const target = input.sections[1].regions[1]; const blockId = source.blocks[0].id;
  const moved = applyLandingDrop(input, { kind: "block", id: blockId }, { kind: "region-end", regionId: target.id });
  assert.equal(moved.sections[1].regions[1].blocks.at(-1).id, blockId);
  assert.equal(moved.sections[0].regions[0].blocks.some((block) => block.id === blockId), false);
});

test("sections reorder and patterns insert as one immutable document result", () => {
  const input = documentWithSections(); const first = input.sections[0].id; const second = input.sections[1].id;
  const reordered = applyLandingDrop(input, { kind: "section", id: first }, { kind: "section-after", sectionId: second });
  assert.equal(reordered.sections[1].id, first);
  const inserted = applyLandingDrop(reordered, { kind: "palette-pattern", id: "hero" }, { kind: "section-before", sectionId: first }, { createPattern: () => createHeroPattern() });
  assert.equal(inserted.sections.length, 3);
  assert.equal(input.sections.length, 2);
});

test("a completed drop is one history transaction and undo/redo preserve selection", () => {
  const draft = { revision: 3, document: documentWithSections() }; const selectedId = draft.document.sections[0].regions[0].blocks[0].id;
  let state = createLandingEditorState(draft);
  state = landingEditorReducer(state, { type: "select", selection: { kind: "block", id: selectedId } });
  const moved = applyLandingDrop(state.document, { kind: "block", id: selectedId }, { kind: "region-end", regionId: state.document.sections[1].regions[1].id });
  state = landingEditorReducer(state, { type: "replace", document: moved, group: "drag" });
  assert.equal(state.past.length, 1); assert.equal(state.selection.id, selectedId);
  state = landingEditorReducer(state, { type: "undo" }); assert.equal(state.document.sections[0].regions[0].blocks[0].id, selectedId);
  state = landingEditorReducer(state, { type: "redo" }); assert.equal(state.document.sections[1].regions[1].blocks.at(-1).id, selectedId);
});

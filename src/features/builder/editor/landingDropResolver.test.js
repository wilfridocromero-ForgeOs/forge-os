import assert from "node:assert/strict";
import test from "node:test";
import { createLandingDocument, createPrimitiveBlock } from "../document/landingDocument.js";
import { createHeroPattern, createLandingPattern } from "../document/landingPatterns.js";
import { applyLandingDrop, isValidLandingDrop, resolveLandingDrop, LANDING_DROP_NOOP, LANDING_DROP_OPERATION, LANDING_DROP_REFUSAL } from "./landingDnD.js";
import { createLandingEditorState, landingEditorReducer } from "./landingEditorState.js";
import { createMutationFailure } from "./landingMutationFailure.js";

// Two sections, each with the Hero pattern: two regions, three blocks each, and
// the Hero action group. Enough structure for same-parent, cross-region and
// cross-section movement.
const twoHeroDocument = () => ({ ...createLandingDocument(), sections: [createHeroPattern(), createHeroPattern()] });

const ids = (prefix) => {
  let counter = 0;
  return () => `${prefix}-0000-4000-8000-${String(counter++).padStart(12, "0")}`;
};

test("the resolver applies a compatible drop and reports an explicit operation", () => {
  const input = twoHeroDocument();
  const section = input.sections[0];
  const region = section.regions[0];
  const anchor = region.blocks[1];
  const decision = resolveLandingDrop(input, { kind: "palette-block", id: "text" }, { kind: "block-before", blockId: anchor.id, regionId: region.id }, { createId: ids("10000000") });

  assert.equal(decision.ok, true);
  assert.equal(typeof decision.document, "object");
  assert.notEqual(decision.document, input);
  assert.equal(decision.noOp, false);
  assert.equal(decision.code, null);
  assert.equal(decision.operation.type, LANDING_DROP_OPERATION);
  assert.equal(decision.operation.effect, "insert-block");
  assert.deepEqual(decision.operation.payload, { kind: "palette-block", id: "text" });
  assert.equal(decision.operation.target.kind, "block-before");
  assert.equal(decision.operation.target.blockId, anchor.id);
  assert.equal(decision.operation.target.regionId, region.id);
  assert.equal(decision.document.sections[0].regions[0].blocks[1].type, "text");
  // The input document is never mutated.
  assert.equal(input.sections[0].regions[0].blocks[1], anchor);
  assert.equal(input.sections[0].regions[0].blocks.length, region.blocks.length);
});

test("the resolver refuses ordinary invalid requests with a structured code and never throws", () => {
  const input = twoHeroDocument();
  const region = input.sections[0].regions[0];
  const cases = [
    [null, { kind: "region-end", regionId: region.id }, LANDING_DROP_REFUSAL.PAYLOAD_MISSING],
    [undefined, { kind: "region-end", regionId: region.id }, LANDING_DROP_REFUSAL.PAYLOAD_MISSING],
    ["not-an-object", { kind: "region-end", regionId: region.id }, LANDING_DROP_REFUSAL.PAYLOAD_MISSING],
    [{ kind: "nope", id: "x" }, { kind: "region-end", regionId: region.id }, LANDING_DROP_REFUSAL.KIND_UNSUPPORTED],
    [{ kind: "block", id: "" }, { kind: "region-end", regionId: region.id }, LANDING_DROP_REFUSAL.PAYLOAD_MISSING],
    [{ kind: "block", id: 12 }, { kind: "region-end", regionId: region.id }, LANDING_DROP_REFUSAL.PAYLOAD_MISSING],
    [{ kind: "block", id: region.blocks[0].id }, null, LANDING_DROP_REFUSAL.TARGET_MISSING],
    [{ kind: "block", id: region.blocks[0].id }, { kind: "nowhere" }, LANDING_DROP_REFUSAL.TARGET_KIND_INVALID],
    [{ kind: "section", id: input.sections[0].id }, { kind: "region-end", regionId: region.id }, LANDING_DROP_REFUSAL.INCOMPATIBLE_TARGET],
    [{ kind: "block", id: region.blocks[0].id }, { kind: "canvas-end" }, LANDING_DROP_REFUSAL.INCOMPATIBLE_TARGET],
    [{ kind: "block", id: "ghost-block" }, { kind: "region-end", regionId: region.id }, LANDING_DROP_REFUSAL.BLOCK_NOT_FOUND],
    [{ kind: "block", id: region.blocks[0].id }, { kind: "region-end", regionId: "ghost-region" }, LANDING_DROP_REFUSAL.REGION_NOT_FOUND],
    [{ kind: "block", id: region.blocks[0].id }, { kind: "block-before", blockId: "ghost-block", regionId: region.id }, LANDING_DROP_REFUSAL.BLOCK_NOT_FOUND],
    [{ kind: "section", id: "ghost-section" }, { kind: "section-before", sectionId: input.sections[0].id }, LANDING_DROP_REFUSAL.SECTION_NOT_FOUND],
    [{ kind: "section", id: input.sections[0].id }, { kind: "section-before", sectionId: "ghost-section" }, LANDING_DROP_REFUSAL.SECTION_NOT_FOUND],
    [{ kind: "palette-block", id: "text" }, { kind: "region-end", regionId: "ghost-region" }, LANDING_DROP_REFUSAL.REGION_NOT_FOUND],
    [{ kind: "palette-block", id: "text" }, { kind: "block-before", blockId: "ghost-block", regionId: region.id }, LANDING_DROP_REFUSAL.BLOCK_NOT_FOUND],
    [{ kind: "palette-pattern", id: "hero" }, { kind: "block-before", blockId: "ghost-block", regionId: region.id }, LANDING_DROP_REFUSAL.BLOCK_NOT_FOUND],
    [{ kind: "palette-pattern", id: "hero" }, { kind: "section-before", sectionId: "ghost-section" }, LANDING_DROP_REFUSAL.SECTION_NOT_FOUND],
  ];

  for (const [payload, target, code] of cases) {
    let decision;
    assert.doesNotThrow(() => { decision = resolveLandingDrop(input, payload, target); }, `resolver threw for ${JSON.stringify(payload)} -> ${JSON.stringify(target)}`);
    assert.equal(decision.ok, false, `expected refusal for ${JSON.stringify(payload)} -> ${JSON.stringify(target)}`);
    assert.equal(decision.code, code);
    assert.equal(typeof decision.message, "string");
    assert.ok(decision.message.length > 0);
    assert.equal("document" in decision, false);
  }
});

test("the resolver never mutates its input, not even on a refused request", () => {
  const input = twoHeroDocument();
  const snapshot = structuredClone(input);
  resolveLandingDrop(input, { kind: "palette-block", id: "text" }, { kind: "region-end", regionId: input.sections[0].regions[0].id }, { createId: ids("20000000") });
  resolveLandingDrop(input, { kind: "block", id: "ghost" }, { kind: "region-end", regionId: input.sections[0].regions[0].id });
  resolveLandingDrop(input, { kind: "section", id: input.sections[1].id }, { kind: "section-before", sectionId: input.sections[0].id });
  assert.deepEqual(input, snapshot);
});

test("a semantic no-op resolves to the original document reference", () => {
  const input = twoHeroDocument();
  const region = input.sections[0].regions[0];
  const anchor = region.blocks[0];
  const alreadyThere = region.blocks[1];

  // Dropping a block immediately before the block that already follows it.
  const decision = resolveLandingDrop(input, { kind: "block", id: anchor.id }, { kind: "block-before", blockId: alreadyThere.id, regionId: region.id });
  assert.equal(decision.ok, true);
  assert.equal(decision.noOp, true);
  assert.equal(decision.code, LANDING_DROP_NOOP.DOCUMENT_UNCHANGED);
  assert.equal(decision.document, input);
  assert.equal(decision.operation.effect, "no-op");

  // Dropping a block at the end of the region it already ends.
  const trailing = region.blocks.at(-1);
  const atEnd = resolveLandingDrop(input, { kind: "block", id: trailing.id }, { kind: "region-end", regionId: region.id });
  assert.equal(atEnd.ok, true);
  assert.equal(atEnd.document, input);
});

test("the compatibility façade maps success to a document and refusal/no-op to the original reference", () => {
  const input = twoHeroDocument();
  const region = input.sections[0].regions[0];
  const anchor = region.blocks[0];
  const alreadyThere = region.blocks[1];

  const applied = applyLandingDrop(input, { kind: "palette-block", id: "text" }, { kind: "block-before", blockId: anchor.id, regionId: region.id }, { createId: ids("30000000") });
  assert.notEqual(applied, input);
  assert.equal(applied.sections[0].regions[0].blocks[0].type, "text");

  assert.equal(applyLandingDrop(input, { kind: "block", id: "ghost" }, { kind: "region-end", regionId: region.id }), input);
  assert.equal(applyLandingDrop(input, { kind: "block", id: anchor.id }, { kind: "block-before", blockId: alreadyThere.id, regionId: region.id }), input);
  assert.equal(applyLandingDrop(input, { kind: "section", id: "ghost" }, { kind: "section-before", sectionId: input.sections[0].id }), input);
});

test("resolver and applier agree about the document-dependent Footer contract", () => {
  const footer = createLandingPattern("footer_simple");
  const input = { ...createLandingDocument(), sections: [createHeroPattern(), footer] };
  const footerBlock = footer.regions[0].blocks[0];
  const heroRegion = input.sections[0].regions[0];

  // A dedicated Footer block can never leave its own section.
  const moveOut = resolveLandingDrop(input, { kind: "block", id: footerBlock.id }, { kind: "region-end", regionId: heroRegion.id });
  assert.equal(moveOut.ok, false);
  assert.equal(moveOut.code, LANDING_DROP_REFUSAL.FOOTER_POSITION_LOCKED);
  assert.equal(applyLandingDrop(input, { kind: "block", id: footerBlock.id }, { kind: "region-end", regionId: heroRegion.id }), input);

  // A section that contains the Footer can never be reordered.
  const moveSection = resolveLandingDrop(input, { kind: "section", id: footer.id }, { kind: "section-before", sectionId: input.sections[0].id });
  assert.equal(moveSection.ok, false);
  assert.equal(moveSection.code, LANDING_DROP_REFUSAL.SECTION_LOCKED);
  assert.equal(applyLandingDrop(input, { kind: "section", id: footer.id }, { kind: "section-before", sectionId: input.sections[0].id }), input);

  // A second Footer is refused, both as a palette block and as a pattern.
  const secondBlock = resolveLandingDrop(input, { kind: "palette-block", id: "site_footer" }, { kind: "block-before", blockId: heroRegion.blocks[0].id, regionId: heroRegion.id }, { createId: ids("40000000") });
  assert.equal(secondBlock.ok, false);
  assert.equal(secondBlock.code, LANDING_DROP_REFUSAL.FOOTER_ALREADY_EXISTS);
  const secondPattern = resolveLandingDrop(input, { kind: "palette-pattern", id: "footer_business" }, { kind: "canvas-end" }, { createPattern: () => createLandingPattern("footer_business") });
  assert.equal(secondPattern.ok, false);
  assert.equal(secondPattern.code, LANDING_DROP_REFUSAL.FOOTER_ALREADY_EXISTS);

  // Without a Footer the same requests stay feasible.
  const bare = twoHeroDocument();
  const firstPattern = resolveLandingDrop(bare, { kind: "palette-pattern", id: "footer_simple" }, { kind: "canvas-end" }, { createPattern: () => createLandingPattern("footer_simple") });
  assert.equal(firstPattern.ok, true);
  assert.notEqual(firstPattern.document, bare);
  assert.equal(firstPattern.document.sections.at(-1).regions[0].blocks[0].type, "site_footer");
});

test("the interactive gate and the applier cannot disagree", () => {
  const footer = createLandingPattern("footer_simple");
  const input = { ...createLandingDocument(), sections: [createHeroPattern(), footer] };
  const footerBlock = footer.regions[0].blocks[0];
  const heroRegion = input.sections[0].regions[0];

  // Compatible but refused: the gate alone must not promise a mutation.
  const refused = { kind: "block", id: footerBlock.id };
  const refusedTarget = { kind: "region-end", regionId: heroRegion.id };
  assert.equal(isValidLandingDrop(refused, refusedTarget), true);
  assert.equal(resolveLandingDrop(input, refused, refusedTarget).ok, false);
  assert.equal(applyLandingDrop(input, refused, refusedTarget), input);

  // Incompatible: neither the gate nor the resolver may accept it.
  const incompatible = { kind: "section", id: footer.id };
  assert.equal(isValidLandingDrop(incompatible, refusedTarget), false);
  assert.equal(resolveLandingDrop(input, incompatible, refusedTarget).ok, false);

  // Once the resolver has published a document-aware verdict for this exact
  // request, the gate becomes authoritative and reports the refusal too.
  const target = { kind: "region-end", regionId: heroRegion.id };
  const decision = resolveLandingDrop(input, refused, target);
  assert.equal(decision.ok, false);
  assert.equal(isValidLandingDrop(refused, target, input), false);

  // A different, compatible request is unaffected by that published refusal.
  const allowed = { kind: "palette-block", id: "text" };
  assert.equal(isValidLandingDrop(allowed, target, input), true);
});

test("same-parent reorder resolves to one immutable document", () => {
  const input = twoHeroDocument();
  const region = input.sections[0].regions[0];
  const first = region.blocks[0];
  const last = region.blocks.at(-1);

  const decision = resolveLandingDrop(input, { kind: "block", id: first.id }, { kind: "block-after", blockId: last.id, regionId: region.id });
  assert.equal(decision.ok, true);
  assert.notEqual(decision.document, input);
  assert.equal(decision.document.sections[0].regions[0].blocks.at(-1).id, first.id);
  assert.equal(decision.document.sections[0].regions[0].blocks.length, region.blocks.length);
  assert.equal(input.sections[0].regions[0].blocks[0].id, first.id);
});

test("cross-region and cross-section movement preserves block identity", () => {
  const input = twoHeroDocument();
  const source = input.sections[0].regions[0];
  const target = input.sections[1].regions[1];
  const blockId = source.blocks[0].id;

  const acrossRegion = resolveLandingDrop(input, { kind: "block", id: blockId }, { kind: "region-end", regionId: target.id });
  assert.equal(acrossRegion.ok, true);
  assert.equal(acrossRegion.document.sections[1].regions[1].blocks.at(-1).id, blockId);
  assert.equal(acrossRegion.document.sections[0].regions[0].blocks.some((block) => block.id === blockId), false);

  const sectionId = input.sections[0].id;
  const secondId = input.sections[1].id;
  const acrossSection = resolveLandingDrop(input, { kind: "section", id: sectionId }, { kind: "section-after", sectionId: secondId });
  assert.equal(acrossSection.ok, true);
  assert.equal(acrossSection.document.sections[1].id, sectionId);
  assert.equal(acrossSection.document.sections[1].regions[0].blocks[0].id, source.blocks[0].id);
});

test("a semantic no-op creates no history, no dirty flag and no revision change", () => {
  const draft = { revision: 7, document: twoHeroDocument() };
  const initial = createLandingEditorState(draft);
  const baseline = initial.document;
  const region = baseline.sections[0].regions[0];
  const anchor = region.blocks[0];
  const alreadyThere = region.blocks[1];

  // The editor's commit rule: a drop only reaches the reducer when the resolved
  // document is a different reference.
  const decision = resolveLandingDrop(baseline, { kind: "block", id: anchor.id }, { kind: "block-before", blockId: alreadyThere.id, regionId: region.id });
  assert.equal(decision.ok, true);
  assert.equal(decision.document, baseline);

  let state = decision.document !== baseline ? landingEditorReducer(initial, { type: "replace", document: decision.document, group: "drag" }) : initial;
  assert.equal(state, initial);
  assert.equal(state.document, baseline);
  assert.equal(state.past.length, 0);
  assert.equal(state.dirty, false);
  assert.equal(state.revision, 7);
  assert.equal(state.lastFailure, null);

  // A real drop on the same baseline is still exactly one history transaction.
  const applied = resolveLandingDrop(baseline, { kind: "block", id: anchor.id }, { kind: "region-end", regionId: region.id });
  assert.equal(applied.ok, true);
  assert.notEqual(applied.document, baseline);
  state = landingEditorReducer(initial, { type: "replace", document: applied.document, group: "drag" });
  assert.equal(state.past.length, 1);
  assert.equal(state.dirty, true);
  assert.equal(state.revision, 7);
});

test("a refused drop is recorded without touching document, history, dirty or revision", () => {
  const withFooter = { ...createLandingDocument(), sections: [createHeroPattern(), createLandingPattern("footer_simple")] };
  const state = createLandingEditorState({ revision: 11, document: withFooter });
  const refusal = resolveLandingDrop(state.document, { kind: "block", id: "ghost-block" }, { kind: "region-end", regionId: state.document.sections[0].regions[0].id });
  assert.equal(refusal.ok, false);

  const next = landingEditorReducer(state, { type: "drop_failure", decision: refusal, operation: { type: "landing_drop" } });
  assert.equal(next.document, state.document);
  assert.equal(next.past.length, 0);
  assert.equal(next.dirty, false);
  assert.equal(next.revision, 11);
  assert.equal(next.lastFailure.code, LANDING_DROP_REFUSAL.BLOCK_NOT_FOUND);
  assert.equal(next.lastFailure.message, refusal.message);
  assert.deepEqual(next.lastFailure.operation, { type: "landing_drop" });
});

test("a structured refusal keeps its machine code in the mutation-failure contract", () => {
  const decision = resolveLandingDrop(twoHeroDocument(), { kind: "block", id: "ghost-block" }, { kind: "region-end", regionId: "ghost-region" });
  assert.equal(decision.ok, false);
  const failure = createMutationFailure(decision, { operation: { type: "landing_drop" } });
  assert.equal(failure.code, decision.code);
  assert.notEqual(failure.code, decision.message);
  assert.equal(failure.message, decision.message);
  assert.equal(typeof failure.id, "number");
});

// ---------------------------------------------------------------------------
// Block placement contract.
//
// block-before(B) -> the moved block finishes immediately before B.
// block-after(B)  -> the moved block finishes immediately after B.
// region-end(R)   -> the moved block finishes as the final block of R.
//
// These must hold whether the block comes from the same region, another region
// of the same section, or another section entirely. The interesting case is the
// cross-parent `block-after`, where a same-parent index adjustment must NOT be
// applied: there is no removal shift to compensate for in a different region.
// ---------------------------------------------------------------------------

let placementSequence = 0;
const placementUid = () => `00000000-0000-4000-8000-${String(++placementSequence).padStart(12, "0")}`;
const placementRegion = (types, span = 12) => ({ id: placementUid(), span, blocks: types.map((type) => createPrimitiveBlock(type, placementUid())) });
const placementSection = (regions) => ({ id: placementUid(), layout: "columns", regions });

const typesOf = (region) => region.blocks.map((block) => block.type);
const findRegion = (document, regionId) => document.sections.flatMap((section) => section.regions).find((region) => region.id === regionId);

// One region per section: the canonical "source [A] / target [B, C]" fixture.
const sourceAndTarget = () => {
  const source = placementRegion(["heading"]);
  const target = placementRegion(["text", "action_group"]);
  const document = { ...createLandingDocument(), sections: [placementSection([source]), placementSection([target])] };
  return { document, source, target, moved: source.blocks[0].id, before: target.blocks[0].id, after: target.blocks[1].id };
};

const applyPlacement = (document, payload, target) => {
  const decision = resolveLandingDrop(document, payload, target, { createId: placementUid });
  assert.equal(decision.ok, true, `expected an applied drop but got ${decision.code}`);
  assert.equal(decision.noOp, false);
  return decision.document;
};

test("placement contract A: same region, move A after B yields [B, A, C]", () => {
  const region = placementRegion(["heading", "text", "action_group"]);
  const [a, b] = region.blocks;
  const input = { ...createLandingDocument(), sections: [placementSection([region])] };

  const document = applyPlacement(input, { kind: "block", id: a.id }, { kind: "block-after", blockId: b.id, regionId: region.id });
  assert.deepEqual(typesOf(findRegion(document, region.id)), ["text", "heading", "action_group"]);
  assert.deepEqual(typesOf(region), ["heading", "text", "action_group"]);
});

test("placement contract B: same region, move C before B yields [A, C, B]", () => {
  const region = placementRegion(["heading", "text", "action_group"]);
  const [, b, c] = region.blocks;
  const input = { ...createLandingDocument(), sections: [placementSection([region])] };

  const document = applyPlacement(input, { kind: "block", id: c.id }, { kind: "block-before", blockId: b.id, regionId: region.id });
  assert.deepEqual(typesOf(findRegion(document, region.id)), ["heading", "action_group", "text"]);
  assert.deepEqual(typesOf(region), ["heading", "text", "action_group"]);
});

test("placement contract C: cross-region, move A after B yields a target of [B, A, C]", () => {
  const { document: input, source, target, moved, before } = sourceAndTarget();

  const document = applyPlacement(input, { kind: "block", id: moved }, { kind: "block-after", blockId: before, regionId: target.id });
  assert.deepEqual(typesOf(findRegion(document, target.id)), ["text", "heading", "action_group"]);
  assert.deepEqual(typesOf(findRegion(document, source.id)), []);
  // The moved block keeps its identity.
  assert.equal(findRegion(document, target.id).blocks[1].id, moved);
});

test("placement contract D: cross-region, move A before C yields a target of [B, A, C]", () => {
  const { document: input, source, target, moved, after } = sourceAndTarget();

  const document = applyPlacement(input, { kind: "block", id: moved }, { kind: "block-before", blockId: after, regionId: target.id });
  assert.deepEqual(typesOf(findRegion(document, target.id)), ["text", "heading", "action_group"]);
  assert.deepEqual(typesOf(findRegion(document, source.id)), []);
  assert.equal(findRegion(document, target.id).blocks[1].id, moved);
});

test("placement contract E: cross-section, move A after B yields a target of [B, A, C]", () => {
  const { document: input, source, target, moved, before } = sourceAndTarget();

  const document = applyPlacement(input, { kind: "block", id: moved }, { kind: "block-after", blockId: before, regionId: target.id });
  const targetSectionIndex = document.sections.findIndex((section) => section.regions.some((region) => region.id === target.id));
  const sourceSectionIndex = document.sections.findIndex((section) => section.regions.some((region) => region.id === source.id));
  assert.notEqual(targetSectionIndex, sourceSectionIndex);
  assert.deepEqual(typesOf(findRegion(document, target.id)), ["text", "heading", "action_group"]);
});

test("placement contract F: region-end makes the moved block the final block of the target region", () => {
  const { document: input, source, target, moved } = sourceAndTarget();

  const document = applyPlacement(input, { kind: "block", id: moved }, { kind: "region-end", regionId: target.id });
  assert.deepEqual(typesOf(findRegion(document, target.id)), ["text", "action_group", "heading"]);
  assert.deepEqual(typesOf(findRegion(document, source.id)), []);
  assert.equal(findRegion(document, target.id).blocks.at(-1).id, moved);
});

test("a cross-parent move always empties the source region", () => {
  const { document: input, source, target, moved, before } = sourceAndTarget();
  assert.equal(findRegion(input, source.id).blocks.length, 1);

  for (const landing of [{ kind: "block-before", blockId: before, regionId: target.id }, { kind: "block-after", blockId: before, regionId: target.id }, { kind: "region-end", regionId: target.id }]) {
    const document = applyPlacement(input, { kind: "block", id: moved }, landing);
    assert.deepEqual(typesOf(findRegion(document, source.id)), [], `source not emptied for ${landing.kind}`);
    assert.equal(findRegion(document, target.id).blocks.some((block) => block.id === moved), true);
  }
});

test("placement contract holds for a multi-region section moved into a sibling region", () => {
  const left = placementRegion(["heading"], 6);
  const middle = placementRegion(["text", "action_group"], 6);
  const input = { ...createLandingDocument(), sections: [placementSection([left, middle])] };
  const moved = left.blocks[0].id;
  const before = middle.blocks[0].id;

  const document = applyPlacement(input, { kind: "block", id: moved }, { kind: "block-after", blockId: before, regionId: middle.id });
  assert.deepEqual(typesOf(findRegion(document, middle.id)), ["text", "heading", "action_group"]);
  assert.deepEqual(typesOf(findRegion(document, left.id)), []);
});

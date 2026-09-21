import assert from "node:assert/strict";
import test from "node:test";
import { getBlockToolbarControls, getSelectionToolbarContext, toolbarDeleteNeedsConfirmation } from "./landingToolbarControls.js";

test("contextual toolbar declares focused controls per block type", () => {
  assert.deepEqual(getBlockToolbarControls({ type: "spacer" }), ["variant", "move"]);
  assert.deepEqual(getBlockToolbarControls({ type: "form_reference" }), ["form", "fields", "appearance", "design", "layout"]);
  assert.ok(getBlockToolbarControls({ type: "heading" }).includes("typography"));
  assert.deepEqual(getBlockToolbarControls({ type: "site_header" }), ["layout", "brand", "navigation", "cta", "appearance", "more", "parent", "close"]);
  assert.deepEqual(getBlockToolbarControls({ type: "site_footer" }), ["layout", "brand", "links", "social", "appearance", "more", "parent", "close"]);
  assert.equal(getBlockToolbarControls({ type: "site_header" }).includes("surface"), false);
  assert.equal(getBlockToolbarControls({ type: "site_header" }).includes("preset"), false);
});

test("only destructive Header removal requires the explicit content warning", () => {
  assert.equal(toolbarDeleteNeedsConfirmation({ type: "site_header" }), true);
  assert.equal(toolbarDeleteNeedsConfirmation({ type: "text" }), false);
});

test("toolbar context is selected by hierarchy and button never inherits Actions controls", () => {
  const button = getSelectionToolbarContext({ level: "element", elementType: "button" });
  assert.deepEqual(button, { label: "Botón", controls: ["text", "action", "design", "more", "parent", "close"] });
  assert.ok(!button.controls.includes("appearance"));
  assert.equal(getSelectionToolbarContext({ level: "group" }).label, "Grupo");
  assert.equal(getSelectionToolbarContext({ level: "section" }).label, "Sección");
  assert.ok(getSelectionToolbarContext({ level: "block" }, { block: { type: "heading" } }).controls.includes("typography"));
});

test("Header children receive focused contexts instead of inheriting Header or Actions controls", () => {
  const selected = { block:{ type:"site_header" } };
  assert.deepEqual(getSelectionToolbarContext({ level:"element", elementType:"brand" }, selected), { label:"Marca", controls:["brand","parent","close"] });
  assert.deepEqual(getSelectionToolbarContext({ level:"element", elementType:"navigation" }, selected), { label:"Nav", controls:["style","links","parent","close"] });
  assert.deepEqual(getSelectionToolbarContext({ level:"element", elementType:"nav_item" }, selected), { label:"Nav Item", controls:["content","design","reset","parent","close"] });
  assert.deepEqual(getSelectionToolbarContext({ level:"element", elementType:"button" }, selected), { label:"CTA", controls:["text","action","parent","close"] });
});

test("Footer block and children receive focused Footer controls with their parent action", () => {
  const selected = { block:{ type:"site_footer" } };
  assert.deepEqual(getSelectionToolbarContext({ level:"block" }, selected), {
    label:"Footer",
    controls:["layout","brand","links","social","appearance","more","parent","close"],
  });
  const contexts = [
    ["footer_brand", "Marca", ["brand","parent","close"]],
    ["footer_navigation", "Links", ["links","parent","close"]],
    ["footer_link_group", "Grupo de links", ["links","parent","close"]],
    ["footer_link_item", "Link", ["links","parent","close"]],
    ["footer_social", "Social", ["social","parent","close"]],
    ["footer_bottom", "Bottom", ["bottom","parent","close"]],
    ["footer_legal_item", "Link legal", ["bottom","parent","close"]],
  ];
  for (const [elementType, label, controls] of contexts) {
    assert.deepEqual(getSelectionToolbarContext({ level:"element", elementType }, selected), { label, controls });
  }
});

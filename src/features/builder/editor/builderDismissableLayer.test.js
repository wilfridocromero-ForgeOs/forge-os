import assert from "node:assert/strict";
import test from "node:test";
import {
  BUILDER_CONTEXT_LAYER,
  isEventInsideBuilderLayer,
  registerBuilderDismissableLayer,
} from "./builderDismissableLayer.js";

function fakeTarget() {
  const listeners = new Map();
  return {
    listeners,
    addEventListener(type, handler, capture) { listeners.set(`${type}:${capture}`, handler); },
    removeEventListener(type, handler, capture) {
      if (listeners.get(`${type}:${capture}`) === handler) listeners.delete(`${type}:${capture}`);
    },
    emit(type, event) { listeners.get(`${type}:true`)?.(event); },
  };
}

const layerNode = (layer = BUILDER_CONTEXT_LAYER) => ({ dataset:{ builderDismissLayer:layer } });

test("inside controls, sliders and portal descendants keep their owning panel open", () => {
  const panel = layerNode();
  const slider = { tagName:"INPUT" };
  const portalChild = { tagName:"BUTTON" };
  for (const child of [slider, portalChild]) {
    assert.equal(isEventInsideBuilderLayer({ composedPath:()=>[child, panel] }, BUILDER_CONTEXT_LAYER), true);
  }
});

test("outside pointer closes once while another canvas target remains free to select", () => {
  const target = fakeTarget();
  const dismissals = [];
  registerBuilderDismissableLayer({ target, layerId:BUILDER_CONTEXT_LAYER, onDismiss:(reason)=>dismissals.push(reason) });
  target.emit("pointerdown", { composedPath:()=>[{ dataset:{ selectionLevel:"block" } }] });
  assert.deepEqual(dismissals, ["outside"]);
  target.emit("pointerdown", { composedPath:()=>[layerNode()] });
  assert.deepEqual(dismissals, ["outside"]);
});

test("Escape closes the open layer and stops the same key from deselecting", () => {
  const target = fakeTarget();
  let dismissed = 0;
  let prevented = 0;
  let stopped = 0;
  registerBuilderDismissableLayer({ target, layerId:BUILDER_CONTEXT_LAYER, onDismiss:()=>dismissed++ });
  target.emit("keydown", { key:"Escape", preventDefault:()=>prevented++, stopPropagation:()=>stopped++ });
  assert.equal(dismissed, 1);
  assert.equal(prevented, 1);
  assert.equal(stopped, 1);
});

test("dismiss listener registration is singular and cleanup removes both capture listeners", () => {
  const target = fakeTarget();
  const cleanup = registerBuilderDismissableLayer({ target, layerId:BUILDER_CONTEXT_LAYER, onDismiss:()=>{} });
  assert.deepEqual([...target.listeners.keys()].sort(), ["keydown:true", "pointerdown:true"]);
  cleanup();
  assert.equal(target.listeners.size, 0);
});

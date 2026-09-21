import assert from "node:assert/strict";
import test from "node:test";
import {
  buildButtonDestination,
  classifyButtonAction,
  duplicateButtonAtIndex,
  getButtonActionValue,
  removeButtonAtIndex,
  resetButtonDesign,
  updateButtonAtIndex,
  validateButtonLabel,
} from "./landingButtonEditing.js";

const actions = () => [
  { label:"Primario", href:"#inicio", variant:"primary", size:"lg", background:"gradient_aurora" },
  { label:"Secundario", href:"https://example.com", variant:"outline", radius:"pill" },
];

test("Button action editor classifies and round-trips every persisted V1 destination", () => {
  for (const [href, kind, raw] of [
    ["#contacto", "section", "contacto"],
    ["https://orvesen.com", "url", "https://orvesen.com"],
    ["mailto:hola@orvesen.com", "email", "hola@orvesen.com"],
    ["tel:+591 70000000", "phone", "+591 70000000"],
  ]) {
    assert.equal(classifyButtonAction(href), kind);
    assert.equal(getButtonActionValue(href, kind), raw);
    assert.deepEqual(buildButtonDestination(kind, raw), { valid:true, href });
  }
});

test("Button action editor rejects unsupported or unsafe destinations without a document change", () => {
  assert.equal(buildButtonDestination("page", "asset-id").valid, false);
  assert.equal(buildButtonDestination("url", "http://example.com").valid, false);
  assert.equal(buildButtonDestination("url", "javascript:alert(1)").valid, false);
  assert.equal(buildButtonDestination("email", "not-an-email").valid, false);
  assert.equal(buildButtonDestination("phone", "call-me").valid, false);
  assert.equal(buildButtonDestination("section", "two words").valid, false);
  assert.equal(buildButtonDestination("email", "a\u0000@b.com").valid, false);
  assert.equal(buildButtonDestination("url", `https://example.com/${"x".repeat(2048)}`).valid, false);
});

test("label, action and design updates change only the selected Button", () => {
  const original = actions();
  const updated = updateButtonAtIndex(original, 1, {
    label:"Abrir sitio",
    href:"https://app.orvesen.com",
    variant:"elevated",
    shadow:"medium",
    unsupported:"must-not-persist",
  });
  assert.deepEqual(updated[0], original[0]);
  assert.deepEqual(updated[1], {
    ...original[1],
    label:"Abrir sitio",
    href:"https://app.orvesen.com",
    variant:"elevated",
    shadow:"medium",
  });
  assert.equal("unsupported" in updated[1], false);
  assert.equal(original[1].label, "Secundario");
});

test("a no-op does not dirty the action collection and reset preserves behavior", () => {
  const original = actions();
  assert.equal(updateButtonAtIndex(original, 0, { label:"Primario" }), original);
  const reset = resetButtonDesign(original, 0);
  assert.deepEqual(reset[0], { label:"Primario", href:"#inicio" });
  assert.deepEqual(reset[1], original[1]);
});

test("duplicate/remove respect the schema limit and preserve siblings", () => {
  const single = [actions()[0]];
  const duplicated = duplicateButtonAtIndex(single, 0);
  assert.equal(duplicated.length, 2);
  assert.notEqual(duplicated[0], duplicated[1]);
  assert.deepEqual(duplicated[0], duplicated[1]);
  assert.equal(duplicateButtonAtIndex(duplicated, 0), duplicated);
  assert.equal(removeButtonAtIndex(single, 0), single);
  assert.deepEqual(removeButtonAtIndex(duplicated, 0), [duplicated[1]]);
});

test("Button labels must remain non-empty and within the persisted limit", () => {
  assert.deepEqual(validateButtonLabel("  Continuar  "), { valid:true, label:"Continuar" });
  assert.equal(validateButtonLabel(" ").valid, false);
  assert.equal(validateButtonLabel("x".repeat(81)).valid, false);
});

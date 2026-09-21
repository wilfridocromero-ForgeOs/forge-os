import assert from "node:assert/strict";
import test from "node:test";
import { createPrimitiveBlock } from "../document/landingDocument.js";
import {
  addFooterLink,
  applyFooterLayoutPreset,
  FOOTER_LAYOUT_PRESETS,
  getFooterPresetBlockStyle,
  moveFooterLink,
  removeFooterLink,
} from "./landingFooterEditing.js";

const footerContent = () => createPrimitiveBlock(
  "site_footer",
  "11111111-1111-4111-8111-111111111111",
).content;

test("Footer layout presets change only controlled layout defaults", () => {
  const original = footerContent();
  original.brand.name = "Marca preservada";
  original.link_groups[0].links[0].label = "Enlace preservado";
  original.copyright = "Copyright preservado";

  for (const preset of FOOTER_LAYOUT_PRESETS) {
    const applied = applyFooterLayoutPreset(original, preset.id);
    assert.equal(applied.preset, preset.id);
    assert.equal(applied.brand.name, "Marca preservada", preset.id);
    assert.equal(applied.link_groups[0].links[0].label, "Enlace preservado", preset.id);
    assert.equal(applied.copyright, "Copyright preservado", preset.id);
    assert.ok(getFooterPresetBlockStyle(preset.id).max_width, preset.id);
  }

  assert.throws(
    () => applyFooterLayoutPreset(original, "unsupported"),
    /BUILDER_FOOTER_LAYOUT_PRESET_INVALID/,
  );
});

test("Footer links add and remove without mutating the source content", () => {
  const original = footerContent();
  const groupId = original.link_groups[0].id;
  const added = addFooterLink(original, groupId, "nuevo-enlace");

  assert.equal(original.link_groups[0].links.length, 3);
  assert.equal(added.link_groups[0].links.length, 4);
  assert.deepEqual(added.link_groups[0].links.at(-1), {
    id: "nuevo-enlace",
    label: "Nuevo enlace",
    href: "#",
    enabled: true,
  });

  const removed = removeFooterLink(added, groupId, "nuevo-enlace");
  assert.deepEqual(removed, original);
  assert.strictEqual(removeFooterLink(original, "missing-group", "missing"), original);
});

test("moveFooterLink protects missing and out-of-range targets", () => {
  const original = footerContent();
  const group = original.link_groups[0];
  const firstId = group.links[0].id;
  const secondId = group.links[1].id;

  assert.strictEqual(moveFooterLink(original, "missing-group", firstId, 1), original);
  assert.strictEqual(moveFooterLink(original, group.id, "missing-link", 1), original);
  assert.strictEqual(moveFooterLink(original, group.id, firstId, -1), original);
  assert.strictEqual(moveFooterLink(original, group.id, group.links.at(-1).id, 1), original);

  const moved = moveFooterLink(original, group.id, firstId, 1);
  assert.deepEqual(moved.link_groups[0].links.slice(0, 2).map((link) => link.id), [secondId, firstId]);
  assert.deepEqual(original.link_groups[0].links.slice(0, 2).map((link) => link.id), [firstId, secondId]);
});

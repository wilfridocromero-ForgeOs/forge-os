import assert from "node:assert/strict";
import test from "node:test";
import { createLandingDocument, createPrimitiveBlock, validateLandingDocument } from "../document/landingDocument.js";
import {
  applyAppearancePreset,
  applyHeaderLayoutPreset,
  classifyHeaderPreset,
  customizeAppearance,
  detachAppearancePreset,
  getEffectiveHeaderNavItemStyle,
  getHeaderElementId,
  getHeaderLayoutPreset,
  getHeaderNavItemElementId,
  getHeaderNavStyleAttributes,
  getHeaderPresetBlockStyle,
  headerElementExists,
  HEADER_LAYOUT_PRESETS,
  HEADER_NAV_STYLE_DEFAULTS,
  removeHeaderPreset,
  resetHeaderAppearance,
  resetHeaderLayout,
  resetHeaderNavItemStyle,
  updateHeaderNavItemStyle,
  updateHeaderNavStyle,
} from "./landingHeaderEditing.js";

const content = {
  preset: "centered_logo",
  brand_name: "Acme",
  nav_items: [{ id: "nav-home", label: "Inicio", href: "#inicio", enabled: true }],
  cta: { label: "Comenzar", href: "#contacto", enabled: true },
  sticky: true,
  surface: "dark",
  text_color: "light",
  shadow: "soft",
  border: "standard",
  spacing: "lg",
  alignment: "center",
};

test("Header presets are classified into layout, appearance and behavior without overlap", () => {
  for (const id of ["classic", "boxed", "floating_pill", "minimal", "centered", "split", "glass", "logo_nav_cta", "centered_nav", "centered_logo", "cta_heavy"]) {
    assert.equal(classifyHeaderPreset(id), "layout");
    assert.equal(getHeaderLayoutPreset(id)?.id, id);
  }
  assert.deepEqual(HEADER_LAYOUT_PRESETS.map(({ id }) => id), ["classic", "boxed", "floating_pill", "minimal", "centered", "split", "glass"]);
  assert.equal(classifyHeaderPreset("custom"), "custom");
  for (const id of ["transparent", "solid", "dark", "light"]) assert.equal(classifyHeaderPreset(id), "appearance");
  assert.equal(classifyHeaderPreset("sticky"), "behavior");
  assert.equal(classifyHeaderPreset("not-a-preset"), "unknown");
});

test("Desktop Header presets keep distinct token-driven geometry and surfaces", () => {
  const presets = Object.fromEntries(HEADER_LAYOUT_PRESETS.map((preset) => [preset.id, preset]));

  assert.deepEqual(presets.classic.blockStyle, { max_width: "none", align: "center", appearance: { radius: "none" } });
  assert.deepEqual(presets.boxed.blockStyle, { max_width: "wide", align: "center", appearance: { radius: "lg" } });
  assert.deepEqual(presets.floating_pill.blockStyle, { max_width: "wide", align: "center", appearance: { radius: "xl" } });
  assert.deepEqual(presets.minimal.blockStyle, { max_width: "wide", align: "center", appearance: { radius: "none" } });
  assert.deepEqual(presets.centered.blockStyle, { max_width: "wide", align: "center", appearance: { radius: "md" } });
  assert.deepEqual(presets.split.blockStyle, { max_width: "wide", align: "center", appearance: { radius: "md" } });
  assert.deepEqual(presets.glass.blockStyle, { max_width: "wide", align: "center", appearance: { surface: "glass", radius: "xl", opacity: 80, blur: "sm" } });

  assert.deepEqual(presets.classic.content, { alignment: "spread", surface: "solid", border: "subtle", shadow: "subtle", spacing: "md" });
  assert.equal(presets.boxed.content.border, "standard");
  assert.deepEqual(presets.floating_pill.content, { alignment: "spread", surface: "solid", border: "subtle", shadow: "soft", spacing: "sm" });
  assert.deepEqual(presets.minimal.content, { alignment: "spread", surface: "transparent", border: "none", shadow: "none", spacing: "sm" });
  assert.equal(presets.centered.content.alignment, "center");
  assert.equal(presets.split.content.alignment, "spread");
  assert.deepEqual(presets.glass.content, { alignment: "spread", surface: "transparent", border: "subtle", shadow: "soft", spacing: "md" });
});

test("applying, removing or resetting a Header structural preset preserves user content", () => {
  const styledContent = {
    ...content,
    nav_style: { font_family: "sans", gap: "lg" },
    nav_items: [{ ...content.nav_items[0], style: { font_weight: "bold" } }],
  };
  const applied = applyHeaderLayoutPreset(styledContent, "minimal");
  assert.equal(applied.preset, "minimal");
  assert.equal(applied.alignment, "spread");
  assert.deepEqual(applied.cta, styledContent.cta);
  assert.deepEqual(applied.nav_style, styledContent.nav_style);
  assert.deepEqual(applied.nav_items[0].style, styledContent.nav_items[0].style);
  assert.equal(applied.surface, "transparent");
  assert.equal(applied.sticky, true);
  assert.deepEqual(getHeaderPresetBlockStyle("floating_pill"), { max_width: "wide", align: "center", appearance: { radius: "xl" } });

  const detached = removeHeaderPreset(applied);
  assert.equal(detached.preset, "custom");
  assert.deepEqual(detached.nav_items, styledContent.nav_items);
  assert.deepEqual(detached.cta, styledContent.cta);

  const reset = resetHeaderLayout(styledContent);
  assert.equal(reset.preset, "classic");
  assert.equal(reset.alignment, "spread");
  assert.deepEqual(reset.nav_items, styledContent.nav_items);
  assert.deepEqual(reset.nav_style, styledContent.nav_style);
  assert.equal(reset.surface, "solid");
});

test("every Header Composer structural preset produces a valid canonical document", () => {
  for (const preset of HEADER_LAYOUT_PRESETS) {
    const block = createPrimitiveBlock("site_header", "33333333-3333-4333-8333-333333333333");
    block.content = applyHeaderLayoutPreset(block.content, preset.id);
    block.style = getHeaderPresetBlockStyle(preset.id);
    const document = {
      ...createLandingDocument(),
      sections: [{
        id: "11111111-1111-4111-8111-111111111111",
        layout: "stack",
        regions: [{ id: "22222222-2222-4222-8222-222222222222", span: 12, blocks: [block] }],
      }],
    };
    assert.deepEqual(validateLandingDocument(document), { valid: true, errors: [] }, preset.id);
  }
});

test("visual preset detach preserves its result while reset remains a distinct operation", () => {
  const preset = { preset: "premium_dark", surface: "solid", border: "highlight", radius: "lg" };
  const applied = applyAppearancePreset(preset);
  const detached = detachAppearancePreset(applied);
  assert.deepEqual(detached, { surface: "solid", border: "highlight", radius: "lg" });
  assert.deepEqual(preset, { preset: "premium_dark", surface: "solid", border: "highlight", radius: "lg" });

  const customized = customizeAppearance(applied, { border: "subtle" });
  assert.deepEqual(customized, { surface: "solid", border: "subtle", radius: "lg" });
  assert.notDeepEqual(customized, {});
});

test("Header appearance reset preserves content and restores only appearance defaults", () => {
  const reset = resetHeaderAppearance(content);
  assert.equal(reset.preset, "centered_logo");
  assert.equal(reset.brand_name, "Acme");
  assert.deepEqual(reset.nav_items, content.nav_items);
  assert.deepEqual(reset.cta, content.cta);
  assert.equal(reset.sticky, true);
  assert.deepEqual(
    { surface: reset.surface, text_color: reset.text_color, shadow: reset.shadow, border: reset.border, spacing: reset.spacing },
    { surface: "solid", text_color: "text", shadow: "subtle", border: "subtle", spacing: "md" },
  );
});

test("Header internal element identities are deterministic and CTA availability follows the document", () => {
  const brand = getHeaderElementId("header-1", "brand");
  assert.equal(brand, getHeaderElementId("header-1", "brand"));
  assert.notEqual(brand, getHeaderElementId("header-1", "navigation"));
  assert.notEqual(brand, getHeaderElementId("header-2", "brand"));
  assert.equal(getHeaderElementId("header-1", "unsupported"), null);
  assert.equal(headerElementExists(content, "brand"), true);
  assert.equal(headerElementExists(content, "navigation"), true);
  assert.equal(headerElementExists(content, "nav_item"), true);
  assert.equal(headerElementExists(content, "button"), true);
  assert.equal(headerElementExists({ ...content, cta: { ...content.cta, enabled: false } }, "button"), false);
  assert.equal(getHeaderNavItemElementId(content.nav_items[0], "header-1", 0), "nav-home");
  assert.equal(getHeaderNavItemElementId({}, "header-1", 2), "editor-header-header-1-nav-item-2");
});

test("Nav global style is inherited and a Nav Item stores only its partial override", () => {
  const globallyStyled = updateHeaderNavStyle(content, {
    font_family: "sans",
    font_size: "lg",
    background: "surface",
    radius: "pill",
  });
  assert.deepEqual(globallyStyled.nav_style, {
    font_family: "sans",
    font_size: "lg",
    background: "surface",
    radius: "pill",
  });

  const overridden = updateHeaderNavItemStyle(globallyStyled, "nav-home", {
    font_weight: "bold",
    background: "primary",
  });
  assert.deepEqual(overridden.nav_items[0].style, { font_weight: "bold", background: "primary" });
  assert.deepEqual(getEffectiveHeaderNavItemStyle(overridden, overridden.nav_items[0]), {
    ...HEADER_NAV_STYLE_DEFAULTS,
    ...globallyStyled.nav_style,
    font_weight: "bold",
    background: "primary",
  });
  assert.equal("font_size" in overridden.nav_items[0].style, false);

  const attributes = getHeaderNavStyleAttributes(getEffectiveHeaderNavItemStyle(overridden, overridden.nav_items[0]));
  assert.equal(attributes["data-nav-font-size"], "lg");
  assert.equal(attributes["data-nav-font-weight"], "bold");
  assert.equal(attributes["data-nav-background"], "primary");
  assert.equal(attributes["data-nav-border-width"], undefined);
});

test("resetting a Nav Item style restores inheritance without touching navigation content", () => {
  const originalItem = {
    ...content.nav_items[0],
    target: { type: "section", anchor: "inicio" },
  };
  const contentWithTarget = { ...content, nav_items: [originalItem] };
  const withOverride = updateHeaderNavItemStyle(contentWithTarget, originalItem.id, { text_color: "primary", radius: "pill" });
  const reset = resetHeaderNavItemStyle(withOverride, originalItem.id);
  assert.equal("style" in reset.nav_items[0], false);
  assert.deepEqual(reset.nav_items[0], originalItem);
  for (const key of ["id", "label", "href", "target", "enabled"]) {
    assert.deepEqual(reset.nav_items[0][key], originalItem[key]);
  }
  assert.deepEqual(contentWithTarget.nav_items[0], originalItem);
});

test("Nav border attributes preserve a useful default without drawing a disabled border", () => {
  const hidden = getHeaderNavStyleAttributes(HEADER_NAV_STYLE_DEFAULTS);
  assert.equal(hidden["data-nav-border"], "none");
  assert.equal(hidden["data-nav-border-width"], undefined);

  const visible = getHeaderNavStyleAttributes({
    ...HEADER_NAV_STYLE_DEFAULTS,
    border: "subtle",
  });
  assert.equal(visible["data-nav-border"], "subtle");
  assert.equal(visible["data-nav-border-width"], "thin");
});

test("Nav Item updates prefer the selected index so only one item changes", () => {
  const duplicateIds = {
    ...content,
    nav_items: [
      { ...content.nav_items[0], style: { font_weight: "regular" } },
      { ...content.nav_items[0], label: "Segundo", style: { font_weight: "medium" } },
    ],
  };
  const updated = updateHeaderNavItemStyle(duplicateIds, "nav-home", { font_weight: "bold" }, 1);
  assert.equal(updated.nav_items[0].style.font_weight, "regular");
  assert.equal(updated.nav_items[1].style.font_weight, "bold");
  const reset = resetHeaderNavItemStyle(updated, "nav-home", 1);
  assert.deepEqual(reset.nav_items[0].style, { font_weight: "regular" });
  assert.equal("style" in reset.nav_items[1], false);
});

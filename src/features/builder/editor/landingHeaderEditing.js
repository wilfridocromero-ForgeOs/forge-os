import {
  HEADER_NAV_STYLE_DEFAULTS,
  HEADER_NAV_STYLE_OPTIONS,
} from "../document/landingDocument.js";

export { HEADER_NAV_STYLE_DEFAULTS, HEADER_NAV_STYLE_OPTIONS };

const freezePreset = (preset) => Object.freeze({
  ...preset,
  content: Object.freeze({ ...(preset.content || {}) }),
  blockStyle: Object.freeze({ ...(preset.blockStyle || {}) }),
});

export const HEADER_LAYOUT_PRESETS = Object.freeze([
  freezePreset({ id: "classic", label: "Classic", content: { alignment: "spread", surface: "solid", border: "subtle", shadow: "subtle", spacing: "md" }, blockStyle: { max_width: "none", align: "center", appearance: { radius: "none" } } }),
  freezePreset({ id: "boxed", label: "Boxed", content: { alignment: "spread", surface: "solid", border: "standard", shadow: "subtle", spacing: "md" }, blockStyle: { max_width: "wide", align: "center", appearance: { radius: "lg" } } }),
  freezePreset({ id: "floating_pill", label: "Floating Pill", content: { alignment: "spread", surface: "solid", border: "subtle", shadow: "soft", spacing: "sm" }, blockStyle: { max_width: "wide", align: "center", appearance: { radius: "xl" } } }),
  freezePreset({ id: "minimal", label: "Minimal", content: { alignment: "spread", surface: "transparent", border: "none", shadow: "none", spacing: "sm" }, blockStyle: { max_width: "wide", align: "center", appearance: { radius: "none" } } }),
  freezePreset({ id: "centered", label: "Centered", content: { alignment: "center", surface: "solid", border: "subtle", shadow: "subtle", spacing: "md" }, blockStyle: { max_width: "wide", align: "center", appearance: { radius: "md" } } }),
  freezePreset({ id: "split", label: "Split", content: { alignment: "spread", surface: "solid", border: "subtle", shadow: "subtle", spacing: "md" }, blockStyle: { max_width: "wide", align: "center", appearance: { radius: "md" } } }),
  freezePreset({ id: "glass", label: "Glass", content: { alignment: "spread", surface: "transparent", border: "subtle", shadow: "soft", spacing: "md" }, blockStyle: { max_width: "wide", align: "center", appearance: { surface: "glass", radius: "xl", opacity: 80, blur: "sm" } } }),
]);

const LEGACY_LAYOUT_PRESETS = Object.freeze([
  freezePreset({ id: "logo_nav_cta", label: "Logo + nav + CTA", content: { alignment: "spread" } }),
  freezePreset({ id: "centered_nav", label: "Nav centrada", content: { alignment: "center" } }),
  freezePreset({ id: "centered_logo", label: "Logo centrado", content: { alignment: "center" } }),
  freezePreset({ id: "cta_heavy", label: "CTA protagonista", content: { alignment: "spread" } }),
]);

export const HEADER_SURFACES = Object.freeze([
  Object.freeze({ id: "transparent", label: "Transparente" }),
  Object.freeze({ id: "solid", label: "Sólida" }),
  Object.freeze({ id: "dark", label: "Oscura" }),
  Object.freeze({ id: "light", label: "Clara" }),
]);

export const HEADER_ELEMENT_TYPES = Object.freeze({
  brand: "brand",
  navigation: "navigation",
  navItem: "nav_item",
  cta: "button",
});

const APPEARANCE_PRESET_IDS = new Set(["transparent", "solid", "dark", "light"]);
const BEHAVIOR_PRESET_IDS = new Set(["sticky"]);
const LAYOUT_PRESET_BY_ID = new Map([...HEADER_LAYOUT_PRESETS, ...LEGACY_LAYOUT_PRESETS].map((preset) => [preset.id, preset]));
const HEADER_ELEMENT_TYPE_SET = new Set([HEADER_ELEMENT_TYPES.brand, HEADER_ELEMENT_TYPES.navigation, HEADER_ELEMENT_TYPES.cta]);

const clone = (value) => value === undefined ? undefined : structuredClone(value);
const withoutUndefined = (value) => {
  const next = { ...value };
  for (const key of Object.keys(next)) if (next[key] === undefined) delete next[key];
  return next;
};

export function classifyHeaderPreset(presetId) {
  if (presetId === "custom") return "custom";
  if (LAYOUT_PRESET_BY_ID.has(presetId)) return "layout";
  if (APPEARANCE_PRESET_IDS.has(presetId)) return "appearance";
  if (BEHAVIOR_PRESET_IDS.has(presetId)) return "behavior";
  return "unknown";
}

export function getHeaderLayoutPreset(presetId) {
  return LAYOUT_PRESET_BY_ID.get(presetId) || null;
}

export function applyHeaderLayoutPreset(content, presetId) {
  const preset = getHeaderLayoutPreset(presetId);
  if (!preset) throw new Error("BUILDER_HEADER_LAYOUT_PRESET_INVALID");
  return { ...content, ...clone(preset.content), preset: preset.id };
}

export function getHeaderPresetBlockStyle(presetId) {
  return clone(getHeaderLayoutPreset(presetId)?.blockStyle || {});
}

export function removeHeaderPreset(content) {
  return { ...content, preset: "custom" };
}

export function resetHeaderLayout(content) {
  return applyHeaderLayoutPreset(content, "classic");
}

export function resetHeaderAppearance(content) {
  return {
    ...content,
    surface: "solid",
    text_color: "text",
    shadow: "subtle",
    border: "subtle",
    spacing: "md",
  };
}

export function applyAppearancePreset(preset) {
  return clone(preset);
}

export function detachAppearancePreset(value = {}) {
  const next = clone(value) || {};
  delete next.preset;
  return next;
}

export function customizeAppearance(value, changes) {
  const next = { ...detachAppearancePreset(value), ...clone(changes) };
  for (const key of Object.keys(next)) if (next[key] === undefined) delete next[key];
  return next;
}

export function updateHeaderNavStyle(content, changes) {
  const navStyle = withoutUndefined({ ...(content?.nav_style || {}), ...clone(changes) });
  const next = { ...content };
  if (Object.keys(navStyle).length) next.nav_style = navStyle;
  else delete next.nav_style;
  return next;
}

export function updateHeaderNavItemStyle(content, itemId, changes, itemIndex = null) {
  return {
    ...content,
    nav_items: (content?.nav_items || []).map((item, index) => {
      const selected = Number.isInteger(itemIndex) ? index === itemIndex : item.id === itemId;
      if (!selected) return item;
      const style = withoutUndefined({ ...(item.style || {}), ...clone(changes) });
      const nextItem = { ...item };
      if (Object.keys(style).length) nextItem.style = style;
      else delete nextItem.style;
      return nextItem;
    }),
  };
}

export function resetHeaderNavItemStyle(content, itemId, itemIndex = null) {
  return {
    ...content,
    nav_items: (content?.nav_items || []).map((item, index) => {
      const selected = Number.isInteger(itemIndex) ? index === itemIndex : item.id === itemId;
      if (!selected || !item.style) return item;
      const nextItem = { ...item };
      delete nextItem.style;
      return nextItem;
    }),
  };
}

export function getEffectiveHeaderNavItemStyle(content, item) {
  return { ...HEADER_NAV_STYLE_DEFAULTS, ...(content?.nav_style || {}), ...(item?.style || {}) };
}

export function getHeaderNavStyleAttributes(style) {
  if (!style) return {};
  return {
    "data-nav-font-family": style.font_family,
    "data-nav-font-size": style.font_size,
    "data-nav-font-weight": style.font_weight,
    "data-nav-text-color": style.text_color,
    "data-nav-gap": style.gap,
    "data-nav-padding-x": style.padding_x,
    "data-nav-padding-y": style.padding_y,
    "data-nav-radius": style.radius,
    "data-nav-background": style.background,
    "data-nav-border": style.border,
    "data-nav-border-width": style.border === "none" ? undefined : style.border_width,
    "data-nav-border-color": style.border_color,
    "data-nav-alignment": style.alignment,
    "data-nav-hover-background": style.hover_background,
    "data-nav-hover-text-color": style.hover_text_color,
    "data-nav-active-background": style.active_background,
    "data-nav-active-text-color": style.active_text_color,
  };
}

export function getHeaderElementId(blockId, elementType) {
  if (typeof blockId !== "string" || !blockId || !HEADER_ELEMENT_TYPE_SET.has(elementType)) return null;
  return `editor-header-${blockId}-${elementType}`;
}

export function getHeaderNavItemElementId(item, blockId, index = 0) {
  if (typeof item?.id === "string" && item.id) return item.id;
  if (typeof blockId !== "string" || !blockId || !Number.isInteger(index) || index < 0) return null;
  return `editor-header-${blockId}-nav-item-${index}`;
}

export function headerElementExists(content, elementType) {
  if (elementType === HEADER_ELEMENT_TYPES.brand || elementType === HEADER_ELEMENT_TYPES.navigation) return true;
  if (elementType === HEADER_ELEMENT_TYPES.navItem) return Array.isArray(content?.nav_items) && content.nav_items.length > 0;
  if (elementType === HEADER_ELEMENT_TYPES.cta) return content?.cta?.enabled === true;
  return false;
}

const freezePreset = (preset) => Object.freeze({
  ...preset,
  content: Object.freeze({ ...(preset.content || {}) }),
  blockStyle: Object.freeze({ ...(preset.blockStyle || {}) }),
});

export const FOOTER_LAYOUT_PRESETS = Object.freeze([
  freezePreset({ id: "classic", label: "Classic", content: { alignment: "start", surface: "dark", text_color: "light", border: "subtle", spacing: "md", gap: "md" }, blockStyle: { max_width: "wide", align: "center", appearance: { radius: "none" } } }),
  freezePreset({ id: "centered", label: "Centered", content: { alignment: "center", surface: "solid", text_color: "text", border: "subtle", spacing: "md", gap: "md" }, blockStyle: { max_width: "wide", align: "center", appearance: { radius: "md" } } }),
  freezePreset({ id: "columns", label: "Columns", content: { alignment: "start", surface: "dark", text_color: "light", border: "none", spacing: "lg", gap: "lg" }, blockStyle: { max_width: "wide", align: "center", appearance: { radius: "none" } } }),
  freezePreset({ id: "minimal", label: "Minimal", content: { alignment: "start", surface: "transparent", text_color: "text", border: "subtle", spacing: "sm", gap: "sm" }, blockStyle: { max_width: "none", align: "center", appearance: { radius: "none" } } }),
  freezePreset({ id: "split", label: "Split", content: { alignment: "start", surface: "solid", text_color: "text", border: "subtle", spacing: "md", gap: "md" }, blockStyle: { max_width: "wide", align: "center", appearance: { radius: "md" } } }),
]);

const PRESET_BY_ID = new Map(FOOTER_LAYOUT_PRESETS.map((preset) => [preset.id, preset]));
const clone = (value) => value === undefined ? undefined : structuredClone(value);

export const FOOTER_ELEMENT_TYPES = Object.freeze({
  brand: "footer_brand",
  navigation: "footer_navigation",
  linkGroup: "footer_link_group",
  linkItem: "footer_link_item",
  social: "footer_social",
  bottom: "footer_bottom",
  legalItem: "footer_legal_item",
});

export function getFooterLayoutPreset(presetId) {
  return PRESET_BY_ID.get(presetId) || null;
}

export function applyFooterLayoutPreset(content, presetId) {
  const preset = getFooterLayoutPreset(presetId);
  if (!preset) throw new Error("BUILDER_FOOTER_LAYOUT_PRESET_INVALID");
  return { ...content, ...clone(preset.content), preset: preset.id };
}

export function getFooterPresetBlockStyle(presetId) {
  return clone(getFooterLayoutPreset(presetId)?.blockStyle || {});
}

export function createFooterTokenId(prefix = "item") {
  const suffix = typeof globalThis.crypto?.randomUUID === "function"
    ? globalThis.crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}-${suffix}`.slice(0, 48).toLowerCase();
}

export function getFooterElementId(blockId, elementType) {
  if (!blockId || !Object.values(FOOTER_ELEMENT_TYPES).includes(elementType)) return null;
  if ([FOOTER_ELEMENT_TYPES.brand, FOOTER_ELEMENT_TYPES.navigation, FOOTER_ELEMENT_TYPES.social, FOOTER_ELEMENT_TYPES.bottom].includes(elementType)) {
    return `editor-${blockId}-${elementType}`;
  }
  return null;
}

export const getFooterGroupElementId = (group, blockId, index = 0) => group?.id
  ? `editor-${blockId}-footer-group-${group.id}`
  : `editor-${blockId}-footer-group-${index}`;

export const getFooterLinkElementId = (link, group, blockId, groupIndex = 0, linkIndex = 0) => link?.id
  ? `editor-${blockId}-footer-link-${group?.id || groupIndex}-${link.id}`
  : `editor-${blockId}-footer-link-${groupIndex}-${linkIndex}`;

export const getFooterLegalElementId = (link, blockId, index = 0) => link?.id
  ? `editor-${blockId}-footer-legal-${link.id}`
  : `editor-${blockId}-footer-legal-${index}`;

export function findFooterElement(content, blockId, elementType, elementId) {
  const fixed = {
    [FOOTER_ELEMENT_TYPES.brand]: content?.brand,
    [FOOTER_ELEMENT_TYPES.navigation]: content?.link_groups,
    [FOOTER_ELEMENT_TYPES.social]: content?.social_enabled ? content.social : null,
    [FOOTER_ELEMENT_TYPES.bottom]: { copyright: content?.copyright, legal_links: content?.legal_links },
  };
  if (Object.hasOwn(fixed, elementType)) {
    return getFooterElementId(blockId, elementType) === elementId && fixed[elementType] ? { element: fixed[elementType] } : {};
  }
  for (const [groupIndex, group] of (content?.link_groups || []).entries()) {
    if (elementType === FOOTER_ELEMENT_TYPES.linkGroup && getFooterGroupElementId(group, blockId, groupIndex) === elementId) {
      return { element: group, elementIndex: groupIndex, footerGroup: group, footerGroupIndex: groupIndex };
    }
    for (const [linkIndex, link] of (group.links || []).entries()) {
      if (elementType === FOOTER_ELEMENT_TYPES.linkItem && getFooterLinkElementId(link, group, blockId, groupIndex, linkIndex) === elementId) {
        return { element: link, elementIndex: linkIndex, footerGroup: group, footerGroupIndex: groupIndex };
      }
    }
  }
  for (const [elementIndex, link] of (content?.legal_links || []).entries()) {
    if (elementType === FOOTER_ELEMENT_TYPES.legalItem && getFooterLegalElementId(link, blockId, elementIndex) === elementId) {
      return { element: link, elementIndex };
    }
  }
  return {};
}

export function updateFooterLinkGroup(content, groupId, changes) {
  return { ...content, link_groups: content.link_groups.map((group) => group.id === groupId ? { ...group, ...clone(changes) } : group) };
}

export function addFooterLink(content, groupId, id = createFooterTokenId("link")) {
  return updateFooterLinkGroup(content, groupId, {
    links: content.link_groups.find((group) => group.id === groupId)?.links.concat({ id, label: "Nuevo enlace", href: "#", enabled: true }) || [],
  });
}

export function removeFooterLink(content, groupId, linkId) {
  const group = content.link_groups.find((item) => item.id === groupId);
  return group ? updateFooterLinkGroup(content, groupId, { links: group.links.filter((link) => link.id !== linkId) }) : content;
}

export function moveFooterLink(content, groupId, linkId, direction) {
  const group = content.link_groups.find((item) => item.id === groupId);
  if (!group) return content;

  const index = group.links.findIndex((link) => link.id === linkId);
  const target = index + direction;

  if (index < 0 || target < 0 || target >= group.links.length) {
    return content;
  }

  const links = [...group.links];
  [links[index], links[target]] = [links[target], links[index]];

  return updateFooterLinkGroup(content, groupId, { links });
}

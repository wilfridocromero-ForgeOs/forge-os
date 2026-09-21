export const LANDING_TOOLBAR_CONTROLS = Object.freeze({
  heading: ["typography", "size", "alignment", "color", "appearance", "more"],
  text: ["typography", "size", "alignment", "color", "appearance", "more"],
  spacer: ["variant", "move"],
  divider: ["variant", "width", "spacing"],
  social_links: ["variant", "alignment", "color", "spacing"],
  action_group: ["variant", "appearance", "alignment", "width", "spacing"],
  site_header: ["layout", "brand", "navigation", "cta", "appearance", "more", "parent", "close"],
  site_footer: ["layout", "brand", "links", "social", "appearance", "more", "parent", "close"],
  form_reference: ["form", "fields", "appearance", "design", "layout"],
  pricing_card: ["variant", "typography", "width", "spacing"],
  default: ["alignment", "width", "spacing"],
});

export function getBlockToolbarControls(block) {
  return LANDING_TOOLBAR_CONTROLS[block?.type] || LANDING_TOOLBAR_CONTROLS.default;
}

export const LANDING_ELEMENT_TOOLBAR_CONTEXTS = Object.freeze({
  button: Object.freeze({ label: "Botón", controls: Object.freeze(["text", "action", "design", "more", "parent", "close"]) }),
  default: Object.freeze({ label: "Elemento", controls: Object.freeze(["parent", "close"]) }),
});

export function getSelectionToolbarContext(selection, selected) {
  if (!selection) return null;
  if (selection.level === "element" && selected?.block?.type === "site_header") {
    if (selection.elementType === "brand") return { label: "Marca", controls: ["brand", "parent", "close"] };
    if (selection.elementType === "navigation") return { label: "Nav", controls: ["style", "links", "parent", "close"] };
    if (selection.elementType === "nav_item") return { label: "Nav Item", controls: ["content", "design", "reset", "parent", "close"] };
    if (selection.elementType === "button") return { label: "CTA", controls: ["text", "action", "parent", "close"] };
  }
  if (selection.level === "element" && selected?.block?.type === "site_footer") {
    if (selection.elementType === "footer_brand") return { label: "Marca", controls: ["brand", "parent", "close"] };
    if (selection.elementType === "footer_navigation") return { label: "Links", controls: ["links", "parent", "close"] };
    if (selection.elementType === "footer_link_group") return { label: "Grupo de links", controls: ["links", "parent", "close"] };
    if (selection.elementType === "footer_link_item") return { label: "Link", controls: ["links", "parent", "close"] };
    if (selection.elementType === "footer_social") return { label: "Social", controls: ["social", "parent", "close"] };
    if (selection.elementType === "footer_bottom") return { label: "Bottom", controls: ["bottom", "parent", "close"] };
    if (selection.elementType === "footer_legal_item") return { label: "Link legal", controls: ["bottom", "parent", "close"] };
  }
  if (selection.level === "element") return LANDING_ELEMENT_TOOLBAR_CONTEXTS[selection.elementType] || LANDING_ELEMENT_TOOLBAR_CONTEXTS.default;
  if (selection.level === "block") return {
    label: selected?.block?.type === "site_footer" ? "Footer" : selected?.block?.type || "Bloque",
    controls: getBlockToolbarControls(selected?.block),
  };
  if (selection.level === "group") return { label: "Grupo", controls: ["appearance", "width", "spacing", "alignment", "more"] };
  if (selection.level === "section") return { label: "Sección", controls: ["appearance", "width", "spacing", "alignment", "more"] };
  return null;
}

export function toolbarDeleteNeedsConfirmation(block) {
  return block?.type === "site_header";
}

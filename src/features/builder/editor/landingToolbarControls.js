export const LANDING_TOOLBAR_CONTROLS = Object.freeze({
  heading: ["typography", "size", "alignment", "color", "appearance", "more"],
  text: ["typography", "size", "alignment", "color", "appearance", "more"],
  spacer: ["variant", "move"],
  divider: ["variant", "width", "spacing"],
  social_links: ["variant", "alignment", "color", "spacing"],
  action_group: ["variant", "appearance", "alignment", "width", "spacing"],
  site_header: ["preset", "appearance", "brand", "navigation", "surface", "spacing"],
  form_reference: ["form", "fields", "appearance", "design", "layout"],
  pricing_card: ["variant", "typography", "width", "spacing"],
  default: ["alignment", "width", "spacing"],
});

export function getBlockToolbarControls(block) {
  return LANDING_TOOLBAR_CONTROLS[block?.type] || LANDING_TOOLBAR_CONTROLS.default;
}

export function toolbarDeleteNeedsConfirmation(block) {
  return block?.type === "site_header";
}

const BUTTON_ACTION_FIELDS = new Set([
  "label",
  "href",
  "variant",
  "size",
  "width",
  "radius",
  "shadow",
  "border",
  "background",
  "text_color",
  "border_color",
]);

export const BUTTON_VARIANTS = Object.freeze([
  "primary",
  "secondary",
  "outline",
  "ghost",
  "gradient",
  "glass",
  "soft",
  "elevated",
]);
export const BUTTON_SIZES = Object.freeze(["sm", "md", "lg"]);
export const BUTTON_WIDTHS = Object.freeze(["auto", "full"]);
export const BUTTON_RADII = Object.freeze(["none", "sm", "md", "lg", "pill"]);
export const BUTTON_SHADOWS = Object.freeze(["none", "subtle", "soft", "medium"]);
export const BUTTON_BORDERS = Object.freeze(["none", "subtle", "standard"]);
export const BUTTON_COLOR_TOKENS = Object.freeze(["page_background", "surface", "text", "muted", "primary"]);
export const BUTTON_BORDER_COLOR_TOKENS = Object.freeze(["page_background", "surface", "text", "primary"]);
export const BUTTON_BACKGROUND_TOKENS = Object.freeze([
  "page_background",
  "surface",
  "text",
  "primary",
  "gradient_soft_light",
  "gradient_aurora",
  "gradient_gold_dusk",
  "gradient_graphite",
]);
export const BUTTON_DESIGN_FIELDS = Object.freeze([
  "variant",
  "size",
  "width",
  "radius",
  "shadow",
  "border",
  "background",
  "text_color",
  "border_color",
]);

const clean = (value) => typeof value === "string" ? value.trim() : "";
const validDestination = (href) => href.length <= 2048
  ? { valid: true, href }
  : { valid: false, error: "El destino supera el límite permitido." };

export function classifyButtonAction(href = "") {
  if (href.startsWith("mailto:")) return "email";
  if (href.startsWith("tel:")) return "phone";
  if (href.startsWith("#")) return "section";
  return "url";
}

export function getButtonActionValue(href = "", kind = classifyButtonAction(href)) {
  if (kind === "email") return href.replace(/^mailto:/, "");
  if (kind === "phone") return href.replace(/^tel:/, "");
  if (kind === "section") return href.replace(/^#/, "");
  return href;
}

export function buildButtonDestination(kind, rawValue) {
  const value = clean(rawValue);
  if ([...value].some((character) => character.charCodeAt(0) <= 31 || character.charCodeAt(0) === 127)) {
    return { valid: false, error: "El destino contiene caracteres no permitidos." };
  }
  if (kind === "section") {
    if (!value || /\s/.test(value)) return { valid: false, error: "Elige una sección con anchor." };
    return validDestination(`#${value.replace(/^#/, "")}`);
  }
  if (kind === "email") {
    const email = value.replace(/^mailto:/, "");
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
      ? validDestination(`mailto:${email}`)
      : { valid: false, error: "Introduce un email válido." };
  }
  if (kind === "phone") {
    const phone = value.replace(/^tel:/, "");
    return /^\+?[0-9(). -]+$/.test(phone) && /\d/.test(phone)
      ? validDestination(`tel:${phone}`)
      : { valid: false, error: "Introduce un teléfono válido." };
  }
  if (kind === "url") {
    try {
      const url = new URL(value);
      if (url.protocol === "https:" && !/\s/.test(value)) return validDestination(value);
    } catch {
      // The compact editor reports the validation error without changing the document.
    }
    return { valid: false, error: "La URL debe comenzar con https://." };
  }
  return { valid: false, error: "Tipo de acción no soportado." };
}

export function validateButtonLabel(value) {
  const label = clean(value);
  return label && label.length <= 80
    ? { valid: true, label }
    : { valid: false, error: "El texto debe tener entre 1 y 80 caracteres." };
}

export function updateButtonAtIndex(actions, index, changes) {
  if (!Array.isArray(actions) || !Number.isInteger(index) || index < 0 || index >= actions.length) return actions;
  const nextAction = { ...actions[index] };
  let changed = false;
  for (const [key, value] of Object.entries(changes || {})) {
    if (!BUTTON_ACTION_FIELDS.has(key)) continue;
    if (value === undefined || value === null || value === "") {
      if (Object.hasOwn(nextAction, key)) {
        delete nextAction[key];
        changed = true;
      }
    } else if (nextAction[key] !== value) {
      nextAction[key] = value;
      changed = true;
    }
  }
  if (!changed) return actions;
  return actions.map((action, actionIndex) => actionIndex === index ? nextAction : action);
}

export function resetButtonDesign(actions, index) {
  return updateButtonAtIndex(actions, index, Object.fromEntries(BUTTON_DESIGN_FIELDS.map((field) => [field, undefined])));
}

export function duplicateButtonAtIndex(actions, index) {
  if (!Array.isArray(actions) || actions.length >= 2 || !actions[index]) return actions;
  const next = [...actions];
  next.splice(index + 1, 0, structuredClone(actions[index]));
  return next;
}

export function removeButtonAtIndex(actions, index) {
  if (!Array.isArray(actions) || actions.length <= 1 || !actions[index]) return actions;
  return actions.filter((_, actionIndex) => actionIndex !== index);
}

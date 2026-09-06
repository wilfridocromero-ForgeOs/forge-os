import { APPEARANCE_PRESETS, validateVisualAppearance } from "../document/visualAppearance.js";

export const FORM_SCHEMA_VERSION = 1;
export const FORM_DOCUMENT_TYPE = "form";
export const FORM_STYLE_PRESETS = Object.freeze(["clean_light", "dark", "soft_card", "minimal", "glass"]);
export const DEFAULT_FORM_STYLE = Object.freeze({
  style_preset: "clean_light",
  inherit_page_theme: false,
  background: "#f4f3ef",
  card_background: "#ffffff",
  border_color: "#dedbd2",
  radius: "lg",
  shadow: "soft",
  padding: "lg",
  field_background: "#ffffff",
  field_border: "#d8d5cc",
  label_color: "#27251f",
  input_color: "#171612",
  placeholder_color: "#77736a",
  submit_variant: "primary",
  layout: "stack",
  vertical_spacing: "md",
  button_alignment: "start",
  button_width: "auto",
  appearance: APPEARANCE_PRESETS.clean,
});

export const resolveFormStyle = (settings = {}) => ({ ...DEFAULT_FORM_STYLE, ...settings });

export const FORM_FIELD_TYPES = Object.freeze([
  { type: "text", label: "Texto corto" },
  { type: "email", label: "Email" },
  { type: "tel", label: "Teléfono" },
  { type: "textarea", label: "Texto largo" },
  { type: "select", label: "Selección" },
  { type: "checkbox", label: "Checkbox" },
  { type: "radio", label: "Opciones (radio)" },
  { type: "number", label: "Número" },
  { type: "url", label: "URL" },
]);

export const createFormFieldId = () => {
  if (typeof globalThis.crypto?.randomUUID === "function") return globalThis.crypto.randomUUID();
  return `field-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
};

export function createFormField(type = "text") {
  const base = {
    id: createFormFieldId(),
    type,
    label: type === "email" ? "Email" : type === "tel" ? "Teléfono" : type === "url" ? "Sitio web" : type === "number" ? "Cantidad" : type === "checkbox" ? "Acepto los términos" : ["select", "radio"].includes(type) ? "Selecciona una opción" : type === "textarea" ? "Mensaje" : "Nombre",
    placeholder: type === "checkbox" ? "" : "Escribe aquí",
    required: ["email"].includes(type),
    width: "full",
  };
  if (["select", "radio"].includes(type)) return { ...base, options: ["Opción 1", "Opción 2", "Opción 3"] };
  return base;
}

export function createFormDocument() {
  return {
    schema_version: FORM_SCHEMA_VERSION,
    document_type: FORM_DOCUMENT_TYPE,
    settings: {
      submit_label: "Enviar",
      success_message: "Gracias. Recibimos tu información.",
      layout: "stack",
      ...DEFAULT_FORM_STYLE,
    },
    fields: [
      { ...createFormField("text"), label: "Nombre", placeholder: "Tu nombre" },
      { ...createFormField("email"), label: "Email", placeholder: "tu@email.com" },
    ],
  };
}

export function validateFormDocument(document) {
  const errors = [];
  if (!document || document.schema_version !== 1 || document.document_type !== "form") errors.push("Documento de formulario inválido.");
  if (!Array.isArray(document?.fields) || document.fields.length > 60) errors.push("La lista de campos no es válida.");
  const ids = new Set();
  const rawSettings = document?.settings || {};
  const legacySettings = Object.prototype.hasOwnProperty.call(rawSettings, "card_style");
  const legacyKeys = new Set(["submit_label", "success_message", "layout", "card_style"]);
  const modernKeys = new Set(["submit_label", "success_message", "layout", "style_preset", "inherit_page_theme", "background", "card_background", "border_color", "radius", "shadow", "padding", "field_background", "field_border", "label_color", "input_color", "placeholder_color", "submit_variant", "vertical_spacing", "button_alignment", "button_width", "appearance"]);
  if (Object.keys(rawSettings).some((key) => !(legacySettings ? legacyKeys : modernKeys).has(key))) errors.push("La configuración del formulario contiene propiedades desconocidas.");
  if (legacySettings && (rawSettings.layout !== "stack" || !["clean", "minimal", "soft"].includes(rawSettings.card_style))) errors.push("La configuración legacy del formulario no es válida.");
  const settings = resolveFormStyle(document?.settings);
  if (!legacySettings && !FORM_STYLE_PRESETS.includes(settings.style_preset)) errors.push("El preset visual del formulario no es válido.");
  if (typeof settings.inherit_page_theme !== "boolean") errors.push("La herencia visual del formulario no es válida.");
  for (const key of ["background", "card_background", "border_color", "field_background", "field_border", "label_color", "input_color", "placeholder_color"]) {
    if (typeof settings[key] !== "string" || settings[key].length > 40) errors.push(`El color ${key} no es válido.`);
  }
  if (!["none", "sm", "md", "lg"].includes(settings.radius) || !["none", "soft", "elevated"].includes(settings.shadow) || !["sm", "md", "lg"].includes(settings.padding)) errors.push("La superficie del formulario no es válida.");
  if (!["stack", "two_column"].includes(settings.layout) || !["sm", "md", "lg"].includes(settings.vertical_spacing) || !["start", "center", "end"].includes(settings.button_alignment) || !["auto", "full"].includes(settings.button_width)) errors.push("El layout del formulario no es válido.");
  if (!validateVisualAppearance(settings.appearance)) errors.push("La apariencia del formulario no es válida.");
  for (const field of document?.fields || []) {
    if (!field?.id || ids.has(field.id)) errors.push("Hay campos con identidad inválida o repetida.");
    ids.add(field?.id);
    if (!FORM_FIELD_TYPES.some((item) => item.type === field?.type)) errors.push(`Tipo de campo inválido: ${field?.type || "desconocido"}.`);
    if (typeof field?.label !== "string" || field.label.length > 120) errors.push("Un campo tiene un label inválido.");
    if (!["full", "half"].includes(field?.width || "full")) errors.push("Un campo tiene ancho inválido.");
    if (["select", "radio"].includes(field?.type) && (!Array.isArray(field.options) || field.options.length < 1 || field.options.length > 30)) errors.push("Un campo de opciones necesita entre 1 y 30 opciones.");
  }
  return { valid: errors.length === 0, errors };
}

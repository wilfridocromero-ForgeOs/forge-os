export const LANDING_SCHEMA_VERSION = 1;
export const LANDING_DOCUMENT_TYPE = "landing_page";
export const LANDING_LIMITS = Object.freeze({ sections: 50, blocks: 500, bytes: 512 * 1024 });
export const LANDING_BREAKPOINTS = Object.freeze({ desktop: 1024, tablet: 768, mobile: 0 });

const ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TOKEN_PATTERN = /^[a-z][a-z0-9_-]{0,47}$/;
const ROOT_KEYS = new Set(["schema_version", "document_type", "locale", "settings", "sections"]);
const SECTION_KEYS = new Set(["id", "layout", "style", "responsive", "regions"]);
const REGION_KEYS = new Set(["id", "span", "blocks"]);
const BLOCK_KEYS = new Set(["id", "type", "schema_version", "content", "style", "responsive"]);
const RESPONSIVE_KEYS = new Set(["tablet", "mobile"]);
const STYLE_KEYS = new Set(["background", "color", "spacing", "radius", "content_width", "align"]);
const RESPONSIVE_STYLE_KEYS = new Set(["layout", "span", "align", "spacing", "hidden"]);
const DESIGN_KEYS = ["colors", "typography", "buttons", "radii", "spacing", "content_widths"];

const ownKeysValid = (value, allowed) => Object.keys(value).every((key) => allowed.has(key));
const plainObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const validId = (value) => typeof value === "string" && ID_PATTERN.test(value);
const validText = (value, max, allowEmpty = true) => typeof value === "string" && value.length <= max && (allowEmpty || value.trim().length > 0);
const validToken = (value) => value === undefined || (typeof value === "string" && TOKEN_PATTERN.test(value));
const validHttpsUrl = (value) => {
  if (value === null || value === "") return true;
  try { return new URL(value).protocol === "https:"; } catch { return false; }
};

function validateStyle(style, errors, path) {
  if (style === undefined) return;
  if (!plainObject(style) || !ownKeysValid(style, STYLE_KEYS)) return errors.push({ path, code: "INVALID_STYLE" });
  for (const [key, value] of Object.entries(style)) {
    if (key === "align" && !["start", "center", "end"].includes(value)) errors.push({ path: `${path}.${key}`, code: "INVALID_STYLE_VALUE" });
    else if (key !== "align" && !validToken(value)) errors.push({ path: `${path}.${key}`, code: "INVALID_TOKEN" });
  }
}

function validateResponsive(responsive, errors, path) {
  if (responsive === undefined) return;
  if (!plainObject(responsive) || !ownKeysValid(responsive, RESPONSIVE_KEYS)) return errors.push({ path, code: "INVALID_RESPONSIVE" });
  for (const [breakpoint, override] of Object.entries(responsive)) {
    if (!plainObject(override) || !ownKeysValid(override, RESPONSIVE_STYLE_KEYS)) {
      errors.push({ path: `${path}.${breakpoint}`, code: "INVALID_RESPONSIVE_OVERRIDE" }); continue;
    }
    if (override.layout !== undefined && !["stack", "columns"].includes(override.layout)) errors.push({ path: `${path}.${breakpoint}.layout`, code: "INVALID_LAYOUT" });
    if (override.span !== undefined && (!Number.isInteger(override.span) || override.span < 1 || override.span > 12)) errors.push({ path: `${path}.${breakpoint}.span`, code: "INVALID_SPAN" });
    if (override.hidden !== undefined && typeof override.hidden !== "boolean") errors.push({ path: `${path}.${breakpoint}.hidden`, code: "INVALID_HIDDEN" });
    if (override.align !== undefined && !["start", "center", "end"].includes(override.align)) errors.push({ path: `${path}.${breakpoint}.align`, code: "INVALID_ALIGN" });
    if (!validToken(override.spacing)) errors.push({ path: `${path}.${breakpoint}.spacing`, code: "INVALID_TOKEN" });
  }
}

export const BLOCK_REGISTRY = Object.freeze({
  heading: { version: 1, operations: ["update_content", "update_style", "move", "remove"], defaults: { text: "Nuevo título", level: 2 }, validate(content, errors, path) {
    if (!plainObject(content) || !ownKeysValid(content, new Set(["text", "level"]))) return errors.push({ path, code: "INVALID_HEADING" });
    if (!validText(content.text, 240, false)) errors.push({ path: `${path}.text`, code: "INVALID_TEXT" });
    if (![1, 2, 3, 4, 5, 6].includes(content.level)) errors.push({ path: `${path}.level`, code: "INVALID_HEADING_LEVEL" });
  } },
  text: { version: 1, operations: ["update_content", "update_style", "move", "remove"], defaults: { text: "Escribe aquí." }, validate(content, errors, path) {
    if (!plainObject(content) || !ownKeysValid(content, new Set(["text"])) || !validText(content?.text, 8000)) errors.push({ path, code: "INVALID_TEXT" });
  } },
  image: { version: 1, operations: ["update_content", "update_style", "move", "remove"], defaults: { source: { kind: "placeholder" }, alt: "", decorative: true }, validate(content, errors, path) {
    if (!plainObject(content) || !ownKeysValid(content, new Set(["source", "alt", "decorative"]))) return errors.push({ path, code: "INVALID_IMAGE" });
    if (!plainObject(content.source) || !["placeholder", "external"].includes(content.source.kind) || !ownKeysValid(content.source, new Set(["kind", "url"]))) errors.push({ path: `${path}.source`, code: "INVALID_IMAGE_SOURCE" });
    if (content.source?.kind === "external" && !validHttpsUrl(content.source.url)) errors.push({ path: `${path}.source.url`, code: "UNSAFE_URL" });
    if (typeof content.decorative !== "boolean" || !validText(content.alt, 300) || (!content.decorative && !content.alt.trim())) errors.push({ path: `${path}.alt`, code: "INVALID_IMAGE_ALT" });
  } },
  action_group: { version: 1, operations: ["update_content", "update_style", "move", "remove"], defaults: { actions: [{ label: "Comenzar", href: "#", variant: "primary" }] }, validate(content, errors, path) {
    if (!plainObject(content) || !ownKeysValid(content, new Set(["actions"])) || !Array.isArray(content.actions) || content.actions.length < 1 || content.actions.length > 2) return errors.push({ path, code: "INVALID_ACTION_GROUP" });
    content.actions.forEach((action, index) => {
      if (!plainObject(action) || !ownKeysValid(action, new Set(["label", "href", "variant"])) || !validText(action.label, 80, false) || !validText(action.href, 2048, false) || !["primary", "secondary"].includes(action.variant)) errors.push({ path: `${path}.actions.${index}`, code: "INVALID_ACTION" });
      if (typeof action?.href === "string" && !action.href.startsWith("#") && !validHttpsUrl(action.href)) errors.push({ path: `${path}.actions.${index}.href`, code: "UNSAFE_URL" });
    });
  } },
  form_reference: { version: 1, operations: ["update_content", "update_style", "move", "remove"], defaults: { asset_id: null, label: "Formulario" }, validate(content, errors, path) {
    if (!plainObject(content) || !ownKeysValid(content, new Set(["asset_id", "label"])) || (content.asset_id !== null && !validId(content.asset_id)) || !validText(content.label, 120, false)) errors.push({ path, code: "INVALID_FORM_REFERENCE" });
  } },
});

export function createLandingDocument() {
  return { schema_version: 1, document_type: "landing_page", locale: "es", settings: { seo: { title: "", description: "" }, design_system: { colors: {}, typography: {}, buttons: {}, radii: {}, spacing: {}, content_widths: {} } }, sections: [] };
}

export function createPrimitiveBlock(type, id, content = undefined) {
  const definition = BLOCK_REGISTRY[type];
  if (!definition) throw new Error("BUILDER_BLOCK_TYPE_INVALID");
  return { id, type, schema_version: definition.version, content: structuredClone(content ?? definition.defaults) };
}

export function validateLandingDocument(document) {
  const errors = [];
  if (!plainObject(document)) return { valid: false, errors: [{ path: "$", code: "INVALID_DOCUMENT" }] };
  if (!ownKeysValid(document, ROOT_KEYS)) errors.push({ path: "$", code: "UNKNOWN_ROOT_KEY" });
  if (document.schema_version !== 1) errors.push({ path: "$.schema_version", code: "INVALID_SCHEMA_VERSION" });
  if (document.document_type !== "landing_page") errors.push({ path: "$.document_type", code: "INVALID_DOCUMENT_TYPE" });
  if (!validText(document.locale, 16, false)) errors.push({ path: "$.locale", code: "INVALID_LOCALE" });
  if (!plainObject(document.settings) || !ownKeysValid(document.settings, new Set(["seo", "design_system"]))) errors.push({ path: "$.settings", code: "INVALID_SETTINGS" });
  const design = document.settings?.design_system;
  if (!plainObject(design) || !ownKeysValid(design, new Set(DESIGN_KEYS)) || DESIGN_KEYS.some((key) => !plainObject(design[key]))) errors.push({ path: "$.settings.design_system", code: "INVALID_DESIGN_SYSTEM" });
  else for (const category of DESIGN_KEYS) for (const [name, value] of Object.entries(design[category])) {
    if (!TOKEN_PATTERN.test(name) || typeof value !== "string" || value.length > 120) errors.push({ path: `$.settings.design_system.${category}.${name}`, code: "INVALID_TOKEN_VALUE" });
  }
  if (!Array.isArray(document.sections)) errors.push({ path: "$.sections", code: "INVALID_SECTIONS" });
  else if (document.sections.length > LANDING_LIMITS.sections) errors.push({ path: "$.sections", code: "MAX_SECTIONS" });
  const ids = new Set(); let blockCount = 0;
  for (const [sectionIndex, section] of (document.sections || []).entries()) {
    const sectionPath = `$.sections.${sectionIndex}`;
    if (!plainObject(section) || !ownKeysValid(section, SECTION_KEYS) || !validId(section.id)) { errors.push({ path: sectionPath, code: "INVALID_SECTION" }); continue; }
    if (ids.has(section.id)) errors.push({ path: `${sectionPath}.id`, code: "DUPLICATE_ID" }); ids.add(section.id);
    if (!["stack", "columns"].includes(section.layout)) errors.push({ path: `${sectionPath}.layout`, code: "INVALID_LAYOUT" });
    validateStyle(section.style, errors, `${sectionPath}.style`); validateResponsive(section.responsive, errors, `${sectionPath}.responsive`);
    if (!Array.isArray(section.regions) || section.regions.length < 1 || section.regions.length > 12) { errors.push({ path: `${sectionPath}.regions`, code: "INVALID_REGIONS" }); continue; }
    if (section.layout === "stack" && section.regions.length !== 1) errors.push({ path: `${sectionPath}.regions`, code: "STACK_REQUIRES_ONE_REGION" });
    let spans = 0;
    for (const [regionIndex, region] of section.regions.entries()) {
      const regionPath = `${sectionPath}.regions.${regionIndex}`;
      if (!plainObject(region) || !ownKeysValid(region, REGION_KEYS) || !validId(region.id) || !Number.isInteger(region.span) || region.span < 1 || region.span > 12 || !Array.isArray(region.blocks)) { errors.push({ path: regionPath, code: "INVALID_REGION" }); continue; }
      if (ids.has(region.id)) errors.push({ path: `${regionPath}.id`, code: "DUPLICATE_ID" }); ids.add(region.id); spans += region.span;
      for (const [blockIndex, block] of region.blocks.entries()) {
        blockCount += 1; const blockPath = `${regionPath}.blocks.${blockIndex}`;
        if (!plainObject(block) || !ownKeysValid(block, BLOCK_KEYS) || !validId(block.id)) { errors.push({ path: blockPath, code: "INVALID_BLOCK" }); continue; }
        if (ids.has(block.id)) errors.push({ path: `${blockPath}.id`, code: "DUPLICATE_ID" }); ids.add(block.id);
        const definition = BLOCK_REGISTRY[block.type];
        if (!definition) errors.push({ path: `${blockPath}.type`, code: "UNKNOWN_BLOCK" });
        else { if (block.schema_version !== definition.version) errors.push({ path: `${blockPath}.schema_version`, code: "INVALID_BLOCK_VERSION" }); definition.validate(block.content, errors, `${blockPath}.content`); }
        validateStyle(block.style, errors, `${blockPath}.style`); validateResponsive(block.responsive, errors, `${blockPath}.responsive`);
      }
    }
    if (section.layout === "columns" && spans !== 12) errors.push({ path: `${sectionPath}.regions`, code: "COLUMN_SPANS_MUST_TOTAL_12" });
  }
  if (blockCount > LANDING_LIMITS.blocks) errors.push({ path: "$.sections", code: "MAX_BLOCKS" });
  if (new TextEncoder().encode(JSON.stringify(document)).length > LANDING_LIMITS.bytes) errors.push({ path: "$", code: "MAX_DOCUMENT_SIZE" });
  return { valid: errors.length === 0, errors };
}

export function assertLandingDocument(document) {
  const result = validateLandingDocument(document);
  if (!result.valid) { const error = new Error("BUILDER_DOCUMENT_INVALID"); error.validationErrors = result.errors; throw error; }
  return document;
}

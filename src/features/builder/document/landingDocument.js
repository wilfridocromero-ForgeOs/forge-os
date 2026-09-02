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
const STYLE_KEYS = new Set(["background", "color", "spacing", "radius", "content_width", "align", "text_variant", "text_size", "text_weight", "max_width", "border", "shadow", "padding_top", "padding_bottom"]);
const RESPONSIVE_STYLE_KEYS = new Set(["layout", "span", "align", "spacing", "hidden"]);
const DESIGN_KEYS = ["colors", "typography", "buttons", "radii", "spacing", "content_widths"];

const ownKeysValid = (value, allowed) => Object.keys(value).every((key) => allowed.has(key));
const plainObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const validId = (value) => typeof value === "string" && ID_PATTERN.test(value);
const validText = (value, max, allowEmpty = true) => typeof value === "string" && value.length <= max && (allowEmpty || value.trim().length > 0);
const validToken = (value) => value === undefined || (typeof value === "string" && TOKEN_PATTERN.test(value));
const validHttpsUrl = (value) => {
  try { return new URL(value).protocol === "https:"; } catch { return false; }
};
const validOptionalHttpsUrl = (value) => value === null || value === "" || validHttpsUrl(value);
const validSafeLink = (value) => {
  if (typeof value !== "string" || [...value].some((character) => character.charCodeAt(0) <= 31 || character.charCodeAt(0) === 127)) return false;
  if (/^#[^\s]*$/.test(value) || /^mailto:[^\s]+$/.test(value)) return true;
  if (/^tel:\+?[0-9(). -]+$/.test(value)) return true;
  return !/\s/.test(value) && validHttpsUrl(value);
};
const validateExactObject = (content, keys, errors, path, code) => {
  if (!plainObject(content) || !ownKeysValid(content, new Set(keys))) { errors.push({ path, code }); return false; }
  return true;
};

function validateStyle(style, errors, path) {
  if (style === undefined) return;
  if (!plainObject(style) || !ownKeysValid(style, STYLE_KEYS)) return errors.push({ path, code: "INVALID_STYLE" });
  for (const [key, value] of Object.entries(style)) {
    if (key === "background") {
      if (typeof value === "string") { if (!validToken(value)) errors.push({ path: `${path}.${key}`, code: "INVALID_TOKEN" }); continue; }
      if (!plainObject(value) || !ownKeysValid(value, new Set(["type", "color", "url", "fit", "position", "overlay_color", "overlay_opacity", "gradient"]))) { errors.push({ path: `${path}.${key}`, code: "INVALID_BACKGROUND" }); continue; }
      if (!["none", "transparent", "solid", "image", "gradient"].includes(value.type)) errors.push({ path: `${path}.${key}.type`, code: "INVALID_BACKGROUND" });
      const keysByType = { none: ["type"], transparent: ["type"], solid: ["type", "color"], image: ["type", "url", "fit", "position", "overlay_color", "overlay_opacity"], gradient: ["type", "gradient"] };
      if (keysByType[value.type] && !ownKeysValid(value, new Set(keysByType[value.type]))) errors.push({ path: `${path}.${key}`, code: "INVALID_BACKGROUND_KEYS" });
      if (value.type === "solid" && !validToken(value.color)) errors.push({ path: `${path}.${key}.color`, code: "INVALID_TOKEN" });
      if (value.type === "image" && (!validHttpsUrl(value.url) || !["cover", "contain"].includes(value.fit || "cover") || !["center", "top", "bottom", "left", "right"].includes(value.position || "center"))) errors.push({ path: `${path}.${key}`, code: "INVALID_BACKGROUND_IMAGE" });
      if (value.type === "gradient" && !["none", "aurora", "gold_dusk", "graphite", "soft_light"].includes(value.gradient)) errors.push({ path: `${path}.${key}.gradient`, code: "INVALID_GRADIENT" });
      if (value.overlay_color !== undefined && !validToken(value.overlay_color)) errors.push({ path: `${path}.${key}.overlay_color`, code: "INVALID_TOKEN" });
      if (value.overlay_opacity !== undefined && ![0,10,20,30,40,50,60,70,80].includes(value.overlay_opacity)) errors.push({ path: `${path}.${key}.overlay_opacity`, code: "INVALID_OVERLAY" });
      continue;
    }
    if (key === "align" && !["start", "center", "end"].includes(value)) errors.push({ path: `${path}.${key}`, code: "INVALID_STYLE_VALUE" });
    else if (key === "text_variant" && !["lead", "body", "small"].includes(value)) errors.push({ path: `${path}.${key}`, code: "INVALID_STYLE_VALUE" });
    else if (key === "text_size" && !["xs", "sm", "md", "lg", "xl", "2xl"].includes(value)) errors.push({ path: `${path}.${key}`, code: "INVALID_STYLE_VALUE" });
    else if (key === "text_weight" && !["regular", "medium", "semibold", "bold"].includes(value)) errors.push({ path: `${path}.${key}`, code: "INVALID_STYLE_VALUE" });
    else if (key === "max_width" && !["none", "narrow", "standard", "wide"].includes(value)) errors.push({ path: `${path}.${key}`, code: "INVALID_STYLE_VALUE" });
    else if (key === "border" && !["none", "subtle", "standard"].includes(value)) errors.push({ path: `${path}.${key}`, code: "INVALID_STYLE_VALUE" });
    else if (key === "shadow" && !["none", "subtle", "soft", "medium", "elevated"].includes(value)) errors.push({ path: `${path}.${key}`, code: "INVALID_STYLE_VALUE" });
    else if (key === "radius" && !["none", "sm", "md", "lg", "pill"].includes(value)) errors.push({ path: `${path}.${key}`, code: "INVALID_STYLE_VALUE" });
    else if (["padding_top", "padding_bottom"].includes(key) && !["none", "xs", "sm", "md", "lg", "xl"].includes(value)) errors.push({ path: `${path}.${key}`, code: "INVALID_STYLE_VALUE" });
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
    if (!validText(content.text, 240)) errors.push({ path: `${path}.text`, code: "INVALID_TEXT" });
    if (![1, 2, 3, 4, 5, 6].includes(content.level)) errors.push({ path: `${path}.level`, code: "INVALID_HEADING_LEVEL" });
  } },
  text: { version: 1, operations: ["update_content", "update_style", "move", "remove"], defaults: { text: "Escribe aquí." }, validate(content, errors, path) {
    if (!plainObject(content) || !ownKeysValid(content, new Set(["text"])) || !validText(content?.text, 8000)) errors.push({ path, code: "INVALID_TEXT" });
  } },
  image: { version: 1, operations: ["update_content", "update_style", "move", "remove"], defaults: { source: { kind: "placeholder" }, alt: "", decorative: true, fit: "cover", aspect_ratio: "auto", radius: "md", focal_position: "center" }, validate(content, errors, path) {
    if (!plainObject(content) || !ownKeysValid(content, new Set(["source", "alt", "decorative", "fit", "aspect_ratio", "radius", "focal_position"]))) return errors.push({ path, code: "INVALID_IMAGE" });
    if (!plainObject(content.source) || !["placeholder", "external"].includes(content.source.kind) || !ownKeysValid(content.source, new Set(["kind", "url"]))) errors.push({ path: `${path}.source`, code: "INVALID_IMAGE_SOURCE" });
    if (content.source?.kind === "external" && !validHttpsUrl(content.source.url)) errors.push({ path: `${path}.source.url`, code: "UNSAFE_URL" });
    if (typeof content.decorative !== "boolean" || !validText(content.alt, 300) || (!content.decorative && !content.alt.trim())) errors.push({ path: `${path}.alt`, code: "INVALID_IMAGE_ALT" });
    if (!["cover", "contain"].includes(content.fit ?? "cover") || !["auto", "square", "4:3", "16:9", "portrait"].includes(content.aspect_ratio ?? "auto") || !["none", "sm", "md", "lg"].includes(content.radius ?? "md") || !["center", "top", "bottom", "left", "right"].includes(content.focal_position ?? "center")) errors.push({ path, code: "INVALID_IMAGE_PRESENTATION" });
  } },
  action_group: { version: 1, operations: ["update_content", "update_style", "move", "remove"], defaults: { actions: [{ label: "Comenzar", href: "#" }] }, validate(content, errors, path) {
    if (!plainObject(content) || !ownKeysValid(content, new Set(["actions"])) || !Array.isArray(content.actions) || content.actions.length < 1 || content.actions.length > 2) return errors.push({ path, code: "INVALID_ACTION_GROUP" });
    content.actions.forEach((action, index) => {
      if (!plainObject(action) || !ownKeysValid(action, new Set(["label", "href", "variant", "size", "width", "radius", "shadow", "border", "background", "text_color", "border_color"])) || !validText(action.label, 80, false) || !validText(action.href, 2048, false) || (action.variant !== undefined && !["primary", "secondary", "outline", "ghost"].includes(action.variant)) || (action.size !== undefined && !["sm", "md", "lg"].includes(action.size)) || (action.width !== undefined && !["auto", "full"].includes(action.width)) || (action.radius !== undefined && !["none", "sm", "md", "lg", "pill"].includes(action.radius)) || (action.shadow !== undefined && !["none", "subtle", "soft", "medium"].includes(action.shadow)) || (action.border !== undefined && !["none", "subtle", "standard"].includes(action.border)) || !validToken(action.background) || !validToken(action.text_color) || !validToken(action.border_color)) errors.push({ path: `${path}.actions.${index}`, code: "INVALID_ACTION" });
      if (typeof action?.href === "string" && !validSafeLink(action.href)) errors.push({ path: `${path}.actions.${index}.href`, code: "UNSAFE_URL" });
    });
  } },
  form_reference: { version: 1, operations: ["update_content", "update_style", "move", "remove"], defaults: { asset_id: null, label: "Formulario" }, validate(content, errors, path) {
    if (!plainObject(content) || !ownKeysValid(content, new Set(["asset_id", "label"])) || (content.asset_id !== null && !validId(content.asset_id)) || !validText(content.label, 120, false)) errors.push({ path, code: "INVALID_FORM_REFERENCE" });
  } },
  logo: { version: 1, operations: ["update_content", "update_style", "move", "remove"], defaults: { url: "https://example.com/logo.png", alt: "Marca", width: "md", href: "" }, validate(content, errors, path) {
    if (!validateExactObject(content, ["url", "alt", "width", "href"], errors, path, "INVALID_LOGO")) return;
    if (!validHttpsUrl(content.url) || !validText(content.alt, 200, false) || !["sm", "md", "lg"].includes(content.width) || !validSafeLink(content.href || "#")) errors.push({ path, code: "INVALID_LOGO" });
  } },
  feature_item: { version: 1, operations: ["update_content", "update_style", "move", "remove"], defaults: { icon: "sparkles", title: "Capacidad empresarial", description: "Describe el beneficio con claridad.", href: "" }, validate(content, errors, path) {
    if (!validateExactObject(content, ["icon", "title", "description", "href"], errors, path, "INVALID_FEATURE") || !["sparkles", "shield", "chart", "check", "users", "zap"].includes(content.icon) || !validText(content.title, 120, false) || !validText(content.description, 800) || (content.href && !validSafeLink(content.href))) errors.push({ path, code: "INVALID_FEATURE" });
  } },
  stat: { version: 1, operations: ["update_content", "update_style", "move", "remove"], defaults: { value: "37%", label: "Más conversiones", supporting_text: "" }, validate(content, errors, path) {
    if (!validateExactObject(content, ["value", "label", "supporting_text"], errors, path, "INVALID_STAT") || !validText(content.value, 40, false) || !validText(content.label, 120, false) || !validText(content.supporting_text, 300)) errors.push({ path, code: "INVALID_STAT" });
  } },
  testimonial: { version: 1, operations: ["update_content", "update_style", "move", "remove"], defaults: { quote: "Una experiencia que convirtió claridad en avance.", person_name: "Nombre", role_company: "Rol · Empresa", avatar_url: "" }, validate(content, errors, path) {
    if (!validateExactObject(content, ["quote", "person_name", "role_company", "avatar_url"], errors, path, "INVALID_TESTIMONIAL") || !validText(content.quote, 1600, false) || !validText(content.person_name, 120, false) || !validText(content.role_company, 200) || !validOptionalHttpsUrl(content.avatar_url)) errors.push({ path, code: "INVALID_TESTIMONIAL" });
  } },
  video: { version: 1, operations: ["update_content", "update_style", "move", "remove"], defaults: { url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", title: "Video", poster_url: "" }, validate(content, errors, path) {
    if (!validateExactObject(content, ["url", "title", "poster_url"], errors, path, "INVALID_VIDEO") || !validText(content.title, 200, false) || !safeVideoEmbedUrl(content.url) || !validOptionalHttpsUrl(content.poster_url)) errors.push({ path, code: "INVALID_VIDEO" });
  } },
  pricing_card: { version: 1, operations: ["update_content", "update_style", "move", "remove"], defaults: { plan_name: "Profesional", price: "$99", cadence: "/mes", description: "Para equipos que quieren avanzar.", features: ["Capacidad incluida"], cta_label: "Comenzar", cta_url: "#", emphasis: false }, validate(content, errors, path) {
    if (!validateExactObject(content, ["plan_name", "price", "cadence", "description", "features", "cta_label", "cta_url", "emphasis"], errors, path, "INVALID_PRICING") || !validText(content.plan_name, 100, false) || !validText(content.price, 50, false) || !validText(content.cadence, 40) || !validText(content.description, 600) || !Array.isArray(content.features) || content.features.length > 12 || content.features.some((item) => !validText(item, 160, false)) || !validText(content.cta_label, 80, false) || !validSafeLink(content.cta_url) || typeof content.emphasis !== "boolean") errors.push({ path, code: "INVALID_PRICING" });
  } },
  faq_item: { version: 1, operations: ["update_content", "update_style", "move", "remove"], defaults: { question: "¿Cómo funciona?", answer: "Explica la respuesta de forma clara.", default_open: false }, validate(content, errors, path) {
    if (!validateExactObject(content, ["question", "answer", "default_open"], errors, path, "INVALID_FAQ") || !validText(content.question, 300, false) || !validText(content.answer, 2000, false) || typeof content.default_open !== "boolean") errors.push({ path, code: "INVALID_FAQ" });
  } },
  divider: { version: 1, operations: ["update_content", "update_style", "move", "remove"], defaults: { style: "solid", width: "full", spacing: "md" }, validate(content, errors, path) {
    if (!validateExactObject(content, ["style", "width", "spacing"], errors, path, "INVALID_DIVIDER") || !["solid", "dashed", "subtle"].includes(content.style) || !["narrow", "standard", "full"].includes(content.width) || !["xs", "sm", "md", "lg", "xl"].includes(content.spacing)) errors.push({ path, code: "INVALID_DIVIDER" });
  } },
  spacer: { version: 1, operations: ["update_content", "update_style", "move", "remove"], defaults: { size: "md" }, validate(content, errors, path) {
    if (!validateExactObject(content, ["size"], errors, path, "INVALID_SPACER") || !["xs", "sm", "md", "lg", "xl"].includes(content.size)) errors.push({ path, code: "INVALID_SPACER" });
  } },
  social_links: { version: 1, operations: ["update_content", "update_style", "move", "remove"], defaults: { links: [{ provider: "website", url: "https://example.com", label: "Sitio web" }] }, validate(content, errors, path) {
    const providers = ["instagram", "facebook", "linkedin", "youtube", "x", "tiktok", "website", "email"];
    if (!validateExactObject(content, ["links"], errors, path, "INVALID_SOCIAL") || !Array.isArray(content.links) || content.links.length > 10 || content.links.some((link) => !plainObject(link) || !ownKeysValid(link, new Set(["provider", "url", "label"])) || !providers.includes(link.provider) || !validSafeLink(link.url) || !validText(link.label, 80, false))) errors.push({ path, code: "INVALID_SOCIAL" });
  } },
});

export function safeVideoEmbedUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return null;
    if (["youtube.com", "www.youtube.com", "m.youtube.com"].includes(url.hostname)) { const id = url.searchParams.get("v"); return /^[\w-]{6,20}$/.test(id || "") ? `https://www.youtube-nocookie.com/embed/${id}` : null; }
    if (url.hostname === "youtu.be") { const id = url.pathname.slice(1); return /^[\w-]{6,20}$/.test(id) ? `https://www.youtube-nocookie.com/embed/${id}` : null; }
    if (["vimeo.com", "www.vimeo.com"].includes(url.hostname)) { const id = url.pathname.split("/").filter(Boolean)[0]; return /^\d{5,12}$/.test(id || "") ? `https://player.vimeo.com/video/${id}` : null; }
  } catch { return null; }
  return null;
}

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
  const seo = document.settings?.seo;
  if (!plainObject(seo) || !ownKeysValid(seo, new Set(["title", "description"])) || !validText(seo.title, 120) || !validText(seo.description, 300)) errors.push({ path: "$.settings.seo", code: "INVALID_SEO" });
  const design = document.settings?.design_system;
  if (!plainObject(design) || !ownKeysValid(design, new Set(DESIGN_KEYS)) || DESIGN_KEYS.some((key) => !plainObject(design[key]))) errors.push({ path: "$.settings.design_system", code: "INVALID_DESIGN_SYSTEM" });
  else for (const category of DESIGN_KEYS) for (const [name, value] of Object.entries(design[category])) {
    if (!TOKEN_PATTERN.test(name) || typeof value !== "string" || value.length > 120) errors.push({ path: `$.settings.design_system.${category}.${name}`, code: "INVALID_TOKEN_VALUE" });
    if (category === "buttons") {
      const allowed = { variant: ["primary", "secondary", "outline", "ghost"], size: ["sm", "md", "lg"], width: ["auto", "full"], radius: ["none", "sm", "md", "lg", "pill"], shadow: ["none", "subtle", "soft", "medium"], border: ["none", "subtle", "standard"] };
      if (!(name in allowed || ["background", "text_color", "border_color"].includes(name)) || (allowed[name] && !allowed[name].includes(value)) || (["background", "text_color", "border_color"].includes(name) && !TOKEN_PATTERN.test(value))) errors.push({ path: `$.settings.design_system.buttons.${name}`, code: "INVALID_BUTTON_TOKEN" });
    }
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

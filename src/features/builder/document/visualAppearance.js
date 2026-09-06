export const VISUAL_PRESETS = Object.freeze(["clean", "soft", "elevated", "glass", "premium_dark", "gradient", "glow", "luxury"]);
export const GRADIENT_PRESETS = Object.freeze(["subtle", "premium_dark", "warm", "cool", "metallic", "soft_light"]);
export const SHADOW_TOKENS = Object.freeze(["none", "subtle", "soft", "medium", "strong", "floating", "deep"]);
export const GLOW_TOKENS = Object.freeze(["none", "soft", "edge", "radial", "top", "bottom", "ambient"]);
export const SURFACE_TOKENS = Object.freeze(["inherit", "solid", "gradient", "glass", "transparent"]);

const COLOR = /^(#[0-9a-f]{6}|[a-z][a-z0-9_-]{0,47})$/i;
const exact = (value, keys) => value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).every((key) => keys.includes(key));
const oneOf = (value, list) => value === undefined || list.includes(value);
const color = (value) => value === undefined || (typeof value === "string" && COLOR.test(value));
const level = (value) => value === undefined || [0, 20, 40, 60, 80, 100].includes(value);

export function validateVisualAppearance(value) {
  if (value === undefined) return true;
  if (!exact(value, ["preset", "surface", "gradient", "shadow", "glow", "border", "radius", "opacity", "blur", "texture", "elevation", "hover"])) return false;
  if (!oneOf(value.preset, VISUAL_PRESETS) || !oneOf(value.surface, SURFACE_TOKENS)) return false;
  if (!oneOf(value.border, ["none", "subtle", "standard", "highlight"]) || !oneOf(value.radius, ["none", "sm", "md", "lg", "xl"])) return false;
  if (!level(value.opacity) || !oneOf(value.blur, ["none", "sm", "md"]) || !oneOf(value.texture, ["none", "grain"]) || !oneOf(value.elevation, ["flat", "raised", "floating"]) || !oneOf(value.hover, ["none", "lift", "brightness", "scale"])) return false;
  if (value.gradient !== undefined && (!exact(value.gradient, ["type", "preset", "color_1", "color_2", "color_3", "angle", "position", "intensity"]) || !oneOf(value.gradient.type, ["linear", "radial", "highlight"]) || !oneOf(value.gradient.preset, GRADIENT_PRESETS) || !color(value.gradient.color_1) || !color(value.gradient.color_2) || !color(value.gradient.color_3) || (value.gradient.angle !== undefined && ![0, 45, 90, 135, 180, 225, 270, 315].includes(value.gradient.angle)) || !oneOf(value.gradient.position, ["center", "top", "bottom", "left", "right"]) || !level(value.gradient.intensity))) return false;
  if (value.shadow !== undefined && (!exact(value.shadow, ["token", "color", "intensity", "inset"]) || !oneOf(value.shadow.token, SHADOW_TOKENS) || !color(value.shadow.color) || !level(value.shadow.intensity) || (value.shadow.inset !== undefined && typeof value.shadow.inset !== "boolean"))) return false;
  if (value.glow !== undefined && (!exact(value.glow, ["token", "color", "intensity", "position", "blur"]) || !oneOf(value.glow.token, GLOW_TOKENS) || !color(value.glow.color) || !level(value.glow.intensity) || !oneOf(value.glow.position, ["center", "top", "bottom", "left", "right"]) || !oneOf(value.glow.blur, ["sm", "md", "lg"]))) return false;
  return true;
}

export const APPEARANCE_PRESETS = Object.freeze({
  clean: { preset: "clean", surface: "solid", shadow: { token: "none" }, glow: { token: "none" }, border: "subtle", radius: "md", opacity: 100, blur: "none", texture: "none", elevation: "flat", hover: "none" },
  soft: { preset: "soft", surface: "solid", shadow: { token: "soft", intensity: 40 }, glow: { token: "none" }, border: "subtle", radius: "lg", opacity: 100, blur: "none", texture: "none", elevation: "raised", hover: "none" },
  elevated: { preset: "elevated", surface: "solid", shadow: { token: "floating", intensity: 60 }, glow: { token: "none" }, border: "highlight", radius: "lg", opacity: 100, blur: "none", texture: "none", elevation: "floating", hover: "lift" },
  glass: { preset: "glass", surface: "glass", shadow: { token: "soft", intensity: 40 }, glow: { token: "top", intensity: 20, position: "top", blur: "md" }, border: "highlight", radius: "lg", opacity: 80, blur: "md", texture: "none", elevation: "raised", hover: "none" },
  premium_dark: { preset: "premium_dark", surface: "solid", shadow: { token: "deep", intensity: 60 }, glow: { token: "edge", intensity: 20, position: "top", blur: "md" }, border: "highlight", radius: "lg", opacity: 100, blur: "none", texture: "grain", elevation: "floating", hover: "none" },
  gradient: { preset: "gradient", surface: "gradient", gradient: { type: "linear", preset: "subtle", angle: 135, intensity: 60 }, shadow: { token: "soft", intensity: 40 }, glow: { token: "none" }, border: "subtle", radius: "lg", opacity: 100, blur: "none", texture: "none", elevation: "raised", hover: "none" },
  glow: { preset: "glow", surface: "solid", shadow: { token: "medium", intensity: 40 }, glow: { token: "ambient", intensity: 40, position: "center", blur: "lg" }, border: "highlight", radius: "lg", opacity: 100, blur: "none", texture: "none", elevation: "raised", hover: "none" },
  luxury: { preset: "luxury", surface: "gradient", gradient: { type: "linear", preset: "metallic", angle: 135, intensity: 40 }, shadow: { token: "deep", intensity: 60 }, glow: { token: "top", intensity: 20, position: "top", blur: "md" }, border: "highlight", radius: "lg", opacity: 100, blur: "none", texture: "grain", elevation: "floating", hover: "lift" },
});

export function appearanceData(appearance = {}) {
  return {
    "data-appearance": appearance.preset,
    "data-visual-surface": appearance.surface,
    "data-visual-shadow": appearance.shadow?.token,
    "data-visual-glow": appearance.glow?.token,
    "data-visual-border": appearance.border,
    "data-visual-radius": appearance.radius,
    "data-visual-blur": appearance.blur,
    "data-visual-texture": appearance.texture,
    "data-visual-hover": appearance.hover,
    "data-visual-opacity": appearance.opacity,
    "data-gradient": appearance.gradient?.preset,
  };
}

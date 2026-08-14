export const DISCOVERY_RESPONSE_TYPES = [
  { value: "text", label: "Texto libre" },
  { value: "yes_no", label: "Sí / No" },
  { value: "scale", label: "Escala" },
  { value: "number", label: "Número" },
  { value: "percentage", label: "Porcentaje" },
  { value: "multiple_choice", label: "Selección múltiple", requiresOptions: true },
];

const RESPONSE_TYPE_ALIASES = { boolean: "yes_no" };
const RESPONSE_TYPE_BY_VALUE = new Map(DISCOVERY_RESPONSE_TYPES.map((type) => [type.value, type]));

export function normalizeDiscoveryResponseType(value) {
  return RESPONSE_TYPE_ALIASES[value] || value;
}

export function getDiscoveryResponseType(value) {
  return RESPONSE_TYPE_BY_VALUE.get(normalizeDiscoveryResponseType(value));
}

export function normalizeDiscoveryOptions(options) {
  if (!Array.isArray(options)) return [];
  return options.map((option) => {
    if (option && typeof option === "object") {
      const value = option.value ?? option.label;
      const label = option.label ?? option.value;
      return { value, label };
    }
    return { value: option, label: option };
  }).filter((option) => String(option.value ?? "").trim() && String(option.label ?? "").trim());
}

export function getDiscoveryQuestionConfigurationError(question) {
  const type = getDiscoveryResponseType(question?.response_type);
  if (!type) return `Tipo de respuesta no compatible: ${question?.response_type || "sin definir"}.`;
  if (!type.requiresOptions) return "";

  const options = normalizeDiscoveryOptions(question?.options);
  const uniqueValues = new Set(options.map((option) => String(option.value).trim().toLocaleLowerCase("es")));
  if (options.length < 2 || uniqueValues.size !== options.length) {
    return "Configura al menos dos opciones válidas y diferentes.";
  }
  return "";
}

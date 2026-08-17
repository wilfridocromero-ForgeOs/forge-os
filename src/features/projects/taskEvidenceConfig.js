export const evidenceTypeLabels = { image: "Foto", video: "Video", document: "Documento", url: "Enlace", text: "Texto" };

export const evidenceTypeHints = {
  image: "JPG, PNG o WEBP · hasta 20 MB",
  video: "MP4 o WEBM · hasta 50 MB",
  document: "PDF, Office, CSV o TXT · hasta 50 MB",
  url: "Enlace seguro que comience con https://",
  text: "Texto plano de hasta 5.000 caracteres",
};

export const evidenceTypeDefaults = {
  image: { min_count: 1, max_count: 1 },
  video: { min_count: 1, max_count: 1 },
  document: { min_count: 1, max_count: 1 },
  url: { min_count: 1, max_count: 1 },
  text: { min_count: 1, max_count: 1 },
};

export const blankEvidenceRequirement = (evidenceType = "image") => ({
  label: "", description: "", evidence_type: evidenceType, is_required: true, ...evidenceTypeDefaults[evidenceType],
});

export function validateEvidenceRequirement(requirement) {
  if (requirement.label.trim().length < 2) return "Escribe un nombre de al menos 2 caracteres.";
  if (!Number.isInteger(Number(requirement.min_count)) || Number(requirement.min_count) < 0) return "El mínimo no puede ser negativo.";
  if (!Number.isInteger(Number(requirement.max_count)) || Number(requirement.max_count) < 1 || Number(requirement.max_count) > 20) return "El máximo debe estar entre 1 y 20.";
  if (Number(requirement.min_count) > Number(requirement.max_count)) return "El mínimo no puede ser mayor que el máximo.";
  return "";
}

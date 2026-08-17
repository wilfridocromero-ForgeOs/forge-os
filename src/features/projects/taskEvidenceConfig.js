export const evidenceTypeLabels = { image: "Imagen", video: "Video", document: "Documento", url: "Enlace HTTPS", text: "Texto" };
export const blankEvidenceRequirement = () => ({ label: "", description: "", evidence_type: "image", is_required: true, min_count: 1, max_count: 1 });

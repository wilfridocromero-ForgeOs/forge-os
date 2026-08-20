import { supabase } from "../lib/supabase";

const projectSelection = `
  id, organization_id, division_id, client_id, name, description, priority,
  status, progress, owner_id, created_by, starts_at, due_at, completed_at,
  created_at, updated_at,
  divisions(id, name),
  clients(id, company_name, contact_name),
  owner:users!projects_owner_id_fkey(id, first_name, title)
`;

export async function getProjects(organizationId) {
  if (!organizationId) return [];
  const { data, error } = await supabase.from("projects").select(projectSelection)
    .eq("organization_id", organizationId).order("created_at", { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function getProject(projectId, organizationId) {
  if (!projectId || !organizationId) return null;
  const { data, error } = await supabase.from("projects").select(projectSelection)
    .eq("id", projectId).eq("organization_id", organizationId).maybeSingle();
  if (error) throw error;
  return data;
}

export async function getProjectOptions(organizationId) {
  if (!organizationId) return { clients: [], users: [] };
  const [clientsResult, membershipsResult] = await Promise.all([
    supabase.from("clients").select("id, company_name, contact_name").eq("organization_id", organizationId).order("company_name"),
    supabase.from("organization_memberships").select("user_id, role").eq("organization_id", organizationId),
  ]);
  if (clientsResult.error) throw clientsResult.error;
  if (membershipsResult.error) throw membershipsResult.error;
  const memberIds = (membershipsResult.data || []).map((membership) => membership.user_id);
  if (!memberIds.length) return { clients: clientsResult.data || [], users: [] };
  const { data: users, error: usersError } = await supabase.from("users")
    .select("id, first_name, title, division, division_id").in("id", memberIds).order("first_name");
  if (usersError) throw usersError;
  return { clients: clientsResult.data || [], users: users || [] };
}

function normalizeProject(values, organizationId, userId) {
  return {
    organization_id: organizationId,
    division_id: values.division_id,
    client_id: values.client_id || null,
    name: values.name.trim(),
    description: values.description?.trim() || null,
    priority: values.priority,
    status: values.status,
    owner_id: values.owner_id || null,
    starts_at: values.starts_at ? new Date(`${values.starts_at}T00:00:00`).toISOString() : null,
    due_at: values.due_at ? new Date(`${values.due_at}T23:59:59`).toISOString() : null,
    created_by: userId,
  };
}

export async function createProject(values, organizationId, userId) {
  const payload = normalizeProject(values, organizationId, userId);
  const { data, error } = await supabase.from("projects").insert(payload).select(projectSelection).single();
  if (error) throw error;
  return data;
}

export async function updateProject(projectId, values, organizationId, userId) {
  const payload = normalizeProject(values, organizationId, userId);
  delete payload.created_by;
  const { data, error } = await supabase.from("projects").update(payload).eq("id", projectId).select(projectSelection).single();
  if (error) throw error;
  return data;
}

export async function archiveProject(projectId) {
  const { data, error } = await supabase.from("projects").update({ status: "archived" })
    .eq("id", projectId).select(projectSelection).single();
  if (error) throw error;
  return data;
}

export async function getProjectActivity(projectId, beforeActivityId = null, pageSize = 30) {
  if (!projectId) return [];
  const { data, error } = await supabase.rpc("get_project_activity_page", {
    target_project_id: projectId,
    before_activity_id: beforeActivityId,
    page_size: pageSize,
  });
  if (error) throw error;
  return data || [];
}

export async function getProjectComments(projectId) {
  if (!projectId) return [];
  const { data, error } = await supabase.rpc("get_project_comments", { target_project_id: projectId });
  if (error) throw error;
  return data || [];
}

export async function createProjectComment(projectId, body, authorId, parentId = null) {
  const { data, error } = await supabase.from("project_comments").insert({
    project_id: projectId,
    author_id: authorId,
    body: body.trim(),
    parent_id: parentId,
  }).select("id").single();
  if (error) throw error;
  return data;
}

export async function updateProjectComment(commentId, body) {
  const { error } = await supabase.from("project_comments").update({ body: body.trim() }).eq("id", commentId);
  if (error) throw error;
}

export async function deleteProjectComment(commentId) {
  const { error } = await supabase.from("project_comments").update({ deleted_at: new Date().toISOString() }).eq("id", commentId);
  if (error) throw error;
}

export async function getProjectFiles(projectId, cursor = null, pageSize = 30) {
  if (!projectId) return [];
  const { data, error } = await supabase.rpc("get_project_files_page", {
    target_project_id: projectId,
    before_created_at: cursor?.created_at || null,
    before_file_id: cursor?.id || null,
    page_size: pageSize,
  });
  if (error) throw error;
  return data || [];
}

export async function uploadProjectFile({ projectId, organizationId, file, userId, onProgress }) {
  const id = crypto.randomUUID();
  const safeName = sanitizeStorageFileName(file.name);
  const storagePath = `${organizationId}/${projectId}/files/${id}/${safeName}`;
  onProgress?.(10, "Validando");
  validateProjectFile(file);
  onProgress?.(25, "Subiendo");
  const upload = await supabase.storage.from("project-files").upload(storagePath, file, {
    cacheControl: "3600",
    contentType: file.type,
    upsert: false,
  });
  if (upload.error) throw friendlyFileError(upload.error, "No se pudo subir el archivo.");
  onProgress?.(75, "Guardando metadata");
  const metadata = await supabase.from("project_files").insert({
    id,
    project_id: projectId,
    storage_path: storagePath,
    file_name: file.name.trim(),
    mime_type: file.type,
    size_bytes: file.size,
    uploaded_by: userId,
  }).select("id").single();
  if (metadata.error) {
    const cleanup = await supabase.storage.from("project-files").remove([storagePath]);
    const suffix = cleanup.error ? " El objeto requiere limpieza manual." : " El objeto temporal fue eliminado.";
    throw friendlyFileError(metadata.error, `No se pudo registrar el archivo.${suffix}`);
  }
  onProgress?.(100, "Completado");
  return metadata.data;
}

export async function downloadProjectFile(file) {
  const { data, error } = await supabase.storage.from("project-files").download(file.storage_path);
  if (error) throw friendlyFileError(error, "No se pudo descargar el archivo.");
  const url = URL.createObjectURL(data);
  const anchor = document.createElement("a");
  anchor.href = url; anchor.download = file.file_name; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function previewProjectFile(file) {
  const { data, error } = await supabase.storage.from("project-files").createSignedUrl(file.storage_path, 60);
  if (error) throw friendlyFileError(error, "No se pudo abrir el archivo.");
  window.open(data.signedUrl, "_blank", "noopener,noreferrer");
}

export async function deleteProjectFile(file) {
  const storage = await supabase.storage.from("project-files").remove([file.storage_path]);
  if (storage.error) throw friendlyFileError(storage.error, "No se pudo eliminar el objeto almacenado.");
  const metadata = await supabase.from("project_files").update({ deleted_at: new Date().toISOString() }).eq("id", file.id);
  if (metadata.error) throw friendlyFileError(metadata.error, "El objeto se eliminó, pero la metadata requiere reintento.");
}

export const PROJECT_FILE_MAX_BYTES = 50 * 1024 * 1024;
export const PROJECT_FILE_ALLOWED_MIME_TYPES = new Set([
  "application/pdf", "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint", "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "text/csv", "text/plain", "image/jpeg", "image/png", "image/webp",
]);
const blockedExtensions = new Set(["exe", "msi", "bat", "cmd", "com", "scr", "ps1", "sh", "js", "mjs", "cjs", "vbs", "jar", "apk", "dmg", "app", "deb", "rpm", "dll", "so"]);

export function validateProjectFile(file) {
  const extension = file.name.split(".").pop()?.toLowerCase();
  if (!file.name.trim() || file.name.trim().length > 255) throw new Error("El nombre del archivo no es válido.");
  if (!file.size || file.size > PROJECT_FILE_MAX_BYTES) throw new Error("El archivo debe pesar entre 1 byte y 50 MB.");
  if (blockedExtensions.has(extension)) throw new Error("Ese tipo de archivo ejecutable no está permitido.");
  if (!PROJECT_FILE_ALLOWED_MIME_TYPES.has(file.type)) throw new Error("El tipo de archivo no está permitido para Proyectos.");
}

export function sanitizeStorageFileName(name) {
  const normalized = name.trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const printable = Array.from(normalized, (character) => {
    const code = character.charCodeAt(0);
    return code >= 32 && code !== 127 ? character : "_";
  }).join("");
  const safe = printable.replace(/[\\/]+/g, "_").replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^\.+/, "");
  return (safe || "archivo").slice(-120);
}

function friendlyFileError(error, fallback) {
  const message = String(error?.message || "").toLowerCase();
  if (message.includes("row-level security") || message.includes("permission")) return new Error("No tienes permiso para realizar esta acción.");
  if (message.includes("payload too large") || message.includes("maximum allowed size")) return new Error("El archivo supera el límite de 50 MB.");
  if (message.includes("mime type") || message.includes("content type")) return new Error("El tipo de archivo no está permitido.");
  if (message.includes("not found") || message.includes("object not found")) return new Error("El archivo ya no existe en el almacenamiento.");
  return new Error(fallback);
}

export async function getProjectMembers(projectId) {
  if (!projectId) return [];
  const { data, error } = await supabase.from("project_members")
    .select("id, project_id, user_id, role, added_by, created_at, updated_at, user:users!project_members_user_id_fkey(id, first_name, title, division, division_id)")
    .eq("project_id", projectId).order("created_at");
  if (error) throw error;
  return data || [];
}

export async function addProjectMember(projectId, userId, role, actorId) {
  const { data, error } = await supabase.from("project_members")
    .insert({ project_id: projectId, user_id: userId, role, added_by: actorId })
    .select("id, project_id, user_id, role, added_by, created_at, updated_at, user:users!project_members_user_id_fkey(id, first_name, title, division, division_id)")
    .single();
  if (error) throw error;
  return data;
}

export async function updateProjectMemberRole(memberId, role) {
  const { data, error } = await supabase.from("project_members").update({ role })
    .eq("id", memberId)
    .select("id, project_id, user_id, role, added_by, created_at, updated_at, user:users!project_members_user_id_fkey(id, first_name, title, division, division_id)")
    .single();
  if (error) throw error;
  return data;
}

export async function removeProjectMember(memberId) {
  const { error } = await supabase.from("project_members").delete().eq("id", memberId);
  if (error) throw error;
}

export async function getProjectWork(projectId) {
  const [tasksResult, deliverablesResult, schedulesResult] = await Promise.all([
    supabase.from("project_tasks").select("id, project_id, title, description, status, priority, work_type, position, assigned_to, starts_at, due_at, completed_at, completed_by, created_by, created_at, recurrence_schedule_id, scheduled_for, is_recurrence_template, assignee:users!project_tasks_assigned_to_fkey(id, first_name, title)").eq("project_id", projectId).order("position").order("created_at"),
    supabase.from("project_deliverables").select("id, project_id, title, description, status, due_at, approved_at, created_by, created_at").eq("project_id", projectId).order("created_at"),
    supabase.from("project_task_schedules").select("id, project_id, template_task_id, recurrence_unit, interval_count, weekday, day_of_month, timezone, next_run_at, duration_minutes, active, last_error, last_error_at, last_success_at, created_at, updated_at").eq("project_id", projectId),
  ]);
  if (tasksResult.error) throw tasksResult.error;
  if (deliverablesResult.error) throw deliverablesResult.error;
  if (schedulesResult.error) throw schedulesResult.error;
  const taskIds = (tasksResult.data || []).map((task) => task.id);
  if (!taskIds.length) return { tasks: [], deliverables: deliverablesResult.data || [] };
  const [requirementsResult, evidenceResult] = await Promise.all([
    supabase.from("task_evidence_requirements").select("id, task_id, evidence_type, label, description, is_required, min_count, max_count, position, created_by, created_at, updated_at").in("task_id", taskIds).order("position").order("created_at"),
    supabase.from("task_evidence").select("id, requirement_id, task_id, evidence_type, storage_path, file_name, mime_type, size_bytes, value_text, value_url, submitted_by, created_at, deleted_at, submitter:users!task_evidence_submitted_by_fkey(id, first_name)").in("task_id", taskIds).is("deleted_at", null).order("created_at"),
  ]);
  if (requirementsResult.error) throw requirementsResult.error;
  if (evidenceResult.error) throw evidenceResult.error;
  const requirements = requirementsResult.data || [];
  const evidence = evidenceResult.data || [];
  return {
    tasks: (tasksResult.data || []).map((task) => ({
      ...task,
      recurrence_schedule: (schedulesResult.data || []).find((item) => item.template_task_id === task.id || item.id === task.recurrence_schedule_id) || null,
      evidence_requirements: requirements.filter((item) => item.task_id === task.id).map((requirement) => ({
        ...requirement,
        evidence: evidence.filter((item) => item.requirement_id === requirement.id),
      })),
    })),
    deliverables: deliverablesResult.data || [],
  };
}

export async function createProjectTask(projectId, values, userId) {
  const { data, error } = await supabase.from("project_tasks").insert({
    project_id: projectId,
    title: values.title.trim(),
    description: values.description?.trim() || null,
    work_type: values.work_type || "task",
    status: values.evidence_requirements?.length ? "pending" : (values.status || "pending"),
    priority: values.priority || "medium",
    position: Number.isInteger(values.position) ? values.position : 0,
    assigned_to: values.assigned_to || null,
    starts_at: values.starts_at ? new Date(values.starts_at).toISOString() : null,
    due_at: values.due_at ? new Date(values.due_at).toISOString() : null,
    created_by: userId,
  }).select("*").single();
  if (error) throw error;
  if (values.evidence_requirements?.length) {
    const { error: requirementsError } = await supabase.from("task_evidence_requirements").insert(values.evidence_requirements.map((requirement, position) => ({
      task_id: data.id,
      evidence_type: requirement.evidence_type,
      label: requirement.label.trim(),
      description: requirement.description?.trim() || null,
      is_required: requirement.is_required,
      min_count: requirement.is_required ? Number(requirement.min_count) : 0,
      max_count: Number(requirement.max_count),
      position,
      created_by: userId,
    })));
    if (requirementsError) {
      await supabase.from("project_tasks").delete().eq("id", data.id);
      throw requirementsError;
    }
  }
  return data;
}

export async function updateProjectTask(taskId, changes) {
  const { data, error } = await supabase.from("project_tasks").update(changes).eq("id", taskId).select("*").single();
  if (error) {
    if (String(error.message).includes("Required evidence is incomplete")) throw new Error("No puedes completar esta tarea todavía. Falta evidencia obligatoria.");
    throw error;
  }
  return data;
}

export async function saveProjectTaskSchedule(taskId, details, schedule, scheduleActive) {
  const timezone = schedule.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const recurrenceEnabled = schedule.mode !== "none";
  const { data, error } = await supabase.rpc("save_project_task_schedule", {
    target_task_id: taskId,
    requested_assigned_to: details.assigned_to || null,
    requested_priority: details.priority,
    requested_work_type: details.work_type,
    requested_description: details.description.trim() || null,
    requested_starts_at: details.starts_at ? new Date(details.starts_at).toISOString() : null,
    requested_due_at: details.due_at ? new Date(details.due_at).toISOString() : null,
    requested_schedule_active: recurrenceEnabled && scheduleActive,
    requested_unit: recurrenceEnabled ? schedule.recurrence_unit : null,
    requested_interval: recurrenceEnabled ? Number(schedule.interval_count) : null,
    requested_weekday: recurrenceEnabled && schedule.recurrence_unit === "week" ? Number(schedule.weekday) : null,
    requested_day_of_month: recurrenceEnabled && schedule.recurrence_unit === "month" ? Number(schedule.day_of_month) : null,
    requested_first_run: recurrenceEnabled ? `${schedule.first_run}:00` : null,
    requested_timezone: recurrenceEnabled ? timezone : null,
  });
  if (error) throw friendlyTaskScheduleError(error);
  return data;
}

function friendlyTaskScheduleError(error) {
  const message = String(error?.message || "").toLowerCase();
  if (message.includes("not allowed")) return new Error("No tienes permiso para configurar esta tarea.");
  if (message.includes("evidence history")) return new Error("No puedes activar recurrencia después de entregar evidencia.");
  if (message.includes("open task")) return new Error("Reabre la tarea antes de activar recurrencia.");
  if (message.includes("selected weekday")) return new Error("La primera ejecución debe coincidir con el día semanal elegido.");
  if (message.includes("selected month day")) return new Error("La primera ejecución debe coincidir con el día mensual elegido.");
  if (message.includes("next recurrence")) return new Error("Selecciona una próxima ejecución futura antes de reactivar.");
  if (message.includes("invalid recurrence")) return new Error("La próxima ejecución debe ser futura y tener una configuración válida.");
  if (message.includes("invalid task configuration")) return new Error("Revisa los detalles y fechas de la tarea.");
  return new Error("No se pudo guardar la programación de la tarea.");
}

export async function deleteProjectTask(taskId) {
  const { error } = await supabase.from("project_tasks").delete().eq("id", taskId);
  if (error) throw error;
}

export async function createTaskEvidenceRequirement(taskId, requirement, userId) {
  const { data, error } = await supabase.from("task_evidence_requirements").insert({
    task_id: taskId, evidence_type: requirement.evidence_type, label: requirement.label.trim(),
    description: requirement.description?.trim() || null, is_required: requirement.is_required,
    min_count: requirement.is_required ? Number(requirement.min_count) : 0,
    max_count: Number(requirement.max_count), position: Number(requirement.position || 0), created_by: userId,
  }).select("*").single();
  if (error) throw friendlyEvidenceError(error);
  return data;
}

export async function updateTaskEvidenceRequirement(id, changes) {
  const { data, error } = await supabase.from("task_evidence_requirements").update(changes).eq("id", id).select("*").single();
  if (error) throw friendlyEvidenceError(error);
  return data;
}

export async function deleteTaskEvidenceRequirement(id) {
  const { error } = await supabase.from("task_evidence_requirements").delete().eq("id", id);
  if (error) throw friendlyEvidenceError(error);
}

export async function submitTaskEvidenceValue({ taskId, requirement, value, userId }) {
  const payload = { id: crypto.randomUUID(), task_id: taskId, requirement_id: requirement.id, evidence_type: requirement.evidence_type, submitted_by: userId };
  if (requirement.evidence_type === "url") payload.value_url = value.trim();
  else payload.value_text = value.trim();
  const { data, error } = await supabase.from("task_evidence").insert(payload).select("*").single();
  if (error) throw friendlyEvidenceError(error);
  return data;
}

export async function submitTaskEvidenceFile({ projectId, organizationId, taskId, requirement, file, userId, onProgress }) {
  validateTaskEvidenceFile(requirement.evidence_type, file);
  const id = crypto.randomUUID();
  const path = `${organizationId}/${projectId}/evidence/${taskId}/${id}/${sanitizeStorageFileName(file.name)}`;
  onProgress?.(20, "Subiendo");
  const upload = await supabase.storage.from("project-files").upload(path, file, { cacheControl: "3600", contentType: file.type, upsert: false });
  if (upload.error) throw friendlyFileError(upload.error, "No se pudo subir la evidencia.");
  onProgress?.(75, "Guardando");
  const metadata = await supabase.from("task_evidence").insert({ id, task_id: taskId, requirement_id: requirement.id, evidence_type: requirement.evidence_type, storage_path: path, file_name: file.name.trim(), mime_type: file.type, size_bytes: file.size, submitted_by: userId }).select("*").single();
  if (metadata.error) {
    await supabase.storage.from("project-files").remove([path]);
    throw friendlyFileError(metadata.error, "No se pudo registrar la evidencia.");
  }
  onProgress?.(100, "Completado");
  return metadata.data;
}

const evidenceSignedUrlCache = new Map();

export async function getTaskEvidencePreviewUrl(evidence) {
  if (!evidence.storage_path) return evidence.value_url || "";
  const cached = evidenceSignedUrlCache.get(evidence.storage_path);
  if (cached && cached.expiresAt > Date.now()) return cached.url;
  const { data, error } = await supabase.storage.from("project-files").createSignedUrl(evidence.storage_path, 300);
  if (error) throw friendlyEvidenceError(error, "No se pudo preparar la vista previa.");
  evidenceSignedUrlCache.set(evidence.storage_path, { url: data.signedUrl, expiresAt: Date.now() + 240000 });
  return data.signedUrl;
}

export async function openTaskEvidence(evidence) {
  if (evidence.value_url) { window.open(evidence.value_url, "_blank", "noopener,noreferrer"); return; }
  if (evidence.value_text) return;
  window.open(await getTaskEvidencePreviewUrl(evidence), "_blank", "noopener,noreferrer");
}

export async function downloadTaskEvidence(evidence) {
  const { data, error } = await supabase.storage.from("project-files").download(evidence.storage_path);
  if (error) throw friendlyEvidenceError(error, "No se pudo descargar la evidencia.");
  const url = URL.createObjectURL(data);
  const anchor = document.createElement("a");
  anchor.href = url; anchor.download = evidence.file_name || "evidencia"; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function deleteTaskEvidence(evidence) {
  if (evidence.storage_path) {
    const { error } = await supabase.storage.from("project-files").remove([evidence.storage_path]);
    if (error) throw friendlyFileError(error, "No se pudo eliminar el archivo de evidencia.");
  }
  const { error } = await supabase.from("task_evidence").update({ deleted_at: new Date().toISOString() }).eq("id", evidence.id);
  if (error) throw friendlyEvidenceError(error);
}

const evidenceDocumentTypes = new Set([...PROJECT_FILE_ALLOWED_MIME_TYPES].filter((type) => !type.startsWith("image/")));
export function validateTaskEvidenceFile(type, file) {
  if (!file.size || file.size > PROJECT_FILE_MAX_BYTES) throw new Error("La evidencia debe pesar entre 1 byte y 50 MB.");
  if (type === "image" && (!new Set(["image/jpeg", "image/png", "image/webp"]).has(file.type) || file.size > 20 * 1024 * 1024)) throw new Error("La imagen debe ser JPG, PNG o WEBP y pesar hasta 20 MB.");
  if (type === "video" && !new Set(["video/mp4", "video/webm"]).has(file.type)) throw new Error("El video debe ser MP4 o WEBM y pesar hasta 50 MB.");
  if (type === "document" && !evidenceDocumentTypes.has(file.type)) throw new Error("El tipo de documento no está permitido.");
}

function friendlyEvidenceError(error, fallback = "No se pudo completar la acción con la evidencia.") {
  const message = String(error?.message || "").toLowerCase();
  if (message.includes("required evidence is incomplete")) return new Error("No puedes completar esta tarea todavía. Falta evidencia obligatoria.");
  if (message.includes("maximum evidence count")) return new Error("Este requisito ya alcanzó el máximo de evidencias.");
  if (message.includes("evidence requirements cannot be changed")) return new Error("Reabre la tarea para modificar sus requisitos de evidencia.");
  if (message.includes("evidence cannot be deleted") || message.includes("evidence may only")) return new Error("Reabre la tarea antes de retirar esta evidencia.");
  if (message.includes("evidence type cannot change")) return new Error("El tipo no puede cambiar porque este requisito ya tiene historial de evidencia.");
  if (message.includes("row-level security") || message.includes("permission")) return new Error("No tienes permiso para realizar esta acción.");
  if (message.includes("mime") || message.includes("type")) return new Error("El tipo de archivo no está permitido para este requisito.");
  if (message.includes("size") || message.includes("too large")) return new Error("El archivo supera el tamaño permitido.");
  if (message.includes("not found")) return new Error("La evidencia ya no está disponible.");
  return new Error(fallback);
}

export async function createProjectDeliverable(projectId, values, userId) {
  const { data, error } = await supabase.from("project_deliverables").insert({
    project_id: projectId,
    title: values.title.trim(),
    due_at: values.due_at ? new Date(`${values.due_at}T23:59:59`).toISOString() : null,
    created_by: userId,
  }).select("*").single();
  if (error) throw error;
  return data;
}

export async function updateProjectDeliverable(deliverableId, changes) {
  const { data, error } = await supabase.from("project_deliverables").update(changes).eq("id", deliverableId).select("*").single();
  if (error) throw error;
  return data;
}

export async function deleteProjectDeliverable(deliverableId) {
  const { error } = await supabase.from("project_deliverables").delete().eq("id", deliverableId);
  if (error) throw error;
}

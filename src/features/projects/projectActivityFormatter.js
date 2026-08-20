const statusLabels = {
  planned: "Planificación", active: "Activo", blocked: "En pausa", completed: "Completado",
  cancelled: "Cancelado", archived: "Archivado", pending: "Pendiente", in_progress: "En progreso",
  approved: "Aprobado", delivered: "Entregado", rejected: "Rechazado",
};
const roleLabels = { owner: "propietario", member: "miembro", observer: "observador" };

function subject(payload, fallback) { return payload?.title || payload?.name || fallback; }
function quoted(value) { return value ? `“${value}”` : ""; }

export function formatProjectActivity(row) {
  const actor = row.actor_name || "Sistema";
  const payload = row.payload || {};
  const targetName = payload.affected_user_name || "Un miembro";
  const task = quoted(subject(payload, "una tarea"));
  const deliverable = quoted(subject(payload, "un entregable"));
  const project = quoted(subject(payload, "el proyecto"));
  const formats = {
    project_created: `${actor} creó el proyecto ${project}`,
    project_updated: `${actor} actualizó el proyecto ${project}`,
    project_status_changed: `${actor} cambió el proyecto de ${statusLabels[payload.old_status] || payload.old_status || "otro estado"} a ${statusLabels[payload.new_status] || payload.new_status || "otro estado"}`,
    project_completed: `${actor} completó el proyecto ${project}`,
    project_reopened: `${actor} reabrió el proyecto ${project}`,
    project_archived: `${actor} archivó el proyecto ${project}`,
    project_owner_changed: `${actor} cambió el responsable del proyecto ${project}`,
    task_created: `${actor} creó la tarea ${task}`,
    task_updated: `${actor} actualizó la tarea ${task}`,
    task_status_changed: `${actor} cambió la tarea ${task} de ${statusLabels[payload.old_status] || payload.old_status || "otro estado"} a ${statusLabels[payload.new_status] || payload.new_status || "otro estado"}`,
    task_completed: `${actor} completó la tarea ${task}`,
    task_reopened: `${actor} reabrió la tarea ${task}`,
    task_deleted: `${actor} eliminó la tarea ${task}`,
    task_recurrence_activated: `${actor} activó la repetición de ${task}`,
    task_recurrence_changed: `${actor} modificó la repetición de ${task}`,
    task_recurrence_stopped: `${actor} detuvo la repetición de ${task}`,
    task_recurrence_auto_paused: `La tarea programada ${task} fue pausada automáticamente porque ${operationalReason(payload.reason)}`,
    deliverable_created: `${actor} creó el entregable ${deliverable}`,
    deliverable_updated: `${actor} actualizó el entregable ${deliverable}`,
    deliverable_status_changed: `${actor} cambió el entregable ${deliverable} de ${statusLabels[payload.old_status] || payload.old_status || "otro estado"} a ${statusLabels[payload.new_status] || payload.new_status || "otro estado"}`,
    deliverable_approved: `${actor} aprobó el entregable ${deliverable}`,
    deliverable_deleted: `${actor} eliminó el entregable ${deliverable}`,
    member_added: `${actor} añadió a ${targetName} como ${roleLabels[payload.new_role] || payload.new_role || "miembro"}`,
    member_removed: `${actor} retiró a ${targetName} del proyecto`,
    member_role_changed: `${actor} cambió a ${targetName} de ${roleLabels[payload.old_role] || payload.old_role || "otro rol"} a ${roleLabels[payload.new_role] || payload.new_role || "otro rol"}`,
    comment_added: `${actor} publicó un comentario`,
    comment_edited: `${actor} editó un comentario`,
    comment_deleted: `${actor} eliminó un comentario`,
    file_uploaded: `${actor} subió ${quoted(payload.name || "un archivo")}`,
    file_deleted: `${actor} eliminó ${quoted(payload.name || "un archivo")}`,
    evidence_requirement_added: `${actor} añadió el requisito de evidencia ${quoted(payload.label || "sin nombre")}`,
    evidence_requirement_updated: `${actor} actualizó el requisito de evidencia ${quoted(payload.label || "sin nombre")}`,
    evidence_requirement_removed: `${actor} eliminó el requisito de evidencia ${quoted(payload.label || "sin nombre")}`,
    evidence_submitted: `${actor} presentó evidencia para ${quoted(payload.label || "un requisito")}`,
    evidence_removed: `${actor} eliminó evidencia de ${quoted(payload.label || "un requisito")}`,
  };
  return formats[row.event_type] || "Se registró actividad en el proyecto.";
}

function operationalReason(reason) {
  if (reason === "assignee_not_project_member") return "el responsable ya no pertenece al proyecto";
  if (reason === "creator_not_organization_member") return "su creador ya no pertenece a la organización";
  if (reason === "template_unavailable") return "la regla original ya no está disponible";
  if (reason === "project_unavailable") return "el proyecto ya no está disponible";
  return "requiere revisión operativa";
}

export function formatActivityDate(value, now = new Date()) {
  const date = new Date(value);
  const diff = Math.max(0, now.getTime() - date.getTime());
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "Ahora";
  if (minutes < 60) return `Hace ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 6) return `Hace ${hours} h`;
  const day = new Intl.DateTimeFormat("es", { timeZone: undefined, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
  const today = new Intl.DateTimeFormat("es", { year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  const yesterdayDate = new Date(now); yesterdayDate.setDate(now.getDate() - 1);
  const yesterday = new Intl.DateTimeFormat("es", { year: "numeric", month: "2-digit", day: "2-digit" }).format(yesterdayDate);
  const time = new Intl.DateTimeFormat("es", { hour: "numeric", minute: "2-digit" }).format(date);
  if (day === today) return `Hoy, ${time}`;
  if (day === yesterday) return `Ayer, ${time}`;
  return new Intl.DateTimeFormat("es", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" }).format(date);
}

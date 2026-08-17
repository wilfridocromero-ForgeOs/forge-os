import { useState } from "react";
import { Archive, Edit3, Folder, History } from "lucide-react";
import Modal from "../../components/ui/Modal";
import Button from "../../components/ui/Button";
import { getProjectActivity } from "../../services/ProjectService";
import ProjectWorkPanel from "./ProjectWorkPanel";
import ProjectMembersPanel from "./ProjectMembersPanel";

const tabs = [
  ["summary", "Resumen"],
  ["tasks", "Tareas"],
  ["members", "Miembros"],
  ["files", "Archivos"],
  ["activity", "Actividad"],
];
const statusLabels = { planned: "Planificación", active: "Activo", blocked: "En pausa", completed: "Completado", cancelled: "Cancelado", archived: "Archivado" };
const priorityLabels = { low: "Baja", medium: "Media", high: "Alta", urgent: "Urgente" };
const eventLabels = {
  project_created: "Proyecto creado", project_updated: "Proyecto actualizado", project_status_changed: "Estado del proyecto actualizado",
  project_completed: "Proyecto completado", project_reopened: "Proyecto reabierto", project_archived: "Proyecto archivado",
  task_created: "Tarea creada", task_updated: "Tarea actualizada", task_status_changed: "Estado de tarea actualizado",
  task_completed: "Tarea completada", task_reopened: "Tarea reabierta", task_deleted: "Tarea eliminada",
  deliverable_created: "Entregable creado", deliverable_updated: "Entregable actualizado",
  deliverable_status_changed: "Estado de entregable actualizado", deliverable_approved: "Entregable aprobado", deliverable_deleted: "Entregable eliminado",
  member_added: "Miembro añadido", member_removed: "Miembro retirado", member_role_changed: "Rol de miembro actualizado", project_owner_changed: "Propietario del proyecto actualizado",
};
function dateLabel(value) { return value ? new Intl.DateTimeFormat("es", { day: "numeric", month: "long", year: "numeric" }).format(new Date(value)) : "Sin fecha"; }
function dateTimeLabel(value) { return new Intl.DateTimeFormat("es", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)); }

export default function ProjectDetail({ project, users, projectMembers = [], onMembersChange, userId, canEdit, canManageMembers, onClose, onEdit, onArchive, onProjectChange, embedded = false }) {
  const [tab, setTab] = useState("summary");
  const [activity, setActivity] = useState([]);
  const [activityError, setActivityError] = useState("");
  const [activityLoading, setActivityLoading] = useState(false);

  async function selectTab(nextTab) {
    setTab(nextTab);
    if (nextTab !== "activity") return;
    if (!project?.id) return;
    setActivityLoading(true);
    setActivityError("");
    try { setActivity(await getProjectActivity(project.id)); }
    catch (reason) { setActivityError(reason.message || "No se pudo cargar la actividad."); }
    finally { setActivityLoading(false); }
  }

  if (!project) return null;

  const content = <div className="space-y-6">
    <div className="flex flex-col gap-4 rounded-2xl border border-zinc-800 bg-zinc-950/60 p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex flex-wrap items-center gap-3"><span className="rounded-full bg-zinc-800 px-3 py-1 text-xs text-zinc-200">{statusLabels[project.status] || project.status}</span><strong className="text-2xl text-white">{Number(project.progress)}%</strong></div>
      {canEdit && <div className="flex gap-2"><Button variant="ghost" onClick={onEdit}><Edit3 size={15} /> Editar</Button>{project.status !== "archived" && <Button variant="ghost" onClick={onArchive}><Archive size={15} /> Archivar</Button>}</div>}
    </div>
    <nav className="flex gap-1 overflow-x-auto border-b border-zinc-800" aria-label="Secciones del proyecto">{tabs.map(([key, label]) => <button type="button" key={key} onClick={() => selectTab(key)} className={`shrink-0 border-b-2 px-4 py-3 text-sm ${tab === key ? "border-white text-white" : "border-transparent text-zinc-500"}`}>{label}</button>)}</nav>
    {tab === "summary" && <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <Info label="Cliente" value={project.clients?.company_name || "Proyecto interno"} />
      <Info label="Responsable" value={project.owner?.first_name || "Sin asignar"} />
      <Info label="División" value={project.divisions?.name || "Sin división"} />
      <Info label="Fecha límite" value={dateLabel(project.due_at)} />
      <Info label="Prioridad" value={priorityLabels[project.priority]} />
      <Info label="Fecha de inicio" value={dateLabel(project.starts_at)} />
      <div className="sm:col-span-2 lg:col-span-4"><p className="text-xs uppercase tracking-[.18em] text-zinc-600">Descripción</p><p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-zinc-300">{project.description || "Sin descripción"}</p></div>
    </div>}
    {tab === "tasks" && <ProjectWorkPanel projectId={project.id} users={projectMembers.filter((member) => ["owner", "member"].includes(member.role)).map((member) => member.user).filter(Boolean)} userId={userId} onProgressChange={(progress) => onProjectChange?.({ ...project, progress })} />}
    {tab === "members" && <ProjectMembersPanel projectId={project.id} members={projectMembers} organizationUsers={users} actorId={userId} canManage={canManageMembers} onChange={onMembersChange} />}
    {tab === "files" && <Placeholder icon={Folder} title="Archivos del proyecto" text="La base de archivos ya existe y queda preparada para una siguiente iteración." />}
    {tab === "activity" && <ActivityTimeline rows={activity} loading={activityLoading} error={activityError} />}
  </div>;

  if (embedded) return content;
  return <Modal open onClose={onClose} title={project.name} subtitle={project.clients?.company_name || "Proyecto interno"} size="xl">{content}</Modal>;
}

function ActivityTimeline({ rows, loading, error }) {
  if (loading) return <p className="text-sm text-zinc-500">Cargando actividad…</p>;
  if (error) return <p className="rounded-xl border border-red-900/50 bg-red-950/20 p-3 text-sm text-red-300">{error}</p>;
  if (!rows.length) return <Placeholder icon={History} title="Sin actividad registrada" text="Los nuevos cambios operacionales aparecerán aquí." />;
  return <ol className="space-y-3">{rows.map((row) => <li key={row.id} className="rounded-xl border border-zinc-800 p-4">
    <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between"><strong className="text-sm text-white">{eventLabels[row.event_type] || row.event_type}</strong><time className="text-xs text-zinc-600">{dateTimeLabel(row.created_at)}</time></div>
    <p className="mt-1 text-xs text-zinc-500">{row.actor?.first_name || "Sistema"}{row.payload?.title || row.payload?.name ? ` · ${row.payload.title || row.payload.name}` : ""}</p>
    {row.payload?.old_status && row.payload?.new_status && <p className="mt-2 text-xs text-zinc-400">{statusLabels[row.payload.old_status] || row.payload.old_status} → {statusLabels[row.payload.new_status] || row.payload.new_status}</p>}
  </li>)}</ol>;
}

function Info({ label, value }) { return <div className="min-w-0 rounded-xl border border-zinc-800 p-4"><p className="text-xs uppercase tracking-[.16em] text-zinc-600">{label}</p><p className="mt-2 truncate text-sm text-zinc-200">{value}</p></div>; }
function Placeholder({ icon: Icon, title, text }) { return <div className="rounded-2xl border border-dashed border-zinc-800 p-8 text-center"><Icon className="mx-auto text-zinc-600" size={24} /><h3 className="mt-3 font-medium text-white">{title}</h3><p className="mx-auto mt-2 max-w-lg text-sm text-zinc-500">{text}</p></div>; }

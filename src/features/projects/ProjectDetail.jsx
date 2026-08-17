import { useState } from "react";
import { Archive, Edit3 } from "lucide-react";
import Modal from "../../components/ui/Modal";
import Button from "../../components/ui/Button";
import ProjectWorkPanel from "./ProjectWorkPanel";
import ProjectMembersPanel from "./ProjectMembersPanel";
import ProjectCommentsPanel from "./ProjectCommentsPanel";
import ProjectActivityPanel from "./ProjectActivityPanel";
import ProjectFilesPanel from "./ProjectFilesPanel";

const tabs = [
  ["summary", "Resumen"],
  ["tasks", "Tareas"],
  ["members", "Miembros"],
  ["comments", "Comentarios"],
  ["activity", "Actividad"],
  ["files", "Archivos"],
];
const statusLabels = { planned: "Planificación", active: "Activo", blocked: "En pausa", completed: "Completado", cancelled: "Cancelado", archived: "Archivado" };
const priorityLabels = { low: "Baja", medium: "Media", high: "Alta", urgent: "Urgente" };
function dateLabel(value) { return value ? new Intl.DateTimeFormat("es", { day: "numeric", month: "long", year: "numeric" }).format(new Date(value)) : "Sin fecha"; }

export default function ProjectDetail({ project, organizationId, users, projectMembers = [], onMembersChange, userId, canEdit, canManageMembers, canComment, onClose, onEdit, onArchive, onProjectChange, embedded = false }) {
  const [tab, setTab] = useState("summary");

  if (!project) return null;

  const content = <div className="space-y-6">
    <div className="flex flex-col gap-4 rounded-2xl border border-zinc-800 bg-zinc-950/60 p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex flex-wrap items-center gap-3"><span className="rounded-full bg-zinc-800 px-3 py-1 text-xs text-zinc-200">{statusLabels[project.status] || project.status}</span><strong className="text-2xl text-white">{Number(project.progress)}%</strong></div>
      {canEdit && <div className="flex gap-2"><Button variant="ghost" onClick={onEdit}><Edit3 size={15} /> Editar</Button>{project.status !== "archived" && <Button variant="ghost" onClick={onArchive}><Archive size={15} /> Archivar</Button>}</div>}
    </div>
    <nav className="flex gap-1 overflow-x-auto border-b border-zinc-800" aria-label="Secciones del proyecto">{tabs.map(([key, label]) => <button type="button" key={key} onClick={() => setTab(key)} className={`shrink-0 border-b-2 px-4 py-3 text-sm ${tab === key ? "border-white text-white" : "border-transparent text-zinc-500"}`}>{label}</button>)}</nav>
    {tab === "summary" && <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <Info label="Cliente" value={project.clients?.company_name || "Proyecto interno"} />
      <Info label="Responsable" value={project.owner?.first_name || "Sin asignar"} />
      <Info label="División" value={project.divisions?.name || "Sin división"} />
      <Info label="Fecha límite" value={dateLabel(project.due_at)} />
      <Info label="Prioridad" value={priorityLabels[project.priority]} />
      <Info label="Fecha de inicio" value={dateLabel(project.starts_at)} />
      <div className="sm:col-span-2 lg:col-span-4"><p className="text-xs uppercase tracking-[.18em] text-zinc-600">Descripción</p><p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-zinc-300">{project.description || "Sin descripción"}</p></div>
    </div>}
    {tab === "tasks" && <ProjectWorkPanel projectId={project.id} organizationId={organizationId} users={projectMembers.filter((member) => ["owner", "member"].includes(member.role)).map((member) => member.user).filter(Boolean)} userId={userId} canManage={canManageMembers} onProgressChange={(progress) => onProjectChange?.({ ...project, progress })} />}
    {tab === "members" && <ProjectMembersPanel projectId={project.id} members={projectMembers} organizationUsers={users} actorId={userId} canManage={canManageMembers} onChange={onMembersChange} />}
    {tab === "comments" && <ProjectCommentsPanel projectId={project.id} userId={userId} canComment={canComment} canModerate={canManageMembers} />}
    {tab === "activity" && <ProjectActivityPanel projectId={project.id} />}
    {tab === "files" && <ProjectFilesPanel projectId={project.id} organizationId={organizationId} userId={userId} canUpload={canComment} canManage={canManageMembers} />}
  </div>;

  if (embedded) return content;
  return <Modal open onClose={onClose} title={project.name} subtitle={project.clients?.company_name || "Proyecto interno"} size="xl">{content}</Modal>;
}

function Info({ label, value }) { return <div className="min-w-0 rounded-xl border border-zinc-800 p-4"><p className="text-xs uppercase tracking-[.16em] text-zinc-600">{label}</p><p className="mt-2 truncate text-sm text-zinc-200">{value}</p></div>; }

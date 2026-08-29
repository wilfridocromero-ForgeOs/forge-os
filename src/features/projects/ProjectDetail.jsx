import { useCallback, useEffect, useMemo, useState } from "react";
import { Archive, CalendarDays, ChevronDown, Edit3 } from "lucide-react";
import Modal from "../../components/ui/Modal";
import ProjectActivityPanel from "./ProjectActivityPanel";
import ProjectCommentsPanel from "./ProjectCommentsPanel";
import ProjectFilesPanel from "./ProjectFilesPanel";
import ProjectMembersPanel from "./ProjectMembersPanel";
import ProjectSummary from "./ProjectSummary";
import ProjectWorkPanel from "./ProjectWorkPanel";
import { getProjectActivity, getProjectWork } from "../../services/ProjectService";

const tabs = [["summary", "Resumen"], ["work", "Trabajo"], ["files", "Archivos"], ["activity", "Actividad"]];
const statusLabels = { planned: "Planificación", active: "En progreso", blocked: "En pausa", completed: "Completado", cancelled: "Cancelado", archived: "Archivado" };

function dateRange(project) {
  const format = (value) => value ? new Intl.DateTimeFormat("es", { day: "numeric", month: "short" }).format(new Date(value)) : null;
  const start = format(project.starts_at);
  const end = format(project.due_at);
  if (start && end) return `${start} — ${end}`;
  if (end) return `Hasta ${end}`;
  if (start) return `Desde ${start}`;
  return "Sin fechas definidas";
}

export default function ProjectDetail({ project, organizationId, users, projectMembers = [], onMembersChange, userId, canEdit, canManageMembers, canComment, onClose, onEdit, onArchive, onProjectChange, tab = "summary", taskId = null, onTabChange, onTaskChange, embedded = false }) {
  const [showActions, setShowActions] = useState(false);
  const [showTeam, setShowTeam] = useState(false);
  const [work, setWork] = useState({ tasks: [], deliverables: [] });
  const [recentActivity, setRecentActivity] = useState([]);
  const [workspaceLoading, setWorkspaceLoading] = useState(true);
  const [workspaceError, setWorkspaceError] = useState("");
  const projectId = project?.id;

  const loadWorkspace = useCallback(async () => {
    if (!projectId) return;
    setWorkspaceLoading(true);
    setWorkspaceError("");
    try {
      const [nextWork, activity] = await Promise.all([
        getProjectWork(projectId),
        getProjectActivity(projectId, null, 6),
      ]);
      setWork(nextWork);
      setRecentActivity(activity);
    } catch (reason) {
      setWorkspaceError(reason.message || "No se pudo cargar el espacio de trabajo.");
    } finally {
      setWorkspaceLoading(false);
    }
  }, [projectId]);

  // The callback owns the async project workspace synchronization lifecycle.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { loadWorkspace(); }, [loadWorkspace]);

  useEffect(() => {
    const refreshTask = (event) => {
      if (event.detail?.projectId === projectId) void loadWorkspace();
    };
    window.addEventListener("orvesen:project-task-changed", refreshTask);
    return () => window.removeEventListener("orvesen:project-task-changed", refreshTask);
  }, [loadWorkspace, projectId]);

  const taskStats = useMemo(() => {
    const tasks = work.tasks.filter((task) => !task.is_recurrence_template && task.status !== "cancelled");
    const completed = tasks.filter((task) => task.status === "completed").length;
    const pending = tasks.filter((task) => task.status === "pending").length;
    const overdue = tasks.filter((task) => task.due_at && new Date(task.due_at) < new Date() && task.status !== "completed").length;
    return { total: tasks.length, completed, pending, overdue };
  }, [work.tasks]);

  if (!project) return null;

  const progress = Math.min(100, Math.max(0, Number(project.progress || 0)));
  const projectUsers = projectMembers.filter((member) => ["owner", "member"].includes(member.role)).map((member) => member.user).filter(Boolean);
  const content = <div className="min-w-0 space-y-6">
    <header className="min-w-0 rounded-3xl border border-zinc-800 bg-zinc-950/60 p-5 sm:p-7">
      <div className="flex min-w-0 flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 text-sm text-zinc-500">
            <span className="rounded-full border border-zinc-700 px-3 py-1 text-xs text-zinc-300">{statusLabels[project.status] || project.status}</span>
            <span>{project.divisions?.name || "Sin división"}</span>
            <span aria-hidden="true">·</span>
            <span className="inline-flex items-center gap-1"><CalendarDays size={14} /> {dateRange(project)}</span>
          </div>
          <h1 className="mt-4 break-words text-2xl font-semibold tracking-tight text-white sm:text-3xl lg:text-4xl">{project.name}</h1>
          <div className="mt-4 max-w-3xl"><p className="text-xs uppercase tracking-[.16em] text-zinc-600">Información del proyecto</p><p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-zinc-400">{project.description || "Este proyecto todavía no tiene contexto ni instrucciones generales."}</p></div>
        </div>
        {canEdit && <div className="relative shrink-0 self-start">
          <button type="button" aria-expanded={showActions} onClick={() => setShowActions((value) => !value)} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-zinc-800 px-4 text-sm text-zinc-400 hover:border-zinc-600 hover:text-white">Gestionar <ChevronDown size={15} /></button>
          {showActions && <div className="absolute right-0 top-12 z-20 w-48 rounded-xl border border-zinc-800 bg-zinc-950 p-1 shadow-2xl">
            <button type="button" onClick={() => { setShowActions(false); onEdit(); }} className="flex min-h-10 w-full items-center gap-2 rounded-lg px-3 text-left text-sm text-zinc-300 hover:bg-zinc-900"><Edit3 size={15} /> Editar proyecto</button>
            {project.status !== "archived" && <button type="button" onClick={() => { setShowActions(false); onArchive(); }} className="flex min-h-10 w-full items-center gap-2 rounded-lg px-3 text-left text-sm text-zinc-400 hover:bg-zinc-900 hover:text-red-300"><Archive size={15} /> Archivar</button>}
          </div>}
        </div>}
      </div>
      <div className="mt-6 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
        <div><div className="mb-2 flex items-center justify-between gap-3 text-sm"><span className="text-zinc-400">Progreso del proyecto</span><strong className="text-lg text-white">{progress}%</strong></div><div className="h-2 overflow-hidden rounded-full bg-zinc-800"><div className="h-full rounded-full bg-white transition-[width]" style={{ width: `${progress}%` }} /></div></div>
        <p className="text-xs text-zinc-500 sm:text-right">{taskStats.total} tareas · {taskStats.completed} completadas · {taskStats.pending} pendientes{taskStats.overdue ? ` · ${taskStats.overdue} vencidas` : ""}</p>
      </div>
    </header>

    <nav className="flex min-w-0 gap-1 overflow-x-auto rounded-2xl border border-zinc-800 bg-zinc-950/40 p-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" aria-label="Secciones del proyecto">{tabs.map(([key, label]) => <button type="button" key={key} onClick={() => onTabChange?.(key)} className={`min-h-11 shrink-0 rounded-xl px-4 text-sm font-medium transition sm:flex-1 ${tab === key ? "bg-white text-black" : "text-zinc-500 hover:bg-zinc-900 hover:text-white"}`}>{label}</button>)}</nav>

    {workspaceError && <p className="rounded-xl border border-red-900/50 bg-red-950/20 p-4 text-sm text-red-300">{workspaceError}</p>}
    {tab === "summary" && <>
      <ProjectSummary project={project} work={work} activity={recentActivity} members={projectMembers} loading={workspaceLoading} onViewWork={() => onTabChange?.("work")} onViewActivity={() => onTabChange?.("activity")} onViewTeam={() => setShowTeam((value) => !value)} />
      {showTeam && <div className="rounded-2xl border border-zinc-800 p-4 sm:p-6"><ProjectMembersPanel projectId={project.id} members={projectMembers} organizationUsers={users} actorId={userId} canManage={canManageMembers} onChange={onMembersChange} /></div>}
    </>}
    {tab === "work" && <ProjectWorkPanel projectId={project.id} organizationId={organizationId} users={projectUsers} userId={userId} canManage={canManageMembers} canSubmit={canComment} work={work} loading={workspaceLoading} projectProgress={project.progress} selectedTaskId={taskId} onSelectedTaskChange={onTaskChange} onReload={loadWorkspace} onProgressChange={(nextProgress) => onProjectChange?.({ ...project, progress: nextProgress })} />}
    {tab === "files" && <ProjectFilesPanel projectId={project.id} organizationId={organizationId} userId={userId} canUpload={canComment} canManage={canManageMembers} />}
    {tab === "activity" && <div className="grid min-w-0 gap-6 xl:grid-cols-[minmax(0,1.25fr)_minmax(320px,.75fr)]"><div><h2 className="mb-4 text-lg font-semibold text-white">Historia del proyecto</h2><ProjectActivityPanel projectId={project.id} /></div><aside><h2 className="mb-4 text-lg font-semibold text-white">Conversación</h2><ProjectCommentsPanel projectId={project.id} userId={userId} canComment={canComment} canModerate={canManageMembers} /></aside></div>}
  </div>;

  if (embedded) return content;
  return <Modal open onClose={onClose} title={project.name} subtitle={project.clients?.company_name || "Proyecto interno"} size="xl">{content}</Modal>;
}

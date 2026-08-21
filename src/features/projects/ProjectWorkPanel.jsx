import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CalendarDays, CheckCircle2, Circle, CircleDot, Plus, Repeat2, UserRound } from "lucide-react";
import TaskEditor from "./TaskEditor";
import TaskWorkspace from "./TaskWorkspace";

const groups = [
  { key: "todo", title: "Por hacer", icon: Circle, matches: (task) => ["pending", "blocked"].includes(task.status) },
  { key: "progress", title: "En progreso", icon: CircleDot, matches: (task) => task.status === "in_progress" },
  { key: "done", title: "Completado", icon: CheckCircle2, matches: (task) => task.status === "completed" },
];
const statusLabels = { pending: "Pendiente", in_progress: "En progreso", blocked: "Bloqueada", completed: "Completada" };

function shortDate(value) {
  if (!value) return "Sin fecha";
  const date = new Date(value);
  const today = new Date();
  if (date.toDateString() === today.toDateString()) return "Hoy";
  return new Intl.DateTimeFormat("es", { day: "numeric", month: "short" }).format(date);
}

function evidenceSummary(task) {
  const required = (task.evidence_requirements || []).filter((item) => item.is_required);
  return {
    total: required.reduce((sum, item) => sum + item.min_count, 0),
    submitted: required.reduce((sum, item) => sum + Math.min(item.evidence.length, item.min_count), 0),
  };
}

export default function ProjectWorkPanel({ projectId, organizationId, users, userId, canManage, canSubmit, work, loading, projectProgress, onReload, onProgressChange }) {
  const [editingTask, setEditingTask] = useState(undefined);
  const [selectedTaskId, setSelectedTaskId] = useState(null);
  const [error, setError] = useState("");

  const progress = useMemo(() => {
    const activeTasks = work.tasks.filter((item) => item.status !== "cancelled" && !item.is_recurrence_template);
    const activeDeliverables = work.deliverables.filter((item) => item.status !== "rejected");
    const total = activeTasks.length + activeDeliverables.length;
    const done = activeTasks.filter((item) => item.status === "completed").length + activeDeliverables.filter((item) => ["approved", "delivered"].includes(item.status)).length;
    return total ? Math.round((done / total) * 100) : 0;
  }, [work]);

  useEffect(() => {
    if (progress !== Number(projectProgress || 0)) onProgressChange?.(progress);
  }, [progress, projectProgress, onProgressChange]);

  const operationalTasks = work.tasks.filter((task) => !task.is_recurrence_template && task.status !== "cancelled");
  const recurrenceRules = work.tasks.filter((task) => task.is_recurrence_template);
  const selectedTask = work.tasks.find((task) => task.id === selectedTaskId) || null;

  async function reload() {
    setError("");
    try { await onReload(); } catch (reason) { setError(reason.message || "No se pudo actualizar el trabajo."); }
  }

  if (loading) return <p className="text-sm text-zinc-500">Cargando trabajo…</p>;

  return <section className="min-w-0 space-y-6">
    <div className="flex min-w-0 flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div><p className="text-xs uppercase tracking-[.18em] text-zinc-600">Centro operacional</p><h2 className="mt-1 text-xl font-semibold text-white">Trabajo del proyecto</h2><p className="mt-1 text-sm text-zinc-500">Abre una tarea para trabajar; usa Editar solo para cambiar su configuración.</p></div>
      {canSubmit && <button type="button" onClick={() => setEditingTask(null)} className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-white px-4 text-sm font-medium text-black sm:w-auto"><Plus size={17} /> Nueva tarea</button>}
    </div>
    {error && <p className="rounded-xl border border-red-900/50 bg-red-950/20 p-3 text-sm text-red-300">{error}</p>}

    {!operationalTasks.length ? <div className="rounded-2xl border border-dashed border-zinc-800 p-8 text-center sm:p-12"><CheckCircle2 className="mx-auto text-zinc-600" size={28} /><h3 className="mt-4 text-lg font-semibold text-white">Este proyecto está listo para comenzar.</h3><p className="mt-2 text-sm text-zinc-500">Crea la primera tarea para empezar a trabajar.</p>{canSubmit && <button type="button" onClick={() => setEditingTask(null)} className="mt-5 min-h-11 rounded-xl bg-white px-5 text-sm font-medium text-black">Nueva tarea</button>}</div> : <div className="grid min-w-0 gap-5 lg:grid-cols-3">{groups.map((group) => {
      const items = operationalTasks.filter(group.matches);
      const Icon = group.icon;
      return <section key={group.key} className="min-w-0 rounded-2xl border border-zinc-800 bg-zinc-950/30 p-3 sm:p-4">
        <h3 className="flex items-center gap-2 px-1 text-sm font-semibold text-white"><Icon size={16} className="text-zinc-500" /> {group.title} <span className="text-zinc-600">({items.length})</span></h3>
        <div className="mt-3 space-y-3">{items.map((task) => <TaskCard key={task.id} task={task} onOpen={() => setSelectedTaskId(task.id)} />)}{!items.length && <p className="rounded-xl border border-dashed border-zinc-800 px-3 py-6 text-center text-xs text-zinc-600">Sin tareas en esta etapa.</p>}</div>
      </section>;
    })}</div>}

    {recurrenceRules.length > 0 && <details className="rounded-2xl border border-zinc-800 p-4"><summary className="cursor-pointer text-sm font-medium text-zinc-400">Reglas de repetición ({recurrenceRules.length})</summary><div className="mt-3 space-y-2">{recurrenceRules.map((task) => <button type="button" key={task.id} onClick={() => setSelectedTaskId(task.id)} className="flex min-h-12 w-full items-center gap-3 rounded-xl border border-zinc-800 px-3 text-left text-sm text-zinc-300"><Repeat2 size={15} className="text-blue-400" /><span className="min-w-0 flex-1 truncate">{task.title}</span><span className="text-xs text-zinc-600">{task.recurrence_schedule?.active ? "Activa" : "Pausada"}</span></button>)}</div></details>}

    {selectedTask && <TaskWorkspace task={selectedTask} projectId={projectId} organizationId={organizationId} userId={userId} canManage={canManage} canSubmit={canSubmit} onClose={() => setSelectedTaskId(null)} onEdit={() => { setSelectedTaskId(null); setEditingTask(selectedTask); }} onChange={reload} reportError={setError} />}
    {editingTask !== undefined && <TaskEditor projectId={projectId} task={editingTask} users={users} onClose={() => setEditingTask(undefined)} onSaved={reload} reportError={setError} />}
  </section>;
}

function TaskCard({ task, onOpen }) {
  const evidence = evidenceSummary(task);
  const overdue = task.due_at && new Date(task.due_at) < new Date() && task.status !== "completed";
  return <button type="button" onClick={onOpen} className="block min-h-24 w-full min-w-0 rounded-xl border border-zinc-800 bg-zinc-950 p-4 text-left transition hover:border-zinc-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500">
    <div className="flex min-w-0 items-start justify-between gap-3"><h4 className="min-w-0 break-words text-sm font-medium leading-5 text-white">{task.title}</h4>{overdue && <AlertTriangle aria-label="Vencida" size={15} className="shrink-0 text-red-400" />}</div>
    <p className="mt-2 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-500"><span className="inline-flex items-center gap-1"><UserRound size={12} /> {task.assignee?.first_name || "Sin asignar"}</span><span className={`inline-flex items-center gap-1 ${overdue ? "text-red-400" : ""}`}><CalendarDays size={12} /> {shortDate(task.due_at || task.starts_at)}</span></p>
    <div className="mt-3 flex flex-wrap gap-2"><span className="rounded-full bg-zinc-900 px-2.5 py-1 text-[11px] text-zinc-400">{statusLabels[task.status] || task.status}</span>{task.recurrence_schedule && <span className="inline-flex items-center gap-1 rounded-full bg-blue-950/40 px-2.5 py-1 text-[11px] text-blue-300"><Repeat2 size={11} /> Repetición</span>}{evidence.total > 0 && <span className={`rounded-full px-2.5 py-1 text-[11px] ${evidence.submitted >= evidence.total ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300" : "bg-amber-50 text-amber-800 dark:bg-amber-950/30 dark:text-amber-300"}`}>Evidencia {evidence.submitted >= evidence.total ? "completa" : "pendiente"} · {evidence.submitted}/{evidence.total}</span>}</div>
  </button>;
}

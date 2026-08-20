import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarDays, Check, Plus, Repeat2, Trash2, UserRound } from "lucide-react";
import {
  createProjectDeliverable,
  createProjectTask,
  deleteProjectDeliverable,
  deleteProjectTask,
  getProjectWork,
  updateProjectDeliverable,
  updateProjectTask,
} from "../../services/ProjectService";
import TaskEvidencePanel from "./TaskEvidencePanel";
import TaskScheduleEditor from "./TaskScheduleEditor";
import { compactTaskDate, recurrenceSummary } from "./taskScheduleConfig";

const field = "min-w-0 rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2.5 text-sm text-white outline-none focus:border-zinc-600";
const workLabels = { task: "Tarea", checklist: "Checklist", milestone: "Hito", review: "Revisión" };
const taskStatusLabels = { pending: "Pendiente", in_progress: "En progreso", blocked: "Bloqueada", completed: "Completada", cancelled: "Cancelada" };

export default function ProjectWorkPanel({ projectId, organizationId, users, userId, canManage, canSubmit, onProgressChange }) {
  const [work, setWork] = useState({ tasks: [], deliverables: [] });
  const [task, setTask] = useState({ title: "", description: "", work_type: "task", status: "pending", priority: "medium", assigned_to: "", starts_at: "", due_at: "", evidence_requirements: [] });
  const [deliverable, setDeliverable] = useState({ title: "", due_at: "" });
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try { setWork(await getProjectWork(projectId)); } catch (reason) { setError(reason.message); }
  }, [projectId]);
  // The callback synchronizes this editor with Supabase whenever the selected project changes.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);

  const progress = useMemo(() => {
    const activeTasks = work.tasks.filter((item) => item.status !== "cancelled" && !item.is_recurrence_template);
    const activeDeliverables = work.deliverables.filter((item) => item.status !== "rejected");
    const total = activeTasks.length + activeDeliverables.length;
    const done = activeTasks.filter((item) => item.status === "completed").length + activeDeliverables.filter((item) => ["approved", "delivered"].includes(item.status)).length;
    return total ? Math.round((done / total) * 100) : 0;
  }, [work]);

  useEffect(() => { onProgressChange?.(progress); }, [progress, onProgressChange]);

  async function addTask(event) {
    event.preventDefault();
    if (!task.title.trim()) return;
    try { setError(""); await createProjectTask(projectId, task, userId); setTask({ ...task, title: "" }); await load(); }
    catch (reason) { setError(reason.message); }
  }

  async function addDeliverable(event) {
    event.preventDefault();
    if (!deliverable.title.trim()) return;
    try { setError(""); await createProjectDeliverable(projectId, deliverable, userId); setDeliverable({ title: "", due_at: "" }); await load(); }
    catch (reason) { setError(reason.message); }
  }

  async function mutate(action) {
    try { setError(""); await action(); await load(); } catch (reason) { setError(reason.message); }
  }

  return (
    <section className="space-y-5 border-t border-zinc-800 pt-6">
      <div className="flex items-end justify-between gap-4">
        <div><h3 className="font-semibold text-white">Trabajo y progreso</h3><p className="mt-1 text-sm text-zinc-500">Se calcula con tareas, checklist, hitos, revisiones y entregables reales.</p></div>
        <strong className="text-xl text-white">{progress}%</strong>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-zinc-800"><div className="h-full bg-white transition-[width]" style={{ width: `${progress}%` }} /></div>
      {error && <p className="rounded-xl border border-red-900/50 bg-red-950/20 p-3 text-sm text-red-300">{error}</p>}

      {canSubmit && <form onSubmit={addTask} className="flex min-w-0 flex-col gap-2 rounded-2xl border border-zinc-800 p-3 sm:flex-row">
        <input required minLength={2} maxLength={180} aria-label="Título de la tarea" className={`${field} min-w-0 flex-1`} placeholder="Escribe una tarea" value={task.title} onChange={(e) => setTask({ ...task, title: e.target.value })} />
        <button type="submit" className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-xl bg-white px-4 text-sm font-medium text-black"><Plus size={17} /> Crear tarea</button>
      </form>}

      <div className="space-y-2">
        {work.tasks.map((item) => { const compliant = (item.evidence_requirements || []).every((requirement) => !requirement.is_required || requirement.evidence.length >= requirement.min_count); const canEditTask = canManage || item.created_by === userId || item.assigned_to === userId; const canDeleteTask = canManage || item.created_by === userId; return <div key={item.id} className={`grid min-w-0 gap-3 rounded-xl border px-3 py-3 sm:grid-cols-[auto_minmax(0,1fr)_150px_auto] sm:items-center ${item.is_recurrence_template ? "border-blue-900/60 bg-blue-950/10" : "border-zinc-800"}`}>
          {item.is_recurrence_template ? <div className="flex h-7 w-7 items-center justify-center rounded-full border border-blue-800 text-blue-300"><Repeat2 size={14} /></div> : <button type="button" disabled={!canEditTask || (item.status !== "completed" && !compliant)} title={!compliant ? "Completa las evidencias obligatorias" : ""} aria-label={item.status === "completed" ? "Reabrir" : "Completar"} onClick={() => mutate(() => updateProjectTask(item.id, { status: item.status === "completed" ? "pending" : "completed" }))} className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border disabled:cursor-not-allowed disabled:opacity-40 ${item.status === "completed" ? "border-white bg-white text-black" : "border-zinc-700 text-transparent"}`}><Check size={15} /></button>}
          <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><p className={`break-words text-sm ${item.status === "completed" ? "text-zinc-600 line-through" : "text-white"}`}>{item.title}</p>{item.is_recurrence_template && <span className="rounded-full bg-blue-950 px-2 py-0.5 text-[10px] text-blue-300">Regla recurrente</span>}</div>{item.description && <p className="mt-1 break-words text-xs text-zinc-500">{item.description}</p>}<div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-zinc-600"><span>{workLabels[item.work_type]}</span><span className="inline-flex items-center gap-1"><UserRound size={11} />{item.assignee?.first_name || "Sin asignar"}</span>{(item.due_at || item.starts_at) && <span className="inline-flex items-center gap-1"><CalendarDays size={11} />{compactTaskDate(item.due_at || item.starts_at)}</span>}{item.recurrence_schedule && <span className={`inline-flex items-center gap-1 ${item.recurrence_schedule.active ? "text-blue-400" : "text-amber-400"}`}><Repeat2 size={11} />{recurrenceSummary(item.recurrence_schedule)}</span>}</div></div>
          {item.is_recurrence_template ? <span className="text-xs text-zinc-500">{item.recurrence_schedule?.active ? `Próxima: ${compactTaskDate(item.recurrence_schedule.next_run_at)}` : "Repetición pausada"}</span> : canEditTask ? <select aria-label={`Estado de ${item.title}`} className={field} value={item.status} onChange={(e) => mutate(() => updateProjectTask(item.id, { status: e.target.value }))}>{Object.entries(taskStatusLabels).map(([value, label]) => <option key={value} value={value} disabled={value === "completed" && !compliant}>{label}</option>)}</select> : <span className="text-xs text-zinc-500">{taskStatusLabels[item.status]}</span>}
          {canDeleteTask ? <button type="button" aria-label="Eliminar" onClick={() => mutate(() => deleteProjectTask(item.id))} className="p-2 text-zinc-600 hover:text-red-300"><Trash2 size={15} /></button> : <span />}
          {canEditTask && <TaskScheduleEditor task={item} users={users} canEdit onChange={load} reportError={setError} />}
          <TaskEvidencePanel task={item} projectId={projectId} organizationId={organizationId} userId={userId} canManage={canManage} canSubmit={canSubmit && !item.is_recurrence_template} onChange={load} reportError={setError} />
        </div>; })}
      </div>

      <form onSubmit={addDeliverable} className="grid gap-2 rounded-2xl border border-zinc-800 p-3 sm:grid-cols-[1fr_170px_auto]">
        <input aria-label="Título del entregable" className={field} placeholder="Nuevo entregable" value={deliverable.title} onChange={(e) => setDeliverable({ ...deliverable, title: e.target.value })} />
        <input aria-label="Fecha límite del entregable" type="date" className={field} value={deliverable.due_at} onChange={(e) => setDeliverable({ ...deliverable, due_at: e.target.value })} />
        <button type="submit" className="flex items-center justify-center gap-2 rounded-xl border border-zinc-700 px-4 text-sm text-white"><Plus size={16} /> Entregable</button>
      </form>
      <div className="space-y-2">
        {work.deliverables.map((item) => <div key={item.id} className="grid items-center gap-2 rounded-xl border border-zinc-800 px-3 py-3 sm:grid-cols-[1fr_150px_auto]">
          <span className="truncate text-sm text-white">{item.title}</span>
          <select aria-label={`Estado de ${item.title}`} className={field} value={item.status} onChange={(e) => mutate(() => updateProjectDeliverable(item.id, { status: e.target.value }))}><option value="pending">Pendiente</option><option value="in_review">En revisión</option><option value="approved">Aprobado</option><option value="delivered">Entregado</option><option value="rejected">Rechazado</option></select>
          <button type="button" aria-label="Eliminar entregable" onClick={() => mutate(() => deleteProjectDeliverable(item.id))} className="p-2 text-zinc-600 hover:text-red-300"><Trash2 size={15} /></button>
        </div>)}
      </div>
    </section>
  );
}

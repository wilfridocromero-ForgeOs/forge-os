import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarDays, Check, Pencil, Plus, Repeat2, Trash2, UserRound } from "lucide-react";
import {
  deleteProjectTask,
  getProjectWork,
  updateProjectTask,
} from "../../services/ProjectService";
import TaskEvidencePanel from "./TaskEvidencePanel";
import TaskEditor from "./TaskEditor";
import { compactTaskDate, recurrenceSummary } from "./taskScheduleConfig";

const taskStatusLabels = { pending: "Pendiente", in_progress: "En progreso", blocked: "Bloqueada", completed: "Completada", cancelled: "Cancelada" };

export default function ProjectWorkPanel({ projectId, organizationId, users, userId, canManage, canSubmit, onProgressChange }) {
  const [work, setWork] = useState({ tasks: [], deliverables: [] });
  const [editingTask, setEditingTask] = useState(undefined);
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

  async function mutate(action) {
    try { setError(""); await action(); await load(); } catch (reason) { setError(reason.message); }
  }

  async function removeTask(task) {
    if (!window.confirm("¿Eliminar esta tarea?\n\nSe eliminará de este proyecto.")) return;
    await mutate(() => deleteProjectTask(task.id));
  }

  return (
    <section className="space-y-5 border-t border-zinc-800 pt-6">
      <div className="flex items-end justify-between gap-4">
        <div><h3 className="font-semibold text-white">Trabajo y progreso</h3><p className="mt-1 text-sm text-zinc-500">El progreso se calcula automáticamente según el trabajo completado del proyecto.</p></div>
        <strong className="text-xl text-white">{progress}%</strong>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-zinc-800"><div className="h-full bg-white transition-[width]" style={{ width: `${progress}%` }} /></div>
      {error && <p className="rounded-xl border border-red-900/50 bg-red-950/20 p-3 text-sm text-red-300">{error}</p>}

      {canSubmit && <button type="button" onClick={() => setEditingTask(null)} className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-white px-4 text-sm font-medium text-black sm:w-auto"><Plus size={17} /> Nueva tarea</button>}
      {editingTask !== undefined && <TaskEditor projectId={projectId} task={editingTask} users={users} onClose={() => setEditingTask(undefined)} onSaved={load} reportError={setError} />}

      <div className="space-y-2">
        {work.tasks.map((item) => { const compliant = (item.evidence_requirements || []).every((requirement) => !requirement.is_required || requirement.evidence.length >= requirement.min_count); const canEditTask = canManage || item.created_by === userId || item.assigned_to === userId; const canDeleteTask = canManage || item.created_by === userId; return <div key={item.id} className={`grid min-w-0 gap-3 rounded-xl border px-3 py-3 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-center ${item.is_recurrence_template ? "border-blue-800/50" : "border-zinc-800"}`}>
          {item.is_recurrence_template ? <div className="flex h-7 w-7 items-center justify-center rounded-full border border-blue-800 text-blue-300"><Repeat2 size={14} /></div> : <button type="button" disabled={!canEditTask || (item.status !== "completed" && !compliant)} title={!compliant ? "Completa las evidencias obligatorias" : ""} aria-label={item.status === "completed" ? "Reabrir" : "Completar"} onClick={() => mutate(() => updateProjectTask(item.id, { status: item.status === "completed" ? "pending" : "completed" }))} className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border disabled:cursor-not-allowed disabled:opacity-40 ${item.status === "completed" ? "border-white bg-white text-black" : "border-zinc-700 text-transparent"}`}><Check size={15} /></button>}
          <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><p className={`break-words text-sm font-medium ${item.status === "completed" ? "text-zinc-600 line-through" : "text-white"}`}>{item.title}</p>{item.is_recurrence_template && <span className="rounded-full border border-blue-800 px-2 py-0.5 text-[10px] text-blue-400">Regla recurrente</span>}</div><div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-zinc-500"><span className="inline-flex items-center gap-1"><UserRound size={11} />{item.assignee?.first_name || "Sin asignar"}</span>{(item.due_at || item.starts_at) && <span className="inline-flex items-center gap-1"><CalendarDays size={11} />{compactTaskDate(item.due_at || item.starts_at)}</span>}<span>{taskStatusLabels[item.status]}</span>{item.recurrence_schedule && <span className={`inline-flex items-center gap-1 ${item.recurrence_schedule.active ? "text-blue-500" : "text-amber-600"}`}><Repeat2 size={11} />{recurrenceSummary(item.recurrence_schedule)}</span>}</div>{item.is_recurrence_template && <p className="mt-1 text-xs text-zinc-500">{item.recurrence_schedule?.active ? `Próxima: ${compactTaskDate(item.recurrence_schedule.next_run_at)}` : "Repetición pausada"}</p>}</div>
          <div className="flex shrink-0 items-center justify-end gap-1">{canEditTask && <button type="button" aria-label={`Editar ${item.title}`} onClick={() => setEditingTask(item)} className="inline-flex min-h-10 items-center gap-1 rounded-lg px-2 text-xs text-zinc-500 hover:bg-zinc-900 hover:text-white"><Pencil size={14} /> Editar</button>}{canDeleteTask && <button type="button" aria-label={`Eliminar ${item.title}`} onClick={() => removeTask(item)} className="grid min-h-10 min-w-10 place-items-center rounded-lg text-zinc-500 hover:bg-red-950/20 hover:text-red-400"><Trash2 size={15} /></button>}</div>
          <TaskEvidencePanel task={item} projectId={projectId} organizationId={organizationId} userId={userId} canManage={canManage} canSubmit={canSubmit && !item.is_recurrence_template} onChange={load} reportError={setError} />
        </div>; })}
      </div>

    </section>
  );
}

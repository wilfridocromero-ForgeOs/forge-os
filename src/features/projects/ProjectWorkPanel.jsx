import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, Plus, Trash2 } from "lucide-react";
import {
  createProjectDeliverable,
  createProjectTask,
  deleteProjectDeliverable,
  deleteProjectTask,
  getProjectWork,
  updateProjectDeliverable,
  updateProjectTask,
} from "../../services/ProjectService";

const field = "rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2.5 text-sm text-white outline-none focus:border-zinc-600";
const workLabels = { task: "Tarea", checklist: "Checklist", milestone: "Hito", review: "Revisión" };

export default function ProjectWorkPanel({ projectId, users, userId, onProgressChange }) {
  const [work, setWork] = useState({ tasks: [], deliverables: [] });
  const [task, setTask] = useState({ title: "", work_type: "task", priority: "medium", assigned_to: "", due_at: "" });
  const [deliverable, setDeliverable] = useState({ title: "", due_at: "" });
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try { setWork(await getProjectWork(projectId)); } catch (reason) { setError(reason.message); }
  }, [projectId]);
  // The callback synchronizes this editor with Supabase whenever the selected project changes.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);

  const progress = useMemo(() => {
    const activeTasks = work.tasks.filter((item) => item.status !== "cancelled");
    const activeDeliverables = work.deliverables.filter((item) => item.status !== "rejected");
    const total = activeTasks.length + activeDeliverables.length;
    const done = activeTasks.filter((item) => item.status === "completed").length + activeDeliverables.filter((item) => ["approved", "delivered"].includes(item.status)).length;
    return total ? Math.round((done / total) * 100) : 0;
  }, [work]);

  useEffect(() => { onProgressChange?.(progress); }, [progress, onProgressChange]);

  async function addTask(event) {
    event.preventDefault();
    if (!task.title.trim()) return;
    try { setError(""); await createProjectTask(projectId, task, userId); setTask({ ...task, title: "", due_at: "" }); await load(); }
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

      <form onSubmit={addTask} className="grid gap-2 rounded-2xl border border-zinc-800 p-3 sm:grid-cols-2 lg:grid-cols-[1fr_130px_150px_150px_auto]">
        <input aria-label="Título de la tarea" className={field} placeholder="Nueva tarea, hito o revisión" value={task.title} onChange={(e) => setTask({ ...task, title: e.target.value })} />
        <select aria-label="Tipo de trabajo" className={field} value={task.work_type} onChange={(e) => setTask({ ...task, work_type: e.target.value })}>{Object.entries(workLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
        <select aria-label="Responsable" className={field} value={task.assigned_to} onChange={(e) => setTask({ ...task, assigned_to: e.target.value })}><option value="">Sin asignar</option>{users.map((item) => <option key={item.id} value={item.id}>{item.first_name || "Usuario"}</option>)}</select>
        <input aria-label="Fecha límite" type="date" className={field} value={task.due_at} onChange={(e) => setTask({ ...task, due_at: e.target.value })} />
        <button type="submit" className="flex items-center justify-center rounded-xl bg-white px-4 text-black"><Plus size={17} /></button>
      </form>

      <div className="space-y-2">
        {work.tasks.map((item) => <div key={item.id} className="flex items-center gap-3 rounded-xl border border-zinc-800 px-3 py-3">
          <button type="button" aria-label={item.status === "completed" ? "Reabrir" : "Completar"} onClick={() => mutate(() => updateProjectTask(item.id, { status: item.status === "completed" ? "pending" : "completed" }))} className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border ${item.status === "completed" ? "border-white bg-white text-black" : "border-zinc-700 text-transparent"}`}><Check size={15} /></button>
          <div className="min-w-0 flex-1"><p className={`truncate text-sm ${item.status === "completed" ? "text-zinc-600 line-through" : "text-white"}`}>{item.title}</p><p className="mt-0.5 text-xs text-zinc-600">{workLabels[item.work_type]}{item.assignee?.first_name ? ` · ${item.assignee.first_name}` : ""}</p></div>
          <button type="button" aria-label="Eliminar" onClick={() => mutate(() => deleteProjectTask(item.id))} className="p-2 text-zinc-600 hover:text-red-300"><Trash2 size={15} /></button>
        </div>)}
      </div>

      <form onSubmit={addDeliverable} className="grid gap-2 rounded-2xl border border-zinc-800 p-3 sm:grid-cols-[1fr_170px_auto]">
        <input aria-label="Título del entregable" className={field} placeholder="Nuevo entregable" value={deliverable.title} onChange={(e) => setDeliverable({ ...deliverable, title: e.target.value })} />
        <input aria-label="Fecha límite del entregable" type="date" className={field} value={deliverable.due_at} onChange={(e) => setDeliverable({ ...deliverable, due_at: e.target.value })} />
        <button type="submit" className="flex items-center justify-center gap-2 rounded-xl border border-zinc-700 px-4 text-sm text-white"><Plus size={16} /> Entregable</button>
      </form>
      <div className="space-y-2">
        {work.deliverables.map((item) => <div key={item.id} className="grid items-center gap-2 rounded-xl border border-zinc-800 px-3 py-3 sm:grid-cols-[1fr_150px_auto]">
          <span className="truncate text-sm text-white">{item.title}</span>
          <select aria-label={`Estado de ${item.title}`} className={field} value={item.status} onChange={(e) => mutate(() => updateProjectDeliverable(item.id, { status: e.target.value }, userId))}><option value="pending">Pendiente</option><option value="in_review">En revisión</option><option value="approved">Aprobado</option><option value="delivered">Entregado</option><option value="rejected">Rechazado</option></select>
          <button type="button" aria-label="Eliminar entregable" onClick={() => mutate(() => deleteProjectDeliverable(item.id))} className="p-2 text-zinc-600 hover:text-red-300"><Trash2 size={15} /></button>
        </div>)}
      </div>
    </section>
  );
}

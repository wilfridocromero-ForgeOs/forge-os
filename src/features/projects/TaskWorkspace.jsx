import { useState } from "react";
import { CalendarDays, CheckCircle2, Edit3, Repeat2, Settings2, UserRound, X } from "lucide-react";
import { deleteProjectTask, updateProjectTask } from "../../services/ProjectService";
import TaskEvidencePanel from "./TaskEvidencePanel";
import { recurrenceSummary } from "./taskScheduleConfig";

const statusLabels = { pending: "Pendiente", in_progress: "En progreso", blocked: "Bloqueada", completed: "Completada", cancelled: "Cancelada" };
function fullDate(value) { return value ? new Intl.DateTimeFormat("es", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "Sin fecha"; }

export default function TaskWorkspace({ task, projectId, organizationId, userId, canManage, canSubmit, onClose, onEdit, onChange, reportError }) {
  const [manageEvidence, setManageEvidence] = useState(false);
  const required = (task.evidence_requirements || []).filter((item) => item.is_required);
  const missing = required.reduce((total, item) => total + Math.max(0, item.min_count - item.evidence.length), 0);
  const canEditTask = canManage || task.created_by === userId || task.assigned_to === userId;
  const canDeleteTask = canManage || task.created_by === userId;

  async function changeStatus(status) {
    try { reportError(""); await updateProjectTask(task.id, { status }); await onChange(); }
    catch (reason) { reportError(reason.message || "No se pudo actualizar la tarea."); }
  }
  async function remove() {
    if (!window.confirm("¿Eliminar esta tarea?\n\nSe eliminará de este proyecto.")) return;
    try { reportError(""); await deleteProjectTask(task.id); await onChange(); onClose(); }
    catch (reason) { reportError(reason.message || "No se pudo eliminar la tarea."); }
  }

  return <div role="dialog" aria-modal="true" aria-label={`Tarea ${task.title}`} className="fixed inset-0 z-50 overflow-y-auto bg-black/70 p-0 backdrop-blur-sm sm:p-5" onClick={onClose}>
    <article className="ml-auto min-h-full w-full max-w-2xl border-l border-zinc-800 bg-[#111113] shadow-2xl sm:min-h-0 sm:rounded-3xl sm:border" onClick={(event) => event.stopPropagation()}>
      <header className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-zinc-800 bg-[#111113]/95 px-4 py-4 backdrop-blur sm:px-6">
        <div className="min-w-0"><p className="text-xs uppercase tracking-[.18em] text-zinc-600">Tarea</p><h2 className="mt-2 break-words text-xl font-semibold text-white sm:text-2xl">{task.title}</h2></div>
        <button type="button" aria-label="Cerrar tarea" onClick={onClose} className="grid min-h-11 min-w-11 shrink-0 place-items-center rounded-xl text-zinc-500 hover:bg-zinc-900 hover:text-white"><X size={19} /></button>
      </header>
      <div className="space-y-6 p-4 pb-28 sm:p-6 sm:pb-6">
        <section><h3 className="text-xs uppercase tracking-[.18em] text-zinc-600">Qué tienes que hacer</h3><p className="mt-3 whitespace-pre-wrap break-words text-sm leading-6 text-zinc-300">{task.description || "No hay instrucciones adicionales para esta tarea."}</p></section>
        <section className="grid gap-3 rounded-2xl border border-zinc-800 p-4 sm:grid-cols-3">
          <div><p className="text-xs text-zinc-600">Estado</p><p className="mt-2 text-sm text-white">{statusLabels[task.status] || task.status}</p></div>
          <div><p className="flex items-center gap-1 text-xs text-zinc-600"><UserRound size={12} /> Responsable</p><p className="mt-2 truncate text-sm text-white">{task.assignee?.first_name || "Sin asignar"}</p></div>
          <div><p className="flex items-center gap-1 text-xs text-zinc-600"><CalendarDays size={12} /> Vencimiento</p><p className="mt-2 text-sm text-white">{fullDate(task.due_at)}</p></div>
        </section>
        {task.recurrence_schedule && <section className="rounded-2xl border border-blue-900/40 bg-blue-950/15 p-4"><p className="flex items-center gap-2 text-sm font-medium text-blue-300"><Repeat2 size={16} /> {task.recurrence_schedule.active ? recurrenceSummary(task.recurrence_schedule) : "Repetición pausada"}</p></section>}
        <section><div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between"><div><h3 className="text-lg font-semibold text-white">Para completar esta tarea</h3><p className="mt-1 text-sm text-zinc-500">Entrega únicamente la evidencia solicitada.</p></div>{canManage && task.status !== "completed" && <button type="button" onClick={() => setManageEvidence((value) => !value)} className="inline-flex min-h-10 items-center gap-2 self-start text-xs text-zinc-500 hover:text-white"><Settings2 size={14} /> {manageEvidence ? "Cerrar configuración" : "Configurar evidencia"}</button>}</div><TaskEvidencePanel task={task} projectId={projectId} organizationId={organizationId} userId={userId} canManage={canManage && manageEvidence} canSubmit={canSubmit && !task.is_recurrence_template} onChange={onChange} reportError={reportError} initiallyOpen /></section>
        {missing > 0 && task.status !== "completed" && <p className="rounded-xl border border-amber-800/50 bg-amber-950/20 p-3 text-sm text-amber-300">Falta {missing} evidencia{missing === 1 ? "" : "s"} para completar esta tarea.</p>}
        <div className="flex flex-col gap-2 border-t border-zinc-800 pt-5 sm:flex-row sm:flex-wrap">
          {canEditTask && task.status !== "completed" && <button type="button" disabled={missing > 0} onClick={() => changeStatus("completed")} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-white px-5 text-sm font-medium text-black disabled:cursor-not-allowed disabled:opacity-40"><CheckCircle2 size={17} /> Marcar como completada</button>}
          {canEditTask && task.status === "completed" && <button type="button" onClick={() => changeStatus("pending")} className="min-h-11 rounded-xl border border-zinc-700 px-5 text-sm text-zinc-300">Reabrir tarea</button>}
          {canEditTask && <button type="button" onClick={onEdit} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-zinc-700 px-5 text-sm text-zinc-300"><Edit3 size={16} /> Editar</button>}
          {canDeleteTask && <button type="button" onClick={remove} className="min-h-11 rounded-xl px-4 text-sm text-zinc-500 hover:text-red-300">Eliminar</button>}
        </div>
      </div>
    </article>
  </div>;
}

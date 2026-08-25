import { useState } from "react";
import { CalendarDays, Plus, Repeat2, Trash2, X } from "lucide-react";
import { createProjectTaskConfigured, saveProjectTaskConfiguration } from "../../services/ProjectService";
import { EvidenceRequirementFields } from "./TaskEvidencePanel";
import { blankEvidenceRequirement, evidenceTypeLabels, validateEvidenceRequirement } from "./taskEvidenceConfig";
import { blankTaskSchedule, normalizeScheduleDraft, recurrenceLabels, scheduleDraft, weekdayLabels, toLocalInput } from "./taskScheduleConfig";

const field = "min-w-0 rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2.5 text-sm text-white outline-none focus:border-zinc-500 focus:ring-2 focus:ring-zinc-500/20";

export default function TaskEditor({ projectId, task, users, onClose, onSaved, reportError }) {
  const creating = !task;
  const [saving, setSaving] = useState(false);
  const [details, setDetails] = useState(() => taskDetails(task));
  const [schedule, setSchedule] = useState(() => task ? scheduleDraft(task) : blankTaskSchedule());
  const [requirements, setRequirements] = useState([]);
  const [requirementDraft, setRequirementDraft] = useState(null);
  const [requirementError, setRequirementError] = useState("");

  function addRequirement() {
    const validation = validateEvidenceRequirement(requirementDraft);
    setRequirementError(validation);
    if (validation) return;
    setRequirements((items) => [...items, requirementDraft]);
    setRequirementDraft(null);
  }

  async function save(event, action = "save") {
    event.preventDefault();
    if (saving) return;
    if (details.starts_at && details.due_at && new Date(details.due_at) < new Date(details.starts_at)) {
      reportError("La fecha de vencimiento no puede ser anterior al inicio."); return;
    }
    setSaving(true); reportError("");
    try {
      const normalizedSchedule = normalizeScheduleDraft(schedule);
      if (creating) {
        await createProjectTaskConfigured(projectId, details, normalizedSchedule, requirements);
      } else {
        const hasSchedule = Boolean(task.recurrence_schedule);
        const scheduleActive = action === "reactivate" || (!hasSchedule && schedule.mode !== "none") || (hasSchedule && task.recurrence_schedule.active && action !== "pause");
        await saveProjectTaskConfiguration(task.id, details, normalizedSchedule, scheduleActive);
      }
      await onSaved(); onClose();
    } catch (reason) {
      console.error("Project task editor failed", reason);
      reportError(creating ? "No pudimos guardar la tarea. Inténtalo nuevamente." : (reason.message || "No pudimos guardar los cambios. Inténtalo nuevamente."));
    } finally { setSaving(false); }
  }

  return <div role="dialog" aria-modal="true" aria-label={creating ? "Nueva tarea" : "Editar tarea"} className="fixed inset-0 z-50 overflow-y-auto bg-black/70 p-2 sm:p-5">
    <form onSubmit={save} className="mx-auto my-2 w-full max-w-3xl overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-950 shadow-2xl sm:my-6">
      <header className="flex items-center justify-between gap-4 border-b border-zinc-800 px-4 py-4 sm:px-6">
        <div className="min-w-0"><h3 className="truncate text-lg font-semibold text-white">{creating ? "Nueva tarea" : "Editar tarea"}</h3><p className="mt-1 text-xs text-zinc-500">Define lo necesario antes de guardar.</p></div>
        <button type="button" aria-label="Cerrar editor" onClick={onClose} className="grid min-h-11 min-w-11 place-items-center rounded-xl text-zinc-500 hover:bg-zinc-900 hover:text-white"><X size={18} /></button>
      </header>

      <div className="space-y-6 p-4 sm:p-6">
        <section className="grid min-w-0 gap-3 sm:grid-cols-2">
          <h4 className="text-sm font-semibold text-white sm:col-span-2">Tarea</h4>
          <label className="min-w-0 sm:col-span-2"><span className="mb-1 block text-xs text-zinc-500">Título</span><input required minLength={2} maxLength={180} autoFocus={creating} className={`${field} w-full`} value={details.title} onChange={(event) => setDetails({ ...details, title: event.target.value })} /></label>
          <label className="min-w-0 sm:col-span-2"><span className="mb-1 block text-xs text-zinc-500">Instrucciones</span><textarea maxLength={10000} rows={6} className={`${field} min-h-36 w-full resize-y leading-6`} placeholder="Explica qué debe hacerse, pasos, contexto, requisitos y notas importantes." value={details.description} onChange={(event) => setDetails({ ...details, description: event.target.value })} /><span className="mt-1 block text-xs text-zinc-600">{creating ? "Los archivos de referencia se añaden desde la tarea después de crearla, evitando archivos huérfanos." : "Los archivos de referencia se administran al abrir la tarea."}</span></label>
          <label className="min-w-0"><span className="mb-1 block text-xs text-zinc-500">Responsable</span><select className={`${field} w-full`} value={details.assigned_to} onChange={(event) => setDetails({ ...details, assigned_to: event.target.value })}><option value="">Sin asignar</option>{users.map((user) => <option key={user.id} value={user.id}>{user.first_name || "Usuario"}</option>)}</select></label>
          <label className="min-w-0"><span className="mb-1 block text-xs text-zinc-500">Prioridad</span><select className={`${field} w-full`} value={details.priority} onChange={(event) => setDetails({ ...details, priority: event.target.value })}><option value="low">Baja</option><option value="medium">Media</option><option value="high">Alta</option><option value="urgent">Urgente</option></select></label>
          <label className="min-w-0"><span className="mb-1 flex items-center gap-1 text-xs text-zinc-500"><CalendarDays size={12} /> Inicio</span><input type="datetime-local" className={`${field} w-full`} value={details.starts_at} onChange={(event) => setDetails({ ...details, starts_at: event.target.value })} /></label>
          <label className="min-w-0"><span className="mb-1 block text-xs text-zinc-500">Vencimiento</span><input type="datetime-local" className={`${field} w-full`} value={details.due_at} onChange={(event) => setDetails({ ...details, due_at: event.target.value })} /></label>
        </section>

        {!task?.recurrence_schedule_id && <section className="grid min-w-0 gap-3 border-t border-zinc-800 pt-5 sm:grid-cols-2">
          <h4 className="flex items-center gap-2 text-sm font-semibold text-white sm:col-span-2"><Repeat2 size={15} /> Repetición</h4>
          <label className="min-w-0"><span className="mb-1 block text-xs text-zinc-500">Frecuencia</span><select disabled={Boolean(task?.recurrence_schedule)} className={`${field} w-full`} value={schedule.mode} onChange={(event) => setSchedule(modeDraft(event.target.value, schedule))}>{Object.entries(recurrenceLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          {schedule.mode !== "none" && <label className="min-w-0"><span className="mb-1 block text-xs text-zinc-500">Primera ejecución</span><input required type="datetime-local" className={`${field} w-full`} value={schedule.first_run} onChange={(event) => setSchedule({ ...schedule, first_run: event.target.value, weekday: new Date(event.target.value).getDay(), day_of_month: new Date(event.target.value).getDate() })} /></label>}
          {schedule.mode === "custom" && <><label><span className="mb-1 block text-xs text-zinc-500">Cada</span><input required min="1" max="12" type="number" className={`${field} w-full`} value={schedule.interval_count} onChange={(event) => setSchedule({ ...schedule, interval_count: Number(event.target.value) })} /></label><label><span className="mb-1 block text-xs text-zinc-500">Unidad</span><select className={`${field} w-full`} value={schedule.recurrence_unit} onChange={(event) => setSchedule({ ...schedule, recurrence_unit: event.target.value })}><option value="day">Días</option><option value="week">Semanas</option><option value="month">Meses</option></select></label></>}
          {schedule.mode !== "none" && (schedule.mode === "weekly" || schedule.recurrence_unit === "week") && <label><span className="mb-1 block text-xs text-zinc-500">Día semanal</span><select className={`${field} w-full`} value={schedule.weekday} onChange={(event) => setSchedule({ ...schedule, weekday: Number(event.target.value) })}>{weekdayLabels.map((label, index) => <option key={label} value={index}>{label}</option>)}</select></label>}
          {schedule.mode !== "none" && (schedule.mode === "monthly" || schedule.recurrence_unit === "month") && <label><span className="mb-1 block text-xs text-zinc-500">Día del mes</span><input type="number" min="1" max="31" className={`${field} w-full`} value={schedule.day_of_month} onChange={(event) => setSchedule({ ...schedule, day_of_month: Number(event.target.value) })} /></label>}
          {task?.recurrence_schedule && <p className="text-xs text-zinc-500 sm:col-span-2"><span className={task.recurrence_schedule.active ? "text-emerald-400" : "text-amber-500"}>{task.recurrence_schedule.active ? "Repetición activa" : "Repetición pausada"}</span> · Hora local: {schedule.timezone}</p>}
        </section>}

        {creating && <section className="space-y-3 border-t border-zinc-800 pt-5">
          <div><h4 className="text-sm font-semibold text-white">Evidencia</h4><p className="mt-1 text-xs text-zinc-500">Solicita solo lo necesario para demostrar que la tarea fue completada.</p></div>
          {requirements.map((requirement, index) => <div key={`${requirement.evidence_type}-${index}`} className="flex min-w-0 items-center justify-between gap-3 rounded-xl border border-zinc-800 px-3 py-3"><div className="min-w-0"><p className="truncate text-sm text-white">{evidenceTypeLabels[requirement.evidence_type]} · {requirement.label}</p><p className="mt-1 text-xs text-zinc-500">{requirement.is_required ? `${requirement.min_count} requerida${requirement.min_count === 1 ? "" : "s"}` : "Opcional"}</p></div><button type="button" aria-label={`Eliminar ${requirement.label}`} onClick={() => setRequirements((items) => items.filter((_, itemIndex) => itemIndex !== index))} className="grid min-h-10 min-w-10 place-items-center rounded-lg text-zinc-500 hover:bg-red-950/20 hover:text-red-400"><Trash2 size={15} /></button></div>)}
          {requirementDraft ? <div className="space-y-3"><EvidenceRequirementFields value={requirementDraft} onChange={(next) => { setRequirementDraft(next); setRequirementError(""); }} error={requirementError} /><div className="flex flex-wrap gap-2"><button type="button" onClick={addRequirement} className="rounded-xl border border-zinc-700 px-4 py-2.5 text-sm text-white">Añadir</button><button type="button" onClick={() => setRequirementDraft(null)} className="px-3 py-2.5 text-sm text-zinc-500">Cancelar</button></div></div> : <button type="button" onClick={() => setRequirementDraft(blankEvidenceRequirement())} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-zinc-700 px-4 py-2.5 text-sm text-white"><Plus size={15} /> Solicitar evidencia</button>}
        </section>}
      </div>

      <footer className="flex flex-col-reverse gap-2 border-t border-zinc-800 p-4 sm:flex-row sm:justify-end sm:px-6">
        <button type="button" onClick={onClose} className="min-h-11 rounded-xl px-4 text-sm text-zinc-500">Cancelar</button>
        {task?.recurrence_schedule?.active && <button type="button" disabled={saving} onClick={(event) => save(event, "pause")} className="min-h-11 rounded-xl border border-amber-700 px-4 text-sm text-amber-600 disabled:opacity-50">Pausar</button>}
        {task?.recurrence_schedule && !task.recurrence_schedule.active && <button type="button" disabled={saving} onClick={(event) => save(event, "reactivate")} className="min-h-11 rounded-xl border border-emerald-700 px-4 text-sm text-emerald-600 disabled:opacity-50">Reactivar</button>}
        <button disabled={saving} className="min-h-11 rounded-xl bg-white px-5 text-sm font-medium text-black disabled:opacity-50">{saving ? "Guardando…" : creating ? "Crear tarea" : "Guardar cambios"}</button>
      </footer>
    </form>
  </div>;
}

function taskDetails(task) {
  return { title: task?.title || "", assigned_to: task?.assigned_to || "", priority: task?.priority || "medium", work_type: task?.work_type || "task", description: task?.description || "", starts_at: task?.starts_at ? toLocalInput(task.starts_at) : "", due_at: task?.due_at ? toLocalInput(task.due_at) : "" };
}

function modeDraft(mode, current) {
  if (mode === "none") return { ...blankTaskSchedule(), mode };
  const unit = { daily: "day", weekly: "week", monthly: "month" }[mode] || current.recurrence_unit || "week";
  return { ...current, mode, recurrence_unit: unit, interval_count: mode === "custom" ? current.interval_count : 1 };
}

import { useState } from "react";
import { CalendarDays, Repeat2, Settings2 } from "lucide-react";
import { saveProjectTaskSchedule } from "../../services/ProjectService";
import { blankTaskSchedule, normalizeScheduleDraft, recurrenceLabels, scheduleDraft, weekdayLabels, toLocalInput } from "./taskScheduleConfig";

const field = "min-w-0 rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2.5 text-sm text-white outline-none focus:border-zinc-600";

export default function TaskScheduleEditor({ task, users, canEdit, onChange, reportError }) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [details, setDetails] = useState(taskDetails(task));
  const [schedule, setSchedule] = useState(() => scheduleDraft(task));

  function toggle() {
    if (!open) { setDetails(taskDetails(task)); setSchedule(scheduleDraft(task)); }
    setOpen((value) => !value);
  }

  async function save(event, action = "save") {
    event.preventDefault();
    if (!canEdit || saving) return;
    if (details.starts_at && details.due_at && new Date(details.due_at) < new Date(details.starts_at)) {
      reportError("La fecha de vencimiento no puede ser anterior al inicio."); return;
    }
    setSaving(true); reportError("");
    try {
      const hasSchedule = Boolean(task.recurrence_schedule);
      const scheduleActive = action === "reactivate" || (!hasSchedule && schedule.mode !== "none") || (hasSchedule && task.recurrence_schedule.active && action !== "pause");
      await saveProjectTaskSchedule(task.id, details, normalizeScheduleDraft(schedule), scheduleActive);
      await onChange(); setOpen(false);
    } catch (reason) { reportError(reason.message || "No se pudo guardar la configuración."); }
    finally { setSaving(false); }
  }

  return <div className="min-w-0 sm:col-start-2 sm:col-span-3">
    <button type="button" aria-expanded={open} onClick={toggle} className="inline-flex min-h-9 items-center gap-2 rounded-lg px-2 text-xs text-zinc-500 hover:bg-zinc-900 hover:text-white"><Settings2 size={14} /> Configurar tarea</button>
    {open && <form onSubmit={(event) => save(event)} className="mt-2 grid min-w-0 gap-3 rounded-xl border border-zinc-800 bg-zinc-950/50 p-3 sm:grid-cols-2 lg:grid-cols-4">
      <label className="min-w-0"><span className="mb-1 block text-xs text-zinc-500">Responsable</span><select disabled={!canEdit} className={`${field} w-full`} value={details.assigned_to} onChange={(event) => setDetails({ ...details, assigned_to: event.target.value })}><option value="">Sin asignar</option>{users.map((user) => <option key={user.id} value={user.id}>{user.first_name || "Usuario"}</option>)}</select></label>
      <label className="min-w-0"><span className="mb-1 block text-xs text-zinc-500">Prioridad</span><select disabled={!canEdit} className={`${field} w-full`} value={details.priority} onChange={(event) => setDetails({ ...details, priority: event.target.value })}><option value="low">Baja</option><option value="medium">Media</option><option value="high">Alta</option><option value="urgent">Urgente</option></select></label>
      <label className="min-w-0"><span className="mb-1 flex items-center gap-1 text-xs text-zinc-500"><CalendarDays size={12} /> Inicio</span><input disabled={!canEdit} type="datetime-local" className={`${field} w-full`} value={details.starts_at} onChange={(event) => setDetails({ ...details, starts_at: event.target.value })} /></label>
      <label className="min-w-0"><span className="mb-1 block text-xs text-zinc-500">Vencimiento</span><input disabled={!canEdit} type="datetime-local" className={`${field} w-full`} value={details.due_at} onChange={(event) => setDetails({ ...details, due_at: event.target.value })} /></label>
      <label className="min-w-0"><span className="mb-1 block text-xs text-zinc-500">Tipo</span><select disabled={!canEdit} className={`${field} w-full`} value={details.work_type} onChange={(event) => setDetails({ ...details, work_type: event.target.value })}><option value="task">Tarea</option><option value="checklist">Checklist</option><option value="milestone">Hito</option><option value="review">Revisión</option></select></label>
      <label className="min-w-0 sm:col-span-2 lg:col-span-3"><span className="mb-1 block text-xs text-zinc-500">Descripción opcional</span><textarea maxLength={2000} rows={2} disabled={!canEdit} className={`${field} w-full resize-y`} value={details.description} onChange={(event) => setDetails({ ...details, description: event.target.value })} /></label>
      {!task.recurrence_schedule_id && <div className="min-w-0 border-t border-zinc-800 pt-3 sm:col-span-2 lg:col-span-4"><div className="grid min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="min-w-0"><span className="mb-1 flex items-center gap-1 text-xs text-zinc-500"><Repeat2 size={12} /> Repetir tarea</span><select disabled={!canEdit || Boolean(task.recurrence_schedule)} className={`${field} w-full`} value={schedule.mode} onChange={(event) => setSchedule(modeDraft(event.target.value, schedule))}>{Object.entries(recurrenceLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        {schedule.mode !== "none" && <label className="min-w-0"><span className="mb-1 block text-xs text-zinc-500">Primera ejecución</span><input required disabled={!canEdit} type="datetime-local" className={`${field} w-full`} value={schedule.first_run} onChange={(event) => setSchedule({ ...schedule, first_run: event.target.value, weekday: new Date(event.target.value).getDay(), day_of_month: new Date(event.target.value).getDate() })} /></label>}
        {schedule.mode === "custom" && <><label className="min-w-0"><span className="mb-1 block text-xs text-zinc-500">Cada</span><input required min="1" max="12" type="number" disabled={!canEdit} className={`${field} w-full`} value={schedule.interval_count} onChange={(event) => setSchedule({ ...schedule, interval_count: Number(event.target.value) })} /></label><label className="min-w-0"><span className="mb-1 block text-xs text-zinc-500">Unidad</span><select disabled={!canEdit} className={`${field} w-full`} value={schedule.recurrence_unit} onChange={(event) => setSchedule({ ...schedule, recurrence_unit: event.target.value })}><option value="day">Días</option><option value="week">Semanas</option><option value="month">Meses</option></select></label></>}
        {schedule.mode !== "none" && (schedule.mode === "weekly" || schedule.recurrence_unit === "week") && <label className="min-w-0"><span className="mb-1 block text-xs text-zinc-500">Día semanal</span><select disabled={!canEdit} className={`${field} w-full`} value={schedule.weekday} onChange={(event) => setSchedule({ ...schedule, weekday: Number(event.target.value) })}>{weekdayLabels.map((label, index) => <option key={label} value={index}>{label}</option>)}</select></label>}
        {schedule.mode !== "none" && (schedule.mode === "monthly" || schedule.recurrence_unit === "month") && <label className="min-w-0"><span className="mb-1 block text-xs text-zinc-500">Día del mes</span><input type="number" min="1" max="31" disabled={!canEdit} className={`${field} w-full`} value={schedule.day_of_month} onChange={(event) => setSchedule({ ...schedule, day_of_month: Number(event.target.value) })} /></label>}
        {task.recurrence_schedule && <div className="min-w-0 text-xs text-zinc-500 sm:col-span-2 lg:col-span-4"><span className={task.recurrence_schedule.active ? "text-emerald-400" : "text-amber-400"}>{task.recurrence_schedule.active ? "Activa" : "Pausada"}</span><span className="ml-2 break-all">Hora local: {schedule.timezone}</span></div>}
      </div></div>}
      <div className="flex flex-wrap gap-2 sm:col-span-2 lg:col-span-4"><button disabled={!canEdit || saving} className="rounded-xl bg-white px-4 py-2.5 text-sm text-black disabled:opacity-50">{saving ? "Guardando…" : "Guardar cambios"}</button>{task.recurrence_schedule?.active && <button type="button" disabled={!canEdit || saving} onClick={(event) => save(event, "pause")} className="rounded-xl border border-amber-800 px-4 py-2.5 text-sm text-amber-300 disabled:opacity-50">Pausar</button>}{task.recurrence_schedule && !task.recurrence_schedule.active && <button type="button" disabled={!canEdit || saving} onClick={(event) => save(event, "reactivate")} className="rounded-xl border border-emerald-800 px-4 py-2.5 text-sm text-emerald-300 disabled:opacity-50">Reactivar</button>}<button type="button" onClick={() => setOpen(false)} className="px-3 py-2 text-sm text-zinc-500">Cancelar</button></div>
    </form>}
  </div>;
}

function taskDetails(task) { return { assigned_to: task.assigned_to || "", priority: task.priority || "medium", work_type: task.work_type || "task", description: task.description || "", starts_at: task.starts_at ? toLocalInput(task.starts_at) : "", due_at: task.due_at ? toLocalInput(task.due_at) : "" }; }
function modeDraft(mode, current) {
  if (mode === "none") return { ...blankTaskSchedule(), mode };
  const unit = { daily: "day", weekly: "week", monthly: "month" }[mode] || current.recurrence_unit || "week";
  return { ...current, mode, recurrence_unit: unit, interval_count: mode === "custom" ? current.interval_count : 1 };
}

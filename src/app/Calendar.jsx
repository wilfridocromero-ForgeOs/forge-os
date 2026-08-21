import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, BriefcaseBusiness, CalendarDays, Check, ChevronLeft, ChevronRight, Clock, List, Plus, Trash2, X } from "lucide-react";
import { useNavigate, useSearchParams } from "react-router-dom";

import Card from "../components/ui/Card";
import Page from "../components/ui/Page";
import { useAuth } from "../Context/AuthContext";
import { supabase } from "../lib/supabase";
import { buildCalendarDay, filterCalendarFeed, getCalendarFeed, groupCalendarAgenda } from "../services/CalendarService";

const weekDays = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];
const typeLabels = { meeting: "Reunión", task: "Tarea", reminder: "Recordatorio", deadline: "Entrega", note: "Nota" };
const monthStateLabels = { pending: "Pendiente", in_progress: "En progreso", blocked: "Bloqueada", completed: "Completada", overdue: "Vencida", event: "Evento" };
const MAX_MONTH_INDICATORS = 3;

function dateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function toLocalInput(date) {
  const copy = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return copy.toISOString().slice(0, 16);
}

function emptyEvent(date = new Date()) {
  const start = new Date(date);
  start.setMinutes(0, 0, 0);
  start.setHours(Math.max(start.getHours() + 1, 9));
  const end = new Date(start.getTime() + 60 * 60 * 1000);
  return { title: "", description: "", starts_at: toLocalInput(start), ends_at: toLocalInput(end), event_type: "task", priority: "normal", visibility: "personal", assigned_to: "", remind: "30" };
}

function monthVisualState(item) {
  if (item.sourceType === "event") return "event";
  if (item.isOverdue) return "overdue";
  return ["in_progress", "blocked", "completed"].includes(item.status) ? item.status : "pending";
}

function describeDayItems(dayItems) {
  if (!dayItems.length) return "sin trabajo programado";
  const counts = dayItems.reduce((result, item) => {
    const state = monthVisualState(item);
    result[state] = (result[state] || 0) + 1;
    return result;
  }, {});
  return Object.entries(counts).map(([state, count]) => `${count} ${monthStateLabels[state].toLowerCase()}`).join(", ");
}

export default function Calendar() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const { profile, user, canManageUsers, isInternalOrganization } = useAuth();
  const [month, setMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [view, setView] = useState(() => window.matchMedia("(max-width: 767px)").matches ? "list" : "month");
  const [scope, setScope] = useState(() => window.matchMedia("(max-width: 767px)").matches ? "mine" : "team");
  const [source, setSource] = useState("all");
  const [status, setStatus] = useState("all");
  const [selectedDay, setSelectedDay] = useState(null);
  const [items, setItems] = useState([]);
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState(emptyEvent());
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (searchParams.get("new") !== "1") return;
    // Route state intentionally opens the existing creation flow.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setForm(emptyEvent()); setMessage(""); setModalOpen(true); setSearchParams({}, { replace: true });
  }, [searchParams, setSearchParams]);

  async function loadEvents() {
    if (!profile?.organization_id) return;
    setLoading(true); setMessage("");
    const rangeStart = new Date(month.getFullYear(), month.getMonth() - 1, 1);
    const rangeEnd = new Date(month.getFullYear(), month.getMonth() + 2, 1);
    try {
      const [feed, membersResult] = await Promise.all([
        getCalendarFeed({ organizationId: profile.organization_id, rangeStart, rangeEnd }),
        supabase.from("users").select("id, first_name, division").eq("organization_id", profile.organization_id).order("first_name"),
      ]);
      if (membersResult.error) throw membersResult.error;
      setItems(feed); setMembers(membersResult.data || []);
    } catch (error) { setMessage(error.message || "No se pudo cargar el calendario."); }
    finally { setLoading(false); }
  }

  // Existing calendar synchronization; loadEvents owns its loading state.
  // eslint-disable-next-line react-hooks/set-state-in-effect, react-hooks/exhaustive-deps
  useEffect(() => { loadEvents(); }, [profile?.organization_id, month]);

  const calendarDays = useMemo(() => {
    const first = new Date(month.getFullYear(), month.getMonth(), 1);
    const start = new Date(first); start.setDate(first.getDate() - ((first.getDay() + 6) % 7));
    return Array.from({ length: 42 }, (_, index) => { const day = new Date(start); day.setDate(start.getDate() + index); return day; });
  }, [month]);
  const visibleItems = useMemo(() => filterCalendarFeed(items, { scope, source, status, userId: user.id }), [items, scope, source, status, user.id]);
  const itemsByDate = useMemo(() => {
    const index = new Map();
    const visibleStart = calendarDays[0];
    const visibleEnd = calendarDays[calendarDays.length - 1];
    visibleItems.forEach((item) => {
      const itemStart = new Date(item.startsAt);
      const itemEnd = item.endsAt ? new Date(item.endsAt) : itemStart;
      const cursor = new Date(Math.max(itemStart, visibleStart));
      const lastDay = new Date(Math.min(itemEnd, visibleEnd));
      cursor.setHours(0, 0, 0, 0); lastDay.setHours(23, 59, 59, 999);
      while (cursor <= lastDay) {
        const key = dateKey(cursor);
        if (!index.has(key)) index.set(key, []);
        index.get(key).push(item);
        cursor.setDate(cursor.getDate() + 1);
      }
    });
    return index;
  }, [visibleItems, calendarDays]);
  const agenda = useMemo(() => groupCalendarAgenda(visibleItems), [visibleItems]);
  const selectedDayItems = useMemo(() => selectedDay ? itemsByDate.get(dateKey(selectedDay)) || [] : [], [itemsByDate, selectedDay]);
  const selectedDayData = useMemo(() => buildCalendarDay(selectedDayItems), [selectedDayItems]);

  useEffect(() => {
    if (!selectedDay) return undefined;
    const closeOnEscape = (event) => { if (event.key === "Escape") setSelectedDay(null); };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [selectedDay]);

  function openNew(date = new Date()) { setForm(emptyEvent(date)); setMessage(""); setModalOpen(true); }

  async function createEvent(event) {
    event.preventDefault();
    const startsAt = new Date(form.starts_at);
    const endsAt = form.ends_at ? new Date(form.ends_at) : null;
    const remindAt = form.remind === "none" ? null : new Date(startsAt.getTime() - Number(form.remind) * 60000);
    const { error } = await supabase.from("calendar_events").insert({ organization_id: profile.organization_id, created_by: user.id, assigned_to: form.assigned_to || user.id, title: form.title.trim(), description: form.description.trim() || null, starts_at: startsAt.toISOString(), ends_at: endsAt?.toISOString() || null, event_type: form.event_type, priority: form.priority, visibility: form.visibility, remind_at: remindAt?.toISOString() || null });
    if (error) return setMessage(error.message);
    setModalOpen(false); await loadEvents(); setMessage("Evento guardado correctamente.");
  }

  async function completeEvent(item) {
    const { error } = await supabase.from("calendar_events").update({ status: item.status === "completed" ? "scheduled" : "completed", updated_at: new Date().toISOString() }).eq("id", item.sourceId);
    if (error) return setMessage(error.message); await loadEvents();
  }

  async function deleteEvent(item) {
    const { error } = await supabase.from("calendar_events").delete().eq("id", item.sourceId);
    if (error) return setMessage(error.message); await loadEvents();
  }

  return <Page className="min-w-0 space-y-6">
    <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between"><div><p className="text-xs uppercase tracking-[0.3em] text-zinc-500">{isInternalOrganization ? "Equipo ORVESEN" : "Tu negocio"}</p><h1 className="mt-2 text-3xl font-semibold text-white">{isInternalOrganization ? "Calendario del equipo" : "Agenda del negocio"}</h1><p className="mt-2 text-zinc-400">{isInternalOrganization ? "Reuniones, tareas y recordatorios del equipo interno." : "Reuniones, tareas y entregas de tu propia organización."}</p></div><button onClick={() => openNew()} className="flex min-h-11 items-center justify-center gap-2 rounded-xl bg-white px-5 py-3 font-medium text-black"><Plus size={18} /> Nuevo evento</button></div>
    {message && <div className="rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-3 text-sm text-zinc-200">{message}</div>}
    <Card hover={false} contentClassName="min-w-0 p-4 sm:p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"><div className="flex items-center justify-between gap-1 sm:gap-2"><button onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))} className="calendar-icon-button"><ChevronLeft size={19} /></button><h2 className="min-w-0 text-center text-lg font-semibold capitalize text-white sm:min-w-[190px]">{month.toLocaleDateString("es-ES", { month: "long", year: "numeric" })}</h2><button onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))} className="calendar-icon-button"><ChevronRight size={19} /></button></div><div className="flex rounded-xl border border-zinc-800 p-1"><button onClick={() => setView("month")} className={`flex min-h-10 flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm ${view === "month" ? "bg-white text-black" : "text-zinc-400"}`}><CalendarDays size={17} /> Mes</button><button onClick={() => setView("list")} className={`flex min-h-10 flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm ${view === "list" ? "bg-white text-black" : "text-zinc-400"}`}><List size={17} /> Agenda</button></div></div>
      <div className="calendar-filters mt-4" aria-label="Filtros del calendario"><Filter label="Alcance" value={scope} onChange={setScope} options={[["mine", "Mi trabajo"], ["team", "Equipo"]]} /><Filter label="Tipo" value={source} onChange={setSource} options={[["all", "Todo"], ["task", "Trabajo"], ["event", "Eventos"]]} /><Filter label="Estado" value={status} onChange={setStatus} options={[["all", "Todos"], ["active", "Activos"], ["overdue", "Vencidos"], ["completed", "Completados"]]} /></div>
      {view === "month" && <CalendarLegend />}
      {loading ? <p className="py-16 text-center text-zinc-500">Cargando calendario...</p> : view === "month" ? <MonthView days={calendarDays} month={month} itemsByDate={itemsByDate} selectedDay={selectedDay} onSelectDay={setSelectedDay} /> : <Agenda groups={agenda} members={members} onComplete={completeEvent} onDelete={deleteEvent} onOpenTask={(item) => navigate(`/proyectos/${item.projectId}`)} canManage={canManageUsers} userId={user.id} />}
    </Card>
    {selectedDay && <DayWorkspace day={selectedDay} data={selectedDayData} members={members} scope={scope} userId={user.id} canManage={canManageUsers} onClose={() => setSelectedDay(null)} onNewEvent={() => { const day = selectedDay; setSelectedDay(null); openNew(day); }} onOpenTask={(item) => navigate(`/proyectos/${item.projectId}`)} onComplete={completeEvent} onDelete={deleteEvent} />}
    {modalOpen && <EventModal form={form} setForm={setForm} onSubmit={createEvent} onClose={() => setModalOpen(false)} members={members} />}
  </Page>;
}

function MonthView({ days, month, itemsByDate, selectedDay, onSelectDay }) {
  return <div className="calendar-month-scroll mt-5"><div className="calendar-month-shell"><div className="grid grid-cols-7">{weekDays.map((day) => <div key={day} className="p-2 text-center text-xs uppercase tracking-wider text-zinc-500">{day}</div>)}</div><div className="calendar-grid">{days.map((day) => { const dayItems = itemsByDate.get(dateKey(day)) || []; const outside = day.getMonth() !== month.getMonth(); const today = dateKey(day) === dateKey(new Date()); const selected = selectedDay && dateKey(day) === dateKey(selectedDay); const accessibleDate = day.toLocaleDateString("es-ES", { day: "numeric", month: "long" }); const remaining = Math.max(dayItems.length - MAX_MONTH_INDICATORS, 0); return <button key={day.toISOString()} onClick={() => onSelectDay(day)} aria-label={`${accessibleDate}, ${dayItems.length} ${dayItems.length === 1 ? "elemento" : "elementos"}: ${describeDayItems(dayItems)}`} aria-pressed={Boolean(selected)} className={`calendar-day ${outside ? "calendar-day-outside" : ""} ${selected ? "calendar-day-selected" : ""}`}><span className={`calendar-day-number ${today ? "calendar-today" : ""}`}>{day.getDate()}</span><span className="calendar-day-events mt-2 space-y-1" aria-hidden="true">{dayItems.slice(0, MAX_MONTH_INDICATORS).map((item) => { const visualState = monthVisualState(item); return <span key={item.key} title={`${monthStateLabels[visualState]}: ${item.title}`} className={`calendar-event-pill calendar-indicator-${visualState}`}>{item.sourceType === "task" ? "Trabajo" : typeLabels[item.eventType]} · {new Date(item.startsAt).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })} · {item.title}</span>; })}{remaining > 0 && <span className="calendar-day-count">+{remaining}</span>}</span></button>; })}</div></div></div>;
}

function CalendarLegend() {
  return <div className="calendar-month-legend" aria-label="Leyenda de estados">{Object.entries(monthStateLabels).map(([state, label]) => <span key={state} className="calendar-legend-item"><span className={`calendar-legend-dot calendar-indicator-${state}`} aria-hidden="true" />{label}</span>)}</div>;
}

function DayWorkspace({ day, data, members, scope, userId, canManage, onClose, onNewEvent, onOpenTask, onComplete, onDelete }) {
  const { items, tasks, events, taskGroups, peopleCount } = data;
  const summary = [tasks.length ? `${tasks.length} ${tasks.length === 1 ? "tarea" : "tareas"}` : null, events.length ? `${events.length} ${events.length === 1 ? "evento" : "eventos"}` : null, peopleCount ? `${peopleCount} ${peopleCount === 1 ? "persona" : "personas"}` : null].filter(Boolean).join(" · ");
  const title = day.toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long" });

  return <div className="calendar-day-workspace-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><aside className="calendar-day-workspace" role="dialog" aria-modal="true" aria-label={`Trabajo del ${title}`}><header className="calendar-day-workspace-header"><div className="min-w-0"><p className="text-xs uppercase tracking-[.18em] text-zinc-500">{scope === "mine" ? "Mi trabajo" : "Trabajo del equipo"}</p><h2 className="mt-2 text-xl font-semibold capitalize text-white">{title}</h2><p className="mt-1 text-sm text-zinc-400">{summary || "Sin trabajo programado"}</p></div><button type="button" onClick={onClose} className="calendar-icon-button shrink-0" aria-label="Cerrar detalle del día"><X size={20} /></button></header><div className="calendar-day-workspace-body">{!items.length ? <div className="calendar-day-empty"><CalendarDays className="mx-auto text-zinc-600" size={34} /><p className="mt-4 font-medium text-white">No hay trabajo programado para este día.</p><p className="mt-2 text-sm text-zinc-500">Puedes añadir un evento sin salir del Calendario.</p><button type="button" onClick={onNewEvent} className="mt-5 inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-white px-4 font-medium text-black"><Plus size={17} /> Nuevo evento</button></div> : <div className="space-y-7">{tasks.length > 0 && <section><h3 className="calendar-day-section-title">Trabajo</h3><div className="mt-3 space-y-5">{Array.from(taskGroups.entries()).map(([personId, personTasks]) => <div key={personId}><h4 className="mb-2 flex items-center gap-2 text-sm font-semibold text-zinc-300"><span className="calendar-person-avatar">{personInitial(personId, personTasks, members, userId)}</span>{personName(personId, personTasks, members, userId)}</h4><div className="space-y-2">{personTasks.map((item) => <DayItem key={item.key} item={item} onOpenTask={onOpenTask} />)}</div></div>)}</div></section>}{events.length > 0 && <section><h3 className="calendar-day-section-title">Eventos</h3><div className="mt-3 space-y-2">{events.map((item) => <DayItem key={item.key} item={item} members={members} userId={userId} canManage={canManage} onComplete={onComplete} onDelete={onDelete} />)}</div></section>}<button type="button" onClick={onNewEvent} className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-zinc-700 px-4 text-sm font-medium text-zinc-200"><Plus size={17} /> Nuevo evento para este día</button></div>}</div></aside></div>;
}

function DayItem({ item, members = [], userId, canManage, onOpenTask, onComplete, onDelete }) {
  const owner = item.assigneeName || members.find((member) => member.id === item.assignedTo)?.first_name;
  const canEditEvent = item.sourceType === "event" && (canManage || item.createdBy === userId);
  return <article className={`calendar-day-item source-${item.sourceType} status-${item.status} ${item.isOverdue ? "is-overdue" : ""}`}><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><span className="calendar-type">{item.sourceType === "task" ? "Trabajo" : typeLabels[item.eventType]}</span>{item.isOverdue && <span className="calendar-status-badge"><AlertTriangle size={12} /> Vencida</span>}<span className="calendar-state-label">{statusLabel(item.status)}</span></div><h5 className={`mt-2 break-words text-sm font-medium text-white ${item.status === "completed" ? "line-through opacity-60" : ""}`}>{item.title}</h5>{item.projectName && <p className="mt-1 text-xs font-medium text-zinc-400">{item.projectName}</p>}<p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-zinc-500"><Clock size={13} /><span>{formatItemTime(item)}</span>{owner && <span>· {owner}</span>}<span>· {priorityLabel(item.priority)}</span></p></div>{item.sourceType === "task" ? <button type="button" onClick={() => onOpenTask(item)} className="calendar-day-action">Abrir tarea</button> : canEditEvent && <div className="flex shrink-0 gap-2"><button type="button" onClick={() => onComplete(item)} className="calendar-icon-button" aria-label={item.status === "completed" ? "Reabrir evento" : "Completar evento"}><Check size={17} /></button><button type="button" onClick={() => onDelete(item)} className="calendar-icon-button" aria-label="Eliminar evento"><Trash2 size={17} /></button></div>}</article>;
}

function formatItemTime(item) {
  const time = (value) => new Date(value).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
  return item.endsAt ? `${time(item.startsAt)} – ${time(item.endsAt)}` : time(item.startsAt);
}

function personName(personId, tasks, members, userId) {
  if (personId === "unassigned") return "Sin responsable";
  const name = tasks[0]?.assigneeName || members.find((member) => member.id === personId)?.first_name || "Miembro del equipo";
  return personId === userId ? `${name} · Tú` : name;
}

function personInitial(personId, tasks, members, userId) {
  return personName(personId, tasks, members, userId).charAt(0).toUpperCase();
}

function priorityLabel(priority) {
  return { low: "Prioridad baja", normal: "Prioridad normal", medium: "Prioridad media", high: "Prioridad alta", urgent: "Urgente" }[priority] || priority;
}

function Agenda({ groups, members, onComplete, onDelete, onOpenTask, canManage, userId }) {
  const sections = [["overdue", "Vencidas"], ["today", "Hoy"], ["tomorrow", "Mañana"], ["upcoming", "Próximas"], ["previous", "Anteriores"]];
  if (!sections.some(([key]) => groups[key].length)) return <div className="py-16 text-center"><CalendarDays className="mx-auto text-zinc-600" size={36} /><p className="mt-4 text-zinc-400">No hay trabajo ni eventos para estos filtros.</p></div>;
  return <div className="mt-6 space-y-7">{sections.map(([key, label]) => groups[key].length > 0 && <section key={key}><h3 className={`mb-3 text-xs font-semibold uppercase tracking-[.18em] ${key === "overdue" ? "text-red-400" : "text-zinc-500"}`}>{label} · {groups[key].length}</h3><div className="space-y-3">{groups[key].map((item) => <AgendaItem key={item.key} item={item} members={members} onComplete={onComplete} onDelete={onDelete} onOpenTask={onOpenTask} canManage={canManage} userId={userId} />)}</div></section>)}</div>;
}

function AgendaItem({ item, members, onComplete, onDelete, onOpenTask, canManage, userId }) {
  const owner = item.assigneeName || members.find((member) => member.id === item.assignedTo)?.first_name;
  const canEdit = item.sourceType === "event" && (canManage || item.createdBy === userId);
  const Icon = item.isOverdue ? AlertTriangle : item.sourceType === "task" ? BriefcaseBusiness : Clock;
  return <div className={`calendar-list-item source-${item.sourceType} status-${item.status} ${item.isOverdue ? "is-overdue" : ""}`}><button type="button" onClick={item.sourceType === "task" ? () => onOpenTask(item) : undefined} className={`min-w-0 flex-1 text-left ${item.sourceType === "task" ? "cursor-pointer" : "cursor-default"}`}><div className="flex flex-wrap items-center gap-2"><span className="calendar-type">{item.sourceType === "task" ? "Trabajo" : typeLabels[item.eventType]}</span>{item.isOverdue && <span className="calendar-status-badge"><AlertTriangle size={12} /> Vencida</span>}<h4 className={`min-w-0 break-words font-medium text-white ${item.status === "completed" ? "line-through opacity-60" : ""}`}>{item.title}</h4></div>{item.projectName && <p className="mt-2 text-sm font-medium text-zinc-300">{item.projectName}</p>}<p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-zinc-400"><Icon size={15} /><span>{new Date(item.startsAt).toLocaleString("es-ES", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span>{item.endsAt && <span>→ {new Date(item.endsAt).toLocaleString("es-ES", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span>}{owner && <span>· {owner}</span>}<span>· {statusLabel(item.status)}</span></p>{item.description && <p className="mt-2 line-clamp-2 text-sm text-zinc-500">{item.description}</p>}</button>{canEdit && <div className="flex shrink-0 gap-2"><button onClick={() => onComplete(item)} className="calendar-icon-button" title="Completar"><Check size={18} /></button><button onClick={() => onDelete(item)} className="calendar-icon-button" title="Eliminar"><Trash2 size={18} /></button></div>}</div>;
}

function statusLabel(status) { return { scheduled: "Programado", pending: "Pendiente", in_progress: "En progreso", blocked: "Bloqueada", completed: "Completada" }[status] || status; }
function Filter({ label, value, onChange, options }) { return <label className="min-w-0 flex-1"><span className="mb-1 block text-xs text-zinc-500">{label}</span><select className="field min-h-11 py-2" value={value} onChange={(event) => onChange(event.target.value)}>{options.map(([optionValue, optionLabel]) => <option key={optionValue} value={optionValue}>{optionLabel}</option>)}</select></label>; }
function Field({ label, children }) { return <label><span className="mb-2 block text-sm text-zinc-400">{label}</span>{children}</label>; }

function EventModal({ form, setForm, onSubmit, onClose, members }) {
  return <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/65 p-4 backdrop-blur-sm"><Card hover={false} className="w-full max-w-3xl" contentClassName="max-h-[90vh] overflow-y-auto p-6"><form onSubmit={onSubmit}><div className="flex items-start justify-between"><div><h2 className="text-xl font-semibold text-white">Nuevo evento</h2><p className="mt-1 text-sm text-zinc-400">Añade una tarea, reunión o recordatorio.</p></div><button type="button" onClick={onClose} className="calendar-icon-button"><X size={19} /></button></div><div className="mt-6 grid gap-4 md:grid-cols-2"><Field label="Título"><input required minLength="2" value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} className="field" /></Field><Field label="Tipo"><select value={form.event_type} onChange={(event) => setForm({ ...form, event_type: event.target.value })} className="field">{Object.entries(typeLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></Field><Field label="Comienza"><input required type="datetime-local" value={form.starts_at} onChange={(event) => setForm({ ...form, starts_at: event.target.value })} className="field" /></Field><Field label="Termina"><input type="datetime-local" value={form.ends_at} onChange={(event) => setForm({ ...form, ends_at: event.target.value })} className="field" /></Field><Field label="Responsable"><select value={form.assigned_to} onChange={(event) => setForm({ ...form, assigned_to: event.target.value })} className="field"><option value="">Yo</option>{members.map((member) => <option key={member.id} value={member.id}>{member.first_name || "Sin nombre"}{member.division ? ` · ${member.division}` : ""}</option>)}</select></Field><Field label="Recordarme"><select value={form.remind} onChange={(event) => setForm({ ...form, remind: event.target.value })} className="field"><option value="none">Sin recordatorio</option><option value="10">10 minutos antes</option><option value="30">30 minutos antes</option><option value="60">1 hora antes</option><option value="1440">1 día antes</option></select></Field><Field label="Prioridad"><select value={form.priority} onChange={(event) => setForm({ ...form, priority: event.target.value })} className="field"><option value="low">Baja</option><option value="normal">Normal</option><option value="high">Alta</option></select></Field><Field label="Visibilidad"><select value={form.visibility} onChange={(event) => setForm({ ...form, visibility: event.target.value })} className="field"><option value="personal">Personal</option><option value="team">Equipo</option></select></Field><label className="md:col-span-2"><span className="mb-2 block text-sm text-zinc-400">Notas</span><textarea rows="4" value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} className="field" placeholder="Detalles, enlaces o instrucciones..." /></label></div><div className="mt-6 flex justify-end"><button className="rounded-xl bg-white px-5 py-3 font-medium text-black">Guardar evento</button></div></form></Card></div>;
}

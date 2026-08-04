import { useEffect, useMemo, useState } from "react";
import { CalendarDays, Check, ChevronLeft, ChevronRight, Clock, List, Plus, Trash2, X } from "lucide-react";

import Page from "../components/ui/Page";
import Card from "../components/ui/Card";
import { useAuth } from "../Context/AuthContext";
import { supabase } from "../lib/supabase";

const weekDays = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];
const typeLabels = { meeting: "Reunión", task: "Tarea", reminder: "Recordatorio", deadline: "Entrega", note: "Nota" };

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

export default function Calendar() {
  const { profile, user, canManageUsers, isInternalOrganization } = useAuth();
  const [month, setMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [view, setView] = useState(() => window.matchMedia("(max-width: 767px)").matches ? "list" : "month");
  const [events, setEvents] = useState([]);
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState(emptyEvent());
  const [message, setMessage] = useState("");

  async function loadEvents() {
    if (!profile?.organization_id) return;
    setLoading(true);
    const rangeStart = new Date(month.getFullYear(), month.getMonth() - 1, 1).toISOString();
    const rangeEnd = new Date(month.getFullYear(), month.getMonth() + 2, 1).toISOString();
    const [eventsResult, membersResult] = await Promise.all([
      supabase.from("calendar_events").select("*").gte("starts_at", rangeStart).lt("starts_at", rangeEnd).order("starts_at"),
      supabase.from("users").select("id, first_name, division").eq("organization_id", profile.organization_id).order("first_name"),
    ]);
    const error = eventsResult.error || membersResult.error;
    if (error) setMessage(error.message);
    setEvents(eventsResult.data || []);
    setMembers(membersResult.data || []);
    setLoading(false);
  }

  useEffect(() => { loadEvents(); }, [profile?.organization_id, month]);

  const calendarDays = useMemo(() => {
    const first = new Date(month.getFullYear(), month.getMonth(), 1);
    const mondayOffset = (first.getDay() + 6) % 7;
    const start = new Date(first);
    start.setDate(first.getDate() - mondayOffset);
    return Array.from({ length: 42 }, (_, index) => {
      const day = new Date(start);
      day.setDate(start.getDate() + index);
      return day;
    });
  }, [month]);

  const upcoming = useMemo(() => events.filter((event) => new Date(event.starts_at) >= new Date() && event.status !== "cancelled").slice(0, 20), [events]);

  function openNew(date = new Date()) {
    setForm(emptyEvent(date));
    setMessage("");
    setModalOpen(true);
  }

  async function createEvent(event) {
    event.preventDefault();
    const startsAt = new Date(form.starts_at);
    const endsAt = form.ends_at ? new Date(form.ends_at) : null;
    const remindAt = form.remind === "none" ? null : new Date(startsAt.getTime() - Number(form.remind) * 60000);
    const { error } = await supabase.from("calendar_events").insert({
      organization_id: profile.organization_id,
      created_by: user.id,
      assigned_to: form.assigned_to || user.id,
      title: form.title.trim(),
      description: form.description.trim() || null,
      starts_at: startsAt.toISOString(),
      ends_at: endsAt?.toISOString() || null,
      event_type: form.event_type,
      priority: form.priority,
      visibility: form.visibility,
      remind_at: remindAt?.toISOString() || null,
    });
    if (error) return setMessage(error.message);
    setModalOpen(false);
    setMessage("Evento guardado correctamente.");
    await loadEvents();
  }

  async function completeEvent(event) {
    const { error } = await supabase.from("calendar_events").update({ status: event.status === "completed" ? "scheduled" : "completed", updated_at: new Date().toISOString() }).eq("id", event.id);
    if (error) return setMessage(error.message);
    await loadEvents();
  }

  async function deleteEvent(event) {
    const { error } = await supabase.from("calendar_events").delete().eq("id", event.id);
    if (error) return setMessage(error.message);
    await loadEvents();
  }

  return (
    <Page className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div><p className="text-xs uppercase tracking-[0.3em] text-zinc-500">{isInternalOrganization ? "Equipo ORVESEN" : "Tu negocio"}</p><h1 className="mt-2 text-3xl font-semibold text-white">{isInternalOrganization ? "Calendario del equipo" : "Agenda del negocio"}</h1><p className="mt-2 text-zinc-400">{isInternalOrganization ? "Reuniones, tareas y recordatorios del equipo interno." : "Reuniones, tareas y entregas de tu propia organización."}</p></div>
        <button onClick={() => openNew()} className="flex items-center justify-center gap-2 rounded-xl bg-white px-5 py-3 font-medium text-black"><Plus size={18} /> Nuevo evento</button>
      </div>

      {message && <div className="rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-3 text-sm text-zinc-200">{message}</div>}

      <Card hover={false} contentClassName="p-4 sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2"><button onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))} className="calendar-icon-button"><ChevronLeft size={19} /></button><h2 className="min-w-[190px] text-center text-lg font-semibold capitalize text-white">{month.toLocaleDateString("es-ES", { month: "long", year: "numeric" })}</h2><button onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))} className="calendar-icon-button"><ChevronRight size={19} /></button></div>
          <div className="flex rounded-xl border border-zinc-800 p-1"><button onClick={() => setView("month")} className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm ${view === "month" ? "bg-white text-black" : "text-zinc-400"}`}><CalendarDays size={17} /> Mes</button><button onClick={() => setView("list")} className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm ${view === "list" ? "bg-white text-black" : "text-zinc-400"}`}><List size={17} /> Agenda</button></div>
        </div>

        {loading ? <p className="py-16 text-center text-zinc-500">Cargando calendario...</p> : view === "month" ? (
          <div className="calendar-month-scroll mt-6"><div className="calendar-month-shell"><div className="grid grid-cols-7">{weekDays.map((day) => <div key={day} className="p-2 text-center text-xs uppercase tracking-wider text-zinc-500">{day}</div>)}</div><div className="calendar-grid">{calendarDays.map((day) => { const dayEvents = events.filter((item) => dateKey(new Date(item.starts_at)) === dateKey(day)); const outside = day.getMonth() !== month.getMonth(); const today = dateKey(day) === dateKey(new Date()); return <button key={day.toISOString()} onClick={() => openNew(day)} className={`calendar-day ${outside ? "calendar-day-outside" : ""}`}><span className={`calendar-day-number ${today ? "calendar-today" : ""}`}>{day.getDate()}</span><span className="calendar-day-events mt-2 space-y-1">{dayEvents.slice(0, 3).map((item) => <span key={item.id} className={`calendar-event-pill priority-${item.priority}`}>{new Date(item.starts_at).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })} · {item.title}</span>)}{dayEvents.length > 3 && <span className="block text-xs text-zinc-500">+{dayEvents.length - 3} más</span>}</span></button>; })}</div></div></div>
        ) : (
          <EventList events={upcoming} members={members} onComplete={completeEvent} onDelete={deleteEvent} canManage={canManageUsers} userId={user.id} />
        )}
      </Card>

      {modalOpen && <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/65 p-4 backdrop-blur-sm"><Card hover={false} className="w-full max-w-3xl" contentClassName="max-h-[90vh] overflow-y-auto p-6"><form onSubmit={createEvent}><div className="flex items-start justify-between"><div><h2 className="text-xl font-semibold text-white">Nuevo evento</h2><p className="mt-1 text-sm text-zinc-400">Añade una tarea, reunión o recordatorio.</p></div><button type="button" onClick={() => setModalOpen(false)} className="calendar-icon-button"><X size={19} /></button></div><div className="mt-6 grid gap-4 md:grid-cols-2"><Field label="Título"><input required minLength="2" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className="field" /></Field><Field label="Tipo"><select value={form.event_type} onChange={(e) => setForm({ ...form, event_type: e.target.value })} className="field">{Object.entries(typeLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></Field><Field label="Comienza"><input required type="datetime-local" value={form.starts_at} onChange={(e) => setForm({ ...form, starts_at: e.target.value })} className="field" /></Field><Field label="Termina"><input type="datetime-local" value={form.ends_at} onChange={(e) => setForm({ ...form, ends_at: e.target.value })} className="field" /></Field><Field label="Responsable"><select value={form.assigned_to} onChange={(e) => setForm({ ...form, assigned_to: e.target.value })} className="field"><option value="">Yo</option>{members.map((member) => <option key={member.id} value={member.id}>{member.first_name || "Sin nombre"}{member.division ? ` · ${member.division}` : ""}</option>)}</select></Field><Field label="Recordarme"><select value={form.remind} onChange={(e) => setForm({ ...form, remind: e.target.value })} className="field"><option value="none">Sin recordatorio</option><option value="10">10 minutos antes</option><option value="30">30 minutos antes</option><option value="60">1 hora antes</option><option value="1440">1 día antes</option></select></Field><Field label="Prioridad"><select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })} className="field"><option value="low">Baja</option><option value="normal">Normal</option><option value="high">Alta</option></select></Field><Field label="Visibilidad"><select value={form.visibility} onChange={(e) => setForm({ ...form, visibility: e.target.value })} className="field"><option value="personal">Personal</option><option value="team">Equipo</option></select></Field><label className="md:col-span-2"><span className="mb-2 block text-sm text-zinc-400">Notas</span><textarea rows="4" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="field" placeholder="Detalles, enlaces o instrucciones..." /></label></div><div className="mt-6 flex justify-end"><button className="rounded-xl bg-white px-5 py-3 font-medium text-black">Guardar evento</button></div></form></Card></div>}
    </Page>
  );
}

function EventList({ events, members, onComplete, onDelete, canManage, userId }) {
  if (!events.length) return <div className="py-16 text-center"><CalendarDays className="mx-auto text-zinc-600" size={36} /><p className="mt-4 text-zinc-400">No tienes eventos próximos.</p></div>;
  return <div className="mt-6 space-y-3">{events.map((event) => { const owner = members.find((member) => member.id === event.assigned_to); const canEdit = canManage || event.created_by === userId; return <div key={event.id} className="calendar-list-item"><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><span className={`calendar-type priority-${event.priority}`}>{typeLabels[event.event_type]}</span><h3 className={`font-medium text-white ${event.status === "completed" ? "line-through opacity-60" : ""}`}>{event.title}</h3></div><p className="mt-2 flex items-center gap-2 text-sm text-zinc-400"><Clock size={15} /> {new Date(event.starts_at).toLocaleString("es-ES", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}{owner?.first_name ? ` · ${owner.first_name}` : ""}</p>{event.description && <p className="mt-2 text-sm text-zinc-500">{event.description}</p>}</div>{canEdit && <div className="flex gap-2"><button onClick={() => onComplete(event)} className="calendar-icon-button" title="Completar"><Check size={18} /></button><button onClick={() => onDelete(event)} className="calendar-icon-button" title="Eliminar"><Trash2 size={18} /></button></div>}</div>; })}</div>;
}

function Field({ label, children }) {
  return <label><span className="mb-2 block text-sm text-zinc-400">{label}</span>{children}</label>;
}

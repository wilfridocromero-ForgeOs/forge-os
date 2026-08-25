import { AlertTriangle, ArrowRight, CheckCircle2, Clock3, History, Repeat2, UsersRound } from "lucide-react";
import { formatActivityDate, formatProjectActivity } from "./projectActivityFormatter";

const roleLabels = { owner: "Propietario", member: "Miembro", observer: "Observador" };
const statusLabels = { pending: "Pendiente", in_progress: "En progreso", blocked: "Bloqueada" };

function dayKey(value) { const date = new Date(value); return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`; }
function taskDate(value) {
  if (!value) return "Sin fecha";
  const date = new Date(value);
  const today = new Date();
  if (dayKey(date) === dayKey(today)) return "Hoy";
  const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1);
  if (dayKey(date) === dayKey(tomorrow)) return "Mañana";
  return new Intl.DateTimeFormat("es", { day: "numeric", month: "short" }).format(date);
}

function getOperationalTasks(tasks) {
  const now = new Date();
  const active = tasks.filter((task) => !task.is_recurrence_template && !["completed", "cancelled"].includes(task.status));
  return [...active].sort((a, b) => {
    const rank = (task) => task.due_at && new Date(task.due_at) < now ? 0 : task.due_at && dayKey(task.due_at) === dayKey(now) ? 1 : task.status === "in_progress" ? 2 : 3;
    return rank(a) - rank(b) || new Date(a.due_at || "9999-12-31") - new Date(b.due_at || "9999-12-31");
  });
}

function nextRecurrence(tasks) {
  return tasks
    .map((task) => task.recurrence_schedule)
    .filter((schedule) => schedule?.active)
    .sort((a, b) => new Date(a.next_run_at || "9999-12-31") - new Date(b.next_run_at || "9999-12-31"))[0] || null;
}

export default function ProjectSummary({ project, work, activity, members, loading, onViewWork, onViewActivity, onViewTeam }) {
  const tasks = work.tasks.filter((task) => !task.is_recurrence_template && task.status !== "cancelled");
  const completed = tasks.filter((task) => task.status === "completed").length;
  const remaining = Math.max(0, tasks.length - completed);
  const overdue = tasks.filter((task) => task.due_at && new Date(task.due_at) < new Date() && task.status !== "completed").length;
  const today = tasks.filter((task) => task.due_at && dayKey(task.due_at) === dayKey(new Date()) && task.status !== "completed").length;
  const next = getOperationalTasks(work.tasks).slice(0, 4);
  const recurrence = nextRecurrence(work.tasks);
  const progress = Math.min(100, Math.max(0, Number(project.progress || 0)));

  if (loading) return <p className="text-sm text-zinc-500">Preparando el espacio de trabajo…</p>;
  return <div className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(300px,.65fr)]">
    <div className="min-w-0 space-y-5">
      <section className="rounded-2xl border border-zinc-800 p-4 sm:p-5">
        <div className="flex items-start justify-between gap-4"><div className="min-w-0"><p className="text-xs uppercase tracking-[.18em] text-zinc-600">Estado operacional</p><h2 className="mt-1.5 break-words text-lg font-semibold text-white">{completed} completada{completed === 1 ? "" : "s"} · {remaining} pendiente{remaining === 1 ? "" : "s"}</h2></div><CheckCircle2 className="shrink-0 text-zinc-600" size={22} /></div>
        <div className="mt-3 flex flex-wrap gap-2 text-xs">{today > 0 && <span className="inline-flex min-h-8 items-center gap-1 rounded-full bg-blue-950/50 px-3 py-1.5 text-blue-300"><Clock3 size={12} /> {today} para hoy</span>}{overdue > 0 ? <span className="inline-flex min-h-8 items-center gap-1 rounded-full bg-red-950/40 px-3 py-1.5 text-red-300"><AlertTriangle size={12} /> {overdue} vencida{overdue === 1 ? "" : "s"}</span> : <span className="inline-flex min-h-8 items-center rounded-full bg-zinc-900 px-3 py-1.5 text-zinc-500">Sin tareas vencidas</span>}</div>
      </section>

      <section className="rounded-2xl border border-zinc-800 p-5 sm:p-6">
        <div className="flex items-center justify-between gap-4"><div><p className="text-xs uppercase tracking-[.18em] text-zinc-600">Ejecución</p><h2 className="mt-1 text-xl font-semibold text-white">Próximo trabajo</h2></div><button type="button" onClick={onViewWork} className="inline-flex min-h-10 items-center gap-1 text-sm text-zinc-400 hover:text-white">Ver todo <ArrowRight size={15} /></button></div>
        {next.length ? <div className="mt-4 space-y-2">{next.map((task) => <button type="button" key={task.id} onClick={onViewWork} className="grid min-h-16 w-full min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-xl border border-zinc-800 px-3 py-3 text-left hover:border-zinc-600 sm:px-4"><div className="min-w-0"><p className="truncate text-sm font-medium text-white">{task.title}</p><p className="mt-1 truncate text-xs text-zinc-500">{task.assignee?.first_name || "Sin asignar"} · {taskDate(task.due_at || task.starts_at)}</p></div><span className="max-w-24 shrink-0 text-right text-xs leading-4 text-zinc-500">{statusLabels[task.status] || task.status}</span></button>)}</div> : tasks.length ? <div className="mt-5 rounded-xl border border-emerald-200 bg-emerald-50 p-5 text-center dark:border-emerald-900/40 dark:bg-emerald-950/15"><CheckCircle2 className="mx-auto text-emerald-600 dark:text-emerald-300" size={24} /><p className="mt-3 font-medium text-emerald-800 dark:text-emerald-200">{recurrence ? "El trabajo actual está completado" : "Todo el trabajo está completado"}</p><p className="mt-2 text-sm text-zinc-500">{recurrence ? recurrence.next_run_at ? `La próxima ejecución recurrente está prevista para ${taskDate(recurrence.next_run_at)}.` : "No hay ejecuciones pendientes ahora; la recurrencia sigue activa." : "Las tareas de este proyecto están terminadas."}</p>{progress === 100 && <p className="mt-1 text-xs font-medium text-emerald-700 dark:text-emerald-300">Proyecto completado al 100%.</p>}</div> : recurrence ? <div className="mt-5 rounded-xl border border-blue-200 bg-blue-50 p-5 text-center dark:border-blue-900/40 dark:bg-blue-950/15"><Repeat2 className="mx-auto text-blue-600 dark:text-blue-300" size={24} /><p className="mt-3 font-medium text-blue-800 dark:text-blue-200">Próxima ejecución recurrente</p><p className="mt-2 text-sm text-zinc-500">{recurrence.next_run_at ? `Prevista para ${taskDate(recurrence.next_run_at)}.` : "La recurrencia está activa y no hay una ejecución pendiente ahora."}</p></div> : <div className="mt-5 rounded-xl border border-dashed border-zinc-800 p-6 text-center"><p className="font-medium text-white">Este proyecto está listo para comenzar.</p><p className="mt-2 text-sm text-zinc-500">Crea la primera tarea para empezar a trabajar.</p><button type="button" onClick={onViewWork} className="mt-4 min-h-10 rounded-xl bg-white px-4 text-sm font-medium text-black">Nueva tarea</button></div>}
      </section>
    </div>

    <aside className="min-w-0 space-y-5">
      <section className="rounded-2xl border border-zinc-800 p-5">
        <div className="flex items-center justify-between gap-3"><h2 className="flex items-center gap-2 font-semibold text-white"><UsersRound size={18} /> Equipo</h2><button type="button" onClick={onViewTeam} className="text-xs text-zinc-500 hover:text-white">Ver equipo</button></div>
        {!members.length ? <p className="mt-4 text-sm text-zinc-500">Todavía no hay miembros asignados.</p> : <div className="mt-4 space-y-3">{members.slice(0, 5).map((member) => <div key={member.id} className="flex min-w-0 items-center gap-3"><div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-zinc-800 text-xs font-semibold text-zinc-300">{(member.user?.first_name || "U").slice(0, 1).toUpperCase()}</div><div className="min-w-0"><p className="truncate text-sm text-white">{member.user?.first_name || "Usuario"}</p><p className="text-xs text-zinc-600">{roleLabels[member.role] || member.role}</p></div></div>)}</div>}
      </section>
      <section className="rounded-2xl border border-zinc-800 p-5">
        <div className="flex items-center justify-between gap-3"><h2 className="flex items-center gap-2 font-semibold text-white"><History size={18} /> Actividad reciente</h2><button type="button" onClick={onViewActivity} className="text-xs text-zinc-500 hover:text-white">Ver toda</button></div>
        {!activity.length ? <p className="mt-4 text-sm text-zinc-500">La actividad del proyecto aparecerá aquí.</p> : <ol className="mt-4 space-y-4">{activity.slice(0, 5).map((row) => <li key={row.id} className="border-l border-zinc-800 pl-3"><p className="text-sm leading-5 text-zinc-300">{formatProjectActivity(row)}</p><time className="mt-1 block text-xs text-zinc-600">{formatActivityDate(row.created_at)}</time></li>)}</ol>}
      </section>
    </aside>
  </div>;
}

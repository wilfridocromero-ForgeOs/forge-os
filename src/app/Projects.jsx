import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CalendarClock, CheckCircle2, CircleDot, Edit3, Search } from "lucide-react";
import { useNavigate, useSearchParams } from "react-router-dom";
import Page from "../components/ui/Page";
import PageHeader from "../components/ui/PageHeader";
import Card from "../components/ui/Card";
import Button from "../components/ui/Button";
import ProjectModal from "../features/projects/ProjectModal";
import { useOrganization } from "../Context/OrganizationContext";
import { useAuth } from "../Context/AuthContext";
import { useDivisions } from "../hooks/useDivisions";
import { createProject, getProjectOptions, getProjects, updateProject } from "../services/ProjectService";

const statuses = { planned: "Planificación", active: "Activo", blocked: "En pausa", completed: "Completado", cancelled: "Cancelado", archived: "Archivado" };
const priorities = { low: "Baja", medium: "Media", high: "Alta", urgent: "Urgente" };
const badge = { planned: "bg-zinc-800 text-zinc-300", active: "bg-blue-950 text-blue-300", blocked: "bg-amber-950 text-amber-300", completed: "bg-emerald-950 text-emerald-300", cancelled: "bg-red-950 text-red-300", archived: "bg-zinc-900 text-zinc-500" };
const quickFilters = [["all", "Todos"], ["active", "Activos"], ["risk", "En riesgo"], ["completed", "Completados"], ["archived", "Archivados"]];
function day(value) { return value ? new Intl.DateTimeFormat("es", { day: "numeric", month: "short", year: "numeric" }).format(new Date(value)) : "Sin fecha"; }
function isOverdue(project) { return project.due_at && new Date(project.due_at) < new Date() && !["completed", "cancelled", "archived"].includes(project.status); }
function matchesQuickFilter(project, filter) { if (filter === "all") return project.status !== "archived"; if (filter === "risk") return isOverdue(project); return project.status === filter; }

function Metric({ icon: Icon, label, value }) { return <Card hover={false} contentClassName="p-4 sm:p-5"><div className="flex items-center justify-between"><div><p className="text-xs uppercase tracking-[.18em] text-zinc-600">{label}</p><p className="mt-2 text-2xl font-semibold text-white sm:text-3xl">{value}</p></div><Icon className="text-zinc-600" size={22} /></div></Card>; }

export default function Projects() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const { activeOrganization } = useOrganization();
  const { user, canManageUsers } = useAuth();
  const { divisions } = useDivisions(activeOrganization?.id);
  const [projects, setProjects] = useState([]);
  const [options, setOptions] = useState({ clients: [], users: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [quickFilter, setQuickFilter] = useState("all");
  const [status, setStatus] = useState("all");
  const [division, setDivision] = useState("all");
  const [modal, setModal] = useState(false);
  const [editing, setEditing] = useState(null);

  useEffect(() => {
    if (searchParams.get("new") !== "1") return;
    // Route state intentionally opens the existing creation flow.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setEditing(null);
    setModal(true);
    setSearchParams({}, { replace: true });
  }, [searchParams, setSearchParams]);

  useEffect(() => {
    let active = true;
    if (!activeOrganization?.id) return undefined;
    // Loading belongs to the organization-scoped request lifecycle.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    setError("");
    Promise.all([getProjects(activeOrganization.id), getProjectOptions(activeOrganization.id)])
      .then(([rows, values]) => { if (active) { setProjects(rows); setOptions(values); } })
      .catch((reason) => { if (active) setError(reason.message || "No se pudieron cargar los proyectos."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [activeOrganization?.id]);

  const filtered = useMemo(() => projects.filter((project) => {
    const text = [project.name, project.description, project.clients?.company_name, project.divisions?.name, project.owner?.first_name].filter(Boolean).join(" ").toLowerCase();
    return matchesQuickFilter(project, quickFilter) && (status === "all" || project.status === status) && (division === "all" || project.division_id === division) && (!search.trim() || text.includes(search.trim().toLowerCase()));
  }), [projects, quickFilter, search, status, division]);
  const metrics = useMemo(() => { const now = new Date(); const soon = new Date(now); soon.setDate(now.getDate() + 7); return { active: projects.filter((p) => p.status === "active").length, completed: projects.filter((p) => p.status === "completed").length, overdue: projects.filter(isOverdue).length, soon: projects.filter((p) => p.due_at && new Date(p.due_at) >= now && new Date(p.due_at) <= soon && !["completed", "cancelled", "archived"].includes(p.status)).length }; }, [projects]);
  function mayEdit(project) { return canManageUsers || project.owner_id === user?.id || project.created_by === user?.id; }
  function replaceProject(row) { setProjects((current) => current.map((item) => item.id === row.id ? row : item)); }
  async function save(values) { const row = editing ? await updateProject(editing.id, values, activeOrganization.id, user.id) : await createProject(values, activeOrganization.id, user.id); if (editing) replaceProject(row); else setProjects((current) => [row, ...current]); }

  return <Page className="min-w-0 space-y-6">
    <PageHeader eyebrow="OPERACIONES" title="Proyectos" description="Convierte prioridades en ejecución visible por cliente, división y responsable."><Button className="w-full sm:w-auto" onClick={() => { setEditing(null); setModal(true); }}>+ Nuevo proyecto</Button></PageHeader>
    <div className="grid gap-3 grid-cols-2 xl:grid-cols-4"><Metric icon={CircleDot} label="Activos" value={metrics.active} /><Metric icon={CheckCircle2} label="Completados" value={metrics.completed} /><Metric icon={AlertTriangle} label="En riesgo" value={metrics.overdue} /><Metric icon={CalendarClock} label="Vencen en 7 días" value={metrics.soon} /></div>
    <section className="min-w-0 space-y-3 rounded-2xl border border-zinc-800 bg-[#111113] p-3">
      <div className="flex min-w-0 gap-2 overflow-x-auto pb-1" aria-label="Filtros rápidos">{quickFilters.map(([key, label]) => <button type="button" key={key} onClick={() => setQuickFilter(key)} className={`shrink-0 rounded-full px-4 py-2 text-sm ${quickFilter === key ? "bg-white text-black" : "bg-zinc-900 text-zinc-400 hover:text-white"}`}>{label}</button>)}</div>
      <div className="grid min-w-0 gap-3 lg:grid-cols-[minmax(0,1fr)_210px_210px]">
        <div className="flex min-w-0 items-center gap-3 rounded-xl border border-zinc-800 bg-zinc-950 px-4 py-3"><Search size={17} className="shrink-0 text-zinc-600"/><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar proyectos..." className="min-w-0 flex-1 bg-transparent text-sm text-white outline-none"/></div>
        <select value={status} onChange={(e) => setStatus(e.target.value)} className="min-w-0 rounded-xl border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm text-white"><option value="all">Todos los estados</option>{Object.entries(statuses).map(([key, value]) => <option key={key} value={key}>{value}</option>)}</select>
        <select value={division} onChange={(e) => setDivision(e.target.value)} className="min-w-0 rounded-xl border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm text-white"><option value="all">Todas las divisiones</option>{divisions.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
      </div>
    </section>
    {error && <p className="rounded-xl border border-red-900/50 bg-red-950/20 p-4 text-sm text-red-300">{error}</p>}
    {loading && <p className="text-sm text-zinc-500">Cargando proyectos…</p>}
    {!loading && filtered.length === 0 && <Card hover={false} contentClassName="p-8 text-center sm:p-10"><h2 className="text-lg font-semibold text-white">{projects.length ? "No hay coincidencias" : "Todavía no hay proyectos"}</h2><p className="mt-2 text-sm text-zinc-500">{projects.length ? "Ajusta los filtros." : "Crea el primero usando clientes y divisiones existentes."}</p></Card>}
    <div className="grid min-w-0 gap-3 lg:grid-cols-2 2xl:grid-cols-3">{filtered.map((project) => <Card key={project.id} className="min-w-0" contentClassName="p-4 sm:p-5">
      <button type="button" onClick={() => navigate(`/proyectos/${project.id}`)} className="block w-full min-w-0 text-left">
        <div className="flex min-w-0 items-start justify-between gap-3"><div className="min-w-0"><p className="truncate text-xs uppercase tracking-[.18em] text-zinc-600">{project.divisions?.name || "Sin división"}</p><h2 className="mt-2 truncate text-lg font-semibold text-white">{project.name}</h2><p className="mt-1 truncate text-sm text-zinc-500">{project.clients?.company_name || "Proyecto interno"}</p></div><span className={`shrink-0 rounded-full px-3 py-1 text-xs ${badge[project.status] || badge.planned}`}>{statuses[project.status] || project.status}</span></div>
        <p className="mt-3 line-clamp-2 min-h-10 break-words text-sm leading-5 text-zinc-500">{project.description || "Sin descripción"}</p>
        <div className="mt-4"><div className="mb-2 flex justify-between text-xs text-zinc-500"><span>Progreso</span><span>{Number(project.progress)}%</span></div><div className="h-1.5 overflow-hidden rounded-full bg-zinc-800"><div className="h-full bg-white" style={{ width: `${Math.min(100, Math.max(0, Number(project.progress)))}%` }} /></div></div>
        <div className="mt-4 grid grid-cols-2 gap-3 border-t border-zinc-800 pt-4 text-xs"><div className="min-w-0"><p className="text-zinc-600">Responsable</p><p className="mt-1 truncate text-zinc-300">{project.owner?.first_name || "Sin asignar"}</p></div><div><p className="text-zinc-600">Fecha límite</p><p className={`mt-1 ${isOverdue(project) ? "text-red-300" : "text-zinc-300"}`}>{day(project.due_at)}</p></div><div><p className="text-zinc-600">Prioridad</p><p className="mt-1 text-zinc-300">{priorities[project.priority]}</p></div><div><p className="text-zinc-600">Estado</p><p className="mt-1 text-zinc-300">{statuses[project.status]}</p></div></div>
      </button>
      {mayEdit(project) && <button type="button" onClick={() => { setEditing(project); setModal(true); }} className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl border border-zinc-800 py-2.5 text-sm text-zinc-300 hover:bg-zinc-800"><Edit3 size={15}/> Editar</button>}
    </Card>)}</div>
    {modal && <ProjectModal key={editing?.id || "new"} open project={editing} divisions={divisions} clients={options.clients} users={options.users} onClose={() => { setModal(false); setEditing(null); }} onSave={save}/>}
  </Page>;
}

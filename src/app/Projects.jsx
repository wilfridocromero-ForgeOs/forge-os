import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CalendarClock, CheckCircle2, CircleDot, Edit3, Search, Trash2 } from "lucide-react";
import Page from "../components/ui/Page";
import PageHeader from "../components/ui/PageHeader";
import Card from "../components/ui/Card";
import Button from "../components/ui/Button";
import ProjectModal from "../features/projects/ProjectModal";
import { useOrganization } from "../Context/OrganizationContext";
import { useAuth } from "../Context/AuthContext";
import { useDivisions } from "../hooks/useDivisions";
import { createProject, deleteProject, getProjectOptions, getProjects, updateProject } from "../services/ProjectService";
import { useSearchParams } from "react-router-dom";

const statuses = { planned: "Planificado", active: "Activo", blocked: "Bloqueado", completed: "Finalizado", cancelled: "Cancelado" };
const priorities = { low: "Baja", medium: "Media", high: "Alta", urgent: "Urgente" };
const badge = { planned: "bg-zinc-800 text-zinc-300", active: "bg-blue-950 text-blue-300", blocked: "bg-amber-950 text-amber-300", completed: "bg-emerald-950 text-emerald-300", cancelled: "bg-red-950 text-red-300" };
function day(value) { return value ? new Intl.DateTimeFormat("es", { day: "numeric", month: "short", year: "numeric" }).format(new Date(value)) : "Sin fecha"; }
function isOverdue(project) { return project.due_at && new Date(project.due_at) < new Date() && !["completed", "cancelled"].includes(project.status); }

function Metric({ icon: Icon, label, value }) { return <Card hover={false} contentClassName="p-5"><div className="flex items-center justify-between"><div><p className="text-xs uppercase tracking-[.22em] text-zinc-600">{label}</p><p className="mt-2 text-3xl font-semibold text-white">{value}</p></div><Icon className="text-zinc-600" size={22} /></div></Card>; }

export default function Projects() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { organization } = useOrganization();
  const { user, canManageUsers } = useAuth();
  const { divisions } = useDivisions(organization?.id);
  const [projects, setProjects] = useState([]); const [options, setOptions] = useState({ clients: [], users: [] });
  const [loading, setLoading] = useState(true); const [error, setError] = useState("");
  const [search, setSearch] = useState(""); const [status, setStatus] = useState("all"); const [division, setDivision] = useState("all");
  const [modal, setModal] = useState(false); const [editing, setEditing] = useState(null);

  useEffect(() => {
    if (searchParams.get("new") !== "1") return;
    // Route state intentionally opens the existing creation flow.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setEditing(null); setModal(true); setSearchParams({}, { replace: true });
  }, [searchParams, setSearchParams]);

  useEffect(() => { let active = true; if (!organization?.id) return;
    Promise.all([getProjects(organization.id), getProjectOptions(organization.id)])
      .then(([rows, values]) => { if (active) { setProjects(rows); setOptions(values); } })
      .catch((reason) => active && setError(reason.message || "No se pudieron cargar los proyectos."))
      .finally(() => active && setLoading(false)); return () => { active = false; };
  }, [organization?.id]);

  const filtered = useMemo(() => projects.filter((project) => {
    const text = [project.name, project.description, project.clients?.company_name, project.divisions?.name].filter(Boolean).join(" ").toLowerCase();
    return (status === "all" || project.status === status) && (division === "all" || project.division_id === division) && (!search.trim() || text.includes(search.trim().toLowerCase()));
  }), [projects, search, status, division]);
  const metrics = useMemo(() => { const now = new Date(); const soon = new Date(now); soon.setDate(now.getDate() + 7); return { active: projects.filter((p) => p.status === "active").length, completed: projects.filter((p) => p.status === "completed").length, overdue: projects.filter(isOverdue).length, soon: projects.filter((p) => p.due_at && new Date(p.due_at) >= now && new Date(p.due_at) <= soon && !["completed", "cancelled"].includes(p.status)).length }; }, [projects]);
  function mayEdit(project) { return canManageUsers || project.owner_id === user?.id || project.created_by === user?.id; }
  async function save(values) { const row = editing ? await updateProject(editing.id, values, organization.id, user.id) : await createProject(values, organization.id, user.id); setProjects((current) => editing ? current.map((item) => item.id === row.id ? row : item) : [row, ...current]); }
  async function remove(project) { if (!window.confirm(`¿Eliminar “${project.name}”? Esta acción también eliminará sus datos relacionados.`)) return; try { await deleteProject(project.id, user.id); setProjects((current) => current.filter((item) => item.id !== project.id)); } catch (reason) { setError(reason.message); } }

  return <Page className="space-y-6">
    <PageHeader eyebrow="OPERACIONES" title="Proyectos" description="Gestiona trabajo real por cliente, división y responsable."><Button className="w-full sm:w-auto" onClick={() => { setEditing(null); setModal(true); }}>+ Nuevo proyecto</Button></PageHeader>
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><Metric icon={CircleDot} label="Activos" value={metrics.active} /><Metric icon={CheckCircle2} label="Finalizados" value={metrics.completed} /><Metric icon={AlertTriangle} label="Atrasados" value={metrics.overdue} /><Metric icon={CalendarClock} label="Vencen en 7 días" value={metrics.soon} /></div>
    <section className="grid gap-3 rounded-2xl border border-zinc-800 bg-[#111113] p-3 lg:grid-cols-[1fr_220px_220px]">
      <div className="flex items-center gap-3 rounded-xl border border-zinc-800 bg-zinc-950 px-4 py-3"><Search size={17} className="text-zinc-600"/><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar proyecto, cliente o división" className="min-w-0 flex-1 bg-transparent text-sm text-white outline-none"/></div>
      <select value={status} onChange={(e) => setStatus(e.target.value)} className="rounded-xl border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm text-white"><option value="all">Todos los estados</option>{Object.entries(statuses).map(([key, value]) => <option key={key} value={key}>{value}</option>)}</select>
      <select value={division} onChange={(e) => setDivision(e.target.value)} className="rounded-xl border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm text-white"><option value="all">Todas las divisiones</option>{divisions.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
    </section>
    {error && <p className="rounded-xl border border-red-900/50 bg-red-950/20 p-4 text-sm text-red-300">{error}</p>}
    {loading && <p className="text-sm text-zinc-500">Cargando proyectos…</p>}
    {!loading && filtered.length === 0 && <Card hover={false} contentClassName="p-10 text-center"><h2 className="text-lg font-semibold text-white">{projects.length ? "No hay coincidencias" : "Todavía no hay proyectos"}</h2><p className="mt-2 text-sm text-zinc-500">{projects.length ? "Ajusta los filtros." : "Crea el primero usando clientes y divisiones existentes."}</p></Card>}
    <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">{filtered.map((project) => <Card key={project.id} contentClassName="p-5 sm:p-6">
      <div className="flex items-start justify-between gap-4"><div className="min-w-0"><p className="text-xs uppercase tracking-[.2em] text-zinc-600">{project.divisions?.name || "Sin división"}</p><h2 className="mt-2 truncate text-xl font-semibold text-white">{project.name}</h2><p className="mt-1 text-sm text-zinc-500">{project.clients?.company_name || "Proyecto interno"}</p></div><span className={`rounded-full px-3 py-1 text-xs ${badge[project.status]}`}>{statuses[project.status]}</span></div>
      <p className="mt-4 line-clamp-2 min-h-10 text-sm leading-5 text-zinc-500">{project.description || "Sin descripción"}</p>
      <div className="mt-5"><div className="mb-2 flex justify-between text-xs text-zinc-500"><span>Progreso</span><span>{Number(project.progress)}%</span></div><div className="h-1.5 overflow-hidden rounded-full bg-zinc-800"><div className="h-full bg-white" style={{ width: `${project.progress}%` }} /></div></div>
      <div className="mt-5 grid grid-cols-2 gap-3 border-t border-zinc-800 pt-4 text-xs"><div><p className="text-zinc-600">Responsable</p><p className="mt-1 truncate text-zinc-300">{project.owner?.first_name || "Sin asignar"}</p></div><div><p className="text-zinc-600">Fecha límite</p><p className={`mt-1 ${isOverdue(project) ? "text-red-300" : "text-zinc-300"}`}>{day(project.due_at)}</p></div><div><p className="text-zinc-600">Prioridad</p><p className="mt-1 text-zinc-300">{priorities[project.priority]}</p></div><div><p className="text-zinc-600">Inicio</p><p className="mt-1 text-zinc-300">{day(project.starts_at)}</p></div></div>
      {mayEdit(project) && <div className="mt-5 flex gap-2"><button onClick={() => { setEditing(project); setModal(true); }} className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-zinc-800 py-2.5 text-sm text-zinc-300 hover:bg-zinc-800"><Edit3 size={15}/> Editar</button><button onClick={() => remove(project)} className="rounded-xl border border-zinc-800 px-3 text-zinc-500 hover:border-red-900 hover:text-red-300" aria-label="Eliminar proyecto"><Trash2 size={16}/></button></div>}
    </Card>)}</div>
    {modal && <ProjectModal open project={editing} divisions={divisions} clients={options.clients} users={options.users} onClose={() => { setModal(false); setEditing(null); }} onSave={save}/>} 
  </Page>;
}

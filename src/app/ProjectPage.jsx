import { useEffect, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
import Button from "../components/ui/Button";
import Page from "../components/ui/Page";
import PageHeader from "../components/ui/PageHeader";
import { useAuth } from "../Context/AuthContext";
import { useOrganization } from "../Context/OrganizationContext";
import ProjectDetail from "../features/projects/ProjectDetail";
import ProjectModal from "../features/projects/ProjectModal";
import { useDivisions } from "../hooks/useDivisions";
import { archiveProject, getProject, getProjectMembers, getProjectOptions, updateProject } from "../services/ProjectService";

export default function ProjectPage() {
  const { projectId } = useParams();
  const navigate = useNavigate();
  const { activeOrganization } = useOrganization();
  const { user, canManageUsers } = useAuth();
  const { divisions } = useDivisions(activeOrganization?.id);
  const [project, setProject] = useState(null);
  const [options, setOptions] = useState({ clients: [], users: [] });
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    let active = true;
    if (!activeOrganization?.id) return undefined;
    // Loading belongs to the organization-scoped request lifecycle.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    setError("");
    Promise.all([getProject(projectId, activeOrganization.id), getProjectOptions(activeOrganization.id), getProjectMembers(projectId)])
      .then(([row, values, projectMembers]) => { if (active) { setProject(row); setOptions(values); setMembers(projectMembers); } })
      .catch((reason) => { if (active) setError(reason.message || "No se pudo cargar el proyecto."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [activeOrganization?.id, projectId]);

  const canEdit = Boolean(project && (canManageUsers || project.owner_id === user?.id || project.created_by === user?.id));
  const canManageMembers = Boolean(project && (canManageUsers || project.owner_id === user?.id));

  async function save(values) {
    const row = await updateProject(project.id, values, activeOrganization.id, user.id);
    setProject(row);
    setMembers(await getProjectMembers(project.id));
  }

  async function archive() {
    if (!window.confirm(`¿Archivar “${project.name}”?`)) return;
    try { setProject(await archiveProject(project.id)); }
    catch (reason) { setError(reason.message || "No se pudo archivar el proyecto."); }
  }

  return <Page className="min-w-0 space-y-6">
    <PageHeader eyebrow="PROYECTOS" title={project?.name || "Detalle del proyecto"} description={project?.clients?.company_name || "Expediente operacional del proyecto."}>
      <Button variant="ghost" onClick={() => navigate("/proyectos")}><ArrowLeft size={16} /> Volver</Button>
    </PageHeader>
    {loading && <p className="text-sm text-zinc-500">Cargando proyecto…</p>}
    {error && <p className="rounded-xl border border-red-900/50 bg-red-950/20 p-4 text-sm text-red-300">{error}</p>}
    {!loading && !error && !project && <div className="rounded-2xl border border-zinc-800 p-8 text-center"><h2 className="font-semibold text-white">Proyecto no encontrado</h2><p className="mt-2 text-sm text-zinc-500">No existe o no tienes acceso desde la organización activa.</p></div>}
    {project && <ProjectDetail embedded project={project} users={options.users} projectMembers={members} onMembersChange={setMembers} userId={user.id} canEdit={canEdit} canManageMembers={canManageMembers} onEdit={() => setEditing(true)} onArchive={archive} onProjectChange={setProject} />}
    {editing && <ProjectModal key={project.id} open project={project} divisions={divisions} clients={options.clients} users={options.users} onClose={() => setEditing(false)} onSave={save} />}
  </Page>;
}

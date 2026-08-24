import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, Building2, CheckCircle2, ClipboardCheck, FolderKanban, Globe, Mail, MessageSquarePlus, Phone, ShieldCheck, Target } from "lucide-react";
import { Link, useNavigate, useParams } from "react-router-dom";

import Card from "../components/ui/Card";
import Page from "../components/ui/Page";
import ClientActionsMenu from "../features/clients/components/ClientActionsMenu";
import ClientDeleteModal from "../features/clients/components/ClientDeleteModal";
import ClientEditorModal from "../features/clients/components/ClientEditorModal";
import { useAuth } from "../Context/AuthContext";
import { archiveClient, createClientNote, getClient, getClientNotes, restoreClient } from "../services/ClientService";
import InviteClientModal from "./Clients/InviteClientModal";
import "./Clients.css";

const STATUS_LABELS = { lead: "Lead", active: "Activo", activo: "Activo", paused: "Pausado", pausado: "Pausado", closed: "Cerrado", cerrado: "Cerrado", archived: "Archivado" };
const DISCOVERY_LABELS = { draft: "Borrador", in_progress: "En progreso", completed: "Completado", abandoned: "Abandonado" };

export default function ClientProfile() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user, organization, role, canManageUsers, isInternalOrganization } = useAuth();
  const organizationId = organization?.id;
  const [client, setClient] = useState(null);
  const [notes, setNotes] = useState([]);
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [editorOpen, setEditorOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);

  const loadProfile = useCallback(async () => {
    if (!organizationId) return;
    setLoading(true);
    setError("");
    try {
      const [clientResult, notesResult] = await Promise.allSettled([getClient(id, organizationId), getClientNotes(id)]);
      if (clientResult.status === "rejected") throw clientResult.reason;
      setClient(clientResult.value);
      setNotes(notesResult.status === "fulfilled" ? notesResult.value : []);
      if (notesResult.status === "rejected") setError("El expediente cargó, pero las notas no están disponibles ahora.");
    } catch {
      setError("No se pudo abrir la información de este cliente.");
    } finally {
      setLoading(false);
    }
  }, [id, organizationId]);

  useEffect(() => { Promise.resolve().then(loadProfile); }, [loadProfile]);

  const context = useMemo(() => buildClientContext(client), [client]);

  async function addNote(event) {
    event.preventDefault();
    if (!note.trim() || !client) return;
    setSaving(true);
    setError("");
    try {
      await createClientNote({ clientId: client.id, organizationId: client.organization_id, userId: user.id, content: note });
      setNote("");
      setNotes(await getClientNotes(client.id));
    } catch (reason) {
      setError(reason.message || "No se pudo guardar la nota.");
    } finally {
      setSaving(false);
    }
  }

  async function archive() {
    try { const saved = await archiveClient(client.id, client.organization_id); setClient((current) => ({ ...current, ...saved })); }
    catch (reason) { setError(reason.message); }
  }

  async function restore() {
    try { const saved = await restoreClient(client.id, client.organization_id); setClient((current) => ({ ...current, ...saved })); }
    catch (reason) { setError(reason.message); }
  }

  if (loading) return <Page><div className="client-profile-loading">Cargando expediente…</div></Page>;
  if (!client) return <Page><div className="clients-error"><p>{error || "Cliente no disponible."}</p><button onClick={() => navigate("/clientes")}>Volver a clientes</button></div></Page>;

  const actions = {
    client, canManage: canManageUsers, onOpen: undefined, onEdit: () => setEditorOpen(true),
    onArchive: archive, onRestore: restore, onDelete: () => setDeleteOpen(true),
  };
  const invitationPending = client.portalInvitation?.status === "pending";
  const canInvite = role === "founder" && isInternalOrganization && !client.portal_enabled && !invitationPending;

  return (
    <Page className="client-profile-v2">
      <button onClick={() => navigate("/clientes")} className="client-profile-back"><ArrowLeft size={17} />Volver a clientes</button>
      <header className="client-profile-header"><div><p>Expediente empresarial</p><h1>{client.company_name}</h1><span>{client.contact_name || "Contacto pendiente"} · {client.industry || "Industria pendiente"}</span></div><div className="client-profile-header-actions"><span className="client-status-badge">{STATUS_LABELS[client.status] || client.status}</span><ClientActionsMenu {...actions} /></div></header>
      {error && <p className="clients-error" role="alert">{error}</p>}
      {client.contextPartial && <p className="clients-partial" role="status">Parte del contexto de Discovery, proyectos o portal no está disponible ahora.</p>}

      <section className="client-metrics" aria-label="Estado resumido del cliente">
        <Metric icon={Target} label="ORVESEN Score" value="Sin evaluación" detail="Este cliente aún no tiene un Score disponible." />
        <Metric icon={ClipboardCheck} label="Discovery" value={DISCOVERY_LABELS[client.discoveryStatus] || "Sin Discovery"} detail={client.discoveryCount ? `${client.discoveryCount} evaluaciones` : "Sin evidencia registrada"} />
        <Metric icon={FolderKanban} label="Proyectos" value={client.activeProjectCount || 0} detail={client.projectCount ? `${client.projectCount} proyectos en total` : "Sin proyectos"} />
        <Metric icon={Building2} label="Relación" value={STATUS_LABELS[client.status] || client.status} detail="Estado actual del expediente" />
      </section>

      <section className="client-profile-grid">
        <Card hover={false} contentClassName="client-section-content"><SectionTitle eyebrow="Contexto" title="Requiere atención" />{context.attention.length ? <div className="client-attention-list">{context.attention.map((item) => <article key={item.id}><CheckCircle2 size={17} /><div><strong>{item.title}</strong><p>{item.description}</p>{item.to && <Link to={item.to}>{item.action}</Link>}{item.actionId === "edit" && <button onClick={() => setEditorOpen(true)}>Completar información</button>}{item.actionId === "portal" && <button onClick={() => document.getElementById("client-portal")?.scrollIntoView({ behavior: "smooth", block: "center" })}>Ver portal del cliente</button>}</div></article>)}</div> : <p className="client-section-empty">No hay acciones básicas pendientes con la evidencia disponible.</p>}</Card>
        <Card hover={false} contentClassName="client-section-content"><SectionTitle eyebrow="Empresa" title="Datos del negocio" /> <div className="client-info-grid"><Info icon={Building2} label="Contacto" value={client.contact_name} /><Info icon={Mail} label="Correo" value={client.email} /><Info icon={Phone} label="Teléfono" value={client.phone} /><Info icon={Globe} label="Sitio web" value={client.website} /></div></Card>
      </section>

      <section className="client-profile-grid">
        <Card hover={false} contentClassName="client-section-content"><SectionTitle eyebrow="Ejecución" title="Proyectos relacionados" />{client.projects.length ? <div className="client-project-list">{client.projects.slice(0, 4).map((project) => <Link key={project.id} to={`/proyectos/${project.id}`}><div><strong>{project.name}</strong><span>{STATUS_LABELS[project.status] || project.status}</span></div><small>{project.due_at ? new Date(project.due_at).toLocaleDateString("es-ES") : "Sin fecha límite"}</small></Link>)}</div> : <p className="client-section-empty">Este cliente todavía no tiene proyectos vinculados.</p>}</Card>
        <Card hover={false} contentClassName="client-section-content"><span id="client-portal" aria-hidden="true" /><SectionTitle eyebrow="Acceso" title="Portal del cliente" /><div className="client-portal-state"><ShieldCheck size={22} /><div><strong>{client.portal_enabled ? "Portal activo" : invitationPending ? "Invitación pendiente" : "Portal inactivo"}</strong><p>{client.portal_enabled ? "El cliente dispone de un espacio privado de ORVESEN." : invitationPending ? `La invitación fue enviada a ${client.portalInvitation.email}.` : "Todavía no se ha activado acceso para este cliente."}</p></div></div>{canInvite && <button className="client-inline-action" onClick={() => setInviteOpen(true)}>Invitar al portal</button>}</Card>
      </section>

      <Card hover={false} contentClassName="client-section-content"><SectionTitle eyebrow="Contexto humano" title="Notas del cliente" icon={MessageSquarePlus} /><form onSubmit={addNote} className="client-note-form"><textarea value={note} onChange={(event) => setNote(event.target.value)} rows="3" maxLength="3000" placeholder="Seguimiento, acuerdo o información importante…" /><button disabled={saving || !note.trim()}>{saving ? "Guardando…" : "Guardar nota"}</button></form><div className="client-note-list">{notes.map((item) => <article key={item.id}><p>{item.content}</p><footer><span>{item.author?.first_name || "Miembro del equipo"}</span><time>{new Date(item.created_at).toLocaleString("es-ES", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</time></footer></article>)}{!notes.length && <p className="client-section-empty">Todavía no hay notas en este expediente.</p>}</div></Card>

      {editorOpen && <ClientEditorModal client={client} organizationId={organization.id} userId={user.id} onClose={() => setEditorOpen(false)} onSaved={(saved) => setClient((current) => ({ ...current, ...saved }))} />}
      {deleteOpen && <ClientDeleteModal client={client} onClose={() => setDeleteOpen(false)} onDeleted={() => navigate("/clientes")} onArchive={archive} />}
      {inviteOpen && <InviteClientModal client={client} onClose={() => setInviteOpen(false)} onInvited={loadProfile} />}
    </Page>
  );
}

function buildClientContext(client) {
  if (!client) return { attention: [] };
  const attention = [];
  const missing = [client.contact_name, client.email, client.phone, client.website, client.industry].filter((value) => !value).length;
  if (!client.latestDiscovery) attention.push({ id: "discovery", title: "Discovery pendiente", description: "No existe evidencia Discovery vinculada a este cliente.", action: "Iniciar Discovery", to: "/discovery" });
  else if (client.latestDiscovery.status === "in_progress") attention.push({ id: "discovery", title: "Discovery en progreso", description: "La evaluación puede continuar desde la última respuesta guardada.", action: "Continuar evaluación", to: `/discovery/evaluaciones/${client.latestDiscovery.id}` });
  if (missing) attention.push({ id: "profile", title: "Perfil incompleto", description: `${missing} ${missing === 1 ? "dato importante está pendiente" : "datos importantes están pendientes"}.`, actionId: "edit" });
  const overdue = client.projects.flatMap((project) => project.project_tasks || []).filter((task) => ["pending", "in_progress", "blocked"].includes(task.status) && task.due_at && new Date(task.due_at) < new Date()).length;
  if (overdue) attention.push({ id: "tasks", title: `${overdue} ${overdue === 1 ? "tarea vencida" : "tareas vencidas"}`, description: "Hay trabajo relacionado que superó su fecha límite.", action: "Revisar proyectos", to: "/proyectos" });
  if (!client.portal_enabled) attention.push({ id: "portal", title: "Portal inactivo", description: "El cliente todavía no dispone de acceso a su espacio privado.", actionId: "portal" });
  return { attention: attention.slice(0, 4) };
}

function Metric({ icon: Icon, label, value, detail }) { return <Card hover={false} contentClassName="client-metric"><div><p>{label}</p><Icon size={16} /></div><strong>{value}</strong><span>{detail}</span></Card>; }
function Info({ icon: Icon, label, value }) { return <div className="client-info"><Icon size={17} /><div><span>{label}</span><strong>{value || "Pendiente"}</strong></div></div>; }
function SectionTitle({ eyebrow, title, icon: Icon }) { return <div className="client-section-title"><div><p>{eyebrow}</p><h2>{title}</h2></div>{Icon && <Icon size={19} />}</div>; }

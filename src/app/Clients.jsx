import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Building2, Columns3, LayoutGrid, List, Search } from "lucide-react";

import Page from "../components/ui/Page";
import PageHeader from "../components/ui/PageHeader";
import Button from "../components/ui/Button";
import ClientActionsMenu from "../features/clients/components/ClientActionsMenu";
import ClientDeleteModal from "../features/clients/components/ClientDeleteModal";
import ClientEditorModal from "../features/clients/components/ClientEditorModal";
import { archiveClient, getClients, restoreClient } from "../services/ClientService";
import { useOrganization } from "../Context/OrganizationContext";
import { useAuth } from "../Context/AuthContext";
import "./Clients.css";

const VIEWS = [
  { id: "cards", label: "Tarjetas", icon: LayoutGrid },
  { id: "list", label: "Lista", icon: List },
  { id: "pipeline", label: "Pipeline", icon: Columns3 },
];
const STATUS_LABELS = { lead: "Lead", active: "Activo", activo: "Activo", paused: "Pausado", pausado: "Pausado", closed: "Cerrado", cerrado: "Cerrado", archived: "Archivado" };
const DISCOVERY_LABELS = { draft: "Borrador", in_progress: "En progreso", completed: "Completado", abandoned: "Abandonado" };

const labelStatus = (status) => STATUS_LABELS[String(status || "lead").toLowerCase()] || status || "Sin estado";
const labelDiscovery = (status) => DISCOVERY_LABELS[status] || "Sin Discovery";

export default function Clients() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { organization } = useOrganization();
  const { user, canManageUsers } = useAuth();
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editor, setEditor] = useState(() => searchParams.get("new") === "1" ? { mode: "create" } : null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [lifecycle, setLifecycle] = useState("active");
  const [view, setView] = useState(() => localStorage.getItem("orvesen-client-view") || "cards");
  useEffect(() => {
    if (searchParams.get("new") !== "1") return;
    setSearchParams({}, { replace: true });
  }, [searchParams, setSearchParams]);

  useEffect(() => {
    let active = true;
    if (!organization?.id) return undefined;
    Promise.resolve().then(() => {
      if (!active) return null;
      setLoading(true);
      setError("");
      return getClients(organization.id);
    })
      .then((data) => active && setClients(data))
      .catch(() => active && setError("No se pudieron cargar los clientes."))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [organization?.id]);

  const statuses = useMemo(() => [...new Set(clients.filter((client) => client.status !== "archived").map((client) => client.status).filter(Boolean))], [clients]);
  const visibleClients = useMemo(() => clients.filter((client) => {
    const archived = client.status === "archived";
    if (lifecycle === "active" && archived) return false;
    if (lifecycle === "archived" && !archived) return false;
    if (lifecycle !== "archived" && status !== "all" && client.status !== status) return false;
    const term = search.trim().toLowerCase();
    const haystack = [client.company_name, client.contact_name, client.email, client.phone, client.industry].filter(Boolean).join(" ").toLowerCase();
    return !term || haystack.includes(term);
  }), [clients, lifecycle, search, status]);

  function changeView(nextView) {
    setView(nextView);
    localStorage.setItem("orvesen-client-view", nextView);
  }

  function mergeClient(saved) {
    setClients((current) => {
      const existing = current.find((client) => client.id === saved.id);
      return existing ? current.map((client) => client.id === saved.id ? { ...client, ...saved } : client) : [saved, ...current];
    });
  }

  async function archive(target) {
    try { mergeClient(await archiveClient(target.id, organization.id)); }
    catch (reason) { setError(reason.message || "No se pudo archivar el cliente."); }
  }

  async function restore(target) {
    try { mergeClient(await restoreClient(target.id, organization.id)); }
    catch (reason) { setError(reason.message || "No se pudo restaurar el cliente."); }
  }

  const actions = (client) => ({
    client, canManage: canManageUsers,
    onOpen: () => navigate(`/clientes/${client.id}`),
    onEdit: () => setEditor({ mode: "edit", client }),
    onArchive: archive, onRestore: restore, onDelete: setDeleteTarget,
  });

  return (
    <Page className="clients-v2">
      <div className="clients-header"><PageHeader eyebrow="CLIENTES" title="Expedientes empresariales" description={`${clients.length} ${clients.length === 1 ? "cliente registrado" : "clientes registrados"}`} /><Button onClick={() => setEditor({ mode: "create" })}>+ Nuevo cliente</Button></div>

      <section className="clients-toolbar" aria-label="Buscar y filtrar clientes">
        <label className="clients-search"><Search size={17} /><span className="sr-only">Buscar clientes</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar empresa, contacto o correo" /></label>
        <div className="clients-filter-group">
          <select aria-label="Estado del expediente" value={lifecycle} onChange={(event) => setLifecycle(event.target.value)}><option value="active">Activos</option><option value="archived">Archivados</option><option value="all">Todos</option></select>
          <select aria-label="Estado comercial" value={status} disabled={lifecycle === "archived"} onChange={(event) => setStatus(event.target.value)}><option value="all">Todos los estados</option>{statuses.map((item) => <option key={item} value={item}>{labelStatus(item)}</option>)}</select>
          <div className="clients-view-switch">{VIEWS.map(({ id, label, icon: Icon }) => <button key={id} type="button" onClick={() => changeView(id)} title={label} aria-label={`Vista ${label}`} aria-pressed={view === id} className={view === id ? "is-active" : ""}><Icon size={16} /></button>)}</div>
        </div>
      </section>

      {loading && <ClientsSkeleton />}
      {error && <p className="clients-error" role="alert">{error}</p>}
      {!loading && !error && visibleClients.length === 0 && <EmptyState hasClients={clients.length > 0} lifecycle={lifecycle} />}
      {!loading && view === "cards" && <div className="clients-card-grid">{visibleClients.map((client) => <ClientCard key={client.id} client={client} actions={actions(client)} />)}</div>}
      {!loading && view === "list" && visibleClients.length > 0 && <ClientList clients={visibleClients} actions={actions} />}
      {!loading && view === "pipeline" && visibleClients.length > 0 && <ClientPipeline clients={visibleClients} actions={actions} />}

      {editor && <ClientEditorModal client={editor.client} organizationId={organization.id} userId={user.id} onClose={() => setEditor(null)} onSaved={mergeClient} />}
      {deleteTarget && <ClientDeleteModal client={deleteTarget} onClose={() => setDeleteTarget(null)} onDeleted={(target) => setClients((current) => current.filter((client) => client.id !== target.id))} onArchive={archive} />}
    </Page>
  );
}

function ClientCard({ client, actions }) {
  return <article className="client-card"><a href={`/clientes/${client.id}`} onClick={(event) => { event.preventDefault(); actions.onOpen(); }} className="client-card-link" aria-label={`Abrir expediente de ${client.company_name}`}><div className="client-card-heading"><div><h2>{client.company_name}</h2><p>{client.contact_name || "Contacto pendiente"}</p></div><span>{labelStatus(client.status)}</span></div><div className="client-card-contact"><p>{client.email || "Sin correo"}</p><p>{client.phone || "Sin teléfono"}</p></div><dl className="client-card-context"><div><dt>Discovery</dt><dd>{client.contextPartial ? "No disponible" : labelDiscovery(client.discoveryStatus)}</dd></div><div><dt>Proyectos</dt><dd>{client.contextPartial ? "No disponible" : client.activeProjectCount ? `${client.activeProjectCount} activos` : "Sin proyectos activos"}</dd></div></dl></a><ClientActionsMenu {...actions} /></article>;
}

function ClientList({ clients, actions }) {
  return <div className="clients-list"><div className="clients-list-head"><span>Cliente</span><span>Contacto</span><span>Estado</span><span>Discovery</span><span>Proyectos</span><span /></div>{clients.map((client) => <div className="clients-list-row" key={client.id}><button type="button" onClick={actions(client).onOpen}><strong>{client.company_name}</strong><small>{client.industry || "Industria pendiente"}</small></button><div className="clients-list-contact"><span>{client.contact_name || "Sin contacto"}</span>{client.phone && <small>{client.phone}</small>}</div><span>{labelStatus(client.status)}</span><span>{labelDiscovery(client.discoveryStatus)}</span><span>{client.projectCount || "Sin proyectos"}</span><ClientActionsMenu {...actions(client)} /></div>)}</div>;
}

function ClientPipeline({ clients, actions }) {
  const columns = [...new Set(clients.map((client) => client.status || "lead"))];
  return <div className="clients-pipeline">{columns.map((pipelineStatus) => { const group = clients.filter((client) => client.status === pipelineStatus); return <section key={pipelineStatus}><header><h2>{labelStatus(pipelineStatus)}</h2><span>{group.length}</span></header><div>{group.map((client) => <article key={client.id}><button type="button" onClick={actions(client).onOpen}><strong>{client.company_name}</strong><small>{client.contact_name || "Sin contacto"}</small></button><ClientActionsMenu {...actions(client)} /></article>)}{!group.length && <p>Sin clientes</p>}</div></section>; })}</div>;
}

function EmptyState({ hasClients, lifecycle }) {
  return <div className="clients-empty"><Building2 size={24} /><h2>{hasClients ? lifecycle === "archived" ? "No hay clientes archivados" : "No hay coincidencias" : "Aún no tienes clientes"}</h2><p>{hasClients ? "Ajusta la búsqueda o los filtros para continuar." : "Crea el primer expediente empresarial para comenzar."}</p></div>;
}

function ClientsSkeleton() { return <div className="clients-card-grid" aria-label="Cargando clientes">{[0, 1, 2].map((item) => <div key={item} className="client-card client-card-skeleton" />)}</div>; }

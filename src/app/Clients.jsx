import { useEffect, useMemo, useState } from "react";
import { Columns3, LayoutGrid, List, Search } from "lucide-react";

import Page from "../components/ui/Page";
import PageHeader from "../components/ui/PageHeader";
import Card from "../components/ui/Card";
import Button from "../components/ui/Button";
import CreateClientModal from "./Clients/CreateClientModal";
import { getClients } from "../services/ClientService";
import { useOrganization } from "../Context/OrganizationContext";

const views = [
  { id: "cards", label: "Tarjetas", icon: LayoutGrid },
  { id: "list", label: "Lista", icon: List },
  { id: "pipeline", label: "Pipeline", icon: Columns3 },
];

const statusLabels = {
  lead: "Lead",
  active: "Activo",
  activo: "Activo",
  paused: "Pausado",
  pausado: "Pausado",
  closed: "Cerrado",
  cerrado: "Cerrado",
};

function labelStatus(status) {
  return statusLabels[String(status || "lead").toLowerCase()] || status || "Sin estado";
}

function ClientCard({ client }) {
  return (
    <Card contentClassName="p-5 sm:p-6">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="truncate text-lg font-semibold text-white">{client.company_name}</h2>
          <p className="mt-1 truncate text-sm text-zinc-400">{client.contact_name || "Sin contacto"}</p>
        </div>
        <span className="shrink-0 rounded-full bg-zinc-800 px-3 py-1 text-xs text-zinc-300">
          {labelStatus(client.status)}
        </span>
      </div>
      <div className="mt-5 grid gap-1 text-sm text-zinc-500">
        <p className="truncate">{client.email || "Sin correo"}</p>
        <p>{client.phone || "Sin teléfono"}</p>
      </div>
      <div className="mt-5 flex items-center justify-between border-t border-zinc-800 pt-4 text-xs text-zinc-500">
        <span>{client.industry || "Sin industria"}</span>
        <span>{client.score > 0 ? `Score ${client.score}` : "Sin evaluación"}</span>
      </div>
    </Card>
  );
}

export default function Clients() {
  const { organization } = useOrganization();
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [openModal, setOpenModal] = useState(false);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [view, setView] = useState(() => localStorage.getItem("orvesen-client-view") || "cards");

  useEffect(() => {
    let active = true;

    async function loadClients() {
      if (!organization?.id) {
        setLoading(false);
        return;
      }

      try {
        setLoading(true);
        setError("");
        const data = await getClients(organization.id);
        if (active) setClients(data);
      } catch (loadError) {
        console.error(loadError);
        if (active) setError("No se pudieron cargar los clientes.");
      } finally {
        if (active) setLoading(false);
      }
    }

    loadClients();
    return () => {
      active = false;
    };
  }, [organization?.id]);

  const statuses = useMemo(
    () => [...new Set(clients.map((client) => client.status).filter(Boolean))],
    [clients],
  );

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return clients.filter((client) => {
      const matchesStatus = status === "all" || client.status === status;
      const haystack = [client.company_name, client.contact_name, client.email, client.phone, client.industry]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return matchesStatus && (!term || haystack.includes(term));
    });
  }, [clients, search, status]);

  function changeView(nextView) {
    setView(nextView);
    localStorage.setItem("orvesen-client-view", nextView);
  }

  function handleCreated(client) {
    setClients((previous) => [client, ...previous]);
  }

  return (
    <Page className="space-y-6 lg:space-y-7">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <PageHeader
          eyebrow="CLIENTES"
          title="Gestión de clientes"
          description={`${clients.length} ${clients.length === 1 ? "cliente registrado" : "clientes registrados"}`}
        />
        <Button onClick={() => setOpenModal(true)} className="w-full sm:w-auto">+ Nuevo cliente</Button>
      </div>

      <section className="flex flex-col gap-3 rounded-2xl border border-zinc-800 bg-[#111113] p-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 flex-1 items-center gap-3 rounded-xl border border-zinc-800 bg-zinc-950 px-4 py-3">
          <Search size={17} className="shrink-0 text-zinc-500" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Buscar empresa, contacto o correo"
            className="min-w-0 flex-1 bg-transparent text-sm text-white outline-none placeholder:text-zinc-600"
          />
        </div>

        <div className="flex gap-2 overflow-x-auto">
          <select value={status} onChange={(event) => setStatus(event.target.value)} className="rounded-xl border border-zinc-800 bg-zinc-950 px-3 text-sm text-zinc-300 outline-none">
            <option value="all">Todos los estados</option>
            {statuses.map((item) => <option key={item} value={item}>{labelStatus(item)}</option>)}
          </select>
          <div className="flex rounded-xl border border-zinc-800 bg-zinc-950 p-1">
            {views.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                onClick={() => changeView(id)}
                title={label}
                aria-label={`Vista ${label}`}
                className={`flex h-9 w-9 items-center justify-center rounded-lg transition ${view === id ? "bg-white text-black" : "text-zinc-500 hover:text-white"}`}
              >
                <Icon size={16} />
              </button>
            ))}
          </div>
        </div>
      </section>

      {loading && <p className="text-sm text-zinc-500">Cargando clientes…</p>}
      {error && <p className="rounded-xl border border-red-900/50 bg-red-950/20 p-4 text-sm text-red-300">{error}</p>}

      {!loading && !error && filtered.length === 0 && (
        <Card contentClassName="p-8 text-center">
          <h3 className="text-lg font-semibold text-white">{clients.length ? "No hay coincidencias" : "No tienes clientes todavía"}</h3>
          <p className="mt-2 text-sm text-zinc-500">{clients.length ? "Prueba otra búsqueda o filtro." : "Crea tu primer cliente para comenzar."}</p>
        </Card>
      )}

      {!loading && view === "cards" && (
        <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
          {filtered.map((client) => <ClientCard key={client.id} client={client} />)}
        </div>
      )}

      {!loading && view === "list" && filtered.length > 0 && (
        <div className="overflow-hidden rounded-2xl border border-zinc-800 bg-[#111113]">
          <div className="hidden grid-cols-[1.3fr_1fr_1.3fr_.7fr_.6fr] gap-4 border-b border-zinc-800 px-5 py-3 text-xs uppercase tracking-wider text-zinc-600 md:grid">
            <span>Empresa</span><span>Contacto</span><span>Correo</span><span>Estado</span><span>Score</span>
          </div>
          {filtered.map((client) => (
            <div key={client.id} className="grid gap-2 border-b border-zinc-800 px-5 py-4 last:border-0 md:grid-cols-[1.3fr_1fr_1.3fr_.7fr_.6fr] md:items-center md:gap-4">
              <p className="font-medium text-white">{client.company_name}</p>
              <p className="text-sm text-zinc-400">{client.contact_name || "Sin contacto"}</p>
              <p className="truncate text-sm text-zinc-500">{client.email || "Sin correo"}</p>
              <span className="w-fit rounded-full bg-zinc-800 px-3 py-1 text-xs text-zinc-300">{labelStatus(client.status)}</span>
              <p className="text-sm text-zinc-400">{client.score > 0 ? client.score : "—"}</p>
            </div>
          ))}
        </div>
      )}

      {!loading && view === "pipeline" && filtered.length > 0 && (
        <div className="grid gap-4 overflow-x-auto pb-2 lg:grid-cols-4">
          {(statuses.length ? statuses : ["lead"]).map((pipelineStatus) => {
            const group = filtered.filter((client) => client.status === pipelineStatus);
            return (
              <section key={pipelineStatus} className="min-w-[260px] rounded-2xl border border-zinc-800 bg-[#111113] p-3">
                <div className="flex items-center justify-between px-2 py-2">
                  <h2 className="text-sm font-semibold text-white">{labelStatus(pipelineStatus)}</h2>
                  <span className="text-xs text-zinc-500">{group.length}</span>
                </div>
                <div className="mt-2 space-y-3">
                  {group.map((client) => (
                    <div key={client.id} className="rounded-xl border border-zinc-800 bg-zinc-950 p-4">
                      <p className="font-medium text-white">{client.company_name}</p>
                      <p className="mt-1 text-sm text-zinc-500">{client.contact_name || "Sin contacto"}</p>
                    </div>
                  ))}
                  {group.length === 0 && <p className="px-2 py-4 text-sm text-zinc-600">Sin clientes</p>}
                </div>
              </section>
            );
          })}
        </div>
      )}

      {openModal && (
        <CreateClientModal
          organizationId={organization?.id}
          onCreated={handleCreated}
          onClose={() => setOpenModal(false)}
        />
      )}
    </Page>
  );
}

import { useNavigate } from "react-router-dom";
import { Brain, CalendarDays, ClipboardCheck, Clock, FolderKanban, Users } from "lucide-react";

import Page from "../components/ui/Page";
import PageHeader from "../components/ui/PageHeader";
import Card from "../components/ui/Card";
import CompanyScoreOverview from "../components/business/CompanyScoreOverview";
import MetricCard from "../components/business/MetricCard";
import ActivityTimeline from "../components/business/ActivityTimeline";
import { useAuth } from "../Context/AuthContext";
import useDashboardData from "../hooks/useDashboardData";
import useCompanyScore from "../hooks/useCompanyScore";

function valueOf(source) {
  if (!source || source.unavailable) return "—";
  return source.count ?? 0;
}

export default function Dashboard() {
  const navigate = useNavigate();
  const { displayName, displayTitle, isInternalOrganization } = useAuth();
  const { data: dashboard, loading: dashboardLoading } = useDashboardData();
  const { data: companyScore, loading: scoreLoading, error: scoreError } = useCompanyScore();
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Buenos días" : hour < 19 ? "Buenas tardes" : "Buenas noches";
  const today = new Intl.DateTimeFormat("es", {
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(new Date());

  const metrics = [
    { title: "Clientes", value: valueOf(dashboard?.clients), subtitle: "Registrados", icon: Users },
    { title: "Proyectos", value: valueOf(dashboard?.projects), subtitle: "Registrados", icon: FolderKanban },
    { title: "Discovery", value: valueOf(dashboard?.discoveries), subtitle: "Evaluaciones", icon: Brain },
    { title: "Playbooks", value: valueOf(dashboard?.playbooks), subtitle: "Documentados", icon: ClipboardCheck },
  ];

  return (
    <Page className="space-y-4 sm:space-y-5 lg:space-y-6">
      <section className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
        <PageHeader
          eyebrow={displayTitle}
          title={`${greeting}, ${displayName}.`}
          description="Resumen actual de tu organización."
          compact
        />
        <div className="justify-self-end text-right">
          <p className="text-xs capitalize text-zinc-500">{today}</p>
        </div>
      </section>

      <CompanyScoreOverview
        data={companyScore}
        loading={scoreLoading}
        error={scoreError}
        onEvaluate={() => navigate(isInternalOrganization ? "/discovery" : "/business-score")}
      />

      <section className="space-y-3" aria-labelledby="dashboard-operation-title">
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-zinc-500">Operación</p>
          <h2 id="dashboard-operation-title" className="mt-1.5 text-lg font-semibold text-white">Actividad de la organización</h2>
        </div>
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 xl:grid-cols-4">
          {metrics.map((metric) => (
            <MetricCard key={metric.title} {...metric} loading={dashboardLoading} compact />
          ))}
        </div>
      </section>

      <section className="space-y-3" aria-labelledby="dashboard-action-title">
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-zinc-500">Acción</p>
          <h2 id="dashboard-action-title" className="mt-1.5 text-lg font-semibold text-white">Siguientes movimientos</h2>
        </div>
        <div className="grid gap-4 xl:grid-cols-2">
        <Card glow contentClassName="p-4 sm:p-5">
          <p className="text-xs uppercase tracking-[0.3em] text-zinc-500">ORVESEN IA</p>
          <h2 className="mt-2 text-xl font-semibold text-white">Prioridades reales</h2>
          <div className="mt-4 rounded-xl border border-dashed border-zinc-800 p-4">
            <p className="text-sm text-zinc-400">Aún no hay recomendaciones calculadas.</p>
            <p className="mt-2 text-sm leading-6 text-zinc-500">Las prioridades aparecerán cuando exista evidencia suficiente para analizarlas.</p>
          </div>
        </Card>

          <Card hover={false} contentClassName="p-4 sm:p-5">
            <div className="flex items-center justify-between gap-3"><div><p className="text-xs uppercase tracking-[0.3em] text-zinc-500">Agenda</p><h2 className="mt-2 text-xl font-semibold text-white">Próximos recordatorios</h2></div><button onClick={() => navigate("/calendario")} className="calendar-icon-button"><CalendarDays size={18} /></button></div>
            {dashboard?.upcomingEvents?.length ? <div className="mt-4 grid gap-3">{dashboard.upcomingEvents.map((event) => <button key={event.id} onClick={() => navigate("/calendario")} className="rounded-xl border border-zinc-800 bg-zinc-900/70 p-4 text-left"><p className="font-medium text-white">{event.title}</p><p className="mt-2 flex items-center gap-2 text-sm text-zinc-400"><Clock size={15} /> {new Date(event.starts_at).toLocaleString("es-ES", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</p></button>)}</div> : <div className="mt-4 rounded-xl border border-dashed border-zinc-800 p-4"><p className="text-sm text-zinc-400">No tienes recordatorios próximos.</p><button onClick={() => navigate("/calendario")} className="mt-3 text-sm font-medium text-white underline underline-offset-4">Crear un evento</button></div>}
          </Card>
        </div>

        <ActivityTimeline activities={dashboard?.activities || []} />
      </section>
    </Page>
  );
}

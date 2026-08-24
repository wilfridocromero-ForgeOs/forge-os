import { Link, useNavigate } from "react-router-dom";
import { AlertTriangle, ArrowRight, Brain, CalendarDays, CheckCircle2, CircleAlert, Clock3, FolderKanban, Users } from "lucide-react";

import Page from "../components/ui/Page";
import Card from "../components/ui/Card";
import CompanyScoreOverview from "../components/business/CompanyScoreOverview";
import ActivityTimeline from "../components/business/ActivityTimeline";
import { useAuth } from "../Context/AuthContext";
import useDashboardData from "../hooks/useDashboardData";
import { buildAttentionItems, buildDashboardBriefing, buildDayHeading, buildDayItems } from "../features/dashboard/dashboardViewModel";
import "./Dashboard.css";

const DAY_STATUS = {
  overdue: { label: "Vencida", className: "is-overdue" },
  today: { label: "Hoy", className: "is-today" },
  event: { label: "Evento", className: "is-event" },
};

function greetingAt(date) {
  const hour = date.getHours();
  return hour < 12 ? "Buenos días" : hour < 19 ? "Buenas tardes" : "Buenas noches";
}

function readableDate(value) {
  if (!value) return "Sin hora";
  return new Intl.DateTimeFormat("es-ES", { hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function countValue(source, fallback = 0) {
  if (!source?.available) return null;
  return source.count ?? fallback;
}

export default function Dashboard() {
  const navigate = useNavigate();
  const { displayName, isInternalOrganization, organization } = useAuth();
  const { data: dashboard, loading, error } = useDashboardData();
  const now = new Date();
  const scorePath = isInternalOrganization ? "/orvesen-score" : "/business-score";
  const evaluationPath = isInternalOrganization ? "/discovery" : "/business-score";
  const attention = buildAttentionItems(dashboard, { scorePath, evaluationPath });
  const dayItems = buildDayItems(dashboard);
  const attentionIncomplete = dashboard && [dashboard.tasks, dashboard.discovery, dashboard.score].some((source) => source?.available === false);
  const dayIncomplete = dashboard && [dashboard.tasks, dashboard.calendar].some((source) => source?.available === false);
  const failedSources = dashboard ? Object.entries(dashboard)
    .filter(([, value]) => value && typeof value === "object" && value.available === false)
    .map(([key]) => key) : [];
  const todayLabel = new Intl.DateTimeFormat("es-ES", { weekday: "long", day: "numeric", month: "long" }).format(now);
  const operations = [
    { label: "Clientes", value: countValue(dashboard?.clients), icon: Users, to: "/clientes" },
    { label: "Proyectos activos", value: countValue(dashboard?.projects), icon: FolderKanban, to: "/proyectos" },
    { label: "Tareas activas", value: dashboard?.tasks?.available ? dashboard.tasks.activeCount : null, icon: CheckCircle2, to: "/proyectos" },
    { label: "Evaluaciones pendientes", value: dashboard?.discovery?.available ? dashboard.discovery.pendingCount : null, icon: Brain, to: evaluationPath },
  ];

  return (
    <Page className="dashboard-v2">
      <header className="dashboard-briefing">
        <div className="min-w-0">
          <p className="dashboard-kicker">{organization?.name || "Tu organización"}</p>
          <h1>{greetingAt(now)}, {displayName}</h1>
          <p>{loading ? "Preparando tu resumen ejecutivo…" : buildDashboardBriefing(dashboard)}</p>
        </div>
        <div className="dashboard-date"><CalendarDays size={16} /><span>{todayLabel}</span></div>
      </header>

      {error && <div className="dashboard-global-error" role="alert"><CircleAlert size={18} /><div><strong>No pudimos cargar el Dashboard.</strong><span>Vuelve a intentarlo en unos instantes.</span></div></div>}
      {!loading && failedSources.length > 0 && <div className="dashboard-partial-note" role="status"><AlertTriangle size={17} /><span>Algunos datos no están disponibles ahora. El resto del resumen sigue actualizado.</span></div>}

      <CompanyScoreOverview
        data={dashboard?.score?.data}
        loading={loading}
        error={dashboard?.score?.available === false ? dashboard.score.error : null}
        detailPath={scorePath}
        onEvaluate={() => navigate(evaluationPath)}
      />

      <section className="dashboard-command-grid" aria-label="Prioridades y agenda de hoy">
        <Card hover={false} className="dashboard-attention-card" contentClassName="dashboard-section-card">
          <SectionHeading eyebrow="Prioridad" title="Lo que requiere tu atención" description="Ordenado por urgencia y evidencia disponible." />
          {loading ? <DashboardSkeleton rows={3} /> : attention.length ? <div className="dashboard-attention-list">{attention.map((item) => <AttentionItem key={item.id} item={item} />)}</div> : attentionIncomplete ? <EmptyState title="Resumen de atención incompleto">Alguna fuente necesaria no está disponible. No asumimos que todo esté al día.</EmptyState> : <EmptyState title="No hay alertas operativas">No detectamos acciones urgentes con los datos disponibles.</EmptyState>}
        </Card>

        <Card hover={false} className="dashboard-day-card" contentClassName="dashboard-section-card">
          <SectionHeading eyebrow="Tu día" title={loading ? "Preparando tu día…" : buildDayHeading(dashboard)} description="Tu trabajo asignado y tu agenda de hoy." action={{ label: "Ver calendario", to: "/calendario" }} />
          {loading ? <DashboardSkeleton rows={3} /> : dayItems.length ? <div className="dashboard-day-list">{dayItems.map((item) => <DayItem key={item.id} item={item} />)}</div> : dayIncomplete ? <EmptyState title="Agenda parcialmente disponible">No podemos confirmar todo tu trabajo de hoy hasta recuperar las fuentes pendientes.</EmptyState> : <EmptyState title="Sin trabajo programado">No tienes tareas asignadas ni eventos para hoy.</EmptyState>}
        </Card>
      </section>

      <section aria-labelledby="dashboard-operation-title">
        <SectionHeading eyebrow="Operación" title="Pulso operativo" description="Métricas reales de los módulos activos." />
        <div className="dashboard-operation-grid">{operations.map((metric) => <OperationMetric key={metric.label} metric={metric} loading={loading} />)}</div>
      </section>

      <section aria-labelledby="dashboard-activity-title">
        <ActivityTimeline activities={dashboard?.activity?.items || []} loading={loading} unavailable={dashboard?.activity?.available === false} />
      </section>
    </Page>
  );
}

function SectionHeading({ eyebrow, title, description, action }) {
  return <div className="dashboard-section-heading"><div><p>{eyebrow}</p><h2>{title}</h2>{description && <span>{description}</span>}</div>{action && <Link to={action.to}>{action.label}<ArrowRight size={14} /></Link>}</div>;
}

function AttentionItem({ item }) {
  const Icon = item.tone === "critical" ? CircleAlert : item.tone === "positive" ? CheckCircle2 : AlertTriangle;
  return <article className={`dashboard-attention-item is-${item.tone}`}><Icon size={19} aria-hidden="true" /><div><h3>{item.title}</h3><p>{item.description}</p><Link to={item.to}>{item.action}<ArrowRight size={14} /></Link></div></article>;
}

function DayItem({ item }) {
  const status = DAY_STATUS[item.status] || DAY_STATUS.today;
  return <Link className="dashboard-day-item" to={item.to}><div className={`dashboard-day-marker ${status.className}`} aria-hidden="true" /><div className="min-w-0"><h3>{item.title}</h3><p>{item.context} · {readableDate(item.date)}</p></div><span className={status.className}>{status.label}</span></Link>;
}

function OperationMetric({ metric, loading }) {
  const Icon = metric.icon;
  return <Link className="dashboard-operation-metric" to={metric.to}><div><Icon size={17} /><span>{metric.label}</span></div><strong>{loading ? "…" : metric.value == null ? "No disponible" : metric.value}</strong><ArrowRight size={15} /></Link>;
}

function EmptyState({ title, children }) {
  return <div className="dashboard-empty"><Clock3 size={20} /><strong>{title}</strong><p>{children}</p></div>;
}

function DashboardSkeleton({ rows }) {
  return <div className="dashboard-skeleton" aria-label="Cargando"><span />{Array.from({ length: rows }, (_, index) => <span key={index} />)}</div>;
}

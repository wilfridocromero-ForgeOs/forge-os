import { useNavigate } from "react-router-dom";
import { Brain, ClipboardCheck, FolderKanban, Users } from "lucide-react";

import Page from "../components/ui/Page";
import PageHeader from "../components/ui/PageHeader";
import Card from "../components/ui/Card";
import OrvesenScore from "../components/business/OrvesenScore";
import MetricCard from "../components/business/MetricCard";
import ActivityTimeline from "../components/business/ActivityTimeline";
import { useAuth } from "../Context/AuthContext";
import useDashboardData from "../hooks/useDashboardData";
import useOrganizationScore from "../hooks/useOrganizationScore";

function valueOf(source) {
  if (!source || source.unavailable) return "—";
  return source.count ?? 0;
}

export default function Dashboard() {
  const navigate = useNavigate();
  const { displayName, displayTitle } = useAuth();
  const { data: dashboard, loading: dashboardLoading } = useDashboardData();
  const { data: currentScore, loading: scoreLoading } = useOrganizationScore();
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Buenos días" : hour < 19 ? "Buenas tardes" : "Buenas noches";
  const today = new Intl.DateTimeFormat("es", {
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(new Date());

  const recommendations = Array.isArray(currentScore?.recommendations)
    ? currentScore.recommendations.slice(0, 3)
    : [];

  const metrics = [
    { title: "Clientes", value: valueOf(dashboard?.clients), subtitle: "Registrados", icon: Users },
    { title: "Proyectos", value: valueOf(dashboard?.projects), subtitle: "Registrados", icon: FolderKanban },
    { title: "Playbooks", value: valueOf(dashboard?.playbooks), subtitle: "Documentados", icon: ClipboardCheck },
    { title: "Discovery", value: valueOf(dashboard?.discoveries), subtitle: "Evaluaciones", icon: Brain },
  ];

  return (
    <Page className="space-y-6 lg:space-y-7">
      <section className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
        <PageHeader
          eyebrow={displayTitle}
          title={`${greeting}, ${displayName}.`}
          description="Resumen actual de tu organización."
        />
        <div className="justify-self-end text-right">
          <p className="text-xs capitalize text-zinc-500">{today}</p>
        </div>
      </section>

      <section className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {metrics.map((metric) => (
          <MetricCard key={metric.title} {...metric} loading={dashboardLoading} />
        ))}
      </section>

      <section className="grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
        <OrvesenScore
          score={currentScore?.total_score ?? null}
          max={currentScore?.max_score ?? 1000}
          status={currentScore?.status ?? "Evaluación pendiente"}
          improvement={currentScore?.improvement ?? null}
          description={
            currentScore?.recommendation ||
            "Completa el Discovery para generar una evaluación con datos reales."
          }
          loading={scoreLoading}
          compact
          onEvaluate={() => navigate("/discovery")}
        />

        <Card glow contentClassName="p-5 sm:p-6">
          <p className="text-xs uppercase tracking-[0.3em] text-zinc-500">ORVESEN IA</p>
          <h2 className="mt-2 text-xl font-semibold text-white">Prioridades reales</h2>

          {recommendations.length > 0 ? (
            <div className="mt-5 space-y-4">
              {recommendations.map((item, index) => (
                <div key={item.id || item.title || index} className="border-t border-zinc-800 pt-4 first:border-0 first:pt-0">
                  <p className="font-medium text-white">{item.title}</p>
                  {item.description && <p className="mt-1 text-sm leading-6 text-zinc-500">{item.description}</p>}
                </div>
              ))}
            </div>
          ) : (
            <div className="mt-5 rounded-xl border border-dashed border-zinc-800 p-5">
              <p className="text-sm text-zinc-400">Aún no hay recomendaciones calculadas.</p>
              <button onClick={() => navigate("/discovery")} className="mt-3 text-sm font-medium text-white underline underline-offset-4">
                Completar Discovery
              </button>
            </div>
          )}
        </Card>
      </section>

      <ActivityTimeline activities={dashboard?.activities || []} />
    </Page>
  );
}

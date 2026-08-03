import {
  Users,
  FolderKanban,
  DollarSign,
  Brain,
} from "lucide-react";

import Page from "../components/ui/Page";
import Section from "../components/ui/Section";
import PageHeader from "../components/ui/PageHeader";
import Card from "../components/ui/Card";

import OrvesenScore from "../components/business/OrvesenScore";
import MetricCard from "../components/business/MetricCard";
import NextActionCard from "../components/business/NextActionCard";
import ActivityTimeline from "../components/business/ActivityTimeline";

import { dashboardData } from "../data/dashboard";
import { useAuth } from "../Context/AuthContext";

export default function Dashboard() {
  const { displayName } = useAuth();
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Buenos días" : hour < 19 ? "Buenas tardes" : "Buenas noches";

  const icons = [
    Users,
    FolderKanban,
    DollarSign,
    Brain,
  ];

  return (
    <Page>

      {/* ========================= */}
      {/* HERO */}
      {/* ========================= */}

      <section
        className="
          flex
          flex-col
          gap-8

          xl:flex-row
          xl:items-end
          xl:justify-between
        "
      >

        <PageHeader
          eyebrow={dashboardData.greeting.eyebrow}
          title={`${greeting}, ${displayName}.`}
          description={dashboardData.greeting.description}
        />

        <Card
          hover={false}
          className="
            w-full
            xl:w-auto
          "
        >

          <p className="text-xs uppercase tracking-[0.35em] text-zinc-500">
            Hoy
          </p>

          <h2 className="mt-3 text-4xl font-semibold text-white">
            {dashboardData.date.day} {dashboardData.date.month}
          </h2>

        </Card>

      </section>

      {/* ========================= */}
      {/* SCORE + IA */}
      {/* ========================= */}

      <section
        className="
          grid
          gap-8

          2xl:grid-cols-2
        "
      >

        <OrvesenScore />

        <Card glow>

          <p className="text-xs uppercase tracking-[0.35em] text-zinc-500">
            ORVESEN IA
          </p>

          <h2 className="mt-5 text-3xl font-semibold text-white">
            {dashboardData.ai.title}
          </h2>

          <p className="mt-3 leading-7 text-zinc-400">
            Estas son las prioridades detectadas hoy por ORVESEN IA.
          </p>

          <div className="mt-10 space-y-8">

            {dashboardData.ai.recommendations.map((item) => (

              <div key={item.id}>

                <p className="font-medium text-white">
                  {String(item.id).padStart(2, "0")} · {item.title}
                </p>

                <p className="mt-3 leading-7 text-zinc-400">
                  {item.description}
                </p>

              </div>

            ))}

          </div>

        </Card>

      </section>

      {/* ========================= */}
      {/* MÉTRICAS */}
      {/* ========================= */}

      <Section
        eyebrow="EXECUTIVE OVERVIEW"
        title="Resumen Ejecutivo"
        description="Indicadores principales del rendimiento de la organización."
      >

        <div
          className="
            grid
            gap-6

            md:grid-cols-2

            2xl:grid-cols-4
          "
        >

          {dashboardData.metrics.map((metric, index) => (

            <MetricCard
              key={metric.title}
              icon={icons[index]}
              title={metric.title}
              value={metric.value}
              subtitle={metric.subtitle}
              trend={metric.trend}
            />

          ))}

        </div>

      </Section>

      {/* ========================= */}
      {/* ACTIVIDAD */}
      {/* ========================= */}

      <Section
        eyebrow="TODAY"
        title="Actividad"
        description="Prioridades y movimientos recientes."
      >

        <div
          className="
            grid
            gap-8

            xl:grid-cols-[420px_1fr]
          "
        >

          <NextActionCard
            title={dashboardData.nextAction.title}
            client={dashboardData.nextAction.client}
            duration={dashboardData.nextAction.duration}
            description={dashboardData.nextAction.description}
            onStart={() => {}}
          />

          <ActivityTimeline
            activities={dashboardData.activities}
          />

        </div>

      </Section>

    </Page>
  );
}

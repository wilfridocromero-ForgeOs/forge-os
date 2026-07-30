import {
  Users,
  FolderKanban,
  DollarSign,
  Brain,
} from "lucide-react";

import Section from "../components/ui/Section";

import { dashboardData } from "../data/dashboard";

import Page from "../components/ui/Page";
import PageHeader from "../components/ui/PageHeader";
import Card from "../components/ui/Card";

import OrvesenScore from "../components/OrvesenScore";
import ExecutiveCard from "../components/ExecutiveCard";

function Dashboard() {
  const icons = [
    Users,
    FolderKanban,
    DollarSign,
    Brain,
  ];

  return (
    <Page>
      {/* Hero */}

      <section className="flex items-end justify-between">
        <PageHeader
          eyebrow={dashboardData.greeting.eyebrow}
          title={dashboardData.greeting.title}
          description={dashboardData.greeting.description}
        />

        <Card className="px-7 py-5" hover={false}>
          <p className="text-xs uppercase tracking-[0.3em] text-zinc-500">
            Hoy
          </p>

          <h3 className="mt-2 text-3xl font-semibold text-white">
            {dashboardData.date.day} {dashboardData.date.month}
          </h3>
        </Card>
      </section>

      {/* Panel Principal */}

      <section className="grid grid-cols-2 gap-8">
        <OrvesenScore />

        <Card>
          <p className="text-xs uppercase tracking-[0.30em] text-zinc-500">
            ORVESEN IA
          </p>

          <h2 className="mt-5 text-3xl font-semibold text-white">
            {dashboardData.ai.title}
          </h2>

          <p className="mt-3 text-zinc-400">
            Estas son las prioridades con mayor impacto para tu organización.
          </p>

          <div className="mt-10 space-y-8">
            {dashboardData.ai.recommendations.map((item) => (
              <div key={item.id}>
                <p className="font-medium text-white">
                  {String(item.id).padStart(2, "0")} · {item.title}
                </p>

                <p className="mt-2 text-sm leading-7 text-zinc-400">
                  {item.description}
                </p>
              </div>
            ))}
          </div>
        </Card>
      </section>

      {/* Executive Overview */}

<Section eyebrow="EXECUTIVE OVERVIEW">
  <div className="grid grid-cols-4 gap-6">
    {dashboardData.metrics.map((metric, index) => (
      <ExecutiveCard
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
</Page>
  );
}

export default Dashboard;
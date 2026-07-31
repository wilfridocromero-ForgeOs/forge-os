import Page from "../components/ui/Page";
import PageHeader from "../components/ui/PageHeader";
import Section from "../components/ui/Section";

import ScoreGauge from "../components/business/ScoreGauge";
import CategoryGrid from "../components/business/CategoryGrid";

import StrengthsCard from "../components/business/StrengthsCard";
import RisksCard from "../components/business/RisksCard";
import RecommendationsCard from "../components/business/RecommendationsCard";
import ActionPlanCard from "../components/business/ActionPlanCard";

import { scoreData } from "../data/score";

export default function Score() {
  return (
    <Page>

      {/* Hero */}

      <PageHeader
        eyebrow="ORVESEN SCORE"
        title="Enterprise Health Analysis"
        description="Analiza la salud general de tu organización y descubre oportunidades para mejorar cada área de tu empresa."
      />

      {/* Score General */}

      <Section>

        <ScoreGauge
          score={scoreData.score}
          max={scoreData.max}
          status={scoreData.status}
          improvement={scoreData.improvement}
          description={scoreData.description}
        />

      </Section>

      {/* Categorías */}

      <Section
        eyebrow="CATEGORÍAS"
        title="Áreas evaluadas"
        description="Cada categoría representa un componente esencial del rendimiento de tu organización."
      >

        <CategoryGrid
          categories={scoreData.categories}
        />

      </Section>

      {/* Resumen Ejecutivo */}

      <Section
        eyebrow="ANÁLISIS"
        title="Resumen Ejecutivo"
        description="ORVESEN IA identifica fortalezas, riesgos y oportunidades prioritarias."
      >

        <div
          className="
            grid
            gap-6

            lg:grid-cols-3
          "
        >

          <StrengthsCard
            strengths={scoreData.strengths}
          />

          <RisksCard
            risks={scoreData.risks}
          />

          <RecommendationsCard
            recommendations={scoreData.recommendations}
          />

        </div>

      </Section>

      {/* Plan de Acción */}

      <Section
        eyebrow="PRÓXIMO PASO"
        title="Acción Prioritaria"
        description="La recomendación con mayor impacto estimado según ORVESEN IA."
      >

        <ActionPlanCard
          title={scoreData.actionPlan.title}
          impact={scoreData.actionPlan.impact}
          time={scoreData.actionPlan.time}
          description={scoreData.actionPlan.description}
        />

      </Section>

    </Page>
  );
}
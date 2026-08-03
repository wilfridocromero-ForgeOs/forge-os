import Page from "../components/ui/Page";
import PageHeader from "../components/ui/PageHeader";
import Section from "../components/ui/Section";

import OrvesenScore from "../components/business/OrvesenScore";
import CategoryGrid from "../components/business/CategoryGrid";

import StrengthsCard from "../components/business/StrengthsCard";
import RisksCard from "../components/business/RisksCard";
import RecommendationsCard from "../components/business/RecommendationsCard";
import ActionPlanCard from "../components/business/ActionPlanCard";

import useOrganizationScore from "../hooks/useOrganizationScore";

export default function Score() {
  const { data: currentScore, loading } = useOrganizationScore();
  const categories = Array.isArray(currentScore?.categories) ? currentScore.categories : [];
  const strengths = Array.isArray(currentScore?.strengths) ? currentScore.strengths : [];
  const risks = Array.isArray(currentScore?.risks) ? currentScore.risks : [];
  const recommendations = Array.isArray(currentScore?.recommendations)
    ? currentScore.recommendations
    : [];
  const actionPlan = currentScore?.next_action || null;
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
        <OrvesenScore
          score={currentScore?.total_score ?? null}
          max={currentScore?.max_score ?? 1000}
          status={currentScore?.status ?? "Evaluación pendiente"}
          improvement={currentScore?.improvement ?? null}
          description={
            currentScore?.recommendation ||
            "Completa el Discovery para generar una evaluación con datos reales."
          }
          loading={loading}
        />
      </Section>

      {/* Categorías */}

      <Section
        eyebrow="CATEGORÍAS"
        title="Áreas evaluadas"
        description="Cada categoría representa un componente esencial del rendimiento de tu organización."
      >
        <CategoryGrid
          categories={categories}
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
            strengths={strengths}
          />

          <RisksCard
            risks={risks}
          />

          <RecommendationsCard
            recommendations={recommendations}
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
          title={actionPlan?.title || "Completar Discovery"}
          impact={actionPlan?.impact ?? 0}
          time={actionPlan?.time || "Pendiente"}
          description={
            actionPlan?.description ||
            "Aún no existe información suficiente para recomendar una acción prioritaria."
          }
        />
      </Section>
    </Page>
  );
}

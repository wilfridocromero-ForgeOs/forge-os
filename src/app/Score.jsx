import { useState } from "react";
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
import { useAuth } from "../Context/AuthContext";

export default function Score() {
  const { canAccess, areaAccess, canManageUsers } = useAuth();
  const [selectedAreaId, setSelectedAreaId] = useState("");
  const { data: currentScore, options: scoreOptions, loading } = useOrganizationScore(selectedAreaId);
  const categories = Array.isArray(currentScore?.categories) ? currentScore.categories : [];
  const strengths = Array.isArray(currentScore?.strengths) ? currentScore.strengths : [];
  const risks = Array.isArray(currentScore?.risks) ? currentScore.risks : [];
  const recommendations = Array.isArray(currentScore?.recommendations)
    ? currentScore.recommendations
    : [];
  const actionPlan = currentScore?.next_action || null;

  if (!canAccess("area_score")) {
    return (
      <Page>
        <div className="rounded-3xl border border-zinc-800 bg-[#111113] p-8">
          <h1 className="text-2xl font-semibold text-white">Score no asignado</h1>
          <p className="mt-3 text-zinc-400">Tu administrador todavía no te ha asignado una división y su score.</p>
        </div>
      </Page>
    );
  }
  return (
    <Page>
      {/* Hero */}

      <PageHeader
        eyebrow="ORVESEN SCORE"
        title={currentScore?.area_name ? `Score de ${currentScore.area_name}` : "Score de la división"}
        description={canManageUsers ? "Consulta el score más reciente asignado por ORVESEN." : "Esta puntuación corresponde únicamente a tu división asignada."}
      />

      {scoreOptions.length > 1 && (
        <div className="mb-6 flex flex-wrap gap-2">
          {scoreOptions.map((score) => <button key={score.area_id} onClick={() => setSelectedAreaId(score.area_id)} className={`rounded-full border px-4 py-2 text-sm ${currentScore?.area_id === score.area_id ? "border-white bg-white text-black" : "border-zinc-700 text-zinc-300"}`}>{score.area_name}</button>)}
        </div>
      )}

      {/* Score General */}

      <Section>
        <OrvesenScore
          score={currentScore?.total_score ?? null}
          max={currentScore?.max_score ?? 1000}
          status={currentScore?.status ?? "Score pendiente"}
          improvement={currentScore?.improvement ?? null}
          description={
            currentScore?.recommendation ||
            (areaAccess.length ? "ORVESEN todavía no ha asignado un score a esta división." : "Aún no tienes una división asignada.")
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

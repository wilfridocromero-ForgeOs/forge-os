import PageHeader from "../components/ui/PageHeader";
import Section from "../components/ui/Section";

import OrvesenScore from "../components/business/OrvesenScore";
import CategoryGrid from "../components/business/CategoryGrid";
import StrengthsCard from "../components/business/StrengthsCard";
import RisksCard from "../components/business/RisksCard";
import RecommendationsCard from "../components/business/RecommendationsCard";
import ActionPlanCard from "../components/business/ActionPlanCard";

export default function Score() {
  return (
    <main className="mx-auto max-w-7xl px-8 py-10">

      <PageHeader
        eyebrow="ORVESEN SCORE"
        title="Organización"
        description="Analiza el estado general de la empresa y recibe recomendaciones de ORVESEN IA."
      />

      <div className="mt-12">
        <OrvesenScore />
      </div>

      <Section
        eyebrow="CATEGORÍAS"
        className="mt-14"
      >
        <CategoryGrid />
      </Section>

      <div className="mt-14 grid gap-8 xl:grid-cols-2">
        <StrengthsCard />
        <RisksCard />
      </div>

      <div className="mt-8 grid gap-8 xl:grid-cols-2">
        <RecommendationsCard />
        <ActionPlanCard />
      </div>

    </main>
  );
}
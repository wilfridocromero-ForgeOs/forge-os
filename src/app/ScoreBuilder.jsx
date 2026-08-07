import Page from "../components/ui/Page";
import Wizard from "../features/score-builder/Wizard";

export default function ScoreBuilder() {
    return (
        <Page className="space-y-6">

            <div className="max-w-7xl mx-auto">

                <div className="mb-8">

                    <p className="text-xs uppercase tracking-[0.3em] text-zinc-500">
                        ORVESEN Intelligence
                    </p>

                    <h1 className="mt-2 text-4xl font-bold text-white">
                        Score Builder
                    </h1>

                    <p className="mt-3 max-w-3xl text-zinc-400">
                        Diseña evaluaciones profesionales para cualquier
                        división de ORVESEN. Crea categorías, preguntas,
                        pesos, recomendaciones y publica el Score para
                        utilizarlo en Discovery y ORVESEN Score.
                    </p>

                </div>

                <Wizard />

            </div>

        </Page>
    );
}
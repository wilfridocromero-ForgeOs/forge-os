import { useEffect, useState } from "react";
import {
    Plus,
    Loader2,
} from "lucide-react";

import Page from "../components/ui/Page";
import Wizard from "../features/score-builder/Wizard";
import ScoreEditor from "./ScoreEditor";

import { supabase } from "../lib/supabase";
import { useOrganization } from "../Context/OrganizationContext";


export default function ScoreBuilder() {

    const { organization } = useOrganization();

    const [view, setView] = useState("list");

    const [scores, setScores] = useState([]);

    const [loading, setLoading] = useState(true);

    const [error, setError] = useState("");

    const [selectedScore, setSelectedScore] =
        useState(null);

    const [loadingScore, setLoadingScore] =
        useState(false);

    const [scoreError, setScoreError] =
        useState("");


    /*
    ==========================================
    DEBUG SESIÓN / RLS
    ==========================================
    */

    useEffect(() => {

        async function debugSession() {

            const {
                data: { user },
                error,
            } = await supabase.auth.getUser();


            console.log(
                "===================================="
            );

            console.log(
                "=== ORVESEN DEBUG ==="
            );

            console.log(
                "AUTH USER ID:",
                user?.id
            );

            console.log(
                "AUTH EMAIL:",
                user?.email
            );

            console.log(
                "ORGANIZATION ID:",
                organization?.id
            );

            console.log(
                "AUTH ERROR:",
                error
            );
            const {
    data: ownerTest,
    error: ownerTestError,
} = await supabase.rpc(
    "is_platform_owner"
);

console.log(
    "IS PLATFORM OWNER:",
    ownerTest
);

console.log(
    "OWNER TEST ERROR:",
    ownerTestError
);

            console.log(
                "===================================="
            );

        }


        debugSession();

    }, [organization?.id]);


    /*
    ==========================================
    CARGAR SCORES AL ENTRAR
    ==========================================
    */

    useEffect(() => {

        if (!organization?.id) {
            setLoading(false);
            return;
        }

        loadScores();

    }, [organization?.id]);


    /*
    ==========================================
    CARGAR LISTA DE SCORES
    ==========================================
    */

    async function loadScores() {

        if (!organization?.id) {
            return;
        }

        setLoading(true);
        setError("");

       const {
    data,
    error,
} = await supabase
    .from("score_templates")
    .select(`
        id,
        organization_id,
        name,
        description,
        status,
        version,
        max_score,
        created_by,
        template_kind,
        created_at,
        updated_at,
        division_id,
        divisions (
            id,
            name
        )
    `)
    .eq(
        "organization_id",
        organization.id
    )
    .order(
        "updated_at",
        {
            ascending: false,
        }
    );

        if (error) {

            console.error(
                "Error cargando Scores:",
                error
            );

            setScores([]);

            setError(
                "No se pudieron cargar los Scores."
            );

            setLoading(false);

            return;
        }

        setScores(data || []);

        setLoading(false);
    }


    /*
    ==========================================
    ABRIR SCORE
    ==========================================
    */

    async function openScore(score) {

        setLoadingScore(true);

        setScoreError("");

        setSelectedScore(null);

        try {

            const {
                data: categories,
                error: categoriesError,
            } = await supabase
                .from("score_categories")
                .select(`
                    id,
                    name,
                    description,
                    weight,
                    position,
                    score_questions (
                        id,
                        prompt,
                        help_text,
                        response_type,
                        weight,
                        required,
                        position,
                        scale_min,
                        scale_max,
                        options,
                        scoring_config
                    )
                `)
                .eq(
                    "template_id",
                    score.id
                )
                .order(
                    "position",
                    {
                        ascending: true,
                    }
                );

            if (categoriesError) {

                console.error(
                    "Error cargando categorías:",
                    categoriesError
                );

                throw categoriesError;
            }


            /*
            ==========================================
            ORDENAR PREGUNTAS
            ==========================================
            */

            const orderedCategories =
                (categories || []).map(
                    (category) => ({

                        ...category,

                        score_questions: [
                            ...(
                                category.score_questions ||
                                []
                            ),
                        ].sort(
                            (a, b) =>
                                Number(
                                    a.position || 0
                                ) -
                                Number(
                                    b.position || 0
                                )
                        ),

                    })
                );


            /*
            ==========================================
            SCORE COMPLETO
            ==========================================
            */

            setSelectedScore({

                ...score,

                categories:
                    orderedCategories,

            });


            setView("detail");

        } catch (error) {

            console.error(
                "Error cargando Score:",
                error
            );

            setScoreError(
                error?.message ||
                "No se pudo cargar el Score."
            );

        } finally {

            setLoadingScore(false);

        }
    }


    /*
    ==========================================
    CREAR NUEVO SCORE
    ==========================================
    */

    function startNewScore() {

        setSelectedScore(null);

        setScoreError("");

        setView("create");
    }


    /*
    ==========================================
    VOLVER A MIS SCORES
    ==========================================
    */

    function returnToScores() {

        setSelectedScore(null);

        setScoreError("");

        setView("list");

        loadScores();
    }


    /*
    ==========================================
    SCORE ACTUALIZADO
    ==========================================
    */

    function handleScoreUpdated(updatedScore) {

        if (!updatedScore) {
            return;
        }

        setSelectedScore((current) => ({

            ...current,

            ...updatedScore,

            categories:
                updatedScore.categories ??
                current?.categories ??
                [],

        }));

        loadScores();
    }


    /*
    ==========================================
    SCORE ELIMINADO
    ==========================================
    */

    function handleScoreDeleted() {

        setSelectedScore(null);

        setScoreError("");

        setView("list");

        loadScores();
    }


    /*
    ==========================================
    INTERFAZ
    ==========================================
    */

    return (

        <Page className="space-y-6">

            <div className="mx-auto max-w-7xl">


                {/* =================================
                    HEADER
                ================================= */}

                {view !== "detail" && (

                    <div className="mb-8">

                        <p className="text-xs uppercase tracking-[0.3em] text-zinc-500">

                            ORVESEN Intelligence

                        </p>


                        <div className="mt-2 flex flex-col gap-5 md:flex-row md:items-end md:justify-between">


                            <div>

                                <h1 className="text-4xl font-bold text-white">

                                    Score Builder

                                </h1>


                                <p className="mt-3 max-w-3xl text-zinc-400">

                                    Diseña, administra y publica
                                    sistemas de evaluación para las
                                    diferentes áreas de tu organización.

                                </p>

                            </div>


                            {view === "list" && (

                                <button
                                    type="button"
                                    onClick={startNewScore}
                                    className="inline-flex items-center justify-center gap-2 rounded-xl bg-white px-5 py-3 font-semibold text-black transition hover:bg-zinc-200"
                                >

                                    <Plus size={18} />

                                    Crear nuevo Score

                                </button>

                            )}


                            {view === "create" && (

                                <button
                                    type="button"
                                    onClick={returnToScores}
                                    className="rounded-xl border border-zinc-700 px-5 py-3 text-sm font-medium text-zinc-300 transition hover:bg-zinc-900"
                                >

                                    Mis Scores

                                </button>

                            )}

                        </div>

                    </div>

                )}


                {/* =================================
                    ERROR
                ================================= */}

                {scoreError && (

                    <div className="mb-6 rounded-2xl border border-red-900 bg-red-950/20 p-5">

                        <p className="text-sm text-red-400">

                            {scoreError}

                        </p>

                    </div>

                )}


                {/* =================================
                    CARGANDO SCORE
                ================================= */}

                {loadingScore && (

                    <div className="flex min-h-52 items-center justify-center rounded-2xl border border-zinc-800 bg-zinc-950/40">

                        <div className="flex items-center gap-3 text-zinc-400">

                            <Loader2
                                size={20}
                                className="animate-spin"
                            />

                            Cargando Score...

                        </div>

                    </div>

                )}


                {/* =================================
                    MIS SCORES
                ================================= */}

                {view === "list" &&
                    !loadingScore && (

                    <div className="space-y-6">


                        <div>

                            <h2 className="text-xl font-semibold text-white">

                                Mis Scores

                            </h2>

                            <p className="mt-1 text-sm text-zinc-500">

                                Evaluaciones creadas para esta organización.

                            </p>

                        </div>


                        {/* CARGANDO */}

                        {loading && (

                            <div className="flex min-h-52 items-center justify-center rounded-2xl border border-zinc-800 bg-zinc-950/40">

                                <div className="flex items-center gap-3 text-zinc-400">

                                    <Loader2
                                        size={20}
                                        className="animate-spin"
                                    />

                                    Cargando Scores...

                                </div>

                            </div>

                        )}


                        {/* ERROR */}

                        {!loading &&
                            error && (

                            <div className="rounded-2xl border border-red-900 bg-red-950/20 p-6">

                                <p className="text-sm text-red-400">

                                    {error}

                                </p>

                                <button
                                    type="button"
                                    onClick={loadScores}
                                    className="mt-4 rounded-lg border border-red-900 px-4 py-2 text-sm text-red-300 transition hover:bg-red-950/30"
                                >

                                    Intentar nuevamente

                                </button>

                            </div>

                        )}


                        {/* SIN SCORES */}

                        {!loading &&
                            !error &&
                            scores.length === 0 && (

                            <div className="rounded-2xl border border-dashed border-zinc-800 bg-zinc-950/30 px-6 py-16 text-center">

                                <h3 className="text-lg font-semibold text-white">

                                    Todavía no tienes Scores

                                </h3>

                                <p className="mx-auto mt-2 max-w-lg text-sm text-zinc-500">

                                    Crea tu primer sistema de evaluación
                                    para comenzar a medir el desempeño
                                    de tu organización.

                                </p>

                                <button
                                    type="button"
                                    onClick={startNewScore}
                                    className="mt-6 inline-flex items-center gap-2 rounded-xl bg-white px-5 py-3 font-semibold text-black transition hover:bg-zinc-200"
                                >

                                    <Plus size={18} />

                                    Crear primer Score

                                </button>

                            </div>

                        )}


                        {/* LISTA DE SCORES */}

                        {!loading &&
                            !error &&
                            scores.length > 0 && (

                            <div className="grid gap-4">

                                {scores.map(
                                    (score) => (

                                    <button
                                        key={score.id}
                                        type="button"
                                        onClick={() =>
                                            openScore(score)
                                        }
                                        className="w-full rounded-2xl border border-zinc-800 bg-[#111113] p-6 text-left transition hover:border-zinc-600 hover:bg-zinc-900/60"
                                    >

                                        <div className="flex items-center justify-between gap-5">


                                            <div className="min-w-0">

                                                <div className="flex flex-wrap items-center gap-3">

                                                    <h3 className="truncate text-lg font-semibold text-white">

                                                        {score.name}

                                                    </h3>

                                                    <StatusBadge
                                                        status={
                                                            score.status
                                                        }
                                                    />

                                                </div>


                                                <p className="mt-2 text-sm text-zinc-500">

                                                    {
                                                        score.divisions
                                                            ?.name ||
                                                        "Sin división"
                                                    }

                                                    {" · "}

                                                    Escala {
                                                        score.max_score ||
                                                        1000
                                                    }

                                                    {" · "}

                                                    Versión {
                                                        score.version ||
                                                        1
                                                    }

                                                </p>


                                                {score.description && (

                                                    <p className="mt-3 line-clamp-2 max-w-3xl text-sm text-zinc-400">

                                                        {
                                                            score.description
                                                        }

                                                    </p>

                                                )}

                                            </div>


                                            <div className="shrink-0 text-2xl text-zinc-500">

                                                ›

                                            </div>

                                        </div>

                                    </button>

                                ))}

                            </div>

                        )}

                    </div>

                )}


                {/* =================================
                    SCORE EDITOR
                ================================= */}

                {view === "detail" &&
                    selectedScore &&
                    !loadingScore && (

                    <ScoreEditor

                        score={selectedScore}

                        onBack={
                            returnToScores
                        }

                        onDeleted={
                            handleScoreDeleted
                        }

                        onUpdated={
                            handleScoreUpdated
                        }

                    />

                )}


                {/* =================================
                    CREAR SCORE
                ================================= */}

                {view === "create" && (

                    <Wizard />

                )}


            </div>

        </Page>

    );
}


/*
==========================================
BADGE DE ESTADO
==========================================
*/

function StatusBadge({
    status,
}) {

    const published =
        status === "published";

    return (

        <span
            className={
                published
                    ? "rounded-full border border-emerald-900 bg-emerald-950/40 px-3 py-1 text-xs font-medium text-emerald-400"
                    : "rounded-full border border-zinc-700 bg-zinc-900 px-3 py-1 text-xs font-medium text-zinc-400"
            }
        >

            {
                published
                    ? "Publicado"
                    : "Borrador"
            }

        </span>

    );
}
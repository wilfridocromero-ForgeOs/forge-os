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

            <div className="mx-auto w-full max-w-7xl px-1 sm:px-0">


                {/* =================================
                    HEADER
                ================================= */}

                {view !== "detail" && (

                    <div className="mb-6 sm:mb-8">

                        <p className="text-[11px] uppercase tracking-[0.25em] text-zinc-500 sm:text-xs sm:tracking-[0.3em]">

                            ORVESEN Intelligence

                        </p>


                        <div className="mt-2 flex flex-col gap-5 md:flex-row md:items-end md:justify-between">


                            <div className="min-w-0">

                                <h1 className="text-3xl font-bold text-zinc-950 dark:text-white sm:text-4xl">

                                    Score Builder

                                </h1>


                                <p className="mt-3 max-w-3xl text-sm leading-6 text-zinc-600 dark:text-zinc-400 sm:text-base">

                                    Diseña, administra y publica
                                    sistemas de evaluación para las
                                    diferentes áreas de tu organización.

                                </p>

                            </div>


                            {view === "list" && (

                                <button
                                    type="button"
                                    onClick={startNewScore}
                                    className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-zinc-950 px-5 py-3 font-semibold text-white transition hover:bg-zinc-800 dark:bg-white dark:text-black dark:hover:bg-zinc-200 md:w-auto"
                                >

                                    <Plus size={18} />

                                    Crear nuevo Score

                                </button>

                            )}


                            {view === "create" && (

                                <button
                                    type="button"
                                    onClick={returnToScores}
                                    className="w-full rounded-xl border border-zinc-300 px-5 py-3 text-sm font-medium text-zinc-700 transition hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900 md:w-auto"
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

                    <div className="mb-6 rounded-2xl border border-red-200 bg-red-50 p-4 dark:border-red-900 dark:bg-red-950/20 sm:p-5">

                        <p className="break-words text-sm text-red-700 dark:text-red-400">

                            {scoreError}

                        </p>

                    </div>

                )}


                {/* =================================
                    CARGANDO SCORE
                ================================= */}

                {loadingScore && (

                    <div className="flex min-h-52 items-center justify-center rounded-2xl border border-zinc-200 bg-white px-4 dark:border-zinc-800 dark:bg-zinc-950/40">

                        <div className="flex items-center gap-3 text-sm text-zinc-600 dark:text-zinc-400 sm:text-base">

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

                    <div className="space-y-5 sm:space-y-6">


                        <div>

                            <h2 className="text-lg font-semibold text-zinc-950 dark:text-white sm:text-xl">

                                Mis Scores

                            </h2>


                            <p className="mt-1 text-sm text-zinc-500">

                                Evaluaciones creadas para esta organización.

                            </p>

                        </div>


                        {/* CARGANDO */}

                        {loading && (

                            <div className="flex min-h-52 items-center justify-center rounded-2xl border border-zinc-200 bg-white px-4 dark:border-zinc-800 dark:bg-zinc-950/40">

                                <div className="flex items-center gap-3 text-sm text-zinc-600 dark:text-zinc-400 sm:text-base">

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

                            <div className="rounded-2xl border border-red-200 bg-red-50 p-5 dark:border-red-900 dark:bg-red-950/20 sm:p-6">

                                <p className="break-words text-sm text-red-700 dark:text-red-400">

                                    {error}

                                </p>


                                <button
                                    type="button"
                                    onClick={loadScores}
                                    className="mt-4 w-full rounded-lg border border-red-300 px-4 py-2.5 text-sm text-red-600 transition hover:bg-red-50 dark:border-red-900 dark:text-red-300 dark:hover:bg-red-950/30 sm:w-auto"
                                >

                                    Intentar nuevamente

                                </button>

                            </div>

                        )}


                        {/* SIN SCORES */}

                        {!loading &&
                            !error &&
                            scores.length === 0 && (

                            <div className="rounded-2xl border border-dashed border-zinc-300 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950/30 px-5 py-12 text-center sm:px-6 sm:py-16">

                                <h3 className="text-lg font-semibold text-zinc-950 dark:text-white">

                                    Todavía no tienes Scores

                                </h3>


                                <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-zinc-500">

                                    Crea tu primer sistema de evaluación
                                    para comenzar a medir el desempeño
                                    de tu organización.

                                </p>


                                <button
                                    type="button"
                                    onClick={startNewScore}
                                    className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-zinc-950 px-5 py-3 font-semibold text-white transition hover:bg-zinc-800 dark:bg-white dark:text-black dark:hover:bg-zinc-200 sm:w-auto"
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

                            <div className="grid gap-3 sm:gap-4">

                                {scores.map(
                                    (score) => (

                                    <button
                                        key={score.id}
                                        type="button"
                                        onClick={() =>
                                            openScore(score)
                                        }
                                        className="w-full rounded-2xl border border-zinc-200 bg-white p-4 text-left transition hover:border-zinc-400 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-[#111113] dark:hover:border-zinc-600 dark:hover:bg-zinc-900/60 sm:p-6"
                                    >

                                        <div className="flex items-start justify-between gap-3 sm:items-center sm:gap-5">


                                            <div className="min-w-0 flex-1">

                                                <div className="flex flex-wrap items-center gap-2 sm:gap-3">

                                                    <h3 className="min-w-0 truncate text-base font-semibold text-zinc-950 dark:text-white sm:text-lg">

                                                        {score.name}

                                                    </h3>


                                                    <StatusBadge
                                                        status={
                                                            score.status
                                                        }
                                                    />

                                                </div>


                                                <p className="mt-2 text-xs leading-5 text-zinc-500 sm:text-sm">

                                                    {
                                                        score.divisions
                                                            ?.name ||
                                                        "Sin división"
                                                    }

                                                    <span className="hidden sm:inline">
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
                                                    </span>

                                                </p>


                                                <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-600 sm:hidden">

                                                    Escala {
                                                        score.max_score ||
                                                        1000
                                                    }

                                                    {" · "}

                                                    Versión {
                                                        score.version ||
                                                        1
                                                    }

                                                </div>


                                                {score.description && (

                                                    <p className="mt-3 line-clamp-2 max-w-3xl text-sm leading-5 text-zinc-600 dark:text-zinc-400">

                                                        {
                                                            score.description
                                                        }

                                                    </p>

                                                )}

                                            </div>


                                            <div className="shrink-0 pt-1 text-xl text-zinc-500 sm:pt-0 sm:text-2xl">

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
                    ? "shrink-0 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-medium text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-400 sm:px-3 sm:text-xs"
                    : "shrink-0 rounded-full border border-zinc-300 bg-zinc-100 px-2.5 py-1 text-[11px] font-medium text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400 sm:px-3 sm:text-xs"
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

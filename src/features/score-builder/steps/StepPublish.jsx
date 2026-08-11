import { useMemo, useState } from "react";

import Card from "../components/Card";
import Button from "../components/Button";

import { supabase } from "../../../lib/supabase";
import { useOrganization } from "../../../Context/OrganizationContext";
import { useAuth } from "../../../Context/AuthContext";


export default function StepPublish({
    form,
    mode,
    onBack,
}) {

    const { organization } = useOrganization();
    const { user } = useAuth();

    const [publishing, setPublishing] = useState(false);
    const [status, setStatus] = useState("");
    const [errorMessage, setErrorMessage] = useState("");


    const totalCategories =
        form.categories?.length || 0;


    const totalQuestions = useMemo(() => {

        return (form.categories || []).reduce(
            (total, category) =>
                total +
                (category.questions?.length || 0),
            0
        );

    }, [form.categories]);


    const totalWeight = useMemo(() => {

        return (form.categories || []).reduce(
            (total, category) =>
                total +
                Number(category.weight || 0),
            0
        );

    }, [form.categories]);


    async function publishScore() {

        if (publishing) {
            return;
        }


        /*
        =========================================
        VALIDACIONES
        =========================================
        */

        if (!organization?.id) {

            setStatus("error");

            setErrorMessage(
                "No se encontró una organización activa."
            );

            return;
        }


        if (!user?.id) {

            setStatus("error");

            setErrorMessage(
                "No se encontró el usuario autenticado."
            );

            return;
        }


        if (!form.name?.trim()) {

            setStatus("error");

            setErrorMessage(
                "El Score necesita un nombre."
            );

            return;
        }


        if (!form.division_id) {

            setStatus("error");

            setErrorMessage(
                "Debes seleccionar una división."
            );

            return;
        }


        if (totalCategories === 0) {

            setStatus("error");

            setErrorMessage(
                "El Score necesita al menos una categoría."
            );

            return;
        }


        if (totalQuestions === 0) {

            setStatus("error");

            setErrorMessage(
                "El Score necesita al menos una pregunta."
            );

            return;
        }


        if (totalWeight !== 100) {

            setStatus("error");

            setErrorMessage(
                "El peso total de las categorías debe ser exactamente 100%."
            );

            return;
        }


        setPublishing(true);

        setStatus("");

        setErrorMessage("");


        try {

            /*
            =========================================
            DEBUG ANTES DE PUBLICAR
            =========================================
            */

            console.log(
                "========================================="
            );

            console.log(
                "=== ORVESEN SCORE PUBLISH DEBUG ==="
            );

            console.log(
                "USER ID:",
                user?.id
            );

            console.log(
                "ORGANIZATION ID:",
                organization?.id
            );

            console.log(
                "DIVISION ID:",
                form?.division_id
            );

            console.log(
                "DIVISION NAME:",
                form?.division_name ||
                form?.division
            );

            console.log(
                "SCORE NAME:",
                form?.name
            );

            console.log(
                "FORM COMPLETO:",
                form
            );


            /*
            =========================================
            COMPROBAR DIVISIÓN EN SUPABASE
            =========================================
            */

            const {
                data: divisionCheck,
                error: divisionCheckError,
            } = await supabase
                .from("divisions")
                .select(`
                    id,
                    organization_id,
                    name,
                    active
                `)
                .eq(
                    "id",
                    form.division_id
                )
                .maybeSingle();


            console.log(
                "DIVISION EN SUPABASE:",
                divisionCheck
            );

            console.log(
                "DIVISION CHECK ERROR:",
                divisionCheckError
            );


            /*
            =========================================
            VALIDAR DIVISIÓN
            =========================================
            */

            if (divisionCheckError) {

                throw new Error(
                    `No se pudo verificar la división: ${
                        divisionCheckError.message
                    }`
                );

            }


            if (!divisionCheck) {

                throw new Error(
                    "La división seleccionada no existe o no está disponible."
                );

            }


            if (
                divisionCheck.organization_id !==
                organization.id
            ) {

                console.error(
                    "ORGANIZATION MISMATCH:",
                    {
                        organizationFromContext:
                            organization.id,

                        organizationFromDivision:
                            divisionCheck.organization_id,
                    }
                );

                throw new Error(
                    "La división seleccionada pertenece a otra organización."
                );

            }


            if (!divisionCheck.active) {

                throw new Error(
                    "La división seleccionada está inactiva."
                );

            }


            /*
            =========================================
            COMPROBAR PLATFORM OWNER
            =========================================
            */

            const {
                data: isPlatformOwner,
                error: ownerCheckError,
            } = await supabase.rpc(
                "is_platform_owner"
            );


            console.log(
                "IS PLATFORM OWNER:",
                isPlatformOwner
            );

            console.log(
                "OWNER CHECK ERROR:",
                ownerCheckError
            );


            /*
            =========================================
            PAYLOAD EXACTO
            =========================================
            */

            const templatePayload = {

                organization_id:
                    organization.id,

                division_id:
                    form.division_id,

                name:
                    form.name.trim(),

                description:
                    form.description?.trim() || "",

                status:
                    "published",

                version:
                    1,

                max_score:
                    1000,

                created_by:
                    user.id,

                published_at:
                    new Date().toISOString(),

                template_kind:
                    "score",

            };


            console.log(
                "PAYLOAD SCORE_TEMPLATE:",
                templatePayload
            );

            console.log(
                "========================================="
            );


            /*
            =========================================
            1. CREAR SCORE TEMPLATE
            =========================================
            */

            const {
                data: template,
                error: templateError,
            } = await supabase
                .from("score_templates")
                .insert(templatePayload)
                .select()
                .single();


            if (templateError) {

                console.error(
                    "========================================="
                );

                console.error(
                    "ERROR INSERT SCORE_TEMPLATE"
                );

                console.error(
                    "MESSAGE:",
                    templateError.message
                );

                console.error(
                    "CODE:",
                    templateError.code
                );

                console.error(
                    "DETAILS:",
                    templateError.details
                );

                console.error(
                    "HINT:",
                    templateError.hint
                );

                console.error(
                    "PAYLOAD:",
                    templatePayload
                );

                console.error(
                    "========================================="
                );

                throw templateError;
            }


            if (!template?.id) {

                throw new Error(
                    "Supabase no devolvió el ID del Score."
                );

            }


            console.log(
                "SCORE TEMPLATE CREADO:",
                template
            );


            /*
            =========================================
            2. CREAR CATEGORÍAS
            =========================================
            */

            for (
                let categoryIndex = 0;
                categoryIndex <
                form.categories.length;
                categoryIndex++
            ) {

                const category =
                    form.categories[
                        categoryIndex
                    ];


                const categoryPayload = {

                    template_id:
                        template.id,

                    name:
                        category.name?.trim() ||
                        `Categoría ${categoryIndex + 1}`,

                    description:
                        category.description?.trim() ||
                        "",

                    weight:
                        Number(
                            category.weight || 0
                        ),

                    position:
                        categoryIndex,

                };


                const {
                    data: savedCategory,
                    error: categoryError,
                } = await supabase
                    .from("score_categories")
                    .insert(categoryPayload)
                    .select()
                    .single();


                if (categoryError) {

                    console.error(
                        "Error creando categoría:",
                        categoryError
                    );

                    console.error(
                        "CATEGORY PAYLOAD:",
                        categoryPayload
                    );

                    throw categoryError;
                }


                if (!savedCategory?.id) {

                    throw new Error(
                        `No se pudo obtener el ID de la categoría ${
                            categoryIndex + 1
                        }.`
                    );

                }


                /*
                =========================================
                3. CREAR PREGUNTAS
                =========================================
                */

                const questions =
                    category.questions || [];


                for (
                    let questionIndex = 0;
                    questionIndex <
                    questions.length;
                    questionIndex++
                ) {

                    const question =
                        questions[
                            questionIndex
                        ];


                    const safeQuestionWeight =
                        Math.min(
                            100,
                            Math.max(
                                0,
                                Number(
                                    question.weight || 0
                                )
                            )
                        );


                    const questionPayload = {

                        category_id:
                            savedCategory.id,

                        prompt:
                            question.prompt?.trim() ||
                            `Pregunta ${questionIndex + 1}`,

                        help_text:
                            question.help_text ||
                            question.description ||
                            "",

                        response_type:
                            question.response_type ||
                            "scale",

                        weight:
                            safeQuestionWeight,

                        required:
                            question.required !==
                            false,

                        position:
                            questionIndex,

                        scale_min:
                            Number(
                                question.scale_min || 1
                            ),

                        scale_max:
                            Number(
                                question.scale_max || 5
                            ),

                        options:
                            Array.isArray(
                                question.options
                            )
                                ? question.options
                                : [],

                        scoring_config:
                            question.scoring_config &&
                            typeof question.scoring_config ===
                                "object" &&
                            !Array.isArray(
                                question.scoring_config
                            )
                                ? question.scoring_config
                                : {},

                    };


                    const {
                        error: questionError,
                    } = await supabase
                        .from("score_questions")
                        .insert(
                            questionPayload
                        );


                    if (questionError) {

                        console.error(
                            "Error creando pregunta:",
                            questionError
                        );

                        console.error(
                            "QUESTION PAYLOAD:",
                            questionPayload
                        );

                        throw questionError;
                    }

                }

            }


            /*
            =========================================
            4. PUBLICACIÓN COMPLETADA
            =========================================
            */

            setStatus(
                "published"
            );


            console.log(
                "========================================="
            );

            console.log(
                "SCORE PUBLICADO CORRECTAMENTE"
            );

            console.log(
                template
            );

            console.log(
                "========================================="
            );


        } catch (error) {

            console.error(
                "Error publicando Score:",
                error
            );


            setStatus(
                "error"
            );


            setErrorMessage(
                error?.message ||
                "Ocurrió un problema durante la publicación."
            );


        } finally {

            setPublishing(false);

        }

    }


    return (

        <div className="space-y-6 sm:space-y-8">


            {/* =================================
                TÍTULO
            ================================= */}

            <div>

                <h1 className="text-3xl font-bold text-white sm:text-4xl">

                    Publicar Score

                </h1>


                <p className="mt-2 text-sm leading-6 text-zinc-400 sm:text-base">

                    Revisa el resumen antes de publicar la evaluación.

                </p>

            </div>


            {/* =================================
                RESUMEN
            ================================= */}

            <Card>

                <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">


                    <SummaryBox
                        label="Nombre"
                        value={
                            form.name ||
                            "Sin nombre"
                        }
                    />


                    <SummaryBox
                        label="División"
                        value={
                            form.division_name ||
                            form.division ||
                            "-"
                        }
                    />


                    <SummaryBox
                        label="Categorías"
                        value={
                            totalCategories
                        }
                    />


                    <SummaryBox
                        label="Preguntas"
                        value={
                            totalQuestions
                        }
                    />

                </div>

            </Card>


            {/* =================================
                VALIDACIÓN
            ================================= */}

            <Card>

                <div className="space-y-5 sm:space-y-6">


                    <div>

                        <h2 className="text-lg font-semibold text-white sm:text-xl">

                            Validación

                        </h2>


                        <p className="mt-2 text-sm leading-6 text-zinc-500">

                            Antes de publicar ORVESEN verificará la estructura de la evaluación.

                        </p>

                    </div>


                    <div className="space-y-3 sm:space-y-4">


                        <ValidationRow
                            title="Información general"
                            valid={
                                Boolean(
                                    form.name?.trim()
                                ) &&
                                Boolean(
                                    form.division_id
                                )
                            }
                        />


                        <ValidationRow
                            title="Categorías"
                            valid={
                                totalCategories > 0
                            }
                        />


                        <ValidationRow
                            title="Preguntas"
                            valid={
                                totalQuestions > 0
                            }
                        />


                        <div className="flex items-center justify-between gap-4 rounded-xl border border-zinc-800 p-4">

                            <span className="text-sm text-zinc-300 sm:text-base">

                                Peso total

                            </span>


                            <span
                                className={
                                    totalWeight === 100
                                        ? "shrink-0 font-semibold text-emerald-400"
                                        : "shrink-0 font-semibold text-amber-400"
                                }
                            >

                                {totalWeight}%

                            </span>

                        </div>

                    </div>

                </div>

            </Card>


            {/* =================================
                ESTADO
            ================================= */}

            <Card>

                <div className="space-y-5 sm:space-y-6">


                    <div>

                        <h2 className="text-lg font-semibold text-white sm:text-xl">

                            Estado de la evaluación

                        </h2>


                        <p className="mt-2 text-sm leading-6 text-zinc-500">

                            {
                                status ===
                                "published"
                                    ? "La evaluación fue publicada correctamente."
                                    : "Esta evaluación todavía no ha sido publicada."
                            }

                        </p>

                    </div>


                    <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3">


                        <StatusBox
                            label="Estado"
                            value={
                                status ===
                                "published"
                                    ? "Publicada"
                                    : "Borrador"
                            }
                        />


                        <StatusBox
                            label="Tipo"
                            value={
                                mode ||
                                "Nuevo"
                            }
                        />


                        <div className="col-span-2 rounded-xl border border-zinc-800 bg-zinc-950 p-4 md:col-span-1 sm:p-5">

                            <p className="text-xs text-zinc-500 sm:text-sm">

                                Escala

                            </p>


                            <h3 className="mt-2 text-lg font-semibold text-white">

                                1000

                            </h3>

                        </div>

                    </div>


                    {/* ÉXITO */}

                    {
                        status ===
                        "published" && (

                        <div className="rounded-xl border border-emerald-700 bg-emerald-950/30 p-4 sm:p-5">

                            <h3 className="text-sm font-semibold text-emerald-400 sm:text-base">

                                ✓ Evaluación publicada correctamente

                            </h3>


                            <p className="mt-2 text-sm leading-6 text-zinc-300">

                                El Score, sus categorías y sus preguntas fueron guardados en ORVESEN.

                            </p>

                        </div>

                    )}


                    {/* ERROR */}

                    {
                        status ===
                        "error" && (

                        <div className="rounded-xl border border-red-700 bg-red-950/30 p-4 sm:p-5">

                            <h3 className="text-sm font-semibold text-red-400 sm:text-base">

                                Error al publicar

                            </h3>


                            <p className="mt-2 break-words text-sm leading-6 text-zinc-300">

                                {
                                    errorMessage ||
                                    "Ocurrió un problema durante la publicación."
                                }

                            </p>

                        </div>

                    )}

                </div>

            </Card>


            {/* =================================
                BOTONES
            ================================= */}

            <div className="grid grid-cols-2 gap-3 sm:flex sm:items-center sm:justify-between">


                <Button
                    variant="secondary"

                    onClick={
                        onBack
                    }

                    disabled={
                        publishing
                    }
                >

                    Atrás

                </Button>


                <Button
                    disabled={
                        publishing ||
                        totalCategories === 0 ||
                        totalQuestions === 0 ||
                        totalWeight !== 100 ||
                        status ===
                            "published"
                    }

                    onClick={
                        publishScore
                    }
                >

                    {
                        publishing
                            ? "Publicando..."
                            : status ===
                              "published"
                                ? "Evaluación Publicada"
                                : "Publicar Evaluación"
                    }

                </Button>

            </div>

        </div>

    );

}


/*
=========================================
RESUMEN
=========================================
*/

function SummaryBox({
    label,
    value,
}) {

    return (

        <div className="min-w-0 rounded-xl border border-zinc-800 bg-zinc-950 p-4 sm:p-5">

            <p className="text-xs text-zinc-500 sm:text-sm">

                {label}

            </p>


            <h3 className="mt-2 break-words text-base font-semibold text-white sm:text-lg">

                {value}

            </h3>

        </div>

    );

}


/*
=========================================
ESTADO
=========================================
*/

function StatusBox({
    label,
    value,
}) {

    return (

        <div className="min-w-0 rounded-xl border border-zinc-800 bg-zinc-950 p-4 sm:p-5">

            <p className="text-xs text-zinc-500 sm:text-sm">

                {label}

            </p>


            <h3 className="mt-2 break-words text-base font-semibold text-white sm:text-lg">

                {value}

            </h3>

        </div>

    );

}


/*
=========================================
VALIDACIÓN
=========================================
*/

function ValidationRow({
    title,
    valid,
}) {

    return (

        <div className="flex items-center justify-between gap-4 rounded-xl border border-zinc-800 p-4">

            <span className="text-sm text-zinc-300 sm:text-base">

                {title}

            </span>


            <span
                className={
                    valid
                        ? "shrink-0 font-semibold text-emerald-400"
                        : "shrink-0 font-semibold text-red-400"
                }
            >

                {
                    valid
                        ? "✓"
                        : "✕"
                }

            </span>

        </div>

    );

}
import { useMemo, useState } from "react";
import { Plus, Search, Trash2 } from "lucide-react";

import Card from "../components/Card";
import Button from "../components/Button";
import Input from "../components/Input";
import SectionTitle from "../components/SectionTitle";


function normalizeWeight(value, fallback = 10) {
    const number = Number(value);

    if (!Number.isFinite(number)) {
        return fallback;
    }

    return Math.min(
        100,
        Math.max(0, number)
    );
}


export default function StepQuestions({
    form,
    library = [],
    addQuestion,
    updateQuestion,
    removeQuestion,
    onBack,
    onNext,
}) {
    const [selectedCategory, setSelectedCategory] =
        useState(
            form.categories?.[0]?.id || ""
        );

    const [search, setSearch] =
        useState("");


    /*
    ==========================================
    CATEGORÍA ACTUAL
    ==========================================
    */

    const currentCategory = useMemo(() => {
        return (form.categories || []).find(
            (category) =>
                category.id === selectedCategory
        );
    }, [
        form.categories,
        selectedCategory,
    ]);


    /*
    ==========================================
    BIBLIOTECA FILTRADA
    ==========================================
    */

    const filteredLibrary = useMemo(() => {
        const questions = library || [];

        if (!search.trim()) {
            return questions;
        }

        const normalizedSearch =
            search.toLowerCase().trim();

        return questions.filter(
            (question) => {
                const text = `
                    ${question.title || ""}
                    ${question.description || ""}
                `.toLowerCase();

                return text.includes(
                    normalizedSearch
                );
            }
        );
    }, [
        library,
        search,
    ]);


    /*
    ==========================================
    CREAR PREGUNTA
    ==========================================
    */

    function createQuestion() {
        if (!currentCategory) {
            return;
        }

        addQuestion(
            currentCategory.id,
            {
                prompt: "",
                description: "",
                help_text: "",
                response_type:
                    "yes_no",
                weight: 10,
                priority:
                    "medium",
                required: true,
                recommendation: "",
                sop: "",
                playbook: "",
                document: "",
                ai_prompt: "",
                tags: [],
                auto_project: false,
                scale_min: 1,
                scale_max: 5,
                options: [],
                scoring_config: {},
            }
        );
    }


    /*
    ==========================================
    IMPORTAR PREGUNTA
    ==========================================
    */

    function importQuestion(item) {
        if (!currentCategory) {
            return;
        }

        const safeWeight =
            normalizeWeight(
                item.recommended_weight,
                10
            );

        addQuestion(
            currentCategory.id,
            {
                prompt:
                    item.title || "",

                description:
                    item.description || "",

                help_text:
                    item.description || "",

                response_type:
                    item.response_type ||
                    "yes_no",

                weight:
                    safeWeight,

                priority:
                    item.priority ||
                    "medium",

                recommendation:
                    item.recommendation ||
                    "",

                sop:
                    item.sop || "",

                playbook:
                    item.playbook || "",

                document:
                    item.document || "",

                ai_prompt:
                    item.ai_prompt || "",

                tags:
                    Array.isArray(
                        item.tags
                    )
                        ? item.tags
                        : [],

                auto_project:
                    false,

                required:
                    true,

                scale_min:
                    Number(
                        item.scale_min || 1
                    ),

                scale_max:
                    Number(
                        item.scale_max || 5
                    ),

                options:
                    Array.isArray(
                        item.options
                    )
                        ? item.options
                        : [],

                scoring_config:
                    item.scoring_config &&
                    typeof item.scoring_config ===
                        "object" &&
                    !Array.isArray(
                        item.scoring_config
                    )
                        ? item.scoring_config
                        : {},
            }
        );
    }


    return (
        <div className="space-y-6 sm:space-y-8">

            <SectionTitle
                title="Preguntas"
                subtitle="Construye la evaluación creando preguntas propias o importándolas desde la Biblioteca Oficial ORVESEN."
            />


            <div className="grid gap-5 xl:grid-cols-[280px_1fr] xl:gap-6">


                {/* =================================
                    CATEGORÍAS
                ================================= */}

                <Card>

                    <div className="space-y-3">

                        <h3 className="text-base font-semibold sm:text-lg">

                            Categorías

                        </h3>


                        {(form.categories || [])
                            .length === 0 && (

                            <p className="text-sm text-zinc-500">

                                No hay categorías.

                            </p>

                        )}


                        <div className="flex gap-2 overflow-x-auto pb-1 xl:block xl:space-y-2 xl:overflow-visible">

                            {(form.categories || [])
                                .map(
                                    (category) => (

                                    <button
                                        key={
                                            category.id
                                        }

                                        type="button"

                                        onClick={() =>
                                            setSelectedCategory(
                                                category.id
                                            )
                                        }

                                        className={`
                                            min-w-[180px]
                                            shrink-0
                                            rounded-xl
                                            px-4
                                            py-3
                                            text-left
                                            transition
                                            xl:w-full
                                            ${
                                                selectedCategory ===
                                                category.id
                                                    ? "bg-white text-black"
                                                    : "bg-zinc-900 text-white hover:bg-zinc-800"
                                            }
                                        `}
                                    >

                                        <div className="truncate font-medium">

                                            {
                                                category.name ||
                                                "Categoría sin nombre"
                                            }

                                        </div>


                                        <div className="mt-1 text-xs opacity-70">

                                            {
                                                (
                                                    category.questions ||
                                                    []
                                                ).length
                                            } preguntas

                                        </div>

                                    </button>

                                ))}

                        </div>

                    </div>

                </Card>


                {/* =================================
                    CONTENIDO
                ================================= */}

                <div className="min-w-0 space-y-5 sm:space-y-6">


                    {/* BUSCADOR */}

                    <Card className="sticky top-0 z-20">

                        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">

                            <div className="relative min-w-0 flex-1">

                                <Search
                                    size={18}
                                    className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-500"
                                />


                                <Input
                                    value={search}
                                    placeholder="Buscar en la biblioteca..."
                                    className="pl-11"
                                    onChange={(e) =>
                                        setSearch(
                                            e.target.value
                                        )
                                    }
                                />

                            </div>


                            <div className="w-full sm:w-auto">

                                <Button
                                    onClick={
                                        createQuestion
                                    }
                                >

                                    <Plus size={18} />

                                    Nueva pregunta

                                </Button>

                            </div>

                        </div>

                    </Card>


                    {/* SIN CATEGORÍA */}

                    {!currentCategory && (

                        <Card>

                            <div className="py-10 text-center text-sm text-zinc-500 sm:py-12">

                                Selecciona una categoría para comenzar.

                            </div>

                        </Card>

                    )}


                    {/* =================================
                        PREGUNTAS
                    ================================= */}

                    {currentCategory && (

                        <div className="space-y-4 sm:space-y-5">

                            {(
                                currentCategory.questions ||
                                []
                            ).map(
                                (
                                    question,
                                    index
                                ) => (

                                <Card
                                    key={
                                        question.id
                                    }
                                >

                                    <div className="space-y-5 sm:space-y-6">


                                        {/* HEADER */}

                                        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">

                                            <div className="min-w-0">

                                                <h3 className="text-base font-semibold sm:text-lg">

                                                    Pregunta {
                                                        index +
                                                        1
                                                    }

                                                </h3>

                                                <p className="mt-1 text-sm text-zinc-500">

                                                    Configura esta pregunta.

                                                </p>

                                            </div>


                                            <button
                                                type="button"

                                                onClick={() =>
                                                    removeQuestion(
                                                        currentCategory.id,
                                                        question.id
                                                    )
                                                }

                                                className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-red-700 px-4 py-2.5 text-sm text-red-500 transition hover:bg-red-950 sm:w-auto"
                                            >

                                                <Trash2
                                                    size={
                                                        16
                                                    }
                                                />

                                                Eliminar

                                            </button>

                                        </div>


                                        {/* PREGUNTA */}

                                        <div>

                                            <label className="mb-2 block text-sm">

                                                Pregunta

                                            </label>


                                            <Input
                                                value={
                                                    question.prompt ||
                                                    ""
                                                }

                                                placeholder="Ej. ¿Tiene Pixel de Meta instalado?"

                                                onChange={(
                                                    e
                                                ) =>
                                                    updateQuestion(
                                                        currentCategory.id,
                                                        question.id,
                                                        "prompt",
                                                        e.target.value
                                                    )
                                                }
                                            />

                                        </div>


                                        {/* DESCRIPCIÓN */}

                                        <div>

                                            <label className="mb-2 block text-sm">

                                                Descripción

                                            </label>


                                            <textarea
                                                rows={3}

                                                value={
                                                    question.description ||
                                                    ""
                                                }

                                                onChange={(
                                                    e
                                                ) =>
                                                    updateQuestion(
                                                        currentCategory.id,
                                                        question.id,
                                                        "description",
                                                        e.target.value
                                                    )
                                                }

                                                className="w-full rounded-xl border border-zinc-800 bg-zinc-950 p-4 text-base outline-none focus:border-zinc-600"
                                            />

                                        </div>


                                        <div className="grid gap-4 md:grid-cols-2 md:gap-5">


                                            {/* TIPO */}

                                            <div>

                                                <label className="mb-2 block text-sm">

                                                    Tipo de respuesta

                                                </label>


                                                <select
                                                    value={
                                                        question.response_type ||
                                                        "yes_no"
                                                    }

                                                    onChange={(
                                                        e
                                                    ) =>
                                                        updateQuestion(
                                                            currentCategory.id,
                                                            question.id,
                                                            "response_type",
                                                            e.target.value
                                                        )
                                                    }

                                                    className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-4 py-3 text-base"
                                                >

                                                    <option value="yes_no">
                                                        Sí / No
                                                    </option>

                                                    <option value="scale">
                                                        Escala
                                                    </option>

                                                    <option value="number">
                                                        Número
                                                    </option>

                                                    <option value="text">
                                                        Texto
                                                    </option>

                                                    <option value="multiple_choice">
                                                        Selección múltiple
                                                    </option>

                                                </select>

                                            </div>


                                            {/* PESO */}

                                            <div>

                                                <label className="mb-2 block text-sm">

                                                    Peso de la pregunta

                                                </label>


                                                <Input
                                                    type="number"
                                                    min="0"
                                                    max="100"
                                                    step="1"

                                                    value={
                                                        question.weight ??
                                                        10
                                                    }

                                                    onChange={(
                                                        e
                                                    ) => {

                                                        const value =
                                                            normalizeWeight(
                                                                e.target.value,
                                                                0
                                                            );

                                                        updateQuestion(
                                                            currentCategory.id,
                                                            question.id,
                                                            "weight",
                                                            value
                                                        );
                                                    }}
                                                />


                                                <p className="mt-2 text-xs text-zinc-500">

                                                    Valor permitido: 0–100.

                                                </p>

                                            </div>

                                        </div>


                                        <div className="grid gap-4 md:grid-cols-2 md:gap-5">


                                            {/* PRIORIDAD */}

                                            <div>

                                                <label className="mb-2 block text-sm">

                                                    Prioridad

                                                </label>


                                                <select
                                                    value={
                                                        question.priority ||
                                                        "medium"
                                                    }

                                                    onChange={(
                                                        e
                                                    ) =>
                                                        updateQuestion(
                                                            currentCategory.id,
                                                            question.id,
                                                            "priority",
                                                            e.target.value
                                                        )
                                                    }

                                                    className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-4 py-3 text-base"
                                                >

                                                    <option value="low">
                                                        Baja
                                                    </option>

                                                    <option value="medium">
                                                        Media
                                                    </option>

                                                    <option value="high">
                                                        Alta
                                                    </option>

                                                    <option value="critical">
                                                        Crítica
                                                    </option>

                                                </select>

                                            </div>


                                            {/* TAGS */}

                                            <div>

                                                <label className="mb-2 block text-sm">

                                                    Tags

                                                </label>


                                                <Input
                                                    value={(
                                                        question.tags ||
                                                        []
                                                    ).join(
                                                        ", "
                                                    )}

                                                    placeholder="seo, ventas, branding"

                                                    onChange={(
                                                        e
                                                    ) =>
                                                        updateQuestion(
                                                            currentCategory.id,
                                                            question.id,
                                                            "tags",
                                                            e.target.value
                                                                .split(",")
                                                                .map(
                                                                    (
                                                                        tag
                                                                    ) =>
                                                                        tag.trim()
                                                                )
                                                                .filter(
                                                                    Boolean
                                                                )
                                                        )
                                                    }
                                                />

                                            </div>

                                        </div>


                                        {/* RECOMENDACIÓN */}

                                        <div>

                                            <label className="mb-2 block text-sm">

                                                Recomendación

                                            </label>


                                            <textarea
                                                rows={3}

                                                value={
                                                    question.recommendation ||
                                                    ""
                                                }

                                                onChange={(
                                                    e
                                                ) =>
                                                    updateQuestion(
                                                        currentCategory.id,
                                                        question.id,
                                                        "recommendation",
                                                        e.target.value
                                                    )
                                                }

                                                className="w-full rounded-xl border border-zinc-800 bg-zinc-950 p-4 text-base"
                                            />

                                        </div>


                                        <div className="grid gap-4 md:grid-cols-2 md:gap-5">


                                            {/* SOP */}

                                            <div>

                                                <label className="mb-2 block text-sm">

                                                    SOP relacionado

                                                </label>


                                                <Input
                                                    value={
                                                        question.sop ||
                                                        ""
                                                    }

                                                    placeholder="SOP-SEO-001"

                                                    onChange={(
                                                        e
                                                    ) =>
                                                        updateQuestion(
                                                            currentCategory.id,
                                                            question.id,
                                                            "sop",
                                                            e.target.value
                                                        )
                                                    }
                                                />

                                            </div>


                                            {/* PLAYBOOK */}

                                            <div>

                                                <label className="mb-2 block text-sm">

                                                    Playbook

                                                </label>


                                                <Input
                                                    value={
                                                        question.playbook ||
                                                        ""
                                                    }

                                                    placeholder="Playbook SEO"

                                                    onChange={(
                                                        e
                                                    ) =>
                                                        updateQuestion(
                                                            currentCategory.id,
                                                            question.id,
                                                            "playbook",
                                                            e.target.value
                                                        )
                                                    }
                                                />

                                            </div>

                                        </div>


                                        {/* DOCUMENTO */}

                                        <div>

                                            <label className="mb-2 block text-sm">

                                                Documento del Cerebro

                                            </label>


                                            <Input
                                                value={
                                                    question.document ||
                                                    ""
                                                }

                                                placeholder="Documento relacionado"

                                                onChange={(
                                                    e
                                                ) =>
                                                    updateQuestion(
                                                        currentCategory.id,
                                                        question.id,
                                                        "document",
                                                        e.target.value
                                                    )
                                                }
                                            />

                                        </div>


                                        {/* PROMPT IA */}

                                        <div>

                                            <label className="mb-2 block text-sm">

                                                Prompt IA

                                            </label>


                                            <textarea
                                                rows={4}

                                                value={
                                                    question.ai_prompt ||
                                                    ""
                                                }

                                                onChange={(
                                                    e
                                                ) =>
                                                    updateQuestion(
                                                        currentCategory.id,
                                                        question.id,
                                                        "ai_prompt",
                                                        e.target.value
                                                    )
                                                }

                                                className="w-full rounded-xl border border-zinc-800 bg-zinc-950 p-4 text-base"
                                            />

                                        </div>


                                        {/* AUTOMATIZACIÓN */}

                                        <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4 sm:p-5">

                                            <label className="flex items-start gap-3">

                                                <input
                                                    type="checkbox"

                                                    checked={
                                                        question.auto_project ||
                                                        false
                                                    }

                                                    onChange={(
                                                        e
                                                    ) =>
                                                        updateQuestion(
                                                            currentCategory.id,
                                                            question.id,
                                                            "auto_project",
                                                            e.target.checked
                                                        )
                                                    }

                                                    className="mt-1 h-4 w-4 shrink-0"
                                                />


                                                <span className="text-sm leading-6 sm:text-base">

                                                    Crear proyecto automáticamente cuando esta pregunta falle.

                                                </span>

                                            </label>

                                        </div>

                                    </div>

                                </Card>

                            ))}

                        </div>

                    )}


                    {/* =================================
                        BIBLIOTECA OFICIAL ORVESEN
                    ================================= */}

                    <Card>

                        <div className="space-y-5 sm:space-y-6">

                            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">

                                <div className="min-w-0">

                                    <h2 className="text-lg font-semibold sm:text-xl">

                                        Biblioteca Oficial ORVESEN

                                    </h2>

                                    <p className="mt-1 text-sm leading-6 text-zinc-500">

                                        Importa preguntas existentes sin tener que volver a escribirlas.

                                    </p>

                                </div>


                                <span className="w-fit rounded-full bg-zinc-900 px-3 py-2 text-sm">

                                    {
                                        filteredLibrary.length
                                    } preguntas

                                </span>

                            </div>


                            {filteredLibrary.length ===
                                0 && (

                                <div className="rounded-xl border border-dashed border-zinc-700 p-8 text-center text-sm text-zinc-500 sm:p-10">

                                    No hay preguntas disponibles.

                                </div>

                            )}


                            <div className="space-y-4">

                                {filteredLibrary.map(
                                    (item) => {

                                    const displayedWeight =
                                        normalizeWeight(
                                            item.recommended_weight,
                                            10
                                        );

                                    return (

                                        <div
                                            key={
                                                item.id
                                            }

                                            className="rounded-xl border border-zinc-800 bg-zinc-950 p-4 sm:p-5"
                                        >

                                            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between sm:gap-6">

                                                <div className="min-w-0 flex-1">

                                                    <h3 className="font-semibold">

                                                        {
                                                            item.title
                                                        }

                                                    </h3>


                                                    <p className="mt-2 text-sm leading-6 text-zinc-500">

                                                        {
                                                            item.description
                                                        }

                                                    </p>


                                                    <div className="mt-4 flex flex-wrap gap-2">

                                                        <span className="rounded-full bg-zinc-900 px-3 py-1 text-xs">

                                                            {
                                                                item.response_type ||
                                                                "yes_no"
                                                            }

                                                        </span>


                                                        <span className="rounded-full bg-zinc-900 px-3 py-1 text-xs">

                                                            Peso {
                                                                displayedWeight
                                                            }

                                                        </span>


                                                        {item.priority && (

                                                            <span className="rounded-full bg-zinc-900 px-3 py-1 text-xs">

                                                                {
                                                                    item.priority
                                                                }

                                                            </span>

                                                        )}

                                                    </div>

                                                </div>


                                                <div className="w-full sm:w-auto">

                                                    <Button
                                                        onClick={() =>
                                                            importQuestion(
                                                                item
                                                            )
                                                        }
                                                    >

                                                        Importar

                                                    </Button>

                                                </div>

                                            </div>

                                        </div>

                                    );

                                })}

                            </div>

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
                        >

                            Atrás

                        </Button>


                        <Button
                            onClick={
                                onNext
                            }
                        >

                            Continuar

                        </Button>

                    </div>

                </div>

            </div>

        </div>
    );
}
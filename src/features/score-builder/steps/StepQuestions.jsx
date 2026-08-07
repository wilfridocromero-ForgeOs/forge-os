import { useMemo, useState } from "react";
import { Plus, Search, Trash2 } from "lucide-react";

import Card from "../components/Card";
import Button from "../components/Button";
import Input from "../components/Input";
import SectionTitle from "../components/SectionTitle";

export default function StepQuestions({

    form,

    library = [],

    addQuestion,

    updateQuestion,

    removeQuestion,

    onBack,

    onNext,

}) {

    const [selectedCategory, setSelectedCategory] = useState(

        form.categories?.[0]?.id || ""

    );

    const [search, setSearch] = useState("");

    const currentCategory = useMemo(() => {

        return (form.categories || []).find(

            category => category.id === selectedCategory

        );

    }, [

        form.categories,

        selectedCategory,

    ]);

    const filteredLibrary = useMemo(() => {

        const questions = library || [];

        if (!search.trim()) {

            return questions;

        }

        return questions.filter(question => {

            const text = `${question.title || ""} ${question.description || ""}`

                .toLowerCase();

            return text.includes(

                search.toLowerCase()

            );

        });

    }, [

        library,

        search,

    ]);

    function createQuestion() {

        if (!currentCategory) return;

        addQuestion(currentCategory.id, {

            id: crypto.randomUUID(),

            prompt: "",

            description: "",

            response_type: "yes_no",

            weight: 10,

            priority: "medium",

            required: true,

            recommendation: "",

            sop: "",

            playbook: "",

            document: "",

            ai_prompt: "",

            tags: [],

            auto_project: false,

        });

    }

    return (

        <div className="space-y-8">

            <SectionTitle

                title="Preguntas"

                subtitle="Construye la evaluación creando preguntas propias o importándolas desde la Biblioteca Oficial ORVESEN."

            />

            <div className="grid gap-6 xl:grid-cols-[280px_1fr]">

                {/* ============================
                    SIDEBAR
                ============================ */}

                <Card>

                    <div className="space-y-2">

                        <h3 className="mb-4 text-lg font-semibold">

                            Categorías

                        </h3>

                        {(form.categories || []).length === 0 && (

                            <p className="text-sm text-zinc-500">

                                No hay categorías.

                            </p>

                        )}

                        {(form.categories || []).map((category) => (

                            <button

                                key={category.id}

                                onClick={() =>

                                    setSelectedCategory(category.id)

                                }

                                className={`

                                    w-full

                                    rounded-xl

                                    px-4

                                    py-3

                                    text-left

                                    transition

                                    ${

                                        selectedCategory === category.id

                                            ? "bg-white text-black"

                                            : "bg-zinc-900 text-white hover:bg-zinc-800"

                                    }

                                `}

                            >

                                <div className="font-medium">

                                    {category.name}

                                </div>

                                <div className="mt-1 text-xs opacity-70">

                                    {(category.questions || []).length} preguntas

                                </div>

                            </button>

                        ))}

                    </div>

                </Card>

                {/* ============================
                    CONTENIDO
                ============================ */}

                <div className="space-y-6">

                    <Card className="sticky top-0 z-20">

                        <div className="flex items-center justify-between gap-4">

                            <div className="relative flex-1">

                                <Search

                                    size={18}

                                    className="absolute left-4 top-4 text-zinc-500"

                                />

                                <Input

                                    value={search}

                                    placeholder="Buscar en la biblioteca..."

                                    className="pl-11"

                                    onChange={(e) =>

                                        setSearch(e.target.value)

                                    }

                                />

                            </div>

                            <Button onClick={createQuestion}>

                                <Plus size={18} />

                                Nueva pregunta

                            </Button>

                        </div>

                    </Card>

                    {!currentCategory && (

                        <Card>

                            <div className="py-12 text-center text-zinc-500">

                                Selecciona una categoría para comenzar.

                            </div>

                        </Card>

                    )}

                    {currentCategory && (

                        <div className="space-y-5">
                            {(currentCategory.questions || []).map((question, index) => (

    <Card key={question.id}>

        <div className="space-y-6">

            <div className="flex items-center justify-between">

                <div>

                    <h3 className="text-lg font-semibold">

                        Pregunta {index + 1}

                    </h3>

                    <p className="text-sm text-zinc-500">

                        Configura esta pregunta.

                    </p>

                </div>

                <button

                    onClick={() =>
                        removeQuestion(
                            currentCategory.id,
                            question.id
                        )
                    }

                    className="flex items-center gap-2 rounded-xl border border-red-700 px-4 py-2 text-red-500 hover:bg-red-950 transition"

                >

                    <Trash2 size={16} />

                    Eliminar

                </button>

            </div>

            {/* Pregunta */}

            <div>

                <label className="mb-2 block text-sm">

                    Pregunta

                </label>

                <Input

                    value={question.prompt}

                    placeholder="Ej. ¿Tiene Pixel de Meta instalado?"

                    onChange={(e)=>

                        updateQuestion(

                            currentCategory.id,

                            question.id,

                            "prompt",

                            e.target.value

                        )

                    }

                />

            </div>

            {/* Descripción */}

            <div>

                <label className="mb-2 block text-sm">

                    Descripción

                </label>

                <textarea

                    rows={3}

                    value={question.description || ""}

                    onChange={(e)=>

                        updateQuestion(

                            currentCategory.id,

                            question.id,

                            "description",

                            e.target.value

                        )

                    }

                    className="w-full rounded-xl border border-zinc-800 bg-zinc-950 p-4 outline-none"

                />

            </div>

            <div className="grid gap-5 md:grid-cols-2">

                {/* Tipo */}

                <div>

                    <label className="mb-2 block text-sm">

                        Tipo de respuesta

                    </label>

                    <select

                        value={question.response_type}

                        onChange={(e)=>

                            updateQuestion(

                                currentCategory.id,

                                question.id,

                                "response_type",

                                e.target.value

                            )

                        }

                        className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-4 py-3"

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

                {/* Peso */}

                <div>

                    <label className="mb-2 block text-sm">

                        Peso

                    </label>

                    <Input

                        type="number"

                        value={question.weight}

                        onChange={(e)=>

                            updateQuestion(

                                currentCategory.id,

                                question.id,

                                "weight",

                                Number(e.target.value)

                            )

                        }

                    />

                </div>

            </div>
                        <div className="grid gap-5 md:grid-cols-2">

                {/* Prioridad */}

                <div>

                    <label className="mb-2 block text-sm">

                        Prioridad

                    </label>

                    <select

                        value={question.priority || "medium"}

                        onChange={(e)=>

                            updateQuestion(

                                currentCategory.id,

                                question.id,

                                "priority",

                                e.target.value

                            )

                        }

                        className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-4 py-3"

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

                {/* Tags */}

                <div>

                    <label className="mb-2 block text-sm">

                        Tags

                    </label>

                    <Input

                        value={(question.tags || []).join(", ")}

                        placeholder="seo, ventas, branding"

                        onChange={(e)=>

                            updateQuestion(

                                currentCategory.id,

                                question.id,

                                "tags",

                                e.target.value

                                    .split(",")

                                    .map(tag => tag.trim())

                                    .filter(Boolean)

                            )

                        }

                    />

                </div>

            </div>

            {/* Recomendación */}

            <div>

                <label className="mb-2 block text-sm">

                    Recomendación

                </label>

                <textarea

                    rows={3}

                    value={question.recommendation || ""}

                    onChange={(e)=>

                        updateQuestion(

                            currentCategory.id,

                            question.id,

                            "recommendation",

                            e.target.value

                        )

                    }

                    className="w-full rounded-xl border border-zinc-800 bg-zinc-950 p-4"

                />

            </div>

            <div className="grid gap-5 md:grid-cols-2">

                {/* SOP */}

                <div>

                    <label className="mb-2 block text-sm">

                        SOP relacionado

                    </label>

                    <Input

                        value={question.sop || ""}

                        placeholder="SOP-SEO-001"

                        onChange={(e)=>

                            updateQuestion(

                                currentCategory.id,

                                question.id,

                                "sop",

                                e.target.value

                            )

                        }

                    />

                </div>

                {/* Playbook */}

                <div>

                    <label className="mb-2 block text-sm">

                        Playbook

                    </label>

                    <Input

                        value={question.playbook || ""}

                        placeholder="Playbook SEO"

                        onChange={(e)=>

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

            {/* Documento */}

            <div>

                <label className="mb-2 block text-sm">

                    Documento del Cerebro

                </label>

                <Input

                    value={question.document || ""}

                    placeholder="Documento relacionado"

                    onChange={(e)=>

                        updateQuestion(

                            currentCategory.id,

                            question.id,

                            "document",

                            e.target.value

                        )

                    }

                />

            </div>

            {/* Prompt IA */}

            <div>

                <label className="mb-2 block text-sm">

                    Prompt IA

                </label>

                <textarea

                    rows={4}

                    value={question.ai_prompt || ""}

                    onChange={(e)=>

                        updateQuestion(

                            currentCategory.id,

                            question.id,

                            "ai_prompt",

                            e.target.value

                        )

                    }

                    className="w-full rounded-xl border border-zinc-800 bg-zinc-950 p-4"

                />

            </div>

            {/* Automatización */}

            <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-5">

                <label className="flex items-center gap-3">

                    <input

                        type="checkbox"

                        checked={question.auto_project || false}

                        onChange={(e)=>

                            updateQuestion(

                                currentCategory.id,

                                question.id,

                                "auto_project",

                                e.target.checked

                            )

                        }

                    />

                    <span>

                        Crear proyecto automáticamente cuando esta pregunta falle.

                    </span>

                </label>

            </div>

        </div>

    </Card>

))}

</div>

)} 

{/* ===========================================
    BIBLIOTECA OFICIAL ORVESEN
=========================================== */}

<Card>

    <div className="space-y-6">

        <div className="flex items-center justify-between">

            <div>

                <h2 className="text-xl font-semibold">

                    Biblioteca Oficial ORVESEN

                </h2>

                <p className="mt-1 text-sm text-zinc-500">

                    Importa preguntas existentes sin tener que volver a escribirlas.

                </p>

            </div>

            <span className="rounded-full bg-zinc-900 px-3 py-2 text-sm">

                {filteredLibrary.length} preguntas

            </span>

        </div>

        {filteredLibrary.length === 0 && (

            <div className="rounded-xl border border-dashed border-zinc-700 p-10 text-center text-zinc-500">

                No hay preguntas disponibles.

            </div>

        )}

        <div className="space-y-4">

            {filteredLibrary.map((item) => (

                <div

                    key={item.id}

                    className="rounded-xl border border-zinc-800 bg-zinc-950 p-5"

                >

                    <div className="flex items-start justify-between gap-6">

                        <div className="flex-1">

                            <h3 className="font-semibold">

                                {item.title}

                            </h3>

                            <p className="mt-2 text-sm text-zinc-500">

                                {item.description}

                            </p>

                            <div className="mt-4 flex flex-wrap gap-2">

                                <span className="rounded-full bg-zinc-900 px-3 py-1 text-xs">

                                    {item.response_type}

                                </span>

                                <span className="rounded-full bg-zinc-900 px-3 py-1 text-xs">

                                    Peso {item.recommended_weight}

                                </span>

                                {item.priority && (

                                    <span className="rounded-full bg-zinc-900 px-3 py-1 text-xs">

                                        {item.priority}

                                    </span>

                                )}

                            </div>

                        </div>

                        <Button

                            onClick={() => {

                                if (!currentCategory) return;

                                addQuestion(

                                    currentCategory.id,

                                    {

                                        id: crypto.randomUUID(),

                                        prompt: item.title,

                                        description: item.description,

                                        response_type: item.response_type,

                                        weight: item.recommended_weight || 10,

                                        priority: item.priority || "medium",

                                        recommendation: item.recommendation || "",

                                        sop: item.sop || "",

                                        playbook: item.playbook || "",

                                        document: item.document || "",

                                        ai_prompt: item.ai_prompt || "",

                                        tags: item.tags || [],

                                        auto_project: false,

                                        required: true,

                                    }

                                );

                            }}

                        >

                            Importar

                        </Button>

                    </div>

                </div>

            ))}

        </div>

    </div>

</Card>

{/* ===========================================
    BOTONES
=========================================== */}

<div className="flex items-center justify-between">

    <Button

        variant="secondary"

        onClick={onBack}

    >

        Atrás

    </Button>

    <Button

        onClick={onNext}

    >

        Continuar

   </Button>

</div>

</div>

</div>

</div>

);

}
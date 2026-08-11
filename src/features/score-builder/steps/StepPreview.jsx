export default function StepPreview({
    form,
    onBack,
    onNext,
}) {
    return (
        <div className="space-y-6 sm:space-y-8">

            {/* HEADER */}

            <div>

                <h1 className="text-3xl font-bold text-zinc-950 dark:text-white sm:text-4xl">

                    Vista previa

                </h1>

                <p className="mt-2 text-sm leading-6 text-zinc-600 dark:text-zinc-400 sm:text-base">

                    Así verá esta evaluación el usuario final.

                </p>

            </div>


            {/* PREVIEW */}

            <div className="rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950 sm:p-6 lg:p-8">

                <div className="space-y-6 sm:space-y-8">


                    {/* INFORMACIÓN GENERAL */}

                    <div>

                        <h2 className="break-words text-xl font-semibold text-zinc-950 dark:text-white sm:text-2xl">

                            {
                                form.name ||
                                "Nombre del Score"
                            }

                        </h2>

                        <p className="mt-2 break-words text-sm leading-6 text-zinc-600 dark:text-zinc-400 sm:text-base">

                            {
                                form.description ||
                                "Descripción del Score"
                            }

                        </p>

                    </div>


                    {/* CATEGORÍAS */}

                    {(form.categories || []).map(
                        (
                            category,
                            categoryIndex
                        ) => (

                        <div
                            key={category.id}
                            className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800 sm:p-6"
                        >

                            <p className="text-xs uppercase tracking-[0.18em] text-zinc-500 dark:text-zinc-600">

                                Categoría {
                                    categoryIndex + 1
                                }

                            </p>

                            <h3 className="mt-1 break-words text-lg font-semibold text-zinc-950 dark:text-white sm:text-xl">

                                {
                                    category.name ||
                                    "Categoría sin nombre"
                                }

                            </h3>

                            {category.description && (

                                <p className="mt-2 break-words text-sm leading-6 text-zinc-500">

                                    {
                                        category.description
                                    }

                                </p>

                            )}


                            {/* PREGUNTAS */}

                            <div className="mt-5 space-y-5 sm:mt-6 sm:space-y-6">

                                {(category.questions || []).map(
                                    (
                                        question,
                                        questionIndex
                                    ) => (

                                    <div
                                        key={question.id}
                                        className="rounded-xl bg-zinc-50 p-4 dark:bg-zinc-900/30"
                                    >

                                        <p className="text-xs text-zinc-500 dark:text-zinc-600">

                                            Pregunta {
                                                questionIndex + 1
                                            }

                                        </p>

                                        <p className="mt-1 break-words font-medium text-zinc-950 dark:text-white">

                                            {
                                                question.prompt ||
                                                "Pregunta sin contenido"
                                            }

                                        </p>


                                        {/* SÍ / NO */}

                                        {question.response_type ===
                                            "yes_no" && (

                                            <div className="mt-3 grid grid-cols-2 gap-3 sm:flex">

                                                <button
                                                    type="button"
                                                    className="w-full rounded-lg border border-zinc-300 px-4 py-2.5 text-sm text-zinc-700 transition hover:bg-zinc-100 dark:border-zinc-700 dark:text-white dark:hover:bg-zinc-900 sm:w-auto"
                                                >

                                                    Sí

                                                </button>

                                                <button
                                                    type="button"
                                                    className="w-full rounded-lg border border-zinc-300 px-4 py-2.5 text-sm text-zinc-700 transition hover:bg-zinc-100 dark:border-zinc-700 dark:text-white dark:hover:bg-zinc-900 sm:w-auto"
                                                >

                                                    No

                                                </button>

                                            </div>

                                        )}


                                        {/* ESCALA */}

                                        {question.response_type ===
                                            "scale" && (

                                            <div className="mt-4">

                                                <input
                                                    type="range"
                                                    min={
                                                        question.scale_min ||
                                                        1
                                                    }
                                                    max={
                                                        question.scale_max ||
                                                        5
                                                    }
                                                    defaultValue={
                                                        question.scale_min ||
                                                        1
                                                    }
                                                    className="w-full"
                                                />

                                                <div className="mt-1 flex justify-between text-xs text-zinc-500 dark:text-zinc-600">

                                                    <span>
                                                        {
                                                            question.scale_min ||
                                                            1
                                                        }
                                                    </span>

                                                    <span>
                                                        {
                                                            question.scale_max ||
                                                            5
                                                        }
                                                    </span>

                                                </div>

                                            </div>

                                        )}


                                        {/* NÚMERO */}

                                        {question.response_type ===
                                            "number" && (

                                            <input
                                                type="number"
                                                disabled
                                                placeholder="Respuesta numérica"
                                                className="mt-3 w-full rounded-xl border border-zinc-300 bg-white px-4 py-3 text-base text-zinc-500 dark:border-zinc-800 dark:bg-zinc-950"
                                            />

                                        )}


                                        {/* TEXTO */}

                                        {question.response_type ===
                                            "text" && (

                                            <textarea
                                                rows={3}
                                                disabled
                                                placeholder="Respuesta del usuario"
                                                className="mt-3 w-full rounded-xl border border-zinc-300 bg-white p-4 text-base text-zinc-500 dark:border-zinc-800 dark:bg-zinc-950"
                                            />

                                        )}


                                        {/* SELECCIÓN MÚLTIPLE */}

                                        {question.response_type ===
                                            "multiple_choice" && (

                                            <div className="mt-3 rounded-xl border border-zinc-300 bg-white p-4 text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-950">

                                                Selección múltiple

                                            </div>

                                        )}

                                    </div>

                                ))}

                            </div>

                        </div>

                    ))}

                </div>

            </div>


            {/* BOTONES */}

            <div className="grid grid-cols-2 gap-3 sm:flex sm:items-center sm:justify-between">

                <button
                    type="button"
                    onClick={onBack}
                    className="w-full rounded-xl border border-zinc-300 px-4 py-3 text-sm font-medium text-zinc-700 transition hover:bg-zinc-100 dark:border-zinc-700 dark:text-white dark:hover:bg-zinc-900 sm:w-auto sm:px-6"
                >

                    Atrás

                </button>

                <button
                    type="button"
                    onClick={onNext}
                    className="w-full rounded-xl bg-zinc-950 px-4 py-3 text-sm font-semibold text-white transition hover:bg-zinc-800 dark:bg-white dark:text-black dark:hover:bg-zinc-200 sm:w-auto sm:px-6"
                >

                    Continuar

                </button>

            </div>

        </div>
    );
}
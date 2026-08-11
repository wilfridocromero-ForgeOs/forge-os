import { Plus, Trash2 } from "lucide-react";

import Card from "../components/Card";
import Button from "../components/Button";
import Input from "../components/Input";
import SectionTitle from "../components/SectionTitle";

export default function StepCategories({
    form,
    addCategory,
    updateCategory,
    removeCategory,
    onBack,
    onNext,
}) {
    function createCategory() {
        addCategory();
    }

    function handleContinue() {
        if (
            !form.categories ||
            form.categories.length === 0
        ) {
            alert(
                "Debes crear al menos una categoría antes de continuar."
            );

            return;
        }

        onNext();
    }

    return (
        <div className="space-y-6 sm:space-y-8">

            <SectionTitle
                title="Categorías"
                subtitle="Organiza la evaluación por áreas."
            />


            {/* NUEVA CATEGORÍA */}

            <div className="flex justify-end">

                <div className="w-full sm:w-auto">

                    <Button
                        onClick={createCategory}
                    >
                        <Plus size={18} />

                        Nueva categoría
                    </Button>

                </div>

            </div>


            {/* CATEGORÍAS */}

            <div className="space-y-4 sm:space-y-6">

                {(form.categories || []).map(
                    (
                        category,
                        index
                    ) => (

                    <Card
                        key={category.id}
                    >

                        <div className="space-y-5">


                            {/* HEADER */}

                            <div className="flex items-center justify-between gap-4">

                                <div className="min-w-0">

                                    <p className="text-xs uppercase tracking-[0.18em] text-zinc-500 dark:text-zinc-600">

                                        Categoría {
                                            index + 1
                                        }

                                    </p>

                                    <h2 className="mt-1 truncate text-lg font-semibold text-zinc-950 dark:text-white sm:text-xl">

                                        {
                                            category.name ||
                                            "Nueva categoría"
                                        }

                                    </h2>

                                </div>


                                <button
                                    type="button"

                                    onClick={() =>
                                        removeCategory(
                                            category.id
                                        )
                                    }

                                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-red-300 text-red-600 transition hover:bg-red-50 dark:border-red-700 dark:text-red-500 dark:hover:bg-red-950"
                                >

                                    <Trash2 size={18} />

                                </button>

                            </div>


                            {/* NOMBRE */}

                            <div>

                                <label className="mb-2 block text-sm text-zinc-600 dark:text-zinc-400">

                                    Nombre

                                </label>


                                <Input
                                    value={
                                        category.name ||
                                        ""
                                    }

                                    onChange={(e) =>
                                        updateCategory(
                                            category.id,
                                            {
                                                name:
                                                    e.target.value,
                                            }
                                        )
                                    }

                                    placeholder="Ej. Estrategia y Posicionamiento"
                                />

                            </div>


                            {/* DESCRIPCIÓN */}

                            <div>

                                <label className="mb-2 block text-sm text-zinc-600 dark:text-zinc-400">

                                    Descripción

                                </label>


                                <textarea
                                    rows={4}

                                    value={
                                        category.description ||
                                        ""
                                    }

                                    onChange={(e) =>
                                        updateCategory(
                                            category.id,
                                            {
                                                description:
                                                    e.target.value,
                                            }
                                        )
                                    }

                                    placeholder="Describe qué evalúa esta categoría."

                                    className="w-full rounded-xl border border-zinc-300 bg-white p-4 text-base text-zinc-950 placeholder:text-zinc-400 focus:border-zinc-500 focus:outline-none dark:border-zinc-800 dark:bg-zinc-950 dark:text-white dark:placeholder:text-zinc-600 dark:focus:border-zinc-600"
                                />

                            </div>


                            {/* PESO */}

                            <div>

                                <label className="mb-2 block text-sm text-zinc-600 dark:text-zinc-400">

                                    Peso

                                </label>


                                <Input
                                    type="number"

                                    min="0"
                                    max="100"
                                    step="1"

                                    value={
                                        category.weight ??
                                        0
                                    }

                                    onChange={(e) => {

                                        const raw =
                                            Number(
                                                e.target.value
                                            );

                                        const safeValue =
                                            Number.isFinite(
                                                raw
                                            )
                                                ? Math.min(
                                                      100,
                                                      Math.max(
                                                          0,
                                                          raw
                                                      )
                                                  )
                                                : 0;

                                        updateCategory(
                                            category.id,
                                            {
                                                weight:
                                                    safeValue,
                                            }
                                        );

                                    }}
                                />


                                <p className="mt-2 text-xs text-zinc-500">

                                    Valor permitido: 0–100%.

                                </p>

                            </div>

                        </div>

                    </Card>

                ))}


                {/* VACÍO */}

                {(
                    !form.categories ||
                    form.categories.length === 0
                ) && (

                    <div className="rounded-2xl border border-dashed border-zinc-300 bg-zinc-50 p-6 text-center dark:border-zinc-800 dark:bg-transparent sm:p-8">

                        <p className="text-sm text-zinc-500">

                            Todavía no has creado categorías.

                        </p>

                        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-600">

                            Crea al menos una categoría para continuar.

                        </p>

                    </div>

                )}

            </div>


            {/* BOTONES */}

            <div className="grid grid-cols-2 gap-3 sm:flex sm:items-center sm:justify-between">

                <Button
                    variant="secondary"
                    onClick={onBack}
                >
                    Atrás
                </Button>


                <Button
                    onClick={
                        handleContinue
                    }
                >
                    Continuar
                </Button>

            </div>

        </div>
    );
}
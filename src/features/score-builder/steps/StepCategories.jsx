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
        if (!form.categories || form.categories.length === 0) {
            alert("Debes crear al menos una categoría antes de continuar.");
            return;
        }

        onNext();
    }

    return (
        <div className="space-y-8">
            <SectionTitle
                title="Categorías"
                subtitle="Organiza la evaluación por áreas."
            />

            <div className="flex justify-end">
                <Button onClick={createCategory}>
                    <Plus size={18} />
                    Nueva categoría
                </Button>
            </div>

            <div className="space-y-6">
                {(form.categories || []).map((category) => (
                    <Card key={category.id}>
                        <div className="space-y-5">
                            <div className="flex items-center justify-between">
                                <h2 className="text-xl font-semibold">
                                    Categoría
                                </h2>

                                <button
                                    type="button"
                                    onClick={() =>
                                        removeCategory(category.id)
                                    }
                                    className="rounded-xl border border-red-700 p-2 text-red-500"
                                >
                                    <Trash2 size={18} />
                                </button>
                            </div>

                            <div>
                                <label className="mb-2 block text-sm text-zinc-400">
                                    Nombre
                                </label>

                                <Input
                                    value={category.name || ""}
                                    onChange={(e) =>
                                        updateCategory(category.id, {
                                            name: e.target.value,
                                        })
                                    }
                                    placeholder="Ej. Estrategia y Posicionamiento"
                                />
                            </div>

                            <div>
                                <label className="mb-2 block text-sm text-zinc-400">
                                    Descripción
                                </label>

                                <textarea
                                    rows={4}
                                    value={category.description || ""}
                                    onChange={(e) =>
                                        updateCategory(category.id, {
                                            description: e.target.value,
                                        })
                                    }
                                    placeholder="Describe qué evalúa esta categoría."
                                    className="w-full rounded-xl border border-zinc-800 bg-zinc-950 p-4 text-white placeholder:text-zinc-600 focus:border-zinc-600 focus:outline-none"
                                />
                            </div>

                            <div>
                                <label className="mb-2 block text-sm text-zinc-400">
                                    Peso
                                </label>

                                <Input
                                    type="number"
                                    min="0"
                                    value={category.weight ?? 0}
                                    onChange={(e) =>
                                        updateCategory(category.id, {
                                            weight: Number(e.target.value),
                                        })
                                    }
                                />
                            </div>
                        </div>
                    </Card>
                ))}

                {(!form.categories || form.categories.length === 0) && (
                    <div className="rounded-2xl border border-dashed border-zinc-800 p-8 text-center">
                        <p className="text-sm text-zinc-500">
                            Todavía no has creado categorías.
                        </p>

                        <p className="mt-1 text-xs text-zinc-600">
                            Crea al menos una categoría para continuar.
                        </p>
                    </div>
                )}
            </div>

            <div className="flex justify-between">
                <Button
                    variant="secondary"
                    onClick={onBack}
                >
                    Atrás
                </Button>

                <Button onClick={handleContinue}>
                    Continuar
                </Button>
            </div>
        </div>
    );
}
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

        addCategory({

            id: crypto.randomUUID(),

            name: "Nueva categoría",

            description: "",

            weight: 20,

            questions: [],

        });

    }

    return (

        <div className="space-y-8">

            <SectionTitle

                title="Categorías"

                subtitle="Organiza la evaluación por áreas."

            />

            <div className="flex justify-end">

                <Button

                    onClick={createCategory}

                >

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

                                    value={category.name}

                                    onChange={(e) =>
                                        updateCategory(
                                            category.id,
                                            "name",
                                            e.target.value
                                        )
                                    }

                                />

                            </div>

                            <div>

                                <label className="mb-2 block text-sm text-zinc-400">

                                    Descripción

                                </label>

                                <textarea

                                    rows={4}

                                    value={category.description}

                                    onChange={(e) =>
                                        updateCategory(
                                            category.id,
                                            "description",
                                            e.target.value
                                        )
                                    }

                                    className="w-full rounded-xl border border-zinc-800 bg-zinc-950 p-4"

                                />

                            </div>

                            <div>

                                <label className="mb-2 block text-sm text-zinc-400">

                                    Peso

                                </label>

                                <Input

                                    type="number"

                                    value={category.weight}

                                    onChange={(e) =>
                                        updateCategory(
                                            category.id,
                                            "weight",
                                            Number(e.target.value)
                                        )
                                    }

                                />

                            </div>

                        </div>

                    </Card>

                ))}

            </div>

            <div className="flex justify-between">

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

    );

}
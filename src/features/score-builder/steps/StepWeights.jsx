import PreviewScore from "../components/PreviewScore";

export default function StepWeights({
    form,
    setForm,
    onNext,
    onBack,
}) {
    function updateCategory(index, value) {
        const categories = [...form.categories];

        categories[index] = {
            ...categories[index],
            weight: Number(value),
        };

        setForm({
            ...form,
            categories,
        });
    }

    const total = form.categories.reduce(
        (sum, item) => sum + Number(item.weight || 0),
        0
    );

    return (
        <div className="mx-auto max-w-6xl space-y-8">

            <div>
                <h1 className="text-4xl font-bold">
                    Distribución de pesos
                </h1>

                <p className="mt-2 text-zinc-500">
                    Cada categoría aporta un porcentaje al Score Final.
                </p>
            </div>

            <div className="grid gap-8 lg:grid-cols-[1fr_340px]">

                <div className="space-y-5">

                    {form.categories.map((category, index) => (
                        <div
                            key={category.id}
                            className="rounded-3xl border border-zinc-800 bg-[#111113] p-6"
                        >
                            <div className="flex items-center justify-between gap-4">

                                <div>
                                    <h2 className="text-lg font-semibold">
                                        {category.name || "Categoría sin nombre"}
                                    </h2>

                                    <p className="mt-1 text-sm text-zinc-500">
                                        Peso de esta categoría en el Score
                                    </p>
                                </div>

                                <div className="w-32">
                                    <div className="relative">
                                        <input
                                            type="number"
                                            min="0"
                                            max="100"
                                            value={category.weight ?? 0}
                                            onChange={(e) =>
                                                updateCategory(
                                                    index,
                                                    e.target.value
                                                )
                                            }
                                            className="w-full rounded-xl border border-zinc-800 bg-[#09090B] px-4 py-3 pr-9 text-white outline-none focus:border-zinc-600"
                                        />

                                        <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-zinc-500">
                                            %
                                        </span>
                                    </div>
                                </div>

                            </div>
                        </div>
                    ))}

                </div>

                <div>
                    <PreviewScore form={form} />

                    <div className="mt-4 rounded-2xl border border-zinc-800 bg-zinc-950 p-5">

                        <div className="flex items-center justify-between">
                            <span className="text-sm text-zinc-400">
                                Peso total
                            </span>

                            <span className="text-lg font-semibold text-white">
                                {total}%
                            </span>
                        </div>

                        {total === 100 ? (
                            <p className="mt-2 text-sm text-emerald-500">
                                La distribución está completa.
                            </p>
                        ) : (
                            <p className="mt-2 text-sm text-amber-500">
                                Las categorías deben sumar exactamente 100%.
                            </p>
                        )}

                    </div>
                </div>

            </div>

            <div className="flex justify-between">

                <button
                    type="button"
                    onClick={onBack}
                    className="rounded-xl border border-zinc-700 px-6 py-3 text-white"
                >
                    Atrás
                </button>

                <button
                    type="button"
                    disabled={total !== 100}
                    onClick={onNext}
                    className="rounded-xl bg-white px-8 py-3 font-semibold text-black disabled:cursor-not-allowed disabled:opacity-40"
                >
                    Continuar
                </button>

            </div>

        </div>
    );
}
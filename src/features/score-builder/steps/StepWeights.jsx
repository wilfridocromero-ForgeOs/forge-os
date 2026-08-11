import PreviewScore from "../components/PreviewScore";

export default function StepWeights({
    form,
    setForm,
    onNext,
    onBack,
}) {

    function updateCategory(
        index,
        value
    ) {
        const categories = [
            ...form.categories,
        ];

        const raw =
            Number(value);

        const safeValue =
            Number.isFinite(raw)
                ? Math.min(
                      100,
                      Math.max(
                          0,
                          raw
                      )
                  )
                : 0;

        categories[index] = {
            ...categories[index],
            weight:
                safeValue,
        };

        setForm({
            ...form,
            categories,
        });
    }


    const total =
        form.categories.reduce(
            (sum, item) =>
                sum +
                Number(
                    item.weight || 0
                ),
            0
        );


    return (
        <div className="mx-auto max-w-6xl space-y-6 sm:space-y-8">


            {/* HEADER */}

            <div>

                <h1 className="text-3xl font-bold text-zinc-950 dark:text-white sm:text-4xl">

                    Distribución de pesos

                </h1>


                <p className="mt-2 text-sm leading-6 text-zinc-600 dark:text-zinc-500 sm:text-base">

                    Cada categoría aporta un porcentaje al Score Final.

                </p>

            </div>


            {/* CONTENIDO */}

            <div className="grid gap-6 lg:grid-cols-[1fr_340px] lg:gap-8">


                {/* CATEGORÍAS */}

                <div className="space-y-4 sm:space-y-5">

                    {form.categories.map(
                        (
                            category,
                            index
                        ) => (

                        <div
                            key={
                                category.id
                            }

                            className="rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-[#111113] sm:rounded-3xl sm:p-6"
                        >

                            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">


                                {/* INFORMACIÓN */}

                                <div className="min-w-0">

                                    <p className="text-xs uppercase tracking-[0.18em] text-zinc-500 dark:text-zinc-600">

                                        Categoría {
                                            index + 1
                                        }

                                    </p>


                                    <h2 className="mt-1 truncate text-base font-semibold text-zinc-950 dark:text-white sm:text-lg">

                                        {
                                            category.name ||
                                            "Categoría sin nombre"
                                        }

                                    </h2>


                                    <p className="mt-1 text-sm text-zinc-500">

                                        Peso de esta categoría en el Score

                                    </p>

                                </div>


                                {/* PESO */}

                                <div className="w-full sm:w-32">

                                    <div className="relative">

                                        <input
                                            type="number"

                                            min="0"

                                            max="100"

                                            step="1"

                                            inputMode="numeric"

                                            value={
                                                category.weight ??
                                                0
                                            }

                                            onChange={(e) =>
                                                updateCategory(
                                                    index,
                                                    e.target.value
                                                )
                                            }

                                            className="w-full rounded-xl border border-zinc-300 bg-white px-4 py-3 pr-9 text-base text-zinc-950 outline-none focus:border-zinc-500 dark:border-zinc-800 dark:bg-[#09090B] dark:text-white dark:focus:border-zinc-600"
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


                {/* PREVIEW */}

                <div className="min-w-0">

                    <PreviewScore
                        form={form}
                    />


                    <div className="mt-4 rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950 sm:p-5">


                        <div className="flex items-center justify-between gap-4">

                            <span className="text-sm text-zinc-600 dark:text-zinc-400">

                                Peso total

                            </span>


                            <span
                                className={
                                    total === 100
                                        ? "text-lg font-semibold text-emerald-600 dark:text-emerald-400"
                                        : "text-lg font-semibold text-zinc-950 dark:text-white"
                                }
                            >

                                {total}%

                            </span>

                        </div>


                        {total === 100 ? (

                            <p className="mt-2 text-sm text-emerald-600 dark:text-emerald-500">

                                La distribución está completa.

                            </p>

                        ) : (

                            <p className="mt-2 text-sm leading-6 text-amber-600 dark:text-amber-500">

                                Las categorías deben sumar exactamente 100%.

                            </p>

                        )}

                    </div>

                </div>

            </div>


            {/* BOTONES */}

            <div className="grid grid-cols-2 gap-3 sm:flex sm:items-center sm:justify-between">

                <button
                    type="button"

                    onClick={
                        onBack
                    }

                    className="w-full rounded-xl border border-zinc-300 px-4 py-3 text-sm font-medium text-zinc-700 transition hover:bg-zinc-100 dark:border-zinc-700 dark:text-white dark:hover:bg-zinc-900 sm:w-auto sm:px-6"
                >

                    Atrás

                </button>


                <button
                    type="button"

                    disabled={
                        total !==
                        100
                    }

                    onClick={
                        onNext
                    }

                    className="w-full rounded-xl bg-zinc-950 px-4 py-3 text-sm font-semibold text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-white dark:text-black dark:hover:bg-zinc-200 sm:w-auto sm:px-8"
                >

                    Continuar

                </button>

            </div>

        </div>
    );
}
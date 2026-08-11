export default function StepIndicator({
    current,
}) {
    const steps = [
        "Información",
        "Categorías",
        "Biblioteca",
        "Pesos",
        "Vista previa",
        "Publicar",
    ];

    const currentStep =
        steps[current] || "";

    return (
        <div className="mb-8 sm:mb-12">

            {/* MÓVIL */}

            <div className="sm:hidden">

                <div className="flex items-center justify-between gap-3">

                    <div>

                        <p className="text-xs uppercase tracking-[0.18em] text-zinc-500 dark:text-zinc-600">

                            Paso {current + 1} de {steps.length}

                        </p>

                        <h3 className="mt-1 text-base font-semibold text-zinc-950 dark:text-white">

                            {currentStep}

                        </h3>

                    </div>


                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-zinc-950 text-sm font-semibold text-zinc-950 dark:border-white dark:text-white">

                        {current + 1}

                    </div>

                </div>


                <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">

                    <div
                        className="h-full rounded-full bg-zinc-950 transition-all duration-300 dark:bg-white"
                        style={{
                            width: `${
                                ((current + 1) /
                                    steps.length) *
                                100
                            }%`,
                        }}
                    />

                </div>

            </div>


            {/* TABLET / DESKTOP */}

            <div className="hidden sm:block">

                <div className="flex items-center justify-between">

                    {steps.map(
                        (
                            item,
                            index
                        ) => (

                        <div
                            key={item}
                            className="flex flex-1 items-center"
                        >

                            <div
                                className={`
                                    flex
                                    h-10
                                    w-10
                                    shrink-0
                                    items-center
                                    justify-center
                                    rounded-full
                                    border
                                    text-sm
                                    font-semibold
                                    transition
                                    lg:h-11
                                    lg:w-11
                                    ${
                                        current > index
                                            ? "border-zinc-950 bg-zinc-950 text-white dark:border-white dark:bg-white dark:text-black"
                                            : current === index
                                                ? "border-zinc-950 text-zinc-950 dark:border-white dark:text-white"
                                                : "border-zinc-300 text-zinc-400 dark:border-zinc-700 dark:text-zinc-600"
                                    }
                                `}
                            >

                                {index + 1}

                            </div>


                            {index <
                                steps.length -
                                    1 && (

                                <div
                                    className={`
                                        mx-2
                                        h-[2px]
                                        flex-1
                                        lg:mx-3
                                        ${
                                            current >
                                            index
                                                ? "bg-zinc-950 dark:bg-white"
                                                : "bg-zinc-200 dark:bg-zinc-800"
                                        }
                                    `}
                                />

                            )}

                        </div>

                    ))}

                </div>


                <div className="mt-5 grid grid-cols-6 text-xs text-zinc-500">

                    {steps.map(
                        (item) => (

                        <div
                            key={item}
                            className="px-1 text-center"
                        >

                            {item}

                        </div>

                    ))}

                </div>

            </div>

        </div>
    );
}
export default function StepPreview({ form, onBack, onNext }) {

    return (

        <div className="space-y-8">

            <div>

                <h1 className="text-3xl font-bold text-white">
                    Vista previa
                </h1>

                <p className="mt-2 text-zinc-400">
                    Así verá esta evaluación el usuario final.
                </p>

            </div>

            <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-8">

                <div className="space-y-8">

                    <div>

                        <h2 className="text-2xl font-semibold text-white">
                            {form.name || "Nombre del Score"}
                        </h2>

                        <p className="mt-2 text-zinc-400">
                            {form.description || "Descripción del Score"}
                        </p>

                    </div>

                    {(form.categories || []).map((category) => (

                        <div
                            key={category.id}
                            className="rounded-xl border border-zinc-800 p-6"
                        >

                            <h3 className="text-xl font-semibold text-white">
                                {category.name}
                            </h3>

                            <p className="mt-2 text-sm text-zinc-500">
                                {category.description}
                            </p>

                            <div className="mt-6 space-y-6">

                                {(category.questions || []).map((question) => (

                                    <div key={question.id}>

                                        <p className="font-medium text-white">
                                            {question.prompt}
                                        </p>

                                        {question.response_type === "yes_no" && (

                                            <div className="mt-3 flex gap-3">

                                                <button
                                                    type="button"
                                                    className="rounded-lg border border-zinc-700 px-4 py-2"
                                                >
                                                    Sí
                                                </button>

                                                <button
                                                    type="button"
                                                    className="rounded-lg border border-zinc-700 px-4 py-2"
                                                >
                                                    No
                                                </button>

                                            </div>

                                        )}

                                        {question.response_type === "scale" && (

                                            <input
                                                type="range"
                                                min="1"
                                                max="5"
                                                className="mt-3 w-full"
                                            />

                                        )}

                                    </div>

                                ))}

                            </div>

                        </div>

                    ))}

                </div>

            </div>

            <div className="flex justify-between">

                <button
                    onClick={onBack}
                    className="rounded-xl border border-zinc-700 px-6 py-3 text-white"
                >
                    Atrás
                </button>

                <button
                    onClick={onNext}
                    className="rounded-xl bg-white px-6 py-3 font-semibold text-black"
                >
                    Continuar
                </button>

            </div>

        </div>

    );

}
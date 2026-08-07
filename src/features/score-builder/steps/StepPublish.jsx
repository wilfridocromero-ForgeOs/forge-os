import Card from "../components/Card";

export default function StepPreview({ form, onBack, onNext }) {
    return (
        <div className="space-y-8">

            <div>
                <h1 className="text-3xl font-bold">
                    Vista previa
                </h1>

                <p className="text-zinc-400 mt-2">
                    Así verá esta evaluación el usuario final.
                </p>
            </div>

            <Card>

                <div className="space-y-8">

                    <div>

                        <h2 className="text-2xl font-semibold">
                            {form.name || "Nombre del Score"}
                        </h2>

                        <p className="text-zinc-400 mt-2">
                            {form.description || "Descripción del Score"}
                        </p>

                    </div>

                    {form.categories.map((category) => (

                        <div
                            key={category.id}
                            className="border rounded-xl p-6 space-y-6"
                        >

                            <div>

                                <h3 className="text-xl font-semibold">
                                    {category.name}
                                </h3>

                                <p className="text-sm text-zinc-500">
                                    {category.description}
                                </p>

                            </div>

                            {category.questions.map((question) => (

                                <div
                                    key={question.id}
                                    className="space-y-2"
                                >

                                    <p className="font-medium">
                                        {question.prompt}
                                    </p>

                                    {question.response_type === "yes_no" && (

                                        <div className="flex gap-3">

                                            <button className="px-4 py-2 rounded-lg border">
                                                Sí
                                            </button>

                                            <button className="px-4 py-2 rounded-lg border">
                                                No
                                            </button>

                                        </div>

                                    )}

                                    {question.response_type === "scale" && (

                                        <input
                                            type="range"
                                            min="1"
                                            max="5"
                                            className="w-full"
                                        />

                                    )}

                                </div>

                            ))}

                        </div>

                    ))}

                </div>

            </Card>

            <div className="flex justify-between">

                <button
                    onClick={onBack}
                    className="btn-secondary"
                >
                    Atrás
                </button>

                <button
                    onClick={onNext}
                    className="btn-primary"
                >
                    Continuar
                </button>

            </div>

        </div>
    );
}
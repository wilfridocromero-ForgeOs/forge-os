import { Search, Plus } from "lucide-react";

export default function StepImportQuestion({
    library = [],
    form,
    setForm,
    onBack,
    onNext,
}) {

    function addQuestion(category, question) {

        const categories = [...form.categories];

        const index = categories.findIndex(
            item => item.name === category.name
        );

        if (index === -1) return;

        categories[index].questions.push({

            id: Date.now() + Math.random(),

            libraryId: question.id,

            title: question.title,

            description: question.description,

            response_type: question.response_type,

            weight: question.recommended_weight,

        });

        setForm({

            ...form,

            categories,

        });

    }

    return (

        <div className="mx-auto max-w-7xl">

            <div className="mb-10">

                <h1 className="text-4xl font-bold">

                    Biblioteca Oficial

                </h1>

                <p className="mt-3 text-zinc-500">

                    Selecciona preguntas profesionales para añadirlas
                    a tus categorías.

                </p>

            </div>

            <div className="mb-8">

                <div className="flex items-center rounded-2xl border border-zinc-800 bg-[#111113] px-5 py-4">

                    <Search
                        size={18}
                        className="mr-3 text-zinc-500"
                    />

                    <input

                        placeholder="Buscar pregunta..."

                        className="flex-1 bg-transparent outline-none"

                    />

                </div>

            </div>

            <div className="space-y-10">

                {

                    library.map(category => (

                        <div key={category.id}>

                            <h2 className="mb-6 text-2xl font-semibold">

                                {category.name}

                            </h2>

                            <div className="grid gap-5 md:grid-cols-2">

                                {

                                    category.score_library_questions.map(question => (

                                        <div

                                            key={question.id}

                                            className="rounded-3xl border border-zinc-800 bg-[#111113] p-6"

                                        >

                                            <h3 className="font-semibold">

                                                {question.title}

                                            </h3>

                                            <p className="mt-3 text-sm text-zinc-500">

                                                {question.description}                                            </p>

                                            <div className="mt-6 flex items-center justify-between">

                                                <div className="space-y-1">

                                                    <div className="text-xs uppercase tracking-wider text-zinc-600">

                                                        {question.response_type}

                                                    </div>

                                                    <div className="text-xs text-zinc-500">

                                                        Peso recomendado {question.recommended_weight}%

                                                    </div>

                                                </div>

                                                <button
                                                    type="button"
                                                    onClick={() => addQuestion(category, question)}
                                                    className="flex items-center rounded-xl bg-white px-4 py-2 text-sm font-medium text-black hover:opacity-90"
                                                >

                                                    <Plus
                                                        size={16}
                                                        className="mr-2"
                                                    />

                                                    Añadir

                                                </button>

                                            </div>

                                        </div>

                                    ))

                                }

                            </div>

                        </div>

                    ))

                }

            </div>
                                             <div className="mt-14 flex justify-between">

                <button
                    type="button"
                    onClick={onBack}
                    className="rounded-xl border border-zinc-700 px-8 py-3 transition hover:bg-zinc-900"
                >

                    Atrás

                </button>

                <button
                    type="button"
                    onClick={onNext}
                    className="rounded-xl bg-white px-8 py-3 font-semibold text-black transition hover:opacity-90"
                >

                    Continuar

                </button>

            </div>

        </div>

    );

}               
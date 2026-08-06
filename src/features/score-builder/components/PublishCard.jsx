import {

    CheckCircle2,

    ClipboardList,

    Layers3,

    Scale,

} from "lucide-react";

export default function PublishCard({

    form,

    onPublish,

    publishing,

}) {

    const totalQuestions = form.categories.reduce(

        (sum, category) =>

            sum + category.questions.length,

        0

    );

    return (

        <div className="rounded-3xl border border-zinc-800 bg-[#111113] p-8">

            <div className="mb-10">

                <div className="flex items-center gap-3">

                    <CheckCircle2 size={28}/>

                    <h2 className="text-3xl font-bold">

                        Listo para publicar

                    </h2>

                </div>

                <p className="mt-4 text-zinc-500">

                    Revisa el resumen antes de publicar el Score.

                </p>

            </div>

            <div className="grid gap-5 md:grid-cols-2">

                <Info

                    icon={<ClipboardList size={20}/>}

                    title="Evaluación"

                    value={form.name}

                />

                <Info

                    icon={<Layers3 size={20}/>}

                    title="Categorías"

                    value={form.categories.length}

                />

                <Info

                    icon={<ClipboardList size={20}/>}

                    title="Preguntas"

                    value={totalQuestions}

                />

                <Info

                    icon={<Scale size={20}/>}

                    title="Escala"

                    value={form.scale}

                />

            </div>

            <button

                onClick={onPublish}

                disabled={publishing}

                className="mt-10 w-full rounded-2xl bg-white py-4 text-lg font-semibold text-black transition hover:opacity-90"

            >

                {

                    publishing

                    ?

                    "Publicando..."

                    :

                    "Publicar Evaluación"

                }

            </button>

        </div>

    );

}

function Info({

    icon,

    title,

    value,

}){

    return(

        <div className="rounded-2xl border border-zinc-800 bg-[#09090B] p-5">

            <div className="mb-3 flex items-center gap-2 text-zinc-400">

                {icon}

                {title}

            </div>

            <div className="text-2xl font-bold text-white">

                {value}

            </div>

        </div>

    );

}
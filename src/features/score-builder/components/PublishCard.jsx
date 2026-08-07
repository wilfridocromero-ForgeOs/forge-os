import { CheckCircle, Save, Upload } from "lucide-react";

export default function PublishCard({

    form,

    onSave,

    onPublish,

}){

    const totalCategories=form.categories.length;

    const totalQuestions=form.categories.reduce(

        (sum,c)=>sum+c.questions.length,

        0

    );

    return(

        <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-8">

            <div className="flex items-center gap-3">

                <CheckCircle
                    className="text-emerald-500"
                    size={28}
                />

                <h2 className="text-2xl font-bold">

                    Listo para publicar

                </h2>

            </div>

            <div className="mt-8 grid gap-4 md:grid-cols-4">

                <Info
                    title="Categorías"
                    value={totalCategories}
                />

                <Info
                    title="Preguntas"
                    value={totalQuestions}
                />

                <Info
                    title="Escala"
                    value={form.scale}
                />

                <Info
                    title="División"
                    value={form.division}
                />

            </div>

            <div className="mt-10 flex gap-4">

                <button

                    onClick={onSave}

                    className="flex items-center gap-2 rounded-xl border border-zinc-700 px-6 py-3"

                >

                    <Save size={18}/>

                    Guardar borrador

                </button>

                <button

                    onClick={onPublish}

                    className="flex items-center gap-2 rounded-xl bg-white px-6 py-3 font-semibold text-black"

                >

                    <Upload size={18}/>

                    Publicar evaluación

                </button>

            </div>

        </div>

    );

}

function Info({

    title,

    value,

}){

    return(

        <div className="rounded-xl bg-zinc-900 p-5">

            <p className="text-sm text-zinc-500">

                {title}

            </p>

            <h3 className="mt-2 text-2xl font-bold">

                {value}

            </h3>

        </div>

    );

}
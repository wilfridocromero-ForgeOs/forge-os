export default function PreviewScore({

    form,

}){

    return(

        <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-8">

            <h2 className="text-3xl font-bold">

                {form.name || "Nueva Evaluación"}

            </h2>

            <p className="mt-3 text-zinc-400">

                {form.description || "Sin descripción"}

            </p>

            <div className="mt-8 grid gap-4 md:grid-cols-4">

                <Card
                    title="División"
                    value={form.division || "-"}
                />

                <Card
                    title="Escala"
                    value={form.scale}
                />

                <Card
                    title="Categorías"
                    value={form.categories.length}
                />

                <Card
                    title="Preguntas"
                    value={
                        form.categories.reduce(
                            (sum,c)=>sum+c.questions.length,
                            0
                        )
                    }
                />

            </div>

        </div>

    );

}

function Card({

    title,

    value,

}){

    return(

        <div className="rounded-xl bg-zinc-900 p-5">

            <p className="text-sm text-zinc-500">

                {title}

            </p>

            <h3 className="mt-3 text-2xl font-bold">

                {value}

            </h3>

        </div>

    );

}
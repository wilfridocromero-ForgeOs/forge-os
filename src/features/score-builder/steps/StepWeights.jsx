import PreviewScore from "../components/PreviewScore";

export default function StepWeights({
    form,
    setForm,
    onNext,
    onBack,
}) {

    function updateCategory(index, value){

        const categories=[...form.categories];

        categories[index].weight=Number(value);

        setForm({
            ...form,
            categories,
        });

    }

    const total=form.categories.reduce(
        (sum,item)=>sum+Number(item.weight||0),
        0
    );

    return(

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

                    {

                        form.categories.map((category,index)=>(

                            <div
                                key={category.id}
                                className="rounded-3xl border border-zinc-800 bg-[#111113] p-6"
                            >

                                <div className="flex items-center justify-between">

                                    <div>

                                        <h2 className="text-lg font-semibold">

                                            {category.name}

                                        </h2>

                                    </div>

                                    <div className="w-28">

                                        <input
                                            type="number"
                                            value={category.weight}
                                            onChange={(e)=>updateCategory(index,e.target.value)}
                                            className="w-full rounded-xl border border-zinc-800 bg-[#09090B] px-4 py-3"
                                        />

                                    </div>

                                </div>

                            </div>

                        ))

                    }

                </div>

                <PreviewScore
                    total={total}
                    scale={form.scale}
                />

            </div>

            <div className="flex justify-between">

                <button
                    onClick={onBack}
                    className="rounded-xl border border-zinc-700 px-6 py-3"
                >

                    Atrás

                </button>

                <button
                    disabled={total!==100}
                    onClick={onNext}
                    className="rounded-xl bg-white px-8 py-3 font-semibold text-black disabled:opacity-40"
                >

                    Continuar

                </button>

            </div>

        </div>

    );

}
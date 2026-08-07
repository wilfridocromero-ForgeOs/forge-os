export default function QuestionSidebar({

    category,

    setCategory,

    categories = [],

}) {

    return (

        <aside className="w-72 border-r border-zinc-800 bg-zinc-950 p-5">

            <h2 className="mb-6 text-lg font-semibold">

                Categorías

            </h2>

            <div className="space-y-2">

                <button

                    onClick={() => setCategory("Todas")}

                    className={`w-full rounded-xl px-4 py-3 text-left transition

                    ${

                        category === "Todas"

                            ? "bg-white text-black"

                            : "bg-zinc-900 text-zinc-300 hover:bg-zinc-800"

                    }`}

                >

                    Todas

                </button>

                {

                    categories.map((item) => (

                        <button

                            key={item.id}

                            onClick={() => setCategory(item.name)}

                            className={`w-full rounded-xl px-4 py-3 text-left transition

                            ${

                                category === item.name

                                    ? "bg-white text-black"

                                    : "bg-zinc-900 text-zinc-300 hover:bg-zinc-800"

                            }`}

                        >

                            {item.name}

                        </button>

                    ))

                }

            </div>

        </aside>

    );

}
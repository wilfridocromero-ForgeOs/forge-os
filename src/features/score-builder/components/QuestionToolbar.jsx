import { Search } from "lucide-react";

export default function QuestionToolbar({

    search,

    setSearch,

    division,

    setDivision,

    onCreate,

}) {

    return (

        <div className="flex items-center justify-between border-b border-zinc-800 p-5">

            <div className="relative w-96">

                <Search

                    size={18}

                    className="absolute left-4 top-4 text-zinc-500"

                />

                <input

                    value={search}

                    onChange={(e)=>setSearch(e.target.value)}

                    placeholder="Buscar pregunta..."

                    className="w-full rounded-xl border border-zinc-700 bg-zinc-900 py-3 pl-11 pr-4 outline-none"

                />

            </div>

            <div className="flex gap-3">

                <select

                    value={division}

                    onChange={(e)=>setDivision(e.target.value)}

                    className="rounded-xl border border-zinc-700 bg-zinc-900 px-4"

                >

                    <option value="">

                        Todas las divisiones

                    </option>

                    <option value="Digital">

                        Digital

                    </option>

                    <option value="Studio">

                        Studio

                    </option>

                    <option value="Media">

                        Media

                    </option>

                    <option value="Academy">

                        Academy

                    </option>

                    <option value="OS">

                        OS

                    </option>

                </select>

                <button

                    onClick={onCreate}

                    className="rounded-xl bg-white px-5 py-3 font-semibold text-black transition hover:bg-zinc-200"

                >

                    Nueva pregunta

                </button>

            </div>

        </div>

    );

}
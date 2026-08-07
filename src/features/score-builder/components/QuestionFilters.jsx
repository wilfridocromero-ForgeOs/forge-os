import { Search, Filter, X } from "lucide-react";

const DIVISIONS = [
    "Todas",
    "Digital",
    "OS",
    "Studio",
    "Media",
    "Academy",
];

const TYPES = [
    "Todos",
    "Sí / No",
    "Escala",
    "Texto",
    "Número",
    "Selección múltiple",
];

const STATUS = [
    "Todos",
    "Activa",
    "Inactiva",
];

export default function QuestionFilters({

    search,
    setSearch,

    division,
    setDivision,

    category,
    setCategory,

    type,
    setType,

    status,
    setStatus,

    categories = [],

}) {

    function clearFilters() {

        setSearch("");

        setDivision("Todas");

        setCategory("Todas");

        setType("Todos");

        setStatus("Todos");

    }

    return (

        <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-5">

            <div className="mb-5 flex items-center gap-2">

                <Filter size={18} />

                <h2 className="font-semibold">

                    Filtros

                </h2>

            </div>

            <div className="grid gap-4 lg:grid-cols-5">

                <div className="relative">

                    <Search
                        size={17}
                        className="absolute left-3 top-3 text-zinc-500"
                    />

                    <input

                        value={search}

                        onChange={(e)=>setSearch(e.target.value)}

                        placeholder="Buscar..."

                        className="w-full rounded-xl border border-zinc-700 bg-zinc-900 py-3 pl-10 pr-3 outline-none"

                    />

                </div>

                <select

                    value={division}

                    onChange={(e)=>setDivision(e.target.value)}

                    className="rounded-xl border border-zinc-700 bg-zinc-900 p-3"

                >

                    {DIVISIONS.map(item=>(

                        <option key={item}>

                            {item}

                        </option>

                    ))}

                </select>

                <select

                    value={category}

                    onChange={(e)=>setCategory(e.target.value)}

                    className="rounded-xl border border-zinc-700 bg-zinc-900 p-3"

                >

                    <option>Todas</option>

                    {

                        categories.map(item=>(

                            <option
                                key={item}
                            >

                                {item}

                            </option>

                        ))

                    }

                </select>

                <select

                    value={type}

                    onChange={(e)=>setType(e.target.value)}

                    className="rounded-xl border border-zinc-700 bg-zinc-900 p-3"

                >

                    {

                        TYPES.map(item=>(

                            <option key={item}>

                                {item}

                            </option>

                        ))

                    }

                </select>

                <select

                    value={status}

                    onChange={(e)=>setStatus(e.target.value)}

                    className="rounded-xl border border-zinc-700 bg-zinc-900 p-3"

                >

                    {

                        STATUS.map(item=>(

                            <option key={item}>

                                {item}

                            </option>

                        ))

                    }

                </select>

            </div>

            <div className="mt-5 flex justify-end">

                <button

                    onClick={clearFilters}

                    className="flex items-center gap-2 rounded-xl border border-zinc-700 px-4 py-2 text-sm"

                >

                    <X size={15}/>

                    Limpiar filtros

                </button>

            </div>

        </div>

    );

}
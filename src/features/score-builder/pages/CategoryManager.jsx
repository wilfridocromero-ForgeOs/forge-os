import { useEffect, useState } from "react";
import {
    Plus,
    Save,
    Trash2,
    FolderTree,
} from "lucide-react";

import { supabase } from "../../../lib/supabase";

import useCategories from "../hooks/useCategories";

const blankCategory = {

    name: "",

    description: "",

    division_id: "",

    color: "#ffffff",

    icon: "Folder",

    position: 0,

    active: true,

};

export default function CategoryManager() {

    const {

        loading,

        categories,

        reload,

        addCategory,

        editCategory,

        removeCategory,

    } = useCategories();

    const [divisions, setDivisions] = useState([]);

    const [selected, setSelected] = useState(blankCategory);
    useEffect(() => {

    async function loadDivisions() {

        const { data } = await supabase

            .from("divisions")

            .select("id,name")

            .order("name");

        setDivisions(data || []);

    }

    loadDivisions();

}, []);
async function saveCategory() {

    if (!selected.name.trim()) {

        alert("Escribe un nombre.");

        return;

    }

    const result = selected.id

        ? await editCategory(

              selected.id,

              selected

          )

        : await addCategory(selected);

    if (result.error) {

        console.error(result.error);

        return;

    }

    setSelected(blankCategory);

    await reload();

}
async function deleteCategory() {

    if (!selected.id) return;

    if (!window.confirm("¿Eliminar categoría?")) {

        return;

    }

    const result = await removeCategory(

        selected.id

    );

    if (result.error) {

        console.error(result.error);

        return;

    }

    setSelected(blankCategory);

    await reload();

}
return (

    <div className="grid gap-6 xl:grid-cols-[360px_1fr]">

        {/* ===========================
            LISTA DE CATEGORÍAS
        =========================== */}

        <div className="rounded-2xl border border-zinc-800 bg-zinc-950">

            <div className="flex items-center justify-between border-b border-zinc-800 p-5">

                <div className="flex items-center gap-2">

                    <FolderTree size={20} />

                    <h2 className="font-semibold">

                        Categorías

                    </h2>

                </div>

                <button

                    onClick={() => setSelected(blankCategory)}

                    className="rounded-xl bg-white p-2 text-black transition hover:scale-105"

                >

                    <Plus size={18} />

                </button>

            </div>

            {loading ? (

                <div className="p-8 text-center text-zinc-500">

                    Cargando categorías...

                </div>

            ) : (

                <div className="divide-y divide-zinc-800">

                    {categories.map((category) => (

                        <button

                            key={category.id}

                            onClick={() => setSelected(category)}

                            className={`flex w-full items-center justify-between p-4 text-left transition

                                ${
                                    selected?.id === category.id
                                        ? "bg-zinc-900"
                                        : "hover:bg-zinc-900/60"
                                }`}

                        >

                            <div>

                                <h3 className="font-medium text-white">

                                    {category.name}

                                </h3>

                                <p className="mt-1 text-xs text-zinc-500">

                                    {category.description || "Sin descripción"}

                                </p>

                            </div>

                            <div

                                className="h-4 w-4 rounded-full border border-zinc-700"

                                style={{

                                    backgroundColor: category.color,

                                }}

                            />

                        </button>

                    ))}
                </div>
            )}

        </div>

        {/* ===========================
            EDITOR
        =========================== */}

        <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-8">

            <h2 className="mb-8 text-2xl font-bold">

                Editor de Categoría

            </h2>

            <div className="grid gap-5">

                <input

                    className="field"

                    placeholder="Nombre"

                    value={selected.name}

                    onChange={(e)=>

                        setSelected({

                            ...selected,

                            name:e.target.value,

                        })

                    }

                />

                <textarea

                    rows={4}

                    className="field resize-none"

                    placeholder="Descripción"

                    value={selected.description}

                    onChange={(e)=>

                        setSelected({

                            ...selected,

                            description:e.target.value,

                        })

                    }

                />

                <select

                    className="field"

                    value={selected.division_id}

                    onChange={(e)=>

                        setSelected({

                            ...selected,

                            division_id:e.target.value,

                        })

                    }

                >

                    <option value="">

                        Selecciona una división

                    </option>

                    {divisions.map((division)=>(

                        <option

                            key={division.id}

                            value={division.id}

                        >

                            {division.name}

                        </option>

                    ))}

                </select>

                <div>

                    <label className="mb-2 block text-sm text-zinc-400">

                        Color

                    </label>

                    <input

                        type="color"

                        value={selected.color}

                        onChange={(e)=>

                            setSelected({

                                ...selected,

                                color:e.target.value,

                            })

                        }

                    />

                </div>

                <input

                    className="field"

                    placeholder="Icono"

                    value={selected.icon}

                    onChange={(e)=>

                        setSelected({

                            ...selected,

                            icon:e.target.value,

                        })

                    }

                />

            </div>

            <div className="mt-10 flex gap-4">

                <button

                    onClick={saveCategory}

                    className="btn-primary"

                >

                    <Save size={18}/>

                    Guardar

                </button>

                <button

                    onClick={deleteCategory}

                    disabled={!selected.id}

                    className="btn-secondary border-red-800 text-red-400 disabled:opacity-40"

                >

                    <Trash2 size={18}/>

                    Eliminar

                </button>

            </div>

        </div>

    </div>

    );
};
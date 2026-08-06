import { Trash2 } from "lucide-react";

export default function CategoryCard({
    category,
    onChange,
    onDelete,
}) {

    return (

        <div className="rounded-3xl border border-zinc-800 bg-[#111113] p-6">

            <div className="flex items-center justify-between">

                <div className="flex-1">

                    <label className="mb-2 block text-sm text-zinc-500">
                        Nombre
                    </label>

                    <input
                        value={category.name}
                        onChange={(e)=>onChange({
                            ...category,
                            name:e.target.value,
                        })}
                        className="w-full rounded-2xl border border-zinc-800 bg-[#09090B] px-5 py-4 outline-none"
                    />

                </div>

                <button
                    onClick={onDelete}
                    className="ml-5 rounded-xl border border-zinc-800 p-3 hover:bg-zinc-900"
                >

                    <Trash2 size={18}/>

                </button>

            </div>

            <div className="mt-6">

                <label className="mb-2 block text-sm text-zinc-500">

                    Descripción

                </label>

                <textarea

                    rows={3}

                    value={category.description}

                    onChange={(e)=>onChange({

                        ...category,

                        description:e.target.value,

                    })}

                    className="w-full rounded-2xl border border-zinc-800 bg-[#09090B] px-5 py-4 outline-none"

                />

            </div>

        </div>

    );

}
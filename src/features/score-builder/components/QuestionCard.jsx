import { Trash2, Copy } from "lucide-react";

export default function QuestionCard({

    question,

    onChange,

    onDelete,

    onDuplicate,

}){

    function update(field,value){

        onChange({

            ...question,

            [field]:value,

        });

    }

    return(

        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-5">

            <div className="flex justify-between">

                <input

                    value={question.title}

                    onChange={(e)=>update("title",e.target.value)}

                    placeholder="Pregunta"

                    className="flex-1 bg-transparent text-lg font-semibold outline-none"

                />

                <div className="flex gap-2">

                    <button

                        onClick={onDuplicate}

                        className="rounded-lg border border-zinc-700 p-2"

                    >

                        <Copy size={16}/>

                    </button>

                    <button

                        onClick={onDelete}

                        className="rounded-lg border border-red-900 p-2 text-red-400"

                    >

                        <Trash2 size={16}/>

                    </button>

                </div>

            </div>

            <textarea

                rows="2"

                value={question.description}

                onChange={(e)=>update("description",e.target.value)}

                placeholder="Descripción"

                className="mt-4 w-full rounded-xl border border-zinc-800 bg-zinc-950 p-3"

            />

            <div className="mt-5 grid gap-4 md:grid-cols-3">

                <div>

                    <label className="mb-2 block text-sm text-zinc-500">

                        Tipo

                    </label>

                    <select

                        value={question.type}

                        onChange={(e)=>update("type",e.target.value)}

                        className="w-full rounded-xl border border-zinc-800 bg-zinc-950 p-3"

                    >

                        <option value="yes_no">Sí / No</option>

                        <option value="scale">Escala</option>

                        <option value="text">Texto</option>

                        <option value="multiple">Múltiple</option>

                    </select>

                </div>

                <div>

                    <label className="mb-2 block text-sm text-zinc-500">

                        Peso

                    </label>

                    <input

                        type="number"

                        value={question.weight}

                        onChange={(e)=>update("weight",Number(e.target.value))}

                        className="w-full rounded-xl border border-zinc-800 bg-zinc-950 p-3"

                    />

                </div>

                <div>

                    <label className="mb-2 block text-sm text-zinc-500">

                        Obligatoria

                    </label>

                    <select

                        value={question.required}

                        onChange={(e)=>update("required",e.target.value==="true")}

                        className="w-full rounded-xl border border-zinc-800 bg-zinc-950 p-3"

                    >

                        <option value="true">Sí</option>

                        <option value="false">No</option>

                    </select>

                </div>

            </div>

        </div>

    );

}
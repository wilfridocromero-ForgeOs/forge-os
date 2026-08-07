import { useMemo, useState } from "react";

import {
    Search,
    Check,
    X,
} from "lucide-react";

export default function QuestionImportModal({

    open,

    questions=[],

    onClose,

    onImport,

}){

    const[search,setSearch]=useState("");

    const[selected,setSelected]=useState([]);

    const filtered=useMemo(()=>{

        return questions.filter(question=>{

            return `${question.title} ${question.description}`

                .toLowerCase()

                .includes(search.toLowerCase());

        });

    },[questions,search]);

    function toggle(id){

        setSelected(current=>{

            if(current.includes(id)){

                return current.filter(item=>item!==id);

            }

            return [...current,id];

        });

    }

    function handleImport(){

        const result=questions.filter(question=>

            selected.includes(question.id)

        );

        onImport(result);

        setSelected([]);

        onClose();

    }

    if(!open){

        return null;

    }

    return(

        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">

            <div className="w-full max-w-4xl rounded-2xl bg-zinc-950 border border-zinc-800">

                <div className="flex items-center justify-between border-b border-zinc-800 p-6">

                    <h2 className="text-2xl font-bold">

                        Importar preguntas

                    </h2>

                    <button

                        onClick={onClose}

                    >

                        <X/>

                    </button>

                </div>

                <div className="p-6">

                    <div className="relative mb-6">

                        <Search

                            size={18}

                            className="absolute left-3 top-3 text-zinc-500"

                        />

                        <input

                            value={search}

                            onChange={(e)=>setSearch(e.target.value)}

                            placeholder="Buscar pregunta..."

                            className="w-full rounded-xl border border-zinc-700 bg-zinc-900 py-3 pl-10"

                        />

                    </div>

                    <div className="max-h-[420px] overflow-y-auto space-y-3">

                        {

                            filtered.map(question=>(

                                <button

                                    key={question.id}

                                    onClick={()=>toggle(question.id)}

                                    className={`

                                    w-full rounded-xl border p-4 text-left transition

                                    ${

                                        selected.includes(question.id)

                                        ?"border-white bg-zinc-900"

                                        :"border-zinc-800 hover:border-zinc-600"

                                    }

                                    `}

                                >

                                    <div className="flex justify-between">

                                        <div>

                                            <h3 className="font-semibold">

                                                {question.title}

                                            </h3>

                                            <p className="mt-2 text-sm text-zinc-500">

                                                {question.description}

                                            </p>

                                        </div>

                                        {

                                            selected.includes(question.id)&&(

                                                <Check/>

                                            )

                                        }

                                    </div>

                                </button>

                            ))

                        }

                    </div>

                </div>

                <div className="flex justify-between border-t border-zinc-800 p-6">

                    <button

                        onClick={onClose}

                        className="rounded-xl border border-zinc-700 px-5 py-3"

                    >

                        Cancelar

                    </button>

                    <button

                        onClick={handleImport}

                        className="rounded-xl bg-white px-6 py-3 font-semibold text-black"

                    >

                        Importar ({selected.length})

                    </button>

                </div>

            </div>

        </div>

    );

}
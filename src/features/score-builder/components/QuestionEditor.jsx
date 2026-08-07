import { Save, Trash2, Copy } from "lucide-react";

export default function QuestionEditor({

    question,

    onChange,

    onSave,

    onDelete,

    onDuplicate,

}) {

    if (!question) {

        return (

            <div className="w-96 border-l border-zinc-800 bg-zinc-950 flex items-center justify-center">

                <p className="text-zinc-500">

                    Selecciona una pregunta

                </p>

            </div>

        );

    }

    function update(field,value){

        onChange({

            ...question,

            [field]:value,

        });

    }

    return(

        <aside className="w-96 overflow-y-auto border-l border-zinc-800 bg-zinc-950 p-6">

            <h2 className="text-2xl font-bold mb-6">

                Editor

            </h2>

            <div className="space-y-5">

                <div>

                    <label className="block mb-2 text-sm">

                        Título

                    </label>

                    <input

                        className="field"

                        value={question.title || ""}

                        onChange={(e)=>

                            update("title",e.target.value)

                        }

                    />

                </div>

                <div>

                    <label className="block mb-2 text-sm">

                        Descripción

                    </label>

                    <textarea

                        rows="4"

                        className="field resize-none"

                        value={question.description || ""}

                        onChange={(e)=>

                            update("description",e.target.value)

                        }

                    />

                </div>

                <div>

                    <label className="block mb-2 text-sm">

                        Tipo de respuesta

                    </label>

                    <select

                        className="field"

                        value={question.response_type || "yes_no"}

                        onChange={(e)=>

                            update("response_type",e.target.value)

                        }

                    >

                        <option value="yes_no">

                            Sí / No

                        </option>

                        <option value="scale">

                            Escala

                        </option>

                        <option value="number">

                            Número

                        </option>

                        <option value="percentage">

                            Porcentaje

                        </option>

                        <option value="multiple_choice">

                            Selección múltiple

                        </option>

                        <option value="text">

                            Texto

                        </option>

                    </select>

                </div>

                <div>

                    <label className="block mb-2 text-sm">

                        Peso recomendado

                    </label>

                    <input

                        type="number"

                        className="field"

                        value={question.recommended_weight || 0}

                        onChange={(e)=>

                            update(

                                "recommended_weight",

                                Number(e.target.value)

                            )

                        }

                    />

                </div>

                <div>

                    <label className="block mb-2 text-sm">

                        Dificultad

                    </label>

                    <select

                        className="field"

                        value={question.difficulty || "medium"}

                        onChange={(e)=>

                            update(

                                "difficulty",

                                e.target.value

                            )

                        }

                    >

                        <option value="easy">

                            Fácil

                        </option>

                        <option value="medium">

                            Media

                        </option>

                        <option value="hard">

                            Difícil

                        </option>

                    </select>

                </div>

                <div>

                    <label className="block mb-2 text-sm">

                        Prioridad

                    </label>

                    <select

                        className="field"

                        value={question.priority || "medium"}

                        onChange={(e)=>

                            update(

                                "priority",

                                e.target.value

                            )

                        }

                    >

                        <option value="low">

                            Baja

                        </option>

                        <option value="medium">

                            Media

                        </option>

                        <option value="high">

                            Alta

                        </option>

                        <option value="critical">

                            Crítica

                        </option>

                    </select>

                </div>

                <div>

                    <label className="block mb-2 text-sm">

                        Recomendación

                    </label>

                    <textarea

                        rows="5"

                        className="field resize-none"

                        value={question.recommendation || ""}

                        onChange={(e)=>

                            update(

                                "recommendation",

                                e.target.value

                            )

                        }

                    />

                </div>

            </div>

            <div className="mt-8 grid grid-cols-3 gap-3">

                <button

                    onClick={onSave}

                    className="btn-primary"

                >

                    <Save size={18}/>

                </button>

                <button

                    onClick={onDuplicate}

                    className="btn-secondary"

                >

                    <Copy size={18}/>

                </button>

                <button

                    onClick={onDelete}

                    className="btn-secondary border-red-700 text-red-400"

                >

                    <Trash2 size={18}/>

                </button>

            </div>

        </aside>

    );

}
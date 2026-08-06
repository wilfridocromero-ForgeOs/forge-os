import { Plus } from "lucide-react";

import CategoryCard from "../components/CategoryCard";

export default function StepCategories({

    form,

    setForm,

    onNext,

    onBack,

}){

    function addCategory(){

        setForm({

            ...form,

            categories:[

                ...form.categories,

                {

                    id:Date.now(),

                    name:"",

                    description:"",

                    weight:0,

                    questions:[],

                }

            ]

        });

    }

    function updateCategory(index,data){

        const categories=[...form.categories];

        categories[index]=data;

        setForm({

            ...form,

            categories,

        });

    }

    function removeCategory(index){

        const categories=[...form.categories];

        categories.splice(index,1);

        setForm({

            ...form,

            categories,

        });

    }

    return(

        <div className="mx-auto max-w-5xl">

            <div className="mb-10">

                <h1 className="text-4xl font-bold">

                    Categorías

                </h1>

                <p className="mt-3 text-zinc-500">

                    Divide la evaluación en áreas.

                    Cada categoría tendrá sus propias preguntas.

                </p>

            </div>

            <div className="space-y-6">

                {

                    form.categories.map((category,index)=>(

                        <CategoryCard

                            key={category.id}

                            category={category}

                            onChange={(value)=>updateCategory(index,value)}

                            onDelete={()=>removeCategory(index)}

                        />

                    ))

                }

            </div>

            <button

                onClick={addCategory}

                className="mt-8 flex items-center rounded-2xl border border-zinc-700 px-6 py-4"

            >

                <Plus

                    size={18}

                    className="mr-2"

                />

                Añadir categoría

            </button>

            <div className="mt-12 flex justify-between">

                <button

                    onClick={onBack}

                    className="rounded-xl border border-zinc-700 px-7 py-3"

                >

                    Atrás

                </button>

                <button

                    disabled={!form.categories.length}

                    onClick={onNext}

                    className="rounded-xl bg-white px-8 py-3 font-semibold text-black disabled:opacity-40"

                >

                    Continuar

                </button>

            </div>

        </div>

    );

}
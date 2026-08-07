import { useState } from "react";

const initialForm = {
    name: "",
    description: "",
    division: "",
    scale: 1000,
    categories: [],
};

export default function useScoreBuilder() {

    const [step, setStep] = useState(0);

    const [mode, setMode] = useState("");

    const [form, setForm] = useState(initialForm);

    function next() {
        setStep((s) => s + 1);
    }

    function back() {
        setStep((s) => Math.max(s - 1, 0));
    }

    function reset() {
        setStep(0);
        setMode("");
        setForm(initialForm);
    }

    function addCategory() {

        setForm((current) => ({

            ...current,

            categories: [

                ...current.categories,

                {

                    id: crypto.randomUUID(),

                    name: "",

                    description: "",

                    weight: 0,

                    questions: [],

                }

            ]

        }));

    }

    function updateCategory(id, changes) {

        setForm((current)=>({

            ...current,

            categories: current.categories.map((category)=>

                category.id===id

                    ? {...category,...changes}

                    : category

            )

        }));

    }

    function removeCategory(id){

        setForm((current)=>({

            ...current,

            categories: current.categories.filter(

                (category)=>category.id!==id

            )

        }));

    }

    function addQuestion(categoryId){

        setForm((current)=>({

            ...current,

            categories: current.categories.map((category)=>{

                if(category.id!==categoryId){

                    return category;

                }

                return{

                    ...category,

                    questions:[

                        ...category.questions,

                        {

                            id:crypto.randomUUID(),

                            title:"",

                            description:"",

                            type:"yes_no",

                            weight:0,

                            required:true,

                        }

                    ]

                };

            })

        }));

    }

    function updateQuestion(categoryId,questionId,changes){

        setForm((current)=>({

            ...current,

            categories: current.categories.map((category)=>{

                if(category.id!==categoryId){

                    return category;

                }

                return{

                    ...category,

                    questions: category.questions.map((question)=>

                        question.id===questionId

                            ? {...question,...changes}

                            : question

                    )

                };

            })

        }));

    }

    function removeQuestion(categoryId,questionId){

        setForm((current)=>({

            ...current,

            categories: current.categories.map((category)=>{

                if(category.id!==categoryId){

                    return category;

                }

                return{

                    ...category,

                    questions: category.questions.filter(

                        (question)=>question.id!==questionId

                    )

                };

            })

        }));

    }

    return{

        step,

        next,

        back,

        reset,

        mode,

        setMode,

        form,

        setForm,

        addCategory,

        updateCategory,

        removeCategory,

        addQuestion,

        updateQuestion,

        removeQuestion,

    };

}
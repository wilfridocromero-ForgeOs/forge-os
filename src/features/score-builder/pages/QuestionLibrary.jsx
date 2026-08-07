import { useMemo, useState } from "react";

import QuestionSidebar from "../components/QuestionSidebar";
import QuestionToolbar from "../components/QuestionToolbar";
import QuestionList from "../components/QuestionList";
import QuestionEditor from "../components/QuestionEditor";

import useQuestionLibrary from "../hooks/useQuestionLibrary";

export default function QuestionLibrary() {

    const {

        questions,

        loading,

        refresh,

        createQuestion,

        updateQuestion,

        deleteQuestion,

        duplicateQuestion,

    } = useQuestionLibrary();

    const [search, setSearch] = useState("");

    const [division, setDivision] = useState("Digital");

    const [category, setCategory] = useState("Todas");

    const [selectedQuestion, setSelectedQuestion] = useState(null);

    const filteredQuestions = useMemo(() => {

        return questions.filter((question) => {

            const matchesCategory =
                category === "Todas"
                    ? true
                    : question.category === category;

            const text =
                `${question.title || ""} ${question.description || ""}`
                    .toLowerCase();

            const matchesSearch =
                text.includes(search.toLowerCase());

            return matchesCategory && matchesSearch;

        });

    }, [questions, category, search]);

    async function handleCreate() {

        const payload = {

            title: "Nueva pregunta",

            description: "",

            category,

            division,

            type: "yes_no",

            weight: 0,

            required: true,

            recommendation: "",

            sop: "",

            playbook: "",

        };

        const { data, error } = await createQuestion(payload);

        if (error) {

            console.error(error);

            return;

        }

        await refresh();

        setSelectedQuestion(data);

    }

    async function handleSave() {

        if (!selectedQuestion) return;

        const { error } = await updateQuestion(

            selectedQuestion.id,

            selectedQuestion

        );

        if (error) {

            console.error(error);

            return;

        }

        await refresh();

    }

    async function handleDelete() {

        if (!selectedQuestion) return;

        const ok = window.confirm(

            "¿Eliminar esta pregunta?"

        );

        if (!ok) return;

        const { error } = await deleteQuestion(

            selectedQuestion.id

        );

        if (error) {

            console.error(error);

            return;

        }

        setSelectedQuestion(null);

        await refresh();

    }

    async function handleDuplicate() {

        if (!selectedQuestion) return;

        const { error } = await duplicateQuestion(

            selectedQuestion

        );

        if (error) {

            console.error(error);

            return;

        }

        await refresh();

    }

    return (

        <div className="flex h-[calc(100vh-120px)] overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-950">

            <QuestionSidebar

                category={category}

                setCategory={setCategory}

            />

            <div className="flex flex-1 flex-col">

                <QuestionToolbar

                    search={search}

                    setSearch={setSearch}

                    division={division}

                    setDivision={setDivision}

                    onCreate={handleCreate}

                />

                <div className="flex-1 overflow-y-auto">

                    {loading ? (

                        <div className="flex h-full items-center justify-center">

                            <p className="text-zinc-500">

                                Cargando preguntas...

                            </p>

                        </div>

                    ) : (

                        <QuestionList

                            questions={filteredQuestions}

                            selectedQuestion={selectedQuestion}

                            onSelect={setSelectedQuestion}

                        />

                    )}

                </div>

            </div>

            <QuestionEditor

                question={selectedQuestion}

                onChange={setSelectedQuestion}

                onSave={handleSave}

                onDelete={handleDelete}

                onDuplicate={handleDuplicate}

            />

        </div>

    );

}
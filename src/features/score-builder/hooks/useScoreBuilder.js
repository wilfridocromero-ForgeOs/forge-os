import { useState } from "react";

const createInitialForm = () => ({
    name: "",
    description: "",

    // División real de la organización
    division_id: "",
    division_name: "",

    scale: 1000,
    categories: [],
});

function normalizeQuestionWeight(value) {
    const number = Number(value);

    if (!Number.isFinite(number)) {
        return 10;
    }

    return Math.min(
        100,
        Math.max(0, number)
    );
}

export default function useScoreBuilder() {
    const [step, setStep] = useState(0);

    const [mode, setMode] = useState("");

    const [form, setForm] = useState(
        createInitialForm()
    );

    function next() {
        setStep(
            (currentStep) =>
                currentStep + 1
        );
    }

    function back() {
        setStep(
            (currentStep) =>
                Math.max(
                    currentStep - 1,
                    0
                )
        );
    }

    function reset() {
        setStep(0);
        setMode("");
        setForm(
            createInitialForm()
        );
    }

    /*
    ==========================================
    CATEGORÍAS
    ==========================================
    */

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
                },
            ],
        }));
    }

    function updateCategory(
        id,
        changes
    ) {
        setForm((current) => ({
            ...current,

            categories:
                current.categories.map(
                    (category) =>
                        category.id === id
                            ? {
                                  ...category,
                                  ...changes,
                              }
                            : category
                ),
        }));
    }

    function removeCategory(id) {
        setForm((current) => ({
            ...current,

            categories:
                current.categories.filter(
                    (category) =>
                        category.id !== id
                ),
        }));
    }

    /*
    ==========================================
    PREGUNTAS
    ==========================================
    */

    function addQuestion(
        categoryId,
        questionData = {}
    ) {
        setForm((current) => ({
            ...current,

            categories:
                current.categories.map(
                    (category) => {

                        if (
                            category.id !==
                            categoryId
                        ) {
                            return category;
                        }

                        const incomingWeight =
                            questionData.weight ??
                            10;

                        return {
                            ...category,

                            questions: [
                                ...category.questions,

                                {
                                    id:
                                        crypto.randomUUID(),

                                    prompt: "",

                                    description: "",

                                    help_text: "",

                                    response_type:
                                        "yes_no",

                                    weight:
                                        normalizeQuestionWeight(
                                            incomingWeight
                                        ),

                                    priority:
                                        "medium",

                                    recommendation:
                                        "",

                                    sop: "",

                                    playbook: "",

                                    document: "",

                                    ai_prompt: "",

                                    tags: [],

                                    auto_project:
                                        false,

                                    required: true,

                                    scale_min: 1,

                                    scale_max: 5,

                                    options: [],

                                    scoring_config:
                                        {},

                                    ...questionData,

                                    // Se coloca al final para impedir
                                    // que questionData sobrescriba
                                    // el peso con un valor inválido.
                                    weight:
                                        normalizeQuestionWeight(
                                            incomingWeight
                                        ),
                                },
                            ],
                        };
                    }
                ),
        }));
    }

    function updateQuestion(
        categoryId,
        questionId,
        field,
        value
    ) {
        setForm((current) => ({
            ...current,

            categories:
                current.categories.map(
                    (category) => {

                        if (
                            category.id !==
                            categoryId
                        ) {
                            return category;
                        }

                        return {
                            ...category,

                            questions:
                                category.questions.map(
                                    (question) => {

                                        if (
                                            question.id !==
                                            questionId
                                        ) {
                                            return question;
                                        }

                                        /*
                                        ==================================
                                        PROTEGER PESO
                                        ==================================
                                        */

                                        if (
                                            field ===
                                            "weight"
                                        ) {
                                            return {
                                                ...question,

                                                weight:
                                                    normalizeQuestionWeight(
                                                        value
                                                    ),
                                            };
                                        }

                                        return {
                                            ...question,

                                            [field]:
                                                value,
                                        };
                                    }
                                ),
                        };
                    }
                ),
        }));
    }

    function removeQuestion(
        categoryId,
        questionId
    ) {
        setForm((current) => ({
            ...current,

            categories:
                current.categories.map(
                    (category) => {

                        if (
                            category.id !==
                            categoryId
                        ) {
                            return category;
                        }

                        return {
                            ...category,

                            questions:
                                category.questions.filter(
                                    (question) =>
                                        question.id !==
                                        questionId
                                ),
                        };
                    }
                ),
        }));
    }

    return {
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
import { useEffect, useState } from "react";

import {

    loadQuestions,
    loadCategories,
    loadQuestionsByDivision,
    searchQuestions,

    createQuestion,
    updateQuestion,
    deleteQuestion,
    duplicateQuestion,

} from "../services/QuestionLibraryService";

export default function useQuestionLibrary() {

    const [loading, setLoading] = useState(true);

    const [questions, setQuestions] = useState([]);

    const [categories, setCategories] = useState([]);

    async function reload() {

        setLoading(true);

        const [

            questionsResult,

            categoriesResult,

        ] = await Promise.all([

            loadQuestions(),

            loadCategories(),

        ]);

        if (!questionsResult.error) {

            setQuestions(questionsResult.data || []);

        }

        if (!categoriesResult.error) {

            setCategories(categoriesResult.data || []);

        }

        setLoading(false);

    }

    async function filterByDivision(divisionId) {

        setLoading(true);

        const { data, error } = await loadQuestionsByDivision(
            divisionId
        );

        if (!error) {

            setQuestions(data || []);

        }

        setLoading(false);

    }

    async function search(searchText) {

        if (!searchText) {

            reload();

            return;

        }

        setLoading(true);

        const { data, error } = await searchQuestions(
            searchText
        );

        if (!error) {

            setQuestions(data || []);

        }

        setLoading(false);

    }

    async function addQuestion(question) {

        const result = await createQuestion(question);

        if (!result.error) {

            await reload();

        }

        return result;

    }

    async function editQuestion(id, question) {

        const result = await updateQuestion(
            id,
            question
        );

        if (!result.error) {

            await reload();

        }

        return result;

    }

    async function removeQuestion(id) {

        const result = await deleteQuestion(id);

        if (!result.error) {

            await reload();

        }

        return result;

    }

    async function copyQuestion(id) {

        const result = await duplicateQuestion(id);

        if (!result.error) {

            await reload();

        }

        return result;

    }

    useEffect(() => {

        reload();

    }, []);

    return {

        loading,

        questions,

        categories,

        reload,

        search,

        filterByDivision,

        addQuestion,

        editQuestion,

        removeQuestion,

        copyQuestion,

    };

}
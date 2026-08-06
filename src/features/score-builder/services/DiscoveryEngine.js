/*
|--------------------------------------------------------------------------
| ORVESEN DISCOVERY ENGINE
|--------------------------------------------------------------------------
|
| Convierte un Score publicado en una evaluación interactiva.
| No depende de React.
| No modifica la base de datos.
|
*/

import { calculateScore } from "../../score-builder/services/ScoreEngine";

/*
|--------------------------------------------------------------------------
| Construye el formulario
|--------------------------------------------------------------------------
*/

export function buildDiscovery(template) {

    if (!template) return [];

    return (template.score_categories || []).map(category => ({

        id: category.id,

        name: category.name,

        description: category.description,

        weight: category.weight,

        questions: (category.score_questions || []).map(question => ({

            id: question.id,

            libraryId: question.library_question_id,

            title: question.prompt,

            description: question.help_text,

            response_type: question.response_type,

            required: question.required,

            weight: question.weight,

            scale_min: question.scale_min,

            scale_max: question.scale_max,

            options: question.options || [],

            answer: null,

        })),

    }));

}

/*
|--------------------------------------------------------------------------
| Registrar respuesta
|--------------------------------------------------------------------------
*/

export function updateAnswer(categories, questionId, value) {

    return categories.map(category => ({

        ...category,

        questions: category.questions.map(question =>

            question.id === questionId

                ? {
                      ...question,
                      answer: value,
                  }

                : question

        ),

    }));

}

/*
|--------------------------------------------------------------------------
| Calcular progreso
|--------------------------------------------------------------------------
*/

export function getProgress(categories) {

    let total = 0;

    let answered = 0;

    categories.forEach(category => {

        category.questions.forEach(question => {

            total++;

            if (

                question.answer !== null &&
                question.answer !== "" &&
                question.answer !== undefined

            ) {

                answered++;

            }

        });

    });

    return {

        answered,

        total,

        percentage:

            total === 0

                ? 0

                : Math.round((answered / total) * 100),

    };

}

/*
|--------------------------------------------------------------------------
| Resultado completo
|--------------------------------------------------------------------------
*/

export function finishDiscovery(categories) {

    const score = calculateScore(categories);

    const progress = getProgress(categories);

    return {

        completed: progress.percentage === 100,

        progress,

        score,

        finishedAt: new Date().toISOString(),

    };

}

/*
|--------------------------------------------------------------------------
| Recomendaciones automáticas
|--------------------------------------------------------------------------
*/

export function generateRecommendations(result) {

    const recommendations = [];

    result.score.details.forEach(category => {

        if (category.score >= 850) return;

        recommendations.push({

            category: category.category,

            priority:

                category.score < 400
                    ? "critical"
                    : category.score < 650
                    ? "high"
                    : "medium",

            message:

                `Mejorar ${category.category} para aumentar el Score.`,

        });

    });

    return recommendations;

}

/*
|--------------------------------------------------------------------------
| Generar proyectos automáticamente
|--------------------------------------------------------------------------
*/

export function createSuggestedProjects(result) {

    const projects = [];

    result.score.details.forEach(category => {

        if (category.score >= 700) return;

        projects.push({

            title:

                `Optimizar ${category.category}`,

            priority:

                category.score < 400
                    ? "urgent"
                    : "high",

            source: "Discovery",

            estimated_score:

                category.score,

        });

    });

    return projects;

}
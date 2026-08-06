/**
 * ORVESEN Score Engine
 * validate.js
 */

export default function validate(form) {
    const errors = [];

    if (!form) {
        return {
            valid: false,
            errors: ["No se recibió ninguna evaluación."],
        };
    }

    // -----------------------
    // Información básica
    // -----------------------

    if (!form.name?.trim()) {
        errors.push("La evaluación necesita un nombre.");
    }

    if (!form.division?.trim()) {
        errors.push("Debes seleccionar una división.");
    }

    if (!form.scale) {
        errors.push("Debes definir una escala.");
    }

    // -----------------------
    // Categorías
    // -----------------------

    if (!Array.isArray(form.categories)) {
        errors.push("Las categorías son inválidas.");
    }

    if (form.categories.length === 0) {
        errors.push("Debes crear al menos una categoría.");
    }

    let totalCategoryWeight = 0;

    form.categories.forEach((category, categoryIndex) => {

        if (!category.name?.trim()) {
            errors.push(
                `La categoría #${categoryIndex + 1} no tiene nombre.`
            );
        }

        const categoryWeight = Number(category.weight || 0);

        totalCategoryWeight += categoryWeight;

        if (!Array.isArray(category.questions)) {
            errors.push(
                `La categoría "${category.name}" no tiene preguntas.`
            );
            return;
        }

        if (category.questions.length === 0) {
            errors.push(
                `La categoría "${category.name}" debe contener preguntas.`
            );
        }

        let totalQuestionWeight = 0;

        category.questions.forEach((question, questionIndex) => {

            if (!question.title?.trim()) {
                errors.push(
                    `Pregunta ${questionIndex + 1} en "${category.name}" sin título.`
                );
            }

            const questionWeight = Number(question.weight || 0);

            totalQuestionWeight += questionWeight;

            if (!question.response_type) {
                errors.push(
                    `"${question.title}" no tiene tipo de respuesta.`
                );
            }

        });

        if (Math.round(totalQuestionWeight) !== 100) {

            errors.push(
                `Las preguntas de "${category.name}" deben sumar 100%. Actualmente suman ${totalQuestionWeight}%.`
            );

        }

    });

    if (Math.round(totalCategoryWeight) !== 100) {

        errors.push(
            `Las categorías deben sumar 100%. Actualmente suman ${totalCategoryWeight}%.`
        );

    }

    // -----------------------
    // Resultado
    // -----------------------

    return {

        valid: errors.length === 0,

        errors,

    };
}
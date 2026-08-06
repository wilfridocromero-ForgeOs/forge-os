/**
 * ORVESEN Score Engine
 * calculate.js
 */

export default function calculate(template, answers = {}) {

    if (!template) {
        return null;
    }

    let totalScore = 0;

    const categories = [];

    for (const category of template.categories || []) {

        let categoryScore = 0;

        const questions = [];

        for (const question of category.questions || []) {

            const answer = answers[question.id];

            let percentage = 0;

            switch (question.response_type) {

                case "yes_no":

                    percentage = answer ? 100 : 0;

                    break;

                case "scale":

                    percentage =
                        ((Number(answer || 0) - 1) /
                            ((question.scale_max || 5) - 1)) *
                        100;

                    break;

                case "number":

                    percentage = Math.min(
                        100,
                        Number(answer || 0)
                    );

                    break;

                default:

                    percentage = 0;

            }

            const questionScore =
                (percentage * Number(question.weight || 0)) / 100;

            categoryScore += questionScore;

            questions.push({

                id: question.id,

                title: question.title,

                answer,

                percentage,

                score: questionScore,

            });

        }

        const finalCategoryScore =
            (categoryScore * Number(category.weight || 0)) / 100;

        totalScore += finalCategoryScore;

        categories.push({

            id: category.id,

            name: category.name,

            weight: category.weight,

            score: finalCategoryScore,

            questions,

        });

    }

    const percentage = Math.round(totalScore);

    return {

        score: percentage,

        percentage,

        status:
            percentage >= 90
                ? "excellent"
                : percentage >= 80
                ? "good"
                : percentage >= 60
                ? "average"
                : "critical",

        categories,

    };

}
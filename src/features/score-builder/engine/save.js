import { supabase } from "../../../lib/supabase";

export default async function save(form, profile, user) {

    // ===========================
    // Crear plantilla
    // ===========================

    const templateResult = await supabase
        .from("score_templates")
        .insert({

            organization_id: profile.organization_id,

            division_id: form.division,

            name: form.name,

            description: form.description,

            created_by: user.id,

            template_kind: "score",

        })
        .select()
        .single();

    if (templateResult.error) {

        throw templateResult.error;

    }

    const template = templateResult.data;

    // ===========================
    // Crear categorías
    // ===========================

    for (let categoryIndex = 0; categoryIndex < form.categories.length; categoryIndex++) {

        const category = form.categories[categoryIndex];

        const categoryResult = await supabase

            .from("score_categories")

            .insert({

                template_id: template.id,

                name: category.name,

                description: category.description || "",

                weight: Number(category.weight),

                position: categoryIndex,

            })

            .select()

            .single();

        if (categoryResult.error) {

            throw categoryResult.error;

        }

        const savedCategory = categoryResult.data;
                // ===========================
        // Crear preguntas
        // ===========================

        for (
            let questionIndex = 0;
            questionIndex < category.questions.length;
            questionIndex++
        ) {

            const question = category.questions[questionIndex];

            const questionResult = await supabase

                .from("score_questions")

                .insert({

                    category_id: savedCategory.id,

                    library_question_id:
                        question.libraryId || null,

                    prompt: question.title,

                    help_text:
                        question.description || "",

                    response_type:
                        question.response_type,

                    weight:
                        Number(question.weight),

                    required: true,

                    position: questionIndex,

                    scale_min: 1,

                    scale_max: 5,

                    options: [],

                    scoring_config: {},

                })

                .select()

                .single();

            if (questionResult.error) {

                throw questionResult.error;

            }

        }

    }

    // ===========================
    // Terminado
    // ===========================

    return {

        success: true,

        template,

    };

}
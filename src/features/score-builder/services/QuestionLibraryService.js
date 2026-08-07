import { supabase } from "../../../lib/supabase";

/*
|--------------------------------------------------------------------------
| CATEGORÍAS
|--------------------------------------------------------------------------
*/

export async function loadCategories() {
    return await supabase
        .from("score_library_categories")
        .select("*")
        .eq("active", true)
        .order("position");
}

/*
|--------------------------------------------------------------------------
| CARGAR TODA LA BIBLIOTECA
|--------------------------------------------------------------------------
*/

export async function loadQuestions() {
    return await supabase
        .from("score_library_questions")
        .select(`
            *,
            score_library_categories(
                id,
                name,
                division_id
            )
        `)
        .eq("active", true)
        .order("title");
}

/*
|--------------------------------------------------------------------------
| FILTRAR POR DIVISIÓN
|--------------------------------------------------------------------------
*/

export async function loadQuestionsByDivision(divisionId) {

    if (!divisionId) {
        return loadQuestions();
    }

    return await supabase
        .from("score_library_questions")
        .select(`
            *,
            score_library_categories(
                id,
                name,
                division_id
            )
        `)
        .eq("active", true)
        .eq("score_library_categories.division_id", divisionId)
        .order("title");
}

/*
|--------------------------------------------------------------------------
| OBTENER UNA PREGUNTA
|--------------------------------------------------------------------------
*/

export async function getQuestion(id) {

    return await supabase
        .from("score_library_questions")
        .select(`
            *,
            score_library_categories(
                id,
                name,
                division_id
            )
        `)
        .eq("id", id)
        .maybeSingle();

}

/*
|--------------------------------------------------------------------------
| CREAR
|--------------------------------------------------------------------------
*/

export async function createQuestion(question) {

    return await supabase

        .from("score_library_questions")

        .insert({

            category_id: question.category_id,

            title: question.title,

            description: question.description,

            response_type: question.response_type,

            recommended_weight: question.recommended_weight,

            difficulty: question.difficulty,

            priority: question.priority,

            recommendation: question.recommendation,

            score_value: question.score_value,

            options: question.options || [],

            tags: question.tags || [],

            active: true,

        })

        .select()

        .single();

}

/*
|--------------------------------------------------------------------------
| ACTUALIZAR
|--------------------------------------------------------------------------
*/

export async function updateQuestion(id,data){

    return await supabase

        .from("score_library_questions")

        .update({

            ...data,

            updated_at:new Date().toISOString(),

        })

        .eq("id",id)

        .select()

        .single();

}

/*
|--------------------------------------------------------------------------
| ELIMINAR
|--------------------------------------------------------------------------
*/

export async function deleteQuestion(id){

    return await supabase

        .from("score_library_questions")

        .delete()

        .eq("id",id);

}

/*
|--------------------------------------------------------------------------
| ARCHIVAR
|--------------------------------------------------------------------------
*/

export async function archiveQuestion(id){

    return await supabase

        .from("score_library_questions")

        .update({

            active:false,

            updated_at:new Date().toISOString(),

        })

        .eq("id",id);

}

/*
|--------------------------------------------------------------------------
| RESTAURAR
|--------------------------------------------------------------------------
*/

export async function restoreQuestion(id){

    return await supabase

        .from("score_library_questions")

        .update({

            active:true,

            updated_at:new Date().toISOString(),

        })

        .eq("id",id);

}

/*
|--------------------------------------------------------------------------
| DUPLICAR
|--------------------------------------------------------------------------
*/

export async function duplicateQuestion(id){

    const {data,error}=await getQuestion(id);

    if(error) return {error};

    return await createQuestion({

        category_id:data.category_id,

        title:`${data.title} (Copia)`,

        description:data.description,

        response_type:data.response_type,

        recommended_weight:data.recommended_weight,

        difficulty:data.difficulty,

        priority:data.priority,

        recommendation:data.recommendation,

        score_value:data.score_value,

        options:data.options||[],

        tags:data.tags||[],

    });

}

/*
|--------------------------------------------------------------------------
| BUSCAR
|--------------------------------------------------------------------------
*/

export async function searchQuestions(search=""){

    if(!search){

        return loadQuestions();

    }

    return await supabase

        .from("score_library_questions")

        .select(`
            *,
            score_library_categories(
                id,
                name,
                division_id
            )
        `)

        .or(`title.ilike.%${search}%,description.ilike.%${search}%,tags.cs.{${search}}`)

        .eq("active",true)

        .order("title");

}
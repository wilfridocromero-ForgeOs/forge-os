import { supabase } from "../../../lib/supabase";

export async function createScore(data) {

    const result = await supabase
        .from("score_templates")
        .insert(data)
        .select()
        .single();

    return result;

}

export async function updateScore(id, data) {

    const result = await supabase
        .from("score_templates")
        .update(data)
        .eq("id", id)
        .select()
        .single();

    return result;

}

export async function deleteScore(id) {

    return await supabase
        .from("score_templates")
        .delete()
        .eq("id", id);

}

export async function loadScore(id) {

    return await supabase
        .from("score_templates")
        .select(`
            *,
            score_categories(
                *,
                score_questions(*)
            )
        `)
        .eq("id", id)
        .single();

}

export async function listScores() {

    return await supabase
        .from("score_templates")
        .select("*")
        .order("updated_at", {
            ascending: false,
        });

}

export async function duplicateScore(id, name) {

    const { data, error } = await loadScore(id);

    if (error) return { error };

    const copy = {

        ...data,

        id: undefined,

        name,

        created_at: undefined,

        updated_at: undefined,

    };

    return createScore(copy);

}

export async function publishScore(id) {

    return await updateScore(id, {

        status: "published",

        published_at: new Date().toISOString(),

    });

}

export async function archiveScore(id) {

    return await updateScore(id, {

        status: "archived",

    });

}
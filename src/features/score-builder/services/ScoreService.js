import { supabase } from "../../../lib/supabase";

/*
|--------------------------------------------------------------------------
| SCORE TEMPLATES
|--------------------------------------------------------------------------
*/

export async function loadTemplates() {
  return supabase
    .from("score_templates")
    .select(`
      *,
      divisions(name),
      score_categories(
        *,
        score_questions(*)
      )
    `)
    .order("updated_at", { ascending: false });
}

export async function loadOfficialLibrary() {
  return supabase
    .from("score_library_categories")
    .select(`
      *,
      score_library_questions(*)
    `)
    .eq("is_official", true)
    .order("position");
}

export async function createTemplate(data) {
  return supabase
    .from("score_templates")
    .insert(data)
    .select()
    .single();
}

export async function updateTemplate(id, data) {
  return supabase
    .from("score_templates")
    .update(data)
    .eq("id", id);
}

export async function deleteTemplate(id) {
  return supabase
    .from("score_templates")
    .delete()
    .eq("id", id);
}

export async function publishTemplate(id) {
  return supabase
    .from("score_templates")
    .update({
      status: "published",
      published_at: new Date().toISOString(),
    })
    .eq("id", id);
}

/*
|--------------------------------------------------------------------------
| CATEGORIES
|--------------------------------------------------------------------------
*/

export async function createCategory(data) {
  return supabase
    .from("score_categories")
    .insert(data)
    .select()
    .single();
}

export async function updateCategory(id, data) {
  return supabase
    .from("score_categories")
    .update(data)
    .eq("id", id);
}

export async function deleteCategory(id) {
  return supabase
    .from("score_categories")
    .delete()
    .eq("id", id);
}

/*
|--------------------------------------------------------------------------
| QUESTIONS
|--------------------------------------------------------------------------
*/

export async function createQuestion(data) {
  return supabase
    .from("score_questions")
    .insert(data)
    .select()
    .single();
}

export async function updateQuestion(id, data) {
  return supabase
    .from("score_questions")
    .update(data)
    .eq("id", id);
}

export async function deleteQuestion(id) {
  return supabase
    .from("score_questions")
    .delete()
    .eq("id", id);
}
import { supabase } from "../../../lib/supabase";

/* ===========================
   CARGAR SCORE BUILDER
=========================== */

export async function fetchTemplates(userId) {
  return Promise.all([
    supabase
      .from("score_templates")
      .select(`
        id,
        name,
        description,
        status,
        template_kind,
        source_template_id,
        division_id,
        max_score,
        published_at,
        divisions(name),
        score_instances(
          id,
          current_score,
          max_score,
          percentage,
          status,
          computed_at
        ),
        score_metrics(
          id,
          code,
          name,
          source_type,
          weight,
          target_value,
          active
        ),
        score_categories(
          id,
          name,
          description,
          weight,
          position,
          score_questions(
            id,
            prompt,
            help_text,
            response_type,
            weight,
            required,
            position,
            library_question_id,
            scale_min,
            scale_max,
            options,
            scoring_config
          )
        )
      `)
      .order("updated_at", { ascending: false }),

    supabase
      .from("score_library_categories")
      .select(`
        id,
        name,
        description,
        position,
        is_official,
        divisions(name),
        score_library_questions(
          id,
          title,
          description,
          recommended_weight,
          difficulty,
          response_type,
          options
        )
      `)
      .eq("is_official", true)
      .order("position"),

    supabase
      .from("score_template_favorites")
      .select("template_id")
      .eq("user_id", userId),
  ]);
}

/* ===========================
   GUARDAR BORRADOR
=========================== */

export async function saveTemplate(templateId, data) {
  return supabase
    .from("score_templates")
    .update({
      ...data,
      updated_at: new Date().toISOString(),
    })
    .eq("id", templateId);
}

/* ===========================
   PUBLICAR
=========================== */

export async function publishTemplate(templateId) {
  return supabase
    .from("score_templates")
    .update({
      status: "published",
      published_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", templateId);
}

/* ===========================
   ELIMINAR
=========================== */

export async function deleteTemplate(templateId) {
  return supabase
    .from("score_templates")
    .delete()
    .eq("id", templateId);
}
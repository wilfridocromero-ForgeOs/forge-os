import { supabase } from "../../../lib/supabase";

const templateSelect = `
  id, organization_id, division_id, name, description, status, version,
  created_by, published_at, created_at, updated_at, divisions(name),
  discovery_sections(
    id, template_id, title, description, position, created_at, updated_at,
    discovery_questions(
      id, section_id, prompt, help_text, response_type, options, required,
      position, question_kind, created_at, updated_at,
      discovery_question_score_links(
        id, discovery_question_id, score_question_id, mapping_config, active, position
      )
    )
  )
`;

export function normalizeTemplate(template) {
  return {
    ...template,
    discovery_sections: [...(template.discovery_sections || [])]
      .sort((a, b) => a.position - b.position)
      .map((section) => ({
        ...section,
        discovery_questions: [...(section.discovery_questions || [])]
          .sort((a, b) => a.position - b.position)
          .map((question) => ({
            ...question,
            options: Array.isArray(question.options) ? question.options : [],
            discovery_question_score_links: [...(question.discovery_question_score_links || [])]
              .sort((a, b) => a.position - b.position),
          })),
      })),
  };
}

export async function getDiscoveryBuilderData() {
  const [templatesResult, scoresResult] = await Promise.all([
    supabase.from("discovery_templates").select(templateSelect).order("updated_at", { ascending: false }),
    supabase.from("score_templates")
      .select("id, name, status, score_categories(id, name, position, score_questions(id, prompt, response_type, position))")
      .order("name"),
  ]);

  if (templatesResult.error) throw templatesResult.error;
  if (scoresResult.error) throw scoresResult.error;

  return {
    templates: (templatesResult.data || []).map(normalizeTemplate),
    scoreTemplates: (scoresResult.data || []).map((template) => ({
      ...template,
      score_categories: [...(template.score_categories || [])]
        .sort((a, b) => a.position - b.position)
        .map((category) => ({
          ...category,
          score_questions: [...(category.score_questions || [])].sort((a, b) => a.position - b.position),
        })),
    })),
  };
}

export async function createDiscoveryTemplate(payload) {
  const { data, error } = await supabase.from("discovery_templates").insert(payload).select("id").single();
  if (error) throw error;
  return data;
}

export async function updateDiscoveryTemplate(id, changes) {
  const { error } = await supabase.from("discovery_templates").update(changes).eq("id", id);
  if (error) throw error;
}

export async function deleteDiscoveryTemplate(id) {
  const { error } = await supabase.from("discovery_templates").delete().eq("id", id);
  if (error) throw error;
}

export async function createSection(payload) {
  const { data, error } = await supabase.from("discovery_sections").insert(payload)
    .select("id, template_id, title, description, position, created_at, updated_at").single();
  if (error) throw error;
  return { ...data, discovery_questions: [] };
}

export async function updateSection(id, changes) {
  const { error } = await supabase.from("discovery_sections").update(changes).eq("id", id);
  if (error) throw error;
}

export async function deleteSection(id) {
  const { error } = await supabase.from("discovery_sections").delete().eq("id", id);
  if (error) throw error;
}

export async function createQuestion(payload) {
  const { data, error } = await supabase.from("discovery_questions").insert(payload)
    .select("id, section_id, prompt, help_text, response_type, options, required, position, question_kind, created_at, updated_at").single();
  if (error) throw error;
  return { ...data, discovery_question_score_links: [] };
}

export async function updateQuestion(id, changes) {
  const { error } = await supabase.from("discovery_questions").update(changes).eq("id", id);
  if (error) throw error;
}

export async function deleteQuestion(id) {
  const { error } = await supabase.from("discovery_questions").delete().eq("id", id);
  if (error) throw error;
}

export async function replaceScoreLink(questionId, scoreQuestionId) {
  const removed = await supabase.from("discovery_question_score_links").delete().eq("discovery_question_id", questionId);
  if (removed.error) throw removed.error;
  if (!scoreQuestionId) return false;

  const { data, error } = await supabase.from("discovery_question_score_links").insert({
    discovery_question_id: questionId,
    score_question_id: scoreQuestionId,
    active: true,
    position: 0,
  }).select("id, discovery_question_id, score_question_id, mapping_config, active, position").single();
  if (error) throw error;
  return data;
}

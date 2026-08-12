import { supabase } from "../../../lib/supabase";

const publishedTemplateSelect = `
  id, organization_id, division_id, name, description, status, version, published_at,
  divisions(name),
  discovery_sections(
    id, title, description, position,
    discovery_questions(
      id, prompt, help_text, response_type, options, required, position, question_kind,
      discovery_question_score_links(
        id, score_question_id, active,
        score_questions(id, response_type, scale_min, scale_max, options)
      )
    )
  )
`;

const assessmentSelect = `
  id, organization_id, division_id, client_id, discovery_template_id, status,
  score, max_score, completed_at, created_by, created_at, updated_at,
  maturity_level, diagnosis, started_at,
  clients(id, company_name, contact_name, industry, division_id),
  discovery_templates(${publishedTemplateSelect}),
  discovery_responses(
    id, discovery_question_id, question_id, response_value, numeric_score,
    answered_by, created_at, updated_at
  ),
  discovery_category_results(
    id, category_id, score, max_score, percentage, status,
    score_categories(id, name, description, weight, position)
  ),
  discovery_recommendations(id, category_id, title, reason, priority, status)
`;

function sortTemplate(template) {
  if (!template) return template;
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
            discovery_question_score_links: (question.discovery_question_score_links || [])
              .filter((link) => link.active),
          })),
      })),
  };
}

export function normalizeAssessment(assessment) {
  return {
    ...assessment,
    discovery_templates: sortTemplate(assessment.discovery_templates),
    discovery_responses: assessment.discovery_responses || [],
    discovery_category_results: [...(assessment.discovery_category_results || [])]
      .sort((a, b) => (a.score_categories?.position || 0) - (b.score_categories?.position || 0)),
    discovery_recommendations: [...(assessment.discovery_recommendations || [])]
      .sort((a, b) => a.priority - b.priority),
  };
}

export async function getExecutionDashboardData() {
  const [templatesResult, clientsResult, assessmentsResult] = await Promise.all([
    supabase.from("discovery_templates")
      .select(publishedTemplateSelect)
      .eq("status", "published")
      .order("published_at", { ascending: false }),
    supabase.from("clients")
      .select("id, organization_id, workspace_organization_id, company_name, contact_name, industry, division_id, status")
      .order("company_name"),
    supabase.from("discovery_assessments")
      .select(assessmentSelect)
      .not("discovery_template_id", "is", null)
      .order("updated_at", { ascending: false }),
  ]);

  const error = templatesResult.error || clientsResult.error || assessmentsResult.error;
  if (error) throw error;

  return {
    templates: (templatesResult.data || []).map(sortTemplate),
    clients: clientsResult.data || [],
    assessments: (assessmentsResult.data || []).map(normalizeAssessment),
  };
}

export async function createAssessment({ organizationId, template, client, userId }) {
  const { data, error } = await supabase.from("discovery_assessments").insert({
    organization_id: organizationId,
    client_id: client.id,
    discovery_template_id: template.id,
    division_id: template.division_id || client.division_id || null,
    status: "in_progress",
    max_score: 100,
    created_by: userId,
  }).select("id").single();

  if (error) throw error;
  return data;
}

export async function getAssessment(assessmentId) {
  const { data, error } = await supabase.from("discovery_assessments")
    .select(assessmentSelect)
    .eq("id", assessmentId)
    .single();

  if (error) throw error;
  return normalizeAssessment(data);
}

export async function saveDiscoveryResponse({ assessmentId, question, value, userId, existingResponse }) {
  const link = question.discovery_question_score_links?.[0] || null;
  const payload = {
    assessment_id: assessmentId,
    discovery_question_id: question.id,
    question_id: link?.score_question_id || null,
    response_value: value,
    answered_by: userId,
  };

  if (existingResponse?.id) {
    const { data, error } = await supabase.from("discovery_responses")
      .update(payload)
      .eq("id", existingResponse.id)
      .select("id, discovery_question_id, question_id, response_value, numeric_score, answered_by, created_at, updated_at")
      .single();
    if (error) throw error;
    return data;
  }

  const { data, error } = await supabase.from("discovery_responses")
    .insert(payload)
    .select("id, discovery_question_id, question_id, response_value, numeric_score, answered_by, created_at, updated_at")
    .single();

  if (!error) return data;
  if (error.code !== "23505") throw error;

  const existing = await supabase.from("discovery_responses")
    .select("id")
    .eq("assessment_id", assessmentId)
    .eq("discovery_question_id", question.id)
    .single();
  if (existing.error) throw existing.error;

  const retried = await supabase.from("discovery_responses")
    .update(payload)
    .eq("id", existing.data.id)
    .select("id, discovery_question_id, question_id, response_value, numeric_score, answered_by, created_at, updated_at")
    .single();
  if (retried.error) throw retried.error;
  return retried.data;
}

export async function deleteDiscoveryResponse(responseId) {
  const { error } = await supabase.from("discovery_responses").delete().eq("id", responseId);
  if (error) throw error;
}

export async function finalizeAssessment(assessmentId) {
  const { data, error } = await supabase.rpc("finalize_discovery", {
    target_assessment_id: assessmentId,
  });
  if (error) throw error;
  return data;
}

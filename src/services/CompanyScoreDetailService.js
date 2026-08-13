import { supabase } from "../lib/supabase";
import { getCompanyScoreDashboard } from "./CompanyScoreService";

async function query(table, fields, apply) {
  let request = supabase.from(table).select(fields);
  request = apply ? apply(request) : request;
  const { data, error } = await request;
  if (error) throw error;
  return data || [];
}

export async function getCompanyScoreDetail(organizationId) {
  const base = await getCompanyScoreDashboard(organizationId);
  if (!base.model) return { ...base, templatesByDivision: {} };

  const represented = base.divisions.filter((division) => division.score);
  const snapshotIds = represented.map((division) => division.score.id);
  if (!snapshotIds.length) return { ...base, templatesByDivision: {} };

  const snapshotComponents = await query(
    "division_score_snapshot_components",
    "id,snapshot_id,template_id,template_result_id,configured_weight,represented,template_score_percentage,template_coverage_percentage,created_at",
    (request) => request.eq("organization_id", organizationId).in("snapshot_id", snapshotIds),
  );
  const templateIds = [...new Set(snapshotComponents.map((item) => item.template_id))];
  const resultIds = [...new Set(snapshotComponents.map((item) => item.template_result_id).filter(Boolean))];

  const [templates, results] = await Promise.all([
    query("score_templates", "id,name,description,status,version", (request) => request.eq("organization_id", organizationId).in("id", templateIds)),
    resultIds.length ? query("score_template_results", "id,division_id,template_id,assessment_id,source_type,score_percentage,coverage_percentage,status,evaluated_at", (request) => request.eq("organization_id", organizationId).in("id", resultIds)) : [],
  ]);
  const assessmentIds = [...new Set(results.map((result) => result.assessment_id).filter(Boolean))];

  const [categoryResults, responses] = assessmentIds.length ? await Promise.all([
    query("discovery_category_results", "id,assessment_id,category_id,score,max_score,percentage,status", (request) => request.in("assessment_id", assessmentIds)),
    query("discovery_responses", "id,assessment_id,question_id,discovery_question_id,response_value,numeric_score,created_at", (request) => request.in("assessment_id", assessmentIds)),
  ]) : [[], []];

  const categoryIds = [...new Set(categoryResults.map((item) => item.category_id))];
  const discoveryQuestionIds = [...new Set(responses.map((item) => item.discovery_question_id).filter(Boolean))];
  const directScoreQuestionIds = responses.map((item) => item.question_id).filter(Boolean);
  const [categories, discoveryQuestions, links] = await Promise.all([
    categoryIds.length ? query("score_categories", "id,template_id,name,description,weight,position", (request) => request.in("id", categoryIds)) : [],
    discoveryQuestionIds.length ? query("discovery_questions", "id,prompt,response_type,question_kind,position", (request) => request.in("id", discoveryQuestionIds)) : [],
    discoveryQuestionIds.length ? query("discovery_question_score_links", "id,discovery_question_id,score_question_id,active,position", (request) => request.in("discovery_question_id", discoveryQuestionIds).eq("active", true)) : [],
  ]);
  const scoreQuestionIds = [...new Set([...directScoreQuestionIds, ...links.map((link) => link.score_question_id)])];
  const scoreQuestions = scoreQuestionIds.length
    ? await query("score_questions", "id,category_id,prompt,response_type,weight,position", (request) => request.in("id", scoreQuestionIds))
    : [];

  const templateById = new Map(templates.map((item) => [item.id, item]));
  const resultById = new Map(results.map((item) => [item.id, item]));
  const categoryById = new Map(categories.map((item) => [item.id, item]));
  const discoveryQuestionById = new Map(discoveryQuestions.map((item) => [item.id, item]));
  const scoreQuestionById = new Map(scoreQuestions.map((item) => [item.id, item]));
  const linksByDiscoveryQuestion = new Map();
  links.forEach((link) => {
    const list = linksByDiscoveryQuestion.get(link.discovery_question_id) || [];
    list.push(link);
    linksByDiscoveryQuestion.set(link.discovery_question_id, list);
  });

  const categoriesByAssessment = new Map();
  categoryResults.forEach((result) => {
    const category = categoryById.get(result.category_id);
    const item = { ...result, category, evidence: [] };
    const list = categoriesByAssessment.get(result.assessment_id) || [];
    list.push(item);
    categoriesByAssessment.set(result.assessment_id, list);
  });
  responses.forEach((response) => {
    const linkedIds = (linksByDiscoveryQuestion.get(response.discovery_question_id) || []).map((link) => link.score_question_id);
    if (response.question_id) linkedIds.push(response.question_id);
    [...new Set(linkedIds)].forEach((questionId) => {
      const scoreQuestion = scoreQuestionById.get(questionId);
      if (!scoreQuestion) return;
      const category = (categoriesByAssessment.get(response.assessment_id) || []).find((item) => item.category_id === scoreQuestion.category_id);
      if (!category || category.evidence.some((item) => item.response_id === response.id && item.score_question_id === questionId)) return;
      category.evidence.push({
        response_id: response.id,
        score_question_id: questionId,
        discovery_question: discoveryQuestionById.get(response.discovery_question_id)?.prompt || null,
        score_question: scoreQuestion.prompt,
        response_value: response.response_value,
        numeric_score: response.numeric_score,
      });
    });
  });

  const divisionBySnapshot = new Map(represented.map((division) => [division.score.id, division.id]));
  const templatesByDivision = {};
  snapshotComponents.forEach((component) => {
    const divisionId = divisionBySnapshot.get(component.snapshot_id);
    if (!divisionId) return;
    const result = resultById.get(component.template_result_id) || null;
    const categoryItems = result?.assessment_id ? (categoriesByAssessment.get(result.assessment_id) || []) : [];
    categoryItems.sort((a, b) => (a.category?.position ?? 0) - (b.category?.position ?? 0));
    const list = templatesByDivision[divisionId] || [];
    list.push({ ...component, template: templateById.get(component.template_id) || null, result, categories: categoryItems });
    templatesByDivision[divisionId] = list;
  });

  return { ...base, templatesByDivision };
}

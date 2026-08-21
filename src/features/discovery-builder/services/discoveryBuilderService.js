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

const librarySelect = `
  id, category_id, title, description, response_type, options, active,
  score_library_categories(id, name, organization_id, division_id, is_official)
`;

const LIBRARY_PAGE_SIZE = 200;

function libraryResponseType(responseType) {
  return responseType === "yes_no" ? "boolean" : responseType;
}

function normalizeLibraryTitle(value) {
  return String(value || "").trim().replace(/\s+/g, " ").toLocaleLowerCase("es");
}

function libraryCategorySlug(value) {
  return normalizeLibraryTitle(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "seccion";
}

async function getPrivateLibraryQuestions(categoryId) {
  const { data, error } = await supabase.from("score_library_questions")
    .select(librarySelect).eq("category_id", categoryId);
  if (error) throw error;
  return data || [];
}

async function getOrCreateDiscoveryLibraryCategory({ organizationId, divisionId, categoryName, createdBy }) {
  const name = String(categoryName || "").trim().replace(/\s+/g, " ");
  const slug = libraryCategorySlug(name);
  const categoryQuery = () => {
    let query = supabase.from("score_library_categories").select("id")
      .eq("organization_id", organizationId).eq("slug", slug).eq("is_official", false);
    query = divisionId ? query.eq("division_id", divisionId) : query.is("division_id", null);
    return query.maybeSingle();
  };
  const existing = await categoryQuery();
  if (existing.error) throw existing.error;
  if (existing.data) return existing.data.id;
  const created = await supabase.from("score_library_categories").insert({
    organization_id: organizationId, division_id: divisionId || null,
    name, slug,
    description: `Preguntas reutilizables de la sección ${name}.`,
    is_official: false, created_by: createdBy,
  }).select("id").single();
  if (!created.error) return created.data.id;
  if (created.error.code !== "23505") throw created.error;
  const racedCategory = await categoryQuery();
  if (racedCategory.error) throw racedCategory.error;
  if (!racedCategory.data) throw created.error;
  return racedCategory.data.id;
}

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
      .select("id, name, status, score_categories(id, name, position, score_questions(id, prompt, response_type, position, scale_min, scale_max, options, scoring_config))")
      .eq("status", "published")
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

export async function getDiscoveryLibraryQuestions({ organizationId, divisionId }) {
  if (!organizationId || !divisionId) return { categories: [], questions: [] };

  const categoriesResult = await supabase.from("score_library_categories")
    .select("id, name, organization_id, division_id, is_official, position")
    .eq("division_id", divisionId)
    .or(`is_official.eq.true,organization_id.eq.${organizationId}`)
    .order("position")
    .order("name");
  if (categoriesResult.error) throw categoriesResult.error;

  const categories = categoriesResult.data || [];
  if (!categories.length) return { categories: [], questions: [] };

  const categoryById = new Map(categories.map((category) => [category.id, category]));
  const questions = [];
  for (let from = 0; ; from += LIBRARY_PAGE_SIZE) {
    const page = await supabase.from("score_library_questions")
      .select("id, category_id, title, description, response_type, options, active")
      .in("category_id", categories.map((category) => category.id))
      .eq("active", true)
      .order("title")
      .order("id")
      .range(from, from + LIBRARY_PAGE_SIZE - 1);
    if (page.error) throw page.error;
    const rows = page.data || [];
    questions.push(...rows.map((question) => ({
      ...question,
      score_library_categories: categoryById.get(question.category_id),
    })));
    if (rows.length < LIBRARY_PAGE_SIZE) break;
  }

  return { categories, questions };
}

export async function saveDiscoveryQuestionToLibrary({ question, organizationId, divisionId, categoryName, createdBy }) {
  const normalizedTitle = normalizeLibraryTitle(question.prompt);
  const responseType = libraryResponseType(question.response_type);
  const categoryId = await getOrCreateDiscoveryLibraryCategory({ organizationId, divisionId, categoryName, createdBy });
  const privateQuestions = await getPrivateLibraryQuestions(categoryId);
  const equivalent = (item) => normalizeLibraryTitle(item.title) === normalizedTitle
    && item.response_type === responseType;
  const duplicate = privateQuestions.find(equivalent);
  if (duplicate) return { status: "duplicate", question: duplicate };
  const { data, error } = await supabase.from("score_library_questions").insert({
    category_id: categoryId, title: question.prompt.trim(),
    description: question.help_text || "", response_type: responseType,
    options: Array.isArray(question.options) ? question.options : [], created_by: createdBy,
  }).select(librarySelect).single();
  if (!error) return { status: "created", question: data };
  if (error.code !== "23505") throw error;
  const racedDuplicate = (await getPrivateLibraryQuestions(categoryId)).find(equivalent);
  if (racedDuplicate) return { status: "duplicate", question: racedDuplicate };
  throw error;
}

export async function createDiscoveryTemplate(payload) {
  const { data, error } = await supabase.from("discovery_templates").insert(payload).select("id").single();
  if (error) throw error;
  return data;
}

export async function duplicateDiscoveryTemplate(template, name, createdBy) {
  let copyId = null;
  try {
    const copy = await createDiscoveryTemplate({
      organization_id: template.organization_id,
      division_id: template.division_id || null,
      name,
      description: template.description || "",
      created_by: createdBy,
      status: "draft",
      version: 1,
    });
    copyId = copy.id;

    for (const sourceSection of template.discovery_sections) {
      const section = await createSection({
        template_id: copy.id,
        title: sourceSection.title,
        description: sourceSection.description || "",
        position: sourceSection.position,
      });
      for (const sourceQuestion of sourceSection.discovery_questions) {
        await createQuestion({
          section_id: section.id,
          prompt: sourceQuestion.prompt,
          help_text: sourceQuestion.help_text || "",
          response_type: sourceQuestion.response_type,
          options: sourceQuestion.options || [],
          required: sourceQuestion.required,
          position: sourceQuestion.position,
          question_kind: sourceQuestion.question_kind,
        });
      }
    }
    return copy;
  } catch (error) {
    if (copyId) await supabase.from("discovery_templates").delete().eq("id", copyId);
    throw error;
  }
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

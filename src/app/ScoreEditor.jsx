import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  Check,
  ChevronRight,
  Plus,
  Save,
  Trash2,
  Loader2,
  AlertCircle,
  Copy,
} from "lucide-react";

import { supabase } from "../lib/supabase";

export default function ScoreEditor({
  score,
  onBack,
  onDeleted,
  onUpdated,
}) {
  const [draft, setDraft] = useState(null);

  const [selectedType, setSelectedType] = useState("general");
  const [selectedCategoryId, setSelectedCategoryId] = useState(null);
  const [selectedQuestionId, setSelectedQuestionId] = useState(null);

  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [duplicating, setDuplicating] = useState(false);

  const [error, setError] = useState("");

  /*
  =====================================================
  PREPARAR SCORE
  =====================================================
  */

  useEffect(() => {
    if (!score) {
      setDraft(null);
      return;
    }

    const categories = (score.categories || []).map(
      (category, categoryIndex) => ({
        ...category,

        position:
          category.position ?? categoryIndex,

        questions: (
          category.score_questions ||
          category.questions ||
          []
        ).map((question, questionIndex) => ({
          ...question,

          position:
            question.position ?? questionIndex,

          _new: false,
        })),

        _new: false,
      })
    );
console.log("SCORE RECIBIDO:", score);
console.log("organization_id recibido:", score?.organization_id);
console.log("division_id recibido:", score?.division_id);
console.log("created_by recibido:", score?.created_by);

    setDraft({
      ...score,
      categories,
    });

    setSelectedType("general");
    setSelectedCategoryId(null);
    setSelectedQuestionId(null);

    setSaved(false);
    setError("");
  }, [score]);

  /*
  =====================================================
  DATOS SELECCIONADOS
  =====================================================
  */

  const selectedCategory = useMemo(() => {
    if (!draft || !selectedCategoryId) {
      return null;
    }

    return draft.categories.find(
      (category) =>
        category.id === selectedCategoryId
    );
  }, [draft, selectedCategoryId]);

  const selectedQuestion = useMemo(() => {
    if (
      !selectedCategory ||
      !selectedQuestionId
    ) {
      return null;
    }

    return selectedCategory.questions.find(
      (question) =>
        question.id === selectedQuestionId
    );
  }, [
    selectedCategory,
    selectedQuestionId,
  ]);

  /*
  =====================================================
  CONTADORES
  =====================================================
  */

  const totalCategories =
    draft?.categories?.length || 0;

  const totalQuestions = useMemo(() => {
    if (!draft) return 0;

    return draft.categories.reduce(
      (total, category) =>
        total +
        (category.questions?.length || 0),
      0
    );
  }, [draft]);

  const totalCategoryWeight = useMemo(() => {
    if (!draft) return 0;

    return draft.categories.reduce(
      (total, category) =>
        total +
        Number(category.weight || 0),
      0
    );
  }, [draft]);

  /*
  =====================================================
  CAMBIOS GENERALES
  =====================================================
  */

  function updateGeneral(field, value) {
    setDraft((current) => ({
      ...current,
      [field]: value,
    }));

    markChanged();
  }

  /*
  =====================================================
  CAMBIAR CATEGORÍA
  =====================================================
  */

  function updateCategory(
    categoryId,
    field,
    value
  ) {
    setDraft((current) => ({
      ...current,

      categories:
        current.categories.map(
          (category) =>
            category.id === categoryId
              ? {
                  ...category,
                  [field]: value,
                }
              : category
        ),
    }));

    markChanged();
  }

  /*
  =====================================================
  CAMBIAR PREGUNTA
  =====================================================
  */

  function updateQuestion(
    categoryId,
    questionId,
    field,
    value
  ) {
    setDraft((current) => ({
      ...current,

      categories:
        current.categories.map(
          (category) => {
            if (
              category.id !== categoryId
            ) {
              return category;
            }

            return {
              ...category,

              questions:
                category.questions.map(
                  (question) =>
                    question.id ===
                    questionId
                      ? {
                          ...question,
                          [field]: value,
                        }
                      : question
                ),
            };
          }
        ),
    }));

    markChanged();
  }

  /*
  =====================================================
  AÑADIR CATEGORÍA
  =====================================================
  */

  function addCategory() {
    const temporaryId =
      `new-category-${Date.now()}`;

    const newCategory = {
      id: temporaryId,

      name: "Nueva categoría",

      description: "",

      weight: 0,

      position:
        draft.categories.length,

      questions: [],

      _new: true,
    };

    setDraft((current) => ({
      ...current,

      categories: [
        ...current.categories,
        newCategory,
      ],
    }));

    setSelectedType("category");
    setSelectedCategoryId(temporaryId);
    setSelectedQuestionId(null);

    markChanged();
  }

  /*
  =====================================================
  AÑADIR PREGUNTA
  =====================================================
  */

  function addQuestion(categoryId) {
    const temporaryId =
      `new-question-${Date.now()}`;

    const category =
      draft.categories.find(
        (item) =>
          item.id === categoryId
      );

    const newQuestion = {
      id: temporaryId,

      prompt: "Nueva pregunta",

      help_text: "",

      response_type: "scale",

      weight: 0,

      required: true,

      position:
        category?.questions?.length || 0,

      scale_min: 1,

      scale_max: 5,

      options: [],

      scoring_config: {},

      _new: true,
    };

    setDraft((current) => ({
      ...current,

      categories:
        current.categories.map(
          (category) =>
            category.id === categoryId
              ? {
                  ...category,

                  questions: [
                    ...category.questions,
                    newQuestion,
                  ],
                }
              : category
        ),
    }));

    setSelectedType("question");
    setSelectedCategoryId(categoryId);
    setSelectedQuestionId(temporaryId);

    markChanged();
  }

  /*
  =====================================================
  ELIMINAR PREGUNTA
  =====================================================
  */

  async function deleteQuestion(
    categoryId,
    question
  ) {
    const confirmed =
      window.confirm(
        `¿Eliminar la pregunta "${question.prompt}"?`
      );

    if (!confirmed) return;

    setError("");

    try {
      if (!question._new) {
        const { error } = await supabase
          .from("score_questions")
          .delete()
          .eq("id", question.id);

        if (error) throw error;
      }

      setDraft((current) => ({
        ...current,

        categories:
          current.categories.map(
            (category) =>
              category.id === categoryId
                ? {
                    ...category,

                    questions:
                      category.questions.filter(
                        (item) =>
                          item.id !==
                          question.id
                      ),
                  }
                : category
          ),
      }));

      setSelectedType("category");
      setSelectedQuestionId(null);

      markChanged();
    } catch (error) {
      console.error(
        "Error eliminando pregunta:",
        error
      );

      setError(
        error?.message ||
          "No se pudo eliminar la pregunta."
      );
    }
  }

  /*
  =====================================================
  ELIMINAR CATEGORÍA
  =====================================================
  */

  async function deleteCategory(category) {
    const confirmed =
      window.confirm(
        `¿Eliminar la categoría "${category.name}" y todas sus preguntas?`
      );

    if (!confirmed) return;

    setError("");

    try {
      if (!category._new) {
        const { error } = await supabase
          .from("score_categories")
          .delete()
          .eq("id", category.id);

        if (error) throw error;
      }

      setDraft((current) => ({
        ...current,

        categories:
          current.categories.filter(
            (item) =>
              item.id !== category.id
          ),
      }));

      setSelectedType("general");
      setSelectedCategoryId(null);
      setSelectedQuestionId(null);

      markChanged();
    } catch (error) {
      console.error(
        "Error eliminando categoría:",
        error
      );

      setError(
        error?.message ||
          "No se pudo eliminar la categoría."
      );
    }
  }

  /*
  =====================================================
  GUARDAR SCORE
  =====================================================
  */

  async function saveScore() {
    if (!draft?.id) return;

    setSaving(true);
    setError("");

    try {
      /*
      ---------------------------------------------
      1. SCORE TEMPLATE
      ---------------------------------------------
      */

      const {
        error: templateError,
      } = await supabase
        .from("score_templates")
        .update({
          name: draft.name,
          description:
            draft.description || "",
          updated_at:
            new Date().toISOString(),
        })
        .eq("id", draft.id);

      if (templateError) {
        throw templateError;
      }

      /*
      ---------------------------------------------
      2. CATEGORÍAS
      ---------------------------------------------
      */

      const savedCategories = [];

      for (
        let categoryIndex = 0;
        categoryIndex <
        draft.categories.length;
        categoryIndex++
      ) {
        const category =
          draft.categories[
            categoryIndex
          ];

        let categoryId =
          category.id;

        if (category._new) {
          const {
            data,
            error,
          } = await supabase
            .from("score_categories")
            .insert({
              template_id: draft.id,

              name:
                category.name ||
                "Nueva categoría",

              description:
                category.description ||
                "",

              weight:
                Number(
                  category.weight || 0
                ),

              position:
                categoryIndex,
            })
            .select()
            .single();

          if (error) throw error;

          categoryId = data.id;
        } else {
          const { error } =
            await supabase
              .from(
                "score_categories"
              )
              .update({
                name:
                  category.name ||
                  "Categoría",

                description:
                  category.description ||
                  "",

                weight:
                  Number(
                    category.weight || 0
                  ),

                position:
                  categoryIndex,
              })
              .eq(
                "id",
                category.id
              );

          if (error) throw error;
        }

        /*
        ---------------------------------------------
        3. PREGUNTAS
        ---------------------------------------------
        */

        const savedQuestions = [];

        for (
          let questionIndex = 0;
          questionIndex <
          category.questions.length;
          questionIndex++
        ) {
          const question =
            category.questions[
              questionIndex
            ];

          let questionId =
            question.id;

          const payload = {
            category_id:
              categoryId,

            prompt:
              question.prompt ||
              "Nueva pregunta",

            help_text:
              question.help_text ||
              "",

            response_type:
              question.response_type ||
              "scale",

            weight:
              Number(
                question.weight || 0
              ),

            required:
              question.required !==
              false,

            position:
              questionIndex,

            scale_min:
              Number(
                question.scale_min || 1
              ),

            scale_max:
              Number(
                question.scale_max || 5
              ),

            options:
              Array.isArray(
                question.options
              )
                ? question.options
                : [],

            scoring_config:
              question.scoring_config &&
              typeof question.scoring_config ===
                "object"
                ? question.scoring_config
                : {},
          };

          if (question._new) {
            const {
              data,
              error,
            } = await supabase
              .from(
                "score_questions"
              )
              .insert(payload)
              .select()
              .single();

            if (error) throw error;

            questionId = data.id;
          } else {
            const { error } =
              await supabase
                .from(
                  "score_questions"
                )
                .update(payload)
                .eq(
                  "id",
                  question.id
                );

            if (error) throw error;
          }

          savedQuestions.push({
            ...question,

            id: questionId,

            position:
              questionIndex,

            _new: false,
          });
        }

        savedCategories.push({
          ...category,

          id: categoryId,

          position:
            categoryIndex,

          questions:
            savedQuestions,

          _new: false,
        });
      }

      const updatedDraft = {
        ...draft,

        categories:
          savedCategories,
      };

      setDraft(updatedDraft);

      setSaved(true);

      setSelectedType("general");
      setSelectedCategoryId(null);
      setSelectedQuestionId(null);

      if (onUpdated) {
        onUpdated(updatedDraft);
      }
    } catch (error) {
      console.error(
        "Error guardando Score:",
        error
      );

      setError(
        error?.message ||
          "No se pudieron guardar los cambios."
      );
    } finally {
      setSaving(false);
    }
  }

  /*
  =====================================================
  DUPLICAR SCORE
  =====================================================
  */

  async function duplicateScore() {
    if (!draft?.id) return;

    const confirmed =
      window.confirm(
        `¿Quieres duplicar "${draft.name}"? Se creará una copia independiente como borrador.`
      );

    if (!confirmed) return;

    setDuplicating(true);
    setError("");

        try {
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (userError) {
        throw userError;
      }

      if (!user?.id) {
        throw new Error(
          "No se encontró el usuario autenticado."
        );
      }
console.log("===== DUPLICAR SCORE =====");
console.log("DRAFT:", draft);
console.log("organization_id:", draft.organization_id);
console.log("division_id:", draft.division_id);
console.log("created_by:", draft.created_by);

      if (!draft.organization_id) {
        throw new Error(
          "El Score no tiene una organización válida."
        );
      }

      if (!draft.division_id) {
        throw new Error(
          "El Score no tiene una división válida."
        );
      }

      /*
      ---------------------------------------------
      1. CREAR NUEVO TEMPLATE
      ---------------------------------------------
      */

      const {
        data: newTemplate,
        error: templateError,
      } = await supabase
        .from("score_templates")
        .insert({
          organization_id:
            draft.organization_id,

          division_id:
            draft.division_id,

          name:
            `${draft.name} — Copia`,

          description:
            draft.description || "",

          status: "draft",

          version: 1,

          max_score:
            draft.max_score || 1000,
                      created_by:
            user.id,

          template_kind:
            draft.template_kind || "score",
        })
        .select()
        .single();

      if (templateError) {
        throw templateError;
      }

      /*
      ---------------------------------------------
      2. COPIAR CATEGORÍAS
      ---------------------------------------------
      */

      for (
        let categoryIndex = 0;
        categoryIndex <
        draft.categories.length;
        categoryIndex++
      ) {
        const category =
          draft.categories[
            categoryIndex
          ];

        const {
          data: newCategory,
          error: categoryError,
        } = await supabase
          .from("score_categories")
          .insert({
            template_id:
              newTemplate.id,

            name:
              category.name ||
              "Categoría",

            description:
              category.description ||
              "",

            weight:
              Number(
                category.weight || 0
              ),

            position:
              categoryIndex,
          })
          .select()
          .single();

        if (categoryError) {
          throw categoryError;
        }

        /*
        ---------------------------------------------
        3. COPIAR PREGUNTAS
        ---------------------------------------------
        */

        for (
          let questionIndex = 0;
          questionIndex <
          category.questions.length;
          questionIndex++
        ) {
          const question =
            category.questions[
              questionIndex
            ];

          const {
            error: questionError,
          } = await supabase
            .from("score_questions")
            .insert({
              category_id:
                newCategory.id,

              prompt:
                question.prompt ||
                "Nueva pregunta",

              help_text:
                question.help_text ||
                "",

              response_type:
                question.response_type ||
                "scale",

                           weight:
                Math.min(
                  100,
                  Math.max(
                    0,
                    Number(
                      question.weight || 0
                    )
                  )
                ),

              required:
                question.required !==
                false,

              position:
                questionIndex,

              scale_min:
                Number(
                  question.scale_min || 1
                ),

              scale_max:
                Number(
                  question.scale_max || 5
                ),

              options:
                Array.isArray(
                  question.options
                )
                  ? question.options
                  : [],

              scoring_config:
                question.scoring_config &&
                typeof question.scoring_config ===
                  "object"
                  ? question.scoring_config
                  : {},
            });

          if (questionError) {
            throw questionError;
          }
        }
      }

      /*
      ---------------------------------------------
      4. FINALIZAR
      ---------------------------------------------
      */

      window.alert(
        `"${draft.name} — Copia" fue creado correctamente.`
      );

      if (onBack) {
        onBack();
      }
    } catch (error) {
      console.error(
        "Error duplicando Score:",
        error
      );

      setError(
        error?.message ||
          "No se pudo duplicar el Score."
      );
    } finally {
      setDuplicating(false);
    }
  }

  /*
  =====================================================
  ELIMINAR SCORE
  =====================================================
  */

  async function deleteScore() {
    if (!draft?.id) return;

    const confirmed =
      window.confirm(
        `¿Eliminar permanentemente "${draft.name}"? Esta acción no se puede deshacer.`
      );

    if (!confirmed) return;

    setDeleting(true);
    setError("");

    try {
      const { error } = await supabase
        .from("score_templates")
        .delete()
        .eq("id", draft.id);

      if (error) throw error;

      if (onDeleted) {
        onDeleted(draft.id);
      } else if (onBack) {
        onBack();
      }
    } catch (error) {
      console.error(
        "Error eliminando Score:",
        error
      );

      setError(
        error?.message ||
          "No se pudo eliminar el Score."
      );
    } finally {
      setDeleting(false);
    }
  }

  /*
  =====================================================
  ESTADO MODIFICADO
  =====================================================
  */

  function markChanged() {
    setSaved(false);
  }

  /*
  =====================================================
  LOADING
  =====================================================
  */

  if (!draft) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <Loader2
          size={24}
          className="animate-spin text-zinc-500"
        />
      </div>
    );
  }

  /*
  =====================================================
  UI
  =====================================================
  */

  return (
    <div className="space-y-5">

      {/* HEADER */}

      <div className="sticky top-0 z-30 rounded-2xl border border-zinc-800 bg-[#0c0c0e]/95 p-4 backdrop-blur">

        <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">

          <div className="flex min-w-0 items-center gap-4">

            <button
              type="button"
              onClick={onBack}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-zinc-800 text-zinc-400 transition hover:bg-zinc-900 hover:text-white"
              title="Volver a Mis Scores"
            >
              <ArrowLeft size={18} />
            </button>

            <div className="min-w-0">

              <div className="flex flex-wrap items-center gap-2">

                <h2 className="truncate text-xl font-semibold text-white">
                  {draft.name}
                </h2>

                <StatusBadge
                  status={draft.status}
                />

                {saved && (
                  <span className="inline-flex items-center gap-1 text-xs text-emerald-400">
                    <Check size={14} />
                    Guardado
                  </span>
                )}

              </div>

              <p className="mt-1 text-sm text-zinc-500">
                {totalCategories} categorías
                {" · "}
                {totalQuestions} preguntas
                {" · "}
                {draft.max_score || 1000} puntos
              </p>

            </div>

          </div>

          <div className="flex flex-wrap items-center gap-2">

            {/* DUPLICAR */}

            <button
              type="button"
              onClick={duplicateScore}
              disabled={
                duplicating ||
                saving
              }
              className="inline-flex items-center gap-2 rounded-xl border border-zinc-700 px-4 py-2.5 text-sm font-medium text-zinc-300 transition hover:bg-zinc-900 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              {duplicating ? (
                <Loader2
                  size={17}
                  className="animate-spin"
                />
              ) : (
                <Copy size={17} />
              )}

              {duplicating
                ? "Duplicando..."
                : "Duplicar"}
            </button>

            {/* GUARDAR */}

            <button
              type="button"
              onClick={saveScore}
              disabled={
                saving ||
                duplicating
              }
              className="inline-flex items-center gap-2 rounded-xl bg-white px-5 py-2.5 text-sm font-semibold text-black transition hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saving ? (
                <Loader2
                  size={17}
                  className="animate-spin"
                />
              ) : (
                <Save size={17} />
              )}

              {saving
                ? "Guardando..."
                : "Guardar cambios"}
            </button>

          </div>

        </div>

      </div>

      {/* ERROR */}

      {error && (
        <div className="flex items-start gap-3 rounded-xl border border-red-900 bg-red-950/20 p-4 text-sm text-red-400">

          <AlertCircle
            size={18}
            className="mt-0.5 shrink-0"
          />

          {error}

        </div>
      )}

      {/* EDITOR DOS PANELES */}

      <div className="grid min-h-[650px] overflow-hidden rounded-2xl border border-zinc-800 bg-[#0c0c0e] lg:grid-cols-[320px_minmax(0,1fr)]">

        {/* PANEL IZQUIERDO */}

        <aside className="border-b border-zinc-800 bg-[#101012] lg:border-b-0 lg:border-r">

          <div className="border-b border-zinc-800 p-5">

            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-zinc-600">
              Estructura
            </p>

          </div>

          <div className="max-h-[700px] overflow-y-auto p-3">

            <NavigationButton
              active={
                selectedType ===
                "general"
              }
              onClick={() => {
                setSelectedType(
                  "general"
                );

                setSelectedCategoryId(
                  null
                );

                setSelectedQuestionId(
                  null
                );
              }}
            >
              Información general
            </NavigationButton>

            <div className="mt-3 space-y-2">

              {draft.categories.map(
                (
                  category,
                  categoryIndex
                ) => (

                <div
                  key={category.id}
                  className="overflow-hidden rounded-xl border border-zinc-800"
                >

                  <button
                    type="button"
                    onClick={() => {
                      setSelectedType(
                        "category"
                      );

                      setSelectedCategoryId(
                        category.id
                      );

                      setSelectedQuestionId(
                        null
                      );
                    }}
                    className={
                      selectedType ===
                        "category" &&
                      selectedCategoryId ===
                        category.id
                        ? "flex w-full items-center justify-between bg-zinc-800 px-4 py-3 text-left text-sm font-medium text-white"
                        : "flex w-full items-center justify-between bg-[#151517] px-4 py-3 text-left text-sm font-medium text-zinc-300 transition hover:bg-zinc-900"
                    }
                  >

                    <span className="truncate">
                      {categoryIndex + 1}.{" "}
                      {category.name}
                    </span>

                    <span className="ml-3 shrink-0 text-xs text-zinc-600">
                      {category.weight || 0}%
                    </span>

                  </button>

                  <div className="space-y-1 border-t border-zinc-800 p-2">

                    {category.questions.map(
                      (
                        question,
                        questionIndex
                      ) => (

                      <button
                        key={question.id}
                        type="button"
                        onClick={() => {
                          setSelectedType(
                            "question"
                          );

                          setSelectedCategoryId(
                            category.id
                          );

                          setSelectedQuestionId(
                            question.id
                          );
                        }}
                        className={
                          selectedType ===
                            "question" &&
                          selectedQuestionId ===
                            question.id
                            ? "flex w-full items-center gap-3 rounded-lg bg-zinc-800 px-3 py-2.5 text-left text-sm text-white"
                            : "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm text-zinc-500 transition hover:bg-zinc-900 hover:text-zinc-300"
                        }
                      >

                        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-zinc-700 text-xs">
                          {questionIndex + 1}
                        </span>

                        <span className="truncate">
                          {question.prompt ||
                            "Sin título"}
                        </span>

                      </button>

                    ))}

                    <button
                      type="button"
                      onClick={() =>
                        addQuestion(
                          category.id
                        )
                      }
                      className="flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left text-sm text-zinc-500 transition hover:bg-zinc-900 hover:text-white"
                    >
                      <Plus size={15} />
                      Añadir pregunta
                    </button>

                  </div>

                </div>

              ))}

            </div>

            <button
              type="button"
              onClick={addCategory}
              className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-zinc-700 px-4 py-3 text-sm text-zinc-400 transition hover:border-zinc-500 hover:text-white"
            >
              <Plus size={16} />
              Añadir categoría
            </button>

          </div>

        </aside>

        {/* PANEL DERECHO */}

        <main className="min-w-0 p-6 lg:p-8">

          {selectedType ===
            "general" && (

            <GeneralEditor
              draft={draft}
              updateGeneral={
                updateGeneral
              }
              totalCategories={
                totalCategories
              }
              totalQuestions={
                totalQuestions
              }
              totalCategoryWeight={
                totalCategoryWeight
              }
              deleting={deleting}
              deleteScore={
                deleteScore
              }
            />

          )}

          {selectedType ===
            "category" &&
            selectedCategory && (

            <CategoryEditor
              category={
                selectedCategory
              }
              updateCategory={
                updateCategory
              }
              addQuestion={
                addQuestion
              }
              deleteCategory={
                deleteCategory
              }
            />

          )}

          {selectedType ===
            "question" &&
            selectedCategory &&
            selectedQuestion && (

            <QuestionEditor
              category={
                selectedCategory
              }
              question={
                selectedQuestion
              }
              updateQuestion={
                updateQuestion
              }
              deleteQuestion={
                deleteQuestion
              }
            />

          )}

        </main>

      </div>

    </div>
  );
}


/*
=========================================================
GENERAL EDITOR
=========================================================
*/

function GeneralEditor({
  draft,
  updateGeneral,
  totalCategories,
  totalQuestions,
  totalCategoryWeight,
  deleting,
  deleteScore,
}) {
  return (
    <div className="mx-auto max-w-3xl space-y-8">

      <EditorHeader
        title="Información general"
        description="Configuración principal del sistema de evaluación."
      />

      <div className="grid gap-5">

        <Field label="Nombre">
          <input
            value={draft.name || ""}
            onChange={(event) =>
              updateGeneral(
                "name",
                event.target.value
              )
            }
            className={inputClass}
          />
        </Field>

        <Field label="Objetivo de la evaluación">
          <textarea
            rows={5}
            value={
              draft.description || ""
            }
            onChange={(event) =>
              updateGeneral(
                "description",
                event.target.value
              )
            }
            className={inputClass}
          />
        </Field>

      </div>

      <div className="grid gap-4 sm:grid-cols-3">

        <Metric
          label="Categorías"
          value={totalCategories}
        />

        <Metric
          label="Preguntas"
          value={totalQuestions}
        />

        <Metric
          label="Peso total"
          value={`${totalCategoryWeight}%`}
          warning={
            totalCategoryWeight !==
            100
          }
        />

      </div>

      {totalCategoryWeight !== 100 && (
        <div className="rounded-xl border border-amber-900/60 bg-amber-950/20 p-4 text-sm text-amber-400">

          El peso total de las categorías es{" "}
          {totalCategoryWeight}%.
          Para una evaluación completa debe sumar
          100%.

        </div>
      )}

      <div className="border-t border-zinc-800 pt-8">

        <p className="text-sm font-medium text-white">
          Zona de peligro
        </p>

        <p className="mt-1 text-sm text-zinc-500">
          Eliminar este Score también elimina
          sus categorías y preguntas.
        </p>

        <button
          type="button"
          onClick={deleteScore}
          disabled={deleting}
          className="mt-4 inline-flex items-center gap-2 rounded-xl border border-red-900 px-4 py-2.5 text-sm text-red-400 transition hover:bg-red-950/30 disabled:opacity-50"
        >
          {deleting ? (
            <Loader2
              size={16}
              className="animate-spin"
            />
          ) : (
            <Trash2 size={16} />
          )}

          Eliminar Score
        </button>

      </div>

    </div>
  );
}


/*
=========================================================
CATEGORY EDITOR
=========================================================
*/

function CategoryEditor({
  category,
  updateCategory,
  addQuestion,
  deleteCategory,
}) {
  return (
    <div className="mx-auto max-w-3xl space-y-8">

      <EditorHeader
        title={category.name}
        description="Configura esta categoría y administra sus preguntas."
      />

      <div className="grid gap-5">

        <Field label="Nombre de la categoría">
          <input
            value={category.name || ""}
            onChange={(event) =>
              updateCategory(
                category.id,
                "name",
                event.target.value
              )
            }
            className={inputClass}
          />
        </Field>

        <Field label="Descripción">
          <textarea
            rows={4}
            value={
              category.description ||
              ""
            }
            onChange={(event) =>
              updateCategory(
                category.id,
                "description",
                event.target.value
              )
            }
            className={inputClass}
          />
        </Field>

        <Field label="Peso de la categoría (%)">
          <input
            type="number"
            min="0"
            max="100"
            value={
              category.weight ?? 0
            }
            onChange={(event) =>
              updateCategory(
                category.id,
                "weight",
                Number(
                  event.target.value
                )
              )
            }
            className={inputClass}
          />
        </Field>

      </div>

      <div className="flex flex-wrap gap-3">

        <button
          type="button"
          onClick={() =>
            addQuestion(category.id)
          }
          className="inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-black transition hover:bg-zinc-200"
        >
          <Plus size={16} />
          Añadir pregunta
        </button>

        <button
          type="button"
          onClick={() =>
            deleteCategory(category)
          }
          className="inline-flex items-center gap-2 rounded-xl border border-red-900 px-4 py-2.5 text-sm text-red-400 transition hover:bg-red-950/30"
        >
          <Trash2 size={16} />
          Eliminar categoría
        </button>

      </div>

    </div>
  );
}


/*
=========================================================
QUESTION EDITOR
=========================================================
*/

function QuestionEditor({
  category,
  question,
  updateQuestion,
  deleteQuestion,
}) {
  return (
    <div className="mx-auto max-w-3xl space-y-8">

      <EditorHeader
        title="Editar pregunta"
        description={category.name}
      />

      <div className="grid gap-5">

        <Field label="Pregunta">
          <textarea
            rows={3}
            value={
              question.prompt || ""
            }
            onChange={(event) =>
              updateQuestion(
                category.id,
                question.id,
                "prompt",
                event.target.value
              )
            }
            className={inputClass}
          />
        </Field>

        <Field label="Texto de ayuda">
          <textarea
            rows={3}
            value={
              question.help_text || ""
            }
            onChange={(event) =>
              updateQuestion(
                category.id,
                question.id,
                "help_text",
                event.target.value
              )
            }
            placeholder="Explica al usuario cómo interpretar esta pregunta..."
            className={inputClass}
          />
        </Field>

        <div className="grid gap-5 md:grid-cols-2">

          <Field label="Tipo de respuesta">

            <select
              value={
                question.response_type ||
                "scale"
              }
              onChange={(event) =>
                updateQuestion(
                  category.id,
                  question.id,
                  "response_type",
                  event.target.value
                )
              }
              className={inputClass}
            >
              <option value="scale">
                Escala
              </option>

              <option value="yes_no">
                Sí o no
              </option>

              <option value="boolean">
                Booleano
              </option>

              <option value="number">
                Número
              </option>

              <option value="percentage">
                Porcentaje
              </option>

              <option value="text">
                Texto
              </option>

              <option value="multiple_choice">
                Selección múltiple
              </option>
            </select>

          </Field>

          <Field label="Peso (%)">

            <input
              type="number"
              min="0"
              max="100"
              value={
                question.weight ?? 0
              }
              onChange={(event) =>
                updateQuestion(
                  category.id,
                  question.id,
                  "weight",
                  Number(
                    event.target.value
                  )
                )
              }
              className={inputClass}
            />

          </Field>

        </div>

        {question.response_type ===
          "scale" && (

          <div className="grid gap-5 md:grid-cols-2">

            <Field label="Escala mínima">

              <input
                type="number"
                value={
                  question.scale_min ??
                  1
                }
                onChange={(event) =>
                  updateQuestion(
                    category.id,
                    question.id,
                    "scale_min",
                    Number(
                      event.target.value
                    )
                  )
                }
                className={
                  inputClass
                }
              />

            </Field>

            <Field label="Escala máxima">

              <input
                type="number"
                value={
                  question.scale_max ??
                  5
                }
                onChange={(event) =>
                  updateQuestion(
                    category.id,
                    question.id,
                    "scale_max",
                    Number(
                      event.target.value
                    )
                  )
                }
                className={
                  inputClass
                }
              />

            </Field>

          </div>

        )}

        <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-zinc-800 bg-zinc-950 p-4">

          <input
            type="checkbox"
            checked={
              question.required !==
              false
            }
            onChange={(event) =>
              updateQuestion(
                category.id,
                question.id,
                "required",
                event.target.checked
              )
            }
            className="h-4 w-4"
          />

          <div>

            <p className="text-sm font-medium text-white">
              Pregunta obligatoria
            </p>

            <p className="mt-1 text-xs text-zinc-500">
              El usuario deberá responderla para completar la evaluación.
            </p>

          </div>

        </label>

      </div>

      <div className="border-t border-zinc-800 pt-6">

        <button
          type="button"
          onClick={() =>
            deleteQuestion(
              category.id,
              question
            )
          }
          className="inline-flex items-center gap-2 rounded-xl border border-red-900 px-4 py-2.5 text-sm text-red-400 transition hover:bg-red-950/30"
        >
          <Trash2 size={16} />
          Eliminar pregunta
        </button>

      </div>

    </div>
  );
}


/*
=========================================================
COMPONENTES AUXILIARES
=========================================================
*/

function NavigationButton({
  active,
  onClick,
  children,
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        active
          ? "flex w-full items-center justify-between rounded-xl bg-zinc-800 px-4 py-3 text-left text-sm font-medium text-white"
          : "flex w-full items-center justify-between rounded-xl px-4 py-3 text-left text-sm font-medium text-zinc-400 transition hover:bg-zinc-900 hover:text-white"
      }
    >
      {children}

      <ChevronRight size={15} />
    </button>
  );
}


function EditorHeader({
  title,
  description,
}) {
  return (
    <div>

      <h3 className="text-2xl font-semibold text-white">
        {title}
      </h3>

      <p className="mt-2 text-sm text-zinc-500">
        {description}
      </p>

    </div>
  );
}


function Field({
  label,
  children,
}) {
  return (
    <div>

      <label className="mb-2 block text-sm font-medium text-zinc-400">
        {label}
      </label>

      {children}

    </div>
  );
}


function Metric({
  label,
  value,
  warning = false,
}) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-4">

      <p className="text-xs text-zinc-500">
        {label}
      </p>

      <p
        className={
          warning
            ? "mt-2 text-xl font-semibold text-amber-400"
            : "mt-2 text-xl font-semibold text-white"
        }
      >
        {value}
      </p>

    </div>
  );
}


function StatusBadge({
  status,
}) {
  const published =
    status === "published";

  return (
    <span
      className={
        published
          ? "rounded-full border border-emerald-900 bg-emerald-950/40 px-2.5 py-1 text-xs font-medium text-emerald-400"
          : "rounded-full border border-zinc-700 bg-zinc-900 px-2.5 py-1 text-xs font-medium text-zinc-400"
      }
    >
      {published
        ? "Publicado"
        : "Borrador"}
    </span>
  );
}


const inputClass =
  "w-full rounded-xl border border-zinc-800 bg-zinc-950 px-4 py-3 text-white outline-none transition placeholder:text-zinc-700 focus:border-zinc-600";
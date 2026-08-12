import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArchiveRestore, Check, ChevronRight, ClipboardList, Copy, Heart,
  Library, LoaderCircle, Plus, Save, Search, Trash2,
} from "lucide-react";

import Page from "../components/ui/Page";
import { useAuth } from "../Context/AuthContext";
import { useDivisions } from "../hooks/useDivisions";
import { supabase } from "../lib/supabase";
import "./ScoreBuilder.css";

const STEPS = ["Información", "Categorías", "Preguntas", "Pesos", "Vista previa", "Publicar"];
const blankTemplate = { name: "", division_id: "", description: "" };
const responseTypes = [
  ["scale", "Escala 1 a 5"], ["yes_no", "Sí / No"], ["number", "Número"],
  ["percentage", "Porcentaje"], ["text", "Texto"], ["multiple_choice", "Selección múltiple"],
];
const templateSelect = `
  id, organization_id, name, description, status, version, template_kind,
  source_template_id, division_id, max_score, created_by, published_at, created_at, updated_at,
  divisions(name),
  score_instances(id, current_score, max_score, percentage, status, computed_at),
  score_categories(id, name, description, weight, position,
    score_questions(id, prompt, help_text, response_type, weight, required, position,
      library_question_id, scale_min, scale_max, options, scoring_config)
  )
`;

function friendlyError(error, fallback) {
  if (!error) return fallback;
  if (error.code === "42501") return "No tienes permiso para realizar esta acción.";
  if (error.code === "23503") return "Este elemento está siendo utilizado y no se puede eliminar.";
  if (error.code === "23514") return "Uno de los valores no cumple las reglas del Score.";
  return fallback || "No se pudo completar la operación. Inténtalo nuevamente.";
}

function normalizeTemplate(template) {
  return {
    ...template,
    max_score: 100,
    score_categories: [...(template.score_categories || [])]
      .sort((a, b) => a.position - b.position)
      .map((category) => ({
        ...category,
        score_questions: [...(category.score_questions || [])]
          .sort((a, b) => a.position - b.position)
          .map((question) => ({
            ...question,
            response_type: question.response_type === "boolean" ? "yes_no" : question.response_type,
          })),
      })),
  };
}

export default function ScoreBuilder() {
  const { canManageUsers, profile, user } = useAuth();
  const userId = user?.id;
  const { divisions } = useDivisions(profile?.organization_id);
  const [templates, setTemplates] = useState([]);
  const [selectedId, setSelectedId] = useState("");
  const [draft, setDraft] = useState(blankTemplate);
  const [creating, setCreating] = useState(false);
  const [activeStep, setActiveStep] = useState(0);
  const [loading, setLoading] = useState(true);
  const [action, setAction] = useState("");
  const [notice, setNotice] = useState(null);
  const [library, setLibrary] = useState([]);
  const [librarySearch, setLibrarySearch] = useState("");
  const [libraryCategory, setLibraryCategory] = useState("all");
  const [view, setView] = useState("scores");
  const [favorites, setFavorites] = useState([]);

  const selected = useMemo(() => templates.find((item) => item.id === selectedId), [templates, selectedId]);

  const notify = useCallback((text, type = "success") => setNotice({ text, type }), []);

  const loadBuilder = useCallback(async (preferredId = "") => {
    if (!userId) return;
    setLoading(true);
    const [templatesResult, libraryResult, favoritesResult] = await Promise.all([
      supabase.from("score_templates").select(templateSelect).order("updated_at", { ascending: false }),
      supabase.from("score_library_categories")
        .select("id, name, description, position, is_official, divisions(name), score_library_questions(id, title, description, recommended_weight, difficulty, response_type, options)")
        .eq("is_official", true).order("position"),
      supabase.from("score_template_favorites").select("template_id").eq("user_id", userId),
    ]);
    const error = templatesResult.error || libraryResult.error || favoritesResult.error;
    if (error) notify(friendlyError(error, "No se pudo cargar Score Builder."), "error");
    const nextTemplates = (templatesResult.data || []).map(normalizeTemplate);
    setTemplates(nextTemplates);
    setLibrary((libraryResult.data || []).map((category) => ({
      ...category,
      score_library_questions: [...(category.score_library_questions || [])].sort((a, b) => a.title.localeCompare(b.title)),
    })));
    setFavorites((favoritesResult.data || []).map((item) => item.template_id));
    const nextId = nextTemplates.some((item) => item.id === preferredId) ? preferredId : nextTemplates[0]?.id || "";
    setSelectedId(nextId);
    setLoading(false);
  }, [notify, userId]);

  useEffect(() => {
    // Data loading is the external synchronization performed by this effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (canManageUsers && profile?.organization_id) loadBuilder();
  }, [canManageUsers, profile?.organization_id, loadBuilder]);

  function updateSelected(changes) {
    setTemplates((current) => current.map((item) => item.id === selectedId ? { ...item, ...changes } : item));
  }

  function updateCategory(categoryId, changes) {
    updateSelected({
      score_categories: selected.score_categories.map((category) => category.id === categoryId ? { ...category, ...changes } : category),
    });
  }

  function updateQuestion(categoryId, questionId, changes) {
    const category = selected.score_categories.find((item) => item.id === categoryId);
    updateCategory(categoryId, {
      score_questions: category.score_questions.map((question) => question.id === questionId ? { ...question, ...changes } : question),
    });
  }

  async function runAction(name, operation, successMessage) {
    setAction(name);
    setNotice(null);
    try {
      const result = await operation();
      if (result?.error) throw result.error;
      if (successMessage) notify(successMessage);
      return result;
    } catch (error) {
      notify(friendlyError(error, "No se pudo completar la operación."), "error");
      return null;
    } finally {
      setAction("");
    }
  }

  async function createTemplate(event) {
    event.preventDefault();
    if (!draft.name.trim() || !draft.division_id) return notify("Escribe un nombre y selecciona una división.", "error");
    const result = await runAction("create", () => supabase.from("score_templates").insert({
      organization_id: profile.organization_id,
      division_id: draft.division_id,
      name: draft.name.trim(),
      description: draft.description.trim(),
      max_score: 100,
      template_kind: "score",
      created_by: user.id,
    }).select("id").single(), "Score creado y guardado como borrador.");
    if (!result) return;
    setDraft(blankTemplate);
    setCreating(false);
    setActiveStep(0);
    await loadBuilder(result.data.id);
  }

  async function addCategory() {
    const result = await runAction("category", () => supabase.from("score_categories").insert({
      template_id: selected.id, name: "Nueva categoría", description: "", weight: 0,
      position: selected.score_categories.length,
    }).select("id, name, description, weight, position").single());
    if (result) updateSelected({ score_categories: [...selected.score_categories, { ...result.data, score_questions: [] }] });
  }

  async function addQuestion(category) {
    const result = await runAction("question", () => supabase.from("score_questions").insert({
      category_id: category.id, prompt: "Nueva pregunta", help_text: "", response_type: "scale",
      weight: 0, required: true, position: category.score_questions.length,
    }).select("id, prompt, help_text, response_type, weight, required, position, scale_min, scale_max, options, scoring_config").single());
    if (result) updateCategory(category.id, { score_questions: [...category.score_questions, result.data] });
  }

  async function addLibraryQuestion(category, question) {
    if (!selected) return notify("Selecciona o crea un Score antes de añadir preguntas.", "error");
    setAction("library");
    try {
      let target = selected.score_categories.find((item) => item.name.trim().toLowerCase() === category.name.trim().toLowerCase());
      if (!target) {
        const createdCategory = await supabase.from("score_categories").insert({
          template_id: selected.id, name: category.name, description: category.description || "",
          weight: 0, position: selected.score_categories.length,
        }).select("id, name, description, weight, position").single();
        if (createdCategory.error) throw createdCategory.error;
        target = { ...createdCategory.data, score_questions: [] };
      }
      const responseType = question.response_type === "boolean" ? "yes_no" : question.response_type;
      const inserted = await supabase.from("score_questions").insert({
        category_id: target.id, library_question_id: question.id, prompt: question.title,
        help_text: question.description || "", response_type: responseType,
        options: question.options || [], weight: 0, position: target.score_questions.length,
      });
      if (inserted.error) throw inserted.error;
      await loadBuilder(selected.id);
      notify("Pregunta añadida. Ajusta sus pesos antes de publicar.");
    } catch (error) {
      notify(friendlyError(error, "No se pudo añadir la pregunta."), "error");
    } finally { setAction(""); }
  }

  async function removeCategory(categoryId) {
    if (!window.confirm("¿Eliminar esta categoría y todas sus preguntas?")) return;
    const result = await runAction("delete", () => supabase.from("score_categories").delete().eq("id", categoryId));
    if (result) updateSelected({ score_categories: selected.score_categories.filter((item) => item.id !== categoryId) });
  }

  async function removeQuestion(categoryId, questionId) {
    if (!window.confirm("¿Eliminar esta pregunta?")) return;
    const result = await runAction("delete", () => supabase.from("score_questions").delete().eq("id", questionId));
    if (result) {
      const category = selected.score_categories.find((item) => item.id === categoryId);
      updateCategory(categoryId, { score_questions: category.score_questions.filter((item) => item.id !== questionId) });
    }
  }

  function validateTemplate() {
    if (!selected?.name.trim()) return "El Score necesita un nombre.";
    if (!selected.division_id) return "Selecciona una división.";
    if (!selected.score_categories.length) return "Añade al menos una categoría.";
    const categoryTotal = selected.score_categories.reduce((sum, item) => sum + Number(item.weight || 0), 0);
    if (Math.abs(categoryTotal - 100) > 0.01) return `Las categorías deben sumar 100%. Actualmente suman ${categoryTotal}%.`;
    for (const category of selected.score_categories) {
      if (!category.name.trim()) return "Todas las categorías necesitan un nombre.";
      if (!category.score_questions.length) return `La categoría “${category.name}” necesita preguntas.`;
      const total = category.score_questions.reduce((sum, item) => sum + Number(item.weight || 0), 0);
      if (Math.abs(total - 100) > 0.01) return `Las preguntas de “${category.name}” deben sumar 100%. Actualmente suman ${total}%.`;
      if (category.score_questions.some((question) => !question.prompt.trim())) return "Todas las preguntas necesitan texto.";
    }
    return "";
  }

  async function persistTemplate(nextStatus = selected.status) {
    const publishing = nextStatus === "published";
    if (publishing) {
      const validation = validateTemplate();
      if (validation) { notify(validation, "error"); return false; }
    }
    setAction(publishing ? "publish" : "save");
    setNotice(null);
    try {
      const templateResult = await supabase.from("score_templates").update({
        name: selected.name.trim(), description: selected.description?.trim() || "",
        division_id: selected.division_id, max_score: 100, status: nextStatus,
        published_at: publishing ? (selected.published_at || new Date().toISOString()) : null,
        updated_at: new Date().toISOString(),
      }).eq("id", selected.id).select("id").single();
      if (templateResult.error) throw templateResult.error;
      for (const [categoryIndex, category] of selected.score_categories.entries()) {
        const categoryResult = await supabase.from("score_categories").update({
          name: category.name.trim(), description: category.description?.trim() || "",
          weight: Number(category.weight), position: categoryIndex, updated_at: new Date().toISOString(),
        }).eq("id", category.id).select("id").single();
        if (categoryResult.error) throw categoryResult.error;
        for (const [questionIndex, question] of category.score_questions.entries()) {
          const questionResult = await supabase.from("score_questions").update({
            prompt: question.prompt.trim(), help_text: question.help_text?.trim() || "",
            response_type: question.response_type, weight: Number(question.weight),
            required: Boolean(question.required), position: questionIndex,
            scale_min: Number(question.scale_min || 1), scale_max: Number(question.scale_max || 5),
            options: question.options || [], scoring_config: question.scoring_config || {},
            updated_at: new Date().toISOString(),
          }).eq("id", question.id).select("id").single();
          if (questionResult.error) throw questionResult.error;
        }
      }
      notify(publishing ? "Score publicado correctamente." : nextStatus === "draft" && selected.status === "published" ? "Score despublicado y guardado como borrador." : "Borrador guardado correctamente.");
      await loadBuilder(selected.id);
      return true;
    } catch (error) {
      notify(friendlyError(error, "No se pudieron guardar todos los cambios."), "error");
      return false;
    } finally { setAction(""); }
  }

  async function removeTemplate() {
    if (!selected || !window.confirm(`¿Eliminar el Score “${selected.name}”? Esta acción no se puede deshacer.`)) return;
    const result = await runAction("delete", () => supabase.from("score_templates").delete().eq("id", selected.id), "Score eliminado correctamente.");
    if (result) { setActiveStep(0); await loadBuilder(""); }
  }

  async function cloneSelected(templateKind = "score") {
    if (!selected) return;
    setAction("duplicate");
    setNotice(null);
    try {
      const created = await supabase.from("score_templates").insert({
        organization_id: profile.organization_id, division_id: selected.division_id,
        name: `${selected.name} — ${templateKind === "template" ? "Plantilla" : "Copia"}`,
        description: selected.description || "", max_score: 100, template_kind: templateKind,
        source_template_id: selected.id, created_by: user.id,
      }).select("id").single();
      if (created.error) throw created.error;
      for (const [categoryIndex, category] of selected.score_categories.entries()) {
        const copy = await supabase.from("score_categories").insert({
          template_id: created.data.id, name: category.name, description: category.description || "",
          weight: Number(category.weight), position: categoryIndex,
        }).select("id").single();
        if (copy.error) throw copy.error;
        if (category.score_questions.length) {
          const questions = await supabase.from("score_questions").insert(category.score_questions.map((question, index) => ({
            category_id: copy.data.id, library_question_id: question.library_question_id || null,
            prompt: question.prompt, help_text: question.help_text || "", response_type: question.response_type,
            weight: Number(question.weight), required: Boolean(question.required), position: index,
            scale_min: Number(question.scale_min || 1), scale_max: Number(question.scale_max || 5),
            options: question.options || [], scoring_config: question.scoring_config || {},
          })));
          if (questions.error) throw questions.error;
        }
      }
      setView(templateKind === "template" ? "templates" : "scores");
      setActiveStep(0);
      notify(templateKind === "template" ? "Score guardado como plantilla." : "Score duplicado correctamente.");
      await loadBuilder(created.data.id);
    } catch (error) { notify(friendlyError(error, "No se pudo duplicar el Score."), "error"); }
    finally { setAction(""); }
  }

  async function toggleFavorite() {
    if (!selected) return;
    const active = favorites.includes(selected.id);
    const result = await runAction("favorite", () => active
      ? supabase.from("score_template_favorites").delete().eq("user_id", user.id).eq("template_id", selected.id)
      : supabase.from("score_template_favorites").insert({ user_id: user.id, template_id: selected.id }));
    if (result) setFavorites((current) => active ? current.filter((id) => id !== selected.id) : [...current, selected.id]);
  }

  if (!canManageUsers) return <Page><section className="sb-card p-6 sm:p-8"><h1 className="text-2xl font-semibold">Acceso restringido</h1><p className="mt-3 sb-muted">Solo el fundador o un administrador puede construir evaluaciones.</p></section></Page>;

  const visibleTemplates = templates.filter((template) => view === "templates"
    ? template.template_kind === "template" : view === "favorites"
      ? favorites.includes(template.id) : template.template_kind !== "template");
  const visibleLibrary = library.map((category) => ({
    ...category,
    score_library_questions: category.score_library_questions.filter((question) => !librarySearch.trim()
      || `${question.title} ${question.description}`.toLowerCase().includes(librarySearch.trim().toLowerCase())),
  })).filter((category) => (libraryCategory === "all" || category.id === libraryCategory) && category.score_library_questions.length);

  return <Page className="score-builder-shell">
    <header className="sb-header">
      <div><p className="sb-eyebrow">ORVESEN Intelligence</p><h1>Score Builder</h1><p className="sb-muted max-w-3xl">Construye evaluaciones funcionales de divisiones y áreas sobre una escala real de 0 a 100.</p></div>
      <button type="button" onClick={() => setCreating((value) => !value)} className="sb-button sb-button-primary"><Plus size={18}/> Nuevo Score</button>
    </header>

    {notice && <div role="status" className={`sb-alert ${notice.type === "error" ? "sb-alert-error" : "sb-alert-success"}`}>{notice.text}</div>}

    <nav className="sb-tabs" aria-label="Bibliotecas de Score">
      {[["scores", "Mis Scores"], ["templates", "Plantillas"], ["favorites", "Favoritos"], ["official", "Biblioteca oficial"]].map(([key, label]) =>
        <button type="button" key={key} onClick={() => {
          setView(key);
          if (key !== "official") {
            const next = templates.find((template) => key === "templates"
              ? template.template_kind === "template"
              : key === "favorites" ? favorites.includes(template.id) : template.template_kind !== "template");
            setSelectedId(next?.id || "");
            setActiveStep(0);
          }
        }} className={view === key ? "active" : ""}>{label}</button>)}
    </nav>

    {creating && <section className="sb-card p-4 sm:p-6">
      <form onSubmit={createTemplate} className="grid gap-4 lg:grid-cols-[1fr_260px_auto]">
        <Field label="Nombre"><input className="sb-input" placeholder="Ej. Salud de Marketing" value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })}/></Field>
        <Field label="División"><select className="sb-input" value={draft.division_id} onChange={(event) => setDraft({ ...draft, division_id: event.target.value })}><option value="">Selecciona una división</option>{divisions.map((division) => <option key={division.id} value={division.id}>{division.name}</option>)}</select></Field>
        <button disabled={Boolean(action)} className="sb-button sb-button-primary self-end">{action === "create" && <LoaderCircle className="animate-spin" size={17}/>} Crear borrador</button>
      </form>
    </section>}

    {view === "official" ? <OfficialLibrary categories={visibleLibrary} library={library} search={librarySearch} setSearch={setLibrarySearch} selectedCategory={libraryCategory} setSelectedCategory={setLibraryCategory} onAdd={addLibraryQuestion} disabled={action === "library"}/>
      : <div className="sb-workspace">
        <ScoreList loading={loading} templates={visibleTemplates} selectedId={selectedId} view={view} onSelect={(id) => { setSelectedId(id); setActiveStep(0); setNotice(null); }}/>
        {selected ? <main className="min-w-0 space-y-5">
          <WizardNav activeStep={activeStep} setActiveStep={setActiveStep}/>
          {activeStep === 0 && <InformationStep template={selected} divisions={divisions} update={updateSelected}/>} 
          {activeStep === 1 && <CategoriesStep template={selected} updateCategory={updateCategory} addCategory={addCategory} removeCategory={removeCategory} busy={Boolean(action)}/>} 
          {activeStep === 2 && <QuestionsStep template={selected} updateQuestion={updateQuestion} addQuestion={addQuestion} removeQuestion={removeQuestion} busy={Boolean(action)}/>} 
          {activeStep === 3 && <WeightsStep template={selected} updateCategory={updateCategory} updateQuestion={updateQuestion}/>} 
          {activeStep === 4 && <PreviewStep template={selected}/>} 
          {activeStep === 5 && <PublishStep template={selected} validation={validateTemplate()} onSave={() => persistTemplate(selected.status)} onPublish={() => persistTemplate("published")} onUnpublish={() => persistTemplate("draft")} busy={Boolean(action)}/>} 
          <BuilderActions template={selected} favorites={favorites} busy={Boolean(action)} onFavorite={toggleFavorite} onDuplicate={() => cloneSelected("score")} onTemplate={() => cloneSelected("template")} onDelete={removeTemplate} onSave={() => persistTemplate(selected.status)}/>
        </main> : !loading && <section className="sb-card sb-empty"><ClipboardList size={28}/><h2>No hay Scores en esta vista</h2><p className="sb-muted">Crea un Score o selecciona otra biblioteca.</p></section>}
      </div>}
  </Page>;
}

function ScoreList({ loading, templates, selectedId, view, onSelect }) {
  return <aside className="sb-card sb-list"><div className="sb-section-title"><ClipboardList size={18}/><h2>{view === "templates" ? "Plantillas" : view === "favorites" ? "Favoritos" : "Mis Scores"}</h2></div>
    {loading ? <p className="sb-muted p-3">Cargando...</p> : <div className="space-y-2">{templates.map((template) => <button type="button" key={template.id} onClick={() => onSelect(template.id)} className={`sb-score-row ${selectedId === template.id ? "active" : ""}`}>
      <span className="min-w-0"><strong>{template.name}</strong><small>{template.divisions?.name || "Sin división"} · {template.status === "published" ? "Publicado" : "Borrador"} · /100</small><small>Actualizado {formatDate(template.updated_at)}</small></span><ChevronRight size={17}/>
    </button>)}</div>}
  </aside>;
}

function WizardNav({ activeStep, setActiveStep }) {
  return <nav className="sb-card sb-steps" aria-label="Pasos del Score Builder">{STEPS.map((step, index) => <button type="button" key={step} onClick={() => setActiveStep(index)} className={activeStep === index ? "active" : ""}><span>{index + 1}</span>{step}</button>)}</nav>;
}

function InformationStep({ template, divisions, update }) {
  return <section className="sb-card p-5 sm:p-7"><Heading title="Información" text="La misma información se utiliza al crear y al editar el Score."/><div className="grid gap-4 md:grid-cols-2">
    <Field label="Nombre"><input className="sb-input" value={template.name} onChange={(event) => update({ name: event.target.value })}/></Field>
    <Field label="División evaluada"><select className="sb-input" value={template.division_id || ""} onChange={(event) => {
      const division = divisions.find((item) => item.id === event.target.value);
      update({ division_id: event.target.value, divisions: division ? { name: division.name } : null });
    }}><option value="">Selecciona una división</option>{divisions.map((division) => <option key={division.id} value={division.id}>{division.name}</option>)}</select></Field>
    <div className="md:col-span-2"><Field label="Objetivo y descripción"><textarea rows="4" className="sb-input resize-y" value={template.description || ""} onChange={(event) => update({ description: event.target.value })}/></Field></div>
    <Field label="Escala"><input className="sb-input" value="0–100 puntos" disabled/></Field>
    <Field label="Estado"><input className="sb-input" value={template.status === "published" ? "Publicado" : "Borrador"} disabled/></Field>
  </div></section>;
}

function CategoriesStep({ template, updateCategory, addCategory, removeCategory, busy }) {
  return <section className="space-y-4"><div className="sb-card p-5 sm:p-7"><Heading title="Categorías" text="Organiza el diagnóstico y asigna un peso total de 100%."/><WeightTotal total={template.score_categories.reduce((sum, item) => sum + Number(item.weight || 0), 0)}/><button type="button" disabled={busy} onClick={addCategory} className="sb-button sb-button-secondary mt-4"><Plus size={17}/> Añadir categoría</button></div>
    {template.score_categories.map((category, index) => <article key={category.id} className="sb-card p-5 sm:p-6"><div className="mb-4 flex items-center justify-between gap-3"><strong>Categoría {index + 1}</strong><button type="button" aria-label="Eliminar categoría" onClick={() => removeCategory(category.id)} className="sb-icon-button danger"><Trash2 size={18}/></button></div><div className="grid gap-4 md:grid-cols-[1fr_150px]"><Field label="Nombre"><input className="sb-input" value={category.name} onChange={(event) => updateCategory(category.id, { name: event.target.value })}/></Field><Field label="Peso %"><input type="number" min="0" max="100" className="sb-input" value={category.weight} onChange={(event) => updateCategory(category.id, { weight: event.target.value })}/></Field><div className="md:col-span-2"><Field label="Descripción"><textarea rows="3" className="sb-input resize-y" value={category.description || ""} onChange={(event) => updateCategory(category.id, { description: event.target.value })}/></Field></div></div></article>)}
  </section>;
}

function QuestionsStep({ template, updateQuestion, addQuestion, removeQuestion, busy }) {
  return <section className="space-y-4">{template.score_categories.map((category) => <article key={category.id} className="sb-card p-5 sm:p-6"><div className="sb-section-title mb-4"><h2>{category.name}</h2><span className="sb-badge">{category.score_questions.length} preguntas</span></div><div className="space-y-4">{category.score_questions.map((question, index) => <div key={question.id} className="sb-question"><div className="flex items-center justify-between gap-3"><strong>Pregunta {index + 1}</strong><button type="button" aria-label="Eliminar pregunta" onClick={() => removeQuestion(category.id, question.id)} className="sb-icon-button danger"><Trash2 size={17}/></button></div><div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Field label="Pregunta"><input className="sb-input" value={question.prompt} onChange={(event) => updateQuestion(category.id, question.id, { prompt: event.target.value })}/></Field>
        <Field label="Tipo de respuesta"><select className="sb-input" value={question.response_type} onChange={(event) => updateQuestion(category.id, question.id, { response_type: event.target.value })}>{responseTypes.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field>
        <div className="lg:col-span-2"><Field label="Descripción o ayuda"><textarea rows="2" className="sb-input resize-y" value={question.help_text || ""} onChange={(event) => updateQuestion(category.id, question.id, { help_text: event.target.value })}/></Field></div>
        {question.response_type === "scale" && <><Field label="Valor mínimo"><input type="number" className="sb-input" value={question.scale_min || 1} onChange={(event) => updateQuestion(category.id, question.id, { scale_min: event.target.value })}/></Field><Field label="Valor máximo"><input type="number" className="sb-input" value={question.scale_max || 5} onChange={(event) => updateQuestion(category.id, question.id, { scale_max: event.target.value })}/></Field></>}
        {question.response_type === "multiple_choice" && <div className="lg:col-span-2"><Field label="Opciones (una por línea)"><textarea rows="3" className="sb-input resize-y" value={(question.options || []).join("\n")} onChange={(event) => updateQuestion(category.id, question.id, { options: event.target.value.split("\n").map((item) => item.trim()).filter(Boolean) })}/></Field></div>}
        <label className="sb-check"><input type="checkbox" checked={Boolean(question.required)} onChange={(event) => updateQuestion(category.id, question.id, { required: event.target.checked })}/> Respuesta obligatoria</label>
      </div></div>)}<button type="button" disabled={busy} onClick={() => addQuestion(category)} className="sb-button sb-button-secondary"><Plus size={17}/> Añadir pregunta</button></div></article>)}</section>;
}

function WeightsStep({ template, updateCategory, updateQuestion }) {
  const total = template.score_categories.reduce((sum, item) => sum + Number(item.weight || 0), 0);
  return <section className="space-y-4"><div className="sb-card p-5 sm:p-7"><Heading title="Pesos" text="Las categorías deben sumar 100%; dentro de cada categoría, sus preguntas también deben sumar 100%."/><WeightTotal total={total}/></div>{template.score_categories.map((category) => { const questionTotal = category.score_questions.reduce((sum, item) => sum + Number(item.weight || 0), 0); return <article key={category.id} className="sb-card p-5 sm:p-6"><div className="flex flex-wrap items-center justify-between gap-3"><h2 className="font-semibold">{category.name}</h2><WeightTotal total={questionTotal} compact/></div><div className="mt-4 grid gap-3"><Field label="Peso de la categoría"><input type="number" min="0" max="100" className="sb-input" value={category.weight} onChange={(event) => updateCategory(category.id, { weight: event.target.value })}/></Field>{category.score_questions.map((question) => <div key={question.id} className="sb-weight-row"><span>{question.prompt}</span><input aria-label={`Peso de ${question.prompt}`} type="number" min="0" max="100" className="sb-input" value={question.weight} onChange={(event) => updateQuestion(category.id, question.id, { weight: event.target.value })}/></div>)}</div></article>; })}</section>;
}

function PreviewStep({ template }) {
  return <section className="sb-card p-5 sm:p-8"><Heading title="Vista previa" text="Así se presenta la estructura de la evaluación antes de publicarla."/><div className="sb-preview"><div className="sb-score-ring"><strong>0</strong><span>/100</span></div><div><p className="sb-eyebrow">{template.divisions?.name || "División"}</p><h2>{template.name}</h2><p className="sb-muted">{template.description || "Sin descripción"}</p></div></div><div className="mt-6 grid gap-3 md:grid-cols-2">{template.score_categories.map((category) => <article className="sb-question" key={category.id}><div className="flex justify-between gap-3"><strong>{category.name}</strong><span>{category.weight}%</span></div><p className="mt-2 sb-muted text-sm">{category.score_questions.length} preguntas</p></article>)}</div></section>;
}

function PublishStep({ template, validation, onSave, onPublish, onUnpublish, busy }) {
  return <section className="sb-card p-5 sm:p-8"><Heading title="Publicar" text="Guardar conserva el estado actual. Publicar lo deja disponible para el flujo conectado de ORVESEN."/><div className={`sb-alert ${validation ? "sb-alert-error" : "sb-alert-success"}`}>{validation || "El Score cumple las validaciones y está listo para publicarse."}</div><dl className="sb-summary"><div><dt>Score</dt><dd>{template.name}</dd></div><div><dt>División</dt><dd>{template.divisions?.name || "Seleccionada"}</dd></div><div><dt>Escala</dt><dd>0–100</dd></div><div><dt>Estado</dt><dd>{template.status === "published" ? "Publicado" : "Borrador"}</dd></div></dl><div className="mt-6 flex flex-col gap-3 sm:flex-row">{template.status === "published" ? <button type="button" disabled={busy} onClick={onUnpublish} className="sb-button sb-button-secondary"><ArchiveRestore size={17}/> Despublicar</button> : <button type="button" disabled={busy || Boolean(validation)} onClick={onPublish} className="sb-button sb-button-primary"><Check size={17}/> Publicar Score</button>}<button type="button" disabled={busy} onClick={onSave} className="sb-button sb-button-secondary"><Save size={17}/> {template.status === "published" ? "Guardar cambios" : "Guardar borrador"}</button></div></section>;
}

function BuilderActions({ template, favorites, busy, onFavorite, onDuplicate, onTemplate, onDelete, onSave }) {
  return <footer className="sb-card sb-actions"><div><button type="button" disabled={busy} onClick={onFavorite} className="sb-button sb-button-ghost"><Heart size={16} fill={favorites.includes(template.id) ? "currentColor" : "none"}/> Favorito</button><button type="button" disabled={busy} onClick={onDuplicate} className="sb-button sb-button-ghost"><Copy size={16}/> Duplicar</button><button type="button" disabled={busy} onClick={onTemplate} className="sb-button sb-button-ghost"><Library size={16}/> Guardar como plantilla</button></div><div><button type="button" disabled={busy} onClick={onDelete} className="sb-button sb-button-danger"><Trash2 size={16}/> Eliminar</button><button type="button" disabled={busy} onClick={onSave} className="sb-button sb-button-primary">{busy ? <LoaderCircle className="animate-spin" size={17}/> : <Save size={17}/>} Guardar</button></div></footer>;
}

function OfficialLibrary({ categories, library, search, setSearch, selectedCategory, setSelectedCategory, onAdd, disabled }) {
  return <section className="space-y-4"><div className="sb-card sb-library-filter"><label><Search size={17}/><input placeholder="Buscar preguntas profesionales" value={search} onChange={(event) => setSearch(event.target.value)}/></label><select className="sb-input" value={selectedCategory} onChange={(event) => setSelectedCategory(event.target.value)}><option value="all">Todas las categorías</option>{library.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></div>{categories.map((category) => <article key={category.id} className="sb-card p-5 sm:p-6"><Heading title={category.name} text={category.description}/><div className="grid gap-3 lg:grid-cols-2">{category.score_library_questions.map((question) => <div key={question.id} className="sb-question"><h3>{question.title}</h3><p className="mt-2 sb-muted text-sm">{question.description}</p><div className="mt-4 flex flex-wrap items-center justify-between gap-3"><small>{question.difficulty} · peso recomendado {question.recommended_weight}%</small><button type="button" disabled={disabled} onClick={() => onAdd(category, question)} className="sb-button sb-button-secondary">Añadir al Score</button></div></div>)}</div></article>)}</section>;
}

function Heading({ title, text }) { return <div className="mb-5"><h2 className="text-xl font-semibold">{title}</h2>{text && <p className="mt-2 sb-muted">{text}</p>}</div>; }
function Field({ label, children }) { return <label className="block"><span className="mb-2 block text-sm font-medium sb-label">{label}</span>{children}</label>; }
function WeightTotal({ total, compact = false }) { const valid = Math.abs(total - 100) <= 0.01; return <div className={`sb-weight-total ${valid ? "valid" : "invalid"} ${compact ? "compact" : ""}`}><span>Total</span><strong>{total}%</strong><small>{valid ? "Correcto" : "Debe sumar 100%"}</small></div>; }
function formatDate(value) { return value ? new Intl.DateTimeFormat("es", { dateStyle: "medium" }).format(new Date(value)) : "sin fecha"; }

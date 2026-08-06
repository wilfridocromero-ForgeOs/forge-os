import { useEffect, useMemo, useState } from "react";
import { Check, ChevronRight, ClipboardList, Copy, Heart, Library, Plus, Save, Search, Trash2 } from "lucide-react";

import Card from "../components/ui/Card";
import Page from "../components/ui/Page";
import { useAuth } from "../Context/AuthContext";
import { supabase } from "../lib/supabase";
import { useDivisions } from "../hooks/useDivisions";

const blankTemplate = { name: "", division_id: "", description: "" };

export default function ScoreBuilder() {
  const { canManageUsers, profile, user } = useAuth();
  const [templates, setTemplates] = useState([]);
  const { divisions } = useDivisions(profile?.organization_id);
  const [selectedId, setSelectedId] = useState("");
  const [draft, setDraft] = useState(blankTemplate);
  const [creating, setCreating] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [messageType, setMessageType] = useState("success");
  const [library, setLibrary] = useState([]);
  const [librarySearch, setLibrarySearch] = useState("");
  const [libraryCategory, setLibraryCategory] = useState("all");
  const [view, setView] = useState("builder");
  const [favorites, setFavorites] = useState([]);

  function notify(text, type = "success") {
    setMessage(text);
    setMessageType(type);
  }

  const selected = useMemo(
    () => templates.find((template) => template.id === selectedId),
    [templates, selectedId],
  );

  async function loadBuilder(preferredId = selectedId) {
    setLoading(true);
    const [templatesResult, libraryResult, favoritesResult] = await Promise.all([
      supabase
        .from("score_templates")
        .select("id, name, description, status, template_kind, source_template_id, division_id, max_score, published_at, divisions(name), score_instances(id, current_score, max_score, percentage, status, computed_at), score_metrics(id, code, name, source_type, weight, target_value, active), score_categories(id, name, description, weight, position, score_questions(id, prompt, help_text, response_type, weight, required, position, library_question_id, scale_min, scale_max, options, scoring_config))")
        .order("updated_at", { ascending: false }),
      supabase.from("score_library_categories").select("id, name, description, position, is_official, divisions(name), score_library_questions(id, title, description, recommended_weight, difficulty, response_type, options)").eq("is_official", true).order("position"),
      supabase.from("score_template_favorites").select("template_id").eq("user_id", user.id),
    ]);
    const error = templatesResult.error || libraryResult.error || favoritesResult.error;
    if (error) notify(error.message, "error");
    const nextTemplates = (templatesResult.data || []).map((template) => ({
      ...template,
      score_categories: (template.score_categories || [])
        .sort((a, b) => a.position - b.position)
        .map((category) => ({
          ...category,
          score_questions: (category.score_questions || []).sort((a, b) => a.position - b.position),
        })),
    }));
    setTemplates(nextTemplates);
    setLibrary((libraryResult.data || []).map((category) => ({ ...category, score_library_questions: (category.score_library_questions || []).sort((a, b) => a.title.localeCompare(b.title)) })));
    setFavorites((favoritesResult.data || []).map((item) => item.template_id));
    const nextId = nextTemplates.some((item) => item.id === preferredId) ? preferredId : nextTemplates[0]?.id || "";
    setSelectedId(nextId);
    setLoading(false);
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (canManageUsers && profile?.organization_id) loadBuilder();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canManageUsers, profile?.organization_id]);

  function updateSelected(changes) {
    setTemplates((current) => current.map((item) => (item.id === selectedId ? { ...item, ...changes } : item)));
  }

  function updateCategory(categoryId, changes) {
    updateSelected({
      score_categories: selected.score_categories.map((category) =>
        category.id === categoryId ? { ...category, ...changes } : category,
      ),
    });
  }

  function updateQuestion(categoryId, questionId, changes) {
    updateCategory(categoryId, {
      score_questions: selected.score_categories
        .find((category) => category.id === categoryId)
        .score_questions.map((question) => (question.id === questionId ? { ...question, ...changes } : question)),
    });
  }

  async function createTemplate(event) {
    event.preventDefault();
    if (!draft.name.trim() || !draft.division_id) return notify("Escribe el nombre y selecciona una división.", "error");
    setSaving(true);
    const { data, error } = await supabase
      .from("score_templates")
      .insert({
        organization_id: profile.organization_id,
        division_id: draft.division_id,
        name: draft.name.trim(),
        description: draft.description.trim(),
        created_by: user.id,
      })
      .select("id")
      .single();
    setSaving(false);
    if (error) return notify(error.message, "error");
    setDraft(blankTemplate);
    setCreating(false);
    notify("Score creado correctamente como borrador.");
    await loadBuilder(data.id);
  }

  async function addCategory() {
    const { data, error } = await supabase
      .from("score_categories")
      .insert({ template_id: selected.id, name: "Nueva categoría", weight: 0, position: selected.score_categories.length })
      .select("id, name, description, weight, position")
      .single();
    if (error) return notify(error.message, "error");
    updateSelected({ score_categories: [...selected.score_categories, { ...data, score_questions: [] }] });
  }

  async function addQuestion(category) {
    const { data, error } = await supabase
      .from("score_questions")
      .insert({ category_id: category.id, prompt: "Nueva pregunta", weight: 0, position: category.score_questions.length })
      .select("id, prompt, help_text, response_type, weight, required, position, scale_min, scale_max, options, scoring_config")
      .single();
    if (error) return notify(error.message, "error");
    updateCategory(category.id, { score_questions: [...category.score_questions, data] });
  }

  async function addLibraryQuestion(category, question) {
    if (!selected) return notify("Selecciona o crea un Score antes de añadir preguntas.", "error");
    let target = selected.score_categories.find((item) => item.name.trim().toLowerCase() === category.name.trim().toLowerCase());
    if (!target) {
      const categoryResult = await supabase.from("score_categories").insert({ template_id: selected.id, name: category.name, description: category.description || "", weight: 0, position: selected.score_categories.length }).select("id, name, description, weight, position").single();
      if (categoryResult.error) return notify(categoryResult.error.message, "error");
      target = { ...categoryResult.data, score_questions: [] };
      updateSelected({ score_categories: [...selected.score_categories, target] });
    }
    const responseType = question.response_type === "boolean" ? "yes_no" : question.response_type;
    const result = await supabase.from("score_questions").insert({ category_id: target.id, library_question_id: question.id, prompt: question.title, help_text: question.description, response_type: responseType, options: question.options || [], weight: 0, position: target.score_questions.length }).select("id, prompt, help_text, response_type, weight, required, position, library_question_id, scale_min, scale_max, options, scoring_config").single();
    if (result.error) return notify(result.error.message, "error");
    await loadBuilder(selected.id);
    notify("Pregunta oficial añadida. Ajusta los pesos antes de publicar.");
  }

  async function removeCategory(categoryId) {
    if (!window.confirm("¿Eliminar esta categoría y todas sus preguntas?")) return;
    const { error } = await supabase.from("score_categories").delete().eq("id", categoryId);
    if (error) return notify(error.message, "error");
    updateSelected({ score_categories: selected.score_categories.filter((category) => category.id !== categoryId) });
  }

  async function removeQuestion(categoryId, questionId) {
    const { error } = await supabase.from("score_questions").delete().eq("id", questionId);
    if (error) return notify(error.message, "error");
    const category = selected.score_categories.find((item) => item.id === categoryId);
    updateCategory(categoryId, { score_questions: category.score_questions.filter((question) => question.id !== questionId) });
  }

  function validateTemplate() {
    if (!selected.name.trim()) return "La evaluación necesita un nombre.";
    if (!selected.score_categories.length) return "Añade por lo menos una categoría.";
    const categoryTotal = selected.score_categories.reduce((sum, item) => sum + Number(item.weight || 0), 0);
    if (Math.abs(categoryTotal - 100) > 0.01) return `Los pesos de las categorías deben sumar 100%. Ahora suman ${categoryTotal}%.`;
    for (const category of selected.score_categories) {
      if (!category.score_questions.length) return `La categoría “${category.name}” necesita preguntas.`;
      const questionTotal = category.score_questions.reduce((sum, item) => sum + Number(item.weight || 0), 0);
      if (Math.abs(questionTotal - 100) > 0.01) return `Las preguntas de “${category.name}” deben sumar 100%. Ahora suman ${questionTotal}%.`;
      if (category.score_questions.some((question) => !question.prompt.trim())) return "Todas las preguntas necesitan texto.";
    }
    return "";
  }

  async function saveTemplate(publish = false) {
    if (publish) {
      const validation = validateTemplate();
      if (validation) return notify(validation, "error");
    }
    setSaving(true);
    setMessage("");
    const templatePayload = {
      name: selected.name.trim(),
      description: selected.description.trim(),
      division_id: selected.division_id,
      status: publish ? "published" : selected.status,
      published_at: publish ? new Date().toISOString() : selected.published_at,
      updated_at: new Date().toISOString(),
    };
    const templateResult = await supabase.from("score_templates").update(templatePayload).eq("id", selected.id);
    let error = templateResult.error;
    for (let categoryIndex = 0; categoryIndex < selected.score_categories.length && !error; categoryIndex += 1) {
      const category = selected.score_categories[categoryIndex];
      const categoryResult = await supabase.from("score_categories").update({
        name: category.name.trim(), description: category.description?.trim() || "", weight: Number(category.weight), position: categoryIndex, updated_at: new Date().toISOString(),
      }).eq("id", category.id);
      error = categoryResult.error;
      for (let questionIndex = 0; questionIndex < category.score_questions.length && !error; questionIndex += 1) {
        const question = category.score_questions[questionIndex];
        const questionResult = await supabase.from("score_questions").update({
          prompt: question.prompt.trim(), help_text: question.help_text?.trim() || "", response_type: question.response_type, weight: Number(question.weight), required: question.required, position: questionIndex, options: question.options || [], scoring_config: question.scoring_config || {}, updated_at: new Date().toISOString(),
        }).eq("id", question.id);
        error = questionResult.error;
      }
    }
    setSaving(false);
    if (error) return notify(error.message, "error");
    notify(publish ? "Score publicado. Ya está listo para responderse en Discovery." : "Cambios guardados correctamente.");
    await loadBuilder(selected.id);
  }

  async function removeTemplate() {
    if (!selected || !window.confirm(`¿Eliminar el Score “${selected.name}”? También se eliminarán sus categorías y preguntas.`)) return;
    setSaving(true);
    const { error } = await supabase.from("score_templates").delete().eq("id", selected.id);
    setSaving(false);
    if (error) return notify(error.message, "error");
    notify("Score eliminado correctamente.");
    await loadBuilder("");
  }

  async function cloneSelected(templateKind = "score") {
    if (!selected) return;
    setSaving(true);
    const created = await supabase.from("score_templates").insert({
      organization_id: profile.organization_id,
      division_id: selected.division_id,
      name: `${selected.name} ${templateKind === "template" ? "— Plantilla" : "— Copia"}`,
      description: selected.description,
      max_score: selected.max_score,
      template_kind: templateKind,
      source_template_id: selected.id,
      created_by: user.id,
    }).select("id").single();
    if (created.error) { setSaving(false); return notify(created.error.message, "error"); }
    for (const [categoryIndex, category] of selected.score_categories.entries()) {
      const categoryCopy = await supabase.from("score_categories").insert({ template_id: created.data.id, name: category.name, description: category.description || "", weight: Number(category.weight), position: categoryIndex }).select("id").single();
      if (categoryCopy.error) { setSaving(false); return notify(categoryCopy.error.message, "error"); }
      if (category.score_questions.length) {
        const result = await supabase.from("score_questions").insert(category.score_questions.map((question, index) => ({ category_id: categoryCopy.data.id, library_question_id: question.library_question_id || null, prompt: question.prompt, help_text: question.help_text || "", response_type: question.response_type, weight: Number(question.weight), required: question.required, position: index, options: question.options || [], scoring_config: question.scoring_config || {} })));
        if (result.error) { setSaving(false); return notify(result.error.message, "error"); }
      }
    }
    setSaving(false);
    setView(templateKind === "template" ? "templates" : "builder");
    notify(templateKind === "template" ? "Guardado en la Biblioteca de Plantillas." : "Score duplicado correctamente.");
    await loadBuilder(created.data.id);
  }

  async function toggleFavorite() {
    if (!selected) return;
    const active = favorites.includes(selected.id);
    const result = active
      ? await supabase.from("score_template_favorites").delete().eq("user_id", user.id).eq("template_id", selected.id)
      : await supabase.from("score_template_favorites").insert({ user_id: user.id, template_id: selected.id });
    if (result.error) return notify(result.error.message, "error");
    setFavorites((current) => active ? current.filter((id) => id !== selected.id) : [...current, selected.id]);
  }


  if (!canManageUsers) {
    return <Page><Card hover={false} contentClassName="p-8"><h1 className="text-2xl font-semibold text-white">Acceso restringido</h1><p className="mt-3 text-zinc-400">Solo el fundador o un administrador puede construir evaluaciones.</p></Card></Page>;
  }

  const visibleLibrary = library.map((category) => ({ ...category, score_library_questions: category.score_library_questions.filter((question) => !librarySearch.trim() || `${question.title} ${question.description}`.toLowerCase().includes(librarySearch.trim().toLowerCase())) })).filter((category) => (libraryCategory === "all" || category.id === libraryCategory) && category.score_library_questions.length);

  return (
    <Page className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div><p className="text-xs uppercase tracking-[0.3em] text-zinc-500">ORVESEN Intelligence</p><h1 className="mt-2 text-3xl font-semibold text-white">Score Builder</h1><p className="mt-2 max-w-2xl text-zinc-400">Diseña las evaluaciones que calcularán el score real de cada división. Aquí defines el método; nunca escribes el resultado.</p></div>
        <button onClick={() => setCreating((value) => !value)} className="flex items-center justify-center gap-2 rounded-xl bg-white px-5 py-3 font-medium text-black"><Plus size={18} /> Nueva evaluación</button>
      </div>

      {message && <div className={`rounded-xl border px-4 py-3 text-sm ${messageType === "error" ? "border-red-900/60 bg-red-950/20 text-red-300" : "border-emerald-900/60 bg-emerald-950/20 text-emerald-300"}`}>{message}</div>}

      <div className="flex gap-2 overflow-x-auto border-b border-zinc-800 pb-3">
        <button onClick={() => setView("builder")} className={`shrink-0 rounded-xl px-4 py-2.5 text-sm ${view === "builder" ? "bg-white text-black" : "bg-zinc-900 text-zinc-400"}`}>Mis Scores</button>
        <button onClick={() => setView("templates")} className={`shrink-0 rounded-xl px-4 py-2.5 text-sm ${view === "templates" ? "bg-white text-black" : "bg-zinc-900 text-zinc-400"}`}>Plantillas</button>
        <button onClick={() => setView("favorites")} className={`shrink-0 rounded-xl px-4 py-2.5 text-sm ${view === "favorites" ? "bg-white text-black" : "bg-zinc-900 text-zinc-400"}`}>Favoritos</button>
        <button onClick={() => setView("official")} className={`shrink-0 rounded-xl px-4 py-2.5 text-sm ${view === "official" ? "bg-white text-black" : "bg-zinc-900 text-zinc-400"}`}>Biblioteca Oficial ORVESEN</button>
      </div>

      {view === "official" && <section className="space-y-4">
        <Card hover={false} contentClassName="grid gap-3 p-4 lg:grid-cols-[1fr_260px]"><div className="flex items-center gap-3 rounded-xl border border-zinc-800 bg-zinc-950 px-4"><Search size={17} className="text-zinc-600"/><input className="min-w-0 flex-1 bg-transparent py-3 text-sm text-white outline-none" placeholder="Buscar preguntas profesionales" value={librarySearch} onChange={(event) => setLibrarySearch(event.target.value)} /></div><select className="field" value={libraryCategory} onChange={(event) => setLibraryCategory(event.target.value)}><option value="all">Todas las categorías</option>{library.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></Card>
        {visibleLibrary.map((category) => <Card key={category.id} hover={false} contentClassName="p-5 sm:p-6"><div className="mb-4 flex items-start gap-3"><Library size={19} className="mt-0.5 text-zinc-500"/><div><h2 className="font-semibold text-white">{category.name}</h2><p className="mt-1 text-sm text-zinc-500">{category.description}</p></div></div><div className="grid gap-2 lg:grid-cols-2">{category.score_library_questions.map((question) => <article key={question.id} className="flex flex-col rounded-xl border border-zinc-800 bg-zinc-950/60 p-4"><h3 className="text-sm font-medium text-white">{question.title}</h3><p className="mt-2 flex-1 text-xs leading-5 text-zinc-500">{question.description}</p><div className="mt-4 flex items-center justify-between gap-3"><span className="text-[11px] uppercase tracking-wider text-zinc-600">{question.difficulty} · peso {question.recommended_weight}%</span><button onClick={() => addLibraryQuestion(category, question)} className="rounded-lg border border-zinc-700 px-3 py-2 text-xs text-zinc-300 hover:bg-zinc-800">Añadir al Score</button></div></article>)}</div></Card>)}
      </section>}

      {view === "builder" && creating && <Card hover={false} contentClassName="p-6"><form onSubmit={createTemplate} className="grid gap-4 lg:grid-cols-[1fr_240px_auto]"><input className="field" placeholder="Nombre de la evaluación" value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /><select className="field" value={draft.division_id} onChange={(event) => setDraft({ ...draft, division_id: event.target.value })}><option value="">Selecciona división</option>{divisions.map((division) => <option key={division.id} value={division.id}>{division.name}</option>)}</select><button disabled={saving} className="rounded-xl bg-white px-5 py-3 font-medium text-black">Crear borrador</button></form></Card>}

      {["builder", "templates", "favorites"].includes(view) && <div className="grid gap-6 xl:grid-cols-[320px_1fr]">
        <Card hover={false} contentClassName="p-4"><div className="mb-3 flex items-center gap-2 px-2 font-medium text-zinc-300"><ClipboardList size={18} /> {view === "templates" ? "Plantillas reutilizables" : view === "favorites" ? "Favoritos" : "Evaluaciones"}</div><div className="space-y-2">{loading && <p className="p-3 text-sm text-zinc-500">Cargando...</p>}{templates.filter((template) => view === "templates" ? template.template_kind === "template" : view === "favorites" ? favorites.includes(template.id) : template.template_kind !== "template").map((template) => <button key={template.id} onClick={() => { setSelectedId(template.id); setMessage(""); }} className={`flex w-full items-center justify-between rounded-xl border p-4 text-left ${selectedId === template.id ? "border-zinc-500 bg-zinc-800" : "border-transparent bg-zinc-900/70"}`}><span><span className="block font-medium text-white">{template.name}</span><span className="mt-1 block text-xs text-zinc-500">{template.divisions?.name} · {template.status === "published" ? "Publicada" : "Borrador"} · {template.score_instances?.[0]?.current_score ?? 0}/{template.score_instances?.[0]?.max_score ?? template.max_score}</span></span><ChevronRight size={17} /></button>)}</div></Card>

        {selected && <div className="space-y-5">
          <Card hover={false} contentClassName="p-5 sm:p-6"><div className="grid gap-4 md:grid-cols-2"><Field label="Nombre"><input className="field" value={selected.name} onChange={(event) => updateSelected({ name: event.target.value })} /></Field><Field label="División evaluada"><select className="field" value={selected.division_id || ""} onChange={(event) => updateSelected({ division_id: event.target.value })}>{divisions.map((division) => <option key={division.id} value={division.id}>{division.name}</option>)}</select></Field><div className="md:col-span-2"><Field label="Objetivo de la evaluación"><textarea rows="2" className="field resize-none" value={selected.description} onChange={(event) => updateSelected({ description: event.target.value })} /></Field></div></div></Card>

          {selected.score_categories.map((category) => <Card key={category.id} hover={false} contentClassName="p-5 sm:p-6"><div className="flex flex-col gap-4 sm:flex-row sm:items-end"><div className="flex-1"><Field label="Categoría"><input className="field" value={category.name} onChange={(event) => updateCategory(category.id, { name: event.target.value })} /></Field></div><div className="sm:w-36"><Field label="Peso total %"><input type="number" min="0" max="100" className="field" value={category.weight} onChange={(event) => updateCategory(category.id, { weight: event.target.value })} /></Field></div><button onClick={() => removeCategory(category.id)} className="rounded-xl border border-zinc-700 p-3 text-zinc-400 hover:text-white"><Trash2 size={18} /></button></div><div className="mt-5 space-y-3">{category.score_questions.map((question, index) => <div key={question.id} className="grid gap-3 rounded-xl border border-zinc-800 bg-zinc-900/60 p-4 lg:grid-cols-[1fr_150px_120px_auto]"><Field label={`Pregunta ${index + 1}`}><input className="field" value={question.prompt} onChange={(event) => updateQuestion(category.id, question.id, { prompt: event.target.value })} /></Field><Field label="Respuesta"><select className="field" value={question.response_type} onChange={(event) => updateQuestion(category.id, question.id, { response_type: event.target.value })}><option value="scale">Escala 1 a 5</option><option value="yes_no">Sí o no</option></select></Field><Field label="Peso %"><input type="number" min="0" max="100" className="field" value={question.weight} onChange={(event) => updateQuestion(category.id, question.id, { weight: event.target.value })} /></Field><button onClick={() => removeQuestion(category.id, question.id)} className="self-end rounded-xl border border-zinc-700 p-3 text-zinc-400"><Trash2 size={18} /></button></div>)}<button onClick={() => addQuestion(category)} className="flex items-center gap-2 rounded-xl border border-zinc-700 px-4 py-3 text-sm text-zinc-300"><Plus size={16} /> Añadir pregunta</button></div></Card>)}

          <div className="flex flex-col gap-3"><div className="flex flex-wrap gap-2"><button onClick={toggleFavorite} className="flex items-center gap-2 rounded-xl border border-zinc-700 px-4 py-2.5 text-sm text-zinc-300"><Heart size={16} fill={favorites.includes(selected.id) ? "currentColor" : "none"}/> Favorito</button><button disabled={saving} onClick={() => cloneSelected("score")} className="flex items-center gap-2 rounded-xl border border-zinc-700 px-4 py-2.5 text-sm text-zinc-300"><Copy size={16}/> Duplicar</button><button disabled={saving} onClick={() => cloneSelected("template")} className="flex items-center gap-2 rounded-xl border border-zinc-700 px-4 py-2.5 text-sm text-zinc-300"><Library size={16}/> Guardar como plantilla</button></div><div className="flex flex-col gap-3 sm:flex-row sm:justify-between"><div className="flex flex-col gap-3 sm:flex-row"><button onClick={addCategory} className="flex items-center justify-center gap-2 rounded-xl border border-zinc-700 px-5 py-3 text-zinc-200"><Plus size={17} /> Añadir categoría</button><button disabled={saving} onClick={removeTemplate} className="flex items-center justify-center gap-2 rounded-xl border border-red-900/70 px-5 py-3 text-red-300"><Trash2 size={17} /> Eliminar Score</button></div><div className="flex flex-col gap-3 sm:flex-row"><button disabled={saving} onClick={() => saveTemplate(false)} className="flex items-center justify-center gap-2 rounded-xl border border-zinc-700 px-5 py-3 text-zinc-200"><Save size={17} /> Guardar cambios</button><button disabled={saving || selected.status === "published"} onClick={() => saveTemplate(true)} className="flex items-center justify-center gap-2 rounded-xl bg-white px-5 py-3 font-medium text-black disabled:opacity-50"><Check size={17} /> {selected.status === "published" ? "Publicada" : "Publicar evaluación"}</button></div></div></div>
        </div>}
      </div>}
    </Page>
  );
}

function Field({ label, children }) {
  return <label className="block"><span className="mb-2 block text-sm text-zinc-400">{label}</span>{children}</label>;
}

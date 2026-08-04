import { useEffect, useMemo, useState } from "react";
import { Check, ChevronRight, ClipboardList, Plus, Save, Trash2 } from "lucide-react";

import Card from "../components/ui/Card";
import Page from "../components/ui/Page";
import { useAuth } from "../Context/AuthContext";
import { supabase } from "../lib/supabase";

const blankTemplate = { name: "", area_id: "", description: "" };

export default function ScoreBuilder() {
  const { canManageUsers, profile, user } = useAuth();
  const [templates, setTemplates] = useState([]);
  const [areas, setAreas] = useState([]);
  const [selectedId, setSelectedId] = useState("");
  const [draft, setDraft] = useState(blankTemplate);
  const [creating, setCreating] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  const selected = useMemo(
    () => templates.find((template) => template.id === selectedId),
    [templates, selectedId],
  );

  async function loadBuilder(preferredId = selectedId) {
    setLoading(true);
    const [areasResult, templatesResult] = await Promise.all([
      supabase.from("work_areas").select("id, name").eq("active", true).order("name"),
      supabase
        .from("score_templates")
        .select("id, name, description, status, area_id, max_score, published_at, work_areas(name), score_categories(id, name, description, weight, position, score_questions(id, prompt, help_text, response_type, weight, required, position))")
        .order("updated_at", { ascending: false }),
    ]);
    const error = areasResult.error || templatesResult.error;
    if (error) setMessage(error.message);
    const nextTemplates = (templatesResult.data || []).map((template) => ({
      ...template,
      score_categories: (template.score_categories || [])
        .sort((a, b) => a.position - b.position)
        .map((category) => ({
          ...category,
          score_questions: (category.score_questions || []).sort((a, b) => a.position - b.position),
        })),
    }));
    setAreas(areasResult.data || []);
    setTemplates(nextTemplates);
    const nextId = nextTemplates.some((item) => item.id === preferredId) ? preferredId : nextTemplates[0]?.id || "";
    setSelectedId(nextId);
    setLoading(false);
  }

  useEffect(() => {
    if (canManageUsers && profile?.organization_id) loadBuilder();
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
    if (!draft.name.trim() || !draft.area_id) return setMessage("Escribe el nombre y selecciona una división.");
    setSaving(true);
    const { data, error } = await supabase
      .from("score_templates")
      .insert({
        organization_id: profile.organization_id,
        area_id: draft.area_id,
        name: draft.name.trim(),
        description: draft.description.trim(),
        created_by: user.id,
      })
      .select("id")
      .single();
    setSaving(false);
    if (error) return setMessage(error.message);
    setDraft(blankTemplate);
    setCreating(false);
    setMessage("Evaluación creada como borrador.");
    await loadBuilder(data.id);
  }

  async function addCategory() {
    const { data, error } = await supabase
      .from("score_categories")
      .insert({ template_id: selected.id, name: "Nueva categoría", weight: 0, position: selected.score_categories.length })
      .select("id, name, description, weight, position")
      .single();
    if (error) return setMessage(error.message);
    updateSelected({ score_categories: [...selected.score_categories, { ...data, score_questions: [] }] });
  }

  async function addQuestion(category) {
    const { data, error } = await supabase
      .from("score_questions")
      .insert({ category_id: category.id, prompt: "Nueva pregunta", weight: 0, position: category.score_questions.length })
      .select("id, prompt, help_text, response_type, weight, required, position")
      .single();
    if (error) return setMessage(error.message);
    updateCategory(category.id, { score_questions: [...category.score_questions, data] });
  }

  async function removeCategory(categoryId) {
    if (!window.confirm("¿Eliminar esta categoría y todas sus preguntas?")) return;
    const { error } = await supabase.from("score_categories").delete().eq("id", categoryId);
    if (error) return setMessage(error.message);
    updateSelected({ score_categories: selected.score_categories.filter((category) => category.id !== categoryId) });
  }

  async function removeQuestion(categoryId, questionId) {
    const { error } = await supabase.from("score_questions").delete().eq("id", questionId);
    if (error) return setMessage(error.message);
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
      if (validation) return setMessage(validation);
    }
    setSaving(true);
    setMessage("");
    const templatePayload = {
      name: selected.name.trim(),
      description: selected.description.trim(),
      area_id: selected.area_id,
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
          prompt: question.prompt.trim(), help_text: question.help_text?.trim() || "", response_type: question.response_type, weight: Number(question.weight), required: question.required, position: questionIndex, updated_at: new Date().toISOString(),
        }).eq("id", question.id);
        error = questionResult.error;
      }
    }
    setSaving(false);
    if (error) return setMessage(error.message);
    setMessage(publish ? "Evaluación publicada. Ya está lista para responderse en Discovery." : "Borrador guardado.");
    await loadBuilder(selected.id);
  }

  if (!canManageUsers) {
    return <Page><Card hover={false} contentClassName="p-8"><h1 className="text-2xl font-semibold text-white">Acceso restringido</h1><p className="mt-3 text-zinc-400">Solo el fundador o un administrador puede construir evaluaciones.</p></Card></Page>;
  }

  return (
    <Page className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div><p className="text-xs uppercase tracking-[0.3em] text-zinc-500">ORVESEN Intelligence</p><h1 className="mt-2 text-3xl font-semibold text-white">Score Builder</h1><p className="mt-2 max-w-2xl text-zinc-400">Diseña las evaluaciones que calcularán el score real de cada división. Aquí defines el método; nunca escribes el resultado.</p></div>
        <button onClick={() => setCreating((value) => !value)} className="flex items-center justify-center gap-2 rounded-xl bg-white px-5 py-3 font-medium text-black"><Plus size={18} /> Nueva evaluación</button>
      </div>

      {message && <div className="rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-3 text-sm text-zinc-200">{message}</div>}

      {creating && <Card hover={false} contentClassName="p-6"><form onSubmit={createTemplate} className="grid gap-4 lg:grid-cols-[1fr_240px_auto]"><input className="field" placeholder="Nombre de la evaluación" value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /><select className="field" value={draft.area_id} onChange={(event) => setDraft({ ...draft, area_id: event.target.value })}><option value="">Selecciona división</option>{areas.map((area) => <option key={area.id} value={area.id}>{area.name}</option>)}</select><button disabled={saving} className="rounded-xl bg-white px-5 py-3 font-medium text-black">Crear borrador</button></form></Card>}

      <div className="grid gap-6 xl:grid-cols-[320px_1fr]">
        <Card hover={false} contentClassName="p-4"><div className="mb-3 flex items-center gap-2 px-2 font-medium text-zinc-300"><ClipboardList size={18} /> Evaluaciones</div><div className="space-y-2">{loading && <p className="p-3 text-sm text-zinc-500">Cargando...</p>}{templates.map((template) => <button key={template.id} onClick={() => { setSelectedId(template.id); setMessage(""); }} className={`flex w-full items-center justify-between rounded-xl border p-4 text-left ${selectedId === template.id ? "border-zinc-500 bg-zinc-800" : "border-transparent bg-zinc-900/70"}`}><span><span className="block font-medium text-white">{template.name}</span><span className="mt-1 block text-xs text-zinc-500">{template.work_areas?.name} · {template.status === "published" ? "Publicada" : "Borrador"}</span></span><ChevronRight size={17} /></button>)}{!loading && !templates.length && <p className="p-3 text-sm leading-6 text-zinc-500">Crea la primera evaluación para una división.</p>}</div></Card>

        {selected && <div className="space-y-5">
          <Card hover={false} contentClassName="p-5 sm:p-6"><div className="grid gap-4 md:grid-cols-2"><Field label="Nombre"><input className="field" value={selected.name} onChange={(event) => updateSelected({ name: event.target.value })} /></Field><Field label="División evaluada"><select className="field" value={selected.area_id} onChange={(event) => updateSelected({ area_id: event.target.value })}>{areas.map((area) => <option key={area.id} value={area.id}>{area.name}</option>)}</select></Field><div className="md:col-span-2"><Field label="Objetivo de la evaluación"><textarea rows="2" className="field resize-none" value={selected.description} onChange={(event) => updateSelected({ description: event.target.value })} /></Field></div></div></Card>

          {selected.score_categories.map((category) => <Card key={category.id} hover={false} contentClassName="p-5 sm:p-6"><div className="flex flex-col gap-4 sm:flex-row sm:items-end"><div className="flex-1"><Field label="Categoría"><input className="field" value={category.name} onChange={(event) => updateCategory(category.id, { name: event.target.value })} /></Field></div><div className="sm:w-36"><Field label="Peso total %"><input type="number" min="0" max="100" className="field" value={category.weight} onChange={(event) => updateCategory(category.id, { weight: event.target.value })} /></Field></div><button onClick={() => removeCategory(category.id)} className="rounded-xl border border-zinc-700 p-3 text-zinc-400 hover:text-white"><Trash2 size={18} /></button></div><div className="mt-5 space-y-3">{category.score_questions.map((question, index) => <div key={question.id} className="grid gap-3 rounded-xl border border-zinc-800 bg-zinc-900/60 p-4 lg:grid-cols-[1fr_150px_120px_auto]"><Field label={`Pregunta ${index + 1}`}><input className="field" value={question.prompt} onChange={(event) => updateQuestion(category.id, question.id, { prompt: event.target.value })} /></Field><Field label="Respuesta"><select className="field" value={question.response_type} onChange={(event) => updateQuestion(category.id, question.id, { response_type: event.target.value })}><option value="scale">Escala 1 a 5</option><option value="yes_no">Sí o no</option></select></Field><Field label="Peso %"><input type="number" min="0" max="100" className="field" value={question.weight} onChange={(event) => updateQuestion(category.id, question.id, { weight: event.target.value })} /></Field><button onClick={() => removeQuestion(category.id, question.id)} className="self-end rounded-xl border border-zinc-700 p-3 text-zinc-400"><Trash2 size={18} /></button></div>)}<button onClick={() => addQuestion(category)} className="flex items-center gap-2 rounded-xl border border-zinc-700 px-4 py-3 text-sm text-zinc-300"><Plus size={16} /> Añadir pregunta</button></div></Card>)}

          <div className="flex flex-col gap-3 sm:flex-row sm:justify-between"><button onClick={addCategory} className="flex items-center justify-center gap-2 rounded-xl border border-zinc-700 px-5 py-3 text-zinc-200"><Plus size={17} /> Añadir categoría</button><div className="flex flex-col gap-3 sm:flex-row"><button disabled={saving} onClick={() => saveTemplate(false)} className="flex items-center justify-center gap-2 rounded-xl border border-zinc-700 px-5 py-3 text-zinc-200"><Save size={17} /> Guardar borrador</button><button disabled={saving || selected.status === "published"} onClick={() => saveTemplate(true)} className="flex items-center justify-center gap-2 rounded-xl bg-white px-5 py-3 font-medium text-black disabled:opacity-50"><Check size={17} /> {selected.status === "published" ? "Publicada" : "Publicar evaluación"}</button></div></div>
        </div>}
      </div>
    </Page>
  );
}

function Field({ label, children }) {
  return <label className="block"><span className="mb-2 block text-sm text-zinc-400">{label}</span>{children}</label>;
}

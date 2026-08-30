import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Archive, ArrowLeft, Check, ChevronRight, CircleHelp, ClipboardCopy, ClipboardList,
  BookOpen, Eye, FileText, Link2, LoaderCircle, Plus, Save, Search, Settings2,
  Sparkles, Trash2,
} from "lucide-react";

import Page from "../components/ui/Page";
import { useAuth } from "../Context/AuthContext";
import { useDivisions } from "../hooks/useDivisions";
import {
  createDiscoveryTemplate, createQuestion, createSection, deleteDiscoveryTemplate, duplicateDiscoveryTemplate,
  deleteQuestion, deleteSection, getDiscoveryBuilderData, getDiscoveryLibraryQuestions, getDiscoveryScoreQuestions, replaceScoreLink, saveDiscoveryQuestionToLibrary,
  updateDiscoveryTemplate, updateQuestion, updateSection,
} from "../features/discovery-builder/services/discoveryBuilderService";
import {
  DISCOVERY_RESPONSE_TYPES,
  getDiscoveryQuestionConfigurationError,
  getDiscoveryResponseType,
  normalizeDiscoveryResponseType,
} from "../features/discovery/responseTypes";
import "./Discovery.css";

const steps = [
  { label: "Información", icon: FileText },
  { label: "Secciones", icon: ClipboardList },
  { label: "Preguntas", icon: CircleHelp },
  { label: "Conexiones", icon: Link2 },
  { label: "Vista previa", icon: Eye },
  { label: "Publicar", icon: Sparkles },
];
const blankTemplate = { name: "", description: "", division_id: "" };

function friendlyError(error, fallback = "No se pudo completar la operación.") {
  if (error?.message === "DISCOVERY_TEMPLATE_DIVISION_LOCKED") {
    return "No puedes cambiar la división de esta plantilla porque ya tiene evaluaciones asociadas. Duplica la plantilla o crea una nueva versión para utilizar otra división.";
  }
  if (error?.code === "42501") return "No tienes permiso para realizar esta acción.";
  if (error?.code === "23503") return "Este elemento está en uso y no se puede eliminar.";
  if (error?.code === "23514") return "Uno de los valores no cumple las reglas de Discovery.";
  return fallback;
}

function countQuestions(template) {
  return (template?.discovery_sections || []).reduce((total, section) => total + section.discovery_questions.length, 0);
}

function validationFor(template) {
  const sections = template?.discovery_sections || [];
  const questions = sections.flatMap((section) => section.discovery_questions);
  const invalidQuestions = questions
    .map((question) => ({ question, error: getDiscoveryQuestionConfigurationError(question) }))
    .filter(({ error }) => error);
  return [
    { label: "Nombre definido", valid: Boolean(template?.name?.trim()) },
    { label: "Al menos una sección", valid: sections.length > 0 },
    { label: "Cada sección tiene preguntas", valid: sections.length > 0 && sections.every((section) => section.discovery_questions.length > 0) },
    { label: "Preguntas evaluativas conectadas", valid: questions.filter((q) => q.question_kind === "evaluative").every((q) => q.discovery_question_score_links.length > 0) },
    ...invalidQuestions.map(({ question, error }) => ({
      label: `${error} Pregunta: “${question.prompt}”`,
      valid: false,
    })),
  ];
}

function optionValue(option) {
  return String(typeof option === "object" ? option.value ?? option.label ?? "" : option).trim().toLocaleLowerCase("es");
}

function libraryResponseType(responseType) {
  return normalizeDiscoveryResponseType(responseType) === "yes_no" ? "boolean" : normalizeDiscoveryResponseType(responseType);
}

function normalizedQuestionText(value) {
  return String(value || "").trim().replace(/\s+/g, " ").toLocaleLowerCase("es");
}

function questionIsInPrivateLibrary(question, sectionName, libraryQuestions, organizationId, divisionId) {
  return libraryQuestions.some((libraryQuestion) => (
    libraryQuestion.score_library_categories?.organization_id === organizationId
    && (libraryQuestion.score_library_categories?.division_id || null) === (divisionId || null)
    && normalizedQuestionText(libraryQuestion.score_library_categories?.name) === normalizedQuestionText(sectionName)
    && libraryQuestion.response_type === libraryResponseType(question.response_type)
    && normalizedQuestionText(libraryQuestion.title) === normalizedQuestionText(question.prompt)
  ));
}

function scoreQuestionIsCompatible(discoveryQuestion, scoreQuestion) {
  if (normalizeDiscoveryResponseType(discoveryQuestion.response_type) !== normalizeDiscoveryResponseType(scoreQuestion.response_type)) return false;
  if (normalizeDiscoveryResponseType(discoveryQuestion.response_type) === "scale") {
    return Number.isFinite(scoreQuestion.scale_min) && Number.isFinite(scoreQuestion.scale_max)
      && scoreQuestion.scale_min < scoreQuestion.scale_max;
  }
  if (normalizeDiscoveryResponseType(discoveryQuestion.response_type) !== "multiple_choice") return true;
  const discoveryOptions = (discoveryQuestion.options || []).map(optionValue).filter(Boolean).sort();
  const scoreOptions = (scoreQuestion.options || []).map(optionValue).filter(Boolean).sort();
  return discoveryOptions.length > 0 && discoveryOptions.length === scoreOptions.length
    && discoveryOptions.every((value, index) => value === scoreOptions[index]);
}

export default function Discovery() {
  const { canManageUsers, profile, user } = useAuth();
  const { divisions } = useDivisions(profile?.organization_id);
  const [templates, setTemplates] = useState([]);
  const [scoreContext, setScoreContext] = useState({ divisionId: "", templates: [], loading: false, error: "" });
  const [libraryQuestions, setLibraryQuestions] = useState([]);
  const [libraryDivisionId, setLibraryDivisionId] = useState("");
  const [libraryLoading, setLibraryLoading] = useState(false);
  const [libraryError, setLibraryError] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [activeStep, setActiveStep] = useState(0);
  const [draft, setDraft] = useState(blankTemplate);
  const [creating, setCreating] = useState(false);
  const [loading, setLoading] = useState(true);
  const [action, setAction] = useState("");
  const [notice, setNotice] = useState(null);
  const [search, setSearch] = useState("");

  const selected = useMemo(() => templates.find((item) => item.id === selectedId), [templates, selectedId]);
  const filteredTemplates = useMemo(() => templates.filter((item) => item.name.toLowerCase().includes(search.toLowerCase())), [templates, search]);

  const loadData = useCallback(async (preferredId = "") => {
    if (!profile?.organization_id) return;
    setLoading(true);
    try {
      const data = await getDiscoveryBuilderData();
      setTemplates(data.templates);
      setSelectedId(data.templates.some((item) => item.id === preferredId) ? preferredId : data.templates[0]?.id || "");
    } catch (error) {
      setNotice({ type: "error", text: friendlyError(error, "No se pudo cargar Discovery Builder.") });
    } finally {
      setLoading(false);
    }
  }, [profile?.organization_id]);

  useEffect(() => {
    // Data loading is the external synchronization performed by this effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (profile?.organization_id) loadData();
  }, [profile?.organization_id, loadData]);

  useEffect(() => {
    let active = true;
    const divisionId = selected?.division_id || "";
    async function loadDivisionQuestions() {
      setLibraryLoading(true); setLibraryError(""); setLibraryQuestions([]);
      setLibraryDivisionId("");
      setScoreContext({ divisionId: "", templates: [], loading: true, error: "" });
      try {
        const [libraryResult, scoreTemplates] = await Promise.all([
          getDiscoveryLibraryQuestions({
            organizationId: profile?.organization_id,
            divisionId,
          }),
          getDiscoveryScoreQuestions({
            organizationId: profile?.organization_id,
            divisionId,
          }),
        ]);
        if (active) {
          setLibraryQuestions(libraryResult.questions);
          setLibraryDivisionId(divisionId);
          setScoreContext({ divisionId, templates: scoreTemplates, loading: false, error: "" });
        }
      } catch (error) {
        const message = friendlyError(error, "No se pudieron cargar las preguntas de esta división.");
        if (active) {
          setLibraryError(message);
          setScoreContext({ divisionId, templates: [], loading: false, error: message });
        }
      } finally {
        if (active) setLibraryLoading(false);
      }
    }
    loadDivisionQuestions();
    return () => { active = false; };
  }, [profile?.organization_id, selected?.division_id]);

  function notify(text, type = "success") { setNotice({ text, type }); }

  async function runAction(name, operation, successMessage) {
    setAction(name); setNotice(null);
    try {
      const result = await operation();
      if (successMessage) notify(successMessage);
      return result;
    } catch (error) {
      notify(friendlyError(error), "error");
      return null;
    } finally { setAction(""); }
  }

  function updateSelected(changes) {
    setTemplates((current) => current.map((template) => template.id === selectedId ? { ...template, ...changes } : template));
  }

  function updateLocalSection(sectionId, changes) {
    updateSelected({ discovery_sections: selected.discovery_sections.map((section) => section.id === sectionId ? { ...section, ...changes } : section) });
  }

  function updateLocalQuestion(sectionId, questionId, changes) {
    const section = selected.discovery_sections.find((item) => item.id === sectionId);
    updateLocalSection(sectionId, { discovery_questions: section.discovery_questions.map((question) => question.id === questionId ? { ...question, ...changes } : question) });
  }

  async function saveTemplateField(field, value) {
    if (!selected || selected[field] === value) return;
    const previousValue = selected[field];
    updateSelected({ [field]: value });
    const result = await runAction(`template-${field}`, () => updateDiscoveryTemplate(selected.id, { [field]: value || null }), "Cambios guardados.");
    if (result === null) updateSelected({ [field]: previousValue });
  }

  async function handleCreate(event) {
    event.preventDefault();
    if (!draft.name.trim()) return notify("Escribe un nombre para el Discovery.", "error");
    const created = await runAction("create", () => createDiscoveryTemplate({
      organization_id: profile.organization_id,
      division_id: draft.division_id || null,
      name: draft.name.trim(),
      description: draft.description.trim(),
      created_by: user.id,
    }), "Discovery creado como borrador.");
    if (!created) return;
    setDraft(blankTemplate); setCreating(false); setActiveStep(0);
    await loadData(created.id);
  }

  async function addSection() {
    const section = await runAction("add-section", () => createSection({
      template_id: selected.id,
      title: `Sección ${selected.discovery_sections.length + 1}`,
      description: "",
      position: selected.discovery_sections.length,
    }), "Sección añadida.");
    if (section) updateSelected({ discovery_sections: [...selected.discovery_sections, section] });
  }

  async function removeSection(section) {
    if (!window.confirm(`¿Eliminar “${section.title}” y todas sus preguntas?`)) return;
    const result = await runAction("delete-section", () => deleteSection(section.id), "Sección eliminada.");
    if (result !== null) updateSelected({ discovery_sections: selected.discovery_sections.filter((item) => item.id !== section.id) });
  }

  async function addNewQuestion(section) {
    const question = await runAction("add-question", () => createQuestion({
      section_id: section.id, prompt: "Nueva pregunta", help_text: "", response_type: "text",
      options: [], required: false, position: section.discovery_questions.length, question_kind: "informative",
    }), "Pregunta añadida.");
    if (question) updateLocalSection(section.id, { discovery_questions: [...section.discovery_questions, question] });
  }

  async function saveSectionField(section, field, value) {
    if (section[field] === value) return;
    updateLocalSection(section.id, { [field]: value });
    await runAction(`section-${section.id}`, () => updateSection(section.id, { [field]: value }), "Cambios guardados.");
  }

  async function saveQuestionField(section, question, field, value) {
    if (question[field] === value) return;
    updateLocalQuestion(section.id, question.id, { [field]: value });
    await runAction(`question-${question.id}`, () => updateQuestion(question.id, { [field]: value }), "Cambios guardados.");
  }

  async function removeQuestion(section, question) {
    if (!window.confirm("¿Eliminar esta pregunta?")) return;
    const result = await runAction("delete-question", () => deleteQuestion(question.id), "Pregunta eliminada.");
    if (result !== null) updateLocalSection(section.id, { discovery_questions: section.discovery_questions.filter((item) => item.id !== question.id) });
  }

  async function saveQuestionToLibrary(section, question) {
    const configurationError = getDiscoveryQuestionConfigurationError(question);
    if (configurationError) return notify(configurationError, "error");
    if (question.prompt.trim().length < 5) return notify("La pregunta debe tener al menos 5 caracteres.", "error");
    const result = await runAction(`library-${question.id}`, () => saveDiscoveryQuestionToLibrary({
      question, organizationId: profile.organization_id,
      divisionId: selected.division_id || null, categoryName: section.title, createdBy: user.id,
    }));
    if (!result) return;
    setLibraryQuestions((current) => current.some(({ id }) => id === result.question.id) ? current : [...current, result.question]);
    if (result.status === "duplicate") return notify("Esta pregunta ya existe en la biblioteca.");
    notify("Pregunta guardada en biblioteca.");
  }

  async function saveAllQuestionsToLibrary() {
    const questions = selected.discovery_sections.flatMap((section) => section.discovery_questions.map((question) => ({ section, question })));
    let created = 0;
    let duplicates = 0;
    setAction("library-all"); setNotice(null);
    try {
      for (const { section, question } of questions) {
        const configurationError = getDiscoveryQuestionConfigurationError(question);
        if (configurationError || question.prompt.trim().length < 5) {
          throw new Error(configurationError || "Hay una pregunta con menos de 5 caracteres.");
        }
        const result = await saveDiscoveryQuestionToLibrary({
          question, organizationId: profile.organization_id,
          divisionId: selected.division_id || null, categoryName: section.title, createdBy: user.id,
        });
        if (result.status === "created") {
          created += 1;
        } else duplicates += 1;
        setLibraryQuestions((current) => current.some(({ id }) => id === result.question.id) ? current : [...current, result.question]);
      }
      notify(`${created} preguntas guardadas · ${duplicates} ya existían`);
    } catch (error) {
      notify(friendlyError(error, error.message), "error");
    } finally { setAction(""); }
  }

  async function addLibraryQuestion(section, libraryQuestion) {
    const question = await runAction(`add-library-${libraryQuestion.id}`, () => createQuestion({
      section_id: section.id, prompt: libraryQuestion.title,
      help_text: libraryQuestion.description || "",
      response_type: normalizeDiscoveryResponseType(libraryQuestion.response_type),
      options: libraryQuestion.options || [], required: false,
      position: section.discovery_questions.length, question_kind: "informative",
    }), "Pregunta de biblioteca añadida.");
    if (question) updateLocalSection(section.id, { discovery_questions: [...section.discovery_questions, question] });
  }

  async function connectQuestion(section, question, scoreQuestionId) {
    const link = await runAction(`link-${question.id}`, () => replaceScoreLink(question.id, scoreQuestionId), scoreQuestionId ? "Conexión guardada." : "Conexión eliminada.");
    if (link !== null) updateLocalQuestion(section.id, question.id, { discovery_question_score_links: link ? [link] : [] });
  }

  async function publish() {
    const checks = validationFor(selected);
    const failed = checks.find((item) => !item.valid);
    if (failed) return notify(failed.label, "error");
    const publishedAt = new Date().toISOString();
    const result = await runAction("publish", () => updateDiscoveryTemplate(selected.id, { status: "published", published_at: publishedAt }), "Discovery publicado.");
    if (result !== null) updateSelected({ status: "published", published_at: publishedAt });
  }

  async function duplicateTemplate() {
    const suggestedName = `${selected.name} — Copia`;
    const name = window.prompt("Nombre de la copia", suggestedName)?.trim();
    if (!name) return;
    const copy = await runAction("duplicate", () => duplicateDiscoveryTemplate(selected, name, user.id), "Discovery duplicado como borrador.");
    if (copy) await loadData(copy.id);
  }

  async function archiveTemplate() {
    const status = selected.status === "archived" ? "draft" : "archived";
    const changes = status === "draft" ? { status, published_at: null } : { status };
    const result = await runAction("archive", () => updateDiscoveryTemplate(selected.id, changes), status === "archived" ? "Discovery archivado." : "Discovery restaurado como borrador.");
    if (result !== null) updateSelected(changes);
  }

  async function removeTemplate() {
    if (!window.confirm(`¿Eliminar definitivamente “${selected.name}”?`)) return;
    const result = await runAction("delete-template", () => deleteDiscoveryTemplate(selected.id), "Discovery eliminado.");
    if (result !== null) await loadData();
  }

  if (!canManageUsers) return <Page><AccessDenied /></Page>;

  return (
    <Page className="discovery-page">
      <header className="db-page-header">
        <div>
          <span className="db-eyebrow"><Sparkles size={14} /> Discovery Builder V1</span>
          <h1>Diseña conversaciones que revelan lo importante.</h1>
          <p>Crea diagnósticos estructurados y conecta las respuestas evaluativas con tu sistema Score.</p>
        </div>
        <button className="db-button db-button-primary" onClick={() => setCreating(true)}><Plus size={17} /> Nuevo Discovery</button>
      </header>

      {notice && <div className={`db-notice ${notice.type}`}><span>{notice.text}</span><button onClick={() => setNotice(null)}>×</button></div>}

      {loading ? <Loading /> : (
        <div className="db-shell">
          <aside className="db-sidebar">
            <div className="db-search"><Search size={16} /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar Discovery" /></div>
            <div className="db-template-list">
              {filteredTemplates.map((template) => (
                <button key={template.id} className={`db-template-item ${template.id === selectedId ? "active" : ""}`} onClick={() => { setSelectedId(template.id); setActiveStep(0); }}>
                  <span className="db-template-icon"><ClipboardList size={17} /></span>
                  <span><strong>{template.name}</strong><small>{template.discovery_sections.length} secciones · {countQuestions(template)} preguntas</small></span>
                  <i className={`db-status ${template.status}`}>{template.status === "published" ? "Publicado" : template.status === "archived" ? "Archivado" : "Borrador"}</i>
                </button>
              ))}
              {!filteredTemplates.length && <div className="db-empty-mini">No hay Discoveries todavía.</div>}
            </div>
          </aside>

          <section className="db-workspace">
            {selected ? <>
              <div className="db-builder-head">
                <div><small>EDITANDO</small><h2>{selected.name}</h2></div>
                <div className="db-head-actions">
                  <button className="db-icon-button" title="Duplicar" disabled={action === "duplicate"} onClick={duplicateTemplate}><ClipboardCopy size={17} /></button>
                  <button className="db-icon-button" title="Archivar" onClick={archiveTemplate}><Archive size={17} /></button>
                  <button className="db-icon-button danger" title="Eliminar" onClick={removeTemplate}><Trash2 size={17} /></button>
                  <span className="db-save-state">{action ? <><LoaderCircle className="spin" size={14} /> Guardando</> : <><Check size={14} /> Guardado</>}</span>
                </div>
              </div>
              <nav className="db-steps">
                {steps.map((step, index) => { const Icon = step.icon; return <button key={step.label} className={index === activeStep ? "active" : ""} onClick={() => setActiveStep(index)}><span><Icon size={16} /></span>{step.label}</button>; })}
              </nav>
              <div className="db-stage" key={`${selected.id}-${activeStep}`}>
                {activeStep === 0 && <Information template={selected} divisions={divisions} saveField={saveTemplateField} />}
                {activeStep === 1 && <Sections template={selected} addSection={addSection} saveField={saveSectionField} removeSection={removeSection} />}
                {activeStep === 2 && <Questions template={selected} libraryQuestions={libraryDivisionId === selected.division_id ? libraryQuestions : []} libraryLoading={libraryLoading} libraryError={libraryError} organizationId={profile.organization_id} action={action} addQuestion={addNewQuestion} addLibraryQuestion={addLibraryQuestion} saveToLibrary={saveQuestionToLibrary} saveAll={saveAllQuestionsToLibrary} saveField={saveQuestionField} removeQuestion={removeQuestion} />}
                {activeStep === 3 && <Connections template={selected} scoreTemplates={scoreContext.divisionId === selected.division_id ? scoreContext.templates : []} loading={scoreContext.loading} error={scoreContext.error} connect={connectQuestion} />}
                {activeStep === 4 && <Preview template={selected} />}
                {activeStep === 5 && <Publish template={selected} publish={publish} action={action} />}
              </div>
              <footer className="db-footer-nav">
                <button className="db-button" disabled={activeStep === 0} onClick={() => setActiveStep((step) => step - 1)}><ArrowLeft size={16} /> Anterior</button>
                {activeStep < steps.length - 1 && <button className="db-button db-button-primary" onClick={() => setActiveStep((step) => step + 1)}>Continuar <ChevronRight size={16} /></button>}
              </footer>
            </> : <EmptyBuilder onCreate={() => setCreating(true)} />}
          </section>
        </div>
      )}

      {creating && <CreateModal draft={draft} setDraft={setDraft} divisions={divisions} onClose={() => setCreating(false)} onSubmit={handleCreate} busy={action === "create"} />}
    </Page>
  );
}

function Information({ template, divisions, saveField }) {
  const divisionLocked = Boolean(template.has_assessments);
  return <div className="db-content-narrow"><StageTitle number="01" title="Información general" text="Define la identidad y el contexto de este Discovery." />
    <div className="db-card db-form-grid">
      <label className="wide">Nombre del Discovery<input defaultValue={template.name} onBlur={(e) => saveField("name", e.target.value.trim())} placeholder="Ej. Discovery de crecimiento" /></label>
      <label>División<select value={template.division_id || ""} disabled={divisionLocked} onChange={(e) => saveField("division_id", e.target.value)}><option value="">Todas las divisiones</option>{divisions.map((division) => <option key={division.id} value={division.id}>{division.name}</option>)}</select>{divisionLocked && <small>Esta plantilla ya tiene evaluaciones asociadas. Duplica la plantilla o crea una nueva versión para utilizar otra división.</small>}</label>
      <label>Versión<input value={`v${template.version}`} disabled /></label>
      <label className="wide">Descripción<textarea defaultValue={template.description || ""} onBlur={(e) => saveField("description", e.target.value.trim())} rows={5} placeholder="Explica cuándo y para qué debe utilizarse..." /></label>
    </div>
  </div>;
}

function Sections({ template, addSection, saveField, removeSection }) {
  return <div><StageTitle number="02" title="Estructura la conversación" text="Agrupa las preguntas en bloques claros para guiar el diagnóstico." action={<button className="db-button db-button-primary" onClick={addSection}><Plus size={16} /> Añadir sección</button>} />
    <div className="db-stack">{template.discovery_sections.map((section, index) => <article className="db-card db-section-row" key={section.id}><span className="db-order">{String(index + 1).padStart(2, "0")}</span><div><input className="db-title-input" defaultValue={section.title} onBlur={(e) => saveField(section, "title", e.target.value.trim())} /><textarea defaultValue={section.description || ""} onBlur={(e) => saveField(section, "description", e.target.value.trim())} rows={2} placeholder="Objetivo de esta sección" /><small>{section.discovery_questions.length} preguntas</small></div><button className="db-icon-button danger" onClick={() => removeSection(section)}><Trash2 size={16} /></button></article>)}
      {!template.discovery_sections.length && <EmptyInline title="Aún no hay secciones" text="Crea el primer bloque de tu conversación Discovery." onClick={addSection} />}</div>
  </div>;
}

function Questions({ template, libraryQuestions, libraryLoading, libraryError, organizationId, action, addQuestion, addLibraryQuestion, saveToLibrary, saveAll, saveField, removeQuestion }) {
  const [librarySection, setLibrarySection] = useState(null);
  return <div><StageTitle number="03" title="Diseña las preguntas" text="Combina preguntas informativas y evaluativas en cada sección." action={template.discovery_sections.some((section) => section.discovery_questions.length) && <button className="db-button" disabled={action === "library-all"} onClick={saveAll}><BookOpen size={15} /> Guardar preguntas en biblioteca</button>} />
    <div className="db-stack">{template.discovery_sections.map((section) => <section className="db-question-group" key={section.id}><div className="db-group-head"><div><small>SECCIÓN</small><h3>{section.title}</h3></div><div className="db-group-actions"><button className="db-button" onClick={() => setLibrarySection(section)}><BookOpen size={15} /> Biblioteca</button><button className="db-button" onClick={() => addQuestion(section)}><Plus size={15} /> Pregunta</button></div></div>
      {section.discovery_questions.map((question, index) => <QuestionEditor key={question.id} section={section} question={question} index={index} saved={questionIsInPrivateLibrary(question, section.title, libraryQuestions, organizationId, template.division_id)} busy={action === `library-${question.id}`} saveToLibrary={saveToLibrary} saveField={saveField} removeQuestion={removeQuestion} />)}
      {!section.discovery_questions.length && <p className="db-muted-row">Esta sección aún no tiene preguntas.</p>}
    </section>)}
    {!template.discovery_sections.length && <div className="db-empty-mini">Crea una sección antes de añadir preguntas.</div>}</div>
    {librarySection && <LibraryModal template={template} questions={libraryQuestions} loading={libraryLoading} error={libraryError} onAdd={(question) => addLibraryQuestion(librarySection, question)} onClose={() => setLibrarySection(null)} />}
  </div>;
}

function QuestionEditor({ section, question, index, saved, busy, saveToLibrary, saveField, removeQuestion }) {
  const optionText = question.options.map((option) => typeof option === "string" ? option : option.label || option.value).join("\n");
  return <article className="db-card db-question-card"><div className="db-question-number">{index + 1}</div><div className="db-question-fields">
    <label>Pregunta<textarea defaultValue={question.prompt} onBlur={(e) => saveField(section, question, "prompt", e.target.value.trim())} rows={2} /></label>
    <div className="db-form-grid compact"><label>Tipo de respuesta<select value={normalizeDiscoveryResponseType(question.response_type)} onChange={(e) => saveField(section, question, "response_type", e.target.value)}>{DISCOVERY_RESPONSE_TYPES.map(({ value, label }) => <option key={value} value={value}>{label}</option>)}</select></label><label>Propósito<select value={question.question_kind} onChange={(e) => saveField(section, question, "question_kind", e.target.value)}><option value="informative">Informativa</option><option value="evaluative">Evaluativa</option></select></label></div>
    <label>Texto de ayuda<input defaultValue={question.help_text || ""} onBlur={(e) => saveField(section, question, "help_text", e.target.value.trim())} placeholder="Contexto opcional para quien responde" /></label>
    {getDiscoveryResponseType(question.response_type)?.requiresOptions && <label>Opciones (una por línea)<textarea defaultValue={optionText} onBlur={(e) => saveField(section, question, "options", e.target.value.split("\n").map((value) => value.trim()).filter(Boolean))} rows={3} /></label>}
    <div className="db-question-footer"><label className="db-check"><input type="checkbox" checked={question.required} onChange={(e) => saveField(section, question, "required", e.target.checked)} /> Respuesta obligatoria</label><button className="db-library-save" disabled={saved || busy} onClick={() => saveToLibrary(section, question)}>{saved ? <><Check size={14} /> Guardada en biblioteca</> : busy ? <><LoaderCircle className="spin" size={14} /> Guardando</> : <><BookOpen size={14} /> Guardar en biblioteca</>}</button></div>
  </div><button className="db-icon-button danger" onClick={() => removeQuestion(section, question)}><Trash2 size={16} /></button></article>;
}

function LibraryModal({ template, questions, loading, error, onAdd, onClose }) {
  const [search, setSearch] = useState("");
  const normalizedSearch = search.trim().toLocaleLowerCase("es");
  const visible = questions.filter((question) => `${question.title} ${question.description}`.toLocaleLowerCase("es").includes(normalizedSearch));
  const selectedKeys = new Set(template.discovery_sections.flatMap((section) => section.discovery_questions.map((question) => `${normalizedQuestionText(question.prompt)}::${normalizeDiscoveryResponseType(question.response_type)}`)));
  const grouped = visible.reduce((result, question) => {
    const category = question.score_library_categories;
    const group = result.find((item) => item.id === category.id);
    if (group) group.questions.push(question);
    else result.push({ ...category, questions: [question] });
    return result;
  }, []);
  const divisionName = template.divisions?.name || "División seleccionada";
  return <div className="db-modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><div className="db-modal db-library-modal" role="dialog" aria-modal="true" aria-label={`Biblioteca de preguntas de ${divisionName}`}><div className="db-modal-head"><div><span className="db-eyebrow">Biblioteca · {divisionName}</span><h2>Añadir pregunta</h2></div><button onClick={onClose} aria-label="Cerrar biblioteca">×</button></div><div className="db-search db-library-search"><Search size={16} /><input autoFocus value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar en todas las preguntas" /></div><div className="db-library-list">{loading && <p className="db-empty-mini"><LoaderCircle className="spin" size={18} /> Cargando preguntas...</p>}{error && <p className="db-empty-mini db-library-error">{error}</p>}{!loading && !error && grouped.map((category, index) => <details className="db-library-category" key={`${category.id}-${normalizedSearch ? "search" : "browse"}`} open={Boolean(normalizedSearch) || index === 0}><summary><div><span>{category.is_official ? "Biblioteca oficial" : divisionName}</span><h3>{category.name}</h3></div><b>{category.questions.length} preguntas</b></summary>{category.questions.map((question) => { const selected = selectedKeys.has(`${normalizedQuestionText(question.title)}::${normalizeDiscoveryResponseType(question.response_type)}`); return <article key={question.id}><div><strong>{question.title}</strong><small>{getDiscoveryResponseType(question.response_type)?.label || question.response_type}</small></div><button className="db-button" disabled={selected} onClick={() => onAdd(question)}>{selected ? "Añadida" : "Añadir"}</button></article>; })}</details>)}{!loading && !error && !grouped.length && <p className="db-empty-mini">{normalizedSearch ? "No encontramos preguntas que coincidan con tu búsqueda." : "No hay preguntas disponibles para esta división."}</p>}</div></div></div>;
}

function Connections({ template, scoreTemplates, loading, error, connect }) {
  const [connecting, setConnecting] = useState(null);
  const questions = template.discovery_sections.flatMap((section) => section.discovery_questions.map((question) => ({ section, question }))).filter(({ question }) => question.question_kind === "evaluative");
  return <div><StageTitle number="04" title="Conecta con Score" text="Cada pregunta evaluativa puede alimentar una pregunta del Score sin modificar su motor." />
    <div className="db-connection-note"><Link2 size={18} /><p><strong>Score sigue siendo la fuente canónica.</strong><br />Discovery solo declara la relación; no cambia pesos, escalas ni cálculos.</p></div>
    <div className="db-stack">{questions.map(({ section, question }) => {
      const linkedId = question.discovery_question_score_links[0]?.score_question_id || "";
      const linked = scoreTemplates.flatMap((score) => score.score_categories).flatMap((category) => category.score_questions.map((scoreQuestion) => ({ ...scoreQuestion, categoryName: category.name }))).find((scoreQuestion) => scoreQuestion.id === linkedId);
      return <article className="db-card db-link-row" key={question.id}><div><small>{section.title}</small><h3>{question.prompt}</h3></div><ChevronRight size={18} /><div className="db-connection-picker"><small>PREGUNTA SCORE</small><button className="db-button" disabled={loading} onClick={() => setConnecting({ section, question })}>{loading ? "Cargando preguntas..." : linked ? `${linked.categoryName} · ${linked.prompt}` : linkedId ? "Conexión existente fuera de esta división" : "Seleccionar pregunta"}</button>{linkedId && <button className="db-library-save" onClick={() => connect(section, question, "")}>Quitar conexión</button>}{error && <small className="db-library-error">{error}</small>}</div></article>;
    })}
      {!questions.length && <EmptyInline title="No hay preguntas evaluativas" text="Marca al menos una pregunta como evaluativa para conectarla con Score." />}</div>
    {connecting && <ScoreConnectionModal template={template} scoreTemplates={scoreTemplates} discoveryQuestion={connecting.question} onSelect={(scoreQuestionId) => { connect(connecting.section, connecting.question, scoreQuestionId); setConnecting(null); }} onClose={() => setConnecting(null)} />}
  </div>;
}

function ScoreConnectionModal({ template, scoreTemplates, discoveryQuestion, onSelect, onClose }) {
  const [search, setSearch] = useState("");
  const normalizedSearch = search.trim().toLocaleLowerCase("es");
  const linkedId = discoveryQuestion.discovery_question_score_links[0]?.score_question_id || "";
  const categories = scoreTemplates.flatMap((score) => score.score_categories).map((category) => ({
    ...category,
    score_questions: category.score_questions.filter((question) => question.prompt.toLocaleLowerCase("es").includes(normalizedSearch)),
  })).filter((category) => category.score_questions.length);
  const total = scoreTemplates.reduce((sum, score) => sum + score.score_categories.reduce((categorySum, category) => categorySum + category.score_questions.length, 0), 0);
  const divisionName = template.divisions?.name || "División seleccionada";
  return <div className="db-modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><div className="db-modal db-library-modal" role="dialog" aria-modal="true" aria-label={`Preguntas Score de ${divisionName}`}><div className="db-modal-head"><div><span className="db-eyebrow">Score · {divisionName}</span><h2>Conectar pregunta</h2></div><button onClick={onClose} aria-label="Cerrar selector">×</button></div><p className="db-connection-context">{discoveryQuestion.prompt}</p><div className="db-search db-library-search"><Search size={16} /><input autoFocus value={search} onChange={(event) => setSearch(event.target.value)} placeholder={`Buscar entre ${total} preguntas`} /></div><div className="db-library-list">{categories.map((category, index) => <details className="db-library-category" key={`${category.id}-${normalizedSearch ? "search" : "browse"}`} open={Boolean(normalizedSearch) || index === 0}><summary><div><span>{divisionName}</span><h3>{category.name}</h3></div><b>{category.score_questions.length} preguntas</b></summary>{category.score_questions.map((question) => { const compatible = scoreQuestionIsCompatible(discoveryQuestion, question); const linked = question.id === linkedId; return <article key={question.id}><div><strong>{question.prompt}</strong><small>{getDiscoveryResponseType(question.response_type)?.label || question.response_type}{!compatible && " · Tipo incompatible"}</small></div><button className="db-button" disabled={!compatible || linked} onClick={() => onSelect(question.id)}>{linked ? "Conectada" : compatible ? "Conectar" : "No compatible"}</button></article>; })}</details>)}{!categories.length && <p className="db-empty-mini">{normalizedSearch ? "No encontramos preguntas que coincidan con tu búsqueda." : "No hay preguntas Score disponibles para esta división."}</p>}</div></div></div>;
}

function Preview({ template }) {
  return <div className="db-content-narrow"><StageTitle number="05" title="Vista previa" text="Así verá el equipo la estructura del Discovery." />
    <div className="db-preview"><div className="db-preview-cover"><span>DISCOVERY</span><h2>{template.name}</h2><p>{template.description || "Sin descripción"}</p><div><b>{template.discovery_sections.length}</b> secciones <b>{countQuestions(template)}</b> preguntas</div></div>
      {template.discovery_sections.map((section, sectionIndex) => <section key={section.id}><div className="db-preview-section"><span>{String(sectionIndex + 1).padStart(2, "0")}</span><div><h3>{section.title}</h3><p>{section.description}</p></div></div>{section.discovery_questions.map((question, index) => <div className="db-preview-question" key={question.id}><b>{index + 1}.</b><div><p>{question.prompt}{question.required && <em>*</em>}</p><small>{getDiscoveryResponseType(question.response_type)?.label || "Tipo no compatible"} · {question.question_kind === "evaluative" ? "Evaluativa" : "Informativa"}</small></div></div>)}</section>)}
    </div>
  </div>;
}

function Publish({ template, publish, action }) {
  const checks = validationFor(template); const ready = checks.every((item) => item.valid);
  return <div className="db-content-narrow"><StageTitle number="06" title="Publica tu Discovery" text="Revisa la configuración y déjalo listo para utilizar." />
    <div className="db-card db-publish-card"><div className={`db-publish-orb ${ready ? "ready" : ""}`}>{ready ? <Check size={30} /> : <Settings2 size={30} />}</div><h2>{ready ? "Todo listo para publicar" : "Faltan algunos ajustes"}</h2><p>Una plantilla publicada queda disponible para iniciar nuevos diagnósticos.</p><div className="db-checklist">{checks.map((check) => <div key={check.label} className={check.valid ? "valid" : ""}><span>{check.valid ? <Check size={14} /> : "·"}</span>{check.label}</div>)}</div>
      {template.status === "published" ? <div className="db-published"><Check size={17} /> Publicado {template.published_at ? new Date(template.published_at).toLocaleDateString("es") : ""}</div> : <button className="db-button db-button-primary db-publish-button" disabled={!ready || action === "publish"} onClick={publish}>{action === "publish" ? <LoaderCircle className="spin" size={17} /> : <Sparkles size={17} />} Publicar Discovery</button>}
    </div>
  </div>;
}

function StageTitle({ number, title, text, action }) { return <div className="db-stage-title"><div><span>{number}</span><div><h2>{title}</h2><p>{text}</p></div></div>{action}</div>; }
function Loading() { return <div className="db-loading"><LoaderCircle className="spin" size={24} /> Cargando Discovery Builder...</div>; }
function AccessDenied() { return <div className="db-empty"><Settings2 size={28} /><h2>Acceso de administración requerido</h2><p>Solo los administradores pueden configurar plantillas Discovery.</p></div>; }
function EmptyBuilder({ onCreate }) { return <div className="db-empty"><ClipboardList size={30} /><h2>Crea tu primer Discovery</h2><p>Diseña el flujo de preguntas que utilizará tu equipo para comprender cada negocio.</p><button className="db-button db-button-primary" onClick={onCreate}><Plus size={16} /> Nuevo Discovery</button></div>; }
function EmptyInline({ title, text, onClick }) { return <div className="db-empty-inline"><ClipboardList size={23} /><h3>{title}</h3><p>{text}</p>{onClick && <button className="db-button" onClick={onClick}><Plus size={15} /> Crear ahora</button>}</div>; }

function CreateModal({ draft, setDraft, divisions, onClose, onSubmit, busy }) {
  return <div className="db-modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}><form className="db-modal" onSubmit={onSubmit}><div className="db-modal-head"><div><span className="db-eyebrow">NUEVO</span><h2>Crear Discovery</h2></div><button type="button" onClick={onClose}>×</button></div><p>Empieza con la información básica. Podrás construir las secciones y preguntas a continuación.</p><label>Nombre<input autoFocus value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="Ej. Discovery de marca" /></label><label>División<select value={draft.division_id} onChange={(e) => setDraft({ ...draft, division_id: e.target.value })}><option value="">Todas las divisiones</option>{divisions.map((division) => <option key={division.id} value={division.id}>{division.name}</option>)}</select></label><label>Descripción<textarea value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} rows={4} placeholder="¿Qué busca descubrir esta plantilla?" /></label><div className="db-modal-actions"><button type="button" className="db-button" onClick={onClose}>Cancelar</button><button className="db-button db-button-primary" disabled={busy}>{busy ? <LoaderCircle className="spin" size={16} /> : <Save size={16} />} Crear borrador</button></div></form></div>;
}

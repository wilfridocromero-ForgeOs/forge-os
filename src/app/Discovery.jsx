import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Archive, ArrowLeft, Check, ChevronRight, CircleHelp, ClipboardCopy, ClipboardList,
  Eye, FileText, Link2, LoaderCircle, Plus, Save, Search, Settings2,
  Sparkles, Trash2,
} from "lucide-react";

import Page from "../components/ui/Page";
import { useAuth } from "../Context/AuthContext";
import { useDivisions } from "../hooks/useDivisions";
import {
  createDiscoveryTemplate, createQuestion, createSection, deleteDiscoveryTemplate, duplicateDiscoveryTemplate,
  deleteQuestion, deleteSection, getDiscoveryBuilderData, replaceScoreLink,
  updateDiscoveryTemplate, updateQuestion, updateSection,
} from "../features/discovery-builder/services/discoveryBuilderService";
import "./Discovery.css";

const steps = [
  { label: "Información", icon: FileText },
  { label: "Secciones", icon: ClipboardList },
  { label: "Preguntas", icon: CircleHelp },
  { label: "Conexiones", icon: Link2 },
  { label: "Vista previa", icon: Eye },
  { label: "Publicar", icon: Sparkles },
];
const responseTypes = [
  ["text", "Texto libre"], ["yes_no", "Sí / No"], ["scale", "Escala"],
  ["number", "Número"], ["percentage", "Porcentaje"], ["multiple_choice", "Selección múltiple"],
];
const blankTemplate = { name: "", description: "", division_id: "" };

function friendlyError(error, fallback = "No se pudo completar la operación.") {
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
  return [
    { label: "Nombre definido", valid: Boolean(template?.name?.trim()) },
    { label: "Al menos una sección", valid: sections.length > 0 },
    { label: "Cada sección tiene preguntas", valid: sections.length > 0 && sections.every((section) => section.discovery_questions.length > 0) },
    { label: "Preguntas evaluativas conectadas", valid: questions.filter((q) => q.question_kind === "evaluative").every((q) => q.discovery_question_score_links.length > 0) },
  ];
}

function optionValue(option) {
  return String(typeof option === "object" ? option.value ?? option.label ?? "" : option).trim().toLocaleLowerCase("es");
}

function scoreQuestionIsCompatible(discoveryQuestion, scoreQuestion) {
  const normalizeType = (type) => type === "boolean" ? "yes_no" : type;
  if (normalizeType(discoveryQuestion.response_type) !== normalizeType(scoreQuestion.response_type)) return false;
  if (normalizeType(discoveryQuestion.response_type) === "scale") {
    return Number.isFinite(scoreQuestion.scale_min) && Number.isFinite(scoreQuestion.scale_max)
      && scoreQuestion.scale_min < scoreQuestion.scale_max;
  }
  if (normalizeType(discoveryQuestion.response_type) !== "multiple_choice") return true;
  const discoveryOptions = (discoveryQuestion.options || []).map(optionValue).filter(Boolean).sort();
  const scoreOptions = (scoreQuestion.options || []).map(optionValue).filter(Boolean).sort();
  return discoveryOptions.length > 0 && discoveryOptions.length === scoreOptions.length
    && discoveryOptions.every((value, index) => value === scoreOptions[index]);
}

export default function Discovery() {
  const { canManageUsers, profile, user } = useAuth();
  const { divisions } = useDivisions(profile?.organization_id);
  const [templates, setTemplates] = useState([]);
  const [scoreTemplates, setScoreTemplates] = useState([]);
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
      setScoreTemplates(data.scoreTemplates);
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
    updateSelected({ [field]: value });
    await runAction(`template-${field}`, () => updateDiscoveryTemplate(selected.id, { [field]: value || null }), "Cambios guardados.");
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

  async function connectQuestion(section, question, scoreQuestionId) {
    const link = await runAction(`link-${question.id}`, () => replaceScoreLink(question.id, scoreQuestionId), scoreQuestionId ? "Conexión guardada." : "Conexión eliminada.");
    if (link !== null) updateLocalQuestion(section.id, question.id, { discovery_question_score_links: link ? [link] : [] });
  }

  async function publish() {
    const checks = validationFor(selected);
    if (checks.some((item) => !item.valid)) return notify("Completa las validaciones antes de publicar.", "error");
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
                {activeStep === 2 && <Questions template={selected} addQuestion={addNewQuestion} saveField={saveQuestionField} removeQuestion={removeQuestion} />}
                {activeStep === 3 && <Connections template={selected} scoreTemplates={scoreTemplates} connect={connectQuestion} />}
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
  return <div className="db-content-narrow"><StageTitle number="01" title="Información general" text="Define la identidad y el contexto de este Discovery." />
    <div className="db-card db-form-grid">
      <label className="wide">Nombre del Discovery<input defaultValue={template.name} onBlur={(e) => saveField("name", e.target.value.trim())} placeholder="Ej. Discovery de crecimiento" /></label>
      <label>División<select value={template.division_id || ""} onChange={(e) => saveField("division_id", e.target.value)}><option value="">Todas las divisiones</option>{divisions.map((division) => <option key={division.id} value={division.id}>{division.name}</option>)}</select></label>
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

function Questions({ template, addQuestion, saveField, removeQuestion }) {
  return <div><StageTitle number="03" title="Diseña las preguntas" text="Combina preguntas informativas y evaluativas en cada sección." />
    <div className="db-stack">{template.discovery_sections.map((section) => <section className="db-question-group" key={section.id}><div className="db-group-head"><div><small>SECCIÓN</small><h3>{section.title}</h3></div><button className="db-button" onClick={() => addQuestion(section)}><Plus size={15} /> Pregunta</button></div>
      {section.discovery_questions.map((question, index) => <QuestionEditor key={question.id} section={section} question={question} index={index} saveField={saveField} removeQuestion={removeQuestion} />)}
      {!section.discovery_questions.length && <p className="db-muted-row">Esta sección aún no tiene preguntas.</p>}
    </section>)}
    {!template.discovery_sections.length && <div className="db-empty-mini">Crea una sección antes de añadir preguntas.</div>}</div>
  </div>;
}

function QuestionEditor({ section, question, index, saveField, removeQuestion }) {
  const optionText = question.options.map((option) => typeof option === "string" ? option : option.label || option.value).join("\n");
  return <article className="db-card db-question-card"><div className="db-question-number">{index + 1}</div><div className="db-question-fields">
    <label>Pregunta<textarea defaultValue={question.prompt} onBlur={(e) => saveField(section, question, "prompt", e.target.value.trim())} rows={2} /></label>
    <div className="db-form-grid compact"><label>Tipo de respuesta<select value={question.response_type} onChange={(e) => saveField(section, question, "response_type", e.target.value)}>{responseTypes.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label>Propósito<select value={question.question_kind} onChange={(e) => saveField(section, question, "question_kind", e.target.value)}><option value="informative">Informativa</option><option value="evaluative">Evaluativa</option></select></label></div>
    <label>Texto de ayuda<input defaultValue={question.help_text || ""} onBlur={(e) => saveField(section, question, "help_text", e.target.value.trim())} placeholder="Contexto opcional para quien responde" /></label>
    {question.response_type === "multiple_choice" && <label>Opciones (una por línea)<textarea defaultValue={optionText} onBlur={(e) => saveField(section, question, "options", e.target.value.split("\n").map((value) => value.trim()).filter(Boolean))} rows={3} /></label>}
    <label className="db-check"><input type="checkbox" checked={question.required} onChange={(e) => saveField(section, question, "required", e.target.checked)} /> Respuesta obligatoria</label>
  </div><button className="db-icon-button danger" onClick={() => removeQuestion(section, question)}><Trash2 size={16} /></button></article>;
}

function Connections({ template, scoreTemplates, connect }) {
  const questions = template.discovery_sections.flatMap((section) => section.discovery_questions.map((question) => ({ section, question }))).filter(({ question }) => question.question_kind === "evaluative");
  return <div><StageTitle number="04" title="Conecta con Score" text="Cada pregunta evaluativa puede alimentar una pregunta del Score sin modificar su motor." />
    <div className="db-connection-note"><Link2 size={18} /><p><strong>Score sigue siendo la fuente canónica.</strong><br />Discovery solo declara la relación; no cambia pesos, escalas ni cálculos.</p></div>
    <div className="db-stack">{questions.map(({ section, question }) => {
      const compatibleScores = scoreTemplates.map((score) => ({
        ...score,
        score_categories: score.score_categories.map((category) => ({
          ...category,
          score_questions: category.score_questions.filter((scoreQuestion) => scoreQuestionIsCompatible(question, scoreQuestion)),
        })).filter((category) => category.score_questions.length),
      })).filter((score) => score.score_categories.length);
      return <article className="db-card db-link-row" key={question.id}><div><small>{section.title}</small><h3>{question.prompt}</h3></div><ChevronRight size={18} /><label>Pregunta Score<select value={question.discovery_question_score_links[0]?.score_question_id || ""} onChange={(e) => connect(section, question, e.target.value)}><option value="">Sin conexión</option>{compatibleScores.map((score) => <optgroup key={score.id} label={score.name}>{score.score_categories.map((category) => category.score_questions.map((scoreQuestion) => <option key={scoreQuestion.id} value={scoreQuestion.id}>{category.name} · {scoreQuestion.prompt}</option>))}</optgroup>)}</select>{!compatibleScores.length && <small>No hay preguntas Score compatibles con este tipo y configuración.</small>}</label></article>;
    })}
      {!questions.length && <EmptyInline title="No hay preguntas evaluativas" text="Marca al menos una pregunta como evaluativa para conectarla con Score." />}</div>
  </div>;
}

function Preview({ template }) {
  return <div className="db-content-narrow"><StageTitle number="05" title="Vista previa" text="Así verá el equipo la estructura del Discovery." />
    <div className="db-preview"><div className="db-preview-cover"><span>DISCOVERY</span><h2>{template.name}</h2><p>{template.description || "Sin descripción"}</p><div><b>{template.discovery_sections.length}</b> secciones <b>{countQuestions(template)}</b> preguntas</div></div>
      {template.discovery_sections.map((section, sectionIndex) => <section key={section.id}><div className="db-preview-section"><span>{String(sectionIndex + 1).padStart(2, "0")}</span><div><h3>{section.title}</h3><p>{section.description}</p></div></div>{section.discovery_questions.map((question, index) => <div className="db-preview-question" key={question.id}><b>{index + 1}.</b><div><p>{question.prompt}{question.required && <em>*</em>}</p><small>{responseTypes.find(([value]) => value === question.response_type)?.[1]} · {question.question_kind === "evaluative" ? "Evaluativa" : "Informativa"}</small></div></div>)}</section>)}
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

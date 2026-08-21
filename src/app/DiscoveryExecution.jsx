import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  ArrowLeft, ArrowRight, BarChart3, BookOpen, Building2, Check, CheckCircle2,
  ChevronRight, CircleAlert, ClipboardCheck, Clock3, LoaderCircle, PencilRuler,
  Play, Plus, Sparkles, Target, TrendingUp, X,
} from "lucide-react";

import Page from "../components/ui/Page";
import { useAuth } from "../Context/AuthContext";
import {
  createAssessment, deleteDiscoveryResponse, finalizeAssessment, getAssessment,
  getExecutionDashboardData, saveDiscoveryResponse,
} from "../features/discovery-execution/services/discoveryExecutionService";
import {
  getDiscoveryQuestionConfigurationError,
  normalizeDiscoveryOptions,
  normalizeDiscoveryResponseType,
} from "../features/discovery/responseTypes";
import "./DiscoveryExecution.css";

function isAnswered(value) {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim() !== "";
  return true;
}

function allQuestions(template) {
  return (template?.discovery_sections || []).flatMap((section) => section.discovery_questions || []);
}

function questionConfigurationError(question) {
  const linkedOptions = question.discovery_question_score_links?.[0]?.score_questions?.options || [];
  const options = question.options?.length ? question.options : linkedOptions;
  return getDiscoveryQuestionConfigurationError({ ...question, options });
}

function questionIsRequiredAndIncomplete(question, answers) {
  return question.required && (
    Boolean(questionConfigurationError(question))
    || !isAnswered(answers[question.id])
  );
}

function progressFor(assessment) {
  const questions = allQuestions(assessment.discovery_templates);
  const answered = new Set((assessment.discovery_responses || [])
    .filter((response) => isAnswered(response.response_value))
    .map((response) => response.discovery_question_id));
  return questions.length ? Math.round(answered.size / questions.length * 100) : 0;
}

function formatDate(value) {
  return value ? new Intl.DateTimeFormat("es", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(value)) : "—";
}

function friendlyError(error, fallback = "No se pudo completar la operación.") {
  if (error?.code === "42501") return "No tienes permiso para realizar esta acción.";
  if (error?.code === "23514") return error.message || "La respuesta no cumple las reglas del Discovery.";
  if (error?.message?.includes("Faltan")) return error.message;
  return fallback;
}

export default function DiscoveryExecution() {
  const { profile, user, canManageUsers } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [data, setData] = useState({ templates: [], clients: [], assessments: [], divisions: [], companyModel: null });
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [startOpen, setStartOpen] = useState(false);
  const [selection, setSelection] = useState({ divisionId: "", templateId: "", clientId: "" });
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!profile?.organization_id) return;
    setLoading(true);
    try {
      setData(await getExecutionDashboardData(profile.organization_id));
      setError("");
    } catch (reason) {
      setError(friendlyError(reason, "No se pudo cargar Discovery."));
    } finally {
      setLoading(false);
    }
  }, [profile?.organization_id]);

  useEffect(() => {
    // Data loading is the external synchronization performed by this effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  useEffect(() => {
    if (!loading && searchParams.get("new") === "1") {
      const divisionId = searchParams.get("division") || "";
      openStart("", divisionId);
      setSearchParams({}, { replace: true });
    }
    // openStart is intentionally driven by URL context after data has loaded.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, searchParams, setSearchParams]);

  function openStart(templateId = "", divisionId = "") {
    const template = data.templates.find((item) => item.id === templateId);
    const resolvedDivision = divisionId || template?.division_id || "";
    const firstTemplate = template || data.templates.find((item) => !resolvedDivision || item.division_id === resolvedDivision);
    setSelection({ divisionId: resolvedDivision, templateId: firstTemplate?.id || "", clientId: "" });
    setStartOpen(true);
    setError("");
  }

  async function startDiscovery(event) {
    event.preventDefault();
    const template = data.templates.find((item) => item.id === selection.templateId);
    const client = data.clients.find((item) => String(item.id) === selection.clientId) || null;
    if (!template) return setError("Selecciona un diagnóstico publicado.");
    setStarting(true);
    try {
      const assessment = await createAssessment({
        organizationId: profile.organization_id,
        template,
        client,
        userId: user.id,
      });
      navigate(`/discovery/evaluaciones/${assessment.id}`);
    } catch (reason) {
      setError(friendlyError(reason, "No se pudo iniciar la evaluación."));
    } finally {
      setStarting(false);
    }
  }

  const inProgress = data.assessments.filter((item) => item.status !== "completed");
  const completed = data.assessments.filter((item) => item.status === "completed");

  return <Page className="dx-page">
    <header className="dx-hero">
      <div>
        <span className="dx-eyebrow"><Sparkles size={14} /> Discovery</span>
        <h1>Diagnostica tu organización y convierte evidencia en decisiones.</h1>
        <p>Inicia, continúa y consulta diagnósticos conectados con el sistema Score.</p>
      </div>
      <div className="dx-hero-actions">
        {canManageUsers && <Link className="dx-button" to="/discovery/builder"><PencilRuler size={17} /> Discovery Builder</Link>}
        <button className="dx-button dx-primary" onClick={() => openStart()} disabled={!data.templates.length}><Plus size={17} /> Nuevo diagnóstico</button>
      </div>
    </header>

    {error && <div className="dx-alert"><CircleAlert size={17} /><span>{error}</span><button onClick={() => setError("")}><X size={16} /></button></div>}

    {loading ? <Loading text="Cargando evaluaciones..." /> : <>
      <section className="dx-summary-grid">
        <SummaryCard icon={BookOpen} value={data.templates.length || "—"} label="Disponibles" />
        <SummaryCard icon={Clock3} value={inProgress.length} label="En progreso" />
        <SummaryCard icon={CheckCircle2} value={completed.length} label="Completados" />
      </section>

      <section>
        <SectionHeading title="Evaluaciones disponibles" text="Diagnósticos publicados, organizados por las áreas del modelo empresarial." />
        {data.divisions.length > 0 && <div className="dx-division-guide">
          <button className="dx-organization-option" onClick={() => openStart()}><Building2 size={20} /><span><strong>Evaluar organización</strong><small>Elige una división que necesite evidencia; el Master Score no es un cuestionario.</small></span><ArrowRight size={16} /></button>
          {data.divisions.map((division) => {
            const available = data.templates.filter((template) => template.division_id === division.id).length;
            return <button key={division.id} onClick={() => openStart("", division.id)} disabled={!available}><span><strong>{division.name}</strong><small>{division.score ? `Desempeño ${Number(division.score.performance_percentage).toFixed(2)} / 100 · Cobertura ${Number(division.score.coverage_percentage).toFixed(2)}%` : "Sin evaluar"}</small></span><span>{available ? `${available} ${available === 1 ? "diagnóstico" : "diagnósticos"}` : "Sin diagnósticos publicados"}</span></button>;
          })}
        </div>}
        <div className="dx-template-grid">
          {data.templates.map((template) => {
            const questions = allQuestions(template);
            const scored = questions.filter((question) => question.discovery_question_score_links?.length).length;
            return <article className="dx-template-card" key={template.id}>
              <div className="dx-template-mark"><ClipboardCheck size={21} /></div>
              <span className="dx-live"><i /> Publicado</span>
              <h3>{template.name}</h3>
              <p>{template.description || "Discovery estructurado para comprender el contexto del negocio."}</p>
              <div className="dx-template-meta">
                <span>{template.discovery_sections.length} secciones</span>
                <span>{questions.length} preguntas</span>
                <span>{scored ? `${scored} evaluativas` : "Informativo"}</span>
              </div>
              <button className="dx-card-action" onClick={() => openStart(template.id)}>Iniciar con un cliente <ArrowRight size={16} /></button>
            </article>;
          })}
          {!data.templates.length && <Empty title="No hay Discoveries publicados" text="Publica una plantilla desde Discovery Builder para comenzar." />}
        </div>
      </section>

      <section>
        <SectionHeading title="Evaluaciones" text="Continúa trabajos pendientes o consulta resultados anteriores." />
        <div className="dx-history">
          <div className="dx-history-head"><span>Cliente</span><span>Discovery</span><span>Estado</span><span>Progreso / Score</span><span>Fecha</span><span /></div>
          {data.assessments.map((assessment) => <HistoryRow key={assessment.id} assessment={assessment} />)}
          {!data.assessments.length && <Empty title="Todavía no hay evaluaciones" text="Inicia un Discovery para crear el primer registro del historial." compact />}
        </div>
      </section>
    </>}

    {startOpen && <StartModal
      templates={data.templates}
      divisions={data.divisions}
      clients={data.clients}
      selection={selection}
      setSelection={setSelection}
      onClose={() => setStartOpen(false)}
      onSubmit={startDiscovery}
      busy={starting}
    />}
  </Page>;
}

export function DiscoveryRunner() {
  const { assessmentId } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [assessment, setAssessment] = useState(null);
  const [answers, setAnswers] = useState({});
  const [persistedAnswers, setPersistedAnswers] = useState({});
  const [sectionIndex, setSectionIndex] = useState(0);
  const [reviewing, setReviewing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(0);
  const [saveErrors, setSaveErrors] = useState(0);
  const [error, setError] = useState("");
  const [finalizing, setFinalizing] = useState(false);
  const responsesRef = useRef({});
  const savedValuesRef = useRef({});
  const queuesRef = useRef({});
  const failedSavesRef = useRef(new Set());

  function markQuestionSaveFailed(questionId, failed) {
    const next = new Set(failedSavesRef.current);
    if (failed) next.add(questionId);
    else next.delete(questionId);
    failedSavesRef.current = next;
    setSaveErrors(next.size);
    return next.size;
  }

  const hydrate = useCallback(async () => {
    setLoading(true);
    try {
      const next = await getAssessment(assessmentId);
      if (next.status === "completed") {
        navigate(`/discovery/evaluaciones/${assessmentId}/resultado`, { replace: true });
        return;
      }
      const responseMap = Object.fromEntries(next.discovery_responses.map((item) => [item.discovery_question_id, item]));
      const valueMap = Object.fromEntries(next.discovery_responses.map((item) => [item.discovery_question_id, item.response_value]));
      responsesRef.current = responseMap;
      savedValuesRef.current = valueMap;
      setAnswers(valueMap);
      setPersistedAnswers(valueMap);
      failedSavesRef.current = new Set();
      setSaveErrors(0);
      setAssessment(next);
      const sections = next.discovery_templates.discovery_sections;
      const firstIncomplete = sections.findIndex((section) => section.discovery_questions.some((question) => questionIsRequiredAndIncomplete(question, valueMap)));
      setSectionIndex(firstIncomplete >= 0 ? firstIncomplete : 0);
      setError("");
    } catch (reason) {
      setError(friendlyError(reason, "No se pudo abrir esta evaluación."));
    } finally {
      setLoading(false);
    }
  }, [assessmentId, navigate]);

  useEffect(() => {
    // Data loading is the external synchronization performed by this effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    hydrate();
  }, [hydrate]);

  function enqueueSave(question, value) {
    setSaving((count) => count + 1);
    const previous = queuesRef.current[question.id] || Promise.resolve();
    const next = previous.catch(() => undefined).then(() => persist(question, value));
    queuesRef.current[question.id] = next;
    return next.finally(() => setSaving((count) => Math.max(0, count - 1)));
  }

  async function persist(question, value) {
    const existing = responsesRef.current[question.id];
    if (Object.is(savedValuesRef.current[question.id], value)) {
      if (markQuestionSaveFailed(question.id, false) === 0) setError("");
      return;
    }
    try {
      if (!isAnswered(value)) {
        if (existing?.id) await deleteDiscoveryResponse(existing.id);
        delete responsesRef.current[question.id];
        delete savedValuesRef.current[question.id];
        setPersistedAnswers((current) => {
          const next = { ...current };
          delete next[question.id];
          return next;
        });
      } else {
        const saved = await saveDiscoveryResponse({
          assessmentId,
          question,
          value,
          userId: user.id,
          existingResponse: existing,
        });
        responsesRef.current[question.id] = saved;
        savedValuesRef.current[question.id] = value;
        setPersistedAnswers((current) => ({ ...current, [question.id]: saved.response_value }));
      }
      if (markQuestionSaveFailed(question.id, false) === 0) setError("");
    } catch (reason) {
      markQuestionSaveFailed(question.id, true);
      setError(friendlyError(reason, "No se pudo guardar una respuesta."));
      throw reason;
    }
  }

  function changeAnswer(question, value) {
    setAnswers((current) => ({ ...current, [question.id]: value }));
    void enqueueSave(question, value).catch(() => undefined);
  }

  async function flushQuestions(questions) {
    const saves = questions.map(async (question) => {
      await (queuesRef.current[question.id] || Promise.resolve()).catch(() => undefined);
      if (!Object.is(savedValuesRef.current[question.id], answers[question.id])) {
        await enqueueSave(question, answers[question.id]);
      }
    });
    await Promise.all(saves);
  }

  async function continueSection() {
    const section = assessment.discovery_templates.discovery_sections[sectionIndex];
    const invalidRequired = section.discovery_questions.find((question) => question.required && questionConfigurationError(question));
    if (invalidRequired) return setError(`No se puede continuar: “${invalidRequired.prompt}” tiene una configuración inválida.`);
    const missing = section.discovery_questions.filter((question) => question.required && !isAnswered(answers[question.id]));
    if (missing.length) return setError("Completa las preguntas obligatorias antes de continuar.");
    try {
      await flushQuestions(section.discovery_questions);
      if (sectionIndex === assessment.discovery_templates.discovery_sections.length - 1) setReviewing(true);
      else setSectionIndex((index) => index + 1);
    } catch { /* The save operation already reports the error. */ }
  }

  async function finish() {
    const questions = allQuestions(assessment.discovery_templates);
    const invalidRequired = questions.find((question) => question.required && questionConfigurationError(question));
    if (invalidRequired) return setError(`No se puede finalizar: “${invalidRequired.prompt}” tiene una configuración inválida.`);
    const missing = questions.filter((question) => question.required && !isAnswered(answers[question.id]));
    if (missing.length) return setError("Aún faltan preguntas obligatorias.");
    setFinalizing(true);
    try {
      await flushQuestions(questions);
      await finalizeAssessment(assessmentId);
      navigate(`/discovery/evaluaciones/${assessmentId}/resultado`, { replace: true });
    } catch (reason) {
      setError(friendlyError(reason, "No se pudo finalizar el Discovery."));
    } finally {
      setFinalizing(false);
    }
  }

  if (loading) return <Page className="dx-page"><Loading text="Preparando Discovery..." /></Page>;
  if (!assessment) return <Page className="dx-page"><ErrorState text={error} /></Page>;

  const template = assessment.discovery_templates;
  const sections = template.discovery_sections;
  const section = sections[sectionIndex];
  const questions = allQuestions(template);
  const answeredCount = questions.filter((question) => isAnswered(persistedAnswers[question.id])).length;
  const completedSections = sections.filter((item) => item.discovery_questions.every((question) => !questionIsRequiredAndIncomplete(question, persistedAnswers))).length;
  const percentage = questions.length ? Math.round(answeredCount / questions.length * 100) : 0;
  const saveStatus = saving > 0 ? "saving" : saveErrors > 0 ? "error" : "saved";

  return <div className="dx-runner-page">
    <header className="dx-runner-topbar">
      <Link to="/discovery" className="dx-back"><ArrowLeft size={17} /> Evaluaciones</Link>
      <div className={`dx-save-state ${saveStatus}`}>{saveStatus === "saving" ? <><LoaderCircle className="dx-spin" size={14} /> Guardando...</> : saveStatus === "error" ? <><CircleAlert size={14} /> Error al guardar</> : <><Check size={14} /> Guardado</>}</div>
    </header>
    <main className="dx-runner-shell">
      <div className="dx-runner-intro">
        <span className="dx-eyebrow">{assessment.clients?.company_name}</span>
        <h1>{template.name}</h1>
        <p>{template.description}</p>
        <div className="dx-progress"><div><span>Progreso</span><b>{percentage}%</b></div><i><span style={{ width: `${percentage}%` }} /></i></div>
      </div>

      {error && <div className="dx-alert"><CircleAlert size={17} /><span>{error}</span><button onClick={() => setError("")}><X size={16} /></button></div>}

      {reviewing ? <Review
        answered={answeredCount}
        total={questions.length}
        completedSections={completedSections}
        sectionTotal={sections.length}
        requiredMissing={questions.filter((question) => questionIsRequiredAndIncomplete(question, answers)).length}
        onBack={() => setReviewing(false)}
        onFinish={finish}
        finalizing={finalizing}
      /> : <>
        <div className="dx-section-heading"><div><span>Sección {sectionIndex + 1} de {sections.length}</span><h2>{section.title}</h2><p>{section.description}</p></div><b>{section.discovery_questions.length} preguntas</b></div>
        <div className="dx-question-list">
          {section.discovery_questions.map((question, index) => <QuestionField key={question.id} question={question} index={index} value={answers[question.id]} onChange={(value) => changeAnswer(question, value)} />)}
        </div>
        <div className="dx-runner-nav">
          <button className="dx-button" disabled={sectionIndex === 0} onClick={() => setSectionIndex((index) => index - 1)}><ArrowLeft size={17} /> Anterior</button>
          <button className="dx-button dx-primary" onClick={continueSection}>{sectionIndex === sections.length - 1 ? "Revisar" : "Continuar"}<ArrowRight size={17} /></button>
        </div>
      </>}
    </main>
  </div>;
}

export function DiscoveryResult() {
  const { assessmentId } = useParams();
  const [assessment, setAssessment] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    getAssessment(assessmentId).then((data) => {
      if (active) setAssessment(data);
    }).catch((reason) => {
      if (active) setError(friendlyError(reason, "No se pudo cargar el resultado."));
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [assessmentId]);

  if (loading) return <Page className="dx-page"><Loading text="Preparando resultado..." /></Page>;
  if (!assessment) return <Page className="dx-page"><ErrorState text={error} /></Page>;

  const hasScore = assessment.score !== null && assessment.diagnosis?.hasScore !== false;
  const scoreProgress = Math.min(Math.max(Number(assessment.score) || 0, 0), 100);
  const diagnosis = assessment.diagnosis || {};
  return <Page className="dx-page dx-result-page">
    <Link to="/discovery" className="dx-back"><ArrowLeft size={17} /> Volver a Discovery</Link>
    <section className="dx-result-hero">
      <div className="dx-result-check"><Check size={28} /></div>
      <span className="dx-eyebrow">Discovery completado</span>
      <h1>{assessment.discovery_templates?.name}</h1>
      <p>{assessment.clients?.company_name} · {formatDate(assessment.completed_at)}</p>
      {hasScore ? <div className="dx-score-display" style={{ "--dx-score-progress": `${scoreProgress}%` }}><strong>{Math.round(Number(assessment.score))}</strong><span>/ {assessment.max_score}</span><small>Score general</small></div> : <div className="dx-informative-result"><BookOpen size={25} /><div><h2>Información registrada correctamente</h2><p>Este Discovery no contiene preguntas puntuables, por lo que no genera un Score.</p></div></div>}
    </section>

    {hasScore && <>
      <section><SectionHeading title="Categorías evaluadas" text="Resultados calculados por el motor Score sobre el alcance de este Discovery." />
        <div className="dx-category-grid">{assessment.discovery_category_results.map((result) => <article className="dx-category-card" key={result.id}><div><span>{result.score_categories?.name}</span><b>{Math.round(Number(result.percentage))}%</b></div><i><span style={{ width: `${result.percentage}%` }} /></i><small>{statusLabel(result.status)}</small></article>)}</div>
      </section>
      <section className="dx-insight-grid">
        <InsightCard icon={TrendingUp} title="Fortalezas" items={diagnosis.strengths} empty="Aún no se identificaron fortalezas consolidadas." />
        <InsightCard icon={BarChart3} title="Áreas de mejora" items={diagnosis.weaknesses} empty="No se detectaron áreas críticas." />
        <InsightCard icon={Target} title="Prioridades" items={diagnosis.priorities} empty="No hay prioridades pendientes." />
      </section>
    </>}
  </Page>;
}

function QuestionField({ question, index, value, onChange }) {
  const linkedScoreQuestion = question.discovery_question_score_links?.[0]?.score_questions;
  const min = linkedScoreQuestion?.scale_min ?? 1;
  const max = linkedScoreQuestion?.scale_max ?? 5;
  const rawOptions = question.options?.length ? question.options : linkedScoreQuestion?.options || [];
  const options = normalizeDiscoveryOptions(rawOptions);
  const responseType = normalizeDiscoveryResponseType(question.response_type);
  const configurationError = questionConfigurationError(question);
  if (configurationError && import.meta.env.DEV) {
    console.warn("Discovery question has an invalid response configuration", {
      questionId: question.id,
      responseType: question.response_type,
      configurationError,
    });
  }
  return <article className="dx-question">
    <div className="dx-question-index">{String(index + 1).padStart(2, "0")}</div>
    <div className="dx-question-body"><label>{question.prompt}{question.required && <em>*</em>}</label>{question.help_text && <p>{question.help_text}</p>}
      {configurationError ? <div className="dx-question-config-error" role="alert"><CircleAlert size={17} /><span><strong>Esta pregunta necesita configuración.</strong>{configurationError}</span></div> : <>
        {responseType === "text" && <textarea rows={4} value={value ?? ""} onChange={(event) => onChange(event.target.value)} placeholder="Escribe tu respuesta..." />}
        {responseType === "yes_no" && <div className="dx-choice-row"><Choice active={value === "yes"} onClick={() => onChange("yes")}>Sí</Choice><Choice active={value === "no"} onClick={() => onChange("no")}>No</Choice></div>}
        {responseType === "number" && <input type="number" value={value ?? ""} onChange={(event) => onChange(event.target.value === "" ? "" : Number(event.target.value))} placeholder="0" />}
        {responseType === "percentage" && <div className="dx-suffix-input"><input type="number" min="0" max="100" value={value ?? ""} onChange={(event) => onChange(event.target.value === "" ? "" : Math.min(100, Math.max(0, Number(event.target.value))))} /><span>%</span></div>}
        {responseType === "scale" && <div className="dx-scale">{Array.from({ length: max - min + 1 }, (_, offset) => min + offset).map((number) => <Choice key={number} active={Number(value) === number} onClick={() => onChange(number)}>{number}</Choice>)}</div>}
        {responseType === "multiple_choice" && <div className="dx-options">{options.map((option) => <Choice key={String(option.value)} active={value === option.value} onClick={() => onChange(option.value)}>{option.label}</Choice>)}</div>}
      </>}
    </div>
  </article>;
}

function Choice({ active, onClick, children }) { return <button type="button" className={`dx-choice ${active ? "active" : ""}`} onClick={onClick}>{active && <Check size={15} />}{children}</button>; }
function SummaryCard({ icon: Icon, value, label }) { return <article className="dx-summary-card"><span><Icon size={19} /></span><div><strong>{value}</strong><small>{label}</small></div></article>; }
function SectionHeading({ title, text }) { return <div className="dx-title"><h2>{title}</h2><p>{text}</p></div>; }

function HistoryRow({ assessment }) {
  const completed = assessment.status === "completed";
  const progress = progressFor(assessment);
  return <article className="dx-history-row">
    <div data-label="Cliente"><strong>{assessment.clients?.company_name || "Cliente"}</strong><small>{assessment.clients?.contact_name || assessment.clients?.industry || ""}</small></div>
    <div data-label="Discovery"><span>{assessment.discovery_templates?.name || "Discovery"}</span></div>
    <div data-label="Estado"><span className={`dx-status ${completed ? "completed" : "progress"}`}>{completed ? "Completado" : "En progreso"}</span></div>
    <div data-label={completed ? "Score" : "Progreso"}>{completed ? <strong>{assessment.score === null ? "Informativo" : `${Math.round(Number(assessment.score))} / ${assessment.max_score}`}</strong> : <div className="dx-mini-progress"><i><span style={{ width: `${progress}%` }} /></i><b>{progress}%</b></div>}</div>
    <div data-label="Fecha"><span>{formatDate(completed ? assessment.completed_at : assessment.updated_at)}</span></div>
    <div><Link className="dx-row-action" to={completed ? `/discovery/evaluaciones/${assessment.id}/resultado` : `/discovery/evaluaciones/${assessment.id}`}>{completed ? "Ver resultado" : "Continuar"}<ChevronRight size={15} /></Link></div>
  </article>;
}

function StartModal({ templates, divisions, clients, selection, setSelection, onClose, onSubmit, busy }) {
  const availableTemplates = templates.filter((template) => !selection.divisionId || template.division_id === selection.divisionId);
  return <div className="dx-modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><form className="dx-modal" onSubmit={onSubmit}>
    <div className="dx-modal-head"><div><span className="dx-eyebrow">Nueva evaluación</span><h2>Iniciar Discovery</h2></div><button type="button" onClick={onClose}><X size={20} /></button></div>
    <p>Selecciona qué área evaluar y el diagnóstico publicado que obtendrá la evidencia.</p>
    <label>Área / división<select value={selection.divisionId} onChange={(event) => { const divisionId = event.target.value; const first = templates.find((template) => !divisionId || template.division_id === divisionId); setSelection({ ...selection, divisionId, templateId: first?.id || "" }); }}><option value="">Todas las áreas</option>{divisions.map((division) => <option key={division.id} value={division.id}>{division.name}{division.score ? ` · ${Number(division.score.performance_percentage).toFixed(2)}/100` : " · Sin evaluar"}</option>)}</select></label>
    <label>Diagnóstico<select value={selection.templateId} onChange={(event) => setSelection({ ...selection, templateId: event.target.value })}><option value="">Seleccionar diagnóstico</option>{availableTemplates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}</select></label>
    <label>Contexto<select value={selection.clientId} onChange={(event) => setSelection({ ...selection, clientId: event.target.value })}><option value="">Organización activa</option>{clients.map((client) => <option key={client.id} value={client.id}>{client.company_name}{client.contact_name ? ` · ${client.contact_name}` : ""}</option>)}</select></label>
    {!availableTemplates.length && <div className="dx-modal-note"><CircleAlert size={16} /> No hay diagnósticos publicados para esta área.</div>}
    <div className="dx-modal-actions"><button type="button" className="dx-button" onClick={onClose}>Cancelar</button><button className="dx-button dx-primary" disabled={busy || !selection.templateId}>{busy ? <LoaderCircle className="dx-spin" size={16} /> : <Play size={16} />} Comenzar o continuar</button></div>
  </form></div>;
}

function Review({ answered, total, completedSections, sectionTotal, requiredMissing, onBack, onFinish, finalizing }) {
  return <section className="dx-review"><div className="dx-review-icon"><ClipboardCheck size={29} /></div><span className="dx-eyebrow">Revisión final</span><h2>Discovery listo para finalizar</h2><p>Revisa la completitud antes de generar el resultado.</p><div className="dx-review-stats"><div><strong>{answered}/{total}</strong><span>Preguntas contestadas</span></div><div><strong>{completedSections}/{sectionTotal}</strong><span>Secciones completadas</span></div><div><strong>{requiredMissing}</strong><span>Obligatorias pendientes</span></div></div><div className="dx-runner-nav"><button className="dx-button" onClick={onBack}><ArrowLeft size={17} /> Revisar respuestas</button><button className="dx-button dx-primary" disabled={requiredMissing > 0 || finalizing} onClick={onFinish}>{finalizing ? <LoaderCircle className="dx-spin" size={17} /> : <CheckCircle2 size={17} />} Finalizar Discovery</button></div></section>;
}

function InsightCard({ icon: Icon, title, items = [], empty }) { return <article className="dx-insight-card"><div className="dx-insight-head"><span><Icon size={18} /></span><h3>{title}</h3></div>{items.length ? <ul>{items.map((item) => <li key={item.categoryId || item.name}><span>{item.name}</span>{item.percentage !== undefined && <b>{Math.round(Number(item.percentage))}%</b>}</li>)}</ul> : <p>{empty}</p>}</article>; }
function statusLabel(status) { return ({ critical: "Crítico", priority: "Prioridad", developing: "En desarrollo", strong: "Fortaleza" })[status] || status; }
function Loading({ text }) { return <div className="dx-loading"><LoaderCircle className="dx-spin" size={23} /> {text}</div>; }
function ErrorState({ text }) { return <div className="dx-empty"><CircleAlert size={28} /><h2>No pudimos abrir el Discovery</h2><p>{text}</p><Link className="dx-button" to="/discovery">Volver</Link></div>; }
function Empty({ title, text, compact = false }) { return <div className={`dx-empty ${compact ? "compact" : ""}`}><ClipboardCheck size={25} /><h3>{title}</h3><p>{text}</p></div>; }

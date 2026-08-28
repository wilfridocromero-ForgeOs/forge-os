import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  ArrowLeft, ArrowRight, BarChart3, BookOpen, Building2, Check, CheckCircle2,
  ChevronRight, CircleAlert, ClipboardCheck, LoaderCircle, PencilRuler,
  Play, Plus, Search, Target, TrendingUp, UserRound, X,
} from "lucide-react";

import Page from "../components/ui/Page";
import { useAuth } from "../Context/AuthContext";
import {
  createAssessment, deleteDiscoveryResponse, finalizeAssessment, getAssessment,
  getExecutionDashboardData, saveDiscoveryResponse,
} from "../features/discovery-execution/services/discoveryExecutionService";
import {
  assessmentProgress,
  assessmentStructureMatches,
  safeDiscoveryErrorDiagnostic,
} from "../features/discovery-execution/discoveryAssessmentIntegrity";
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
  return assessmentProgress(assessment, isAnswered).percentage;
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
  const organizationId = profile?.organization_id;
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [data, setData] = useState({ templates: [], clients: [], assessments: [], divisions: [] });
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [startOpen, setStartOpen] = useState(false);
  const [selection, setSelection] = useState({ target: "", divisionId: "", templateId: "", clientId: "", lockedClient: false });
  const [historyFilter, setHistoryFilter] = useState("all");
  const [historySearch, setHistorySearch] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!organizationId) return;
    setLoading(true);
    try {
      setData(await getExecutionDashboardData(organizationId));
      setError("");
    } catch (reason) {
      setError(friendlyError(reason, "No se pudo cargar Discovery."));
    } finally {
      setLoading(false);
    }
  }, [organizationId]);

  useEffect(() => {
    // Data loading is the external synchronization performed by this effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  function openStart(templateId = "", divisionId = "", clientId = "") {
    const template = data.templates.find((item) => item.id === templateId);
    const resolvedDivision = divisionId || template?.division_id || "";
    const firstTemplate = template || data.templates.find((item) => !resolvedDivision || item.division_id === resolvedDivision);
    setSelection({ target: clientId ? "client" : "", divisionId: resolvedDivision, templateId: firstTemplate?.id || "", clientId, lockedClient: Boolean(clientId) });
    setStartOpen(true);
    setError("");
  }

  useEffect(() => {
    if (!loading && searchParams.get("new") === "1") {
      // URL context is translated into modal state after the remote data is ready.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      openStart("", searchParams.get("division") || "", searchParams.get("client") || "");
      const nextParams = new URLSearchParams(searchParams);
      nextParams.delete("new"); nextParams.delete("division"); nextParams.delete("client");
      setSearchParams(nextParams, { replace: true });
    }
    // openStart is intentionally driven by URL context after data has loaded.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, searchParams, setSearchParams]);

  async function startDiscovery(event) {
    event.preventDefault();
    const template = data.templates.find((item) => item.id === selection.templateId);
    const client = selection.target === "client"
      ? data.clients.find((item) => String(item.id) === String(selection.clientId)) || null
      : null;
    if (!template) return setError("Selecciona un diagnóstico publicado.");
    if (selection.target === "client" && !client) return setError("Selecciona un cliente.");
    setStarting(true);
    try {
      const assessment = await createAssessment({ organizationId, template, client, userId: user.id });
      navigate(`/discovery/evaluaciones/${assessment.id}`);
    } catch (reason) {
      setError(friendlyError(reason, "No se pudo iniciar la evaluación."));
    } finally {
      setStarting(false);
    }
  }

  const inProgress = data.assessments.filter((item) => item.status !== "completed");
  const view = searchParams.get("view") || "home";
  const visibleTemplates = view === "catalog" ? data.templates : data.templates.slice(0, 6);
  const filteredHistory = useMemo(() => data.assessments.filter((assessment) => {
    if (historyFilter === "in_progress" && assessment.status === "completed") return false;
    if (historyFilter === "completed" && assessment.status !== "completed") return false;
    const haystack = [assessment.discovery_templates?.name, assessment.clients?.company_name,
      assessment.discovery_templates?.divisions?.name].filter(Boolean).join(" ").toLocaleLowerCase("es");
    return haystack.includes(historySearch.trim().toLocaleLowerCase("es"));
  }), [data.assessments, historyFilter, historySearch]);

  return <Page className="dx-page">
    <header className="dx-hero">
      <div><span className="dx-eyebrow">Discovery</span><h1>{view === "history" ? "Historial de diagnósticos" : view === "catalog" ? "Diagnósticos disponibles" : "Diagnósticos"}</h1><p>{view === "home" ? "Comprende la situación actual antes de decidir qué hacer." : "Consulta la evidencia registrada por tu organización."}</p></div>
      <div className="dx-hero-actions">{view !== "home" && <Link className="dx-button" to="/discovery"><ArrowLeft size={17} /> Volver</Link>}{view === "home" && <button className="dx-button dx-primary" onClick={() => openStart()} disabled={!data.templates.length}><Plus size={17} /> Nuevo diagnóstico</button>}</div>
    </header>

    {error && <div className="dx-alert" role="alert"><CircleAlert size={17} /><span>{error}</span><button aria-label="Cerrar aviso" onClick={() => setError("")}><X size={16} /></button></div>}

    {loading ? <Loading text="Cargando diagnósticos..." /> : view === "history" ? <HistoryView assessments={filteredHistory} filter={historyFilter} setFilter={setHistoryFilter} search={historySearch} setSearch={setHistorySearch} /> : <>
      {view === "home" && inProgress.length > 0 && <section className="dx-home-section"><SectionHeading title="Continuar" text="Retoma los diagnósticos que dejaste pendientes." /><div className="dx-continue-grid">{inProgress.slice(0, 4).map((assessment) => <ContinueCard key={assessment.id} assessment={assessment} />)}</div></section>}

      <section className="dx-home-section"><div className="dx-section-bar"><SectionHeading title="Diagnósticos" text="Selecciona un diagnóstico para comenzar." />{view === "home" && data.templates.length > 6 && <Link to="/discovery?view=catalog">Ver todos <ChevronRight size={15} /></Link>}</div><div className="dx-template-grid">{visibleTemplates.map((template) => <TemplateCard key={template.id} template={template} onStart={() => openStart(template.id)} />)}{!data.templates.length && <Empty title="No hay diagnósticos publicados" text="Cuando exista un diagnóstico disponible aparecerá aquí." />}</div></section>

      {view === "home" && <section className="dx-home-section"><div className="dx-section-bar"><SectionHeading title="Actividad reciente" text="Consulta los últimos diagnósticos de tu organización." />{data.assessments.length > 0 && <Link to="/discovery?view=history">Ver historial <ChevronRight size={15} /></Link>}</div><div className="dx-recent-list">{data.assessments.slice(0, 5).map((assessment) => <RecentActivityRow key={assessment.id} assessment={assessment} />)}{!data.assessments.length && <Empty title="Aún no hay actividad" text="Los diagnósticos iniciados aparecerán aquí." compact />}</div></section>}

      {view === "home" && canManageUsers && <div className="dx-admin-link"><Link to="/discovery/builder"><PencilRuler size={16} /> Administrar diagnósticos</Link></div>}
    </>}

    {startOpen && <StartModal templates={data.templates} clients={data.clients} selection={selection} setSelection={setSelection} onClose={() => setStartOpen(false)} onSubmit={startDiscovery} busy={starting} />}
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
      const canonicalAssessment = await getAssessment(assessmentId);
      if (!assessmentStructureMatches(assessment, canonicalAssessment)) {
        const responseMap = Object.fromEntries(canonicalAssessment.discovery_responses
          .map((item) => [item.discovery_question_id, item]));
        const valueMap = Object.fromEntries(canonicalAssessment.discovery_responses
          .map((item) => [item.discovery_question_id, item.response_value]));
        responsesRef.current = responseMap;
        savedValuesRef.current = valueMap;
        setAssessment(canonicalAssessment);
        setAnswers(valueMap);
        setPersistedAnswers(valueMap);
        setReviewing(false);
        setSectionIndex(0);
        setError("La estructura de este Discovery cambió. La evaluación se actualizó; revisa las preguntas antes de finalizar.");
        return;
      }
      await finalizeAssessment(assessmentId);
      navigate(`/discovery/evaluaciones/${assessmentId}/resultado`, { replace: true });
    } catch (reason) {
      console.error("[Discovery] Finalization failed", safeDiscoveryErrorDiagnostic(reason));
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
      <p>{subjectLabel(assessment)} · {formatDate(assessment.completed_at)}</p>
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
function SectionHeading({ title, text }) { return <div className="dx-title"><h2>{title}</h2><p>{text}</p></div>; }

function subjectLabel(assessment) {
  return assessment.clients?.company_name || "Mi organización";
}

function TemplateCard({ template, onStart }) {
  const questions = allQuestions(template);
  return <article className="dx-template-card">
    <div className="dx-template-top"><span className="dx-template-mark"><ClipboardCheck size={19} /></span>{template.divisions?.name && <small><span>División</span>{template.divisions.name}</small>}</div>
    <h3>{template.name}</h3>
    <p>{template.description || "Diagnóstico estructurado para comprender la situación actual."}</p>
    <div className="dx-template-meta"><span>{template.discovery_sections.length} secciones</span><span>{questions.length} preguntas</span></div>
    <button className="dx-card-action" onClick={onStart}>Iniciar <ArrowRight size={16} /></button>
  </article>;
}

function ContinueCard({ assessment }) {
  const progress = progressFor(assessment);
  return <article className="dx-continue-card">
    <div className="dx-continue-context"><div><small>{assessment.clients ? "Cliente" : "Organización"}</small><strong>{subjectLabel(assessment)}</strong>{assessment.clients?.contact_name && <span>{assessment.clients.contact_name}</span>}</div><div><small>División</small><strong>{assessment.discovery_templates?.divisions?.name || "Organización"}</strong></div></div>
    <div className="dx-continue-diagnostic"><small>Diagnóstico</small><h3>{assessment.discovery_templates?.name || "Diagnóstico"}</h3></div>
    <div className="dx-mini-progress"><i><span style={{ width: `${progress}%` }} /></i><b>{progress}%</b></div>
    <footer><time>Actualizado {formatDate(assessment.updated_at)}</time><Link to={`/discovery/evaluaciones/${assessment.id}`}>Continuar <ChevronRight size={15} /></Link></footer>
  </article>;
}

function RecentActivityRow({ assessment }) {
  const completed = assessment.status === "completed";
  const result = completed
    ? (assessment.score === null ? "Informativo" : `${Math.round(Number(assessment.score))} / ${assessment.max_score}`)
    : `${progressFor(assessment)}%`;
  const destination = completed ? `/discovery/evaluaciones/${assessment.id}/resultado` : `/discovery/evaluaciones/${assessment.id}`;
  return <article className="dx-recent-row">
    <div className="dx-recent-context"><small>{assessment.clients ? "Cliente" : "Organización"}</small><strong>{subjectLabel(assessment)}</strong><span>{assessment.clients?.contact_name || assessment.discovery_templates?.divisions?.name || "Organización"}</span></div>
    <div className="dx-recent-diagnostic"><small>Diagnóstico</small><strong>{assessment.discovery_templates?.name || "Diagnóstico"}</strong><span>{assessment.discovery_templates?.divisions?.name || "Organización"}</span></div>
    <div className="dx-recent-result"><span className={`dx-status ${completed ? "completed" : "progress"}`}>{completed ? "Completado" : "En progreso"}</span><strong>{result}</strong><time>{formatDate(completed ? assessment.completed_at : assessment.updated_at)}</time></div>
    <Link className="dx-row-action" aria-label={`${completed ? "Ver resultado" : "Continuar"} de ${assessment.discovery_templates?.name || "diagnóstico"}`} to={destination}>{completed ? "Ver resultado" : "Continuar"} <ChevronRight size={15} /></Link>
  </article>;
}

function HistoryRow({ assessment }) {
  const completed = assessment.status === "completed";
  const progress = progressFor(assessment);
  return <article className="dx-history-row">
    <div data-label="Contexto"><strong>{subjectLabel(assessment)}</strong><small>{assessment.clients?.contact_name || assessment.discovery_templates?.divisions?.name || "Organización"}</small></div>
    <div data-label="Diagnóstico"><span>{assessment.discovery_templates?.name || "Diagnóstico"}</span></div>
    <div data-label="Estado"><span className={`dx-status ${completed ? "completed" : "progress"}`}>{completed ? "Completado" : "En progreso"}</span></div>
    <div data-label={completed ? "Score" : "Progreso"}>{completed ? <strong>{assessment.score === null ? "Informativo" : `${Math.round(Number(assessment.score))} / ${assessment.max_score}`}</strong> : <div className="dx-mini-progress"><i><span style={{ width: `${progress}%` }} /></i><b>{progress}%</b></div>}</div>
    <div data-label="Fecha"><span>{formatDate(completed ? assessment.completed_at : assessment.updated_at)}</span></div>
    <div><Link className="dx-row-action" to={completed ? `/discovery/evaluaciones/${assessment.id}/resultado` : `/discovery/evaluaciones/${assessment.id}`}>{completed ? "Ver resultado" : "Continuar"}<ChevronRight size={15} /></Link></div>
  </article>;
}

function StartModal({ templates, clients, selection, setSelection, onClose, onSubmit, busy }) {
  const [clientSearch, setClientSearch] = useState("");
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const closeOnEscape = (event) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [onClose]);
  const filteredClients = clients.filter((client) => [client.company_name, client.contact_name, client.email, client.industry]
    .filter(Boolean).join(" ").toLocaleLowerCase("es").includes(clientSearch.trim().toLocaleLowerCase("es")));
  const availableTemplates = templates.filter((template) => !selection.divisionId || template.division_id === selection.divisionId);
  const selectedClient = clients.find((client) => String(client.id) === String(selection.clientId));
  const chooseTarget = (target) => setSelection({ ...selection, target, clientId: target === "client" ? selection.clientId : "" });
  const changeClient = () => setSelection({ ...selection, clientId: "", lockedClient: false });

  return <div className="dx-modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><form className="dx-modal" onSubmit={onSubmit} role="dialog" aria-modal="true" aria-labelledby="dx-new-title">
    <div className="dx-modal-head"><div><span className="dx-eyebrow">Nuevo diagnóstico</span><h2 id="dx-new-title">{selection.target ? "Selecciona un diagnóstico" : "¿Qué deseas evaluar?"}</h2></div><button type="button" aria-label="Cerrar" onClick={onClose}><X size={20} /></button></div>

    {!selection.target ? <div className="dx-target-grid">
      <button type="button" onClick={() => chooseTarget("organization")}><Building2 size={22} /><span><strong>Mi organización</strong><small>Diagnostica una división de tu empresa.</small></span><ChevronRight size={17} /></button>
      <button type="button" onClick={() => chooseTarget("client")}><UserRound size={22} /><span><strong>Un cliente</strong><small>Vincula el diagnóstico a su expediente.</small></span><ChevronRight size={17} /></button>
    </div> : <>
      {!selection.lockedClient && <button type="button" className="dx-modal-back" onClick={() => setSelection({ ...selection, target: "", clientId: "" })}><ArrowLeft size={15} /> Cambiar contexto</button>}
      {selection.target === "client" && (selectedClient ? <div className="dx-client-context"><UserRound size={18} /><div><small>Cliente seleccionado</small><strong>{selectedClient.company_name}</strong><span>{[selectedClient.contact_name, selectedClient.email].filter(Boolean).join(" · ") || "Sin contacto registrado"}</span></div><button type="button" onClick={changeClient}>Cambiar</button></div> : <div className="dx-client-picker"><label htmlFor="dx-client-search">Selecciona un cliente</label><div className="dx-search-field"><Search size={16} /><input id="dx-client-search" value={clientSearch} onChange={(event) => setClientSearch(event.target.value)} placeholder="Buscar por empresa, contacto o correo" /></div><div className="dx-client-results">{filteredClients.map((client) => <button type="button" key={client.id} onClick={() => setSelection({ ...selection, clientId: String(client.id) })}><span><strong>{client.company_name}</strong><small>{[client.contact_name, client.email].filter(Boolean).join(" · ") || client.industry || "Sin contacto"}</small></span><ChevronRight size={15} /></button>)}{!filteredClients.length && <p>No encontramos clientes con esa búsqueda.</p>}</div></div>)}
      {(selection.target === "organization" || selectedClient) && <DiagnosticPicker templates={availableTemplates} selectedId={selection.templateId} onSelect={(templateId) => setSelection({ ...selection, templateId })} />}
      <div className="dx-modal-actions"><button type="button" className="dx-button" onClick={onClose}>Cancelar</button><button className="dx-button dx-primary" disabled={busy || !selection.templateId || (selection.target === "client" && !selection.clientId)}>{busy ? <LoaderCircle className="dx-spin" size={16} /> : <Play size={16} />} Comenzar</button></div>
    </>}
  </form></div>;
}

function DiagnosticPicker({ templates, selectedId, onSelect }) {
  const [search, setSearch] = useState("");
  const visibleTemplates = templates.filter((template) => [template.name, template.description, template.divisions?.name]
    .filter(Boolean).join(" ").toLocaleLowerCase("es").includes(search.trim().toLocaleLowerCase("es")));
  return <fieldset className="dx-diagnostic-picker">
    <legend>Selecciona un diagnóstico</legend>
    {templates.length > 6 && <label className="dx-search-field"><Search size={16} /><span className="sr-only">Buscar diagnóstico</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar por diagnóstico o división" /></label>}
    <div className="dx-diagnostic-options">{visibleTemplates.map((template) => {
      const selected = String(selectedId) === String(template.id);
      return <button type="button" aria-pressed={selected} className={selected ? "active" : ""} key={template.id} onClick={() => onSelect(String(template.id))}><span className="dx-template-mark"><ClipboardCheck size={17} /></span><span><strong>{template.name}</strong><small><span>División</span>{template.divisions?.name || "Organización"}</small></span>{selected ? <Check size={17} /> : <ChevronRight size={15} />}</button>;
    })}{!visibleTemplates.length && <p>No encontramos diagnósticos con esa búsqueda.</p>}</div>
  </fieldset>;
}

function HistoryView({ assessments, filter, setFilter, search, setSearch }) {
  return <section className="dx-history-view"><div className="dx-history-tools"><div className="dx-filter-tabs" role="group" aria-label="Filtrar diagnósticos">{[["all", "Todos"], ["in_progress", "En progreso"], ["completed", "Completados"]].map(([value, label]) => <button className={filter === value ? "active" : ""} key={value} onClick={() => setFilter(value)}>{label}</button>)}</div><label className="dx-search-field"><Search size={16} /><span className="sr-only">Buscar historial</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar diagnóstico, cliente o división" /></label></div><div className="dx-history"><div className="dx-history-head"><span>Contexto</span><span>Diagnóstico</span><span>Estado</span><span>Progreso / Score</span><span>Fecha</span><span /></div>{assessments.map((assessment) => <HistoryRow key={assessment.id} assessment={assessment} />)}{!assessments.length && <Empty title="No hay diagnósticos para mostrar" text="Prueba con otro estado o término de búsqueda." compact />}</div></section>;
}

function Review({ answered, total, completedSections, sectionTotal, requiredMissing, onBack, onFinish, finalizing }) {
  return <section className="dx-review"><div className="dx-review-icon"><ClipboardCheck size={29} /></div><span className="dx-eyebrow">Revisión final</span><h2>Discovery listo para finalizar</h2><p>Revisa la completitud antes de generar el resultado.</p><div className="dx-review-stats"><div><strong>{answered}/{total}</strong><span>Preguntas contestadas</span></div><div><strong>{completedSections}/{sectionTotal}</strong><span>Secciones completadas</span></div><div><strong>{requiredMissing}</strong><span>Obligatorias pendientes</span></div></div><div className="dx-runner-nav"><button className="dx-button" onClick={onBack}><ArrowLeft size={17} /> Revisar respuestas</button><button className="dx-button dx-primary" disabled={requiredMissing > 0 || finalizing} onClick={onFinish}>{finalizing ? <LoaderCircle className="dx-spin" size={17} /> : <CheckCircle2 size={17} />} Finalizar Discovery</button></div></section>;
}

function InsightCard({ icon: Icon, title, items = [], empty }) { return <article className="dx-insight-card"><div className="dx-insight-head"><span><Icon size={18} /></span><h3>{title}</h3></div>{items.length ? <ul>{items.map((item) => <li key={item.categoryId || item.name}><span>{item.name}</span>{item.percentage !== undefined && <b>{Math.round(Number(item.percentage))}%</b>}</li>)}</ul> : <p>{empty}</p>}</article>; }
function statusLabel(status) { return ({ critical: "Crítico", priority: "Prioridad", developing: "En desarrollo", strong: "Fortaleza" })[status] || status; }
function Loading({ text }) { return <div className="dx-loading"><LoaderCircle className="dx-spin" size={23} /> {text}</div>; }
function ErrorState({ text }) { return <div className="dx-empty"><CircleAlert size={28} /><h2>No pudimos abrir el Discovery</h2><p>{text}</p><Link className="dx-button" to="/discovery">Volver</Link></div>; }
function Empty({ title, text, compact = false }) { return <div className={`dx-empty ${compact ? "compact" : ""}`}><ClipboardCheck size={25} /><h3>{title}</h3><p>{text}</p></div>; }

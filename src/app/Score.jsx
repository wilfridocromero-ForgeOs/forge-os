import { useState } from "react";
import { AlertCircle, ArrowLeft, ArrowRight, Brain, ChevronDown } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";

import Card from "../components/ui/Card";
import Page from "../components/ui/Page";
import useCompanyScoreDetail from "../hooks/useCompanyScoreDetail";
import "./Score.css";

const LABELS = { unevaluated: "Sin evaluar", insufficient_data: "Datos insuficientes", partial: "Parcial", current: "Actual", stale: "Datos por actualizar", critical: "Crítico", developing: "En desarrollo" };
const percent = (value) => value == null ? "—" : `${Number(value).toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
const weight = (value) => value == null ? "—" : `${Number(value).toLocaleString("es-ES", { maximumFractionDigits: 2 })}%`;

function responseText(value) {
  if (value === null || value === undefined) return "Sin respuesta";
  if (typeof value === "string") return value === "yes" ? "Sí" : value === "no" ? "No" : value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

function Empty({ title, children }) {
  return <div className="score-detail-empty"><strong>{title}</strong>{children && <p>{children}</p>}</div>;
}

export default function Score() {
  const navigate = useNavigate();
  const { data, loading, error } = useCompanyScoreDetail();
  const [selectedDivisionId, setSelectedDivisionId] = useState("");

  if (loading) return <Page><div className="score-detail-state">Cargando ORVESEN Score…</div></Page>;
  if (error) return <Page><div className="score-detail-state"><AlertCircle /><strong>No pudimos cargar ORVESEN Score.</strong><span>Intenta nuevamente más tarde.</span></div></Page>;
  if (!data?.model) return <Page><div className="score-detail-state"><strong>Configura el modelo de Score de tu organización.</strong><span>Esta vista estará disponible cuando exista un modelo publicado.</span></div></Page>;

  const { model, snapshot, divisions = [], templatesByDivision = {} } = data;
  const defaultDivision = divisions.find((division) => division.score) || divisions[0] || null;
  const selectedDivision = divisions.find((division) => division.id === selectedDivisionId) || defaultDivision;
  const divisionTemplates = selectedDivision ? (templatesByDivision[selectedDivision.id] || []) : [];
  const hasMasterScore = snapshot?.master_score != null;
  const masterProgress = hasMasterScore ? Math.min(100, Math.max(0, Number(snapshot.master_score) / 10)) : 0;
  const pendingCount = divisions.filter((division) => !division.score).length;
  const status = snapshot?.status || "unevaluated";

  return (
    <Page className="score-detail-page">
      <header className="score-detail-header">
        <Link to="/" className="score-detail-back"><ArrowLeft size={15} /> Dashboard</Link>
        <p>{model.name}</p>
        <h1>Salud general de la organización</h1>
        <span>Una lectura trazable desde el resultado empresarial hasta la evidencia.</span>
      </header>

      <Card hover={false} contentClassName="score-detail-hero">
        <div className="score-detail-ring" style={{ "--score-detail-progress": `${masterProgress}%` }}><div><strong>{hasMasterScore ? snapshot.master_score : "—"}</strong><span>/ 1000</span></div></div>
        <div className="score-detail-hero-copy">
          <span className={`score-detail-badge is-${status}`}>{LABELS[status] || status}</span>
          <h2>ORVESEN Score</h2>
          <p>{status === "insufficient_data" ? "Todavía no existe evidencia suficiente para publicar el Master Score." : status === "stale" ? "El Score existe, pero parte de la evidencia necesita actualizarse." : "Resultado consolidado de la organización."}</p>
          <div className="score-detail-facts">
            <div><span>Cobertura</span><strong>{percent(snapshot?.coverage_percentage)}</strong></div>
            <div><span>Desempeño observado</span><strong>{percent(snapshot?.performance_percentage)}</strong></div>
            <div><span>Mínimo requerido</span><strong>{percent(model.minimum_publishable_coverage)}</strong></div>
            <div><span>Última actualización</span><strong>{snapshot?.calculated_at ? new Date(snapshot.calculated_at).toLocaleDateString("es-ES") : "—"}</strong></div>
          </div>
        </div>
      </Card>

      <section className="score-detail-section">
        <div className="score-detail-section-heading"><div><p>Divisiones</p><h2>Selecciona un área para investigar</h2></div><span>{pendingCount} sin evaluar</span></div>
        {divisions.length ? <div className="score-detail-tabs" role="tablist" aria-label="Divisiones del modelo">{divisions.map((division) => <button type="button" role="tab" aria-selected={selectedDivision?.id === division.id} className={selectedDivision?.id === division.id ? "active" : ""} key={division.id} onClick={() => setSelectedDivisionId(division.id)}><strong>{division.name}</strong><span>{division.score ? `${Number(division.score.performance_percentage).toFixed(2)} / 100` : "Sin evaluar"}</span></button>)}</div> : <Empty title="Sin divisiones configuradas">El modelo publicado no contiene componentes activos.</Empty>}
      </section>

      {selectedDivision && <section className="score-detail-section">
        <div className="score-detail-section-heading"><div><p>Detalle de la división</p><h2>{selectedDivision.name}</h2></div><span>Peso empresarial {weight(selectedDivision.weight)}</span></div>
        <Card hover={false} contentClassName="score-division-summary">
          {selectedDivision.score ? <><div><span>Division Score</span><strong>{Number(selectedDivision.score.performance_percentage).toFixed(2)} <small>/ 100</small></strong></div><div><span>Cobertura</span><strong>{percent(selectedDivision.score.coverage_percentage)}</strong></div><div><span>Estado</span><strong>{LABELS[selectedDivision.score.status] || selectedDivision.score.status}</strong></div><div><span>Actualizado</span><strong>{new Date(selectedDivision.score.calculated_at).toLocaleDateString("es-ES")}</strong></div></> : <Empty title="Sin evaluar">Esta división todavía no tiene un snapshot ni evidencia materializada.</Empty>}
        </Card>

        <div className="score-template-heading"><div><p>Composición</p><h3>Scores que construyen esta división</h3></div><span>{divisionTemplates.length} resultados</span></div>
        {selectedDivision.score && !divisionTemplates.length && <Empty title="Score sin resultado trazable">No hay componentes materializados disponibles para este snapshot.</Empty>}
        <div className="score-template-list">{divisionTemplates.map((item) => <details className="score-template" key={item.id}><summary><div><span>{item.template?.name || "Score"}</span><small>Peso en la división {weight(item.configured_weight)}</small></div><div><strong>{item.result?.score_percentage == null ? "—" : `${Number(item.result.score_percentage).toFixed(2)} / 100`}</strong><small>{LABELS[item.result?.status] || item.result?.status || "Sin resultado"} · Cobertura {percent(item.result?.coverage_percentage)}</small></div><ChevronDown size={18} /></summary><div className="score-template-body"><div className="score-template-meta"><span>Fuente: {item.result?.source_type === "discovery" ? "Discovery" : item.result?.source_type || "—"}</span><span>Evaluado: {item.result?.evaluated_at ? new Date(item.result.evaluated_at).toLocaleDateString("es-ES") : "—"}</span></div><h4>Categorías evaluadas</h4>{item.categories.length ? <div className="score-category-list">{item.categories.map((category) => <details className="score-category" key={category.id}><summary><div><strong>{category.category?.name || "Categoría"}</strong><span>Peso {weight(category.category?.weight)} · {LABELS[category.status] || category.status}</span></div><b>{Number(category.percentage).toFixed(2)}%</b><ChevronDown size={16} /></summary><div className="score-evidence"><h5>Evidencia trazable</h5>{category.evidence.length ? category.evidence.map((evidence) => <article key={`${evidence.response_id}-${evidence.score_question_id}`}><div><span>Pregunta Discovery</span><p>{evidence.discovery_question || "Pregunta no disponible"}</p></div><div><span>Respuesta</span><p>{responseText(evidence.response_value)}</p></div><div><span>Pregunta de Score relacionada</span><p>{evidence.score_question}</p></div><div><span>Resultado normalizado</span><p>{evidence.numeric_score == null ? "Sin puntuación" : `${Number(evidence.numeric_score).toFixed(2)} / 100`}</p></div><small>Fuente: Discovery</small></article>) : <Empty title="Categoría sin evidencia enlazada">Existe un resultado materializado, pero no hay respuestas demostrablemente vinculadas a esta categoría.</Empty>}</div></details>)}</div> : <Empty title="Sin categorías materializadas">Este resultado no tiene categorías Discovery relacionadas.</Empty>}</div></details>)}</div>
      </section>}

      <section className="score-detail-section"><div className="score-detail-section-heading"><div><p>Análisis</p><h2>Resumen Ejecutivo</h2></div></div><div className="score-analysis-grid"><Card hover={false} contentClassName="score-analysis-card"><strong>Fortalezas</strong><p>Aún no hay análisis generado.</p></Card><Card hover={false} contentClassName="score-analysis-card"><strong>Riesgos</strong><p>Aún no hay análisis generado.</p></Card><Card hover={false} contentClassName="score-analysis-card"><strong><Brain size={17} /> ORVESEN IA</strong><p>El análisis estará disponible cuando exista evidencia suficiente y una interpretación persistida.</p></Card></div></section>

      <section className="score-detail-section"><div className="score-detail-section-heading"><div><p>Próximo paso</p><h2>Acción Prioritaria</h2></div></div><Card hover={false} contentClassName="score-action-card"><div><span>Acción del sistema</span><strong>{status === "insufficient_data" || status === "unevaluated" ? "Completar evaluación" : "Revisar evidencia"}</strong><p>{pendingCount ? `Continúa evaluando las ${pendingCount} divisiones sin evidencia para aumentar la cobertura.` : "Revisa el detalle y mantén la evidencia actualizada."}</p></div><div className="score-action-metrics"><span>Impacto <b>—</b></span><span>Tiempo <b>—</b></span></div><button onClick={() => navigate(`/discovery?new=1${selectedDivision ? `&division=${selectedDivision.id}` : ""}`)}>Evaluar área <ArrowRight size={15} /></button></Card></section>
    </Page>
  );
}

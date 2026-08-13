import { AlertCircle, ArrowRight, CheckCircle2, Clock3 } from "lucide-react";
import { Link } from "react-router-dom";
import Card from "../ui/Card";
import "./CompanyScoreOverview.css";

const LABELS = { unevaluated: "Sin evaluar", insufficient_data: "Datos insuficientes", partial: "Parcial", current: "Actual", stale: "Datos por actualizar" };
const percent = (value) => value == null ? null : `${Number(value).toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
const weightPercent = (value) => `${Number(value).toLocaleString("es-ES", { maximumFractionDigits: 2 })}%`;
const statusIcon = (status) => status === "current" ? <CheckCircle2 size={15} /> : status === "stale" ? <Clock3 size={15} /> : <AlertCircle size={15} />;

export default function CompanyScoreOverview({ data, loading, error, onEvaluate, detailPath = "/orvesen-score" }) {
  if (loading) return <Card hover={false} contentClassName="company-score-state">Cargando Score de la organización…</Card>;
  if (error) return <Card hover={false} contentClassName="company-score-state"><AlertCircle size={22} /><strong>No pudimos cargar el Score de la organización.</strong><span>El resto del Dashboard continúa disponible.</span></Card>;
  if (!data?.model) return <Card hover={false} contentClassName="company-score-state"><strong>Configura el modelo de Score de tu organización.</strong><span>Cuando el modelo esté publicado, aquí aparecerán su Score y cobertura.</span></Card>;

  const { model, snapshot, divisions = [] } = data;
  const hasMasterScore = snapshot?.master_score != null;
  const masterProgress = hasMasterScore ? Math.min(100, Math.max(0, Number(snapshot.master_score) / 10)) : 0;
  const coverage = snapshot?.coverage_percentage ?? 0;
  const threshold = model.minimum_publishable_coverage ?? 60;
  const status = snapshot?.status || "unevaluated";
  const pendingCount = divisions.filter((division) => !division.score).length;
  const descriptions = {
    insufficient_data: "Aún no hay suficiente evidencia para calcular el Score de la organización.",
    stale: "El Score existe, pero parte de la evidencia necesita actualizarse.",
    unevaluated: "Aún no existen evaluaciones para calcular el Score de la organización.",
  };

  return (
    <section className="company-score-layout" aria-label="Score de la organización">
      <Card className="company-score-main" hover={false} contentClassName="company-score-card">
        <div className="company-score-heading"><div><p className="company-score-eyebrow">{model.name}</p><h2>Salud general de la organización</h2><Link className="company-score-detail-link" to={detailPath}>Ver análisis <ArrowRight size={14} /></Link></div><span className={`company-score-status is-${status}`}>{statusIcon(status)} {LABELS[status] || status}</span></div>
        <div className="company-score-summary">
          <div className="company-score-ring" style={{ "--company-score-progress": `${masterProgress}%` }}><div><strong>{hasMasterScore ? Number(snapshot.master_score).toLocaleString("es-ES") : "—"}</strong><span>/ 1000</span></div></div>
          <div className="company-score-context">
            <p>{descriptions[status] || "Resultado consolidado a partir de la evidencia disponible."}</p>
            {snapshot?.performance_percentage != null && <div className="company-score-observed"><span>Desempeño observado</span><strong>{percent(snapshot.performance_percentage)}</strong></div>}
            <div className="company-score-coverage-copy"><span>Cobertura</span><strong>{percent(coverage)}</strong></div>
            <div className="company-score-coverage" aria-label={`Cobertura ${percent(coverage)}`}><span style={{ width: `${Math.min(100, Math.max(0, Number(coverage)))}%` }} /></div>
            <small>{percent(coverage)} de {percent(threshold)} mínimo requerido</small>
          </div>
        </div>
        {(status === "insufficient_data" || status === "unevaluated") && <div className="company-score-next-step"><ArrowRight size={18} /><div><strong>Próximo paso</strong><p>Continúa evaluando las divisiones sin evidencia para aumentar la cobertura.</p>{pendingCount > 0 && <span>{pendingCount} {pendingCount === 1 ? "área pendiente" : "áreas pendientes"} de evaluación</span>}</div>{onEvaluate && <button onClick={onEvaluate}>Evaluar</button>}</div>}
      </Card>

      <Card hover={false} contentClassName="company-score-divisions-card">
        <div className="company-score-divisions-heading"><div><p className="company-score-eyebrow">Divisiones</p><h2>Score por área</h2></div><span>{divisions.length} configuradas</span></div>
        <div className="company-score-divisions">{divisions.map((division) => <article className="company-division-row" key={division.id}><div><strong>{division.name}</strong><span>Peso en el modelo: {weightPercent(division.weight)}</span></div>{division.score ? <div className="company-division-result"><strong>{Number(division.score.performance_percentage).toFixed(2)} <span>/ 100</span></strong><small>{LABELS[division.score.status] || division.score.status} · Cobertura {percent(division.score.coverage_percentage)}</small></div> : <span className="company-division-empty">Sin evaluar</span>}</article>)}</div>
      </Card>
    </section>
  );
}

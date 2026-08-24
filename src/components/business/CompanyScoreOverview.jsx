import { AlertCircle, ArrowRight, CheckCircle2, Clock3, TrendingDown, TrendingUp } from "lucide-react";
import { Link } from "react-router-dom";
import Card from "../ui/Card";
import "./CompanyScoreOverview.css";

const LABELS = { unevaluated: "Sin evaluar", insufficient_data: "Datos insuficientes", partial: "Parcial", current: "Actual", stale: "Datos por actualizar" };
const percent = (value, digits = 1) => value == null ? "0%" : `${Number(value).toLocaleString("es-ES", { maximumFractionDigits: digits })}%`;
const clamp = (value) => Math.min(100, Math.max(0, Number(value) || 0));
const statusIcon = (status) => status === "current" ? <CheckCircle2 size={15} /> : status === "stale" ? <Clock3 size={15} /> : <AlertCircle size={15} />;

export default function CompanyScoreOverview({ data, loading, error, onEvaluate, detailPath = "/orvesen-score" }) {
  if (loading) return <ScoreState>Cargando el estado empresarial…</ScoreState>;
  if (error) return <ScoreState icon={<AlertCircle size={22} />} title="No pudimos cargar el Score.">El resto del Dashboard continúa disponible.</ScoreState>;
  if (!data?.model) return <ScoreState title="Aún no existe un modelo de Score publicado.">Configura el modelo para comenzar a consolidar evidencia empresarial.</ScoreState>;

  const { model, snapshot, previousSnapshot, divisions = [] } = data;
  const hasMasterScore = snapshot?.master_score != null;
  const coverage = Number(snapshot?.coverage_percentage || 0);
  const threshold = Number(model.minimum_publishable_coverage || 60);
  const status = snapshot?.status || "unevaluated";
  const evaluated = divisions.filter((division) => division.score).length;
  const delta = hasMasterScore && previousSnapshot?.master_score != null
    ? Number(snapshot.master_score) - Number(previousSnapshot.master_score)
    : null;
  const evaluationLabel = status === "unevaluated" ? "Comenzar diagnóstico" : status === "insufficient_data" ? "Continuar evaluación" : "Ver análisis completo";

  return (
    <Card className="company-score-main" hover={false} contentClassName="company-score-card">
      <div className="company-score-heading">
        <div><p className="company-score-eyebrow">ORVESEN SCORE</p><h2>Estado general de la empresa</h2></div>
        <span className={`company-score-status is-${status}`}>{statusIcon(status)} {LABELS[status] || status}</span>
      </div>
      <div className="company-score-summary">
        <div className={`company-score-ring ${hasMasterScore ? "" : "is-insufficient"}`} style={{ "--company-score-progress": `${hasMasterScore ? clamp(Number(snapshot.master_score) / 10) : clamp(coverage)}%` }}>
          <div>{hasMasterScore ? <><strong>{Number(snapshot.master_score).toLocaleString("es-ES")}</strong><span>/ 1000</span></> : <><strong>Datos</strong><span>insuficientes</span></>}</div>
        </div>
        <div className="company-score-context">
          <div className="company-score-facts">
            {snapshot?.performance_percentage != null && <div><span>Desempeño observado</span><strong>{percent(snapshot.performance_percentage, 2)}</strong></div>}
            <div><span>Cobertura</span><strong>{percent(coverage, 2)}</strong></div>
            <div><span>Áreas evaluadas</span><strong>{evaluated} de {divisions.length}</strong></div>
          </div>
          <div className="company-score-coverage" aria-label={`Cobertura ${percent(coverage)}`}><span style={{ width: `${clamp(coverage)}%` }} /></div>
          <p className="company-score-threshold">{percent(coverage, 2)} de {percent(threshold)} mínimo requerido</p>
          {delta != null && delta !== 0 && <p className={`company-score-delta ${delta > 0 ? "is-up" : "is-down"}`}>{delta > 0 ? <TrendingUp size={15} /> : <TrendingDown size={15} />} {delta > 0 ? "+" : ""}{delta.toLocaleString("es-ES")} puntos desde el snapshot anterior</p>}
          <p className="company-score-updated">Actualizado {snapshot?.calculated_at ? new Date(snapshot.calculated_at).toLocaleString("es-ES", { dateStyle: "medium", timeStyle: "short" }) : "sin snapshot disponible"}</p>
          <div className="company-score-actions">
            <Link to={detailPath}>{status === "current" || status === "partial" || status === "stale" ? evaluationLabel : "Ver análisis"} <ArrowRight size={15} /></Link>
            {(status === "unevaluated" || status === "insufficient_data") && onEvaluate && <button type="button" onClick={onEvaluate}>{evaluationLabel}</button>}
          </div>
        </div>
      </div>
    </Card>
  );
}

function ScoreState({ icon = null, title = null, children }) {
  return <Card hover={false} contentClassName="company-score-state">{icon}{title && <strong>{title}</strong>}<span>{children}</span></Card>;
}

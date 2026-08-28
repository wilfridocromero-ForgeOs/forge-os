import { useMemo, useState } from "react";
import { Check, ChevronDown, ChevronUp, ExternalLink, LoaderCircle, X } from "lucide-react";

const priorityLabels = { low: "Baja", medium: "Media", high: "Alta", urgent: "Urgente" };
const dateLabel = (value) => value ? new Intl.DateTimeFormat("es", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "Sin fecha";

export default function OrbActionProposal({ proposal, onConfirm, onCancel }) {
  const [busy, setBusy] = useState("");
  const [expanded, setExpanded] = useState(false);
  const display = proposal.display_payload || {};
  const expired = proposal.status === "proposed" && new Date(proposal.expires_at) <= new Date();
  const status = expired ? "expired" : proposal.status;
  const taskUrl = useMemo(() => proposal.result_entity_id && display.project_id
    ? `/proyectos/${display.project_id}?tab=work&task=${proposal.result_entity_id}`
    : null, [display.project_id, proposal.result_entity_id]);

  async function act(type, handler) {
    if (busy) return;
    setBusy(type);
    try { await handler(proposal); } finally { setBusy(""); }
  }

  return <section className={`orb-action-card is-${status}`} aria-label="Propuesta de Orb: crear tarea" aria-busy={Boolean(busy)}>
    <header><div><span className="orb-action-kicker">Acción propuesta</span><h3>Crear tarea</h3></div>{status === "completed" ? <Check aria-hidden="true" size={19} /> : null}</header>
    <dl>
      <div><dt>Proyecto</dt><dd>{display.project_name || "Proyecto"}</dd></div>
      <div><dt>Tarea</dt><dd>{display.title}</dd></div>
      <div><dt>Responsable</dt><dd>{display.assignee_name || "Sin asignar"}</dd></div>
      <div><dt>Prioridad</dt><dd>{priorityLabels[display.priority] || display.priority}</dd></div>
      <div><dt>Inicio</dt><dd>{dateLabel(display.starts_at)}</dd></div>
      <div><dt>Vencimiento</dt><dd>{dateLabel(display.due_at)}</dd></div>
    </dl>
    {display.instructions ? <div className="orb-action-instructions"><button type="button" onClick={() => setExpanded((value) => !value)}>{expanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />} Instrucciones</button>{expanded ? <p>{display.instructions}</p> : null}</div> : null}
    {status === "proposed" ? <footer><button type="button" className="orb-action-secondary" disabled={Boolean(busy)} onClick={() => act("cancel", onCancel)}>{busy === "cancel" ? <LoaderCircle className="orb-spin" size={16} /> : <X size={16} />} Cancelar</button><button type="button" className="orb-action-primary" disabled={Boolean(busy)} onClick={() => act("confirm", onConfirm)}>{busy === "confirm" ? <LoaderCircle className="orb-spin" size={16} /> : <Check size={16} />} Confirmar</button></footer> : null}
    {status === "completed" ? <div className="orb-action-result"><span>✓ Tarea creada</span>{taskUrl ? <a href={taskUrl}>Ver tarea <ExternalLink size={14} /></a> : null}</div> : null}
    {status === "executing" ? <p className="orb-action-state"><LoaderCircle className="orb-spin" size={16} /> Confirmando la acción…</p> : null}
    {status === "cancelled" ? <p className="orb-action-state">Propuesta cancelada.</p> : null}
    {status === "expired" ? <p className="orb-action-state">Esta propuesta expiró. Pide a Orb una nueva.</p> : null}
    {status === "failed" ? <p className="orb-action-state">La acción no pudo completarse. Revisa los datos y solicita una propuesta nueva.</p> : null}
  </section>;
}

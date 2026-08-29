import { useMemo, useState } from "react";
import { Check, ChevronDown, ChevronUp, ExternalLink, LoaderCircle, X } from "lucide-react";

const priorityLabels = { low: "Baja", medium: "Media", high: "Alta", urgent: "Urgente" };
const statusLabels = { pending: "Pendiente", in_progress: "En progreso", completed: "Completada" };
const dateLabel = (value) => value ? new Intl.DateTimeFormat("es", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "Sin fecha";
const actionLabels = {
  create_project_task: { title: "Crear tarea", completed: "Tarea creada" },
  update_project_task: { title: "Actualizar tarea", completed: "Tarea actualizada" },
  change_project_task_status: { title: "Cambiar estado", completed: "Estado actualizado" },
};
const safeErrors = {
  STALE_ENTITY_STATE: "La tarea cambió después de preparar esta propuesta. Solicita una nueva para no sobrescribir cambios recientes.",
  EVIDENCE_REQUIRED: "La tarea requiere evidencia obligatoria antes de poder completarse.",
  ACTION_EXECUTION_FAILED: "La acción no pudo completarse. Revisa los datos y solicita una propuesta nueva.",
};

function changeValue(field, value) {
  if (field === "priority") return priorityLabels[value] || value || "Sin prioridad";
  if (field === "status") return statusLabels[value] || value || "Sin estado";
  if (field === "due_at") return dateLabel(value);
  if (field === "assignee_id") return value || "Sin asignar";
  if (field === "instructions") return value || "Sin instrucciones";
  return value || "Sin valor";
}

export default function OrbActionProposal({ proposal, onConfirm, onCancel }) {
  const [busy, setBusy] = useState("");
  const [expanded, setExpanded] = useState(false);
  const display = proposal.display_payload || {};
  const action = actionLabels[proposal.action_type] || actionLabels.create_project_task;
  const expired = proposal.status === "proposed" && new Date(proposal.expires_at) <= new Date();
  const status = expired ? "expired" : proposal.status;
  const taskUrl = useMemo(() => proposal.result_entity_id && display.project_id
    ? `/proyectos/${display.project_id}?tab=work&task=${proposal.result_entity_id}`
    : null, [display.project_id, proposal.result_entity_id]);
  const materialChanges = Array.isArray(display.changes) ? display.changes : [];

  async function act(type, handler) {
    if (busy) return;
    setBusy(type);
    try { await handler(proposal); } finally { setBusy(""); }
  }

  return <section className={`orb-action-card is-${status}`} aria-label={`Propuesta de Orb: ${action.title.toLowerCase()}`} aria-busy={Boolean(busy)}>
    <header><div><span className="orb-action-kicker">Acción propuesta</span><h3>{action.title}</h3></div>{status === "completed" ? <Check aria-hidden="true" size={19} /> : null}</header>
    {proposal.action_type === "create_project_task" ? <dl>
      <div><dt>Proyecto</dt><dd>{display.project_name || "Proyecto"}</dd></div>
      <div><dt>Tarea</dt><dd>{display.title}</dd></div>
      <div><dt>Responsable</dt><dd>{display.assignee_name || "Sin asignar"}</dd></div>
      <div><dt>Prioridad</dt><dd>{priorityLabels[display.priority] || display.priority}</dd></div>
      <div><dt>Inicio</dt><dd>{dateLabel(display.starts_at)}</dd></div>
      <div><dt>Vencimiento</dt><dd>{dateLabel(display.due_at)}</dd></div>
    </dl> : <><dl><div><dt>Proyecto</dt><dd>{display.project_name || "Proyecto"}</dd></div><div><dt>Tarea</dt><dd>{display.task_title || "Tarea"}</dd></div></dl><div className="orb-action-changes">{materialChanges.map((change) => <div key={change.field}><span>{change.label}</span><p><strong>{changeValue(change.field, change.current)}</strong><span aria-hidden="true">→</span><strong>{changeValue(change.field, change.target)}</strong></p></div>)}</div></>}
    {proposal.action_type === "create_project_task" && display.instructions ? <div className="orb-action-instructions"><button type="button" onClick={() => setExpanded((value) => !value)}>{expanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />} Instrucciones</button>{expanded ? <p>{display.instructions}</p> : null}</div> : null}
    {status === "proposed" ? <footer><button type="button" className="orb-action-secondary" disabled={Boolean(busy)} onClick={() => act("cancel", onCancel)}>{busy === "cancel" ? <LoaderCircle className="orb-spin" size={16} /> : <X size={16} />} Cancelar</button><button type="button" className="orb-action-primary" disabled={Boolean(busy)} onClick={() => act("confirm", onConfirm)}>{busy === "confirm" ? <LoaderCircle className="orb-spin" size={16} /> : <Check size={16} />} Confirmar</button></footer> : null}
    {status === "completed" ? <div className="orb-action-result"><span>✓ {action.completed}</span>{taskUrl ? <a href={taskUrl}>Ver tarea <ExternalLink size={14} /></a> : null}</div> : null}
    {status === "executing" ? <p className="orb-action-state"><LoaderCircle className="orb-spin" size={16} /> Confirmando la acción…</p> : null}
    {status === "cancelled" ? <p className="orb-action-state">Propuesta cancelada.</p> : null}
    {status === "expired" ? <p className="orb-action-state">Esta propuesta expiró. Pide a Orb una nueva.</p> : null}
    {status === "failed" ? <p className="orb-action-state">{safeErrors[proposal.safe_error_code] || safeErrors.ACTION_EXECUTION_FAILED}</p> : null}
  </section>;
}

import { useRef, useState } from "react";
import { ChevronDown, ExternalLink, FileText, Plus, Trash2, Upload } from "lucide-react";
import {
  createTaskEvidenceRequirement,
  deleteTaskEvidence,
  deleteTaskEvidenceRequirement,
  openTaskEvidence,
  submitTaskEvidenceFile,
  submitTaskEvidenceValue,
  updateTaskEvidenceRequirement,
} from "../../services/ProjectService";
import { blankEvidenceRequirement, evidenceTypeLabels } from "./taskEvidenceConfig";

const field = "min-w-0 rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-white outline-none focus:border-zinc-600";

export function EvidenceRequirementFields({ value, onChange, onRemove }) {
  return <div className="grid min-w-0 gap-2 rounded-xl border border-zinc-800 bg-zinc-950/60 p-3 sm:grid-cols-2">
    <input required maxLength={120} className={`${field} sm:col-span-2`} placeholder="Nombre del requisito" value={value.label} onChange={(event) => onChange({ ...value, label: event.target.value })} />
    <select className={field} value={value.evidence_type} onChange={(event) => onChange({ ...value, evidence_type: event.target.value })}>{Object.entries(evidenceTypeLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select>
    <label className="flex items-center gap-2 px-2 text-sm text-zinc-300"><input type="checkbox" checked={value.is_required} onChange={(event) => onChange({ ...value, is_required: event.target.checked, min_count: event.target.checked ? Math.max(1, value.min_count) : 0 })} /> Obligatorio</label>
    <label className="text-xs text-zinc-500">Mínimo<input type="number" min="0" max="20" disabled={!value.is_required} className={`${field} mt-1 w-full`} value={value.min_count} onChange={(event) => onChange({ ...value, min_count: Number(event.target.value) })} /></label>
    <label className="text-xs text-zinc-500">Máximo<input type="number" min="1" max="20" className={`${field} mt-1 w-full`} value={value.max_count} onChange={(event) => onChange({ ...value, max_count: Number(event.target.value) })} /></label>
    <textarea maxLength={1000} rows={2} className={`${field} resize-y sm:col-span-2`} placeholder="Descripción opcional" value={value.description} onChange={(event) => onChange({ ...value, description: event.target.value })} />
    {onRemove && <button type="button" onClick={onRemove} className="inline-flex items-center gap-2 text-xs text-zinc-500 hover:text-red-300"><Trash2 size={14} /> Quitar requisito</button>}
  </div>;
}

export default function TaskEvidencePanel({ task, projectId, organizationId, userId, canManage, onChange, reportError }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(blankEvidenceRequirement());
  const requirements = task.evidence_requirements || [];
  const submitted = requirements.reduce((sum, item) => sum + item.evidence.length, 0);
  const needed = requirements.reduce((sum, item) => sum + (item.is_required ? item.min_count : 0), 0);
  const complete = requirements.every((item) => !item.is_required || item.evidence.length >= item.min_count);

  async function act(operation) {
    try { reportError(""); await operation(); await onChange(); }
    catch (reason) { reportError(reason.message || "No se pudo completar la acción."); }
  }

  async function addRequirement(event) {
    event.preventDefault();
    if (!draft.label.trim()) return;
    await act(async () => { await createTaskEvidenceRequirement(task.id, { ...draft, position: requirements.length }, userId); setDraft(blankEvidenceRequirement()); });
  }

  return <div className="sm:col-start-2 sm:col-span-2">
    <button type="button" onClick={() => setOpen((value) => !value)} className="flex w-full min-w-0 items-center justify-between gap-3 rounded-lg bg-zinc-950/70 px-3 py-2 text-left text-xs">
      <span className="min-w-0 break-words text-zinc-400">Evidencias: <strong className={complete ? "text-emerald-300" : "text-amber-300"}>{submitted}/{needed || submitted} {complete ? "cumplidas" : "pendientes"}</strong></span>
      <ChevronDown size={15} className={`shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
    </button>
    {open && <div className="mt-2 space-y-3 rounded-xl border border-zinc-800 p-3">
      {!requirements.length && <p className="text-xs text-zinc-600">Esta tarea no exige evidencias.</p>}
      {requirements.map((requirement) => <Requirement key={requirement.id} requirement={requirement} task={task} projectId={projectId} organizationId={organizationId} userId={userId} canManage={canManage} onChange={onChange} reportError={reportError} />)}
      {canManage && task.status !== "completed" && <form onSubmit={addRequirement} className="space-y-2 border-t border-zinc-800 pt-3"><p className="text-xs font-medium text-zinc-300">Añadir requisito</p><EvidenceRequirementFields value={draft} onChange={setDraft} /><button className="inline-flex items-center gap-2 rounded-lg border border-zinc-700 px-3 py-2 text-xs text-white"><Plus size={14} /> Añadir</button></form>}
    </div>}
  </div>;
}

function Requirement({ requirement, task, projectId, organizationId, userId, canManage, onChange, reportError }) {
  const inputRef = useRef(null);
  const [value, setValue] = useState("");
  const [upload, setUpload] = useState(null);
  const [editing, setEditing] = useState(null);
  const atMax = requirement.evidence.length >= requirement.max_count;
  async function act(operation) { try { reportError(""); await operation(); await onChange(); } catch (reason) { reportError(reason.message || "No se pudo completar la evidencia."); } }
  async function sendValue(event) { event.preventDefault(); if (!value.trim()) return; await act(() => submitTaskEvidenceValue({ taskId: task.id, requirement, value, userId })); setValue(""); }
  async function sendFiles(event) {
    const files = Array.from(event.target.files || []).slice(0, Math.max(0, requirement.max_count - requirement.evidence.length)); event.target.value = "";
    for (const file of files) await act(() => submitTaskEvidenceFile({ projectId, organizationId, taskId: task.id, requirement, file, userId, onProgress: (progress, status) => setUpload({ name: file.name, progress, status }) }));
    setUpload(null);
  }
  const fileAccept = requirement.evidence_type === "image" ? ".jpg,.jpeg,.png,.webp" : requirement.evidence_type === "video" ? ".mp4,.webm" : ".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.csv,.txt";
  return <article className="min-w-0 rounded-xl border border-zinc-800 p-3">
    <div className="flex min-w-0 items-start justify-between gap-3"><div className="min-w-0"><p className="break-words text-sm font-medium text-white">{requirement.label} {requirement.is_required && <span className="text-amber-300">*</span>}</p><p className="mt-1 break-words text-xs text-zinc-500">{evidenceTypeLabels[requirement.evidence_type]} · {requirement.evidence.length}/{requirement.max_count}{requirement.description ? ` · ${requirement.description}` : ""}</p></div>{canManage && task.status !== "completed" && !requirement.evidence.length && <button type="button" aria-label="Eliminar requisito" onClick={() => act(() => deleteTaskEvidenceRequirement(requirement.id))} className="shrink-0 p-1 text-zinc-600 hover:text-red-300"><Trash2 size={14} /></button>}</div>
    <div className="mt-3 space-y-2">{requirement.evidence.map((evidence) => <div key={evidence.id} className="flex min-w-0 flex-wrap items-center gap-2 rounded-lg bg-zinc-950 px-3 py-2 text-xs"><FileText size={14} className="shrink-0 text-zinc-500" /><span className="min-w-0 flex-1 break-words text-zinc-300">{evidence.file_name || evidence.value_url || evidence.value_text}</span>{(evidence.storage_path || evidence.value_url) && <button type="button" onClick={() => act(() => openTaskEvidence(evidence))} className="p-1 text-zinc-400"><ExternalLink size={14} /></button>}{task.status !== "completed" && (canManage || evidence.submitted_by === userId) && <button type="button" onClick={() => act(() => deleteTaskEvidence(evidence))} className="p-1 text-zinc-600 hover:text-red-300"><Trash2 size={14} /></button>}</div>)}</div>
    {canManage && task.status !== "completed" && <div className="mt-3 border-t border-zinc-800 pt-2">{editing ? <form onSubmit={async (event) => { event.preventDefault(); await act(() => updateTaskEvidenceRequirement(requirement.id, { evidence_type: editing.evidence_type, label: editing.label.trim(), description: editing.description?.trim() || null, is_required: editing.is_required, min_count: editing.is_required ? Number(editing.min_count) : 0, max_count: Number(editing.max_count) })); setEditing(null); }} className="space-y-2"><EvidenceRequirementFields value={editing} onChange={setEditing} /><div className="flex gap-2"><button className="rounded-lg border border-zinc-700 px-3 py-2 text-xs text-white">Guardar cambios</button><button type="button" onClick={() => setEditing(null)} className="px-3 py-2 text-xs text-zinc-500">Cancelar</button></div></form> : <button type="button" onClick={() => setEditing({ ...requirement })} className="text-xs text-zinc-500 hover:text-white">Editar requisito</button>}</div>}
    {!atMax && task.status !== "completed" && <div className="mt-3">{["url", "text"].includes(requirement.evidence_type) ? <form onSubmit={sendValue} className="flex min-w-0 flex-col gap-2 sm:flex-row">{requirement.evidence_type === "text" ? <textarea required maxLength={5000} rows={2} className={`${field} min-w-0 flex-1 resize-y`} placeholder="Escribe la evidencia" value={value} onChange={(event) => setValue(event.target.value)} /> : <input required type="url" pattern="https://.*" maxLength={2000} className={`${field} min-w-0 flex-1`} placeholder="https://" value={value} onChange={(event) => setValue(event.target.value)} />}<button className="rounded-lg border border-zinc-700 px-3 py-2 text-xs text-white">Guardar</button></form> : <><input ref={inputRef} type="file" multiple className="hidden" accept={fileAccept} onChange={sendFiles} /><button type="button" onClick={() => inputRef.current?.click()} className="inline-flex items-center gap-2 rounded-lg border border-zinc-700 px-3 py-2 text-xs text-white"><Upload size={14} /> Subir evidencia</button>{upload && <p className="mt-2 text-xs text-zinc-500">{upload.name}: {upload.status} ({upload.progress}%)</p>}</>}</div>}
  </article>;
}

import { useState } from "react";
import Modal from "../../components/ui/Modal";
import Button from "../../components/ui/Button";

const initial = { name: "", description: "", division_id: "", client_id: "", owner_id: "", priority: "medium", status: "planned", starts_at: "", due_at: "" };
const fieldClass = "mt-2 w-full rounded-xl border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm text-white outline-none focus:border-zinc-600";

function dateValue(value) { return value ? new Date(value).toISOString().slice(0, 10) : ""; }

export default function ProjectModal({ open, project, divisions, clients, users, onClose, onSave }) {
  const [form, setForm] = useState(() => project ? { ...initial, ...project, division_id: project.division_id || "", client_id: project.client_id || "", owner_id: project.owner_id || "", starts_at: dateValue(project.starts_at), due_at: dateValue(project.due_at) } : { ...initial, division_id: divisions[0]?.id || "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  function set(name, value) { setForm((current) => ({ ...current, [name]: value })); }
  async function submit(event) {
    event.preventDefault();
    if (!form.name.trim() || !form.division_id) { setError("Nombre y división son obligatorios."); return; }
    if (form.starts_at && form.due_at && form.due_at < form.starts_at) { setError("La fecha límite no puede ser anterior al inicio."); return; }
    try { setSaving(true); setError(""); await onSave(form); onClose(); }
    catch (reason) { setError(reason.message || "No se pudo guardar el proyecto."); }
    finally { setSaving(false); }
  }

  return <Modal open={open} onClose={onClose} title={project ? "Editar proyecto" : "Nuevo proyecto"} subtitle="Información operativa conectada con clientes y divisiones." size="lg">
    <form onSubmit={submit} className="space-y-5">
      {error && <p className="rounded-xl border border-red-900/50 bg-red-950/20 p-3 text-sm text-red-300">{error}</p>}
      <label className="block text-sm text-zinc-400">Nombre<input className={fieldClass} value={form.name} onChange={(e) => set("name", e.target.value)} maxLength={160} /></label>
      <label className="block text-sm text-zinc-400">Descripción<textarea className={`${fieldClass} min-h-24 resize-y`} value={form.description || ""} onChange={(e) => set("description", e.target.value)} /></label>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="text-sm text-zinc-400">División<select className={fieldClass} value={form.division_id} onChange={(e) => set("division_id", e.target.value)}>{divisions.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label className="text-sm text-zinc-400">Cliente<select className={fieldClass} value={form.client_id} onChange={(e) => set("client_id", e.target.value)}><option value="">Sin cliente</option>{clients.map((item) => <option key={item.id} value={item.id}>{item.company_name}</option>)}</select></label>
        <label className="text-sm text-zinc-400">Responsable<select className={fieldClass} value={form.owner_id} onChange={(e) => set("owner_id", e.target.value)}><option value="">Sin asignar</option>{users.map((item) => <option key={item.id} value={item.id}>{item.first_name || "Usuario"}{item.title ? ` · ${item.title}` : ""}</option>)}</select></label>
        <label className="text-sm text-zinc-400">Prioridad<select className={fieldClass} value={form.priority} onChange={(e) => set("priority", e.target.value)}><option value="low">Baja</option><option value="medium">Media</option><option value="high">Alta</option><option value="urgent">Urgente</option></select></label>
        <label className="text-sm text-zinc-400">Estado<select className={fieldClass} value={form.status} onChange={(e) => set("status", e.target.value)}><option value="planned">Planificación</option><option value="active">Activo</option><option value="blocked">En pausa</option><option value="completed">Completado</option><option value="cancelled">Cancelado</option>{project && <option value="archived">Archivado</option>}</select></label>
        <label className="text-sm text-zinc-400">Fecha de inicio<input type="date" className={fieldClass} value={form.starts_at} onChange={(e) => set("starts_at", e.target.value)} /></label>
        <label className="text-sm text-zinc-400">Fecha límite<input type="date" className={fieldClass} value={form.due_at} onChange={(e) => set("due_at", e.target.value)} /></label>
      </div>
      {!project && <p className="rounded-xl border border-zinc-800 bg-zinc-950/70 p-3 text-sm text-zinc-500">Después de crear el proyecto podrás añadir tareas, requisitos y evidencias. El progreso se calculará automáticamente.</p>}
      <div className="flex flex-col-reverse gap-3 pt-2 sm:flex-row sm:justify-end"><Button type="button" variant="ghost" onClick={onClose}>Cancelar</Button><Button type="submit" loading={saving}>Guardar proyecto</Button></div>
    </form>
  </Modal>;
}

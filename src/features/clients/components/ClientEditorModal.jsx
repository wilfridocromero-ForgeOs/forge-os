import { useEffect, useState } from "react";
import { X } from "lucide-react";

import { createClient, updateClient } from "../../../services/ClientService";

const EMPTY = { company_name: "", contact_name: "", email: "", phone: "", website: "", industry: "", status: "lead" };
const STATUS_OPTIONS = [["lead", "Lead"], ["active", "Activo"], ["paused", "Pausado"], ["closed", "Cerrado"], ["archived", "Archivado"]];

export default function ClientEditorModal({ client, organizationId, userId, onClose, onSaved }) {
  const [form, setForm] = useState(() => ({ ...EMPTY, ...client }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const close = (event) => { if (event.key === "Escape" && !saving) onClose(); };
    document.addEventListener("keydown", close);
    return () => document.removeEventListener("keydown", close);
  }, [onClose, saving]);

  const set = (field) => (event) => setForm((current) => ({ ...current, [field]: event.target.value }));

  async function submit(event) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const saved = client
        ? await updateClient(client.id, organizationId, form)
        : await createClient({ ...form, organization_id: organizationId, owner_id: userId });
      onSaved(saved);
      onClose();
    } catch (reason) {
      setError(reason.message || "No se pudo guardar el cliente.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="client-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) onClose(); }}>
      <section className="client-modal" role="dialog" aria-modal="true" aria-labelledby="client-editor-title">
        <header><div><p>Expediente empresarial</p><h2 id="client-editor-title">{client ? "Editar cliente" : "Nuevo cliente"}</h2></div><button type="button" aria-label="Cerrar" onClick={onClose}><X size={19} /></button></header>
        <form onSubmit={submit}>
          <div className="client-form-grid">
            <Field label="Empresa"><input autoFocus required maxLength="160" value={form.company_name} onChange={set("company_name")} /></Field>
            <Field label="Estado"><select value={form.status} onChange={set("status")}>{STATUS_OPTIONS.filter(([value]) => client || value !== "archived").map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field>
            <Field label="Contacto principal"><input maxLength="160" value={form.contact_name || ""} onChange={set("contact_name")} /></Field>
            <Field label="Industria"><input maxLength="160" value={form.industry || ""} onChange={set("industry")} /></Field>
            <Field label="Correo"><input type="email" maxLength="254" value={form.email || ""} onChange={set("email")} /></Field>
            <Field label="Teléfono"><input type="tel" maxLength="60" value={form.phone || ""} onChange={set("phone")} /></Field>
            <Field label="Sitio web" wide><input type="url" maxLength="500" placeholder="https://" value={form.website || ""} onChange={set("website")} /></Field>
          </div>
          {error && <p className="client-form-error" role="alert">{error}</p>}
          <footer><button type="button" onClick={onClose}>Cancelar</button><button className="is-primary" disabled={saving || !form.company_name.trim()}>{saving ? "Guardando…" : "Guardar cliente"}</button></footer>
        </form>
      </section>
    </div>
  );
}

function Field({ label, wide = false, children }) {
  return <label className={wide ? "is-wide" : ""}><span>{label}</span>{children}</label>;
}

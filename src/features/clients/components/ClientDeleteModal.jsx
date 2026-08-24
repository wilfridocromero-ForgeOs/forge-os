import { useEffect, useState } from "react";
import { AlertTriangle, X } from "lucide-react";

import { deleteClientSafely, getClientDeletionEligibility } from "../../../services/ClientService";

export default function ClientDeleteModal({ client, onClose, onDeleted, onArchive }) {
  const [state, setState] = useState({ loading: true, eligibility: null, error: "" });
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    let active = true;
    getClientDeletionEligibility(client.id)
      .then((eligibility) => active && setState({ loading: false, eligibility, error: "" }))
      .catch(() => active && setState({ loading: false, eligibility: null, error: "La protección backend de Clientes V2 está pendiente de aplicar. No se realizará ninguna eliminación." }));
    return () => { active = false; };
  }, [client.id]);

  useEffect(() => {
    const close = (event) => { if (event.key === "Escape" && !deleting) onClose(); };
    document.addEventListener("keydown", close);
    return () => document.removeEventListener("keydown", close);
  }, [deleting, onClose]);

  async function remove() {
    setDeleting(true);
    try {
      await deleteClientSafely(client.id);
      onDeleted(client);
      onClose();
    } catch (reason) {
      setState((current) => ({ ...current, error: reason.message || "No se pudo eliminar el cliente." }));
      setDeleting(false);
    }
  }

  const blocked = state.eligibility && !state.eligibility.can_delete;
  return (
    <div className="client-modal-backdrop" role="presentation">
      <section className="client-modal client-delete-modal" role="alertdialog" aria-modal="true" aria-labelledby="delete-client-title">
        <header><div><p>Acción permanente</p><h2 id="delete-client-title">¿Eliminar {client.company_name}?</h2></div><button type="button" aria-label="Cerrar" onClick={onClose}><X size={19} /></button></header>
        <div className="client-delete-body"><AlertTriangle size={22} /><div>{state.loading ? <p>Comprobando historial relacionado…</p> : blocked ? <><strong>No se puede eliminar este cliente.</strong><p>Contiene historial empresarial relacionado. Archívalo para conservar Discovery, proyectos, notas y acceso al portal.</p></> : state.eligibility ? <><strong>Este cliente no tiene historial relacionado.</strong><p>La eliminación será permanente y no se puede deshacer.</p></> : <p>{state.error}</p>}</div></div>
        {state.error && state.eligibility && <p className="client-form-error">{state.error}</p>}
        <footer><button type="button" onClick={onClose}>Cancelar</button>{blocked && client.status !== "archived" && <button type="button" className="is-primary" onClick={() => { onArchive(client); onClose(); }}>Archivar cliente</button>}{state.eligibility?.can_delete && <button type="button" className="is-danger" disabled={deleting} onClick={remove}>{deleting ? "Eliminando…" : "Eliminar permanentemente"}</button>}</footer>
      </section>
    </div>
  );
}

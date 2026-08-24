import { useEffect, useRef, useState } from "react";
import { Archive, ExternalLink, MoreHorizontal, Pencil, RotateCcw, Trash2 } from "lucide-react";

export default function ClientActionsMenu({ client, canManage, onOpen, onEdit, onArchive, onRestore, onDelete }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const triggerRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const closeOutside = (event) => { if (!rootRef.current?.contains(event.target)) setOpen(false); };
    const closeEscape = (event) => { if (event.key === "Escape") { setOpen(false); triggerRef.current?.focus(); } };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("keydown", closeEscape);
    };
  }, [open]);

  function run(action) {
    setOpen(false);
    action?.(client);
  }

  return (
    <div ref={rootRef} className="client-actions" onClick={(event) => event.stopPropagation()}>
      <button ref={triggerRef} type="button" className="client-actions-trigger" aria-label={`Acciones de ${client.company_name}`} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        <MoreHorizontal size={18} />
      </button>
      {open && (
        <div className="client-actions-menu" role="menu">
          {onOpen && <Action icon={ExternalLink} label="Abrir cliente" onClick={() => run(onOpen)} />}
          {canManage && <Action icon={Pencil} label="Editar" onClick={() => run(onEdit)} />}
          {canManage && client.status !== "archived" && <Action icon={Archive} label="Archivar" onClick={() => run(onArchive)} />}
          {canManage && client.status === "archived" && <Action icon={RotateCcw} label="Restaurar" onClick={() => run(onRestore)} />}
          {canManage && <div className="client-actions-separator" />}
          {canManage && <Action icon={Trash2} label="Eliminar cliente" danger onClick={() => run(onDelete)} />}
        </div>
      )}
    </div>
  );
}

function Action({ icon: Icon, label, danger = false, onClick }) {
  return <button type="button" role="menuitem" className={danger ? "is-danger" : ""} onClick={onClick}><Icon size={15} />{label}</button>;
}

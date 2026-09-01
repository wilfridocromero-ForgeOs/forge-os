import { useMemo, useState } from "react";
import { Archive, ArrowRight, FileText, FormInput, Pencil, Plus } from "lucide-react";
import { Link } from "react-router-dom";
import { BUILDER_ASSET_TYPES, builderAssetRoute, latestBuilderAssetVersion } from "../model/builderAssets";
import "../BuilderAssets.css";

export default function BuilderAssetLibrary({ assets, onCreate, onRename, onArchive }) {
  const [filter, setFilter] = useState("all");
  const [showArchived, setShowArchived] = useState(false);
  const [creating, setCreating] = useState(false);
  const [renaming, setRenaming] = useState(null);
  const filtered = useMemo(() => assets.filter((asset) => (
    (filter === "all" || asset.asset_type === filter) && (showArchived || asset.lifecycle !== "archived")
  )), [assets, filter, showArchived]);

  async function create(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      await onCreate(form.get("name"), form.get("assetType"));
      setCreating(false);
    } catch { /* Parent surface owns the visible error state. */ }
  }

  async function rename(event, asset) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      await onRename(asset, form.get("name"));
      setRenaming(null);
    } catch { /* Keep the editor open so the user can correct the value. */ }
  }

  return <section className="builder-assets-section">
    <div className="builder-section-head"><div><span>Assets</span><h2>Páginas y formularios</h2><p>Objetos reutilizables que participan en tus sistemas.</p></div><button className="builder-primary" onClick={() => setCreating(true)}><Plus size={16}/> Nuevo asset</button></div>
    <div className="builder-assets-toolbar" aria-label="Filtros de assets">
      {[['all', 'Todos'], ['landing_page', 'Páginas'], ['form', 'Formularios']].map(([value, label]) => <button key={value} className={filter === value ? "is-active" : ""} onClick={() => setFilter(value)}>{label}</button>)}
      <label><input type="checkbox" checked={showArchived} onChange={(event) => setShowArchived(event.target.checked)}/> Ver archivados</label>
    </div>
    {!filtered.length ? <div className="builder-assets-empty"><FileText size={24}/><strong>No hay assets en esta vista</strong><p>Crea una página o formulario sin construir todavía su contenido visual.</p></div> : <div className="builder-asset-grid">{filtered.map((asset) => {
      const TypeIcon = asset.asset_type === "form" ? FormInput : FileText;
      const latest = latestBuilderAssetVersion(asset.builder_asset_versions);
      return <article key={asset.id} className={asset.lifecycle === "archived" ? "is-archived" : ""}>
        <div className="builder-asset-card-head"><TypeIcon size={19}/><span className={`builder-status ${asset.lifecycle}`}>{asset.lifecycle === "archived" ? "Archivado" : "Borrador"}</span></div>
        {renaming === asset.id ? <form className="builder-asset-rename" onSubmit={(event) => rename(event, asset)}><input name="name" defaultValue={asset.name} required maxLength={120} autoFocus/><button>Guardar</button><button type="button" onClick={() => setRenaming(null)}>Cancelar</button></form> : <><h3>{asset.name}</h3><p>{BUILDER_ASSET_TYPES[asset.asset_type].label} · Versión {latest?.version_number || 1}</p></>}
        <footer><Link to={builderAssetRoute(asset)}>Abrir <ArrowRight size={14}/></Link>{asset.lifecycle !== "archived" && <div><button aria-label={`Renombrar ${asset.name}`} onClick={() => setRenaming(asset.id)}><Pencil size={14}/></button><button aria-label={`Archivar ${asset.name}`} onClick={() => onArchive(asset)}><Archive size={14}/></button></div>}</footer>
      </article>;
    })}</div>}
    {creating && <div className="builder-modal-backdrop"><form className="builder-modal" onSubmit={create}><span>Nuevo asset</span><h2>Crea una identidad reutilizable</h2><label>Tipo<select name="assetType" defaultValue="landing_page"><option value="landing_page">Página</option><option value="form">Formulario</option></select></label><label>Nombre<input name="name" required maxLength={120} autoFocus/></label><p className="builder-modal-note">El contenido visual se construirá en una fase posterior.</p><div><button type="button" onClick={() => setCreating(false)}>Cancelar</button><button className="builder-primary">Crear asset</button></div></form></div>}
  </section>;
}

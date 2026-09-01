import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Boxes, FileText, FormInput, Pencil } from "lucide-react";
import { Link, useParams } from "react-router-dom";
import Page from "../../../components/ui/Page";
import { BUILDER_ASSET_TYPES, isBuilderAssetType, latestBuilderAssetVersion } from "../model/builderAssets";
import { loadBuilderAsset, updateBuilderAsset } from "../services/BuilderAssetService";
import LandingPageEditor from "../editor/LandingPageEditor";
import "../Builder.css";
import "../BuilderAssets.css";

export default function BuilderAssetWorkspace() {
  const { assetType, assetId } = useParams();
  const [model, setModel] = useState(null);
  const [renaming, setRenaming] = useState(false);
  const [error, setError] = useState("");
  const routeError = isBuilderAssetType(assetType) ? "" : "El tipo de asset no existe.";

  useEffect(() => {
    if (!isBuilderAssetType(assetType)) return;
    loadBuilderAsset(assetId).then((value) => {
      if (value.asset.asset_type !== assetType) throw new Error("La ruta no coincide con el tipo real del asset.");
      setModel(value);
    }).catch((value) => setError(value.message));
  }, [assetId, assetType]);

  const latest = useMemo(() => latestBuilderAssetVersion(model?.versions), [model]);

  async function rename(event) {
    event.preventDefault();
    try {
      const name = new FormData(event.currentTarget).get("name");
      const asset = await updateBuilderAsset(model.asset, { name: name.trim() });
      setModel((current) => ({ ...current, asset })); setRenaming(false);
    } catch (value) { setError(value.message); }
  }

  if (!model) return <div className="builder-loading">{routeError || error || "Cargando asset…"}</div>;
  if (model.asset.asset_type === "landing_page") return <LandingPageEditor asset={model.asset}/>;
  const TypeIcon = model.asset.asset_type === "form" ? FormInput : FileText;

  return <Page className="builder-page builder-asset-workspace">
    <header className="builder-asset-workspace-head"><Link to="/construir" aria-label="Volver a Builder"><ArrowLeft/></Link><div><span>BUILDER · {BUILDER_ASSET_TYPES[model.asset.asset_type].label.toUpperCase()}</span>{renaming ? <form onSubmit={rename}><input name="name" defaultValue={model.asset.name} required maxLength={120} autoFocus/><button>Guardar</button><button type="button" onClick={() => setRenaming(false)}>Cancelar</button></form> : <div className="builder-asset-title"><h1>{model.asset.name}</h1><button onClick={() => setRenaming(true)} aria-label="Renombrar asset"><Pencil size={15}/></button></div>}<p>Identidad estable y versionada dentro de ORVESEN Builder.</p></div><span className={`builder-status ${model.asset.lifecycle}`}>{model.asset.lifecycle === "archived" ? "Archivado" : "Borrador"}</span></header>
    {error && <p className="builder-error" role="alert">{error}</p>}
    <div className="builder-asset-overview"><section><TypeIcon size={22}/><span>Estado del contenido</span><h2>Editor visual pendiente</h2><p>Este asset ya tiene identidad y versionado canónico. La edición por bloques llegará en la siguiente fase.</p></section><section><Boxes size={22}/><span>Versión actual</span><h2>Versión {latest?.version_number || 1}</h2><p>Schema {latest?.schema_version || 1} · {latest?.state === "draft" ? "Borrador editable" : latest?.state}</p></section></div>
    <section className="builder-asset-usage"><div className="builder-section-head"><div><span>Uso</span><h2>Dónde participa</h2></div><b>{model.usages.length}</b></div>{!model.usages.length ? <div className="builder-assets-empty"><Boxes size={22}/><strong>Aún no está vinculado</strong><p>Puedes asociarlo desde un nodo compatible del canvas.</p></div> : <div>{model.usages.map((usage) => <Link key={usage.id} to={`/construir/sistemas/${usage.system_id}?node=${usage.id}&asset=${model.asset.id}`}><div><strong>{usage.system?.name || "Sistema"}</strong><small>{usage.label}</small></div><span>Abrir sistema</span></Link>)}</div>}</section>
  </Page>;
}

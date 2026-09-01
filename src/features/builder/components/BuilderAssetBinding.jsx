import { useEffect, useMemo, useState } from "react";
import { ArrowUpRight, Link2Off, Plus } from "lucide-react";
import { Link } from "react-router-dom";
import { builderAssetRoute, isAssetCompatibleWithNode } from "../model/builderAssets";
import { createBuilderAsset, listBuilderAssets } from "../services/BuilderAssetService";
import { updateGrowthNode } from "../services/BuilderService";
import "../BuilderAssets.css";

export default function BuilderAssetBinding({ node, onNodeUpdated, onError }) {
  const [assets, setAssets] = useState([]);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    listBuilderAssets({ assetType: node.node_type, includeArchived: true })
      .then((items) => { if (active) setAssets(items); })
      .catch(onError);
    return () => { active = false; };
  }, [node.node_type, onError]);

  const selectedAsset = useMemo(() => assets.find((asset) => asset.id === node.asset_id) || null, [assets, node.asset_id]);

  async function bind(assetId) {
    setBusy(true);
    try {
      const asset = assets.find((item) => item.id === assetId);
      if (assetId && !isAssetCompatibleWithNode(asset, node)) throw new Error("El asset no es compatible con este paso.");
      const saved = await updateGrowthNode(node, { asset_id: assetId || null });
      onNodeUpdated(saved);
    } catch (error) { onError(error); } finally { setBusy(false); }
  }

  async function create(event) {
    event.preventDefault(); setBusy(true);
    try {
      const name = new FormData(event.currentTarget).get("name");
      const result = await createBuilderAsset(name, node.node_type, node.id);
      setAssets((current) => [result.asset, ...current]);
      onNodeUpdated(result.node);
      setCreating(false);
    } catch (error) { onError(error); } finally { setBusy(false); }
  }

  return <section className="builder-asset-binding">
    <span>Asset</span>
    <label>Objeto asociado<select value={node.asset_id || ""} disabled={busy} onChange={(event) => bind(event.target.value)}><option value="">Sin asset</option>{assets.map((asset) => <option key={asset.id} value={asset.id} disabled={asset.lifecycle === "archived"}>{asset.name}{asset.lifecycle === "archived" ? " · Archivado" : ""}</option>)}</select></label>
    {selectedAsset && <div className="builder-binding-actions"><Link to={builderAssetRoute(selectedAsset)}>Abrir asset <ArrowUpRight size={14}/></Link><button onClick={() => bind("")} disabled={busy}><Link2Off size={14}/> Desvincular</button></div>}
    {!creating ? <button className="builder-create-linked" onClick={() => setCreating(true)} disabled={busy}><Plus size={14}/> Crear {node.node_type === "form" ? "formulario" : "página"}</button> : <form className="builder-create-linked-form" onSubmit={create}><input name="name" required maxLength={120} autoFocus placeholder="Nombre del asset"/><div><button type="button" onClick={() => setCreating(false)}>Cancelar</button><button disabled={busy}>Crear y vincular</button></div></form>}
  </section>;
}

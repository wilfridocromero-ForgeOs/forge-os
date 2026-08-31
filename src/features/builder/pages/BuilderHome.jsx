import { useEffect, useState } from "react";
import { ArrowRight, Archive, Plus, Route } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import Page from "../../../components/ui/Page";
import { builderEntries } from "../../../config/navigation";
import { createGrowthSystem, listGrowthSystems, updateGrowthSystem } from "../services/BuilderService";
import "../Builder.css";
export default function BuilderHome() {
  const navigate = useNavigate(); const [systems, setSystems] = useState([]); const [creating, setCreating] = useState(false); const [error, setError] = useState("");
  useEffect(() => { listGrowthSystems().then(setSystems).catch((value) => setError(value.message)); }, []);
  async function create(event) { event.preventDefault(); const form = new FormData(event.currentTarget); setError(""); try { const system = await createGrowthSystem(form.get("name"), form.get("objective")); navigate(`/construir/sistemas/${system.id}`); } catch (value) { setError(value.message); } }
  async function archive(id) { await updateGrowthSystem(id, { lifecycle: "archived", archived_at: new Date().toISOString() }); setSystems((current) => current.map((item) => item.id === id ? { ...item, lifecycle: "archived" } : item)); }
  const active = systems.filter((system) => system.lifecycle !== "archived");
  return <Page className="builder-page"><header className="builder-home-hero"><div><span>BUILDER</span><h1>Planifica. Construye. Automatiza. Crece.</h1><p>Diseña cómo tu organización atrae demanda y la convierte en oportunidades reales.</p></div><button className="builder-primary" onClick={() => setCreating(true)}><Plus size={17}/> Nuevo sistema</button></header>
    {error && <p className="builder-error" role="alert">{error}</p>}
    {creating && <div className="builder-modal-backdrop"><form className="builder-modal" onSubmit={create}><span>Nuevo sistema</span><h2>Define el punto de partida</h2><label>Nombre<input name="name" required maxLength={120} autoFocus /></label><label>Objetivo<textarea name="objective" required maxLength={600}/></label><div><button type="button" onClick={() => setCreating(false)}>Cancelar</button><button className="builder-primary">Crear sistema</button></div></form></div>}
    <section className="builder-section"><div className="builder-section-head"><div><span>Sistemas</span><h2>Sistemas de crecimiento</h2></div><b>{active.length}</b></div>
      {!active.length ? <div className="builder-empty"><Route size={28}/><h3>Diseña tu primer sistema</h3><p>Conecta tráfico, captación y entrega de leads en un flujo empresarial claro.</p><button className="builder-primary" onClick={() => setCreating(true)}>Nuevo sistema</button></div> : <div className="builder-system-grid">{active.map((system) => <article key={system.id}><div><span className={`builder-status ${system.lifecycle}`}>{system.lifecycle === "ready" ? "Listo" : "Borrador"}</span><h3>{system.name}</h3><p>{system.objective}</p></div><footer><Link to={`/construir/sistemas/${system.id}`}>Abrir sistema <ArrowRight size={15}/></Link><button aria-label={`Archivar ${system.name}`} onClick={() => archive(system.id)}><Archive size={15}/></button></footer></article>)}</div>}
    </section>
    <section className="builder-tools"><span>Herramientas administrativas</span><div>{builderEntries.map((entry) => <Link key={entry.to} to={entry.to}><entry.icon size={20}/><div><strong>{entry.label}</strong><small>{entry.description}</small></div><ArrowRight size={16}/></Link>)}</div></section>
  </Page>;
}

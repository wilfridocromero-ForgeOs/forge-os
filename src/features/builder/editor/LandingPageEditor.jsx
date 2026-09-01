import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { ArrowDown, ArrowLeft, ArrowUp, Copy, FilePlus2, Layers3, Monitor, Plus, Redo2, Smartphone, Tablet, Trash2, Undo2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import LandingRenderer from "../renderer/LandingRenderer.jsx";
import "../renderer/LandingRenderer.css";
import { validateLandingDocument } from "../document/landingDocument.js";
import { applyLandingOperations } from "../document/landingOperations.js";
import { createCtaPattern, createHeroPattern, createLeadCapturePattern } from "../document/landingPatterns.js";
import { listBuilderAssets, loadBuilderAssetDraft, saveBuilderAssetDraft } from "../services/BuilderAssetService.js";
import { createLandingAutosave } from "./landingAutosave.js";
import { duplicateEditorSelection, findEditorSelection, landingEditorReducer, moveEditorSelection } from "./landingEditorState.js";
import "./LandingEditor.css";

const BLOCKS = [{ type: "heading", label: "Heading" }, { type: "text", label: "Text" }, { type: "image", label: "Image" }, { type: "action_group", label: "Actions" }, { type: "form_reference", label: "Form" }];
const PREVIEWS = [{ id: "desktop", label: "Desktop", Icon: Monitor }, { id: "tablet", label: "Tablet", Icon: Tablet }, { id: "mobile", label: "Mobile", Icon: Smartphone }];
const newSection = () => ({ id: crypto.randomUUID(), layout: "stack", regions: [{ id: crypto.randomUUID(), span: 12, blocks: [] }] });

function saveLabel(status) { return ({ saved: "Guardado", saving: "Guardando…", unsaved: "Sin guardar", conflict: "Conflicto", error: "Error" })[status] || status; }

export default function LandingPageEditor({ asset }) {
  const navigate = useNavigate();
  const [state, dispatch] = useReducer(landingEditorReducer, null);
  const [status, setStatus] = useState("saved");
  const [error, setError] = useState("");
  const [forms, setForms] = useState([]);
  const [localConflictDocument, setLocalConflictDocument] = useState(null);
  const autosaveRef = useRef(null); const saveDelayRef = useRef(600); const stateRef = useRef(null); const dragRef = useRef(null);

  useEffect(() => {
    let active = true;
    Promise.all([loadBuilderAssetDraft(asset.id), listBuilderAssets({ assetType: "form", includeArchived: false })]).then(([draft, formAssets]) => {
      if (!active) return;
      dispatch({ type: "remote", draft }); setForms(formAssets);
      autosaveRef.current = createLandingAutosave({
        save: ({ expectedRevision, document }) => saveBuilderAssetDraft({ assetId: asset.id, expectedRevision, document }),
        onStatus: setStatus,
        onSaved: (revision, document) => dispatch({ type: "saved", revision, document }),
        onConflict: () => setLocalConflictDocument(stateRef.current?.document || null),
        onError: (value) => setError(value.message || "No se pudo guardar el borrador."),
      });
      autosaveRef.current.initialize(draft.revision);
    }).catch((value) => setError(value.message || "No se pudo cargar el borrador."));
    return () => { active = false; autosaveRef.current?.dispose(); };
  }, [asset.id]);

  useEffect(() => { stateRef.current = state; if (state?.dirty) autosaveRef.current?.schedule(state.document, saveDelayRef.current); }, [state]);
  useEffect(() => {
    const beforeUnload = (event) => { if (stateRef.current?.dirty || status === "saving") { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("beforeunload", beforeUnload); return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [status]);
  useEffect(() => {
    const keys = (event) => {
      if (!(event.ctrlKey || event.metaKey)) return;
      if (event.key.toLowerCase() === "z") { event.preventDefault(); dispatch({ type: event.shiftKey ? "redo" : "undo" }); }
      if (event.key.toLowerCase() === "y") { event.preventDefault(); dispatch({ type: "redo" }); }
    };
    window.addEventListener("keydown", keys); return () => window.removeEventListener("keydown", keys);
  }, []);

  const apply = useCallback((operation, group = null, delay = 220) => { saveDelayRef.current = delay; dispatch({ type: "operation", operation, group }); }, []);
  const replace = useCallback((document, group = null, delay = 220) => { saveDelayRef.current = delay; dispatch({ type: "replace", document, group }); }, []);
  const selected = useMemo(() => state ? findEditorSelection(state.document, state.selection) : null, [state]);
  const selectedRegion = selected?.region || (state?.selection?.kind === "section" ? selected?.regions?.[0] : null) || state?.document.sections.at(-1)?.regions?.[0];

  function addBlock(type) {
    const blockId = crypto.randomUUID();
    if (!selectedRegion) { const section = newSection(); replace(applyLandingOperations(state.document, [{ type: "add_section", section }, { type: "add_block", region_id: section.regions[0].id, block_type: type, block_id: blockId }]), "insert"); }
    else apply({ type: "add_block", region_id: selectedRegion.id, block_type: type, block_id: blockId }, "insert");
    dispatch({ type: "select", selection: { kind: "block", id: blockId } });
  }
  function addPattern(factory) { const section = factory(); apply({ type: "add_section", section }, "pattern"); dispatch({ type: "select", selection: { kind: "section", id: section.id } }); }
  function removeSelected() { if (!state.selection) return; apply({ type: state.selection.kind === "section" ? "remove_section" : "remove_block", [`${state.selection.kind}_id`]: state.selection.id }, "remove"); dispatch({ type: "select", selection: null }); }
  function moveSelected(delta) { replace(moveEditorSelection(state.document, state.selection, delta), "move"); }
  function duplicateSelected() { replace(duplicateEditorSelection(state.document, state.selection), "duplicate"); }
  async function leave() { await autosaveRef.current?.flush(); navigate("/construir"); }
  async function reloadRemote() { const draft = await loadBuilderAssetDraft(asset.id); autosaveRef.current.reset(draft.revision); dispatch({ type: "remote", draft }); setLocalConflictDocument(null); setError(""); }

  function canvasClick(event) {
    event.preventDefault();
    const block = event.target.closest("[data-block-id]"); const section = event.target.closest("[data-section-id]");
    dispatch({ type: "select", selection: block ? { kind: "block", id: block.dataset.blockId } : section ? { kind: "section", id: section.dataset.sectionId } : null });
  }
  function dragStart(event) {
    const block = event.target.closest("[data-block-id]"); const section = event.target.closest("[data-section-id]");
    dragRef.current = block ? { kind: "block", id: block.dataset.blockId } : section ? { kind: "section", id: section.dataset.sectionId } : null;
    if (dragRef.current) event.dataTransfer.effectAllowed = "move";
  }
  function drop(event) {
    event.preventDefault(); const dragged = dragRef.current; dragRef.current = null; if (!dragged) return;
    if (dragged.kind === "section") { const target = event.target.closest("[data-section-id]")?.dataset.sectionId; if (!target || target === dragged.id) return; const next = structuredClone(state.document); const from = next.sections.findIndex((item) => item.id === dragged.id); const to = next.sections.findIndex((item) => item.id === target); const [item] = next.sections.splice(from, 1); next.sections.splice(to, 0, item); replace(next, "drag"); return; }
    const targetBlockId = event.target.closest("[data-block-id]")?.dataset.blockId; const targetRegionId = event.target.closest("[data-region-id]")?.dataset.regionId; if (!targetRegionId) return;
    const region = state.document.sections.flatMap((section) => section.regions).find((item) => item.id === targetRegionId); const index = targetBlockId ? region.blocks.findIndex((item) => item.id === targetBlockId) : region.blocks.length;
    apply({ type: "move_block", block_id: dragged.id, target_region_id: targetRegionId, index }, "drag");
  }

  if (error && !state) return <div className="landing-editor-state"><strong>No se pudo abrir la Landing</strong><p>{error}</p><button onClick={() => navigate("/construir")}>Volver a Builder</button></div>;
  if (!state) return <div className="landing-editor-state">Cargando borrador…</div>;
  if (asset.lifecycle === "archived") return <div className="landing-editor-state"><strong>Landing archivada</strong><p>Este asset no puede editarse.</p><button onClick={() => navigate("/construir")}>Volver</button></div>;
  const validation = validateLandingDocument(state.document);

  return <div className="landing-editor">
    <header className="landing-editor-bar"><button onClick={leave} aria-label="Volver a Builder"><ArrowLeft/></button><div className="landing-editor-identity"><span>BUILDER · LANDING</span><strong>{asset.name}</strong><small>Borrador</small></div><div className="landing-editor-history"><button onClick={() => dispatch({ type: "undo" })} disabled={!state.past.length} aria-label="Deshacer"><Undo2/></button><button onClick={() => dispatch({ type: "redo" })} disabled={!state.future.length} aria-label="Rehacer"><Redo2/></button></div><div className="landing-preview-switch" aria-label="Vista responsive">{PREVIEWS.map(({ id, label, Icon }) => <button key={id} className={state.preview === id ? "is-active" : ""} onClick={() => dispatch({ type: "preview", preview: id })} aria-pressed={state.preview === id}><Icon/><span>{label}</span></button>)}</div><span className={`landing-save ${status}`}>{saveLabel(status)}</span></header>
    {(error || status === "conflict") && <div className="landing-editor-alert" role="alert"><span>{status === "conflict" ? "Esta página cambió en otra sesión." : error}</span>{status === "conflict" ? <><button onClick={reloadRemote}>Recargar versión remota</button><button onClick={() => navigator.clipboard?.writeText(JSON.stringify(localConflictDocument, null, 2))}>Copiar cambios locales</button></> : status === "error" && <button onClick={() => autosaveRef.current?.retry()}>Reintentar guardado</button>}</div>}
    <div className={`landing-editor-body ${state.selection ? "has-inspector" : ""}`}>
      <aside className="landing-palette"><span>AÑADIR</span><h2>Blocks</h2>{BLOCKS.map((item) => <button key={item.type} onClick={() => addBlock(item.type)}><Plus/>{item.label}</button>)}<h2>Patterns</h2><button onClick={() => addPattern(createHeroPattern)}><FilePlus2/>Hero</button><button onClick={() => addPattern(createCtaPattern)}><FilePlus2/>CTA</button><button onClick={() => addPattern(() => createLeadCapturePattern(forms[0]?.id || null))}><FilePlus2/>Lead Capture</button><DesignControls document={state.document} replace={replace}/></aside>
      <main className="landing-canvas-shell"><div className={`landing-page-frame landing-preview-${state.preview}`} onClick={canvasClick} onDragStart={dragStart} onDragOver={(event) => event.preventDefault()} onDrop={drop}>{!state.document.sections.length ? <div className="landing-empty"><Layers3/><h2>Comienza tu página</h2><p>Añade una estructura clara y conviértela en una experiencia real.</p><div><button onClick={(event) => { event.stopPropagation(); addPattern(createHeroPattern); }}>Añadir Hero</button><button onClick={(event) => { event.stopPropagation(); apply({ type: "add_section", section: newSection() }, "insert"); }}>Añadir sección</button></div></div> : <LandingRenderer document={state.document} editorMode selection={state.selection} resolveForm={(id, label) => <div className="landing-form-preview"><strong>{label}</strong><span>{forms.find((form) => form.id === id)?.name || "Formulario sin asignar"}</span></div>}/>}</div><output className="landing-editor-announcement" aria-live="polite">{validation.valid ? "Documento válido" : `${validation.errors.length} errores de documento`}</output></main>
      {state.selection && <Inspector selection={state.selection} selected={selected} forms={forms} apply={apply} onDelete={removeSelected} onDuplicate={duplicateSelected} onMove={moveSelected} onClose={() => dispatch({ type: "select", selection: null })}/>} 
    </div>
  </div>;
}

function DesignControls({ document, replace }) {
  const design = document.settings.design_system;
  const update = (category, key, value) => { const next = structuredClone(document); next.settings.design_system[category][key] = value; replace(next, `design-${category}-${key}`, 600); };
  return <div className="landing-design"><h2>Page style</h2><label>Fondo<input type="color" value={design.colors.page_background || "#ffffff"} onChange={(event) => update("colors", "page_background", event.target.value)}/></label><label>Texto<input type="color" value={design.colors.text || "#151515"} onChange={(event) => update("colors", "text", event.target.value)}/></label><label>Acento<input type="color" value={design.colors.primary || "#9b7618"} onChange={(event) => update("colors", "primary", event.target.value)}/></label><label>Ancho<select value={design.content_widths.standard || "1120px"} onChange={(event) => update("content_widths", "standard", event.target.value)}><option value="960px">Compacto</option><option value="1120px">Estándar</option><option value="1280px">Amplio</option></select></label></div>;
}

function Inspector({ selection, selected, forms, apply, onDelete, onDuplicate, onMove, onClose }) {
  if (!selected) return null;
  const block = selection.kind === "block" ? selected.block : null; const section = selection.kind === "section" ? selected : selected.section;
  const content = block?.content;
  const updateContent = (changes) => apply({ type: "update_block_content", block_id: block.id, changes }, `content-${block.id}`, 600);
  const updateStyle = (changes) => apply({ type: "update_block_style", block_id: block.id, changes }, `style-${block.id}`, 600);
  function changeLayout(layout) { const regions = layout === "stack" ? [{ ...section.regions[0], span: 12, blocks: section.regions.flatMap((region) => region.blocks) }] : section.regions.length > 1 ? section.regions.map((region) => ({ ...region, span: 6 })) : [{ ...section.regions[0], span: 6 }, { id: crypto.randomUUID(), span: 6, blocks: [] }]; apply({ type: "update_section", section_id: section.id, changes: { layout, regions } }, "section-layout"); }
  return <aside className="landing-inspector"><header><div><span>PROPIEDADES</span><strong>{block ? block.type.replace("_", " ") : "Section"}</strong></div><button onClick={onClose} aria-label="Cerrar propiedades">×</button></header>
    {block?.type === "heading" && <><label>Texto<textarea value={content.text} onChange={(event) => updateContent({ text: event.target.value })}/></label><label>Nivel<select value={content.level} onChange={(event) => updateContent({ level: Number(event.target.value) })}>{[1,2,3,4,5,6].map((level) => <option key={level} value={level}>H{level}</option>)}</select></label></>}
    {block?.type === "text" && <label>Contenido<textarea value={content.text} onChange={(event) => updateContent({ text: event.target.value })}/></label>}
    {block?.type === "image" && <><label>Origen<select value={content.source.kind} onChange={(event) => updateContent({ source: event.target.value === "external" ? { kind: "external", url: "https://example.com/image.jpg" } : { kind: "placeholder" } })}><option value="placeholder">Placeholder</option><option value="external">HTTPS externo</option></select></label>{content.source.kind === "external" && <label>URL<input value={content.source.url} onChange={(event) => updateContent({ source: { kind: "external", url: event.target.value } })}/></label>}<label><input type="checkbox" checked={content.decorative} onChange={(event) => updateContent({ decorative: event.target.checked })}/> Decorativa</label>{!content.decorative && <label>Texto alternativo<input value={content.alt} onChange={(event) => updateContent({ alt: event.target.value })}/></label>}</>}
    {block?.type === "action_group" && <><label>Etiqueta<input value={content.actions[0].label} onChange={(event) => updateContent({ actions: [{ ...content.actions[0], label: event.target.value }] })}/></label><label>URL<input value={content.actions[0].href} onChange={(event) => updateContent({ actions: [{ ...content.actions[0], href: event.target.value }] })}/></label><label>Estilo<select value={content.actions[0].variant} onChange={(event) => updateContent({ actions: [{ ...content.actions[0], variant: event.target.value }] })}><option value="primary">Primary</option><option value="secondary">Secondary</option></select></label></>}
    {block?.type === "form_reference" && <><label>Formulario<select value={content.asset_id || ""} onChange={(event) => updateContent({ asset_id: event.target.value || null })}><option value="">Sin asignar</option>{forms.map((form) => <option key={form.id} value={form.id}>{form.name}</option>)}</select></label>{!forms.length && <p>No hay formularios disponibles. Créalo desde Builder assets.</p>}<label>Etiqueta accesible<input value={content.label} onChange={(event) => updateContent({ label: event.target.value })}/></label></>}
    {block && <><label>Alineación<select value={block.style?.align || "start"} onChange={(event) => updateStyle({ align: event.target.value })}><option value="start">Inicio</option><option value="center">Centro</option><option value="end">Final</option></select></label></>}
    {!block && <><label>Layout<select value={section.layout} onChange={(event) => changeLayout(event.target.value)}><option value="stack">Stack</option><option value="columns">Columns</option></select></label><label>Ancho<select value={section.style?.content_width || "standard"} onChange={(event) => apply({ type: "update_section", section_id: section.id, changes: { style: { ...(section.style || {}), content_width: event.target.value } } }, "section-style", 600)}><option value="standard">Estándar</option><option value="wide">Amplio</option></select></label></>}
    <div className="landing-inspector-actions"><button onClick={() => onMove(-1)}><ArrowUp/>Subir</button><button onClick={() => onMove(1)}><ArrowDown/>Bajar</button><button onClick={onDuplicate}><Copy/>Duplicar</button><button className="danger" onClick={onDelete}><Trash2/>Eliminar</button></div>
  </aside>;
}

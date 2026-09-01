import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { ArrowDown, ArrowLeft, ArrowUp, Copy, GripVertical, Heading, Image, Layers3, Monitor, MousePointerClick, Pilcrow, Redo2, Smartphone, Tablet, Trash2, Undo2, Waypoints } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { validateLandingDocument } from "../document/landingDocument.js";
import { applyLandingOperations } from "../document/landingOperations.js";
import { createLandingPattern, LANDING_PATTERN_CATALOG } from "../document/landingPatterns.js";
import LandingRenderer from "../renderer/LandingRenderer.jsx";
import "../renderer/LandingRenderer.css";
import { listBuilderAssets, loadBuilderAssetDraft, saveBuilderAssetDraft } from "../services/BuilderAssetService.js";
import { createLandingAutosave } from "./landingAutosave.js";
import { applyLandingDrop, decodeLandingDrag, encodeLandingDrag, isValidLandingDrop, LANDING_DRAG_TYPE } from "./landingDnD.js";
import { duplicateEditorSelection, findEditorSelection, landingEditorReducer, moveEditorSelection } from "./landingEditorState.js";
import "./LandingEditor.css";

const BLOCKS = [
  { type: "heading", label: "Heading", hint: "Título semántico", Icon: Heading },
  { type: "text", label: "Text", hint: "Párrafo editorial", Icon: Pilcrow },
  { type: "image", label: "Image", hint: "Visual responsive", Icon: Image },
  { type: "action_group", label: "Actions", hint: "Botones de acción", Icon: MousePointerClick },
  { type: "form_reference", label: "Form", hint: "Formulario conectado", Icon: Waypoints },
  { type: "logo", label: "Logo", hint: "Marca enlazable", Icon: Image },
  { type: "feature_item", label: "Feature", hint: "Beneficio estructurado", Icon: Layers3 },
  { type: "stat", label: "Stat", hint: "Métrica destacada", Icon: Heading },
  { type: "testimonial", label: "Testimonial", hint: "Cita semántica", Icon: Pilcrow },
  { type: "video", label: "Video", hint: "YouTube o Vimeo", Icon: Monitor },
  { type: "pricing_card", label: "Pricing", hint: "Plan y capacidades", Icon: Layers3 },
  { type: "faq_item", label: "FAQ", hint: "Pregunta accesible", Icon: Pilcrow },
  { type: "divider", label: "Divider", hint: "Separador controlado", Icon: Waypoints },
  { type: "spacer", label: "Spacer", hint: "Espacio predefinido", Icon: Waypoints },
  { type: "social_links", label: "Social", hint: "Enlaces aprobados", Icon: MousePointerClick },
];
const PREVIEWS = [{ id: "desktop", label: "Desktop", Icon: Monitor }, { id: "tablet", label: "Tablet", Icon: Tablet }, { id: "mobile", label: "Mobile", Icon: Smartphone }];
const PATTERNS = LANDING_PATTERN_CATALOG.map((pattern) => ({ ...pattern, hint: pattern.group }));
const newSection = () => ({ id: crypto.randomUUID(), layout: "stack", regions: [{ id: crypto.randomUUID(), span: 12, blocks: [] }] });
const saveLabel = (status) => ({ saved: "Guardado", saving: "Guardando…", unsaved: "Sin guardar", conflict: "Conflicto", error: "Error" })[status] || status;

export default function LandingPageEditor({ asset }) {
  const navigate = useNavigate();
  const [state, dispatch] = useReducer(landingEditorReducer, null);
  const [status, setStatus] = useState("saved");
  const [error, setError] = useState("");
  const [forms, setForms] = useState([]);
  const [localConflictDocument, setLocalConflictDocument] = useState(null);
  const [dragState, setDragState] = useState({ payload: null, target: null });
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

  const apply = useCallback((operation, group = null, delay = 220) => { saveDelayRef.current = delay; dispatch({ type: "operation", operation, group }); }, []);
  const replace = useCallback((document, group = null, delay = 220) => { saveDelayRef.current = delay; dispatch({ type: "replace", document, group }); }, []);
  const selected = useMemo(() => state ? findEditorSelection(state.document, state.selection) : null, [state]);
  const selectedRegion = selected?.region || (state?.selection?.kind === "section" ? selected?.regions?.[0] : null) || state?.document.sections.at(-1)?.regions?.[0];

  const removeSelection = useCallback((selection) => {
    if (!selection) return;
    apply({ type: selection.kind === "section" ? "remove_section" : "remove_block", [`${selection.kind}_id`]: selection.id }, "remove");
    dispatch({ type: "select", selection: null });
  }, [apply]);

  useEffect(() => {
    const keys = (event) => {
      const typing = ["INPUT", "TEXTAREA", "SELECT"].includes(event.target?.tagName) || event.target?.isContentEditable;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") { event.preventDefault(); dispatch({ type: event.shiftKey ? "redo" : "undo" }); }
      else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "y") { event.preventDefault(); dispatch({ type: "redo" }); }
      else if (event.key === "Escape") dispatch({ type: "select", selection: null });
      else if (!typing && (event.key === "Delete" || event.key === "Backspace") && stateRef.current?.selection) { event.preventDefault(); removeSelection(stateRef.current.selection); }
    };
    window.addEventListener("keydown", keys); return () => window.removeEventListener("keydown", keys);
  }, [removeSelection]);

  function createPattern(id) {
    return createLandingPattern(id, { formAssetId: forms[0]?.id || null });
  }
  function addBlock(type) {
    const blockId = crypto.randomUUID();
    if (!selectedRegion) { const section = newSection(); replace(applyLandingOperations(state.document, [{ type: "add_section", section }, { type: "add_block", region_id: section.regions[0].id, block_type: type, block_id: blockId }]), "insert"); }
    else apply({ type: "add_block", region_id: selectedRegion.id, block_type: type, block_id: blockId }, "insert");
    dispatch({ type: "select", selection: { kind: "block", id: blockId } });
  }
  function addPattern(id) { const section = createPattern(id); if (!section) return; apply({ type: "add_section", section }, "pattern"); dispatch({ type: "select", selection: { kind: "section", id: section.id } }); }
  function moveSelection(selection, delta) { replace(moveEditorSelection(state.document, selection, delta), "move"); }
  function duplicateSelection(selection) { replace(duplicateEditorSelection(state.document, selection), "duplicate"); }
  async function leave() { await autosaveRef.current?.flush(); navigate("/construir"); }
  async function reloadRemote() { const draft = await loadBuilderAssetDraft(asset.id); autosaveRef.current.reset(draft.revision); dispatch({ type: "remote", draft }); setLocalConflictDocument(null); setError(""); }

  function canvasClick(event) {
    if (event.target.closest("button")) return;
    event.preventDefault(); const block = event.target.closest("[data-block-id]"); const section = event.target.closest("[data-section-id]");
    dispatch({ type: "select", selection: block ? { kind: "block", id: block.dataset.blockId } : section ? { kind: "section", id: section.dataset.sectionId } : null });
  }
  function dragStart(event) {
    const palette = event.target.closest("[data-palette-kind]"); const draggable = event.target.closest("[data-drag-kind]");
    const payload = palette ? { kind: palette.dataset.paletteKind, id: palette.dataset.paletteId } : draggable ? { kind: draggable.dataset.dragKind, id: draggable.dataset.dragId } : null;
    if (!payload) return;
    dragRef.current = payload; setDragState({ payload, target: null }); event.dataTransfer.effectAllowed = payload.kind.startsWith("palette") ? "copy" : "move"; event.dataTransfer.setData(LANDING_DRAG_TYPE, encodeLandingDrag(payload));
  }
  function readTarget(event) { const zone = event.target.closest("[data-drop-kind]"); return zone ? { kind: zone.dataset.dropKind, blockId: zone.dataset.blockIdTarget || undefined, sectionId: zone.dataset.sectionIdTarget || undefined, regionId: zone.dataset.regionIdTarget || undefined } : null; }
  function dragOver(event) {
    const payload = dragRef.current || decodeLandingDrag(event.dataTransfer.getData(LANDING_DRAG_TYPE)); const target = readTarget(event);
    if (!isValidLandingDrop(payload, target)) { setDragState((current) => current.target ? { ...current, target: null } : current); return; }
    event.preventDefault(); event.dataTransfer.dropEffect = payload.kind.startsWith("palette") ? "copy" : "move"; setDragState({ payload, target });
  }
  function drop(event) {
    const payload = dragRef.current || decodeLandingDrag(event.dataTransfer.getData(LANDING_DRAG_TYPE)); const target = readTarget(event);
    if (!isValidLandingDrop(payload, target)) return;
    event.preventDefault(); replace(applyLandingDrop(state.document, payload, target, { createPattern }), "drag");
    if (["block", "section"].includes(payload.kind)) dispatch({ type: "select", selection: { kind: payload.kind, id: payload.id } });
    dragEnd();
  }
  function dragEnd() { dragRef.current = null; setDragState({ payload: null, target: null }); }

  if (error && !state) return <div className="landing-editor-state"><strong>No se pudo abrir la Landing</strong><p>{error}</p><button onClick={() => navigate("/construir")}>Volver a Builder</button></div>;
  if (!state) return <div className="landing-editor-state">Cargando borrador…</div>;
  if (asset.lifecycle === "archived") return <div className="landing-editor-state"><strong>Landing archivada</strong><p>Este asset no puede editarse.</p><button onClick={() => navigate("/construir")}>Volver</button></div>;
  const validation = validateLandingDocument(state.document);
  const editorActions = { dropTarget: dragState.target, move: moveSelection, duplicate: duplicateSelection, remove: removeSelection };

  return <div className="landing-editor">
    <header className="landing-editor-bar"><button onClick={leave} aria-label="Volver a Builder"><ArrowLeft/></button><div className="landing-editor-identity"><span>BUILDER · LANDING</span><strong>{asset.name}</strong><small>Borrador</small></div><div className="landing-editor-history"><button onClick={() => dispatch({ type: "undo" })} disabled={!state.past.length} aria-label="Deshacer"><Undo2/></button><button onClick={() => dispatch({ type: "redo" })} disabled={!state.future.length} aria-label="Rehacer"><Redo2/></button></div><div className="landing-preview-switch" aria-label="Vista responsive">{PREVIEWS.map(({ id, label, Icon }) => <button key={id} title={label} className={state.preview === id ? "is-active" : ""} onClick={() => dispatch({ type: "preview", preview: id })} aria-pressed={state.preview === id}><Icon/><span>{label}</span></button>)}</div><span className={`landing-save ${status}`}>{saveLabel(status)}</span></header>
    {(error || status === "conflict") && <div className="landing-editor-alert" role="alert"><span>{status === "conflict" ? "Esta página cambió en otra sesión." : error}</span>{status === "conflict" ? <><button onClick={reloadRemote}>Recargar versión remota</button><button onClick={() => navigator.clipboard?.writeText(JSON.stringify(localConflictDocument, null, 2))}>Copiar cambios locales</button></> : status === "error" && <button onClick={() => autosaveRef.current?.retry()}>Reintentar guardado</button>}</div>}
    <div className={`landing-editor-body ${state.selection ? "has-inspector" : ""}`}>
      <aside className="landing-palette"><span>AÑADIR</span><h2>Blocks</h2>{BLOCKS.map(({ type, label, hint, Icon }) => <button key={type} draggable data-palette-kind="palette-block" data-palette-id={type} onDragStart={dragStart} onDragEnd={dragEnd} onClick={() => addBlock(type)}><Icon/><span><strong>{label}</strong><small>{hint}</small></span><GripVertical aria-hidden="true"/></button>)}<h2>Patterns</h2>{PATTERNS.map((item) => <button className="landing-pattern-card" key={item.id} draggable data-palette-kind="palette-pattern" data-palette-id={item.id} data-pattern-group={item.group} onDragStart={dragStart} onDragEnd={dragEnd} onClick={() => addPattern(item.id)}><PatternPreview type={item.preview}/><span><small>{item.group}</small><strong>{item.label}</strong></span><GripVertical aria-hidden="true"/></button>)}<DesignControls document={state.document} replace={replace}/></aside>
      <main className={`landing-canvas-shell ${dragState.payload ? "is-dragging" : ""}`}><div className={`landing-viewport landing-viewport-${state.preview}`}><span className="landing-viewport-label">{state.preview} preview</span><div className={`landing-page-frame landing-preview-${state.preview}`} onClick={canvasClick} onDragStart={dragStart} onDragEnd={dragEnd} onDragOver={dragOver} onDrop={drop}>{!state.document.sections.length ? <div className="landing-empty" data-drop-kind="canvas-end"><Layers3/><h2>Comienza tu página</h2><p>Añade una estructura clara y conviértela en una experiencia real.</p><div><button onClick={(event) => { event.stopPropagation(); addPattern("hero"); }}>Añadir Hero</button><button onClick={(event) => { event.stopPropagation(); apply({ type: "add_section", section: newSection() }, "insert"); }}>Añadir sección</button></div></div> : <LandingRenderer document={state.document} editorMode selection={state.selection} editorActions={editorActions} resolveForm={(id, label) => <div className="landing-form-preview"><strong>Form</strong><span>{forms.find((form) => form.id === id)?.name || "Sin formulario asignado"}</span><small>{label}</small></div>}/>}</div></div><output className="landing-editor-announcement" aria-live="polite">{dragState.target ? "Destino de inserción seleccionado" : validation.valid ? "Documento válido" : `${validation.errors.length} errores de documento`}</output></main>
      {state.selection && <Inspector selection={state.selection} selected={selected} forms={forms} apply={apply} preview={state.preview} onDelete={() => removeSelection(state.selection)} onDuplicate={() => duplicateSelection(state.selection)} onMove={(delta) => moveSelection(state.selection, delta)} onClose={() => dispatch({ type: "select", selection: null })}/>}
    </div>
  </div>;
}

function PatternPreview({ type }) {
  const count = ["cards", "pricing", "logos", "stats", "quotes"].includes(type) ? 3 : type === "faq" ? 4 : 2;
  return <span className="landing-pattern-preview" data-preview={type} aria-hidden="true"><i/><b>{Array.from({ length: count }, (_, index) => <em key={index}/>)}</b></span>;
}

function DesignControls({ document, replace }) {
  const design = document.settings.design_system;
  const update = (category, key, value) => { const next = structuredClone(document); next.settings.design_system[category][key] = value; replace(next, `design-${category}-${key}`, 600); };
  return <div className="landing-design"><h2>Page style</h2><label>Fondo<input type="color" value={design.colors.page_background || "#ffffff"} onChange={(event) => update("colors", "page_background", event.target.value)}/></label><label>Superficie<input type="color" value={design.colors.surface || "#ffffff"} onChange={(event) => update("colors", "surface", event.target.value)}/></label><label>Texto<input type="color" value={design.colors.text || "#151515"} onChange={(event) => update("colors", "text", event.target.value)}/></label><label>Texto secundario<input type="color" value={design.colors.muted || "#6b6b6b"} onChange={(event) => update("colors", "muted", event.target.value)}/></label><label>Acento<input type="color" value={design.colors.primary || "#9b7618"} onChange={(event) => update("colors", "primary", event.target.value)}/></label><label>Ancho<select value={design.content_widths.standard || "1120px"} onChange={(event) => update("content_widths", "standard", event.target.value)}><option value="960px">Compacto</option><option value="1120px">Estándar</option><option value="1280px">Amplio</option></select></label><label>Radio de tarjetas<select value={design.radii.card || "16px"} onChange={(event) => update("radii", "card", event.target.value)}><option value="8px">Sutil</option><option value="16px">Estándar</option><option value="24px">Amplio</option></select></label><h2>Button defaults</h2><label>Estilo<select value={design.buttons.variant || "primary"} onChange={(event) => update("buttons", "variant", event.target.value)}>{["primary","secondary","outline","ghost"].map((value) => <option key={value}>{value}</option>)}</select></label><label>Tamaño<select value={design.buttons.size || "md"} onChange={(event) => update("buttons", "size", event.target.value)}>{["sm","md","lg"].map((value) => <option key={value}>{value}</option>)}</select></label><label>Radio<select value={design.buttons.radius || "md"} onChange={(event) => update("buttons", "radius", event.target.value)}>{["none","sm","md","lg","pill"].map((value) => <option key={value}>{value}</option>)}</select></label><label>Sombra<select value={design.buttons.shadow || "none"} onChange={(event) => update("buttons", "shadow", event.target.value)}>{["none","subtle","soft","medium"].map((value) => <option key={value}>{value}</option>)}</select></label></div>;
}

function Inspector({ selection, selected, forms, apply, preview, onDelete, onDuplicate, onMove, onClose }) {
  if (!selected) return null;
  const block = selection.kind === "block" ? selected.block : null; const section = selection.kind === "section" ? selected : selected.section; const content = block?.content;
  const updateContent = (changes) => apply({ type: "update_block_content", block_id: block.id, changes }, `content-${block.id}`, 600);
  const updateStyle = (changes) => apply({ type: "update_block_style", block_id: block.id, changes }, `style-${block.id}`, 600);
  const responsiveBreakpoint = preview === "desktop" ? null : preview;
  const responsive = responsiveBreakpoint ? (block || section).responsive?.[responsiveBreakpoint] || {} : null;
  const updateResponsive = (changes) => apply({ type: block ? "update_block_responsive" : "update_section_responsive", [block ? "block_id" : "section_id"]: (block || section).id, breakpoint: responsiveBreakpoint, changes }, `responsive-${(block || section).id}-${responsiveBreakpoint}`, 600);
  const resetResponsive = () => apply({ type: block ? "reset_block_responsive" : "reset_section_responsive", [block ? "block_id" : "section_id"]: (block || section).id, breakpoint: responsiveBreakpoint }, `responsive-reset-${(block || section).id}`, 600);
  function changeLayout(preset) {
    const spans = { stack: [12], "columns-2": [6, 6], "columns-5-7": [5, 7], "columns-7-5": [7, 5], "columns-3": [4, 4, 4], "columns-4": [3, 3, 3, 3] }[preset] || [12];
    const blocks = section.regions.flatMap((region) => region.blocks);
    const regions = spans.map((span, index) => ({ id: section.regions[index]?.id || crypto.randomUUID(), span, blocks: index === 0 ? blocks : [] }));
    apply({ type: "update_section", section_id: section.id, changes: { layout: spans.length === 1 ? "stack" : "columns", regions } }, "section-layout");
  }
  return <aside className="landing-inspector"><header><div><span>PROPIEDADES</span><strong>{block ? block.type.replace("_", " ") : "Section"}</strong></div><button onClick={onClose} aria-label="Cerrar propiedades">×</button></header>
    {block && <details className="landing-inspector-accordion" open><summary><span>Content</span><span aria-hidden="true">⌄</span></summary>
    {block && <div className="landing-inspector-group"><h3>Content</h3>{block.type === "heading" && <><label>Texto<textarea autoFocus placeholder="Título" value={content.text} onChange={(event) => updateContent({ text: event.target.value })}/></label><label>Nivel<select value={content.level} onChange={(event) => updateContent({ level: Number(event.target.value) })}>{[1,2,3,4,5,6].map((level) => <option key={level} value={level}>H{level}</option>)}</select></label></>}{block.type === "text" && <label>Contenido<textarea autoFocus placeholder="Escribe el contenido" value={content.text} onChange={(event) => updateContent({ text: event.target.value })}/></label>}{block.type === "image" && <><label>Origen<select value={content.source.kind} onChange={(event) => updateContent({ source: event.target.value === "external" ? { kind: "external", url: "https://example.com/image.jpg" } : { kind: "placeholder" } })}><option value="placeholder">Placeholder</option><option value="external">HTTPS externo</option></select></label>{content.source.kind === "external" && <label>URL<input value={content.source.url} onChange={(event) => updateContent({ source: { kind: "external", url: event.target.value } })}/></label>}<label><input type="checkbox" checked={content.decorative} onChange={(event) => updateContent({ decorative: event.target.checked })}/> Decorativa</label>{!content.decorative && <label>Texto alternativo<input value={content.alt} onChange={(event) => updateContent({ alt: event.target.value })}/></label>}</>}{block.type === "action_group" && <><ActionControls content={content} updateContent={updateContent}/><ActionSurfacePresets content={content} updateContent={updateContent}/></> } {block.type === "form_reference" && <><label>Formulario<select value={content.asset_id || ""} onChange={(event) => updateContent({ asset_id: event.target.value || null })}><option value="">Sin asignar</option>{forms.map((form) => <option key={form.id} value={form.id}>{form.name}</option>)}</select></label>{!forms.length && <p className="landing-inspector-empty">No hay formularios disponibles.<br/>Crea uno desde Builder assets.</p>}<label>Etiqueta accesible<input value={content.label} onChange={(event) => updateContent({ label: event.target.value })}/></label></>}<ProfessionalContentControls block={block} updateContent={updateContent}/></div>}
    </details>}
    {block && <details className="landing-inspector-accordion" open><summary><span>Appearance</span><span aria-hidden="true">⌄</span></summary><BlockStyleControls block={block} updateStyle={updateStyle} apply={apply}/></details>}
    {!block && <details className="landing-inspector-accordion" open><summary><span>Appearance &amp; Layout</span><span aria-hidden="true">⌄</span></summary><SectionControls section={section} changeLayout={changeLayout} apply={apply}/></details>}
    {responsiveBreakpoint && <details className="landing-inspector-accordion"><summary><span>Responsive</span><span aria-hidden="true">⌄</span></summary>
    {responsiveBreakpoint && <div className="landing-inspector-group"><h3>{responsiveBreakpoint === "tablet" ? "Tablet" : "Mobile"} override</h3><label>Alineación<select value={responsive.align || ""} onChange={(event) => updateResponsive({ align: event.target.value || undefined })}><option value="">Heredar</option><option value="start">Inicio</option><option value="center">Centro</option><option value="end">Final</option></select></label><label>Espaciado<select value={responsive.spacing || ""} onChange={(event) => updateResponsive({ spacing: event.target.value || undefined })}><option value="">Heredar</option>{["none","xs","sm","md","lg","xl"].map((size) => <option key={size}>{size}</option>)}</select></label><label><input type="checkbox" checked={responsive.hidden || false} onChange={(event) => updateResponsive({ hidden: event.target.checked })}/> Ocultar en {responsiveBreakpoint}</label>{!block && <label>Layout<select value={responsive.layout || ""} onChange={(event) => updateResponsive({ layout: event.target.value || undefined })}><option value="">Heredar</option><option value="stack">Apilar</option><option value="columns">Columnas</option></select></label>}<button type="button" onClick={resetResponsive}>Reset responsive override</button></div>}
    </details>}
    <div className="landing-inspector-actions"><button onClick={() => onMove(-1)}><ArrowUp/>Subir</button><button onClick={() => onMove(1)}><ArrowDown/>Bajar</button><button onClick={onDuplicate}><Copy/>Duplicar</button><button className="danger" onClick={onDelete}><Trash2/>Eliminar</button></div>
  </aside>;
}

function ProfessionalContentControls({ block, updateContent }) {
  const content = block.content;
  const textField = (key, label, multiline = false) => <label key={key}>{label}{multiline ? <textarea value={content[key]} onChange={(event) => updateContent({ [key]: event.target.value })}/> : <input value={content[key]} onChange={(event) => updateContent({ [key]: event.target.value })}/>}</label>;
  switch (block.type) {
    case "image": return <><label>Ajuste<select value={content.fit || "cover"} onChange={(event) => updateContent({ fit: event.target.value })}><option value="cover">Cover</option><option value="contain">Contain</option></select></label><label>Proporción<select value={content.aspect_ratio || "auto"} onChange={(event) => updateContent({ aspect_ratio: event.target.value })}><option value="auto">Auto</option><option value="square">1:1</option><option value="4:3">4:3</option><option value="16:9">16:9</option><option value="portrait">Portrait</option></select></label><label>Radio<select value={content.radius || "md"} onChange={(event) => updateContent({ radius: event.target.value })}><option value="none">Ninguno</option><option value="sm">S</option><option value="md">M</option><option value="lg">L</option></select></label><label>Foco<select value={content.focal_position || "center"} onChange={(event) => updateContent({ focal_position: event.target.value })}>{["center","top","bottom","left","right"].map((position) => <option key={position}>{position}</option>)}</select></label></>;
    case "logo": return <>{textField("url", "Image URL")}{textField("alt", "Texto alternativo")}{textField("href", "Enlace opcional")}<label>Ancho<select value={content.width} onChange={(event) => updateContent({ width: event.target.value })}><option value="sm">Pequeño</option><option value="md">Medio</option><option value="lg">Grande</option></select></label></>;
    case "feature_item": return <>{textField("title", "Título")}{textField("description", "Descripción", true)}{textField("href", "Enlace opcional")}</>;
    case "stat": return <>{textField("value", "Valor")}{textField("label", "Etiqueta")}{textField("supporting_text", "Apoyo")}</>;
    case "testimonial": return <>{textField("quote", "Testimonio", true)}{textField("person_name", "Persona")}{textField("role_company", "Rol / empresa")}{textField("avatar_url", "Avatar HTTPS")}</>;
    case "video": return <>{textField("url", "YouTube o Vimeo HTTPS")}{textField("title", "Título accesible")}{textField("poster_url", "Poster opcional")}</>;
    case "pricing_card": return <>{textField("plan_name", "Plan")}{textField("price", "Precio")}{textField("cadence", "Cadencia")}{textField("description", "Descripción", true)}{textField("cta_label", "CTA")}{textField("cta_url", "CTA URL")}<label>Features<textarea value={content.features.join("\n")} onChange={(event) => updateContent({ features: event.target.value.split("\n").filter(Boolean).slice(0, 12) })}/></label><label><input type="checkbox" checked={content.emphasis} onChange={(event) => updateContent({ emphasis: event.target.checked })}/> Destacar plan</label></>;
    case "faq_item": return <>{textField("question", "Pregunta")}{textField("answer", "Respuesta", true)}<label><input type="checkbox" checked={content.default_open} onChange={(event) => updateContent({ default_open: event.target.checked })}/> Abierta inicialmente</label></>;
    case "divider": return <><label>Estilo<select value={content.style} onChange={(event) => updateContent({ style: event.target.value })}><option value="solid">Sólido</option><option value="dashed">Discontinuo</option><option value="subtle">Sutil</option></select></label></>;
    case "spacer": return <label>Tamaño<select value={content.size} onChange={(event) => updateContent({ size: event.target.value })}>{["xs","sm","md","lg","xl"].map((size) => <option key={size}>{size}</option>)}</select></label>;
    case "social_links": return <label>Enlaces estructurados<textarea value={content.links.map((link) => `${link.provider}|${link.url}|${link.label}`).join("\n")} onChange={(event) => updateContent({ links: event.target.value.split("\n").filter(Boolean).slice(0, 10).map((line) => { const [provider = "website", url = "", label = "Enlace"] = line.split("|"); return { provider, url, label }; }) })}/></label>;
    default: return null;
  }
}

function ActionSurfacePresets({ content, updateContent }) {
  const action = content.actions[0];
  const update = (changes) => updateContent({ actions: [{ ...action, ...changes }, ...content.actions.slice(1)] });
  const applyPreset = (preset) => {
    const presets = {
      flat: { shadow: "none", border: "none", variant: "primary" },
      soft: { shadow: "soft", border: "subtle", variant: "secondary" },
      raised: { shadow: "medium", border: "subtle", variant: "primary" },
      glass: { shadow: "soft", border: "subtle", variant: "outline" },
      outline: { shadow: "none", border: "standard", variant: "outline" },
      premium: { shadow: "medium", border: "subtle", variant: "primary", radius: "lg", background: "gradient_gold_dusk" },
    };
    update(presets[preset] || {});
  };
  return <label>Surface preset<select defaultValue="" onChange={(event) => applyPreset(event.target.value)}><option value="">Custom / inherited</option><option value="flat">Flat</option><option value="soft">Soft</option><option value="raised">Raised</option><option value="glass">Glass</option><option value="outline">Outline</option><option value="premium">Premium</option></select></label>;
}

function ActionControls({ content, updateContent }) {
  const action = content.actions[0];
  const update = (changes) => updateContent({ actions: [{ ...action, ...changes }, ...content.actions.slice(1)] });
  const tokenOptions = <><option value="">Page Style / Inherited</option><option value="page_background">Página</option><option value="surface">Superficie</option><option value="text">Texto</option><option value="muted">Secundario</option><option value="primary">Acento</option></>;
  const backgroundOptions = <>{tokenOptions}<option value="gradient_soft_light">Gradient · Subtle Light</option><option value="gradient_aurora">Gradient · Accent Soft</option><option value="gradient_gold_dusk">Gradient · Accent Depth</option><option value="gradient_graphite">Gradient · Dark Depth</option></>;
  const reset = () => { const { label, href } = action; updateContent({ actions: [{ label, href }, ...content.actions.slice(1)] }); };
  return <><label>Etiqueta<input value={action.label} onChange={(event) => update({ label: event.target.value })}/></label><label>URL<input value={action.href} onChange={(event) => update({ href: event.target.value })}/></label><h3>Button Style</h3><label>Estilo<select value={action.variant || ""} onChange={(event) => update({ variant: event.target.value || undefined })}><option value="">Page Style / Inherited</option><option value="primary">Primary</option><option value="secondary">Secondary</option><option value="outline">Outline</option><option value="ghost">Ghost</option></select></label><label>Tamaño<select value={action.size || ""} onChange={(event) => update({ size: event.target.value || undefined })}><option value="">Page Style / Inherited</option><option value="sm">Small</option><option value="md">Medium</option><option value="lg">Large</option></select></label><label>Ancho<select value={action.width || ""} onChange={(event) => update({ width: event.target.value || undefined })}><option value="">Page Style / Inherited</option><option value="auto">Auto</option><option value="full">Full</option></select></label><label>Radio<select value={action.radius || ""} onChange={(event) => update({ radius: event.target.value || undefined })}><option value="">Page Style / Inherited</option>{["none","sm","md","lg","pill"].map((value) => <option key={value}>{value}</option>)}</select></label><label>Sombra<select value={action.shadow || ""} onChange={(event) => update({ shadow: event.target.value || undefined })}><option value="">Page Style / Inherited</option>{["none","subtle","soft","medium"].map((value) => <option key={value}>{value}</option>)}</select></label><label>Borde<select value={action.border || ""} onChange={(event) => update({ border: event.target.value || undefined })}><option value="">Page Style / Inherited</option>{["none","subtle","standard"].map((value) => <option key={value}>{value}</option>)}</select></label><label>Fondo<select value={action.background || ""} onChange={(event) => update({ background: event.target.value || undefined })}>{backgroundOptions}</select></label><label>Texto<select value={action.text_color || ""} onChange={(event) => update({ text_color: event.target.value || undefined })}>{tokenOptions}</select></label><label>Color de borde<select value={action.border_color || ""} onChange={(event) => update({ border_color: event.target.value || undefined })}>{tokenOptions}</select></label><button type="button" onClick={reset}>Reset to Page Style</button></>;
}

function BlockStyleControls({ block, updateStyle, apply }) {
  const style = block.style || {};
  const typography = block.type === "heading" || block.type === "text";
  return <div className="landing-inspector-group"><h3>Style · Desktop/Base</h3><label>Alineación<select value={style.align || "start"} onChange={(event) => updateStyle({ align: event.target.value })}><option value="start">Inicio</option><option value="center">Centro</option><option value="end">Final</option></select></label>{typography && <><label>{block.type === "text" ? "Variante" : "Escala"}<select value={block.type === "text" ? style.text_variant || "body" : style.text_size || ""} onChange={(event) => updateStyle(block.type === "text" ? { text_variant: event.target.value } : { text_size: event.target.value || undefined })}>{block.type === "heading" && <option value="">Page style</option>}{(block.type === "text" ? ["lead","body","small"] : ["xs","sm","md","lg","xl","2xl"]).map((value) => <option key={value}>{value}</option>)}</select></label><label>Peso<select value={style.text_weight || ""} onChange={(event) => updateStyle({ text_weight: event.target.value || undefined })}><option value="">Page style</option>{["regular","medium","semibold","bold"].map((value) => <option key={value}>{value}</option>)}</select></label><label>Color<select value={style.color || ""} onChange={(event) => updateStyle({ color: event.target.value || undefined })}><option value="">Page style</option><option value="text">Texto</option><option value="muted">Secundario</option><option value="primary">Acento</option></select></label><label>Ancho máximo<select value={style.max_width || "none"} onChange={(event) => updateStyle({ max_width: event.target.value })}>{["none","narrow","standard","wide"].map((value) => <option key={value}>{value}</option>)}</select></label><label>Espaciado<select value={style.spacing || ""} onChange={(event) => updateStyle({ spacing: event.target.value || undefined })}><option value="">Page style</option>{["none","xs","sm","md","lg","xl"].map((value) => <option key={value}>{value}</option>)}</select></label></>}{["image","pricing_card","testimonial","feature_item","video"].includes(block.type) && <><label>Radio<select value={style.radius || ""} onChange={(event) => updateStyle({ radius: event.target.value || undefined })}><option value="">Page style</option>{["none","sm","md","lg"].map((value) => <option key={value}>{value}</option>)}</select></label><label>Sombra<select value={style.shadow || ""} onChange={(event) => updateStyle({ shadow: event.target.value || undefined })}><option value="">Page style</option>{["none","subtle","soft","medium","elevated"].map((value) => <option key={value}>{value}</option>)}</select></label><label>Borde<select value={style.border || ""} onChange={(event) => updateStyle({ border: event.target.value || undefined })}><option value="">Page style</option>{["none","subtle","standard"].map((value) => <option key={value}>{value}</option>)}</select></label></>}{block.style && <button type="button" onClick={() => apply({ type: "reset_block_style", block_id: block.id }, `style-reset-${block.id}`, 600)}>Reset to page style</button>}</div>;
}

function SectionControls({ section, changeLayout, apply }) {
  const style = section.style || {};
  const background = typeof style.background === "object" ? style.background : { type: style.background ? "solid" : "inherit", color: style.background };
  const update = (changes) => apply({ type: "update_section_style", section_id: section.id, changes }, "section-style", 600);
  const updateBackground = (changes) => update({ background: { ...background, ...changes } });
  const setBackgroundType = (type) => update({ background: type === "inherit" ? undefined : type === "transparent" ? { type } : type === "solid" ? { type, color: "surface" } : type === "gradient" ? { type, gradient: "soft_light" } : { type, url: "https://example.com/background.jpg", fit: "cover", position: "center", overlay_color: "text", overlay_opacity: 30 } });
  return <div className="landing-inspector-group"><h3>Section Style · Desktop/Base</h3><label>Columnas<select value={section.layout === "stack" ? "stack" : `columns-${section.regions.length}`} onChange={(event) => changeLayout(event.target.value)}><option value="stack">1 columna</option><option value="columns-2">2 iguales</option><option value="columns-5-7">2 · 5/7</option><option value="columns-7-5">2 · 7/5</option><option value="columns-3">3 iguales</option><option value="columns-4">4 iguales</option></select></label><label>Ancho<select value={style.content_width || ""} onChange={(event) => update({ content_width: event.target.value || undefined })}><option value="">Heredar</option><option value="narrow">Estrecho</option><option value="standard">Estándar</option><option value="wide">Amplio</option></select></label><label>Alineación<select value={style.align || ""} onChange={(event) => update({ align: event.target.value || undefined })}><option value="">Heredar</option><option value="start">Inicio</option><option value="center">Centro</option><option value="end">Final</option></select></label><h3>Fondo</h3><label>Tipo<select value={background.type || "inherit"} onChange={(event) => setBackgroundType(event.target.value)}><option value="inherit">Heredar / Default</option><option value="transparent">Transparente</option><option value="solid">Color</option><option value="gradient">Gradiente</option><option value="image">Imagen</option></select></label>{background.type === "solid" && <label>Color token<select value={background.color || "surface"} onChange={(event) => updateBackground({ color: event.target.value })}><option value="page_background">Página</option><option value="surface">Superficie</option><option value="primary">Acento</option><option value="text">Texto</option></select></label>}{background.type === "image" && <><label>URL HTTPS<input value={background.url || ""} onChange={(event) => updateBackground({ url: event.target.value })}/></label><label>Ajuste<select value={background.fit || "cover"} onChange={(event) => updateBackground({ fit: event.target.value })}><option value="cover">Cover</option><option value="contain">Contain</option></select></label><label>Posición<select value={background.position || "center"} onChange={(event) => updateBackground({ position: event.target.value })}>{["center","top","bottom","left","right"].map((value) => <option key={value}>{value}</option>)}</select></label><label>Overlay<select value={background.overlay_color || "text"} onChange={(event) => updateBackground({ overlay_color: event.target.value })}><option value="text">Texto</option><option value="page_background">Página</option><option value="primary">Acento</option></select></label><label>Opacidad<select value={background.overlay_opacity || 0} onChange={(event) => updateBackground({ overlay_opacity: Number(event.target.value) })}>{[0,10,20,30,40,50,60,70,80].map((value) => <option key={value} value={value}>{value}%</option>)}</select></label></>}{background.type === "gradient" && <label>Preset<select value={background.gradient || "soft_light"} onChange={(event) => updateBackground({ gradient: event.target.value })}><option value="soft_light">Subtle Light</option><option value="aurora">Accent Soft</option><option value="gold_dusk">Accent Depth</option><option value="graphite">Dark Depth</option></select></label>}<h3>Surface</h3><label>Borde<select value={style.border || ""} onChange={(event) => update({ border: event.target.value || undefined })}><option value="">Heredar</option>{["none","subtle","standard"].map((value) => <option key={value}>{value}</option>)}</select></label><label>Radio<select value={style.radius || ""} onChange={(event) => update({ radius: event.target.value || undefined })}><option value="">Heredar</option>{["none","sm","md","lg"].map((value) => <option key={value}>{value}</option>)}</select></label><label>Sombra<select value={style.shadow || ""} onChange={(event) => update({ shadow: event.target.value || undefined })}><option value="">Heredar</option>{["none","subtle","soft","medium","elevated"].map((value) => <option key={value}>{value}</option>)}</select></label><label>Padding superior<select value={style.padding_top || ""} onChange={(event) => update({ padding_top: event.target.value || undefined })}><option value="">Heredar</option>{["none","xs","sm","md","lg","xl"].map((value) => <option key={value}>{value}</option>)}</select></label><label>Padding inferior<select value={style.padding_bottom || ""} onChange={(event) => update({ padding_bottom: event.target.value || undefined })}><option value="">Heredar</option>{["none","xs","sm","md","lg","xl"].map((value) => <option key={value}>{value}</option>)}</select></label>{section.style && <button type="button" onClick={() => apply({ type: "reset_section_style", section_id: section.id }, `section-style-reset-${section.id}`, 600)}>Reset Section Style</button>}</div>;
}

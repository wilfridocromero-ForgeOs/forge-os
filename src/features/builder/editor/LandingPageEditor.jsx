import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { ArrowDown, ArrowLeft, ArrowUp, Copy, GripVertical, Heading, Image, Layers3, Monitor, MousePointerClick, Pilcrow, Redo2, Smartphone, Tablet, Trash2, Undo2, Waypoints } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { createPortal } from "react-dom";
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
const createBuilderId = () => {
  if (typeof globalThis.crypto?.randomUUID === "function") return globalThis.crypto.randomUUID();
  const bytes = new Uint8Array(16);
  if (typeof globalThis.crypto?.getRandomValues === "function") globalThis.crypto.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, "0"));
  return `${hex.slice(0,4).join("")}-${hex.slice(4,6).join("")}-${hex.slice(6,8).join("")}-${hex.slice(8,10).join("")}-${hex.slice(10).join("")}`;
};
const newSection = () => ({ id: createBuilderId(), layout: "stack", regions: [{ id: createBuilderId(), span: 12, blocks: [] }] });
const saveLabel = (status) => ({ saved: "Guardado", saving: "Guardando…", unsaved: "Sin guardar", conflict: "Conflicto", error: "Error" })[status] || status;

export default function LandingPageEditor({ asset }) {
  const navigate = useNavigate();
  const [state, dispatch] = useReducer(landingEditorReducer, null);
  const [status, setStatus] = useState("saved");
  const [error, setError] = useState("");
  const [forms, setForms] = useState([]);
  const [localConflictDocument, setLocalConflictDocument] = useState(null);
  const [dragState, setDragState] = useState({ payload: null, target: null });
  const [editing, setEditing] = useState(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [mobileAddOpen, setMobileAddOpen] = useState(false);
  const [globalStylesOpen, setGlobalStylesOpen] = useState(false);
  const [toolbarPosition, setToolbarPosition] = useState("top");
  const [pendingInsert, setPendingInsert] = useState(null);
  const autosaveRef = useRef(null); const saveDelayRef = useRef(600); const stateRef = useRef(null); const dragRef = useRef(null);
  const libraryDragRef = useRef(null);

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

  const updateInlineField = useCallback(({ blockId, field, index, value }) => {
    const current = stateRef.current?.document;
    const block = current?.sections.flatMap((section) => section.regions).flatMap((region) => region.blocks).find((item) => item.id === blockId);
    if (!block) return;
    let changes;
    if (field === "features") { const features = [...block.content.features]; features[index] = value; changes = { features }; }
    else if (field === "actions.label") { const actions = structuredClone(block.content.actions); actions[index] = { ...actions[index], label: value }; changes = { actions }; }
    else if (field === "links.label") { const links = structuredClone(block.content.links); links[index] = { ...links[index], label: value }; changes = { links }; }
    else changes = { [field]: value };
    apply({ type: "update_block_content", block_id: blockId, changes }, `inline-${blockId}-${field}-${index ?? "field"}`, 600);
  }, [apply]);

  const beginInlineEdit = useCallback((descriptor) => {
    dispatch({ type: "select", selection: { kind: "block", id: descriptor.blockId } });
    setPanelOpen(false);
    setEditing(descriptor);
  }, []);

  const openPanel = useCallback((selection) => {
    if (selection) dispatch({ type: "select", selection });
    setEditing(null);
    setPanelOpen(true);
  }, []);

  const removeSelection = useCallback((selection) => {
    if (!selection) return;
    apply({ type: selection.kind === "section" ? "remove_section" : "remove_block", [`${selection.kind}_id`]: selection.id }, "remove");
    dispatch({ type: "select", selection: null });
    setEditing(null); setPanelOpen(false);
  }, [apply]);

  useEffect(() => {
    const keys = (event) => {
      const typing = ["INPUT", "TEXTAREA", "SELECT"].includes(event.target?.tagName) || event.target?.isContentEditable;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") { event.preventDefault(); dispatch({ type: event.shiftKey ? "redo" : "undo" }); }
      else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "y") { event.preventDefault(); dispatch({ type: "redo" }); }
      else if (event.key === "Escape") { if (pendingInsert) cancelMobilePlacement(); else if (editing) setEditing(null); else { dispatch({ type: "select", selection: null }); setPanelOpen(false); } }
      else if (!typing && (event.key === "Delete" || event.key === "Backspace") && stateRef.current?.selection) { event.preventDefault(); removeSelection(stateRef.current.selection); }
    };
    window.addEventListener("keydown", keys); return () => window.removeEventListener("keydown", keys);
  }, [removeSelection, editing, pendingInsert]);

  useEffect(() => {
    if (!state || typeof window === "undefined") return undefined;
    const media = window.matchMedia("(max-width: 900px)");
    const syncMobilePreview = () => {
      if (media.matches && state.preview !== "mobile") dispatch({ type: "preview", preview: "mobile" });
    };
    syncMobilePreview();
    media.addEventListener?.("change", syncMobilePreview);
    return () => media.removeEventListener?.("change", syncMobilePreview);
  }, [state?.preview]);

  function createPattern(id) {
    return createLandingPattern(id, { formAssetId: forms[0]?.id || null });
  }
  function revealInserted(kind, id) {
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const node = document.querySelector(`[data-${kind}-id="${id}"]`);
      node?.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
    }));
  }

  function closeMobileTools() {
    setMobileAddOpen(false);
    setGlobalStylesOpen(false);
  }

  const mobileActivate = (handler) => (event) => {
    event.stopPropagation();
    handler();
  };

  function addBlock(type) {
    const blockId = createBuilderId();
    if (!selectedRegion) {
      const section = newSection();
      replace(applyLandingOperations(state.document, [
        { type: "add_section", section },
        { type: "add_block", region_id: section.regions[0].id, block_type: type, block_id: blockId },
      ]), "insert");
    } else {
      apply({ type: "add_block", region_id: selectedRegion.id, block_type: type, block_id: blockId }, "insert");
    }
    dispatch({ type: "select", selection: { kind: "block", id: blockId } });
    closeMobileTools();
    revealInserted("block", blockId);
  }

  function addPattern(id) {
    const section = createPattern(id);
    const current = stateRef.current?.document || state.document;
    if (!section || !current) return;
    const next = applyLandingOperations(current, [{ type: "add_section", section }]);
    replace(next, "pattern", 120);
    dispatch({ type: "select", selection: { kind: "section", id: section.id } });
    closeMobileTools();
    revealInserted("section", section.id);
  }
  function beginMobilePlacement(payload) {
    setPendingInsert(payload);
    setMobileAddOpen(false);
    setGlobalStylesOpen(false);
    setEditing(null);
    setPanelOpen(false);
    dispatch({ type: "select", selection: null });
    requestAnimationFrame(() => document.querySelector(".landing-renderer")?.scrollIntoView({ block: "nearest", behavior: "smooth" }));
  }
  function placePendingInsert(target) {
    const payload = pendingInsert;
    const current = stateRef.current?.document || state.document;
    if (!payload || !current || !target) return;

    if (payload.kind === "palette-block") {
      if (!["block-before", "block-after", "region-end"].includes(target.kind) || !target.regionId) return;
      const region = current.sections.flatMap((section) => section.regions).find((item) => item.id === target.regionId);
      if (!region) return;

      let index = region.blocks.length;
      if (target.kind === "block-before" || target.kind === "block-after") {
        const anchorIndex = region.blocks.findIndex((block) => block.id === target.blockId);
        if (anchorIndex < 0) return;
        index = target.kind === "block-before" ? anchorIndex : anchorIndex + 1;
      }

      const blockId = createBuilderId();
      const next = applyLandingOperations(current, [{
        type: "add_block", region_id: region.id, block_type: payload.id, block_id: blockId, index,
      }]);
      replace(next, "block-place", 120);
      setPendingInsert(null);
      dispatch({ type: "select", selection: { kind: "block", id: blockId } });
      requestAnimationFrame(() => revealInserted("block", blockId));
      return;
    }

    if (payload.kind === "palette-pattern") {
      if (!isValidLandingDrop(payload, target)) return;
      const next = applyLandingDrop(current, payload, target, { createPattern });
      const before = new Set(current.sections.map((item) => item.id));
      const inserted = next.sections.find((item) => !before.has(item.id));
      replace(next, "pattern-place", 120);
      setPendingInsert(null);
      if (inserted) {
        dispatch({ type: "select", selection: { kind: "section", id: inserted.id } });
        requestAnimationFrame(() => revealInserted("section", inserted.id));
      }
    }
  }
  function cancelMobilePlacement() { setPendingInsert(null); setEditing(null); }
  function insertSavedButton(saved, regionId = selectedRegion?.id) {
    if (!saved?.style) return;
    const blockId = createBuilderId();
    const targetRegionId = regionId;
    const actions = [{
      label: saved.style.label || saved.name || "Comenzar",
      href: saved.style.href || "#",
      variant: saved.style.variant || "primary",
      size: saved.style.size || "md",
      width: saved.style.width || "auto",
      radius: saved.style.radius || "md",
      shadow: saved.style.shadow || "none",
      border: saved.style.border || "none",
      ...(saved.style.background ? { background:saved.style.background } : {}),
      ...(saved.style.text_color ? { text_color:saved.style.text_color } : {}),
      ...(saved.style.border_color ? { border_color:saved.style.border_color } : {})
    }];
    if (!targetRegionId) {
      const section = newSection();
      let next = applyLandingOperations(state.document, [
        { type:"add_section", section },
        { type:"add_block", region_id:section.regions[0].id, block_type:"action_group", block_id:blockId },
        { type:"update_block_content", block_id:blockId, changes:{ actions } }
      ]);
      replace(next, "library-insert");
    } else {
      const next = applyLandingOperations(state.document, [
        { type:"add_block", region_id:targetRegionId, block_type:"action_group", block_id:blockId },
        { type:"update_block_content", block_id:blockId, changes:{ actions } }
      ]);
      replace(next, "library-insert");
    }
    dispatch({ type:"select", selection:{ kind:"block", id:blockId } });
  }
  function startLibraryDrag(event, item) {
    libraryDragRef.current = item;
    dragRef.current = { kind:"palette-block", id:"action_group" };
    setDragState({ payload:dragRef.current, target:null });
    event.dataTransfer.effectAllowed="copy";
    event.dataTransfer.setData(LANDING_DRAG_TYPE, encodeLandingDrag(dragRef.current));
  }
  function moveSelection(selection, delta) { replace(moveEditorSelection(state.document, selection, delta), "move"); }
  function duplicateSelection(selection) { replace(duplicateEditorSelection(state.document, selection), "duplicate"); }
  async function leave() { await autosaveRef.current?.flush(); navigate("/construir"); }
  async function reloadRemote() { const draft = await loadBuilderAssetDraft(asset.id); autosaveRef.current.reset(draft.revision); dispatch({ type: "remote", draft }); setLocalConflictDocument(null); setError(""); }

  function canvasClick(event) {
    if (event.target.closest("button") || event.target.closest("[data-edit-field]")) return;
    const block = event.target.closest("[data-block-id]"); const section = event.target.closest("[data-section-id]");
    setEditing(null); setPanelOpen(false);
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
    event.preventDefault();
    if (libraryDragRef.current) {
      const saved = libraryDragRef.current;
      const beforeIds = new Set(state.document.sections.flatMap((section) => section.regions.flatMap((region) => region.blocks.map((block) => block.id))));
      let next = applyLandingDrop(state.document, payload, target, { createPattern });
      const inserted = next.sections.flatMap((section) => section.regions.flatMap((region) => region.blocks)).find((block) => !beforeIds.has(block.id) && block.type === "action_group");
      if (inserted) {
        const savedStyle = saved.style || {};
        const actions = [{
          label: savedStyle.label || saved.name || "Comenzar",
          href: savedStyle.href || "#",
          variant: savedStyle.variant || "primary",
          size: savedStyle.size || "md",
          width: savedStyle.width || "auto",
          radius: savedStyle.radius || "md",
          shadow: savedStyle.shadow || "none",
          border: savedStyle.border || "none",
          ...(savedStyle.background ? { background:savedStyle.background } : {}),
          ...(savedStyle.text_color ? { text_color:savedStyle.text_color } : {}),
          ...(savedStyle.border_color ? { border_color:savedStyle.border_color } : {})
        }];
        next = applyLandingOperations(next, [{ type:"update_block_content", block_id:inserted.id, changes:{ actions } }]);
        replace(next, "library-drop");
        dispatch({ type:"select", selection:{ kind:"block", id:inserted.id } });
      }
      libraryDragRef.current = null;
      dragEnd();
      return;
    }
    replace(applyLandingDrop(state.document, payload, target, { createPattern }), "drag");
    if (["block", "section"].includes(payload.kind)) dispatch({ type: "select", selection: { kind: payload.kind, id: payload.id } });
    dragEnd();
  }
  function dragEnd() { libraryDragRef.current = null; dragRef.current = null; setDragState({ payload: null, target: null }); }

  if (error && !state) return <div className="landing-editor-state"><strong>No se pudo abrir la Landing</strong><p>{error}</p><button onClick={() => navigate("/construir")}>Volver a Builder</button></div>;
  if (!state) return <div className="landing-editor-state">Cargando borrador…</div>;
  if (asset.lifecycle === "archived") return <div className="landing-editor-state"><strong>Landing archivada</strong><p>Este asset no puede editarse.</p><button onClick={() => navigate("/construir")}>Volver</button></div>;
  const validation = validateLandingDocument(state.document);
  const editorActions = { dropTarget: dragState.target, move: moveSelection, duplicate: duplicateSelection, remove: removeSelection, openPanel, editing, pendingInsert, onPlace: placePendingInsert };

  return <div className="landing-editor">
    <header className="landing-editor-bar"><button onClick={leave} aria-label="Volver a Builder"><ArrowLeft/></button><div className="landing-editor-identity"><span>BUILDER · LANDING</span><strong>{asset.name}</strong><small>Borrador</small></div><div className="landing-editor-history"><button onClick={() => dispatch({ type: "undo" })} disabled={!state.past.length} aria-label="Deshacer"><Undo2/></button><button onClick={() => dispatch({ type: "redo" })} disabled={!state.future.length} aria-label="Rehacer"><Redo2/></button></div><div className="landing-preview-switch" aria-label="Vista responsive">{PREVIEWS.map(({ id, label, Icon }) => <button key={id} title={label} className={state.preview === id ? "is-active" : ""} onClick={() => dispatch({ type: "preview", preview: id })} aria-pressed={state.preview === id}><Icon/><span>{label}</span></button>)}</div><span className={`landing-save ${status}`}>{saveLabel(status)}</span></header>
    {(error || status === "conflict") && <div className="landing-editor-alert" role="alert"><span>{status === "conflict" ? "Esta página cambió en otra sesión." : error}</span>{status === "conflict" ? <><button onClick={reloadRemote}>Recargar versión remota</button><button onClick={() => navigator.clipboard?.writeText(JSON.stringify(localConflictDocument, null, 2))}>Copiar cambios locales</button></> : status === "error" && <button onClick={() => autosaveRef.current?.retry()}>Reintentar guardado</button>}</div>}
    <div className={`landing-editor-body ${panelOpen && state.selection ? "has-inspector" : ""} ${mobileAddOpen ? "mobile-add-open" : ""} ${globalStylesOpen ? "has-global-styles" : ""}`}>
      <aside className="landing-palette">
        <button type="button" className="landing-mobile-sheet-handle" aria-label="Cerrar panel" onClick={closeMobileTools}><span/></button>
        <div className="landing-palette-tabs">
          <button type="button" className={!globalStylesOpen ? "is-active" : ""} onClick={() => setGlobalStylesOpen(false)}>＋ Añadir</button>
          <button type="button" className={globalStylesOpen ? "is-active" : ""} onClick={() => { setGlobalStylesOpen(true); setMobileAddOpen(true); }}>Estilos de página</button>
        </div>
        {globalStylesOpen ? <DesignControls document={state.document} replace={replace} onInsertSavedButton={insertSavedButton} onStartLibraryDrag={startLibraryDrag}/> : <>
          <span>AÑADIR</span>
          <h2>Blocks</h2>
          {BLOCKS.map(({ type, label, hint, Icon }) => <button key={type} draggable data-palette-kind="palette-block" data-palette-id={type} onDragStart={dragStart} onDragEnd={dragEnd} onClick={mobileActivate(() => beginMobilePlacement({ kind: "palette-block", id: type, label }))}><Icon/><span><strong>{label}</strong><small>{hint}</small></span><GripVertical aria-hidden="true"/></button>)}
          <h2>Patterns</h2>
          {PATTERNS.map((item) => <button className="landing-pattern-card" key={item.id} draggable data-palette-kind="palette-pattern" data-palette-id={item.id} data-pattern-group={item.group} onDragStart={dragStart} onDragEnd={dragEnd} onClick={mobileActivate(() => beginMobilePlacement({ kind: "palette-pattern", id: item.id, label: item.label }))}><MobilePatternPreview type={item.preview}/><span><small>{item.group}</small><strong>{item.label}</strong></span><GripVertical aria-hidden="true"/></button>)}
        </>}
      </aside>
      {mobileAddOpen && typeof document !== "undefined" && createPortal(<div className="orvesen-mobile-add-layer" role="presentation">
        <button type="button" className="orvesen-mobile-add-backdrop" aria-label="Cerrar panel" onClick={closeMobileTools}/>
        <section className="orvesen-mobile-add-sheet" role="dialog" aria-modal="true" aria-label={globalStylesOpen ? "Estilos de página" : "Añadir contenido"} onClick={(event) => event.stopPropagation()}>
          <div className="orvesen-mobile-add-grab"><span/></div>
          <div className="orvesen-mobile-add-tabs">
            <button type="button" className={!globalStylesOpen ? "is-active" : ""} onClick={() => setGlobalStylesOpen(false)}>＋ Añadir</button>
            <button type="button" className={globalStylesOpen ? "is-active" : ""} onClick={() => setGlobalStylesOpen(true)}>Estilos de página</button>
            <button type="button" className="orvesen-mobile-add-close" onClick={closeMobileTools} aria-label="Cerrar">×</button>
          </div>
          <div className="orvesen-mobile-add-scroll">
            {globalStylesOpen ? <DesignControls document={state.document} replace={replace} onInsertSavedButton={insertSavedButton} onStartLibraryDrag={startLibraryDrag}/> : <>
              <div className="orvesen-mobile-add-heading"><span>AÑADIR</span><h2>Elementos</h2><small>Toca un elemento para añadirlo al canvas.</small></div>
              <div className="orvesen-mobile-add-grid">
                {BLOCKS.map(({ type, label, hint, Icon }) => <button type="button" key={type} className="orvesen-mobile-add-item" onClick={mobileActivate(() => beginMobilePlacement({ kind: "palette-block", id: type, label }))}><Icon/><span><strong>{label}</strong><small>{hint}</small></span></button>)}
              </div>
              <div className="orvesen-mobile-add-heading orvesen-mobile-pattern-heading"><h2>Patterns</h2><small>Toca una estructura para insertarla completa.</small></div>
              <div className="orvesen-mobile-pattern-list">
                {PATTERNS.map((item) => <button type="button" className="orvesen-mobile-pattern-item" key={item.id} onClick={mobileActivate(() => beginMobilePlacement({ kind: "palette-pattern", id: item.id, label: item.label }))}><MobilePatternPreview type={item.preview}/><span><small>{item.group}</small><strong>{item.label}</strong></span></button>)}
              </div>
            </>}
          </div>
        </section>
      </div>, document.body)}
      <main className={`landing-canvas-shell ${dragState.payload ? "is-dragging" : ""}`}><div className={`landing-viewport landing-viewport-${state.preview}`}><span className="landing-viewport-label">{state.preview} preview</span><div className={`landing-page-frame landing-preview-${state.preview}`} onClick={canvasClick} onDragStart={dragStart} onDragEnd={dragEnd} onDragOver={dragOver} onDrop={drop}>{!state.document.sections.length ? <div className="landing-empty" data-drop-kind="canvas-end"><Layers3/><h2>Comienza tu página</h2><p>Añade una estructura clara y conviértela en una experiencia real.</p><div><button onClick={(event) => { event.stopPropagation(); addPattern("hero"); }}>Añadir Hero</button><button onClick={(event) => { event.stopPropagation(); apply({ type: "add_section", section: newSection() }, "insert"); }}>Añadir sección</button></div></div> : <LandingRenderer document={state.document} editorMode selection={state.selection} editorActions={editorActions} renderField={(props) => <InlineEditableField {...props} editing={editing} onBegin={beginInlineEdit} onChange={updateInlineField} onEnd={() => setEditing(null)}/>} resolveForm={(id, label) => <div className="landing-form-preview"><strong>Form</strong><span>{forms.find((form) => form.id === id)?.name || "Sin formulario asignado"}</span><small>{label}</small></div>}/>}</div></div><output className="landing-editor-announcement" aria-live="polite">{dragState.target ? "Destino de inserción seleccionado" : validation.valid ? "Documento válido" : `${validation.errors.length} errores de documento`}</output></main>
      {state.selection?.kind === "block" && selected && !panelOpen && <ContextualStyleToolbar
        selection={state.selection}
        selected={selected}
        apply={apply}
        buttonDefaults={state.document.settings.design_system.buttons || {}}
        onMore={() => openPanel(state.selection)}
        onDuplicate={() => duplicateSelection(state.selection)}
        onDelete={() => removeSelection(state.selection)}
        onClose={() => { setEditing(null); setPanelOpen(false); dispatch({ type: "select", selection: null }); }}
        position={toolbarPosition}
        onTogglePosition={() => setToolbarPosition((value) => value === "top" ? "bottom" : "top")}
      />}
      {panelOpen && state.selection && <Inspector selection={state.selection} selected={selected} forms={forms} apply={apply} preview={state.preview} onDelete={() => removeSelection(state.selection)} onDuplicate={() => duplicateSelection(state.selection)} onMove={(delta) => moveSelection(state.selection, delta)} onClose={() => setPanelOpen(false)}/>}
    </div>
    {pendingInsert && <div className="landing-mobile-placement-bar" role="status" aria-live="polite">
      <div><small>COLOCANDO</small><strong>{pendingInsert.label || (pendingInsert.kind === "palette-pattern" ? "Pattern" : "Elemento")}</strong><span>Toca una zona “+ Colocar aquí”.</span></div>
      <button type="button" onClick={cancelMobilePlacement}>Cancelar</button>
    </div>}
    <nav className="landing-mobile-context" aria-label="Herramientas principales" onClick={(event) => event.stopPropagation()}>
      <button type="button" onClick={mobileActivate(() => { setPanelOpen(false); setEditing(null); setGlobalStylesOpen(false); setMobileAddOpen(true); })}>＋ Añadir</button>
      <button type="button" onClick={mobileActivate(() => { setPanelOpen(false); setEditing(null); setGlobalStylesOpen(true); setMobileAddOpen(true); })}>Estilos de página</button>
      <button type="button" onClick={() => dispatch({ type: "preview", preview: state.preview === "mobile" ? "desktop" : "mobile" })}>Preview</button>
      {state.selection?.kind === "section" && <button type="button" onClick={() => openPanel(state.selection)}>Editar sección</button>}
    </nav>
  </div>;
}


function InlineEditableField({ block, field, value, index, singleLine = false, placeholder = "Escribe aquí", editing, onBegin, onChange, onEnd }) {
  const ref = useRef(null);
  const active = editing?.blockId === block.id && editing?.field === field && editing?.index === index;
  const wasActiveRef = useRef(false);
  useEffect(() => {
    if (active && !wasActiveRef.current && ref.current) {
      ref.current.focus();
      const selection = window.getSelection(); const range = document.createRange();
      range.selectNodeContents(ref.current); range.collapse(false); selection?.removeAllRanges(); selection?.addRange(range);
    }
    wasActiveRef.current = active;
  }, [active]);
  useEffect(() => {
    if (!ref.current) return;
    if (!active && ref.current.textContent !== value) ref.current.textContent = value;
  }, [active, value]);
  const descriptor = { blockId: block.id, field, index };
  const begin = (event) => {
    event.stopPropagation();
    if (!active) onBegin(descriptor);
  };
  const input = (event) => onChange({ ...descriptor, value: event.currentTarget.textContent || "" });
  const keyDown = (event) => { if (singleLine && event.key === "Enter") { event.preventDefault(); event.currentTarget.blur(); } if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); event.currentTarget.blur(); } };
  const paste = (event) => { event.preventDefault(); const text = event.clipboardData.getData("text/plain"); const selection = window.getSelection(); if (!selection?.rangeCount) return; selection.deleteFromDocument(); const range = selection.getRangeAt(0); const node = document.createTextNode(singleLine ? text.replace(/[\r\n]+/g, " ") : text); range.insertNode(node); range.setStartAfter(node); range.collapse(true); selection.removeAllRanges(); selection.addRange(range); event.currentTarget.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertFromPaste", data: text })); };
  return <span ref={ref} className={`landing-inline-field ${active ? "is-editing" : ""}`} data-edit-field={field} data-edit-index={index} contentEditable={active} suppressContentEditableWarning role="textbox" aria-label={`Editar ${field}`} aria-multiline={!singleLine} tabIndex={0} onPointerDown={(event) => event.stopPropagation()} onClick={begin} onFocus={begin} onInput={input} onKeyDown={keyDown} onPaste={paste} onBlur={onEnd} data-placeholder={placeholder}></span>;
}


const QUICK_FONTS = [
  ["inherit", "Página", "Aa"],
  ["sans", "Sans", "Aa"],
  ["serif", "Serif", "Aa"],
  ["display", "Display", "Aa"],
  ["mono", "Mono", "Aa"],
];
const QUICK_COLORS = [
  ["text", "Texto principal"],
  ["muted", "Secundario"],
  ["primary", "Acento"],
];

function QuickPopover({ id, openMenu, setOpenMenu, label, trigger, children }) {
  const open = openMenu === id;
  const close = () => setOpenMenu(null);
  return <div className={`landing-quick-popover ${open ? "is-open" : ""}`}>
    <button type="button" className="landing-quick-trigger" aria-expanded={open} onClick={(event) => { event.stopPropagation(); setOpenMenu(open ? null : id); }}>{trigger}<span className="landing-quick-chevron">⌄</span></button>
    {open && typeof document !== "undefined" && createPortal(
      <><button type="button" className="landing-quick-portal-backdrop" aria-label="Cerrar opciones" onClick={close}/><div className="landing-quick-popover-panel landing-quick-portal-panel" onClick={(event) => event.stopPropagation()}>{label && <strong>{label}</strong>}{children}</div></>,
      document.body
    )}
  </div>;
}

function ContextualStyleToolbar({ selection, selected, apply, buttonDefaults = {}, onMore, onDuplicate, onDelete, onClose, position = "top", onTogglePosition }) {
  const [openMenu, setOpenMenu] = useState(null);
  const [actionIndex, setActionIndex] = useState(0);
  if (!selection || selection.kind !== "block" || !selected?.block) return null;
  const block = selected.block;
  const style = block.style || {};
  const updateStyle = (changes) => apply({ type:"update_block_style", block_id:block.id, changes }, `quick-style-${block.id}`, 600);
  const resetGlobal = () => apply({ type:"reset_block_style", block_id:block.id }, `quick-global-${block.id}`, 600);

  if (block.type === "action_group") {
    const actions = block.content.actions || [];
    const active = actions[Math.min(actionIndex, Math.max(0, actions.length - 1))];
    const updateAction = (changes) => {
      const next = actions.map((item,index) => index === actionIndex ? { ...item, ...changes } : item);
      apply({ type:"update_block_content", block_id:block.id, changes:{ actions:next } }, `button-${block.id}-${actionIndex}`, 600);
    };
    const saveCurrent = () => {
      if (!active) return;
      const name = window.prompt("Nombre para guardar este botón:", active.label || "Mi botón");
      if (!name?.trim()) return;
      let library=[]; try { library=JSON.parse(localStorage.getItem("orvesen.builder.buttonStyles.v1") || "[]"); } catch {}
      const item={ id:createBuilderId(), name:name.trim(), style:{...buttonDefaults, ...active} };
      localStorage.setItem("orvesen.builder.buttonStyles.v1", JSON.stringify([item,...library].slice(0,40)));
      window.dispatchEvent(new Event("orvesen-button-library-updated"));
    };
    return <div className={`landing-quick-toolbar landing-button-context is-${position}`} role="toolbar" aria-label="Editar botón" onClick={(e)=>e.stopPropagation()}>
      {actions.length > 1 && <QuickPopover id="which" openMenu={openMenu} setOpenMenu={setOpenMenu} label="Botón" trigger={<span>{active?.label || "Botón"}</span>}>
        <div className="landing-option-list">{actions.map((item,index)=><button key={index} type="button" className={actionIndex===index?"is-active":""} onClick={()=>{setActionIndex(index);setOpenMenu(null)}}>{item.label}</button>)}</div>
      </QuickPopover>}
      <QuickPopover id="text" openMenu={openMenu} setOpenMenu={setOpenMenu} label="Texto del botón" trigger={<span>Texto</span>}>
        <label className="landing-context-field">Texto<input value={active?.label || ""} onChange={(e)=>updateAction({label:e.target.value})}/></label>
      </QuickPopover>
      <QuickPopover id="action" openMenu={openMenu} setOpenMenu={setOpenMenu} label="Acción" trigger={<span>Acción</span>}>
        <div className="landing-action-editor">
          <label>Enlace / destino<input value={active?.href || ""} placeholder="https://... o #seccion" onChange={(e)=>updateAction({href:e.target.value})}/></label>
          <small>Usa una URL, #seccion para ir a una parte de esta página, mailto: o tel:.</small>
        </div>
      </QuickPopover>
      <QuickPopover id="design" openMenu={openMenu} setOpenMenu={setOpenMenu} label="Diseño" trigger={<span>Diseño</span>}>
        <div className="landing-button-direct-panel">
          <span>Estilo</span><div className="landing-button-direct-grid">{[["primary","Sólido"],["secondary","Suave"],["outline","Outline"],["ghost","Minimal"]].map(([id,label])=><button key={id} type="button" className={(active?.variant||"primary")===id?"is-active":""} onClick={()=>updateAction({variant:id})}>{label}</button>)}</div>
          <span>Forma</span><div className="landing-button-direct-grid">{[["none","Recto"],["sm","Sutil"],["md","Medio"],["lg","Redondo"],["pill","Píldora"]].map(([id,label])=><button key={id} type="button" className={(active?.radius||"md")===id?"is-active":""} onClick={()=>updateAction({radius:id})}>{label}</button>)}</div>
          <span>Tamaño</span><div className="landing-button-direct-grid">{[["sm","Pequeño"],["md","Mediano"],["lg","Grande"]].map(([id,label])=><button key={id} type="button" className={(active?.size||"md")===id?"is-active":""} onClick={()=>updateAction({size:id})}>{label}</button>)}</div>
          <span>Sombra</span><div className="landing-button-direct-grid">{[["none","Ninguna"],["subtle","Sutil"],["soft","Suave"],["medium","Intensa"]].map(([id,label])=><button key={id} type="button" className={(active?.shadow||"none")===id?"is-active":""} onClick={()=>updateAction({shadow:id})}>{label}</button>)}</div>
          <span>Ancho</span><div className="landing-button-direct-grid">{[["auto","Automático"],["full","Completo"]].map(([id,label])=><button key={id} type="button" className={(active?.width||"auto")===id?"is-active":""} onClick={()=>updateAction({width:id})}>{label}</button>)}</div>
        </div>
      </QuickPopover>
      <div className="landing-button-align" aria-label="Alineación del botón">{[["start","Izquierda","≡"],["center","Centro","≣"],["end","Derecha","≡"]].map(([id,label,glyph])=><button key={id} type="button" className={(style.align||"start")===id?"is-active":""} title={label} aria-label={label} onClick={()=>updateStyle({align:id})}><span className={`landing-align-glyph is-${id}`}>{glyph}</span></button>)}</div>
      <button type="button" onClick={saveCurrent}>Guardar</button>
      <QuickPopover id="more" openMenu={openMenu} setOpenMenu={setOpenMenu} trigger={<span>•••</span>}>
        <div className="landing-option-list"><button type="button" onClick={onMore}>Opciones avanzadas</button><button type="button" onClick={onDuplicate}>Duplicar bloque</button><button type="button" className="is-danger" onClick={onDelete}>Eliminar bloque</button></div>
      </QuickPopover>
      <button type="button" className="landing-quick-move" onClick={onTogglePosition} title="Mover barra">{position === "top" ? "↓" : "↑"}</button><button type="button" className="landing-quick-close" onClick={onClose}>×</button>
    </div>;
  }

  const typography = block.type === "heading" || block.type === "text";
  if (!typography) return <div className={`landing-quick-toolbar is-${position}`} role="toolbar" aria-label="Edición del bloque" onClick={(e)=>e.stopPropagation()}>
    <span className="landing-quick-kind">{block.type === "image" ? "Imagen" : block.type === "testimonial" ? "Testimonio" : "Bloque"}</span>
    <button type="button" onClick={resetGlobal}>Restablecer diseño</button>
    <button type="button" onClick={onMore}>Editar bloque</button>
    <button type="button" onClick={onDuplicate}>Duplicar</button>
    <button type="button" className="is-danger" onClick={onDelete}>Eliminar</button>
    <button type="button" className="landing-quick-move" onClick={onTogglePosition} title="Mover barra">{position === "top" ? "↓" : "↑"}</button><button type="button" className="landing-quick-close" onClick={onClose}>×</button>
  </div>;

  const size = block.type === "text" ? (style.text_variant || "body") : (style.text_size || "auto");
  const sizes = block.type === "text" ? [["lead","Grande"],["body","Normal"],["small","Pequeño"]] : [["auto","Página"],["xs","XS"],["sm","S"],["md","M"],["lg","L"],["xl","XL"],["2xl","2XL"]];
  return <div className={`landing-quick-toolbar is-${position}`} role="toolbar" aria-label="Formato de texto" onClick={(e)=>e.stopPropagation()}>
    <button type="button" className={!Object.keys(style).length ? "is-active" : ""} onClick={resetGlobal}>Restablecer</button>
    <QuickPopover id="font" openMenu={openMenu} setOpenMenu={setOpenMenu} label="Tipografía" trigger={<><span className="landing-font-preview">Aa</span><span>{QUICK_FONTS.find(([id])=>id===(style.font_family||"inherit"))?.[1]||"Página"}</span></>}>
      <div className="landing-font-list">{QUICK_FONTS.map(([id,label,sample])=><button key={id} type="button" className={`${style.font_family===id||(!style.font_family&&id==="inherit")?"is-active":""} font-${id}`} onClick={()=>{updateStyle({font_family:id});setOpenMenu(null)}}><span>{sample}</span><strong>{label}</strong></button>)}</div>
    </QuickPopover>
    <QuickPopover id="size" openMenu={openMenu} setOpenMenu={setOpenMenu} label="Tamaño" trigger={<span>{sizes.find(([id])=>id===size)?.[1]||"Página"}</span>}>
      <div className="landing-option-grid">{sizes.map(([id,label])=><button key={id} type="button" className={size===id?"is-active":""} onClick={()=>{updateStyle(block.type==="text"?{text_variant:id}:{text_size:id==="auto"?undefined:id});setOpenMenu(null)}}>{label}</button>)}</div>
    </QuickPopover>
    <button type="button" className={`landing-quick-bold ${style.text_weight==="bold"?"is-active":""}`} onClick={()=>updateStyle({text_weight:style.text_weight==="bold"?undefined:"bold"})}>B</button>
    <QuickPopover id="color" openMenu={openMenu} setOpenMenu={setOpenMenu} label="Color" trigger={<><span className={`landing-color-dot is-${style.color||"text"}`}/><span>{style.color==="muted"?"Secundario":style.color==="primary"?"Marca":"Texto principal"}</span></>}>
      <div className="landing-color-list">{QUICK_COLORS.map(([id,label])=><button key={id} type="button" className={style.color===id||(!style.color&&id==="text")?"is-active":""} onClick={()=>{updateStyle({color:id});setOpenMenu(null)}}><span className={`landing-color-swatch is-${id}`}/><strong>{label}</strong></button>)}</div>
    </QuickPopover>
    <div className="landing-quick-align">{[["start","Izquierda","≡"],["center","Centro","≣"],["end","Derecha","≡"]].map(([id,label,glyph])=><button key={id} type="button" className={(style.align||"start")===id?"is-active":""} title={label} onClick={()=>updateStyle({align:id})}><span className={`landing-align-glyph is-${id}`}>{glyph}</span></button>)}</div>
    <QuickPopover id="more" openMenu={openMenu} setOpenMenu={setOpenMenu} trigger={<span>•••</span>}><div className="landing-option-list"><button type="button" onClick={onMore}>Opciones avanzadas</button><button type="button" onClick={onDuplicate}>Duplicar bloque</button><button type="button" className="is-danger" onClick={onDelete}>Eliminar bloque</button></div></QuickPopover>
    <button type="button" className="landing-quick-move" onClick={onTogglePosition} title="Mover barra">{position === "top" ? "↓" : "↑"}</button><button type="button" className="landing-quick-close" onClick={onClose}>×</button>
  </div>;
}

function MobilePatternPreview({ type }) {
  const cells = type === "faq" ? 4 : ["logos","stats","cards","quotes","pricing"].includes(type) ? 3 : 2;
  return <span className="orvesen-pattern-visual" data-type={type} aria-hidden="true">
    <i className="orvesen-pattern-visual-head"/>
    <b>{Array.from({ length: cells }, (_, index) => <em key={index}/>)}</b>
    <i className="orvesen-pattern-visual-action"/>
  </span>;
}

function PatternPreview({ type }) {
  const count = ["cards", "pricing", "logos", "stats", "quotes"].includes(type) ? 3 : type === "faq" ? 4 : 2;
  return <span className="landing-pattern-preview" data-preview={type} aria-hidden="true"><i/><b>{Array.from({ length: count }, (_, index) => <em key={index}/>)}</b></span>;
}

function DesignControls({ document, replace, onInsertSavedButton, onStartLibraryDrag }) {
  const design=document.settings.design_system;
  const [tab,setTab]=useState("typography");
  const [fontSearch,setFontSearch]=useState("");
  const [savedButtons,setSavedButtons]=useState([]);
  useEffect(()=>{
    const load=()=>{try{setSavedButtons(JSON.parse(localStorage.getItem("orvesen.builder.buttonStyles.v1")||"[]"))}catch{setSavedButtons([])}};
    load(); window.addEventListener("orvesen-button-library-updated",load); return()=>window.removeEventListener("orvesen-button-library-updated",load);
  },[]);
  const update=(category,key,value)=>{const next=structuredClone(document);next.settings.design_system[category][key]=value;replace(next,`design-${category}-${key}`,600)};
  const fonts=[
    ["Inter","Inter, system-ui, sans-serif"],["Arial","Arial, Helvetica, sans-serif"],["Helvetica","Helvetica, Arial, sans-serif"],
    ["Georgia","Georgia, serif"],["Times New Roman",'"Times New Roman", Times, serif'],["Garamond","Garamond, Georgia, serif"],
    ["Trebuchet","Trebuchet MS, Arial, sans-serif"],["Verdana","Verdana, Geneva, sans-serif"],["Tahoma","Tahoma, Arial, sans-serif"],
    ["Courier","Courier New, monospace"],["Impact","Impact, Haettenschweiler, sans-serif"],["Palatino","Palatino Linotype, Book Antiqua, serif"]
  ].filter(([name])=>name.toLowerCase().includes(fontSearch.toLowerCase()));
  const applySaved=(item)=>{const next=structuredClone(document);next.settings.design_system.buttons={...item.style};replace(next,"design-button-library",600)};
  const removeSaved=(id)=>{const next=savedButtons.filter(x=>x.id!==id);setSavedButtons(next);localStorage.setItem("orvesen.builder.buttonStyles.v1",JSON.stringify(next))};

  return <div className="landing-global-styles landing-global-v3">
    <header className="landing-global-header"><span>ESTILOS DE PÁGINA</span><strong>Diseña toda la página</strong><p>Define la apariencia general de la página. Al seleccionar un elemento puedes personalizarlo.</p></header>
    <nav className="landing-global-nav">
      {[["typography","Tipografía"],["colors","Colores"],["buttons","Botones"],["layout","Diseño"],["library","Biblioteca"]].map(([id,label])=><button key={id} type="button" className={tab===id?"is-active":""} onClick={()=>setTab(id)}>{label}</button>)}
    </nav>

    {tab==="typography"&&<section className="landing-global-section">
      <div className="landing-global-section-title"><strong>Tipografía</strong><small>Busca y escoge viendo cada fuente</small></div>
      <input className="landing-font-search" value={fontSearch} onChange={(e)=>setFontSearch(e.target.value)} placeholder="Buscar tipografía..."/>
      <span className="landing-global-label">Aplicar a texto general</span>
      <div className="landing-font-browser">{fonts.map(([name,value])=><button key={`body-${name}`} type="button" style={{fontFamily:value}} className={design.typography.body===value?"is-active":""} onClick={()=>update("typography","body",value)}><strong>{name}</strong><span>La creatividad empieza aquí</span></button>)}</div>
      <span className="landing-global-label">Aplicar a títulos</span>
      <div className="landing-font-browser">{fonts.map(([name,value])=><button key={`head-${name}`} type="button" style={{fontFamily:value}} className={(design.typography.headings||design.typography.body)===value?"is-active":""} onClick={()=>update("typography","headings",value)}><strong>{name}</strong><span>Construye algo extraordinario</span></button>)}</div>
    </section>}

    {tab==="colors"&&<section className="landing-global-section">
      <div className="landing-global-section-title"><strong>Colores de página</strong><small>Cambia el rol una vez; todos los elementos vinculados responden</small></div>
      <div className="landing-global-color-rows">{[["page_background","Fondo de página","#ffffff"],["surface","Superficie / tarjetas","#ffffff"],["text","Texto principal","#151515"],["muted","Texto secundario","#6b6b6b"],["primary","Marca / acción","#9b7618"]].map(([key,label,fallback])=><label key={key}><input type="color" value={design.colors[key]||fallback} onChange={(e)=>update("colors",key,e.target.value)}/><span><strong>{label}</strong><small>{design.colors[key]||fallback}</small></span></label>)}</div>
    </section>}

    {tab==="buttons"&&<section className="landing-global-section">
      <div className="landing-global-section-title"><strong>Estilo base de botones</strong><small>Los botones sin personalización heredan este estilo</small></div>
      <div className="landing-button-hero"><span className="landing-button-live-preview" data-variant={design.buttons.variant||"primary"} data-size={design.buttons.size||"md"} data-radius={design.buttons.radius||"md"} data-shadow={design.buttons.shadow||"none"}>Comenzar</span><small>Vista previa</small></div>
      <span className="landing-global-label">Estilo</span><div className="landing-option-chips">{[["primary","Sólido"],["secondary","Suave"],["outline","Outline"],["ghost","Minimal"]].map(([id,label])=><button key={id} type="button" className={(design.buttons.variant||"primary")===id?"is-active":""} onClick={()=>update("buttons","variant",id)}>{label}</button>)}</div>
      <span className="landing-global-label">Forma</span><div className="landing-option-chips">{[["none","Recto"],["sm","Sutil"],["md","Medio"],["lg","Redondo"],["pill","Píldora"]].map(([id,label])=><button key={id} type="button" className={(design.buttons.radius||"md")===id?"is-active":""} onClick={()=>update("buttons","radius",id)}>{label}</button>)}</div>
      <span className="landing-global-label">Sombra / profundidad</span><div className="landing-option-chips">{[["none","Ninguna"],["subtle","Sutil"],["soft","Suave"],["medium","Intensa"]].map(([id,label])=><button key={id} type="button" className={(design.buttons.shadow||"none")===id?"is-active":""} onClick={()=>update("buttons","shadow",id)}>{label}</button>)}</div>
      <span className="landing-global-label">Tamaño</span><div className="landing-option-chips">{[["sm","Pequeño"],["md","Mediano"],["lg","Grande"]].map(([id,label])=><button key={id} type="button" className={(design.buttons.size||"md")===id?"is-active":""} onClick={()=>update("buttons","size",id)}>{label}</button>)}</div>
    </section>}

    {tab==="layout"&&<section className="landing-global-section"><div className="landing-global-section-title"><strong>Diseño general</strong><small>Base espacial de la landing</small></div><label className="landing-global-select">Ancho<select value={design.content_widths.standard||"1120px"} onChange={(e)=>update("content_widths","standard",e.target.value)}><option value="960px">Compacto</option><option value="1120px">Estándar</option><option value="1280px">Amplio</option></select></label><label className="landing-global-select">Tarjetas<select value={design.radii.card||"16px"} onChange={(e)=>update("radii","card",e.target.value)}><option value="8px">Sutil</option><option value="16px">Estándar</option><option value="24px">Redondeado</option></select></label></section>}

    {tab==="library"&&<section className="landing-global-section"><div className="landing-global-section-title"><strong>Mi biblioteca</strong><small>Diseños guardados desde elementos del canvas</small></div>{savedButtons.length===0?<div className="landing-library-empty"><strong>No hay diseños todavía</strong><span>Toca un botón del canvas y pulsa Guardar.</span></div>:<div className="landing-style-library">{savedButtons.map(item=><div className="landing-library-card" key={item.id}><button type="button" draggable className="landing-library-apply" onDragStart={(e)=>onStartLibraryDrag?.(e,item)} onClick={()=>onInsertSavedButton?.(item)}><span className="landing-library-button" data-variant={item.style.variant||"primary"} data-size={item.style.size||"md"} data-width={item.style.width||"auto"} data-radius={item.style.radius||"md"} data-shadow={item.style.shadow||"none"} data-border={item.style.border||"none"} style={{
              background:item.style.background || ((item.style.variant||"primary")==="primary" ? (design.colors.primary||"#9b7618") : "transparent"),
              color:item.style.text_color || ((item.style.variant||"primary")==="primary" ? "#ffffff" : (design.colors.primary||"#9b7618")),
              borderColor:item.style.border_color || (design.colors.primary||"#9b7618")
            }}>{item.style.label||"Comenzar"}</span><strong>{item.name}</strong><small>Arrastra o toca para añadir</small></button><button type="button" className="landing-library-delete" onClick={()=>removeSaved(item.id)}>×</button></div>)}</div>}</section>}
  </div>;
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
    const regions = spans.map((span, index) => ({ id: section.regions[index]?.id || createBuilderId(), span, blocks: index === 0 ? blocks : [] }));
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

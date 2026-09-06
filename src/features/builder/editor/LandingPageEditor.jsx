import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { AlignCenter, AlignLeft, AlignRight, ArrowDown, ArrowLeft, ArrowUp, Copy, GripVertical, Heading, Image, Layers3, Maximize2, Monitor, MousePointerClick, Palette, Pilcrow, Redo2, Smartphone, Tablet, Trash2, Type, Undo2, Waypoints } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { createPortal } from "react-dom";
import { createPrimitiveBlock, validateLandingDocument } from "../document/landingDocument.js";
import { APPEARANCE_PRESETS, GRADIENT_PRESETS, GLOW_TOKENS, SHADOW_TOKENS } from "../document/visualAppearance.js";
import { applyLandingOperations } from "../document/landingOperations.js";
import { createLandingPattern, LANDING_PATTERN_CATALOG } from "../document/landingPatterns.js";
import LandingRenderer from "../renderer/LandingRenderer.jsx";
import "../renderer/LandingRenderer.css";
import { listBuilderAssets, loadBuilderAssetDraft, saveBuilderAssetDraft, saveBuilderFormDraft } from "../services/BuilderAssetService.js";
import FormRenderer from "../form/FormRenderer.jsx";
import { createFormField } from "../form/formDocument.js";
import { createLandingAutosave } from "./landingAutosave.js";
import { calculateAutoScrollVelocity, sameLandingDropTarget } from "./landingAutoScroll.js";
import { applyLandingDrop, decodeLandingDrag, encodeLandingDrag, isValidLandingDrop, LANDING_DRAG_TYPE } from "./landingDnD.js";
import { duplicateEditorSelection, findEditorSelection, landingEditorReducer, moveEditorSelection } from "./landingEditorState.js";
import { getBlockToolbarControls, toolbarDeleteNeedsConfirmation } from "./landingToolbarControls.js";
import "./LandingEditor.css";
import "./ElementControlsV4.css";
import "./BuilderControlsV5.css";
import "./BuilderInteractionV6.css";
import "./BuilderPricingTypographyV7.css";
import "./BuilderHeaderFormsV8.css";
import "./BuilderFormConnectionV9.css";
import "./BuilderFormConnectionV11.css";
import "./BuilderContextToolbarV12.css";
import "../renderer/LandingRendererV4.css";

const BLOCKS = [
  { type: "site_header", label: "Header", hint: "Navegación responsive", Icon: Layers3 },
  { type: "heading", label: "Heading", hint: "Título semántico", Icon: Heading },
  { type: "text", label: "Text", hint: "Párrafo editorial", Icon: Pilcrow },
  { type: "image", label: "Image", hint: "Visual responsive", Icon: Image },
  { type: "action_group", label: "Actions", hint: "Botones de acción", Icon: MousePointerClick },
  { type: "form_reference", label: "Formulario", hint: "Conecta un formulario creado", Icon: Waypoints },
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
const HEADER_PATTERN = { id: "site_header", group: "Header", label: "Navegación principal", preview: "header", hint: "Header" };
const PATTERNS = [HEADER_PATTERN, ...LANDING_PATTERN_CATALOG.map((pattern) => ({ ...pattern, hint: pattern.group }))];
const safeAnchor = (value, fallback = "seccion") => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 64) || fallback;
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
  const [pages, setPages] = useState([]);
  const [localConflictDocument, setLocalConflictDocument] = useState(null);
  const [dragState, setDragState] = useState({ payload: null, target: null });
  const [editing, setEditing] = useState(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [mobileAddOpen, setMobileAddOpen] = useState(false);
  const [globalStylesOpen, setGlobalStylesOpen] = useState(false);
  const [toolbarPosition, setToolbarPosition] = useState("top");
  const [pendingInsert, setPendingInsert] = useState(null);
  const [elementSearch, setElementSearch] = useState("");
  const autosaveRef = useRef(null); const saveDelayRef = useRef(600); const stateRef = useRef(null); const dragRef = useRef(null);
  const formsRef = useRef([]); const formSaveQueuesRef = useRef(new Map()); const formRevisionsRef = useRef(new Map());
  const libraryDragRef = useRef(null);
  const canvasShellRef = useRef(null);
  const autoScrollRef = useRef({ frame: null, pointerY: null });

  useEffect(() => {
    let active = true;
    Promise.all([loadBuilderAssetDraft(asset.id), listBuilderAssets({ assetType: "form", includeArchived: false }), listBuilderAssets({ assetType: "landing_page", includeArchived: false })]).then(async ([draft, formAssets, pageAssets]) => {
      const hydratedForms = await Promise.all(formAssets.map(async (form) => {
        try { const formDraft = await loadBuilderAssetDraft(form.id); return { ...form, draft: formDraft.document, draft_revision: formDraft.revision }; }
        catch { return { ...form, draft: null }; }
      }));
      if (!active) return;
      dispatch({ type: "remote", draft }); setForms(hydratedForms); formRevisionsRef.current = new Map(hydratedForms.map((form)=>[form.id,form.draft_revision])); setPages(pageAssets.filter((page) => page.id !== asset.id));
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
  useEffect(() => { formsRef.current = forms; }, [forms]);
  useEffect(() => {
    const beforeUnload = (event) => { if (stateRef.current?.dirty || status === "saving") { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("beforeunload", beforeUnload); return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [status]);

  const apply = useCallback((operation, group = null, delay = 220) => { saveDelayRef.current = delay; dispatch({ type: "operation", operation, group }); }, []);
  const replace = useCallback((document, group = null, delay = 220) => { saveDelayRef.current = delay; dispatch({ type: "replace", document, group }); }, []);
  const selected = useMemo(() => state ? findEditorSelection(state.document, state.selection) : null, [state]);
  const selectedRegion = selected?.region || (state?.selection?.kind === "section" ? selected?.regions?.[0] : null) || state?.document.sections.at(-1)?.regions?.[0];
  const currentPreview = state?.preview;
  const normalizedElementSearch = elementSearch.trim().toLowerCase();
  const filteredBlocks = useMemo(() => !normalizedElementSearch ? BLOCKS : BLOCKS.filter((item) => `${item.label} ${item.hint} ${item.type}`.toLowerCase().includes(normalizedElementSearch)), [normalizedElementSearch]);
  const filteredPatterns = useMemo(() => !normalizedElementSearch ? PATTERNS : PATTERNS.filter((item) => `${item.label} ${item.group} ${item.id}`.toLowerCase().includes(normalizedElementSearch)), [normalizedElementSearch]);

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
    const current = findEditorSelection(stateRef.current?.document, selection);
    const block = selection.kind === "block" ? current?.block : null;
    if (toolbarDeleteNeedsConfirmation(block) && !window.confirm("¿Eliminar este Header? Se perderán su navegación, marca y configuración interna.")) return;
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
    if (!currentPreview || typeof window === "undefined") return undefined;
    const media = window.matchMedia("(max-width: 900px)");
    const syncMobilePreview = () => {
      if (media.matches && currentPreview !== "mobile") dispatch({ type: "preview", preview: "mobile" });
    };
    syncMobilePreview();
    media.addEventListener?.("change", syncMobilePreview);
    return () => media.removeEventListener?.("change", syncMobilePreview);
  }, [currentPreview]);

  function createPattern(id) {
    if (id === "site_header") {
      const block = (type, content) => createPrimitiveBlock(type, createBuilderId(), content);
      return {
        id: createBuilderId(),
        layout: "stack",
        style: {
          content_width: "wide",
          align: "center",
          padding_top: "xs",
          padding_bottom: "xs",
          background: { type: "solid", color: "surface" },
        },
        regions: [{ id: createBuilderId(), span: 12, blocks: [block("site_header")] }],
      };
    }
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
    setElementSearch("");
  }

  const mobileActivate = (handler) => (event) => {
    event.stopPropagation();
    handler();
  };

  function addBlock(type) {
    const current = stateRef.current?.document || state.document;
    if (!current) return;
    const blockId = createBuilderId();
    let targetRegion = selectedRegion;
    let insertIndex;

    if (state.selection?.kind === "block" && selected?.block && selected?.region) {
      targetRegion = selected.region;
      const anchorIndex = targetRegion.blocks.findIndex((item) => item.id === selected.block.id);
      insertIndex = anchorIndex >= 0 ? anchorIndex + 1 : targetRegion.blocks.length;
    } else if (state.selection?.kind === "section" && selected?.regions?.[0]) {
      targetRegion = selected.regions[0];
      insertIndex = targetRegion.blocks.length;
    } else if (targetRegion) {
      insertIndex = targetRegion.blocks.length;
    }

    let next;
    if (!targetRegion) {
      const section = newSection();
      next = applyLandingOperations(current, [
        { type: "add_section", section },
        { type: "add_block", region_id: section.regions[0].id, block_type: type, block_id: blockId },
      ]);
    } else {
      next = applyLandingOperations(current, [{
        type: "add_block",
        region_id: targetRegion.id,
        block_type: type,
        block_id: blockId,
        index: insertIndex,
      }]);
    }

    replace(next, "insert", 120);
    dispatch({ type: "select", selection: { kind: "block", id: blockId } });
    closeMobileTools();
    if (type === "form_reference") {
      setEditing(null);
      setPanelOpen(true);
    }
    requestAnimationFrame(() => revealInserted("block", blockId));
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
  }
  function placePendingInsert(target) {
    const payload = pendingInsert;
    const current = stateRef.current?.document || state.document;
    if (!payload || !current || !target) return;

    if (payload.kind === "palette-block") {
      if (target.kind === "canvas-end") {
        const before = new Set(current.sections.flatMap((section) => section.regions.flatMap((region) => region.blocks.map((block) => block.id))));
        const next = applyLandingDrop(current, payload, target, { createId: createBuilderId });
        const inserted = next.sections.flatMap((section) => section.regions.flatMap((region) => region.blocks)).find((block) => !before.has(block.id));
        replace(next, "block-place", 120);
        setPendingInsert(null);
        if (inserted) {
          dispatch({ type: "select", selection: { kind: "block", id: inserted.id } });
          requestAnimationFrame(() => revealInserted("block", inserted.id));
        }
        return;
      }
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
  function targetFromZone(zone) {
    if (!zone) return null;
    return {
      kind: zone.dataset.dropKind,
      blockId: zone.dataset.blockIdTarget || undefined,
      sectionId: zone.dataset.sectionIdTarget || undefined,
      regionId: zone.dataset.regionIdTarget || undefined,
    };
  }
  function readTarget(event, payload) {
    const direct = event.target.closest?.("[data-drop-kind]");
    const directTarget = targetFromZone(direct);
    if (isValidLandingDrop(payload, directTarget)) return directTarget;

    // Large, forgiving drop target: pick the nearest valid insertion line.
    const frame = event.currentTarget?.closest?.(".landing-page-frame") || event.currentTarget;
    const zones = Array.from(frame?.querySelectorAll?.("[data-drop-kind]") || []);
    let best = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const zone of zones) {
      const candidate = targetFromZone(zone);
      if (!isValidLandingDrop(payload, candidate)) continue;
      const rect = zone.getBoundingClientRect();
      const cx = Math.max(rect.left, Math.min(event.clientX, rect.right));
      const cy = rect.top + rect.height / 2;
      const dx = event.clientX - cx;
      const dy = event.clientY - cy;
      const distance = Math.hypot(dx * 0.35, dy);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = candidate;
      }
    }
    return best;
  }
  function stopAutoScroll() {
    if (autoScrollRef.current.frame !== null) cancelAnimationFrame(autoScrollRef.current.frame);
    autoScrollRef.current = { frame: null, pointerY: null };
  }
  function autoScrollCanvas(event) {
    const shell = canvasShellRef.current;
    if (!shell) return;
    autoScrollRef.current.pointerY = event.clientY;
    if (autoScrollRef.current.frame !== null) return;
    const tick = () => {
      const currentShell = canvasShellRef.current;
      const pointerY = autoScrollRef.current.pointerY;
      if (!currentShell || pointerY === null || !dragRef.current) return stopAutoScroll();
      const rect = currentShell.getBoundingClientRect();
      const velocity = calculateAutoScrollVelocity({ pointerY, top: rect.top, bottom: rect.bottom, edgeSize: Math.min(140, Math.max(80, rect.height * 0.16)) });
      if (!velocity) return stopAutoScroll();
      currentShell.scrollTop += velocity;
      autoScrollRef.current.frame = requestAnimationFrame(tick);
    };
    autoScrollRef.current.frame = requestAnimationFrame(tick);
  }
  function dragOver(event) {
    const payload = dragRef.current || decodeLandingDrag(event.dataTransfer.getData(LANDING_DRAG_TYPE));
    if (!payload) return;
    autoScrollCanvas(event);
    const target = readTarget(event, payload);
    if (!isValidLandingDrop(payload, target)) {
      setDragState((current) => current.target ? { ...current, target: null } : current);
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = payload.kind.startsWith("palette") ? "copy" : "move";
    setDragState((current) => sameLandingDropTarget(current.target, target) && current.payload === payload ? current : { payload, target });
  }
  function drop(event) {
    const payload = dragRef.current || decodeLandingDrag(event.dataTransfer.getData(LANDING_DRAG_TYPE)); const target = readTarget(event, payload);
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
  function dragEnd() { stopAutoScroll(); libraryDragRef.current = null; dragRef.current = null; setDragState({ payload: null, target: null }); }

  if (error && !state) return <div className="landing-editor-state"><strong>No se pudo abrir la Landing</strong><p>{error}</p><button onClick={() => navigate("/construir")}>Volver a Builder</button></div>;
  if (!state) return <div className="landing-editor-state">Cargando borrador…</div>;
  if (asset.lifecycle === "archived") return <div className="landing-editor-state"><strong>Landing archivada</strong><p>Este asset no puede editarse.</p><button onClick={() => navigate("/construir")}>Volver</button></div>;
  const validation = validateLandingDocument(state.document);
  const editorActions = { dropTarget: dragState.target, move: moveSelection, duplicate: duplicateSelection, remove: removeSelection, openPanel, editing, pendingInsert, onPlace: placePendingInsert };

  return <div className={`landing-editor ${state.selection && !panelOpen ? "has-context-toolbar" : ""} ${pendingInsert ? "is-mobile-placing" : ""}`}>
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
          <label className="landing-element-search"><span>Buscar elementos</span><input value={elementSearch} onChange={(event) => setElementSearch(event.target.value)} placeholder="Buscar Heading, Video, FAQ..."/></label>
          <h2>Blocks</h2>
          {filteredBlocks.map(({ type, label, hint, Icon }) => <button key={type} draggable data-palette-kind="palette-block" data-palette-id={type} onDragStart={dragStart} onDragEnd={dragEnd} onClick={mobileActivate(() => addBlock(type))}><Icon/><span><strong>{label}</strong><small>{hint}</small></span><GripVertical aria-hidden="true"/></button>)}
          {!filteredBlocks.length && !filteredPatterns.length && <div className="landing-element-search-empty">No encontramos elementos con “{elementSearch}”.</div>}
          {filteredPatterns.length > 0 && <h2>Patterns</h2>}
          {filteredPatterns.map((item) => <button className="landing-pattern-card" key={item.id} draggable data-palette-kind="palette-pattern" data-palette-id={item.id} data-pattern-group={item.group} onDragStart={dragStart} onDragEnd={dragEnd} onClick={mobileActivate(() => beginMobilePlacement({ kind: "palette-pattern", id: item.id, label: item.label }))}><PatternPreview type={item.preview}/><span><small>{item.group}</small><strong>{item.label}</strong></span><GripVertical aria-hidden="true"/></button>)}
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
              <div className="orvesen-mobile-add-heading"><span>AÑADIR</span><h2>Elementos</h2><small>Toca un elemento para insertarlo debajo del bloque seleccionado.</small></div>
              <label className="landing-element-search is-mobile"><span>Buscar elementos</span><input value={elementSearch} onChange={(event) => setElementSearch(event.target.value)} placeholder="Buscar Heading, Video, FAQ..." autoComplete="off"/></label>
              <div className="orvesen-mobile-add-grid">
                {filteredBlocks.map(({ type, label, hint, Icon }) => <button type="button" key={type} className="orvesen-mobile-add-item" onClick={mobileActivate(() => beginMobilePlacement({ kind: "palette-block", id: type, label }))}><Icon/><span><strong>{label}</strong><small>{hint}</small></span></button>)}
              </div>
              {!filteredBlocks.length && !filteredPatterns.length && <div className="landing-element-search-empty">No encontramos elementos con “{elementSearch}”.</div>}
              {filteredPatterns.length > 0 && <div className="orvesen-mobile-add-heading orvesen-mobile-pattern-heading"><h2>Patterns</h2><small>Toca una estructura para insertarla completa.</small></div>}
              <div className="orvesen-mobile-pattern-list">
                {filteredPatterns.map((item) => <button type="button" className="orvesen-mobile-pattern-item" key={item.id} onClick={mobileActivate(() => beginMobilePlacement({ kind: "palette-pattern", id: item.id, label: item.label }))}><MobilePatternPreview type={item.preview}/><span><small>{item.group}</small><strong>{item.label}</strong></span></button>)}
              </div>
            </>}
          </div>
        </section>
      </div>, document.body)}
      <main ref={canvasShellRef} className={`landing-canvas-shell ${dragState.payload ? "is-dragging" : ""}`}><div className={`landing-viewport landing-viewport-${state.preview}`}><span className="landing-viewport-label">{state.preview} preview</span><div className={`landing-page-frame landing-preview-${state.preview}`} onClick={canvasClick} onDragStart={dragStart} onDragEnd={dragEnd} onDragOver={dragOver} onDrop={drop}>{!state.document.sections.length ? <div className="landing-empty" data-drop-kind="canvas-end"><Layers3/><h2>Comienza tu página</h2><p>Añade una estructura clara y conviértela en una experiencia real.</p>{pendingInsert ? <button type="button" className="landing-empty-place" onClick={(event) => { event.preventDefault(); event.stopPropagation(); placePendingInsert({ kind: "canvas-end" }); }}>+ Colocar aquí</button> : <div><button onClick={(event) => { event.stopPropagation(); addPattern("hero"); }}>Añadir Hero</button><button onClick={(event) => { event.stopPropagation(); apply({ type: "add_section", section: newSection() }, "insert"); }}>Añadir sección</button></div>}</div> : <LandingRenderer document={state.document} editorMode selection={state.selection} editorActions={editorActions} renderField={(props) => <InlineEditableField {...props} editing={editing} onBegin={beginInlineEdit} onChange={updateInlineField} onEnd={() => setEditing(null)}/>} resolvePageLink={(pageId)=>pages.find((page)=>page.id===pageId)?.public_slug?`/p/${pages.find((page)=>page.id===pageId)?.public_slug}`:"#"} resolveForm={(id, label) => {
  const form = forms.find((item) => item.id === id);
  return form?.draft?.document_type === "form"
    ? <div className="landing-form-connected"><div className="landing-form-connected-label"><strong>{form.name}</strong><small>{label}</small></div><FormRenderer document={form.draft} editorMode/></div>
    : <div className="landing-form-preview"><strong>Formulario</strong><span>{form?.name || "Sin formulario asignado"}</span><small>{form ? "Abre este formulario en Builder para diseñarlo." : label}</small></div>;
}}/>}</div></div><output className="landing-editor-announcement" aria-live="polite">{dragState.target ? "Destino de inserción seleccionado" : validation.valid ? "Documento válido" : `${validation.errors.length} errores de documento`}</output></main>
      {state.selection && selected && !panelOpen && <ContextualStyleToolbar
        selection={state.selection}
        selected={selected}
        apply={apply}
        forms={forms}
        pages={pages}
        sections={state.document.sections}
        onSaveForm={(formId, document) => {
          setForms((items) => items.map((item) => item.id === formId ? { ...item, draft: document } : item));
          const previous = formSaveQueuesRef.current.get(formId) || Promise.resolve();
          const queued = previous.then(async () => {
            const form = formsRef.current.find((item) => item.id === formId);
            const revision = formRevisionsRef.current.get(formId);
            if (!form?.draft || !Number.isInteger(revision)) throw new Error("FORM_DRAFT_NOT_AVAILABLE");
            const saved = await saveBuilderFormDraft({ assetId: formId, expectedRevision: revision, document });
            formRevisionsRef.current.set(formId,saved.revision);
            setForms((items) => items.map((item) => item.id === formId ? { ...item, draft: saved.document, draft_revision: saved.revision } : item));
          }).catch((value) => setError(value.message || "No se pudo guardar el formulario conectado."));
          formSaveQueuesRef.current.set(formId, queued);
          return queued;
        }}
        buttonDefaults={state.document.settings.design_system.buttons || {}}
        onMore={() => openPanel(state.selection)}
        onDuplicate={() => duplicateSelection(state.selection)}
        onDelete={() => removeSelection(state.selection)}
        onMoveUp={() => moveSelection(state.selection, -1)}
        onMoveDown={() => moveSelection(state.selection, 1)}
        onSelectSection={() => {
          const sectionId = state.selection?.kind === "block" ? selected?.section?.id : selected?.id;
          if (sectionId) dispatch({ type: "select", selection: { kind: "section", id: sectionId } });
        }}
        onClose={() => { setEditing(null); setPanelOpen(false); dispatch({ type: "select", selection: null }); }}
        position={toolbarPosition}
        onTogglePosition={() => setToolbarPosition((value) => value === "top" ? "bottom" : "top")}
      />}
      {panelOpen && state.selection && <Inspector selection={state.selection} selected={selected} forms={forms} apply={apply} preview={state.preview} onDelete={() => removeSelection(state.selection)} onDuplicate={() => duplicateSelection(state.selection)} onMove={(delta) => moveSelection(state.selection, delta)} onClose={() => setPanelOpen(false)} onEditForm={(formId) => navigate(`/construir/assets/form/${formId}`)}/>}
    </div>
    {pendingInsert && <div className="landing-mobile-placement-bar" role="status" aria-live="polite">
      <div><small>COLOCANDO</small><strong>{pendingInsert.label || (pendingInsert.kind === "palette-pattern" ? "Pattern" : "Elemento")}</strong><span>Toca una zona “+ Colocar aquí”.</span></div>
      <button type="button" onClick={cancelMobilePlacement}>Cancelar</button>
    </div>}
    {!pendingInsert && <nav className="landing-mobile-context" aria-label="Herramientas principales" onClick={(event) => event.stopPropagation()}>
      <button type="button" onClick={mobileActivate(() => { setPanelOpen(false); setEditing(null); setGlobalStylesOpen(false); setMobileAddOpen(true); })}>＋ Añadir</button>
      <button type="button" onClick={mobileActivate(() => { setPanelOpen(false); setEditing(null); setGlobalStylesOpen(true); setMobileAddOpen(true); })}>Estilos de página</button>
      <button type="button" onClick={() => dispatch({ type: "preview", preview: state.preview === "mobile" ? "desktop" : "mobile" })}>Preview</button>
      {state.selection?.kind === "section" && <button type="button" onClick={() => openPanel(state.selection)}>Editar sección</button>}
    </nav>}
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
  const storageKey = `orvesen.builder.panel.${id}`;
  const [panelPosition, setPanelPosition] = useState(() => {
    try { return JSON.parse(sessionStorage.getItem(storageKey)) || { x: Math.max(24, window.innerWidth - 390), y: 96 }; }
    catch { return { x: 24, y: 96 }; }
  });
  const close = () => setOpenMenu(null);
  useEffect(() => {
    if (!open) return undefined;
    const escape = (event) => { if (event.key === "Escape") setOpenMenu(null); };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [open, setOpenMenu]);
  useEffect(() => {
    try { sessionStorage.setItem(storageKey, JSON.stringify(panelPosition)); } catch { /* Session preferences are optional. */ }
  }, [panelPosition, storageKey]);
  const beginDrag = (event) => {
    if (window.matchMedia("(max-width: 720px)").matches) return;
    event.preventDefault();
    const origin = { pointerX: event.clientX, pointerY: event.clientY, x: panelPosition.x, y: panelPosition.y };
    const move = (nextEvent) => setPanelPosition({
      x: Math.max(12, Math.min(window.innerWidth - 372, origin.x + nextEvent.clientX - origin.pointerX)),
      y: Math.max(12, Math.min(window.innerHeight - 160, origin.y + nextEvent.clientY - origin.pointerY)),
    });
    const end = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", end); };
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", end, { once: true });
  };
  return <div className={`landing-quick-popover ${open ? "is-open" : ""}`}>
    <button type="button" className="landing-quick-trigger" aria-expanded={open} onClick={(event) => { event.stopPropagation(); setOpenMenu(open ? null : id); }}>{trigger}<span className="landing-quick-chevron">⌄</span></button>
    {open && typeof document !== "undefined" && createPortal(
      <div className="landing-quick-popover-panel landing-quick-portal-panel landing-floating-panel" style={{ left: panelPosition.x, top: panelPosition.y }} onClick={(event) => event.stopPropagation()}>
        <header className="landing-floating-panel-header" onPointerDown={beginDrag}><span><GripVertical size={15}/>{label || "Opciones"}</span><button type="button" aria-label="Cerrar panel" onPointerDown={(event)=>event.stopPropagation()} onClick={close}>×</button></header>
        <div className="landing-floating-panel-content">{children}</div>
      </div>,
      document.body
    )}
  </div>;
}

function FormQuickEditor({ form, onSave }) {
  if (!form?.draft) return <p className="landing-toolbar-note">Selecciona un formulario para editarlo.</p>;
  const commit = (mutate) => { const next = structuredClone(form.draft); mutate(next); onSave?.(form.id, next); };
  const updateField = (fieldId, changes) => commit((next) => { next.fields = next.fields.map((field) => field.id === fieldId ? { ...field, ...changes } : field); });
  return <div className="landing-form-quick-editor">
    <label>Texto del botón<input defaultValue={form.draft.settings.submit_label} onBlur={(event)=>commit((next)=>{next.settings.submit_label=event.target.value})}/></label>
    <label>Mensaje de éxito<input defaultValue={form.draft.settings.success_message} onBlur={(event)=>commit((next)=>{next.settings.success_message=event.target.value})}/></label>
    <div className="landing-form-quick-fields">{form.draft.fields.map((field,index)=><details key={field.id}><summary>{field.label || field.type}</summary><label>Tipo<select value={field.type} onChange={(event)=>updateField(field.id,{type:event.target.value,...(["select","radio"].includes(event.target.value)&&!field.options?{options:["Opción 1"]}:{})})}>{["text","email","tel","textarea","select","checkbox","radio","number","url"].map((type)=><option key={type}>{type}</option>)}</select></label><label>Label<input defaultValue={field.label} onBlur={(event)=>updateField(field.id,{label:event.target.value})}/></label><label>Placeholder<input defaultValue={field.placeholder} onBlur={(event)=>updateField(field.id,{placeholder:event.target.value})}/></label>{["select","radio"].includes(field.type)&&<label>Opciones<textarea defaultValue={(field.options||[]).join("\n")} onBlur={(event)=>updateField(field.id,{options:event.target.value.split("\n").map((value)=>value.trim()).filter(Boolean).slice(0,30)})}/></label>}<label><input type="checkbox" checked={field.required} onChange={(event)=>updateField(field.id,{required:event.target.checked})}/> Requerido</label><label>Ancho<select value={field.width} onChange={(event)=>updateField(field.id,{width:event.target.value})}><option value="full">Completo</option><option value="half">Mitad</option></select></label><div><button type="button" disabled={index===0} onClick={()=>commit((next)=>{const [item]=next.fields.splice(index,1);next.fields.splice(index-1,0,item)})}><ArrowUp size={14}/></button><button type="button" disabled={index===form.draft.fields.length-1} onClick={()=>commit((next)=>{const [item]=next.fields.splice(index,1);next.fields.splice(index+1,0,item)})}><ArrowDown size={14}/></button><button type="button" onClick={()=>commit((next)=>next.fields.splice(index+1,0,{...structuredClone(field),id:createBuilderId()}))}><Copy size={14}/></button><button type="button" onClick={()=>commit((next)=>{next.fields=next.fields.filter((item)=>item.id!==field.id)})}><Trash2 size={14}/></button></div></details>)}</div>
    <button type="button" onClick={()=>commit((next)=>next.fields.push(createFormField("text")))}>＋ Añadir campo</button>
  </div>;
}

function AppearancePanel({ value = {}, onChange }) {
  const applyPreset = (id) => onChange(structuredClone(APPEARANCE_PRESETS[id]));
  const patch = (changes) => onChange({ ...value, ...changes });
  return <div className="landing-appearance-panel">
    <details open><summary>Presets</summary><div className="landing-appearance-presets">{Object.keys(APPEARANCE_PRESETS).map((id)=><button key={id} type="button" className={value.preset===id?"is-active":""} onClick={()=>applyPreset(id)}><i data-preview={id}/><span>{id.replace("_"," ")}</span></button>)}</div></details>
    <details><summary>Superficie</summary><div className="landing-option-grid">{["inherit","solid","gradient","glass","transparent"].map((id)=><button key={id} type="button" className={value.surface===id?"is-active":""} onClick={()=>patch({surface:id})}>{id}</button>)}</div></details>
    <details><summary>Gradiente</summary><div className="landing-option-grid">{GRADIENT_PRESETS.map((id)=><button key={id} type="button" className={value.gradient?.preset===id?"is-active":""} onClick={()=>patch({surface:"gradient",gradient:{type:"linear",preset:id,angle:135,intensity:60}})}>{id.replace("_"," ")}</button>)}</div></details>
    <details><summary>Sombra</summary><div className="landing-option-grid">{SHADOW_TOKENS.map((id)=><button key={id} type="button" className={value.shadow?.token===id?"is-active":""} onClick={()=>patch({shadow:{token:id,intensity:id==="none"?0:40}})}>{id}</button>)}</div></details>
    <details><summary>Luz</summary><div className="landing-option-grid">{GLOW_TOKENS.map((id)=><button key={id} type="button" className={value.glow?.token===id?"is-active":""} onClick={()=>patch({glow:{token:id,intensity:id==="none"?0:40,position:"center",blur:"md"}})}>{id}</button>)}</div></details>
    <details><summary>Borde</summary><div className="landing-option-grid">{["none","subtle","standard","highlight"].map((id)=><button key={id} type="button" className={value.border===id?"is-active":""} onClick={()=>patch({border:id})}>{id}</button>)}</div></details>
    <details><summary>Avanzado</summary><label>Opacidad<select value={value.opacity??100} onChange={(event)=>patch({opacity:Number(event.target.value)})}>{[20,40,60,80,100].map((id)=><option key={id} value={id}>{id}%</option>)}</select></label><label>Blur<select value={value.blur||"none"} onChange={(event)=>patch({blur:event.target.value})}>{["none","sm","md"].map((id)=><option key={id}>{id}</option>)}</select></label><label>Textura<select value={value.texture||"none"} onChange={(event)=>patch({texture:event.target.value})}><option value="none">Sin textura</option><option value="grain">Grano sutil</option></select></label></details>
  </div>;
}

function ContextualStyleToolbar({ selection, selected, apply, forms = [], pages = [], sections = [], onSaveForm, buttonDefaults = {}, onMore, onDuplicate, onDelete, onMoveUp, onMoveDown, onSelectSection, onClose, position = "top", onTogglePosition }) {
  const [openMenu, setOpenMenu] = useState(null);
  const [actionIndex, setActionIndex] = useState(0);
  if (!selection || !selected) return null;

  const spacingOptions = [["none","0"],["xs","8"],["sm","16"],["md","24"],["lg","40"],["xl","64"]];
  const spacingIndex = (value) => {
    const found = spacingOptions.findIndex(([id]) => id === value);
    return found < 0 ? 0 : found;
  };

  if (selection.kind === "section") {
    const section = selected;
    const style = section.style || {};
    const allBlocks = section.regions?.flatMap((region) => region.blocks || []) || [];
    const allPricing = allBlocks.length > 1 && allBlocks.every((block) => block.type === "pricing_card");
    const allFeatures = allBlocks.length > 1 && allBlocks.every((block) => block.type === "feature_item");
    const allStats = allBlocks.length > 1 && allBlocks.every((block) => block.type === "stat");
    const groupLabel = allPricing ? "Pricing · Grupo" : allFeatures ? "Features · Grupo" : allStats ? "Stats · Grupo" : "Sección · Grupo";
    const updateSection = (changes) => apply({ type:"update_section_style", section_id:section.id, changes }, `quick-section-${section.id}`, 600);
    const updateSectionData = (changes) => apply({ type:"update_section", section_id:section.id, changes }, `quick-section-data-${section.id}`, 600);
    const top = style.padding_top || "none";
    const bottom = style.padding_bottom || "none";
    const width = style.content_width || "standard";

    return <div className={`landing-quick-toolbar landing-element-toolbar-v3 is-${position}`} role="toolbar" aria-label="Editar grupo o sección" onClick={(event)=>event.stopPropagation()}>
      <span className="landing-quick-kind">{groupLabel}</span>
      <QuickPopover id="section-appearance" openMenu={openMenu} setOpenMenu={setOpenMenu} label="Diseño visual" trigger={<Palette size={15}/>}><AppearancePanel value={style.appearance} onChange={(appearance)=>updateSection({appearance})}/></QuickPopover>
      <QuickPopover id="section-anchor" openMenu={openMenu} setOpenMenu={setOpenMenu} label="Navegación de sección" trigger={<span>#</span>}><div className="landing-option-list"><label>Nombre interno<input value={section.label || ""} onChange={(event)=>updateSectionData({label:event.target.value})}/></label><label>Anchor<input value={section.anchor || ""} placeholder="servicios" onChange={(event)=>updateSectionData({anchor:safeAnchor(event.target.value,`seccion-${section.id.slice(0,8)}`)})}/></label></div></QuickPopover>
      <QuickPopover id="section-width" openMenu={openMenu} setOpenMenu={setOpenMenu} label="Ancho del grupo" trigger={<span>Ancho · {width === "narrow" ? "Estrecho" : width === "wide" ? "Amplio" : "Normal"}</span>}>
        <div className="landing-option-grid">{[["narrow","Estrecho"],["standard","Normal"],["wide","Amplio"]].map(([id,label])=><button key={id} type="button" className={width===id?"is-active":""} onClick={()=>{updateSection({content_width:id});setOpenMenu(null)}}>{label}</button>)}</div>
      </QuickPopover>
      <QuickPopover id="section-spacing" openMenu={openMenu} setOpenMenu={setOpenMenu} label="Espacio exterior del grupo" trigger={<span>Espaciado</span>}>
        <div className="landing-spacing-editor">
          <label><span>Arriba <strong>{spacingOptions[spacingIndex(top)][1]}px</strong></span><input type="range" min="0" max={spacingOptions.length-1} step="1" value={spacingIndex(top)} onChange={(event)=>updateSection({padding_top:spacingOptions[Number(event.target.value)][0]})}/></label>
          <label><span>Abajo <strong>{spacingOptions[spacingIndex(bottom)][1]}px</strong></span><input type="range" min="0" max={spacingOptions.length-1} step="1" value={spacingIndex(bottom)} onChange={(event)=>updateSection({padding_bottom:spacingOptions[Number(event.target.value)][0]})}/></label>
        </div>
      </QuickPopover>
      <div className="landing-compact-align" aria-label="Alineación del grupo">
        {[["start","Alinear izquierda",AlignLeft],["center","Centrar",AlignCenter],["end","Alinear derecha",AlignRight]].map(([id,label,Icon])=><button key={id} type="button" title={label} aria-label={label} className={(style.align||"start")===id?"is-active":""} onClick={()=>updateSection({align:id})}><Icon size={15}/></button>)}
      </div>
      <button type="button" className="landing-toolbar-primary" onClick={onMore}>Editar grupo</button>
      <QuickPopover id="section-more" openMenu={openMenu} setOpenMenu={setOpenMenu} trigger={<span>•••</span>}>
        <div className="landing-option-list">
          <button type="button" onClick={onDuplicate}>Duplicar grupo</button>
          <button type="button" className="is-danger" onClick={onDelete}>Eliminar grupo</button>
        </div>
      </QuickPopover>
      <button type="button" className="landing-quick-move" onClick={onTogglePosition} title="Mover barra">{position === "top" ? "↓" : "↑"}</button>
      <button type="button" className="landing-quick-close" onClick={onClose}>×</button>
    </div>;
  }

  if (selection.kind !== "block" || !selected?.block) return null;
  const block = selected.block;
  const declaredControls = getBlockToolbarControls(block);
  const style = block.style || {};
  const updateStyle = (changes) => apply({ type:"update_block_style", block_id:block.id, changes }, `quick-style-${block.id}`, 600);
  const appearanceControls = <QuickPopover id="appearance" openMenu={openMenu} setOpenMenu={setOpenMenu} label="Diseño visual" trigger={<Palette size={15}/>}><AppearancePanel value={style.appearance} onChange={(appearance)=>updateStyle({appearance})}/></QuickPopover>;
  const resetGlobal = () => apply({ type:"reset_block_style", block_id:block.id }, `quick-global-${block.id}`, 600);
  const width = style.max_width || "none";
  const spacingTop = style.padding_top || "none";
  const spacingBottom = style.padding_bottom || "none";
  const groupBlockCount = selected?.section?.regions?.reduce((total, region) => total + (region.blocks?.length || 0), 0) || 0;
  const hasGroup = groupBlockCount > 1;
  const textBearing = ["heading","text","feature_item","stat","testimonial","pricing_card","faq_item"].includes(block.type);

  const alignmentControls = <div className="landing-compact-align" aria-label="Posición del bloque">
    {[["start","Alinear izquierda",AlignLeft],["center","Centrar",AlignCenter],["end","Alinear derecha",AlignRight]].map(([id,label,Icon]) => <button key={id} type="button" title={label} aria-label={label} className={(style.align||"start")===id?"is-active":""} onClick={()=>{
      const needsReadableWidth = id !== "start" && (!style.max_width || style.max_width === "none");
      updateStyle({ align:id, ...(needsReadableWidth ? { max_width:"standard" } : {}) });
    }}><Icon size={15}/></button>)}
  </div>;

  const layoutControls = <>
    {alignmentControls}
    <QuickPopover id="width" openMenu={openMenu} setOpenMenu={setOpenMenu} label="Ancho del bloque" trigger={<span>{width === "narrow" ? "50%" : width === "standard" ? "75%" : width === "wide" ? "90%" : "100%"}</span>}>
      <div className="landing-option-grid">{[["narrow","50%"],["standard","75%"],["wide","90%"],["none","100%"]].map(([id,label])=><button key={id} type="button" className={width===id?"is-active":""} onClick={()=>{updateStyle({max_width:id});setOpenMenu(null)}}>{label}</button>)}</div>
    </QuickPopover>
    <QuickPopover id="spacing" openMenu={openMenu} setOpenMenu={setOpenMenu} label="Distancia con otros bloques" trigger={<span>Espacio</span>}>
      <div className="landing-spacing-editor">
        <label><span>Arriba <strong>{spacingOptions[spacingIndex(spacingTop)][1]}px</strong></span><input type="range" min="0" max={spacingOptions.length-1} step="1" value={spacingIndex(spacingTop)} onChange={(event)=>updateStyle({padding_top:spacingOptions[Number(event.target.value)][0]})}/></label>
        <label><span>Abajo <strong>{spacingOptions[spacingIndex(spacingBottom)][1]}px</strong></span><input type="range" min="0" max={spacingOptions.length-1} step="1" value={spacingIndex(spacingBottom)} onChange={(event)=>updateStyle({padding_bottom:spacingOptions[Number(event.target.value)][0]})}/></label>
        <div className="landing-spacing-presets">{spacingOptions.map(([id,label])=><button key={id} type="button" className={spacingTop===id&&spacingBottom===id?"is-active":""} onClick={()=>updateStyle({padding_top:id,padding_bottom:id})}>{label}</button>)}</div>
      </div>
    </QuickPopover>
    <button type="button" className="landing-quick-icon" onClick={onMoveUp} title="Mover arriba" aria-label="Mover bloque arriba"><ArrowUp size={15}/></button>
    <button type="button" className="landing-quick-icon" onClick={onMoveDown} title="Mover abajo" aria-label="Mover bloque abajo"><ArrowDown size={15}/></button>
  </>;

  const typographyControls = textBearing ? <>
    <QuickPopover id="font" openMenu={openMenu} setOpenMenu={setOpenMenu} label="Tipografía" trigger={<><Type size={15}/><span className="landing-font-preview">Aa</span></>}>
      <div className="landing-font-list">{QUICK_FONTS.map(([id,label,sample])=><button key={id} type="button" className={`${style.font_family===id||(!style.font_family&&id==="inherit")?"is-active":""} font-${id}`} onClick={()=>{updateStyle({font_family:id});setOpenMenu(null)}}><span>{sample}</span><strong>{label}</strong></button>)}</div>
    </QuickPopover>
    <QuickPopover id="weight" openMenu={openMenu} setOpenMenu={setOpenMenu} label="Peso" trigger={<span>{style.text_weight === "bold" ? "Bold" : style.text_weight === "semibold" ? "Semi" : style.text_weight === "medium" ? "Medium" : style.text_weight === "regular" ? "Regular" : "Peso"}</span>}>
      <div className="landing-option-grid">{[["regular","Regular"],["medium","Medium"],["semibold","Semibold"],["bold","Bold"]].map(([id,label])=><button key={id} type="button" className={style.text_weight===id?"is-active":""} onClick={()=>{updateStyle({text_weight:id});setOpenMenu(null)}}>{label}</button>)}</div>
    </QuickPopover>
    <QuickPopover id="color" openMenu={openMenu} setOpenMenu={setOpenMenu} label="Color" trigger={<span className={`landing-color-dot is-${style.color||"text"}`}/>}>
      <div className="landing-color-list">{QUICK_COLORS.map(([id,label])=><button key={id} type="button" className={style.color===id||(!style.color&&id==="text")?"is-active":""} onClick={()=>{updateStyle({color:id});setOpenMenu(null)}}><span className={`landing-color-swatch is-${id}`}/><strong>{label}</strong></button>)}</div>
    </QuickPopover>
    <QuickPopover id="text-flow" openMenu={openMenu} setOpenMenu={setOpenMenu} label="Ritmo tipográfico" trigger={<span>↕</span>}><div className="landing-option-list"><label>Interlineado<select value={style.line_height||"normal"} onChange={(event)=>updateStyle({line_height:event.target.value})}><option value="tight">Compacto</option><option value="normal">Normal</option><option value="relaxed">Amplio</option></select></label><label>Espaciado de letras<select value={style.letter_spacing||"normal"} onChange={(event)=>updateStyle({letter_spacing:event.target.value})}><option value="tight">Compacto</option><option value="normal">Normal</option><option value="wide">Amplio</option></select></label></div></QuickPopover>
  </> : null;

  const sizeControls = (block.type === "heading" || block.type === "text") ? (() => {
    const sizes = block.type === "text"
      ? [["small","Pequeño"],["body","Normal"],["lead","Grande"]]
      : [["auto","Página"],["xs","XS"],["sm","S"],["md","M"],["lg","L"],["xl","XL"],["2xl","2XL"]];
    const current = block.type === "text" ? (style.text_variant || "body") : (style.text_size || "auto");
    const index = Math.max(0, sizes.findIndex(([id]) => id === current));
    const setSize = (id) => updateStyle(block.type === "text" ? { text_variant:id } : { text_size:id === "auto" ? undefined : id });
    const smaller = () => setSize(sizes[Math.max(0,index-1)][0]);
    const larger = () => setSize(sizes[Math.min(sizes.length-1,index+1)][0]);
    return <div className="landing-direct-size" aria-label="Tamaño del texto">
      <button type="button" onClick={smaller} disabled={index===0} title="Hacer texto más pequeño">A−</button>
      <QuickPopover id="size" openMenu={openMenu} setOpenMenu={setOpenMenu} label="Tamaño" trigger={<span>{sizes[index]?.[1] || "Página"}</span>}>
        <div className="landing-option-grid">{sizes.map(([id,label])=><button key={id} type="button" className={current===id?"is-active":""} onClick={()=>{setSize(id);setOpenMenu(null)}}>{label}</button>)}</div>
      </QuickPopover>
      <button type="button" onClick={larger} disabled={index===sizes.length-1} title="Hacer texto más grande">A+</button>
    </div>;
  })() : null;

  const pageTypographyControl = (block.type === "heading" || block.type === "text") ? (() => {
    const inherited = (!style.font_family || style.font_family === "inherit")
      && !style.text_weight
      && !style.color
      && (block.type === "heading" ? !style.text_size : !style.text_variant);
    const resetTypography = () => updateStyle(
      block.type === "heading"
        ? { font_family:"inherit", text_size:undefined, text_weight:undefined, line_height:undefined, letter_spacing:undefined, color:undefined }
        : { font_family:"inherit", text_variant:undefined, text_weight:undefined, line_height:undefined, letter_spacing:undefined, color:undefined }
    );
    return <button
      type="button"
      className={`landing-use-page-style ${inherited ? "is-active" : ""}`}
      onClick={resetTypography}
      title={block.type === "heading" ? "Usar la configuración global de Título" : "Usar la configuración global de Texto general"}
    >{block.type === "heading" ? "↩ Título global" : "↩ Texto global"}</button>;
  })() : null;

  const updateContent = (changes, group = "quick-content") => apply({ type:"update_block_content", block_id:block.id, changes }, `${group}-${block.id}`, 600);

  if (block.type === "site_header") {
    const presets = [["logo_nav_cta","Logo + nav + CTA"],["centered_nav","Nav centrada"],["centered_logo","Logo centrado"],["split","Split"],["minimal","Minimal"],["transparent","Transparent"],["solid","Solid"],["dark","Dark"],["light","Light"],["sticky","Sticky"],["cta_heavy","CTA-heavy"]];
    const updateNav = (index, changes) => updateContent({ nav_items:block.content.nav_items.map((item,itemIndex)=>itemIndex===index?{...item,...changes}:item) },"header-nav");
    const chooseSection = (index, sectionId) => {
      const targetSection = sections.find((item)=>item.id===sectionId);
      if (!targetSection) return;
      const anchor = targetSection.anchor || safeAnchor(targetSection.label || `seccion-${targetSection.id.slice(0,8)}`);
      if (!targetSection.anchor) apply({type:"update_section",section_id:targetSection.id,changes:{anchor}},`section-anchor-${targetSection.id}`,600);
      updateNav(index,{target:{type:"section",section_id:targetSection.id,anchor},href:undefined});
    };
    return <div className={`landing-quick-toolbar landing-element-toolbar-v3 is-${position}`} data-controls={declaredControls.join(" ")} role="toolbar" aria-label="Editar Header" onClick={(event)=>event.stopPropagation()}>
      <span className="landing-quick-kind">Header</span>
      {appearanceControls}
      <QuickPopover id="header-preset" openMenu={openMenu} setOpenMenu={setOpenMenu} label="Preset del Header" trigger={<><Palette size={15}/><span>Diseño</span></>}><div className="landing-header-preset-grid">{presets.map(([id,label])=><button key={id} type="button" className={block.content.preset===id?"is-active":""} data-preset={id} onClick={()=>updateContent({preset:id,sticky:id==="sticky"?true:block.content.sticky,surface:["transparent","dark","light","solid"].includes(id)?id:block.content.surface},"header-preset")}><i/><span>{label}</span></button>)}</div></QuickPopover>
      <QuickPopover id="header-brand" openMenu={openMenu} setOpenMenu={setOpenMenu} label="Marca" trigger={<span>Marca</span>}><div className="landing-option-list"><label>Nombre<input value={block.content.brand_name} onChange={(event)=>updateContent({brand_name:event.target.value},"header-brand")}/></label><label>Logo HTTPS<input value={block.content.logo_url} onChange={(event)=>updateContent({logo_url:event.target.value},"header-logo")}/></label></div></QuickPopover>
      <QuickPopover id="header-nav" openMenu={openMenu} setOpenMenu={setOpenMenu} label="Navegación" trigger={<span>Nav</span>}><div className="landing-header-nav-editor">{block.content.nav_items.map((item,index)=><fieldset key={item.id||index}><label><input type="checkbox" checked={item.enabled} onChange={(event)=>updateNav(index,{enabled:event.target.checked})}/> Visible</label><input aria-label="Texto" value={item.label} onChange={(event)=>updateNav(index,{label:event.target.value})}/><select aria-label="Tipo de destino" value={item.target?.type || (item.href?.startsWith("#")?"section":"url")} onChange={(event)=>{const type=event.target.value;updateNav(index,{target:type==="section"?{type:"section",anchor:"seccion"}:type==="page"?{type:"page",asset_id:pages[0].id}:type==="email"?{type:"email",email:"contacto@example.com"}:type==="phone"?{type:"phone",phone:"+10000000000"}:{type:"url",url:"https://example.com"},href:undefined})}}><option value="section">Sección de esta página</option><option value="page" disabled={!pages.length}>Otra página ORVESEN</option><option value="url">URL externa</option><option value="email">Email</option><option value="phone">Teléfono</option></select>{(item.target?.type||"section")==="section"?<select value={item.target?.section_id||""} onChange={(event)=>chooseSection(index,event.target.value)}><option value="">Elegir sección</option>{sections.filter((section)=>section.id!==selected.section?.id).map((section)=><option key={section.id} value={section.id}>{section.label||section.anchor||`Sección ${section.id.slice(0,6)}`}</option>)}</select>:(item.target?.type==="page")?<select value={item.target.asset_id||""} onChange={(event)=>updateNav(index,{target:{type:"page",asset_id:event.target.value}})}><option value="">Elegir página</option>{pages.map((page)=><option key={page.id} value={page.id}>{page.name}</option>)}</select>:<input key={`${item.id}-${item.target?.type}`} aria-label="Destino" defaultValue={item.target?.url||item.target?.email||item.target?.phone||item.href||""} onBlur={(event)=>{const type=item.target?.type||"url";updateNav(index,{target:{type,[type]:event.target.value},href:undefined})}}/>}<button type="button" onClick={()=>updateContent({nav_items:block.content.nav_items.filter((_,itemIndex)=>itemIndex!==index)},"header-nav-remove")}><Trash2 size={14}/> Quitar</button></fieldset>)}<button type="button" onClick={()=>updateContent({nav_items:[...block.content.nav_items,{id:`nav-${Date.now().toString(36)}`,label:"Enlace",target:{type:"section",anchor:"seccion"},enabled:true}]},"header-nav-add")}>＋ Añadir enlace</button></div></QuickPopover>
      <QuickPopover id="header-surface" openMenu={openMenu} setOpenMenu={setOpenMenu} label="Superficie" trigger={<span>Superficie</span>}><div className="landing-option-grid">{["transparent","solid","dark","light"].map((id)=><button key={id} type="button" className={block.content.surface===id?"is-active":""} onClick={()=>updateContent({surface:id},"header-surface")}>{id}</button>)}</div><label><input type="checkbox" checked={block.content.sticky} onChange={(event)=>updateContent({sticky:event.target.checked},"header-sticky")}/> Sticky</label></QuickPopover>
      <button type="button" className="landing-quick-icon" onClick={onMoveUp} title="Mover arriba" aria-label="Mover Header arriba"><ArrowUp size={15}/></button><button type="button" className="landing-quick-icon" onClick={onMoveDown} title="Mover abajo" aria-label="Mover Header abajo"><ArrowDown size={15}/></button><button type="button" className="landing-quick-icon is-danger" onClick={onDelete} title="Eliminar Header" aria-label="Eliminar Header"><Trash2 size={15}/></button><QuickPopover id="header-more" openMenu={openMenu} setOpenMenu={setOpenMenu} trigger={<span>•••</span>}><div className="landing-option-list"><button type="button" onClick={onMore}>Opciones avanzadas</button><button type="button" onClick={onDuplicate}>Duplicar Header</button></div></QuickPopover><button type="button" className="landing-quick-close" onClick={onClose}>×</button>
    </div>;
  }

  if (block.type === "spacer") return <div className={`landing-quick-toolbar landing-element-toolbar-v3 is-${position}`} data-controls={declaredControls.join(" ")} role="toolbar" aria-label="Editar Spacer" onClick={(event)=>event.stopPropagation()}><span className="landing-quick-kind">Spacer</span><QuickPopover id="spacer-size" openMenu={openMenu} setOpenMenu={setOpenMenu} label="Altura" trigger={<><Maximize2 size={15}/><span>{block.content.size.toUpperCase()}</span></>}><div className="landing-spacing-presets">{["xs","sm","md","lg","xl"].map((size)=><button key={size} type="button" className={block.content.size===size?"is-active":""} onClick={()=>updateContent({size},"spacer-size")}>{size.toUpperCase()}</button>)}</div></QuickPopover><button type="button" className="landing-quick-icon" onClick={onMoveUp} title="Mover arriba"><ArrowUp size={15}/></button><button type="button" className="landing-quick-icon" onClick={onMoveDown} title="Mover abajo"><ArrowDown size={15}/></button><button type="button" className="landing-quick-icon is-danger" onClick={onDelete} title="Eliminar"><Trash2 size={15}/></button><button type="button" className="landing-quick-close" onClick={onClose}>×</button></div>;

  if (block.type === "form_reference") {
    const connected = Boolean(block.content?.asset_id);
    const form = forms.find((item)=>item.id===block.content.asset_id);
    const saveStyle = (changes) => { if (!form?.draft) return; const next=structuredClone(form.draft); Object.assign(next.settings,changes); onSaveForm?.(form.id,next); };
    return <div className={`landing-quick-toolbar landing-element-toolbar-v3 is-${position}`} data-controls={declaredControls.join(" ")} role="toolbar" aria-label="Editar formulario" onClick={(event)=>event.stopPropagation()}>
      <span className="landing-quick-kind">Formulario</span>
      {appearanceControls}
      <QuickPopover id="form-connect" openMenu={openMenu} setOpenMenu={setOpenMenu} label="Formulario" trigger={<span>{connected?"Formulario":"Conectar"}</span>}><div className="landing-option-list"><label>Conectado<select value={block.content.asset_id||""} onChange={(event)=>updateContent({asset_id:event.target.value||null},"form-connect")}><option value="">Sin asignar</option>{forms.map((item)=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label><button type="button" onClick={onMore}>Abrir Form Builder</button></div></QuickPopover>
      <QuickPopover id="form-fields" openMenu={openMenu} setOpenMenu={setOpenMenu} label="Campos" trigger={<span>Campos</span>}><FormQuickEditor form={form} onSave={onSaveForm}/></QuickPopover>
      <QuickPopover id="form-design" openMenu={openMenu} setOpenMenu={setOpenMenu} label="Diseño" trigger={<><Palette size={15}/><span>Diseño</span></>}><div className="landing-option-grid">{[["clean_light","Clean Light"],["dark","Dark"],["soft_card","Soft Card"],["minimal","Minimal"],["glass","Glass"]].map(([id,label])=><button key={id} type="button" className={form?.draft?.settings?.style_preset===id?"is-active":""} onClick={()=>saveStyle({style_preset:id,inherit_page_theme:false})}>{label}</button>)}</div>{form&&<><label>Radio<select value={form.draft.settings.radius} onChange={(event)=>saveStyle({radius:event.target.value})}>{["none","sm","md","lg"].map((id)=><option key={id}>{id}</option>)}</select></label><label>Sombra<select value={form.draft.settings.shadow} onChange={(event)=>saveStyle({shadow:event.target.value})}>{["none","soft","elevated"].map((id)=><option key={id}>{id}</option>)}</select></label><label>Padding<select value={form.draft.settings.padding} onChange={(event)=>saveStyle({padding:event.target.value})}>{["sm","md","lg"].map((id)=><option key={id}>{id}</option>)}</select></label><label>Columnas<select value={form.draft.settings.layout||"stack"} onChange={(event)=>saveStyle({layout:event.target.value})}><option value="stack">1 columna</option><option value="two_column">2 columnas</option></select></label><label>Alineación botón<select value={form.draft.settings.button_alignment||"start"} onChange={(event)=>saveStyle({button_alignment:event.target.value})}><option value="start">Inicio</option><option value="center">Centro</option><option value="end">Final</option></select></label><label><input type="checkbox" checked={(form.draft.settings.button_width||"auto")==="full"} onChange={(event)=>saveStyle({button_width:event.target.checked?"full":"auto"})}/> Botón ancho completo</label></>}</QuickPopover>
      {layoutControls}
      {hasGroup && <button type="button" className="landing-group-switch" onClick={onSelectSection}>Grupo</button>}
      <QuickPopover id="more" openMenu={openMenu} setOpenMenu={setOpenMenu} trigger={<span>•••</span>}>
        <div className="landing-option-list">
          <button type="button" onClick={onMore}>Opciones del formulario</button>
          <button type="button" onClick={resetGlobal}>Restablecer estilo</button>
          <button type="button" onClick={onDuplicate}>Duplicar</button>
          <button type="button" className="is-danger" onClick={onDelete}>Eliminar</button>
        </div>
      </QuickPopover>
      <button type="button" className="landing-quick-icon is-danger" onClick={onDelete} title="Eliminar formulario" aria-label="Eliminar formulario"><Trash2 size={15}/></button>
      <button type="button" className="landing-quick-move" onClick={onTogglePosition} title="Mover barra">{position === "top" ? "↓" : "↑"}</button>
      <button type="button" className="landing-quick-close" onClick={onClose}>×</button>
    </div>;
  }

  if (block.type === "action_group") {
    const actions = block.content.actions || [];
    const safeIndex = Math.min(actionIndex, Math.max(0, actions.length - 1));
    const active = actions[safeIndex];
    const updateAction = (changes) => {
      const next = actions.map((item,index) => index === safeIndex ? { ...item, ...changes } : item);
      apply({ type:"update_block_content", block_id:block.id, changes:{ actions:next } }, `button-${block.id}-${safeIndex}`, 600);
    };
    const saveCurrent = () => {
      if (!active) return;
      const name = window.prompt("Nombre para guardar este botón:", active.label || "Mi botón");
      if (!name?.trim()) return;
      let library=[]; try { library=JSON.parse(localStorage.getItem("orvesen.builder.buttonStyles.v1") || "[]"); } catch { /* Ignore malformed user-local presets. */ }
      const item={ id:createBuilderId(), name:name.trim(), style:{...buttonDefaults, ...active} };
      localStorage.setItem("orvesen.builder.buttonStyles.v1", JSON.stringify([item,...library].slice(0,40)));
      window.dispatchEvent(new Event("orvesen-button-library-updated"));
    };
    return <div className={`landing-quick-toolbar landing-button-context landing-element-toolbar-v3 is-${position}`} data-controls={declaredControls.join(" ")} role="toolbar" aria-label="Editar botón" onClick={(event)=>event.stopPropagation()}>
      <span className="landing-quick-kind">Botones</span>
      {appearanceControls}
      {layoutControls}
      {actions.length > 1 && <QuickPopover id="which" openMenu={openMenu} setOpenMenu={setOpenMenu} label="Botón" trigger={<span>{active?.label || "Botón"}</span>}><div className="landing-option-list">{actions.map((item,index)=><button key={index} type="button" className={safeIndex===index?"is-active":""} onClick={()=>{setActionIndex(index);setOpenMenu(null)}}>{item.label}</button>)}</div></QuickPopover>}
      <QuickPopover id="button-design" openMenu={openMenu} setOpenMenu={setOpenMenu} label="Diseño" trigger={<span>Diseño</span>}><div className="landing-button-direct-panel"><span>Estilo</span><div className="landing-button-direct-grid">{[["primary","Sólido"],["outline","Outline"],["ghost","Minimal"],["gradient","Gradient"],["glass","Glass"],["soft","Soft"],["elevated","Elevated"]].map(([id,label])=><button key={id} type="button" className={(active?.variant||"primary")===id?"is-active":""} onClick={()=>updateAction({variant:id})}>{label}</button>)}</div></div></QuickPopover>
      <button type="button" onClick={saveCurrent}>Guardar</button>
      {hasGroup && <button type="button" className="landing-group-switch" onClick={onSelectSection}>Grupo</button>}
      <QuickPopover id="more" openMenu={openMenu} setOpenMenu={setOpenMenu} trigger={<span>•••</span>}><div className="landing-option-list"><button type="button" onClick={onMore}>Opciones avanzadas</button><button type="button" onClick={resetGlobal}>Restablecer</button><button type="button" onClick={onDuplicate}>Duplicar bloque</button><button type="button" className="is-danger" onClick={onDelete}>Eliminar bloque</button></div></QuickPopover>
      <button type="button" className="landing-quick-icon is-danger" onClick={onDelete} title="Eliminar botones" aria-label="Eliminar botones"><Trash2 size={15}/></button>
      <button type="button" className="landing-quick-move" onClick={onTogglePosition} title="Mover barra">{position === "top" ? "↓" : "↑"}</button><button type="button" className="landing-quick-close" onClick={onClose}>×</button>
    </div>;
  }

  const blockLabel = block.type === "image" ? "Imagen" : block.type === "testimonial" ? "Testimonio" : block.type === "video" ? "Video" : block.type === "stat" ? "Métrica" : block.type === "pricing_card" ? "Plan" : block.type === "feature_item" ? "Beneficio" : block.type === "heading" ? "Título" : block.type === "text" ? "Texto" : block.type.replace("_"," ");

  const variantControls = block.type === "divider" ? <QuickPopover id="variant" openMenu={openMenu} setOpenMenu={setOpenMenu} label="Diseño del separador" trigger={<><Palette size={15}/><span>Diseño</span></>}><div className="landing-option-grid">{["solid","dashed","subtle"].map((id)=><button key={id} type="button" className={block.content.style===id?"is-active":""} onClick={()=>updateContent({style:id},"divider-variant")}>{id}</button>)}</div></QuickPopover> : block.type === "social_links" ? <QuickPopover id="variant" openMenu={openMenu} setOpenMenu={setOpenMenu} label="Diseño de Socials" trigger={<><Palette size={15}/><span>Diseño</span></>}><div className="landing-option-grid">{["minimal","circle","square","filled","outline"].map((id)=><button key={id} type="button" className={block.content.variant===id?"is-active":""} onClick={()=>updateContent({variant:id},"social-variant")}>{id}</button>)}</div></QuickPopover> : null;

  return <div className={`landing-quick-toolbar landing-element-toolbar-v3 is-${position}`} data-controls={declaredControls.join(" ")} role="toolbar" aria-label="Editar elemento" onClick={(event)=>event.stopPropagation()}>
    <span className="landing-quick-kind">{blockLabel}</span>
    {appearanceControls}
    {layoutControls}
    {typographyControls}
    {sizeControls}
    {pageTypographyControl}
    {variantControls}
    {hasGroup && <button type="button" className="landing-group-switch" onClick={onSelectSection}>Grupo</button>}
    <QuickPopover id="more" openMenu={openMenu} setOpenMenu={setOpenMenu} trigger={<span>•••</span>}>
      <div className="landing-option-list">
        <button type="button" onClick={onMore}>Editar contenido y diseño</button>
        <button type="button" onClick={resetGlobal}>Restablecer estilo</button>
        <button type="button" onClick={onDuplicate}>Duplicar</button>
        <button type="button" className="is-danger" onClick={onDelete}>Eliminar</button>
      </div>
    </QuickPopover>
    <button type="button" className="landing-quick-icon is-danger" onClick={onDelete} title="Eliminar" aria-label="Eliminar bloque"><Trash2 size={15}/></button>
    <button type="button" className="landing-quick-move" onClick={onTogglePosition} title="Mover barra">{position === "top" ? "↓" : "↑"}</button>
    <button type="button" className="landing-quick-close" onClick={onClose}>×</button>
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
  const [typographyPicker,setTypographyPicker]=useState(null);
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
  const removeSaved=(id)=>{const next=savedButtons.filter(x=>x.id!==id);setSavedButtons(next);localStorage.setItem("orvesen.builder.buttonStyles.v1",JSON.stringify(next))};

  return <div className="landing-global-styles landing-global-v3">
    <header className="landing-global-header"><span>ESTILOS DE PÁGINA</span><strong>Diseña toda la página</strong><p>Define la apariencia general de la página. Al seleccionar un elemento puedes personalizarlo.</p></header>
    <nav className="landing-global-nav">
      {[["typography","Tipografía"],["colors","Colores"],["buttons","Botones"],["layout","Diseño"],["library","Biblioteca"]].map(([id,label])=><button key={id} type="button" className={tab===id?"is-active":""} onClick={()=>setTab(id)}>{label}</button>)}
    </nav>

    {tab==="typography"&&<section className="landing-global-section landing-typography-compact">
      <div className="landing-global-section-title"><strong>Tipografía</strong><small>Dos estilos base para toda la página</small></div>
      <div className="landing-typography-pickers">
        {[
          ["headings","Título",design.typography.headings || design.typography.body,"Aa","Se aplica a H1, H2, H3 y demás títulos"],
          ["body","Texto general",design.typography.body,"Tt","Párrafos, descripciones, formularios y contenido general"],
        ].map(([key,label,value,mark,hint])=>{
          const currentName=(fonts.find(([,fontValue])=>fontValue===value)?.[0]) || "Personalizada";
          return <div className="landing-typography-picker-row" key={key}>
            <div className="landing-typography-picker-copy"><span className="landing-typography-mark" style={{fontFamily:value}}>{mark}</span><span><strong>{label}</strong><small>{hint}</small></span></div>
            <button type="button" className={`landing-typography-picker-button ${typographyPicker===key?"is-open":""}`} style={{fontFamily:value}} onClick={()=>{setTypographyPicker(typographyPicker===key?null:key);setFontSearch("")}}>
              <span>{currentName}</span><b>⌄</b>
            </button>
            {typographyPicker===key&&<div className="landing-typography-drawer">
              <div className="landing-typography-drawer-head"><strong>Elegir {label.toLowerCase()}</strong><button type="button" onClick={()=>setTypographyPicker(null)} aria-label="Cerrar">×</button></div>
              <input autoFocus className="landing-font-search" value={fontSearch} onChange={(e)=>setFontSearch(e.target.value)} placeholder="Buscar tipografía..."/>
              <div className="landing-font-browser landing-font-browser-compact">
                {fonts.map(([name,fontValue])=><button key={`${key}-${name}`} type="button" style={{fontFamily:fontValue}} className={value===fontValue?"is-active":""} onClick={()=>{update("typography",key,fontValue);setTypographyPicker(null);setFontSearch("")}}><strong>{name}</strong><span>{key==="headings"?"Construye algo extraordinario":"La creatividad empieza aquí"}</span></button>)}
              </div>
            </div>}
          </div>;
        })}
      </div>
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

function Inspector({ selection, selected, forms, apply, preview, onDelete, onDuplicate, onMove, onClose, onEditForm }) {
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
    {block && <div className="landing-inspector-group"><h3>Content</h3>{block.type === "heading" && <><label>Texto<textarea autoFocus placeholder="Título" value={content.text} onChange={(event) => updateContent({ text: event.target.value })}/></label><label>Nivel<select value={content.level} onChange={(event) => updateContent({ level: Number(event.target.value) })}>{[1,2,3,4,5,6].map((level) => <option key={level} value={level}>H{level}</option>)}</select></label></>}{block.type === "text" && <label>Contenido<textarea autoFocus placeholder="Escribe el contenido" value={content.text} onChange={(event) => updateContent({ text: event.target.value })}/></label>}{block.type === "image" && <><label>Origen<select value={content.source.kind} onChange={(event) => updateContent({ source: event.target.value === "external" ? { kind: "external", url: "https://example.com/image.jpg" } : { kind: "placeholder" } })}><option value="placeholder">Placeholder</option><option value="external">HTTPS externo</option></select></label>{content.source.kind === "external" && <label>URL<input value={content.source.url} onChange={(event) => updateContent({ source: { kind: "external", url: event.target.value } })}/></label>}<label><input type="checkbox" checked={content.decorative} onChange={(event) => updateContent({ decorative: event.target.checked })}/> Decorativa</label>{!content.decorative && <label>Texto alternativo<input value={content.alt} onChange={(event) => updateContent({ alt: event.target.value })}/></label>}</>}{block.type === "action_group" && <><ActionControls content={content} updateContent={updateContent}/><ActionSurfacePresets content={content} updateContent={updateContent}/></> } {block.type === "form_reference" && <div className="landing-form-binding-controls">
  <div className="landing-form-binding-head"><span>FORMULARIO CONECTADO</span><strong>{forms.find((form) => form.id === content.asset_id)?.name || "Sin formulario"}</strong></div>
  <label>Escoger formulario<select value={content.asset_id || ""} onChange={(event) => updateContent({ asset_id: event.target.value || null })}><option value="">Sin asignar</option>{forms.map((form) => <option key={form.id} value={form.id}>{form.name}</option>)}</select></label>
  {content.asset_id && <button type="button" className="landing-edit-connected-form" onClick={() => onEditForm?.(content.asset_id)}>Editar formulario en Form Builder ↗</button>}
  {!forms.length && <p className="landing-inspector-empty">No hay formularios creados todavía. Crea uno desde Builder y aparecerá aquí.</p>}
  <p className="landing-form-binding-help">Este bloque no construye los campos. Aquí conectas el formulario reutilizable que diseñaste en Form Builder.</p>
  <label>Etiqueta accesible<input value={content.label} onChange={(event) => updateContent({ label: event.target.value })}/></label>
</div>}<ProfessionalContentControls block={block} updateContent={updateContent}/></div>}
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
    case "site_header": return <>
      <label>Preset<select value={content.preset} onChange={(event) => updateContent({ preset: event.target.value })}>{[["logo_nav_cta","Logo + navegación + CTA"],["centered_nav","Navegación centrada"],["centered_logo","Logo centrado"],["split","Split"],["minimal","Minimal"],["transparent","Transparent"],["solid","Solid"],["dark","Dark"],["light","Light"],["sticky","Sticky"],["cta_heavy","CTA-heavy"]].map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      {textField("brand_name", "Nombre de marca")}{textField("logo_url", "Logo HTTPS")}
      <label>Tamaño del logo<select value={content.logo_size} onChange={(event) => updateContent({ logo_size: event.target.value })}><option value="sm">Pequeño</option><option value="md">Medio</option><option value="lg">Grande</option></select></label>
      <label>Navegación<textarea rows={7} value={content.nav_items.map((item) => `${item.enabled ? "1" : "0"}|${item.label}|${item.href}`).join("\n")} onChange={(event) => updateContent({ nav_items: event.target.value.split("\n").filter(Boolean).slice(0,10).map((line) => { const [enabled="1", label="Enlace", href="#"] = line.split("|"); return { enabled: enabled !== "0", label, href }; }) })}/><small>Una línea: 1|Texto|#destino. Usa 0 para ocultar.</small></label>
      <label><input type="checkbox" checked={content.cta.enabled} onChange={(event) => updateContent({ cta: { ...content.cta, enabled: event.target.checked } })}/> Mostrar CTA</label>
      <label>Texto CTA<input value={content.cta.label} onChange={(event) => updateContent({ cta: { ...content.cta, label: event.target.value } })}/></label><label>Destino CTA<input value={content.cta.href} onChange={(event) => updateContent({ cta: { ...content.cta, href: event.target.value } })}/></label>
      <label><input type="checkbox" checked={content.sticky} onChange={(event) => updateContent({ sticky: event.target.checked })}/> Sticky</label>
      <label>Superficie<select value={content.surface} onChange={(event) => updateContent({ surface: event.target.value })}>{["transparent","solid","dark","light"].map((value)=><option key={value}>{value}</option>)}</select></label>
      <label>Alineación<select value={content.alignment} onChange={(event) => updateContent({ alignment: event.target.value })}>{["start","center","spread"].map((value)=><option key={value}>{value}</option>)}</select></label>
      <label>Sombra<select value={content.shadow} onChange={(event) => updateContent({ shadow: event.target.value })}>{["none","subtle","soft"].map((value)=><option key={value}>{value}</option>)}</select></label>
      <label>Borde<select value={content.border} onChange={(event) => updateContent({ border: event.target.value })}>{["none","subtle","standard"].map((value)=><option key={value}>{value}</option>)}</select></label>
    </>;
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
    case "social_links": return <><label>Estilo<select value={content.variant || "outline"} onChange={(event)=>updateContent({variant:event.target.value})}>{["minimal","circle","square","filled","outline"].map((value)=><option key={value}>{value}</option>)}</select></label><label>Tamaño<select value={content.size || "md"} onChange={(event)=>updateContent({size:event.target.value})}>{["sm","md","lg"].map((value)=><option key={value}>{value}</option>)}</select></label><label>Separación<select value={content.gap || "md"} onChange={(event)=>updateContent({gap:event.target.value})}>{["sm","md","lg"].map((value)=><option key={value}>{value}</option>)}</select></label><label>Alineación<select value={content.align || "start"} onChange={(event)=>updateContent({align:event.target.value})}>{["start","center","end"].map((value)=><option key={value}>{value}</option>)}</select></label><label>Color<select value={content.color || "text"} onChange={(event)=>updateContent({color:event.target.value})}>{["text","muted","primary"].map((value)=><option key={value}>{value}</option>)}</select></label><label>Redes<textarea rows={8} value={content.links.map((link) => `${link.enabled === false ? "0" : "1"}|${link.provider}|${link.url}|${link.label}`).join("\n")} onChange={(event) => updateContent({ links: event.target.value.split("\n").filter(Boolean).slice(0, 10).map((line) => { const [enabled="1", provider="website", url="", label="Enlace"] = line.split("|"); return { enabled:enabled!=="0", provider, url, label }; }) })}/><small>Una línea: 1|instagram|https://…|Instagram. Usa 0 para ocultar.</small></label></>;
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
  const textBearing = ["heading","text","feature_item","stat","testimonial","pricing_card","faq_item"].includes(block.type);
  return <div className="landing-inspector-group">
    <h3>Diseño · Desktop/Base</h3>
    <label>Alineación<select value={style.align || "start"} onChange={(event) => updateStyle({ align: event.target.value })}><option value="start">Inicio</option><option value="center">Centro</option><option value="end">Final</option></select></label>
    <label>Ancho del bloque<select value={style.max_width || "none"} onChange={(event) => updateStyle({ max_width: event.target.value })}><option value="none">100%</option><option value="wide">90%</option><option value="standard">75%</option><option value="narrow">50%</option></select></label>
    <label>Espacio arriba<select value={style.padding_top || "none"} onChange={(event) => updateStyle({ padding_top: event.target.value })}>{["none","xs","sm","md","lg","xl"].map((value) => <option key={value} value={value}>{({none:"0",xs:"8",sm:"16",md:"24",lg:"40",xl:"64"})[value]}px</option>)}</select></label>
    <label>Espacio abajo<select value={style.padding_bottom || "none"} onChange={(event) => updateStyle({ padding_bottom: event.target.value })}>{["none","xs","sm","md","lg","xl"].map((value) => <option key={value} value={value}>{({none:"0",xs:"8",sm:"16",md:"24",lg:"40",xl:"64"})[value]}px</option>)}</select></label>
    {textBearing && <>
      <h3>Tipografía</h3>
      <label>Familia<select value={style.font_family || "inherit"} onChange={(event) => updateStyle({ font_family: event.target.value })}><option value="inherit">Heredar de página</option><option value="sans">Sans</option><option value="serif">Serif</option><option value="display">Display</option><option value="mono">Mono</option></select></label>
      {typography && <label>{block.type === "text" ? "Escala de párrafo" : "Tamaño"}<select value={block.type === "text" ? style.text_variant || "body" : style.text_size || ""} onChange={(event) => updateStyle(block.type === "text" ? { text_variant: event.target.value } : { text_size: event.target.value || undefined })}>{block.type === "heading" && <option value="">Heredar</option>}{(block.type === "text" ? ["lead","body","small"] : ["xs","sm","md","lg","xl","2xl"]).map((value) => <option key={value} value={value}>{value}</option>)}</select></label>}
      <label>Peso<select value={style.text_weight || ""} onChange={(event) => updateStyle({ text_weight: event.target.value || undefined })}><option value="">Heredar</option>{["regular","medium","semibold","bold"].map((value) => <option key={value}>{value}</option>)}</select></label>
      <label>Color<select value={style.color || ""} onChange={(event) => updateStyle({ color: event.target.value || undefined })}><option value="">Heredar</option><option value="text">Texto</option><option value="muted">Secundario</option><option value="primary">Acento</option></select></label>
    </>}
    {["image","pricing_card","testimonial","feature_item","video"].includes(block.type) && <>
      <h3>Superficie</h3>
      <label>Radio<select value={style.radius || ""} onChange={(event) => updateStyle({ radius: event.target.value || undefined })}><option value="">Heredar</option>{["none","sm","md","lg"].map((value) => <option key={value}>{value}</option>)}</select></label>
      <label>Sombra<select value={style.shadow || ""} onChange={(event) => updateStyle({ shadow: event.target.value || undefined })}><option value="">Heredar</option>{["none","subtle","soft","medium","elevated"].map((value) => <option key={value}>{value}</option>)}</select></label>
      <label>Borde<select value={style.border || ""} onChange={(event) => updateStyle({ border: event.target.value || undefined })}><option value="">Heredar</option>{["none","subtle","standard"].map((value) => <option key={value}>{value}</option>)}</select></label>
    </>}
    {block.style && <button type="button" onClick={() => apply({ type: "reset_block_style", block_id: block.id }, `style-reset-${block.id}`, 600)}>Restablecer estilo del elemento</button>}
  </div>;
}

function SectionControls({ section, changeLayout, apply }) {
  const style = section.style || {};
  const background = typeof style.background === "object" ? style.background : { type: style.background ? "solid" : "inherit", color: style.background };
  const update = (changes) => apply({ type: "update_section_style", section_id: section.id, changes }, "section-style", 600);
  const updateBackground = (changes) => update({ background: { ...background, ...changes } });
  const setBackgroundType = (type) => update({ background: type === "inherit" ? undefined : type === "transparent" ? { type } : type === "solid" ? { type, color: "surface" } : type === "gradient" ? { type, gradient: "soft_light" } : { type, url: "https://example.com/background.jpg", fit: "cover", position: "center", overlay_color: "text", overlay_opacity: 30 } });
  return <div className="landing-inspector-group"><h3>Section Style · Desktop/Base</h3><label>Columnas<select value={section.layout === "stack" ? "stack" : `columns-${section.regions.length}`} onChange={(event) => changeLayout(event.target.value)}><option value="stack">1 columna</option><option value="columns-2">2 iguales</option><option value="columns-5-7">2 · 5/7</option><option value="columns-7-5">2 · 7/5</option><option value="columns-3">3 iguales</option><option value="columns-4">4 iguales</option></select></label><label>Ancho<select value={style.content_width || ""} onChange={(event) => update({ content_width: event.target.value || undefined })}><option value="">Heredar</option><option value="narrow">Estrecho</option><option value="standard">Estándar</option><option value="wide">Amplio</option></select></label><label>Alineación<select value={style.align || ""} onChange={(event) => update({ align: event.target.value || undefined })}><option value="">Heredar</option><option value="start">Inicio</option><option value="center">Centro</option><option value="end">Final</option></select></label><h3>Fondo</h3><label>Tipo<select value={background.type || "inherit"} onChange={(event) => setBackgroundType(event.target.value)}><option value="inherit">Heredar / Default</option><option value="transparent">Transparente</option><option value="solid">Color</option><option value="gradient">Gradiente</option><option value="image">Imagen</option></select></label>{background.type === "solid" && <label>Color token<select value={background.color || "surface"} onChange={(event) => updateBackground({ color: event.target.value })}><option value="page_background">Página</option><option value="surface">Superficie</option><option value="primary">Acento</option><option value="text">Texto</option></select></label>}{background.type === "image" && <><label>URL HTTPS<input value={background.url || ""} onChange={(event) => updateBackground({ url: event.target.value })}/></label><label>Ajuste<select value={background.fit || "cover"} onChange={(event) => updateBackground({ fit: event.target.value })}><option value="cover">Cover</option><option value="contain">Contain</option></select></label><label>Posición<select value={background.position || "center"} onChange={(event) => updateBackground({ position: event.target.value })}>{["center","top","bottom","left","right"].map((value) => <option key={value}>{value}</option>)}</select></label><label>Overlay<select value={background.overlay_color || "text"} onChange={(event) => updateBackground({ overlay_color: event.target.value })}><option value="text">Texto</option><option value="page_background">Página</option><option value="primary">Acento</option></select></label><label>Opacidad<select value={background.overlay_opacity || 0} onChange={(event) => updateBackground({ overlay_opacity: Number(event.target.value) })}>{[0,10,20,30,40,50,60,70,80].map((value) => <option key={value} value={value}>{value}%</option>)}</select></label></>}{background.type === "gradient" && <label>Preset<select value={background.gradient || "soft_light"} onChange={(event) => updateBackground({ gradient: event.target.value })}><option value="soft_light">Subtle Light</option><option value="aurora">Accent Soft</option><option value="gold_dusk">Accent Depth</option><option value="graphite">Dark Depth</option></select></label>}<h3>Surface</h3><label>Borde<select value={style.border || ""} onChange={(event) => update({ border: event.target.value || undefined })}><option value="">Heredar</option>{["none","subtle","standard"].map((value) => <option key={value}>{value}</option>)}</select></label><label>Radio<select value={style.radius || ""} onChange={(event) => update({ radius: event.target.value || undefined })}><option value="">Heredar</option>{["none","sm","md","lg"].map((value) => <option key={value}>{value}</option>)}</select></label><label>Sombra<select value={style.shadow || ""} onChange={(event) => update({ shadow: event.target.value || undefined })}><option value="">Heredar</option>{["none","subtle","soft","medium","elevated"].map((value) => <option key={value}>{value}</option>)}</select></label><label>Padding superior<select value={style.padding_top || ""} onChange={(event) => update({ padding_top: event.target.value || undefined })}><option value="">Heredar</option>{["none","xs","sm","md","lg","xl"].map((value) => <option key={value}>{value}</option>)}</select></label><label>Padding inferior<select value={style.padding_bottom || ""} onChange={(event) => update({ padding_bottom: event.target.value || undefined })}><option value="">Heredar</option>{["none","xs","sm","md","lg","xl"].map((value) => <option key={value}>{value}</option>)}</select></label>{section.style && <button type="button" onClick={() => apply({ type: "reset_section_style", section_id: section.id }, `section-style-reset-${section.id}`, 600)}>Reset Section Style</button>}</div>;
}

import { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from "react";
import { AlignCenter, AlignLeft, AlignRight, ArrowDown, ArrowLeft, ArrowUp, Copy, GripVertical, Heading, Image, Layers3, Maximize2, Monitor, MousePointerClick, Palette, Pilcrow, Redo2, Smartphone, Tablet, Trash2, Type, Undo2, Waypoints } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { createPortal } from "react-dom";
import { createPrimitiveBlock, SOCIAL_LINK_PROVIDERS, validateLandingDocument } from "../document/landingDocument.js";
import { createSectionSelection, resolveBuilderSelectionTarget, selectParent } from "./landingEditorSelection.js";
import { APPEARANCE_PRESETS, GRADIENT_PRESETS, GLOW_TOKENS, SHADOW_TOKENS } from "../document/visualAppearance.js";
import { applyLandingOperations, inspectSiteFooter, isDedicatedSiteFooterSection, sectionContainsSiteFooter } from "../document/landingOperations.js";
import { createLandingPattern, LANDING_PATTERN_CATALOG } from "../document/landingPatterns.js";
import LandingRenderer from "../renderer/LandingRenderer.jsx";
import "../renderer/LandingRenderer.css";
import { listBuilderAssets, loadBuilderAssetDraft, saveBuilderAssetDraft, saveBuilderFormDraft } from "../services/BuilderAssetService.js";
import { createBuilderSitePage, loadBuilderSiteForPage, resolveBuilderSitePagePath } from "../services/BuilderSiteService.js";
import FormRenderer from "../form/FormRenderer.jsx";
import { changeFormFieldType, createFormField, validateFormDocument } from "../form/formDocument.js";
import { createLandingAutosave } from "./landingAutosave.js";
import { createAndNavigateToBuilderPage, flushAndNavigateToBuilderPage } from "./landingPageSwitching.js";
import LandingPagesControl from "./LandingPagesControl.jsx";
import { calculateAutoScrollVelocity, sameLandingDropTarget } from "./landingAutoScroll.js";
import { constrainFloatingPanel, getFloatingViewport, intersectFloatingViewport, placeFloatingPanel, sameFloatingPosition } from "./floatingPanelPosition.js";
import { applyLandingDrop, decodeLandingDrag, encodeLandingDrag, isValidLandingDrop, isLandingDropPayload, resolveLandingDrop, LANDING_DRAG_TYPE } from "./landingDnD.js";
import { duplicateEditorSelection, findEditorSelection, landingEditorReducer, moveEditorSelection } from "./landingEditorState.js";
import { BUILDER_MUTATION_FAILED } from "./landingMutationFailure.js";
import { getBlockToolbarControls, getSelectionToolbarContext, toolbarDeleteNeedsConfirmation } from "./landingToolbarControls.js";
import { BUILDER_CONTEXT_LAYER, BUILDER_INSPECTOR_LAYER, registerBuilderDismissableLayer } from "./builderDismissableLayer.js";
import {
  applyAppearancePreset,
  applyHeaderLayoutPreset,
  customizeAppearance,
  detachAppearancePreset,
  getEffectiveHeaderNavItemStyle,
  getHeaderLayoutPreset,
  getHeaderPresetBlockStyle,
  HEADER_LAYOUT_PRESETS,
  HEADER_NAV_STYLE_DEFAULTS,
  HEADER_NAV_STYLE_OPTIONS,
  HEADER_SURFACES,
  removeHeaderPreset,
  resetHeaderAppearance,
  resetHeaderLayout,
  resetHeaderNavItemStyle,
  updateHeaderNavItemStyle,
  updateHeaderNavStyle,
} from "./landingHeaderEditing.js";
import {
  buildButtonDestination,
  BUTTON_BACKGROUND_TOKENS,
  BUTTON_BORDERS,
  BUTTON_BORDER_COLOR_TOKENS,
  BUTTON_COLOR_TOKENS,
  BUTTON_RADII,
  BUTTON_SHADOWS,
  BUTTON_SIZES,
  BUTTON_VARIANTS,
  BUTTON_WIDTHS,
  classifyButtonAction,
  duplicateButtonAtIndex,
  getButtonActionValue,
  removeButtonAtIndex,
  resetButtonDesign,
  updateButtonAtIndex,
  validateButtonLabel,
} from "./landingButtonEditing.js";
import {
  addFooterLink,
  applyFooterLayoutPreset,
  createFooterTokenId,
  FOOTER_ELEMENT_TYPES,
  FOOTER_LAYOUT_PRESETS,
  getFooterPresetBlockStyle,
  moveFooterLink,
  removeFooterLink,
  updateFooterLinkGroup,
} from "./landingFooterEditing.js";
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
  { type: "site_footer", label: "Footer", hint: "Pie de página profesional", Icon: Layers3 },
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
const MUTATION_FAILURE_LABELS = {
  BUILDER_SECTION_NOT_FOUND: "La sección ya no existe. Recarga la página.",
  BUILDER_REGION_NOT_FOUND: "La zona de destino ya no existe.",
  BUILDER_BLOCK_NOT_FOUND: "El elemento ya no existe.",
  BUILDER_BLOCK_TYPE_INVALID: "Ese tipo de elemento no es válido.",
  BUILDER_OPERATION_INVALID: "Esa edición no está permitida.",
  BUILDER_SITE_FOOTER_ALREADY_EXISTS: "La página ya tiene un Footer.",
  BUILDER_SITE_FOOTER_REQUIRES_DEDICATED_SECTION: "El Footer necesita su propia sección.",
  BUILDER_SITE_FOOTER_POSITION_LOCKED: "El Footer siempre ocupa el final de la página.",
  BUILDER_DOCUMENT_INVALID: "La edición produciría un documento no válido.",
  BUILDER_MUTATION_FAILED: "No se pudo aplicar la edición.",
};
const mutationFailureMessage = (failure) => MUTATION_FAILURE_LABELS[failure?.code] || MUTATION_FAILURE_LABELS[BUILDER_MUTATION_FAILED];
const mutationFailureDetail = (failure) => failure?.errors?.length ? `${failure.errors.length} ${failure.errors.length === 1 ? "detalle" : "detalles"}` : "";

export default function LandingPageEditor({ asset }) {
  const navigate = useNavigate();
  const [state, dispatch] = useReducer(landingEditorReducer, null);
  const [status, setStatus] = useState("saved");
  const [error, setError] = useState("");
  const [forms, setForms] = useState([]);
  const [pages, setPages] = useState([]);
  const [siteModel, setSiteModel] = useState({ site: null, pages: [] });
  const [sitePagesStatus, setSitePagesStatus] = useState("loading");
  const [sitePagesError, setSitePagesError] = useState("");
  const [sitePagesReload, setSitePagesReload] = useState(0);
  const [pageTransitionId, setPageTransitionId] = useState(null);
  const [localConflictDocument, setLocalConflictDocument] = useState(null);
  const [dragState, setDragState] = useState({ payload: null, target: null });
  const [editing, setEditing] = useState(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [mobileAddOpen, setMobileAddOpen] = useState(false);
  const [globalStylesOpen, setGlobalStylesOpen] = useState(false);
  const [toolbarPosition, setToolbarPosition] = useState("top");
  const [toolbarCollapsed, setToolbarCollapsed] = useState(false);
  const [pendingInsert, setPendingInsert] = useState(null);
  const [elementSearch, setElementSearch] = useState("");
  const autosaveRef = useRef(null); const saveDelayRef = useRef(600); const stateRef = useRef(null); const dragRef = useRef(null);
  // The target object the user is currently being shown as highlighted. The drop
  // reuses this exact object so a gesture can never resolve to a different target
  // than the one that was advertised, even though drop zones change geometry once
  // one of them becomes active.
  const dragTargetRef = useRef(null);
  const autosaveErrorRef = useRef("");
  const formsRef = useRef([]); const formSaveQueuesRef = useRef(new Map()); const formRevisionsRef = useRef(new Map());
  const libraryDragRef = useRef(null);
  const canvasShellRef = useRef(null);
  const autoScrollRef = useRef({ frame: null, pointerY: null });

  useEffect(() => {
    let active = true;
    let autosave = null;
    Promise.all([loadBuilderAssetDraft(asset.id), listBuilderAssets({ assetType: "form", includeArchived: false }), listBuilderAssets({ assetType: "landing_page", includeArchived: false })]).then(async ([draft, formAssets, pageAssets]) => {
      const hydratedForms = await Promise.all(formAssets.map(async (form) => {
        try { const formDraft = await loadBuilderAssetDraft(form.id); return { ...form, draft: formDraft.document, draft_revision: formDraft.revision }; }
        catch { return { ...form, draft: null }; }
      }));
      if (!active) return;
      dispatch({ type: "remote", draft }); setForms(hydratedForms); formRevisionsRef.current = new Map(hydratedForms.map((form)=>[form.id,form.draft_revision])); setPages(pageAssets.filter((page) => page.id !== asset.id));
      autosave = createLandingAutosave({
        save: ({ expectedRevision, document }) => saveBuilderAssetDraft({ assetId: asset.id, expectedRevision, document }),
        onStatus: (value) => { if (active) setStatus(value); },
        onSaved: (revision, document) => { if (!active) return; setError((current) => current === autosaveErrorRef.current ? "" : current); autosaveErrorRef.current = ""; dispatch({ type: "saved", revision, document }); },
        onConflict: () => { if (active) setLocalConflictDocument(stateRef.current?.document || null); },
        onError: (value) => { if (!active) return; const message = value.message || "No se pudo guardar el borrador."; autosaveErrorRef.current = message; setError(message); },
      });
      autosave.initialize(draft.revision);
      autosaveRef.current = autosave;
    }).catch((value) => { if (active) setError(value.message || "No se pudo cargar el borrador."); });
    return () => { active = false; autosave?.dispose(); if (autosaveRef.current === autosave) autosaveRef.current = null; };
  }, [asset.id]);

  useEffect(() => {
    let active = true;
    loadBuilderSiteForPage(asset.id).then((value) => {
      if (!active) return;
      setSiteModel(value);
      setSitePagesStatus("ready");
    }).catch((value) => {
      if (!active) return;
      setSitePagesStatus("error");
      setSitePagesError(value.message || "No se pudieron cargar las páginas del Site.");
    });
    return () => { active = false; };
  }, [asset.id, sitePagesReload]);

  useEffect(() => { stateRef.current = state; }, [state]);
  useEffect(() => { if (state?.dirty) autosaveRef.current?.schedule(state.document, saveDelayRef.current); }, [state?.dirty, state?.document]);
  useEffect(() => { formsRef.current = forms; }, [forms]);
  useEffect(() => {
    if (!panelOpen || typeof document === "undefined") return undefined;
    return registerBuilderDismissableLayer({
      target: document,
      layerId: BUILDER_INSPECTOR_LAYER,
      onDismiss: () => setPanelOpen(false),
    });
  }, [panelOpen]);
  useEffect(() => {
    const beforeUnload = (event) => { if (stateRef.current?.dirty || status === "saving") { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("beforeunload", beforeUnload); return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [status]);

  const apply = useCallback((operation, group = null, delay = 220) => { saveDelayRef.current = delay; dispatch({ type: "operation", operation, group }); }, []);
  const replace = useCallback((document, group = null, delay = 220) => { saveDelayRef.current = delay; dispatch({ type: "replace", document, group }); }, []);
  const selected = useMemo(() => state ? findEditorSelection(state.document, state.selection) : null, [state]);
  const toolbarSelectionIdentity = [state?.selection?.level, state?.selection?.sectionId, state?.selection?.regionId, state?.selection?.blockId, state?.selection?.elementId].filter(Boolean).join(":");
  useEffect(() => { setToolbarCollapsed(false); }, [toolbarSelectionIdentity]);
  const selectedRegion = selected?.region || (["section", "group"].includes(state?.selection?.level) ? selected?.regions?.[0] : null) || state?.document.sections.at(-1)?.regions?.[0];
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
    dispatch({ type: "select", selection: descriptor.selection || { kind: "block", id: descriptor.blockId } });
    setPanelOpen(false);
    setEditing(descriptor);
  }, []);

  const openPanel = useCallback((selection) => {
    if (selection) dispatch({ type: "select", selection });
    setEditing(null);
    const target = findEditorSelection(stateRef.current?.document, selection);
    // Dedicated structural blocks keep editing centralized in their contextual toolbar.
    // The legacy block menu still selects them, but must not reopen a duplicated inspector.
    setPanelOpen(!["site_header", "site_footer"].includes(target?.block?.type));
  }, []);

  const removeSelection = useCallback((selection) => {
    if (!selection) return;
    const current = findEditorSelection(stateRef.current?.document, selection);
    if (selection.level === "element") {
      dispatch({ type: "select", selection: selectParent(selection, stateRef.current?.document) });
      return;
    }
    const block = selection.level === "block" ? current?.block : null;
    if (toolbarDeleteNeedsConfirmation(block) && !window.confirm("¿Eliminar este Header? Se perderán su navegación, marca y configuración interna.")) return;
    const removesSection = ["section", "group"].includes(selection.level);
    apply({ type: removesSection ? "remove_section" : "remove_block", [removesSection ? "section_id" : "block_id"]: removesSection ? selection.sectionId : selection.blockId }, "remove");
    setEditing(null); setPanelOpen(false);
  }, [apply]);

  useEffect(() => {
    const keys = (event) => {
      const typing = ["INPUT", "TEXTAREA", "SELECT"].includes(event.target?.tagName) || event.target?.isContentEditable;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") { event.preventDefault(); dispatch({ type: event.shiftKey ? "redo" : "undo" }); }
      else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "y") { event.preventDefault(); dispatch({ type: "redo" }); }
      else if (event.key === "Escape") { if (pendingInsert) cancelMobilePlacement(); else if (editing) setEditing(null); else if (panelOpen) setPanelOpen(false); else dispatch({ type: "select", selection: null }); }
      else if (!typing && (event.key === "Delete" || event.key === "Backspace") && stateRef.current?.selection) { event.preventDefault(); removeSelection(stateRef.current.selection); }
    };
    window.addEventListener("keydown", keys); return () => window.removeEventListener("keydown", keys);
  }, [removeSelection, editing, pendingInsert, panelOpen]);

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

  useEffect(() => {
    const shell = canvasShellRef.current;
    if (!shell) return undefined;
    const deselectOutsideFrame = (event) => {
      if (event.target.closest?.(".landing-page-frame")) return;
      setEditing(null);
      setPanelOpen(false);
      dispatch({ type: "select", selection: null });
    };
    shell.addEventListener("click", deselectOutsideFrame);
    return () => shell.removeEventListener("click", deselectOutsideFrame);
  }, []);

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
    if (type === "site_footer") {
      if (inspectSiteFooter(current).count) return;
      const section = createPattern("footer_simple");
      const next = applyLandingOperations(current, [{type:"add_section",section}]);
      const footer = inspectSiteFooter(next).location;
      replace(next,"insert-footer",120);
      if (footer) {
        dispatch({type:"select",selection:{kind:"block",id:footer.block.id}});
        requestAnimationFrame(()=>revealInserted("block",footer.block.id));
      }
      closeMobileTools();
      return;
    }
    const blockId = createBuilderId();
    let targetRegion = selectedRegion;
    let insertIndex;

    const targetSection = current.sections.find((section)=>section.regions.some((region)=>region.id===targetRegion?.id));
    if (sectionContainsSiteFooter(targetSection)) targetRegion = null;

    if (state.selection?.level === "block" && selected?.block && selected?.region) {
      targetRegion = selected.region;
      const anchorIndex = targetRegion.blocks.findIndex((item) => item.id === selected.block.id);
      insertIndex = anchorIndex >= 0 ? anchorIndex + 1 : targetRegion.blocks.length;
    } else if (["section", "group"].includes(state.selection?.level) && selected?.regions?.[0]) {
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
    if (sectionContainsSiteFooter(section) && inspectSiteFooter(current).count) return;
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
      if (!isValidLandingDrop(payload,target)) return;
      const before = new Set(current.sections.flatMap((section)=>section.regions.flatMap((region)=>region.blocks.map((block)=>block.id))));
      const next = applyLandingDrop(current,payload,target,{createId:createBuilderId});
      if (next === current) return;
      const inserted = next.sections.flatMap((section)=>section.regions.flatMap((region)=>region.blocks)).find((block)=>!before.has(block.id));
      replace(next, "block-place", 120);
      setPendingInsert(null);
      if (inserted) {
        dispatch({type:"select",selection:{kind:"block",id:inserted.id}});
        requestAnimationFrame(()=>revealInserted("block",inserted.id));
      }
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
    const targetSection = state.document.sections.find((section)=>section.regions.some((region)=>region.id===regionId));
    const targetRegionId = sectionContainsSiteFooter(targetSection) ? null : regionId;
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
  function moveSelection(selection, delta) { const target = selection.level === "group" ? createSectionSelection(selection.sectionId) : selection; const next = moveEditorSelection(state.document,target,delta); if (next !== state.document) replace(next,"move"); }
  function duplicateSelection(selection) { const target = selection.level === "group" ? createSectionSelection(selection.sectionId) : selection; const next = duplicateEditorSelection(state.document,target); if (next !== state.document) replace(next,"duplicate"); }
  function clearPageTransientState() {
    stopAutoScroll();
    dragRef.current = null;
    libraryDragRef.current = null;
    setDragState({ payload: null, target: null });
    setEditing(null);
    setPanelOpen(false);
    setMobileAddOpen(false);
    setGlobalStylesOpen(false);
    setToolbarCollapsed(false);
    setPendingInsert(null);
    dispatch({ type: "select", selection: null });
  }
  async function switchSitePage(page) {
    if (!page?.page_asset_id || page.page_asset_id === asset.id || pageTransitionId) return page?.page_asset_id === asset.id;
    setPageTransitionId(page.page_asset_id);
    setSitePagesError("");
    try {
      const result = await flushAndNavigateToBuilderPage({
        autosave: autosaveRef.current,
        currentState: stateRef.current,
        currentPageAssetId: asset.id,
        targetPageAssetId: page.page_asset_id,
        navigate,
        onBeforeNavigate: clearPageTransientState,
      });
      if (!result.ok) {
        setSitePagesError("No se pudo guardar la página actual. Reintenta antes de cambiar.");
        return false;
      }
      return true;
    } finally {
      setPageTransitionId(null);
    }
  }
  async function createSitePage(input) {
    if (!siteModel.site?.id || pageTransitionId) throw new Error("El Site de esta página todavía no está disponible.");
    setPageTransitionId("create");
    setSitePagesError("");
    try {
      const result = await createAndNavigateToBuilderPage({
        autosave: autosaveRef.current,
        currentState: stateRef.current,
        siteId: siteModel.site.id,
        name: input.name,
        slug: input.slug,
        createPage: createBuilderSitePage,
        navigate,
        onBeforeNavigate: clearPageTransientState,
      });
      if (!result.ok) throw new Error("No se pudo guardar la página actual. Reintenta antes de crear otra.");
      setSiteModel((current) => ({ ...current, pages: [...current.pages.filter((page) => page.page_asset_id !== result.page.page_asset_id), result.page] }));
      return result.page;
    } finally {
      setPageTransitionId(null);
    }
  }
  async function leave() {
    const saved = await autosaveRef.current?.flush();
    if (saved === false) {
      const message = "No se pudo guardar el borrador. Reintenta antes de salir.";
      setError((current) => { if (current) return current; autosaveErrorRef.current = message; return message; });
      return;
    }
    navigate("/construir");
  }
  async function reloadRemote() { const draft = await loadBuilderAssetDraft(asset.id); autosaveRef.current.reset(draft.revision); dispatch({ type: "remote", draft }); setLocalConflictDocument(null); setError(""); }

  function canvasClick(event) {
    const selection = resolveBuilderSelectionTarget(event.target);
    if (selection === undefined) return;
    setEditing(null); setPanelOpen(false);
    dispatch({ type: "select", selection });
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
  // The target the gesture resolved to. While the pointer stays on the zone that
  // is currently advertised, the drop reuses that exact object instead of
  // re-deriving the target from geometry that has already moved.
  function resolveDropTarget(event, payload) {
    const frozen = dragTargetRef.current;
    if (frozen) {
      const direct = targetFromZone(event.target.closest?.("[data-drop-kind]"));
      if (direct && sameLandingDropTarget(frozen, direct)) return frozen;
    }
    return readTarget(event, payload);
  }
  // A structurally refused drop is recorded through the existing mutation-failure
  // channel. The reducer stores it without touching the document, history, dirty
  // flag or revision.
  function routeDropFailure(target, failure) {
    dispatch({ type: "drop_failure", decision: failure, operation: { type: "landing_drop", payload: dragRef.current, target } });
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
    if (!isLandingDropPayload(payload)) return;
    autoScrollCanvas(event);
    const target = readTarget(event, payload);
    if (!isValidLandingDrop(payload, target)) {
      dragTargetRef.current = null;
      setDragState((current) => current.target ? { ...current, target: null } : current);
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = payload.kind.startsWith("palette") ? "copy" : "move";
    dragTargetRef.current = target;
    setDragState((current) => sameLandingDropTarget(current.target, target) && current.payload === payload ? current : { payload, target });
  }
  function drop(event) {
    const payload = dragRef.current || decodeLandingDrag(event.dataTransfer.getData(LANDING_DRAG_TYPE));
    if (!isLandingDropPayload(payload)) return;
    const target = resolveDropTarget(event, payload);
    if (!isValidLandingDrop(payload, target)) return;
    event.preventDefault();
    // One gesture, one baseline: the drop always operates on the current editor
    // document instead of the document captured when this handler was created.
    const current = stateRef.current?.document || state.document;
    if (!current) return;
    if (libraryDragRef.current) {
      const saved = libraryDragRef.current;
      const beforeIds = new Set(current.sections.flatMap((section) => section.regions.flatMap((region) => region.blocks.map((block) => block.id))));
      const decision = resolveLandingDrop(current, payload, target, { createPattern });
      if (!decision.ok) routeDropFailure(target, decision);
      else if (decision.document !== current) {
        let next = decision.document;
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
      }
      libraryDragRef.current = null;
      dragEnd();
      return;
    }
    const decision = resolveLandingDrop(current, payload, target, { createPattern });
    if (!decision.ok) routeDropFailure(target, decision);
    else if (decision.document !== current) replace(decision.document, "drag");
    if (["block", "section"].includes(payload.kind)) dispatch({ type: "select", selection: { kind: payload.kind, id: payload.id } });
    dragEnd();
  }
  function dragEnd() { stopAutoScroll(); libraryDragRef.current = null; dragRef.current = null; dragTargetRef.current = null; setDragState({ payload: null, target: null }); }

  if (error && !state) return <div className="landing-editor-state"><strong>No se pudo abrir la Landing</strong><p>{error}</p><button onClick={() => navigate("/construir")}>Volver a Builder</button></div>;
  if (!state) return <div className="landing-editor-state">Cargando borrador…</div>;
  if (asset.lifecycle === "archived") return <div className="landing-editor-state"><strong>Landing archivada</strong><p>Este asset no puede editarse.</p><button onClick={() => navigate("/construir")}>Volver</button></div>;
  const validation = validateLandingDocument(state.document);
  const mutationFailure = state.lastFailure;
  // A refused mutation is the most immediate feedback, so it wins over a background save error.
  const failureAlert = mutationFailure && status !== "conflict"
    ? { kind: "failure", message: mutationFailureMessage(mutationFailure), detail: mutationFailureDetail(mutationFailure), failure: mutationFailure }
    : error
      ? { kind: "save", message: error, detail: "" }
      : null;
  const footerState = inspectSiteFooter(state.document);
  const hasTerminalFooter = footerState.count === 1
    && footerState.location?.sectionIndex === state.document.sections.length - 1
    && isDedicatedSiteFooterSection(footerState.location.section);
  const editorActions = { dragPayload: dragState.payload, dropTarget: dragState.target, move: moveSelection, duplicate: duplicateSelection, remove: removeSelection, openPanel, editing, pendingInsert, onPlace: placePendingInsert };

  return <div className={`landing-editor ${state.selection && !panelOpen ? "has-context-toolbar" : ""} ${toolbarCollapsed ? "toolbar-collapsed" : ""} ${pendingInsert ? "is-mobile-placing" : ""}`}>
    <header className="landing-editor-bar"><button onClick={leave} aria-label="Volver a Builder"><ArrowLeft/></button><div className="landing-editor-identity"><span>BUILDER · LANDING</span><strong>{asset.name}</strong><small>Borrador</small></div><LandingPagesControl assetId={asset.id} assetName={asset.name} pages={siteModel.pages} status={sitePagesStatus} error={sitePagesError} busy={Boolean(pageTransitionId)} onReload={() => { setSitePagesStatus("loading"); setSitePagesError(""); setSitePagesReload((value) => value + 1); }} onSelect={switchSitePage} onCreate={createSitePage}/><div className="landing-editor-history"><button onClick={() => dispatch({ type: "undo" })} disabled={!state.past.length} aria-label="Deshacer"><Undo2/></button><button onClick={() => dispatch({ type: "redo" })} disabled={!state.future.length} aria-label="Rehacer"><Redo2/></button></div><div className="landing-preview-switch" aria-label="Vista responsive">{PREVIEWS.map(({ id, label, Icon }) => <button key={id} title={label} className={state.preview === id ? "is-active" : ""} onClick={() => dispatch({ type: "preview", preview: id })} aria-pressed={state.preview === id}><Icon/><span>{label}</span></button>)}</div><span className={`landing-save ${status}`}>{saveLabel(status)}</span></header>
    {(failureAlert || status === "conflict") && <div className="landing-editor-alert" role="alert"><span title={failureAlert?.failure?.message || undefined}>{status === "conflict" ? "Esta página cambió en otra sesión." : failureAlert.message}{failureAlert?.detail ? ` · ${failureAlert.detail}` : ""}</span>{status === "conflict" ? <><button onClick={reloadRemote}>Recargar versión remota</button><button onClick={() => navigator.clipboard?.writeText(JSON.stringify(localConflictDocument, null, 2))}>Copiar cambios locales</button></> : failureAlert?.kind === "save" && status === "error" ? <button onClick={() => autosaveRef.current?.retry()}>Reintentar guardado</button> : failureAlert?.kind === "failure" ? <button onClick={() => dispatch({ type: "clear_failure" })}>Descartar</button> : null}</div>}
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
      <main ref={canvasShellRef} className={`landing-canvas-shell ${dragState.payload ? "is-dragging" : ""}`}><div className={`landing-viewport landing-viewport-${state.preview}`} data-terminal-footer={hasTerminalFooter || undefined}><span className="landing-viewport-label">{state.preview} preview</span><div className={`landing-page-frame landing-preview-${state.preview}`} data-terminal-footer={hasTerminalFooter || undefined} onClick={canvasClick} onDragStart={dragStart} onDragEnd={dragEnd} onDragOver={dragOver} onDrop={drop}>{!state.document.sections.length ? <div className="landing-empty" data-drop-kind="canvas-end"><Layers3/><h2>Comienza tu página</h2><p>Añade una estructura clara y conviértela en una experiencia real.</p>{pendingInsert ? <button type="button" className="landing-empty-place" onClick={(event) => { event.preventDefault(); event.stopPropagation(); placePendingInsert({ kind: "canvas-end" }); }}>+ Colocar aquí</button> : <div><button onClick={(event) => { event.stopPropagation(); addPattern("hero"); }}>Añadir Hero</button><button onClick={(event) => { event.stopPropagation(); apply({ type: "add_section", section: newSection() }, "insert"); }}>Añadir sección</button></div>}</div> : <LandingRenderer document={state.document} editorMode selection={state.selection} editorActions={editorActions} renderField={(props) => <InlineEditableField {...props} editing={editing} onBegin={beginInlineEdit} onChange={updateInlineField} onEnd={() => setEditing(null)}/>} resolvePageLink={(pageId)=>resolveBuilderSitePagePath(siteModel.pages, pageId) || "#"} resolveForm={(id, label) => {
  const form = forms.find((item) => item.id === id);
  return form?.draft?.document_type === "form"
    ? <div className="landing-form-connected"><div className="landing-form-connected-label"><strong>{form.name}</strong><small>{label}</small></div><FormRenderer document={form.draft} editorMode/></div>
    : <div className="landing-form-preview"><strong>Formulario</strong><span>{form?.name || "Sin formulario asignado"}</span><small>{form ? "Abre este formulario en Builder para diseñarlo." : label}</small></div>;
}}/>}</div></div><output className="landing-editor-announcement" aria-live="polite">{dragState.target ? "Destino de inserción seleccionado" : validation.valid ? "Documento válido" : `${validation.errors.length} errores de documento`}</output></main>
      {state.selection && selected && !panelOpen && !toolbarCollapsed && <ContextualStyleToolbar
        selection={state.selection}
        selected={selected}
        apply={apply}
        forms={forms}
        pages={pages}
        sections={state.document.sections}
        preview={state.preview}
        onSaveForm={(formId, document) => {
          const formValidation = validateFormDocument(document);
          if (!formValidation.valid) {
            setError(formValidation.errors[0] || "BUILDER_FORM_DOCUMENT_INVALID");
            return Promise.resolve(false);
          }
          setForms((items) => items.map((item) => item.id === formId ? { ...item, draft: document } : item));
          const previous = formSaveQueuesRef.current.get(formId) || Promise.resolve();
          const queued = previous.then(async () => {
            const form = formsRef.current.find((item) => item.id === formId);
            const revision = formRevisionsRef.current.get(formId);
            if (!form?.draft || !Number.isInteger(revision)) throw new Error("FORM_DRAFT_NOT_AVAILABLE");
            const saved = await saveBuilderFormDraft({ assetId: formId, expectedRevision: revision, document });
            formRevisionsRef.current.set(formId,saved.revision);
            setForms((items) => items.map((item) => item.id === formId ? { ...item, draft: saved.document, draft_revision: saved.revision } : item));
            setError("");
          }).catch((value) => setError(value.message || "No se pudo guardar el formulario conectado."));
          formSaveQueuesRef.current.set(formId, queued);
          return queued;
        }}
        onMore={() => openPanel(state.selection)}
        onDuplicate={() => duplicateSelection(state.selection)}
        onDelete={() => removeSelection(state.selection)}
        onMoveUp={() => moveSelection(state.selection, -1)}
        onMoveDown={() => moveSelection(state.selection, 1)}
        onSelectParent={() => dispatch({ type: "select", selection: selectParent(state.selection, state.document) })}
        onClose={() => { setEditing(null); setPanelOpen(false); dispatch({ type: "select", selection: null }); }}
        position={toolbarPosition}
        onTogglePosition={() => setToolbarPosition((value) => value === "top" ? "bottom" : "top")}
      />}
      {state.selection && selected && !panelOpen && <button
        type="button"
        className={`landing-mobile-toolbar-collapse ${toolbarCollapsed ? "is-collapsed" : "is-expanded"}`}
        data-builder-editor-control
        aria-expanded={!toolbarCollapsed}
        aria-label={toolbarCollapsed ? `Mostrar herramientas de ${getSelectionToolbarContext(state.selection, selected)?.label || "selección"}` : "Contraer herramientas"}
        title={toolbarCollapsed ? "Mostrar herramientas" : "Contraer herramientas"}
        onPointerDown={(event) => { event.preventDefault(); event.stopPropagation(); }}
        onClick={(event) => { event.preventDefault(); event.stopPropagation(); setToolbarCollapsed((value) => !value); }}
      >
        <span aria-hidden="true">{toolbarCollapsed ? "☰" : "⌃"}</span>
        {toolbarCollapsed && <strong>{getSelectionToolbarContext(state.selection, selected)?.label || "Editar"}</strong>}
      </button>}
      {panelOpen && state.selection && <Inspector selection={state.selection} selected={selected} forms={forms} apply={apply} preview={state.preview} buttonDefaults={state.document.settings.design_system.buttons || {}} onDelete={() => removeSelection(state.selection)} onDuplicate={() => duplicateSelection(state.selection)} onMove={(delta) => moveSelection(state.selection, delta)} onClose={() => setPanelOpen(false)} onEditForm={(formId) => navigate(`/construir/assets/form/${formId}`)}/>}
    </div>
    {pendingInsert && <div className="landing-mobile-placement-bar" role="status" aria-live="polite">
      <div><small>COLOCANDO</small><strong>{pendingInsert.label || (pendingInsert.kind === "palette-pattern" ? "Pattern" : "Elemento")}</strong><span>Toca una zona “+ Colocar aquí”.</span></div>
      <button type="button" onClick={cancelMobilePlacement}>Cancelar</button>
    </div>}
    {!pendingInsert && <nav className="landing-mobile-context" aria-label="Herramientas principales" onClick={(event) => event.stopPropagation()}>
      <button type="button" onClick={mobileActivate(() => { setPanelOpen(false); setEditing(null); setGlobalStylesOpen(false); setMobileAddOpen(true); })}>＋ Añadir</button>
      <button type="button" onClick={mobileActivate(() => { setPanelOpen(false); setEditing(null); setGlobalStylesOpen(true); setMobileAddOpen(true); })}>Estilos de página</button>
      <button type="button" onClick={() => dispatch({ type: "preview", preview: state.preview === "mobile" ? "desktop" : "mobile" })}>Preview</button>
      {["section", "group"].includes(state.selection?.level) && <button type="button" onClick={() => openPanel(state.selection)}>Editar sección</button>}
    </nav>}
  </div>;
}


function InlineEditableField({ block, field, value, index, selection = null, singleLine = false, placeholder = "Escribe aquí", editing, onBegin, onChange, onEnd }) {
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
  const descriptor = { blockId: block.id, field, index, selection };
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
  const panelRef = useRef(null);
  const triggerRef = useRef(null);
  const storageKey = `orvesen.builder.panel.${id}`;
  const [panelPosition, setPanelPosition] = useState(() => {
    try { return JSON.parse(sessionStorage.getItem(storageKey)) || { x: Math.max(24, window.innerWidth - 390), y: 96 }; }
    catch { return { x: 24, y: 96 }; }
  });
  useEffect(() => {
    if (!open || typeof document === "undefined") return undefined;
    return registerBuilderDismissableLayer({
      target: document,
      layerId: BUILDER_CONTEXT_LAYER,
      onDismiss: () => setOpenMenu(null),
    });
  }, [open, setOpenMenu]);
  const close = () => setOpenMenu(null);
  useEffect(() => {
    try { sessionStorage.setItem(storageKey, JSON.stringify(panelPosition)); } catch { /* Session preferences are optional. */ }
  }, [panelPosition, storageKey]);
  const floatingViewport = useCallback(() => {
    const viewport = getFloatingViewport(window.visualViewport, window.innerWidth, window.innerHeight);
    const editor = triggerRef.current?.closest(".landing-editor")?.getBoundingClientRect();
    return intersectFloatingViewport(viewport, editor);
  }, []);
  const containPanel = useCallback((anchorAware = false) => {
    const panel = panelRef.current;
    if (!panel) return;
    const rect = panel.getBoundingClientRect();
    const viewport = floatingViewport();
    const triggerRect = triggerRef.current?.getBoundingClientRect();
    setPanelPosition((current) => {
      const dimensions = { width: rect.width, height: rect.height };
      const next = anchorAware && triggerRect
        ? placeFloatingPanel(triggerRect, dimensions, viewport)
        : constrainFloatingPanel(current, dimensions, viewport);
      return sameFloatingPosition(current, next) ? current : next;
    });
  }, [floatingViewport]);
  useLayoutEffect(() => {
    if (!open) return undefined;
    containPanel(true);
    const viewport = window.visualViewport;
    const reclamp = () => containPanel(true);
    window.addEventListener("resize", reclamp);
    viewport?.addEventListener("resize", reclamp);
    viewport?.addEventListener("scroll", reclamp);
    return () => {
      window.removeEventListener("resize", reclamp);
      viewport?.removeEventListener("resize", reclamp);
      viewport?.removeEventListener("scroll", reclamp);
    };
  }, [containPanel, open]);
  const beginDrag = (event) => {
    if (window.matchMedia("(max-width: 720px)").matches) return;
    event.preventDefault();
    const origin = { pointerX: event.clientX, pointerY: event.clientY, x: panelPosition.x, y: panelPosition.y };
    const move = (nextEvent) => {
      const rect = panelRef.current?.getBoundingClientRect() || { width: 360, height: 420 };
      const viewport = floatingViewport();
      setPanelPosition(constrainFloatingPanel({ x: origin.x + nextEvent.clientX - origin.pointerX, y: origin.y + nextEvent.clientY - origin.pointerY }, rect, viewport));
    };
    const end = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", end); };
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", end, { once: true });
  };
  return <div className={`landing-quick-popover ${open ? "is-open" : ""}`} data-builder-dismiss-layer={BUILDER_CONTEXT_LAYER}>
    <button ref={triggerRef} type="button" className="landing-quick-trigger" aria-expanded={open} onClick={(event) => { event.stopPropagation(); setOpenMenu(open ? null : id); }}>{trigger}<span className="landing-quick-chevron">⌄</span></button>
    {open && typeof document !== "undefined" && createPortal(
      <div ref={panelRef} className="landing-floating-panel" data-builder-editor-control data-builder-dismiss-layer={BUILDER_CONTEXT_LAYER} style={{ left: panelPosition.x, top: panelPosition.y }} onClick={(event) => event.stopPropagation()}>
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
    <div className="landing-form-quick-fields">{form.draft.fields.map((field,index)=><details key={field.id}><summary>{field.label || field.type}</summary><label>Tipo<select value={field.type} onChange={(event)=>commit((next)=>{next.fields=next.fields.map((item)=>item.id===field.id?changeFormFieldType(item,event.target.value):item)})}>{["text","email","tel","textarea","select","checkbox","radio","number","url"].map((type)=><option key={type}>{type}</option>)}</select></label><label>Label<input defaultValue={field.label} onBlur={(event)=>updateField(field.id,{label:event.target.value})}/></label><label>Placeholder<input defaultValue={field.placeholder} onBlur={(event)=>updateField(field.id,{placeholder:event.target.value})}/></label>{["select","radio"].includes(field.type)&&<label>Opciones<textarea defaultValue={(field.options||[]).join("\n")} onBlur={(event)=>updateField(field.id,{options:event.target.value.split("\n").map((value)=>value.trim()).filter(Boolean).slice(0,30)})}/></label>}<label><input type="checkbox" checked={field.required} onChange={(event)=>updateField(field.id,{required:event.target.checked})}/> Requerido</label><label>Ancho<select value={field.width} onChange={(event)=>updateField(field.id,{width:event.target.value})}><option value="full">Completo</option><option value="half">Mitad</option></select></label><div><button type="button" disabled={index===0} onClick={()=>commit((next)=>{const [item]=next.fields.splice(index,1);next.fields.splice(index-1,0,item)})}><ArrowUp size={14}/></button><button type="button" disabled={index===form.draft.fields.length-1} onClick={()=>commit((next)=>{const [item]=next.fields.splice(index,1);next.fields.splice(index+1,0,item)})}><ArrowDown size={14}/></button><button type="button" onClick={()=>commit((next)=>next.fields.splice(index+1,0,{...structuredClone(field),id:createBuilderId()}))}><Copy size={14}/></button><button type="button" onClick={()=>commit((next)=>{next.fields=next.fields.filter((item)=>item.id!==field.id)})}><Trash2 size={14}/></button></div></details>)}</div>
    <button type="button" onClick={()=>commit((next)=>next.fields.push(createFormField("text")))}>＋ Añadir campo</button>
  </div>;
}

function AppearancePresetPicker({ value = {}, onChange, onReset = () => onChange(undefined) }) {
  const activePreset = value?.preset;
  return <section className="landing-preset-contract" data-preset-state={activePreset ? "preset" : "custom"}>
    <div className="landing-preset-status">
      <span>{activePreset ? <>Preset: <strong>{activePreset.replaceAll("_", " ")}</strong></> : <strong>Personalizado</strong>}</span>
      {activePreset && <button type="button" onClick={() => onChange(detachAppearancePreset(value))}>Desvincular</button>}
    </div>
    <div className="landing-appearance-presets">{Object.keys(APPEARANCE_PRESETS).map((id)=><button key={id} type="button" className={activePreset===id?"is-active":""} aria-pressed={activePreset===id} onClick={()=>onChange(applyAppearancePreset(APPEARANCE_PRESETS[id]))}><i data-preview={id}/><span>{id.replaceAll("_"," ")}</span></button>)}</div>
    <button type="button" className="landing-preset-reset" onClick={onReset}>Restablecer apariencia</button>
  </section>;
}

function AppearancePanel({ value = {}, onChange }) {
  const patch = (changes) => onChange(customizeAppearance(value, changes));
  return <div className="landing-appearance-panel">
    <AppearancePresetPicker value={value} onChange={onChange}/>
    <details><summary>Superficie</summary><div className="landing-option-grid">{["inherit","solid","gradient","glass","transparent"].map((id)=><button key={id} type="button" className={value.surface===id?"is-active":""} onClick={()=>patch({surface:id})}>{id}</button>)}</div></details>
    <details><summary>Gradiente</summary><div className="landing-option-grid">{GRADIENT_PRESETS.map((id)=><button key={id} type="button" className={value.gradient?.preset===id?"is-active":""} onClick={()=>patch({surface:"gradient",gradient:{type:"linear",preset:id,angle:135,intensity:60}})}>{id.replace("_"," ")}</button>)}</div></details>
    <details><summary>Sombra</summary><div className="landing-option-grid">{SHADOW_TOKENS.map((id)=><button key={id} type="button" className={value.shadow?.token===id?"is-active":""} onClick={()=>patch({shadow:{token:id,intensity:id==="none"?0:40}})}>{id}</button>)}</div></details>
    <details><summary>Luz</summary><div className="landing-option-grid">{GLOW_TOKENS.map((id)=><button key={id} type="button" className={value.glow?.token===id?"is-active":""} onClick={()=>patch({glow:{token:id,intensity:id==="none"?0:40,position:"center",blur:"md"}})}>{id}</button>)}</div></details>
    <details><summary>Borde</summary><div className="landing-option-grid">{["none","subtle","standard","highlight"].map((id)=><button key={id} type="button" className={value.border===id?"is-active":""} onClick={()=>patch({border:id})}>{id}</button>)}</div></details>
    <details><summary>Avanzado</summary><label>Opacidad<select value={value.opacity??100} onChange={(event)=>patch({opacity:Number(event.target.value)})}>{[20,40,60,80,100].map((id)=><option key={id} value={id}>{id}%</option>)}</select></label><label>Blur<select value={value.blur||"none"} onChange={(event)=>patch({blur:event.target.value})}>{["none","sm","md"].map((id)=><option key={id}>{id}</option>)}</select></label><label>Textura<select value={value.texture||"none"} onChange={(event)=>patch({texture:event.target.value})}><option value="none">Sin textura</option><option value="grain">Grano sutil</option></select></label></details>
  </div>;
}

function ButtonTextEditor({ action, onChange }) {
  const [value, setValue] = useState(action?.label || "");
  const [error, setError] = useState("");
  const submit = (event) => {
    event.preventDefault();
    const result = validateButtonLabel(value);
    if (!result.valid) { setError(result.error); return; }
    onChange({ label: result.label });
    setError("");
  };
  return <form className="landing-button-compact-editor" onSubmit={submit}>
    <label>Texto del botón<input autoFocus value={value} maxLength={80} onChange={(event)=>setValue(event.target.value)}/></label>
    {error && <p className="landing-button-editor-error" role="alert">{error}</p>}
    <button type="submit">Aplicar texto</button>
  </form>;
}

function ButtonActionEditor({ action, sections, onChange }) {
  const initialKind = classifyButtonAction(action?.href || "");
  const [kind, setKind] = useState(initialKind);
  const [value, setValue] = useState(getButtonActionValue(action?.href || "", initialKind));
  const [error, setError] = useState("");
  const anchoredSections = sections.filter((section) => section.anchor);
  const changeKind = (nextKind) => {
    setKind(nextKind);
    setError("");
    if (nextKind === "section") setValue(anchoredSections[0]?.anchor || "");
    else if (nextKind === "url") setValue("https://");
    else setValue("");
  };
  const submit = (event) => {
    event.preventDefault();
    const result = buildButtonDestination(kind, value);
    if (!result.valid) { setError(result.error); return; }
    onChange({ href: result.href });
    setError("");
  };
  return <form className="landing-button-compact-editor" onSubmit={submit}>
    <label>Tipo de acción<select value={kind} onChange={(event)=>changeKind(event.target.value)}><option value="section">Sección</option><option value="url">URL HTTPS</option><option value="email">Email</option><option value="phone">Teléfono</option></select></label>
    {kind === "section"
      ? <label>Sección<select value={value} onChange={(event)=>setValue(event.target.value)}><option value="">Elegir sección</option>{anchoredSections.map((section)=><option key={section.id} value={section.anchor}>{section.label || section.anchor}</option>)}</select></label>
      : <label>{kind === "url" ? "URL" : kind === "email" ? "Email" : "Teléfono"}<input value={value} inputMode={kind === "phone" ? "tel" : kind === "email" ? "email" : "url"} placeholder={kind === "url" ? "https://example.com" : kind === "email" ? "contacto@example.com" : "+591 70000000"} onChange={(event)=>setValue(event.target.value)}/></label>}
    {kind === "section" && !anchoredSections.length && <p className="landing-toolbar-note">Añade un anchor a una sección para enlazarla.</p>}
    {error && <p className="landing-button-editor-error" role="alert">{error}</p>}
    <button type="submit">Aplicar acción</button>
  </form>;
}

function HeaderLayoutPanel({ content, blockStyle = {}, onContentChange, onBlockStyleChange }) {
  const activePreset = getHeaderLayoutPreset(content.preset);
  const linked = Boolean(activePreset && HEADER_LAYOUT_PRESETS.some((preset) => preset.id === activePreset.id));
  const legacy = Boolean(activePreset && !linked);
  const applyPreset = (presetId) => {
    onContentChange(applyHeaderLayoutPreset(content, presetId), "header-layout-preset");
    onBlockStyleChange(getHeaderPresetBlockStyle(presetId), "header-layout-preset");
  };
  const customizeContent = (changes) => {
    onContentChange({ ...removeHeaderPreset(content), ...changes }, "header-layout-custom");
  };
  const customizeBlock = (changes) => {
    onContentChange(removeHeaderPreset(content), "header-layout-custom");
    onBlockStyleChange(changes, "header-layout-custom");
  };
  const resetStructure = () => {
    onContentChange(resetHeaderLayout(content), "header-layout-reset");
    onBlockStyleChange(getHeaderPresetBlockStyle("classic"), "header-layout-reset");
  };
  return <div className="landing-header-layout-panel">
    <div className="landing-preset-status" data-preset-state={linked ? "preset" : "custom"}>
      <span>{linked ? <>Preset: <strong>{activePreset.label}</strong></> : <strong>Personalizado</strong>}</span>
      {linked && <button type="button" onClick={() => onContentChange(removeHeaderPreset(content), "header-layout-remove-preset")}>Quitar preset</button>}
    </div>
    {legacy && <p className="landing-toolbar-note">Este Header conserva un preset visual legacy. Elige un layout para actualizar su estructura sin perder contenido.</p>}
    <div className="landing-header-preset-grid">{HEADER_LAYOUT_PRESETS.map((preset)=><button key={preset.id} type="button" className={linked && activePreset.id===preset.id?"is-active":""} data-preset={preset.id} aria-pressed={linked && activePreset.id===preset.id} onClick={()=>applyPreset(preset.id)}><i data-layout-preview={preset.id}/><span>{preset.label}</span></button>)}</div>
    <label>Ancho del contenedor interno<select value={blockStyle.max_width || "none"} onChange={(event)=>customizeBlock({max_width:event.target.value})}><option value="none">Completo</option><option value="wide">90%</option><option value="standard">75%</option><option value="narrow">50%</option></select></label>
    <label>Posición del contenedor<select value={blockStyle.align || "center"} onChange={(event)=>customizeBlock({align:event.target.value})}><option value="start">Inicio</option><option value="center">Centro</option><option value="end">Final</option></select></label>
    <label>Distribución interna<select value={content.alignment} onChange={(event)=>customizeContent({alignment:event.target.value})}><option value="start">Inicio</option><option value="center">Centro</option><option value="spread">Distribuida</option></select></label>
    <button type="button" className="landing-preset-reset" onClick={resetStructure}>Restablecer estructura</button>
  </div>;
}

function HeaderBrandEditor({ content, onChange }) {
  return <div className="landing-option-list landing-header-brand-editor">
    <label>Nombre<input value={content.brand_name} onChange={(event)=>onChange({brand_name:event.target.value})}/></label>
    <label>Logo HTTPS<input value={content.logo_url} onChange={(event)=>onChange({logo_url:event.target.value})}/></label>
    <label>Tamaño del logo<select value={content.logo_size} onChange={(event)=>onChange({logo_size:event.target.value})}><option value="sm">Pequeño</option><option value="md">Medio</option><option value="lg">Grande</option></select></label>
  </div>;
}

const HEADER_NAV_STYLE_GROUPS = Object.freeze([
  Object.freeze({ label:"Tipografía", fields:["font_family","font_size","font_weight","text_color"] }),
  Object.freeze({ label:"Forma", fields:["gap","alignment","padding_x","padding_y","background","border","border_width","border_color","radius"] }),
  Object.freeze({ label:"Estados", fields:["hover_background","hover_text_color","active_background","active_text_color"] }),
]);

const HEADER_NAV_STYLE_LABELS = Object.freeze({
  font_family:"Familia", font_size:"Tamaño", font_weight:"Peso", text_color:"Color de texto",
  gap:"Separación", alignment:"Alineación", padding_x:"Padding horizontal", padding_y:"Padding vertical",
  background:"Fondo", border:"Borde", border_width:"Grosor", border_color:"Color de borde", radius:"Radio",
  hover_background:"Fondo hover", hover_text_color:"Texto hover",
  active_background:"Fondo activo", active_text_color:"Texto activo",
});

function headerNavOptionLabel(value) {
  return ({
    inherit:"Heredar", sans:"Sans", serif:"Serif", display:"Display", mono:"Mono",
    xs:"XS", sm:"S", md:"M", lg:"L", xl:"XL", regular:"Regular", medium:"Medium",
    semibold:"Semibold", bold:"Bold", text:"Texto", muted:"Secundario", primary:"Acento",
    light:"Claro", dark:"Oscuro", none:"Ninguno", transparent:"Transparente", surface:"Superficie",
    page:"Página", subtle:"Sutil", standard:"Estándar", thin:"Fino", current:"Actual",
    pill:"Píldora", start:"Inicio", center:"Centro", end:"Final",
  })[value] || value;
}

function HeaderNavStyleEditor({ content, item = null, itemIndex = null, onChange }) {
  const itemOverride = Boolean(item);
  const storedStyle = itemOverride ? (item.style || {}) : (content.nav_style || {});
  const effectiveStyle = itemOverride ? getEffectiveHeaderNavItemStyle(content, item) : { ...HEADER_NAV_STYLE_DEFAULTS, ...storedStyle };
  const patch = (changes) => {
    if (itemOverride) {
      const next = updateHeaderNavItemStyle(content, item.id, changes, itemIndex);
      onChange({ nav_items:next.nav_items }, "header-nav-item-style");
      return;
    }
    const next = updateHeaderNavStyle(content, changes);
    onChange({ nav_style:next.nav_style || {} }, "header-nav-style");
  };
  const setField = (field, rawValue) => {
    const value = itemOverride && rawValue === "" ? undefined : rawValue;
    const changes = { [field]:value };
    if (field === "border" && value && value !== "none" && effectiveStyle.border_width === "none") changes.border_width = "thin";
    patch(changes);
  };
  return <div className="landing-header-nav-style-editor" data-style-scope={itemOverride ? "item" : "global"}>
    <p className="landing-toolbar-note">{itemOverride ? "Solo se guardan los valores que sobrescriben el estilo global del Nav." : "Este estilo base se aplica a todos los enlaces de navegación."}</p>
    {HEADER_NAV_STYLE_GROUPS.map((group) => {
      const fields = itemOverride ? group.fields.filter((field)=>!["gap","alignment"].includes(field)) : group.fields;
      return <details key={group.label} open={group.label === "Tipografía"}><summary>{group.label}</summary><div className="landing-header-nav-style-grid">{fields.map((field)=><label key={field}>{HEADER_NAV_STYLE_LABELS[field]}<select value={itemOverride ? (storedStyle[field] || "") : effectiveStyle[field]} onChange={(event)=>setField(field,event.target.value)}>{itemOverride && <option value="">Heredar del Nav</option>}{HEADER_NAV_STYLE_OPTIONS[field].map((value)=><option key={value} value={value}>{headerNavOptionLabel(value)}</option>)}</select></label>)}</div></details>;
    })}
    {itemOverride && <button type="button" className="landing-preset-reset" onClick={()=>{
      const next = resetHeaderNavItemStyle(content, item.id, itemIndex);
      onChange({nav_items:next.nav_items}, "header-nav-item-style-reset");
    }}>Restablecer al estilo del Nav</button>}
  </div>;
}

function updateHeaderNavItem(content, index, changes) {
  return content.nav_items.map((item, itemIndex)=>itemIndex===index?{...item,...changes}:item);
}

function HeaderNavItemEditor({ content, itemIndex, pages, sections, currentSectionId, apply, onChange, allowRemove = true }) {
  const item = content.nav_items[itemIndex];
  if (!item) return <p className="landing-toolbar-note">Este enlace ya no existe.</p>;
  const updateNav = (changes) => onChange({ nav_items:updateHeaderNavItem(content, itemIndex, changes) }, "header-nav");
  const chooseSection = (sectionId) => {
    const targetSection = sections.find((item)=>item.id===sectionId);
    if (!targetSection) return;
    const anchor = targetSection.anchor || safeAnchor(targetSection.label || `seccion-${targetSection.id.slice(0,8)}`);
    if (!targetSection.anchor) apply({type:"update_section",section_id:targetSection.id,changes:{anchor}},`section-anchor-${targetSection.id}`,600);
    updateNav({target:{type:"section",section_id:targetSection.id,anchor},href:undefined});
  };
  const targetType = item.target?.type
    || (item.href?.startsWith("#")
      ? "section"
      : item.href?.startsWith("mailto:")
        ? "email"
        : item.href?.startsWith("tel:")
          ? "phone"
          : "url");
  const destinationValue = item.target?.url
    || item.target?.email
    || item.target?.phone
    || (targetType === "email" ? item.href?.slice("mailto:".length) : targetType === "phone" ? item.href?.slice("tel:".length) : item.href)
    || "";
  return <fieldset className="landing-header-nav-item-editor">
      <label><input type="checkbox" checked={item.enabled} onChange={(event)=>updateNav({enabled:event.target.checked})}/> Visible</label>
      <input aria-label="Texto" value={item.label} onChange={(event)=>updateNav({label:event.target.value})}/>
      <select aria-label="Tipo de destino" value={targetType} onChange={(event)=>{const type=event.target.value;updateNav({target:type==="section"?{type:"section",anchor:"seccion"}:type==="page"?{type:"page",asset_id:pages[0]?.id}:type==="email"?{type:"email",email:"contacto@example.com"}:type==="phone"?{type:"phone",phone:"+10000000000"}:{type:"url",url:"https://example.com"},href:undefined})}}><option value="section">Sección de esta página</option><option value="page" disabled={!pages.length}>Otra página ORVESEN</option><option value="url">URL externa</option><option value="email">Email</option><option value="phone">Teléfono</option></select>
      {targetType==="section"
        ? <select value={item.target?.section_id||""} onChange={(event)=>chooseSection(event.target.value)}><option value="">Elegir sección</option>{sections.filter((section)=>section.id!==currentSectionId).map((section)=><option key={section.id} value={section.id}>{section.label||section.anchor||`Sección ${section.id.slice(0,6)}`}</option>)}</select>
        : targetType==="page"
          ? <select value={item.target?.asset_id||""} onChange={(event)=>updateNav({target:{type:"page",asset_id:event.target.value}})}><option value="">Elegir página</option>{pages.map((page)=><option key={page.id} value={page.id}>{page.name}</option>)}</select>
          : <input
              key={`${item.id}-${targetType}`}
              aria-label="Destino"
              defaultValue={destinationValue}
              onBlur={(event)=>updateNav({target:{type:targetType,[targetType]:event.target.value},href:undefined})}
            />}
      {allowRemove && <button type="button" onClick={()=>onChange({nav_items:content.nav_items.filter((_,candidateIndex)=>candidateIndex!==itemIndex)},"header-nav-remove")}><Trash2 size={14}/> Quitar</button>}
    </fieldset>;
}

function HeaderNavigationEditor({ content, pages, sections, currentSectionId, apply, onChange }) {
  return <div className="landing-header-nav-editor">
    {content.nav_items.map((item,index)=><HeaderNavItemEditor key={item.id||index} content={content} itemIndex={index} pages={pages} sections={sections} currentSectionId={currentSectionId} apply={apply} onChange={onChange}/>)}
    <button type="button" onClick={()=>onChange({nav_items:[...content.nav_items,{id:`nav-${createBuilderId()}`,label:"Enlace",target:{type:"section",anchor:"seccion"},enabled:true}]},"header-nav-add")}>＋ Añadir enlace</button>
  </div>;
}

function HeaderCtaEditor({ content, sections, onChange }) {
  const updateCta = (changes) => onChange({ cta:{...content.cta,...changes} }, "header-cta");
  return <div className="landing-header-cta-editor">
    <label><input type="checkbox" checked={content.cta.enabled} onChange={(event)=>updateCta({enabled:event.target.checked})}/> Mostrar CTA</label>
    <ButtonTextEditor action={content.cta} onChange={updateCta}/>
    <ButtonActionEditor action={content.cta} sections={sections} onChange={updateCta}/>
    <p className="landing-toolbar-note">El CTA comparte texto y destinos seguros con Button. Su apariencia continúa perteneciendo al Header porque el schema actual no persiste estilo individual para este CTA.</p>
  </div>;
}

function HeaderAppearanceEditor({ content, appearance = {}, sectionStyle = {}, onContentChange, onAppearanceChange, onSectionStyleChange }) {
  const commitAppearance = (next) => {
    if (content.preset !== "custom") onContentChange({preset:"custom"}, "header-layout-custom");
    onAppearanceChange(next && Object.keys(next).length ? next : undefined);
  };
  const patchAppearance = (changes) => commitAppearance(customizeAppearance(appearance, changes));
  const changeContentAppearance = (changes, group) => {
    onContentChange({ ...changes, preset:"custom" }, group);
    if (appearance.preset) onAppearanceChange(detachAppearancePreset(appearance));
  };
  const changeInnerSurface = (surface) => {
    changeContentAppearance({surface}, "header-inner-surface");
    if (appearance.surface || appearance.gradient) patchAppearance({surface:undefined,gradient:undefined});
  };
  const resetInner = () => {
    onAppearanceChange(undefined);
    const defaults = resetHeaderAppearance(content);
    onContentChange({preset:"custom",surface:defaults.surface,text_color:defaults.text_color,shadow:defaults.shadow,border:defaults.border,spacing:defaults.spacing}, "header-appearance-reset");
  };
  const outerBackground = sectionStyle.background;
  const outerBackgroundValue = !outerBackground
    ? "inherit"
    : typeof outerBackground === "string"
      ? outerBackground
      : outerBackground.type === "transparent"
        ? "transparent"
        : outerBackground.type === "solid"
          ? outerBackground.color
          : "advanced";
  const changeOuterBackground = (value) => onSectionStyleChange({
    background:value === "inherit" ? undefined : value === "transparent" ? {type:"transparent"} : {type:"solid",color:value},
  }, "header-outer-background");
  return <div className="landing-header-appearance-editor">
    <details open><summary>Superficie exterior · Section</summary>
      <label>Fondo exterior<select value={outerBackgroundValue} onChange={(event)=>changeOuterBackground(event.target.value)}>{outerBackgroundValue === "advanced" && <option value="advanced" disabled>Configuración avanzada actual</option>}<option value="inherit">Heredar de página</option><option value="transparent">Transparente</option><option value="page_background">Página</option><option value="surface">Superficie</option><option value="primary">Acento</option><option value="text">Texto</option></select></label>
      <label>Separación superior<select value={sectionStyle.padding_top || ""} onChange={(event)=>onSectionStyleChange({padding_top:event.target.value || undefined},"header-outer-padding-top")}><option value="">Heredar</option>{["none","xs","sm","md","lg","xl"].map((value)=><option key={value} value={value}>{headerNavOptionLabel(value)}</option>)}</select></label>
      <label>Separación inferior<select value={sectionStyle.padding_bottom || ""} onChange={(event)=>onSectionStyleChange({padding_bottom:event.target.value || undefined},"header-outer-padding-bottom")}><option value="">Heredar</option>{["none","xs","sm","md","lg","xl"].map((value)=><option key={value} value={value}>{headerNavOptionLabel(value)}</option>)}</select></label>
    </details>
    <details open><summary>Contenedor interno · Header</summary>
      <label>Superficie<select value={content.surface} onChange={(event)=>changeInnerSurface(event.target.value)}>{HEADER_SURFACES.map(({id,label})=><option key={id} value={id}>{label}</option>)}</select></label>
      <label>Texto<select value={content.text_color} onChange={(event)=>changeContentAppearance({text_color:event.target.value},"header-inner-text")}><option value="text">Texto de página</option><option value="muted">Secundario</option><option value="primary">Acento</option><option value="light">Claro</option><option value="dark">Oscuro</option></select></label>
      <label>Padding<select value={content.spacing} onChange={(event)=>changeContentAppearance({spacing:event.target.value},"header-inner-spacing")}><option value="sm">Compacto</option><option value="md">Normal</option><option value="lg">Amplio</option></select></label>
      <label>Borde<select value={content.border} onChange={(event)=>changeContentAppearance({border:event.target.value},"header-inner-border")}>{["none","subtle","standard"].map((value)=><option key={value} value={value}>{headerNavOptionLabel(value)}</option>)}</select></label>
      <label>Sombra<select value={content.shadow} onChange={(event)=>changeContentAppearance({shadow:event.target.value},"header-inner-shadow")}>{["none","subtle","soft"].map((value)=><option key={value} value={value}>{headerNavOptionLabel(value)}</option>)}</select></label>
      <label>Radio<select value={appearance.radius || "none"} onChange={(event)=>patchAppearance({radius:event.target.value})}>{["none","sm","md","lg","xl"].map((value)=><option key={value} value={value}>{headerNavOptionLabel(value)}</option>)}</select></label>
    </details>
    <button type="button" className="landing-preset-reset" onClick={resetInner}>Restablecer contenedor interno</button>
  </div>;
}

function FooterTextInput({ value = "", onCommit, allowEmpty = true, validate, ...props }) {
  const commit = (input) => {
    const draft = input.value;
    const accepted = (allowEmpty || draft.trim().length > 0) && (!validate || validate(draft));
    if (!accepted) { input.value = value; return; }
    if (draft !== value) onCommit(draft);
  };
  return <input key={value} {...props} defaultValue={value} onBlur={(event)=>commit(event.currentTarget)} onKeyDown={(event)=>{ if (event.key === "Enter") event.currentTarget.blur(); }}/>;
}

const isSafeFooterLink = (value) => {
  if (/^#[^\s]*$/.test(value) || /^mailto:[^\s]+$/.test(value) || /^tel:\+?[0-9(). -]+$/.test(value)) return true;
  try { return !/\s/.test(value) && new URL(value).protocol === "https:"; }
  catch { return false; }
};

function FooterLayoutPanel({ content, blockStyle = {}, onContentChange, onBlockStyleChange }) {
  const applyPreset = (presetId) => {
    onContentChange(applyFooterLayoutPreset(content, presetId), "footer-layout-preset");
    onBlockStyleChange(getFooterPresetBlockStyle(presetId), "footer-layout-preset");
  };
  const customizeContent = (changes) => onContentChange({ ...changes, preset:"custom" }, "footer-layout-custom");
  const customizeBlock = (changes) => {
    if (content.preset !== "custom") onContentChange({preset:"custom"}, "footer-layout-custom");
    onBlockStyleChange(changes, "footer-layout-custom");
  };
  return <div className="landing-header-layout-panel landing-footer-layout-panel">
    <div className="landing-preset-status" data-preset-state={content.preset === "custom" ? "custom" : "preset"}><span>{content.preset === "custom" ? <strong>Personalizado</strong> : <>Preset: <strong>{FOOTER_LAYOUT_PRESETS.find((item)=>item.id===content.preset)?.label || content.preset}</strong></>}</span></div>
    <div className="landing-header-preset-grid">{FOOTER_LAYOUT_PRESETS.map((preset)=><button key={preset.id} type="button" className={content.preset===preset.id?"is-active":""} data-preset={preset.id} aria-pressed={content.preset===preset.id} onClick={()=>applyPreset(preset.id)}><i data-layout-preview={preset.id}/><span>{preset.label}</span></button>)}</div>
    <label>Ancho del contenedor interno<select value={blockStyle.max_width || "none"} onChange={(event)=>customizeBlock({max_width:event.target.value})}><option value="none">Completo</option><option value="wide">90%</option><option value="standard">75%</option><option value="narrow">50%</option></select></label>
    <label>Posición del contenedor<select value={blockStyle.align || "center"} onChange={(event)=>customizeBlock({align:event.target.value})}><option value="start">Inicio</option><option value="center">Centro</option><option value="end">Final</option></select></label>
    <label>Alineación interna<select value={content.alignment} onChange={(event)=>customizeContent({alignment:event.target.value})}><option value="start">Inicio</option><option value="center">Centro</option></select></label>
    <label>Espaciado<select value={content.spacing} onChange={(event)=>customizeContent({spacing:event.target.value})}>{["sm","md","lg"].map((value)=><option key={value} value={value}>{headerNavOptionLabel(value)}</option>)}</select></label>
    <label>Separación entre áreas<select value={content.gap} onChange={(event)=>customizeContent({gap:event.target.value})}>{["sm","md","lg"].map((value)=><option key={value} value={value}>{headerNavOptionLabel(value)}</option>)}</select></label>
  </div>;
}

function FooterBrandEditor({ content, onChange }) {
  const updateBrand = (changes) => onChange({brand:{...content.brand,...changes}}, "footer-brand");
  return <div className="landing-option-list landing-header-brand-editor landing-footer-brand-editor">
    <label>Nombre<FooterTextInput value={content.brand.name} maxLength={120} allowEmpty={Boolean(content.brand.logo_url)} onCommit={(name)=>updateBrand({name})}/></label>
    <label>Logo HTTPS<FooterTextInput value={content.brand.logo_url} inputMode="url" maxLength={2048} validate={(value)=>value === "" || (()=>{try{return !/\s/.test(value) && new URL(value).protocol === "https:"}catch{return false}})()} onCommit={(logo_url)=>updateBrand({logo_url})}/></label>
    <label>Tamaño del logo<select value={content.brand.logo_size} onChange={(event)=>updateBrand({logo_size:event.target.value})}><option value="sm">Pequeño</option><option value="md">Medio</option><option value="lg">Grande</option></select></label>
    <label>Descripción<textarea value={content.brand.tagline} maxLength={400} onChange={(event)=>updateBrand({tagline:event.target.value})}/></label>
  </div>;
}

function FooterLinkDestinationEditor({ link, pages, sections, onChange }) {
  const inferredKind = link.target?.type || classifyButtonAction(link.href || "#");
  const inferredValue = link.target?.asset_id
    || link.target?.anchor
    || link.target?.url
    || link.target?.email
    || link.target?.phone
    || getButtonActionValue(link.href || "#", inferredKind);
  const [kind, setKind] = useState(inferredKind);
  const [value, setValue] = useState(inferredValue);
  const [error, setError] = useState("");
  const submit = (event) => {
    event.preventDefault();
    if (kind === "page") {
      if (!pages.some((page)=>page.id===value)) { setError("Selecciona una página válida."); return; }
      onChange({target:{type:"page",asset_id:value},href:undefined});
      setError("");
      return;
    }
    const result = buildButtonDestination(kind, value);
    if (!result.valid) { setError(result.error); return; }
    onChange({href:result.href,target:undefined});
    setError("");
  };
  const anchoredSections = sections.filter((section)=>section.anchor);
  return <form className="landing-button-compact-editor landing-footer-destination-editor" onSubmit={submit}>
    <label>Destino<select value={kind} onChange={(event)=>{const next=event.target.value;setKind(next);setError("");setValue(next==="page"?(pages[0]?.id||""):next==="section"?(anchoredSections[0]?.anchor||""):next==="url"?"https://":"");}}><option value="section">Sección</option><option value="page" disabled={!pages.length}>Otra página ORVESEN</option><option value="url">URL HTTPS</option><option value="email">Email</option><option value="phone">Teléfono</option></select></label>
    {kind === "section" ? <label>Anchor<select value={value} onChange={(event)=>setValue(event.target.value)}>{value && !anchoredSections.some((section)=>section.anchor===value) && <option value={value}>#{value}</option>}<option value="">Elegir sección</option>{anchoredSections.map((section)=><option key={section.id} value={section.anchor}>{section.label || section.anchor}</option>)}</select></label>
      : kind === "page" ? <label>Página<select value={value} onChange={(event)=>setValue(event.target.value)}><option value="">Elegir página</option>{pages.map((page)=><option key={page.id} value={page.id}>{page.name}</option>)}</select></label>
        : <label>{kind === "url" ? "URL" : kind === "email" ? "Email" : "Teléfono"}<input value={value} onChange={(event)=>setValue(event.target.value)}/></label>}
    {error && <p className="landing-button-editor-error" role="alert">{error}</p>}
    <button type="submit">Aplicar destino</button>
  </form>;
}

function FooterLinkItemEditor({ link, index, count, pages, sections, onChange, onMove, onRemove }) {
  return <fieldset className="landing-header-nav-item-editor landing-footer-link-item-editor">
    <label><input type="checkbox" checked={link.enabled} onChange={(event)=>onChange({enabled:event.target.checked})}/> Visible</label>
    <label>Texto<FooterTextInput value={link.label} maxLength={80} allowEmpty={false} onCommit={(label)=>onChange({label})}/></label>
    <FooterLinkDestinationEditor link={link} pages={pages} sections={sections} onChange={onChange}/>
    <div className="landing-inspector-actions">
      {onMove && <><button type="button" disabled={index === 0} onClick={()=>onMove(-1)}><ArrowUp size={14}/> Subir</button><button type="button" disabled={index === count - 1} onClick={()=>onMove(1)}><ArrowDown size={14}/> Bajar</button></>}
      <button type="button" className="is-danger" onClick={onRemove}><Trash2 size={14}/> Quitar</button>
    </div>
  </fieldset>;
}

function FooterLinkGroupEditor({ content, group, pages, sections, onChange }) {
  if (!group) return <p className="landing-toolbar-note">Este grupo ya no existe.</p>;
  const updateGroup = (changes) => onChange(updateFooterLinkGroup(content, group.id, changes), "footer-links");
  const updateLink = (linkId, changes) => updateGroup({links:group.links.map((link)=>link.id===linkId?{...link,...changes}:link)});
  return <section className="landing-header-nav-editor landing-footer-link-group-editor">
    <label>Título del grupo<FooterTextInput value={group.title} maxLength={80} onCommit={(title)=>updateGroup({title})}/></label>
    {group.links.map((link,index)=><FooterLinkItemEditor key={link.id} link={link} index={index} count={group.links.length} pages={pages} sections={sections} onChange={(changes)=>updateLink(link.id,changes)} onMove={(direction)=>onChange(moveFooterLink(content,group.id,link.id,direction),"footer-link-move")} onRemove={()=>onChange(removeFooterLink(content,group.id,link.id),"footer-link-remove")}/>) }
    <button type="button" disabled={group.links.length >= 8} onClick={()=>onChange(addFooterLink(content,group.id),"footer-link-add")}>＋ Añadir enlace</button>
  </section>;
}

function FooterLinksEditor({ content, pages, sections, onChange, groupId = null, linkId = null }) {
  const groups = groupId ? content.link_groups.filter((group)=>group.id===groupId) : content.link_groups;
  if (linkId) {
    const group = groups[0];
    const link = group?.links.find((item)=>item.id===linkId);
    if (!group || !link) return <p className="landing-toolbar-note">Este enlace ya no existe.</p>;
    const index = group.links.findIndex((item)=>item.id===link.id);
    const updateLink = (changes) => onChange(updateFooterLinkGroup(content,group.id,{links:group.links.map((item)=>item.id===link.id?{...item,...changes}:item)}),"footer-link");
    return <FooterLinkItemEditor key={link.id} link={link} index={index} count={group.links.length} pages={pages} sections={sections} onChange={updateLink} onMove={(direction)=>onChange(moveFooterLink(content,group.id,link.id,direction),"footer-link-move")} onRemove={()=>onChange(removeFooterLink(content,group.id,link.id),"footer-link-remove")}/>;
  }
  return <div className="landing-footer-links-editor">{groups.map((group)=><FooterLinkGroupEditor key={group.id} content={content} group={group} pages={pages} sections={sections} onChange={onChange}/>)}</div>;
}

function FooterSocialEditor({ content, onChange }) {
  const social = content.social;
  const updateSocial = (changes, group = "footer-social") => onChange({social:{...social,...changes}}, group);
  const updateLink = (index, changes) => updateSocial({links:social.links.map((link,candidate)=>candidate===index?{...link,...changes}:link)});
  return <div className="landing-option-list landing-footer-social-editor">
    <label><input type="checkbox" checked={content.social_enabled} onChange={(event)=>onChange({social_enabled:event.target.checked},"footer-social-enabled")}/> Mostrar redes</label>
    <label>Estilo<select value={social.variant} onChange={(event)=>updateSocial({variant:event.target.value})}>{["minimal","circle","square","filled","outline"].map((value)=><option key={value}>{value}</option>)}</select></label>
    <label>Tamaño<select value={social.size} onChange={(event)=>updateSocial({size:event.target.value})}>{["sm","md","lg"].map((value)=><option key={value}>{value}</option>)}</select></label>
    <label>Separación<select value={social.gap} onChange={(event)=>updateSocial({gap:event.target.value})}>{["sm","md","lg"].map((value)=><option key={value}>{value}</option>)}</select></label>
    <label>Alineación<select value={social.align} onChange={(event)=>updateSocial({align:event.target.value})}>{["start","center","end"].map((value)=><option key={value}>{value}</option>)}</select></label>
    <label>Color<select value={social.color} onChange={(event)=>updateSocial({color:event.target.value})}>{["text","muted","primary"].map((value)=><option key={value}>{value}</option>)}</select></label>
    {social.links.map((link,index)=><fieldset key={`${link.provider}-${index}`} className="landing-header-nav-item-editor"><label><input type="checkbox" checked={link.enabled !== false} onChange={(event)=>updateLink(index,{enabled:event.target.checked})}/> Visible</label><label>Red<select value={link.provider} onChange={(event)=>updateLink(index,{provider:event.target.value})}>{SOCIAL_LINK_PROVIDERS.map((provider)=><option key={provider}>{provider}</option>)}</select></label><label>Etiqueta<FooterTextInput value={link.label} maxLength={80} allowEmpty={false} onCommit={(label)=>updateLink(index,{label})}/></label><label>URL<FooterTextInput value={link.url} maxLength={2048} validate={isSafeFooterLink} onCommit={(url)=>updateLink(index,{url})}/></label><button type="button" className="is-danger" onClick={()=>updateSocial({links:social.links.filter((_,candidate)=>candidate!==index)},"footer-social-remove")}><Trash2 size={14}/> Quitar</button></fieldset>)}
    <button type="button" disabled={social.links.length >= 10} onClick={()=>updateSocial({links:[...social.links,{provider:"website",url:"https://example.com",label:"Sitio web",enabled:true}]},"footer-social-add")}>＋ Añadir red</button>
  </div>;
}

function FooterBottomEditor({ content, pages, sections, onChange, legalId = null }) {
  const links = legalId ? content.legal_links.filter((link)=>link.id===legalId) : content.legal_links;
  const updateLegal = (linkId, changes) => onChange({legal_links:content.legal_links.map((link)=>link.id===linkId?{...link,...changes}:link)},"footer-legal");
  return <div className="landing-option-list landing-footer-bottom-editor">
    {!legalId && <label>Copyright<textarea value={content.copyright} maxLength={240} onChange={(event)=>onChange({copyright:event.target.value},"footer-copyright")}/></label>}
    {links.map((link)=><fieldset key={link.id} className="landing-header-nav-item-editor"><label><input type="checkbox" checked={link.enabled} onChange={(event)=>updateLegal(link.id,{enabled:event.target.checked})}/> Visible</label><label>Texto<FooterTextInput value={link.label} maxLength={80} allowEmpty={false} onCommit={(label)=>updateLegal(link.id,{label})}/></label><FooterLinkDestinationEditor link={link} pages={pages} sections={sections} onChange={(changes)=>updateLegal(link.id,changes)}/><button type="button" className="is-danger" onClick={()=>onChange({legal_links:content.legal_links.filter((item)=>item.id!==link.id)},"footer-legal-remove")}><Trash2 size={14}/> Quitar</button></fieldset>)}
    {!legalId && <button type="button" disabled={content.legal_links.length >= 6} onClick={()=>onChange({legal_links:[...content.legal_links,{id:createFooterTokenId("legal"),label:"Enlace legal",href:"#",enabled:true}]},"footer-legal-add")}>＋ Añadir enlace legal</button>}
  </div>;
}

function FooterAppearanceEditor({ content, appearance = {}, sectionStyle = {}, onContentChange, onAppearanceChange, onSectionStyleChange }) {
  const outerBackground = sectionStyle.background;
  const outerBackgroundValue = !outerBackground ? "inherit" : typeof outerBackground === "string" ? outerBackground : outerBackground.type === "transparent" ? "transparent" : outerBackground.type === "solid" ? outerBackground.color : "advanced";
  const updateContent = (changes, group) => onContentChange({...changes,preset:"custom"}, group);
  const changeOuterBackground = (value) => onSectionStyleChange({background:value === "inherit" ? undefined : value === "transparent" ? {type:"transparent"} : {type:"solid",color:value}},"footer-outer-background");
  return <div className="landing-header-appearance-editor landing-footer-appearance-editor">
    <details open><summary>Superficie exterior · Section</summary><label>Fondo exterior<select value={outerBackgroundValue} onChange={(event)=>changeOuterBackground(event.target.value)}>{outerBackgroundValue === "advanced" && <option value="advanced" disabled>Configuración avanzada actual</option>}<option value="inherit">Heredar de página</option><option value="transparent">Transparente</option><option value="page_background">Página</option><option value="surface">Superficie</option><option value="primary">Acento</option><option value="text">Texto</option></select></label></details>
    <details open><summary>Contenedor interno · Footer</summary>
      <label>Superficie<select value={content.surface} onChange={(event)=>updateContent({surface:event.target.value},"footer-surface")}><option value="transparent">Transparente</option><option value="solid">Sólida</option><option value="dark">Oscura</option><option value="light">Clara</option></select></label>
      <label>Texto<select value={content.text_color} onChange={(event)=>updateContent({text_color:event.target.value},"footer-text-color")}><option value="text">Texto de página</option><option value="muted">Secundario</option><option value="primary">Acento</option><option value="light">Claro</option><option value="dark">Oscuro</option></select></label>
      <label>Borde<select value={content.border} onChange={(event)=>updateContent({border:event.target.value},"footer-border")}>{["none","subtle","standard"].map((value)=><option key={value}>{value}</option>)}</select></label>
      <label>Radio<select value={appearance.radius || "none"} onChange={(event)=>onAppearanceChange(customizeAppearance(appearance,{radius:event.target.value}))}>{["none","sm","md","lg","xl"].map((value)=><option key={value}>{value}</option>)}</select></label>
    </details>
  </div>;
}

const RESPONSIVE_BLOCK_STYLE_KEYS = new Set(["align", "spacing", "text_variant", "text_size", "line_height", "letter_spacing", "max_width", "padding_top", "padding_bottom"]);

function applyViewportBlockStyle({ apply, blockId, preview, changes, group }) {
  const responsive = {};
  const base = {};
  for (const [key, value] of Object.entries(changes)) (preview === "desktop" || !RESPONSIVE_BLOCK_STYLE_KEYS.has(key) ? base : responsive)[key] = value;
  if (Object.keys(base).length) apply({ type:"update_block_style", block_id:blockId, changes:base }, `${group}-base`, 600);
  if (Object.keys(responsive).length) apply({ type:"update_block_responsive", block_id:blockId, breakpoint:preview, changes:responsive }, `${group}-${preview}`, 600);
}

function ContextualStyleToolbar({ selection, selected, apply, forms = [], pages = [], sections = [], preview = "desktop", onSaveForm, onMore, onDuplicate, onDelete, onMoveUp, onMoveDown, onSelectParent, onClose, position = "top", onTogglePosition }) {
  const [menuState, setMenuState] = useState({ selectionIdentity:"", id:null });
  const selectionIdentity = [selection?.level, selection?.sectionId, selection?.regionId, selection?.blockId, selection?.elementId].filter(Boolean).join(":");
  const openMenu = menuState.selectionIdentity === selectionIdentity ? menuState.id : null;
  const setOpenMenu = useCallback((id) => setMenuState({ selectionIdentity, id }), [selectionIdentity]);
  if (!selection || !selected) return null;

  const toolbarContext = getSelectionToolbarContext(selection, selected);
  if (selection.level === "element" && selected.block?.type === "site_footer") {
    const block = selected.block;
    const elementType = selection.elementType;
    const updateFooter = (changes, group = "footer-child") => apply({type:"update_block_content",block_id:block.id,changes},`${group}-${block.id}`,600);
    const common = (parentLabel = "Footer") => <><button type="button" className="landing-quick-icon" onClick={onSelectParent} title={`Seleccionar ${parentLabel}`} aria-label={`Seleccionar ${parentLabel}`}>↑</button><button type="button" className="landing-quick-close" onClick={onClose}>×</button></>;
    const baseClass = `landing-quick-toolbar landing-footer-child-toolbar landing-element-toolbar-v3 is-${position}`;
    if (elementType === FOOTER_ELEMENT_TYPES.brand) return <div className={baseClass} data-builder-editor-control data-builder-dismiss-layer={BUILDER_CONTEXT_LAYER} data-controls="brand parent close" role="toolbar" aria-label="Editar marca del Footer"><span className="landing-quick-kind">Marca</span><QuickPopover id="footer-child-brand" openMenu={openMenu} setOpenMenu={setOpenMenu} label="Marca del Footer" trigger={<span>Configurar</span>}><FooterBrandEditor content={block.content} onChange={updateFooter}/></QuickPopover>{common()}</div>;
    if ([FOOTER_ELEMENT_TYPES.navigation,FOOTER_ELEMENT_TYPES.linkGroup,FOOTER_ELEMENT_TYPES.linkItem].includes(elementType)) {
      const groupId = selected.footerGroup?.id || null;
      const linkId = elementType === FOOTER_ELEMENT_TYPES.linkItem ? selected.element?.id || null : null;
      const label = elementType === FOOTER_ELEMENT_TYPES.navigation ? "Links" : selected.element?.label || selected.element?.title || "Links";
      const parentLabel = elementType === FOOTER_ELEMENT_TYPES.linkItem ? "grupo de enlaces" : elementType === FOOTER_ELEMENT_TYPES.linkGroup ? "navegación" : "Footer";
      return <div className={baseClass} data-builder-editor-control data-builder-dismiss-layer={BUILDER_CONTEXT_LAYER} data-controls="links parent close" role="toolbar" aria-label={`Editar ${label}`}><span className="landing-quick-kind">{label}</span><QuickPopover id="footer-child-links" openMenu={openMenu} setOpenMenu={setOpenMenu} label="Enlaces del Footer" trigger={<span>Editar</span>}><FooterLinksEditor content={block.content} pages={pages} sections={sections} onChange={updateFooter} groupId={groupId} linkId={linkId}/></QuickPopover>{common(parentLabel)}</div>;
    }
    if (elementType === FOOTER_ELEMENT_TYPES.social) return <div className={baseClass} data-builder-editor-control data-builder-dismiss-layer={BUILDER_CONTEXT_LAYER} data-controls="social parent close" role="toolbar" aria-label="Editar redes del Footer"><span className="landing-quick-kind">Social</span><QuickPopover id="footer-child-social" openMenu={openMenu} setOpenMenu={setOpenMenu} label="Redes del Footer" trigger={<span>Configurar</span>}><FooterSocialEditor content={block.content} onChange={updateFooter}/></QuickPopover>{common()}</div>;
    if ([FOOTER_ELEMENT_TYPES.bottom,FOOTER_ELEMENT_TYPES.legalItem].includes(elementType)) {
      const legalId = elementType === FOOTER_ELEMENT_TYPES.legalItem ? selected.element?.id || null : null;
      const label = legalId ? selected.element?.label || "Legal" : "Bottom";
      return <div className={baseClass} data-builder-editor-control data-builder-dismiss-layer={BUILDER_CONTEXT_LAYER} data-controls="bottom parent close" role="toolbar" aria-label={`Editar ${label}`}><span className="landing-quick-kind">{label}</span><QuickPopover id="footer-child-bottom" openMenu={openMenu} setOpenMenu={setOpenMenu} label="Copyright y enlaces legales" trigger={<span>Editar</span>}><FooterBottomEditor content={block.content} pages={pages} sections={sections} onChange={updateFooter} legalId={legalId}/></QuickPopover>{common(legalId ? "Bottom" : "Footer")}</div>;
    }
    return null;
  }
  if (selection.level === "element" && selected.block?.type === "site_header") {
    const block = selected.block;
    const updateHeader = (changes, group = "header-child") => apply({ type:"update_block_content", block_id:block.id, changes }, `${group}-${block.id}`, 600);
    const common = (parentLabel = "Header") => <><button type="button" className="landing-quick-icon" onClick={onSelectParent} title={`Seleccionar ${parentLabel}`} aria-label={`Seleccionar ${parentLabel}`}>↑</button><button type="button" className="landing-quick-close" onClick={onClose}>×</button></>;
    if (selection.elementType === "brand") return <div className={`landing-quick-toolbar landing-header-child-toolbar landing-element-toolbar-v3 is-${position}`} data-builder-editor-control data-builder-dismiss-layer={BUILDER_CONTEXT_LAYER} data-controls={toolbarContext.controls.join(" ")} role="toolbar" aria-label="Editar marca del Header">
      <span className="landing-quick-kind">Marca</span>
      <QuickPopover id="header-child-brand" openMenu={openMenu} setOpenMenu={setOpenMenu} label="Marca del Header" trigger={<span>Configurar</span>}><HeaderBrandEditor content={block.content} onChange={updateHeader}/></QuickPopover>
      {common()}
    </div>;
    if (selection.elementType === "navigation") return <div className={`landing-quick-toolbar landing-header-child-toolbar landing-element-toolbar-v3 is-${position}`} data-builder-editor-control data-builder-dismiss-layer={BUILDER_CONTEXT_LAYER} data-controls={toolbarContext.controls.join(" ")} role="toolbar" aria-label="Editar navegación del Header">
      <span className="landing-quick-kind">Nav</span>
      <QuickPopover id="header-child-nav-style" openMenu={openMenu} setOpenMenu={setOpenMenu} label="Estilo global del Nav" trigger={<span>Estilo</span>}><HeaderNavStyleEditor content={block.content} onChange={updateHeader}/></QuickPopover>
      <QuickPopover id="header-child-nav" openMenu={openMenu} setOpenMenu={setOpenMenu} label="Enlaces del Header" trigger={<span>Enlaces</span>}><HeaderNavigationEditor content={block.content} pages={pages} sections={sections} currentSectionId={selected.section?.id} apply={apply} onChange={updateHeader}/></QuickPopover>
      {common()}
    </div>;
    if (selection.elementType === "nav_item") {
      const item = selected.element;
      const itemIndex = selected.elementIndex;
      if (!item || !Number.isInteger(itemIndex)) return null;
      return <div className={`landing-quick-toolbar landing-header-child-toolbar landing-element-toolbar-v3 is-${position}`} data-builder-editor-control data-builder-dismiss-layer={BUILDER_CONTEXT_LAYER} data-controls={toolbarContext.controls.join(" ")} role="toolbar" aria-label={`Editar enlace ${item.label}`}>
        <span className="landing-quick-kind">{item.label}</span>
        <QuickPopover id="header-nav-item-content" openMenu={openMenu} setOpenMenu={setOpenMenu} label="Contenido del enlace" trigger={<span>Contenido</span>}><HeaderNavItemEditor content={block.content} itemIndex={itemIndex} pages={pages} sections={sections} currentSectionId={selected.section?.id} apply={apply} onChange={updateHeader} allowRemove={false}/></QuickPopover>
        <QuickPopover id="header-nav-item-design" openMenu={openMenu} setOpenMenu={setOpenMenu} label="Diseño del enlace" trigger={<span>Diseño</span>}><HeaderNavStyleEditor content={block.content} item={item} itemIndex={itemIndex} onChange={updateHeader}/></QuickPopover>
        <QuickPopover id="header-nav-item-more" openMenu={openMenu} setOpenMenu={setOpenMenu} label="Acciones del enlace" trigger={<span>•••</span>}><div className="landing-option-list"><button type="button" onClick={()=>{
          const next = resetHeaderNavItemStyle(block.content, item.id, itemIndex);
          updateHeader({nav_items:next.nav_items}, "header-nav-item-style-reset");
        }}>Restablecer al estilo del Nav</button></div></QuickPopover>
        {common("Nav")}
      </div>;
    }
    if (selection.elementType === "button") {
      const updateCta = (changes) => updateHeader({cta:{...block.content.cta,...changes}}, "header-child-cta");
      return <div className={`landing-quick-toolbar landing-header-child-toolbar landing-element-toolbar-v3 is-${position}`} data-builder-editor-control data-builder-dismiss-layer={BUILDER_CONTEXT_LAYER} data-controls={toolbarContext.controls.join(" ")} role="toolbar" aria-label="Editar CTA del Header">
        <span className="landing-quick-kind">CTA</span>
        <QuickPopover id="header-child-cta-text" openMenu={openMenu} setOpenMenu={setOpenMenu} label="Texto del CTA" trigger={<span>Texto</span>}><ButtonTextEditor action={block.content.cta} onChange={updateCta}/></QuickPopover>
        <QuickPopover id="header-child-cta-action" openMenu={openMenu} setOpenMenu={setOpenMenu} label="Acción del CTA" trigger={<span>Acción</span>}><ButtonActionEditor action={block.content.cta} sections={sections} onChange={updateCta}/></QuickPopover>
        {common()}
      </div>;
    }
    return null;
  }
  if (selection.level === "element") {
    const block = selected.block;
    const action = selected.element;
    const actionIndex = selected.elementIndex;
    if (selection.elementType !== "button" || block?.type !== "action_group" || !action || !Number.isInteger(actionIndex)) return null;
    const actions = block.content.actions;
    const commitActions = (nextActions, group) => {
      if (nextActions === actions) return;
      apply({ type:"update_block_content", block_id:block.id, changes:{ actions:nextActions } }, `button-${block.id}-${actionIndex}-${group}`, 600);
    };
    const updateButton = (changes, group) => commitActions(updateButtonAtIndex(actions, actionIndex, changes), group);
    const duplicateButton = () => commitActions(duplicateButtonAtIndex(actions, actionIndex), "duplicate");
    const removeButton = () => {
      const nextActions = removeButtonAtIndex(actions, actionIndex);
      if (nextActions === actions) return;
      onSelectParent();
      commitActions(nextActions, "remove");
    };
    return <div className={`landing-quick-toolbar landing-button-element-toolbar landing-element-toolbar-v3 is-${position}`} data-builder-editor-control data-builder-dismiss-layer={BUILDER_CONTEXT_LAYER} data-controls={toolbarContext.controls.join(" ")} role="toolbar" aria-label="Editar botón">
      <span className="landing-quick-kind">Botón</span>
      <QuickPopover id="button-text" openMenu={openMenu} setOpenMenu={setOpenMenu} label="Texto del botón" trigger={<span>Texto</span>}><ButtonTextEditor action={action} onChange={(changes)=>updateButton(changes,"text")}/></QuickPopover>
      <QuickPopover id="button-action" openMenu={openMenu} setOpenMenu={setOpenMenu} label="Acción del botón" trigger={<span>Acción</span>}><ButtonActionEditor action={action} sections={sections} onChange={(changes)=>updateButton(changes,"action")}/></QuickPopover>
      <button type="button" onClick={onMore}>Diseño</button>
      <QuickPopover id="button-more" openMenu={openMenu} setOpenMenu={setOpenMenu} label="Más acciones" trigger={<span>•••</span>}><div className="landing-option-list"><button type="button" disabled={actions.length >= 2} onClick={duplicateButton}>Duplicar botón</button><button type="button" className="is-danger" disabled={actions.length <= 1} onClick={removeButton}>Eliminar botón</button></div></QuickPopover>
      <button type="button" className="landing-quick-icon" onClick={onSelectParent} title="Seleccionar grupo Actions" aria-label="Seleccionar grupo Actions">↑</button>
      <button type="button" className="landing-quick-close" onClick={onClose}>×</button>
    </div>;
  }

  const spacingOptions = [["none","0"],["xs","8"],["sm","16"],["md","24"],["lg","40"],["xl","64"]];
  const spacingIndex = (value) => {
    const found = spacingOptions.findIndex(([id]) => id === value);
    return found < 0 ? 0 : found;
  };

  if (["section", "group"].includes(selection.level)) {
    const section = selection.level === "group" ? selected.section : selected;
    const baseStyle = section.style || {};
    const responsiveStyle = preview === "desktop" ? {} : section.responsive?.[preview] || {};
    const style = { ...baseStyle, ...responsiveStyle };
    const allBlocks = section.regions?.flatMap((region) => region.blocks || []) || [];
    const allPricing = allBlocks.length > 1 && allBlocks.every((block) => block.type === "pricing_card");
    const allFeatures = allBlocks.length > 1 && allBlocks.every((block) => block.type === "feature_item");
    const allStats = allBlocks.length > 1 && allBlocks.every((block) => block.type === "stat");
    const groupLabel = allPricing ? "Pricing · Grupo" : allFeatures ? "Features · Grupo" : allStats ? "Stats · Grupo" : "Sección · Grupo";
    const updateSection = (changes) => {
      const responsive = {};
      const base = {};
      for (const [key, value] of Object.entries(changes)) {
        if (preview !== "desktop" && key === "align") responsive[key] = value;
        else base[key] = value;
      }
      if (Object.keys(base).length) apply({ type:"update_section_style", section_id:section.id, changes:base }, `quick-section-${section.id}-base`, 600);
      if (Object.keys(responsive).length) apply({ type:"update_section_responsive", section_id:section.id, breakpoint:preview, changes:responsive }, `quick-section-${section.id}-${preview}`, 600);
    };
    const updateSectionData = (changes) => apply({ type:"update_section", section_id:section.id, changes }, `quick-section-data-${section.id}`, 600);
    const top = style.padding_top || "none";
    const bottom = style.padding_bottom || "none";
    const width = baseStyle.content_width || "standard";

    return <div className={`landing-quick-toolbar landing-element-toolbar-v3 is-${position}`} data-builder-editor-control role="toolbar" aria-label="Editar grupo o sección" onClick={(event)=>event.stopPropagation()}>
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

  if (selection.level !== "block" || !selected?.block) return null;
  const block = selected.block;
  const declaredControls = getBlockToolbarControls(block);
  const style = { ...(block.style || {}), ...(preview === "desktop" ? {} : block.responsive?.[preview] || {}) };
  const updateStyle = (changes) => applyViewportBlockStyle({ apply, blockId:block.id, preview, changes, group:`quick-style-${block.id}` });
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
    const updateHeaderBaseStyle = (changes, group = "header-inner") => apply({ type:"update_block_style", block_id:block.id, changes }, `${group}-${block.id}`, 600);
    const updateHeaderSectionStyle = (changes, group = "header-outer") => apply({ type:"update_section_style", section_id:selected.section.id, changes }, `${group}-${selected.section.id}`, 600);
    return <div className={`landing-quick-toolbar landing-header-toolbar landing-element-toolbar-v3 is-${position}`} data-controls={declaredControls.join(" ")} data-builder-editor-control role="toolbar" aria-label="Editar Header" onClick={(event)=>event.stopPropagation()}>
      <span className="landing-quick-kind">Header</span>
      <QuickPopover id="header-layout" openMenu={openMenu} setOpenMenu={setOpenMenu} label="Layout del Header" trigger={<span>Layout</span>}><HeaderLayoutPanel content={block.content} blockStyle={block.style} onContentChange={updateContent} onBlockStyleChange={updateHeaderBaseStyle}/></QuickPopover>
      <QuickPopover id="header-brand" openMenu={openMenu} setOpenMenu={setOpenMenu} label="Marca" trigger={<span>Marca</span>}><HeaderBrandEditor content={block.content} onChange={(changes)=>updateContent(changes,"header-brand")}/></QuickPopover>
      <QuickPopover id="header-nav" openMenu={openMenu} setOpenMenu={setOpenMenu} label="Navegación" trigger={<span>Nav</span>}><div className="landing-header-nav-composer"><HeaderNavStyleEditor content={block.content} onChange={updateContent}/><HeaderNavigationEditor content={block.content} pages={pages} sections={sections} currentSectionId={selected.section?.id} apply={apply} onChange={updateContent}/></div></QuickPopover>
      <QuickPopover id="header-cta" openMenu={openMenu} setOpenMenu={setOpenMenu} label="CTA principal" trigger={<span>CTA</span>}><HeaderCtaEditor content={block.content} sections={sections} onChange={updateContent}/></QuickPopover>
      <QuickPopover id="header-appearance" openMenu={openMenu} setOpenMenu={setOpenMenu} label="Apariencia del Header" trigger={<><Palette size={15}/><span>Apariencia</span></>}><HeaderAppearanceEditor content={block.content} appearance={block.style?.appearance} sectionStyle={selected.section.style} onContentChange={updateContent} onAppearanceChange={(appearance)=>updateHeaderBaseStyle({appearance},"header-inner-appearance")} onSectionStyleChange={updateHeaderSectionStyle}/></QuickPopover>
      <QuickPopover id="header-more" openMenu={openMenu} setOpenMenu={setOpenMenu} label="Comportamiento y acciones" trigger={<span>•••</span>}><div className="landing-option-list"><label><input type="checkbox" checked={block.content.sticky} onChange={(event)=>updateContent({sticky:event.target.checked},"header-sticky")}/> Mantener Header sticky</label><button type="button" onClick={onMoveUp}>Mover arriba</button><button type="button" onClick={onMoveDown}>Mover abajo</button><button type="button" onClick={onDuplicate}>Duplicar Header</button><button type="button" className="is-danger" onClick={onDelete}>Eliminar Header</button></div></QuickPopover>
      <button type="button" className="landing-quick-icon" onClick={onSelectParent} title="Seleccionar grupo" aria-label="Seleccionar grupo">↑</button>
      <button type="button" className="landing-quick-close" onClick={onClose}>×</button>
    </div>;
  }

  if (block.type === "site_footer") {
    const updateFooterBaseStyle = (changes, group = "footer-inner") => apply({type:"update_block_style",block_id:block.id,changes},`${group}-${block.id}`,600);
    const updateFooterSectionStyle = (changes, group = "footer-outer") => apply({type:"update_section_style",section_id:selected.section.id,changes},`${group}-${selected.section.id}`,600);
    const updateFooterAppearance = (appearance) => {
      if (block.content.preset !== "custom") updateContent({preset:"custom"},"footer-appearance-custom");
      updateFooterBaseStyle({appearance},"footer-inner-appearance");
    };
    return <div className={`landing-quick-toolbar landing-footer-toolbar landing-element-toolbar-v3 is-${position}`} data-controls="layout brand links social appearance more parent close" data-builder-editor-control data-builder-dismiss-layer={BUILDER_CONTEXT_LAYER} role="toolbar" aria-label="Editar Footer" onClick={(event)=>event.stopPropagation()}>
      <span className="landing-quick-kind">Footer</span>
      <QuickPopover id="footer-layout" openMenu={openMenu} setOpenMenu={setOpenMenu} label="Layout del Footer" trigger={<span>Layout</span>}><FooterLayoutPanel content={block.content} blockStyle={block.style} onContentChange={updateContent} onBlockStyleChange={updateFooterBaseStyle}/></QuickPopover>
      <QuickPopover id="footer-brand" openMenu={openMenu} setOpenMenu={setOpenMenu} label="Marca" trigger={<span>Marca</span>}><FooterBrandEditor content={block.content} onChange={updateContent}/></QuickPopover>
      <QuickPopover id="footer-links" openMenu={openMenu} setOpenMenu={setOpenMenu} label="Enlaces" trigger={<span>Links</span>}><FooterLinksEditor content={block.content} pages={pages} sections={sections} onChange={updateContent}/></QuickPopover>
      <QuickPopover id="footer-social" openMenu={openMenu} setOpenMenu={setOpenMenu} label="Redes" trigger={<span>Social</span>}><FooterSocialEditor content={block.content} onChange={updateContent}/></QuickPopover>
      <QuickPopover id="footer-appearance" openMenu={openMenu} setOpenMenu={setOpenMenu} label="Apariencia del Footer" trigger={<><Palette size={15}/><span>Apariencia</span></>}><FooterAppearanceEditor content={block.content} appearance={block.style?.appearance} sectionStyle={selected.section.style} onContentChange={updateContent} onAppearanceChange={updateFooterAppearance} onSectionStyleChange={updateFooterSectionStyle}/></QuickPopover>
      <QuickPopover id="footer-more" openMenu={openMenu} setOpenMenu={setOpenMenu} label="Bottom y acciones" trigger={<span>•••</span>}><div className="landing-option-list"><FooterBottomEditor content={block.content} pages={pages} sections={sections} onChange={updateContent}/><p className="landing-toolbar-note">El Footer dedicado permanece siempre al final y no puede duplicarse.</p><button type="button" className="is-danger" onClick={onDelete}>Eliminar Footer</button></div></QuickPopover>
      <button type="button" className="landing-quick-icon" onClick={onSelectParent} title="Seleccionar grupo" aria-label="Seleccionar grupo">↑</button>
      <button type="button" className="landing-quick-close" onClick={onClose}>×</button>
    </div>;
  }

  if (block.type === "spacer") return <div className={`landing-quick-toolbar landing-element-toolbar-v3 is-${position}`} data-controls={declaredControls.join(" ")} data-builder-editor-control role="toolbar" aria-label="Editar Spacer" onClick={(event)=>event.stopPropagation()}><span className="landing-quick-kind">Spacer</span><QuickPopover id="spacer-size" openMenu={openMenu} setOpenMenu={setOpenMenu} label="Altura" trigger={<><Maximize2 size={15}/><span>{block.content.size.toUpperCase()}</span></>}><div className="landing-spacing-presets">{["xs","sm","md","lg","xl"].map((size)=><button key={size} type="button" className={block.content.size===size?"is-active":""} onClick={()=>updateContent({size},"spacer-size")}>{size.toUpperCase()}</button>)}</div></QuickPopover><button type="button" className="landing-quick-icon" onClick={onMoveUp} title="Mover arriba"><ArrowUp size={15}/></button><button type="button" className="landing-quick-icon" onClick={onMoveDown} title="Mover abajo"><ArrowDown size={15}/></button><button type="button" className="landing-quick-icon is-danger" onClick={onDelete} title="Eliminar"><Trash2 size={15}/></button><button type="button" className="landing-quick-close" onClick={onClose}>×</button></div>;

  if (block.type === "form_reference") {
    const connected = Boolean(block.content?.asset_id);
    const form = forms.find((item)=>item.id===block.content.asset_id);
    const saveStyle = (changes) => { if (!form?.draft) return; const next=structuredClone(form.draft); Object.assign(next.settings,changes); onSaveForm?.(form.id,next); };
    return <div className={`landing-quick-toolbar landing-element-toolbar-v3 is-${position}`} data-controls={declaredControls.join(" ")} data-builder-editor-control role="toolbar" aria-label="Editar formulario" onClick={(event)=>event.stopPropagation()}>
      <span className="landing-quick-kind">Formulario</span>
      {appearanceControls}
      <QuickPopover id="form-connect" openMenu={openMenu} setOpenMenu={setOpenMenu} label="Formulario" trigger={<span>{connected?"Formulario":"Conectar"}</span>}><div className="landing-option-list"><label>Conectado<select value={block.content.asset_id||""} onChange={(event)=>updateContent({asset_id:event.target.value||null},"form-connect")}><option value="">Sin asignar</option>{forms.map((item)=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label><button type="button" onClick={onMore}>Abrir Form Builder</button></div></QuickPopover>
      <QuickPopover id="form-fields" openMenu={openMenu} setOpenMenu={setOpenMenu} label="Campos" trigger={<span>Campos</span>}><FormQuickEditor form={form} onSave={onSaveForm}/></QuickPopover>
      <QuickPopover id="form-design" openMenu={openMenu} setOpenMenu={setOpenMenu} label="Diseño" trigger={<><Palette size={15}/><span>Diseño</span></>}><div className="landing-option-grid">{[["clean_light","Clean Light"],["dark","Dark"],["soft_card","Soft Card"],["minimal","Minimal"],["glass","Glass"]].map(([id,label])=><button key={id} type="button" className={form?.draft?.settings?.style_preset===id?"is-active":""} onClick={()=>saveStyle({style_preset:id,inherit_page_theme:false})}>{label}</button>)}</div>{form&&<><label>Radio<select value={form.draft.settings.radius} onChange={(event)=>saveStyle({radius:event.target.value})}>{["none","sm","md","lg"].map((id)=><option key={id}>{id}</option>)}</select></label><label>Sombra<select value={form.draft.settings.shadow} onChange={(event)=>saveStyle({shadow:event.target.value})}>{["none","soft","elevated"].map((id)=><option key={id}>{id}</option>)}</select></label><label>Padding<select value={form.draft.settings.padding} onChange={(event)=>saveStyle({padding:event.target.value})}>{["sm","md","lg"].map((id)=><option key={id}>{id}</option>)}</select></label><label>Columnas<select value={form.draft.settings.layout||"stack"} onChange={(event)=>saveStyle({layout:event.target.value})}><option value="stack">1 columna</option><option value="two_column">2 columnas</option></select></label><label>Alineación botón<select value={form.draft.settings.button_alignment||"start"} onChange={(event)=>saveStyle({button_alignment:event.target.value})}><option value="start">Inicio</option><option value="center">Centro</option><option value="end">Final</option></select></label><label><input type="checkbox" checked={(form.draft.settings.button_width||"auto")==="full"} onChange={(event)=>saveStyle({button_width:event.target.checked?"full":"auto"})}/> Botón ancho completo</label></>}</QuickPopover>
      {layoutControls}
      {hasGroup && <button type="button" className="landing-group-switch" onClick={onSelectParent}>Grupo</button>}
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
    return <div className={`landing-quick-toolbar landing-actions-block-toolbar landing-element-toolbar-v3 is-${position}`} data-controls={declaredControls.join(" ")} data-builder-editor-control data-builder-dismiss-layer={BUILDER_CONTEXT_LAYER} role="toolbar" aria-label="Editar grupo Actions" onClick={(event)=>event.stopPropagation()}>
      <span className="landing-quick-kind">Actions</span>
      {layoutControls}
      <span className="landing-toolbar-note">{actions.length} {actions.length === 1 ? "botón" : "botones"}</span>
      {hasGroup && <button type="button" className="landing-group-switch" onClick={onSelectParent}>Grupo</button>}
      <QuickPopover id="more" openMenu={openMenu} setOpenMenu={setOpenMenu} trigger={<span>•••</span>}><div className="landing-option-list"><button type="button" onClick={onMore}>Propiedades del grupo</button><button type="button" onClick={onDuplicate}>Duplicar bloque</button><button type="button" className="is-danger" onClick={onDelete}>Eliminar bloque</button></div></QuickPopover>
      <button type="button" className="landing-quick-icon is-danger" onClick={onDelete} title="Eliminar botones" aria-label="Eliminar botones"><Trash2 size={15}/></button>
      <button type="button" className="landing-quick-move" onClick={onTogglePosition} title="Mover barra">{position === "top" ? "↓" : "↑"}</button><button type="button" className="landing-quick-close" onClick={onClose}>×</button>
    </div>;
  }

  const blockLabel = block.type === "image" ? "Imagen" : block.type === "testimonial" ? "Testimonio" : block.type === "video" ? "Video" : block.type === "stat" ? "Métrica" : block.type === "pricing_card" ? "Plan" : block.type === "feature_item" ? "Beneficio" : block.type === "heading" ? "Título" : block.type === "text" ? "Texto" : block.type.replace("_"," ");

  const variantControls = block.type === "divider" ? <QuickPopover id="variant" openMenu={openMenu} setOpenMenu={setOpenMenu} label="Diseño del separador" trigger={<><Palette size={15}/><span>Diseño</span></>}><div className="landing-option-grid">{["solid","dashed","subtle"].map((id)=><button key={id} type="button" className={block.content.style===id?"is-active":""} onClick={()=>updateContent({style:id},"divider-variant")}>{id}</button>)}</div></QuickPopover> : block.type === "social_links" ? <QuickPopover id="variant" openMenu={openMenu} setOpenMenu={setOpenMenu} label="Diseño de Socials" trigger={<><Palette size={15}/><span>Diseño</span></>}><div className="landing-option-grid">{["minimal","circle","square","filled","outline"].map((id)=><button key={id} type="button" className={block.content.variant===id?"is-active":""} onClick={()=>updateContent({variant:id},"social-variant")}>{id}</button>)}</div></QuickPopover> : null;

  return <div className={`landing-quick-toolbar landing-element-toolbar-v3 is-${position}`} data-controls={declaredControls.join(" ")} data-builder-editor-control role="toolbar" aria-label="Editar elemento" onClick={(event)=>event.stopPropagation()}>
    <span className="landing-quick-kind">{blockLabel}</span>
    {appearanceControls}
    {layoutControls}
    {typographyControls}
    {sizeControls}
    {pageTypographyControl}
    {variantControls}
    {hasGroup && <button type="button" className="landing-group-switch" onClick={onSelectParent}>Grupo</button>}
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

function ButtonDesignInspector({ selected, buttonDefaults = {}, apply, onClose }) {
  const block = selected?.block;
  const action = selected?.element;
  const actionIndex = selected?.elementIndex;
  if (block?.type !== "action_group" || !action || !Number.isInteger(actionIndex)) return null;
  const actions = block.content.actions || [];
  const update = (changes, group) => {
    const nextActions = updateButtonAtIndex(actions, actionIndex, changes);
    if (nextActions === actions) return;
    apply({ type:"update_block_content", block_id:block.id, changes:{ actions:nextActions } }, `button-design-${block.id}-${actionIndex}-${group}`, 600);
  };
  const reset = () => {
    const nextActions = resetButtonDesign(actions, actionIndex);
    if (nextActions === actions) return;
    apply({ type:"update_block_content", block_id:block.id, changes:{ actions:nextActions } }, `button-design-${block.id}-${actionIndex}-reset`, 600);
  };
  const inherited = (field) => buttonDefaults[field] || "default";
  const option = (value, label = value) => <option key={value} value={value}>{label}</option>;
  const inheritedOption = (field) => <option value="">Page Style · {inherited(field)}</option>;
  return <aside className="landing-inspector landing-button-inspector" data-builder-editor-control data-builder-dismiss-layer={BUILDER_INSPECTOR_LAYER} aria-label="Diseño del botón seleccionado">
    <header><div><span>BUTTON</span><strong>{action.label}</strong></div><button type="button" onClick={onClose} aria-label="Cerrar propiedades">×</button></header>
    <p className="landing-button-inspector-note">Estos controles modifican únicamente el botón seleccionado. La posición y el espacio del conjunto pertenecen a Actions.</p>
    <details className="landing-inspector-accordion" open><summary><span>Estilo</span><span aria-hidden="true">⌄</span></summary><div className="landing-inspector-group">
      <label>Preset<select value={action.variant || ""} onChange={(event)=>update({variant:event.target.value || undefined},"variant")}>{inheritedOption("variant")}{BUTTON_VARIANTS.map((value)=>option(value,({primary:"Primary",secondary:"Secondary",outline:"Outline",ghost:"Ghost",gradient:"Gradient",glass:"Glass",soft:"Soft",elevated:"Elevated"})[value]))}</select></label>
    </div></details>
    <details className="landing-inspector-accordion" open><summary><span>Relleno</span><span aria-hidden="true">⌄</span></summary><div className="landing-inspector-group">
      <label>Fondo<select value={action.background || ""} onChange={(event)=>update({background:event.target.value || undefined},"background")}>{inheritedOption("background")}{BUTTON_BACKGROUND_TOKENS.map((value)=>option(value,value.replaceAll("_"," ")))}</select></label>
    </div></details>
    <details className="landing-inspector-accordion" open><summary><span>Texto</span><span aria-hidden="true">⌄</span></summary><div className="landing-inspector-group">
      <label>Color<select value={action.text_color || ""} onChange={(event)=>update({text_color:event.target.value || undefined},"text-color")}>{inheritedOption("text_color")}{BUTTON_COLOR_TOKENS.map((value)=>option(value,value.replaceAll("_"," ")))}</select></label>
      <p className="landing-button-inspector-note">La tipografía se hereda de la página; el documento actual no admite tipografía individual por botón.</p>
    </div></details>
    <details className="landing-inspector-accordion" open><summary><span>Tamaño</span><span aria-hidden="true">⌄</span></summary><div className="landing-inspector-group">
      <label>Escala<select value={action.size || ""} onChange={(event)=>update({size:event.target.value || undefined},"size")}>{inheritedOption("size")}{BUTTON_SIZES.map((value)=>option(value,({sm:"Small",md:"Medium",lg:"Large"})[value]))}</select></label>
      <label>Ancho<select value={action.width || ""} onChange={(event)=>update({width:event.target.value || undefined},"width")}>{inheritedOption("width")}{BUTTON_WIDTHS.map((value)=>option(value,value === "full" ? "Full width" : "Auto"))}</select></label>
      <p className="landing-button-inspector-note">Tamaño y ancho son globales para el botón; todavía no existe un override responsive individual seguro.</p>
    </div></details>
    <details className="landing-inspector-accordion"><summary><span>Forma</span><span aria-hidden="true">⌄</span></summary><div className="landing-inspector-group">
      <label>Borde<select value={action.border || ""} onChange={(event)=>update({border:event.target.value || undefined},"border")}>{inheritedOption("border")}{BUTTON_BORDERS.map((value)=>option(value))}</select></label>
      <label>Color de borde<select value={action.border_color || ""} onChange={(event)=>update({border_color:event.target.value || undefined},"border-color")}>{inheritedOption("border_color")}{BUTTON_BORDER_COLOR_TOKENS.map((value)=>option(value,value.replaceAll("_"," ")))}</select></label>
      <label>Radio<select value={action.radius || ""} onChange={(event)=>update({radius:event.target.value || undefined},"radius")}>{inheritedOption("radius")}{BUTTON_RADII.map((value)=>option(value))}</select></label>
    </div></details>
    <details className="landing-inspector-accordion"><summary><span>Efectos</span><span aria-hidden="true">⌄</span></summary><div className="landing-inspector-group">
      <label>Sombra<select value={action.shadow || ""} onChange={(event)=>update({shadow:event.target.value || undefined},"shadow")}>{inheritedOption("shadow")}{BUTTON_SHADOWS.map((value)=>option(value))}</select></label>
    </div></details>
    <details className="landing-inspector-accordion"><summary><span>Estados</span><span aria-hidden="true">⌄</span></summary><div className="landing-inspector-group landing-button-state-summary">
      <strong>Normal</strong><span>Editable mediante los controles anteriores.</span>
      <strong>Hover · Pressed · Focus</strong><span>Derivados de forma accesible por el preset. El schema actual no persiste overrides separados.</span>
    </div></details>
    <div className="landing-inspector-actions"><button type="button" onClick={reset}>Reset to Page Style</button></div>
  </aside>;
}

function Inspector({ selection, selected, forms, apply, preview, buttonDefaults, onDelete, onDuplicate, onMove, onClose, onEditForm }) {
  if (!selected) return null;
  if (selection.level === "element") return selected.block?.type !== "site_header" && selection.elementType === "button"
    ? <ButtonDesignInspector selected={selected} buttonDefaults={buttonDefaults} apply={apply} onClose={onClose}/>
    : null;
  const block = selection.level === "block" ? selected.block : null; const section = selection.level === "section" ? selected : selected.section; const content = block?.content;
  if (block?.type === "site_header") return <aside className="landing-inspector" data-builder-editor-control data-builder-dismiss-layer={BUILDER_INSPECTOR_LAYER}>
    <header><div><span>HEADER</span><strong>Edición contextual</strong></div><button onClick={onClose} aria-label="Cerrar propiedades">×</button></header>
    <div className="landing-inspector-group landing-header-inspector-handoff"><p>Layout, Marca, Nav, CTA y Apariencia están centralizados en la barra contextual del Header.</p><button type="button" onClick={onClose}>Volver a controles del Header</button></div>
  </aside>;
  if (block?.type === "site_footer") return <aside className="landing-inspector" data-builder-editor-control data-builder-dismiss-layer={BUILDER_INSPECTOR_LAYER}>
    <header><div><span>FOOTER</span><strong>Edición contextual</strong></div><button onClick={onClose} aria-label="Cerrar propiedades">×</button></header>
    <div className="landing-inspector-group landing-header-inspector-handoff"><p>Layout, Marca, Links, Social, Bottom y Apariencia están centralizados en la barra contextual del Footer.</p><button type="button" onClick={onClose}>Volver a controles del Footer</button></div>
  </aside>;
  const updateContent = (changes) => apply({ type: "update_block_content", block_id: block.id, changes }, `content-${block.id}`, 600);
  const responsiveBreakpoint = preview === "desktop" ? null : preview;
  const effectiveStyle = block ? { ...(block.style || {}), ...(responsiveBreakpoint ? block.responsive?.[responsiveBreakpoint] || {} : {}) } : {};
  const updateStyle = (changes) => applyViewportBlockStyle({ apply, blockId:block.id, preview, changes, group:`style-${block.id}` });
  const responsive = responsiveBreakpoint ? (block || section).responsive?.[responsiveBreakpoint] || {} : null;
  const updateResponsive = (changes) => apply({ type: block ? "update_block_responsive" : "update_section_responsive", [block ? "block_id" : "section_id"]: (block || section).id, breakpoint: responsiveBreakpoint, changes }, `responsive-${(block || section).id}-${responsiveBreakpoint}`, 600);
  const resetResponsive = () => apply({ type: block ? "reset_block_responsive" : "reset_section_responsive", [block ? "block_id" : "section_id"]: (block || section).id, breakpoint: responsiveBreakpoint }, `responsive-reset-${(block || section).id}`, 600);
  function changeLayout(preset) {
    const spans = { stack: [12], "columns-2": [6, 6], "columns-5-7": [5, 7], "columns-7-5": [7, 5], "columns-3": [4, 4, 4], "columns-4": [3, 3, 3, 3] }[preset] || [12];
    const blocks = section.regions.flatMap((region) => region.blocks);
    const regions = spans.map((span, index) => ({ id: section.regions[index]?.id || createBuilderId(), span, blocks: index === 0 ? blocks : [] }));
    apply({ type: "update_section", section_id: section.id, changes: { layout: spans.length === 1 ? "stack" : "columns", regions } }, "section-layout");
  }
  return <aside className="landing-inspector" data-builder-editor-control data-builder-dismiss-layer={BUILDER_INSPECTOR_LAYER}><header><div><span>PROPIEDADES</span><strong>{block ? block.type.replace("_", " ") : "Section"}</strong></div><button onClick={onClose} aria-label="Cerrar propiedades">×</button></header>
    {block && <details className="landing-inspector-accordion" open><summary><span>Content</span><span aria-hidden="true">⌄</span></summary>
    {block && <div className="landing-inspector-group"><h3>Content</h3>{block.type === "heading" && <><label>Texto<textarea autoFocus placeholder="Título" value={content.text} onChange={(event) => updateContent({ text: event.target.value })}/></label><label>Nivel<select value={content.level} onChange={(event) => updateContent({ level: Number(event.target.value) })}>{[1,2,3,4,5,6].map((level) => <option key={level} value={level}>H{level}</option>)}</select></label></>}{block.type === "text" && <label>Contenido<textarea autoFocus placeholder="Escribe el contenido" value={content.text} onChange={(event) => updateContent({ text: event.target.value })}/></label>}{block.type === "image" && <><label>Origen<select value={content.source.kind} onChange={(event) => updateContent({ source: event.target.value === "external" ? { kind: "external", url: "https://example.com/image.jpg" } : { kind: "placeholder" } })}><option value="placeholder">Placeholder</option><option value="external">HTTPS externo</option></select></label>{content.source.kind === "external" && <label>URL<input value={content.source.url} onChange={(event) => updateContent({ source: { kind: "external", url: event.target.value } })}/></label>}<label><input type="checkbox" checked={content.decorative} onChange={(event) => updateContent({ decorative: event.target.checked })}/> Decorativa</label>{!content.decorative && <label>Texto alternativo<input value={content.alt} onChange={(event) => updateContent({ alt: event.target.value })}/></label>}</>}{block.type === "action_group" && <div className="landing-actions-block-summary"><strong>{content.actions.length} {content.actions.length === 1 ? "botón" : "botones"}</strong><p>Selecciona un botón en el canvas para editar su texto, acción y diseño. Aquí se configura únicamente el layout de Actions.</p></div>} {block.type === "form_reference" && <div className="landing-form-binding-controls">
  <div className="landing-form-binding-head"><span>FORMULARIO CONECTADO</span><strong>{forms.find((form) => form.id === content.asset_id)?.name || "Sin formulario"}</strong></div>
  <label>Escoger formulario<select value={content.asset_id || ""} onChange={(event) => updateContent({ asset_id: event.target.value || null })}><option value="">Sin asignar</option>{forms.map((form) => <option key={form.id} value={form.id}>{form.name}</option>)}</select></label>
  {content.asset_id && <button type="button" className="landing-edit-connected-form" onClick={() => onEditForm?.(content.asset_id)}>Editar formulario en Form Builder ↗</button>}
  {!forms.length && <p className="landing-inspector-empty">No hay formularios creados todavía. Crea uno desde Builder y aparecerá aquí.</p>}
  <p className="landing-form-binding-help">Este bloque no construye los campos. Aquí conectas el formulario reutilizable que diseñaste en Form Builder.</p>
  <label>Etiqueta accesible<input value={content.label} onChange={(event) => updateContent({ label: event.target.value })}/></label>
</div>}<ProfessionalContentControls block={block} updateContent={updateContent}/></div>}
    </details>}
    {block && <details className="landing-inspector-accordion" open><summary><span>Appearance</span><span aria-hidden="true">⌄</span></summary><BlockStyleControls block={block} style={effectiveStyle} updateStyle={updateStyle} apply={apply}/></details>}
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
    case "site_header": return null;
    case "site_footer": return null;
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

function BlockStyleControls({ block, style = block.style || {}, updateStyle, apply }) {
  const typography = block.type === "heading" || block.type === "text";
  const textBearing = ["heading","text","feature_item","stat","testimonial","pricing_card","faq_item"].includes(block.type);
  return <div className="landing-inspector-group">
    <h3>Diseño · Desktop/Base</h3>
    <label>Posición del bloque<select value={style.align || "start"} onChange={(event) => updateStyle({ align: event.target.value })}><option value="start">Inicio</option><option value="center">Centro</option><option value="end">Final</option></select></label>
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

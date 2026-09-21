import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { assertLandingDocument, safeVideoEmbedUrl } from "../document/landingDocument.js";
import { appearanceData } from "../document/visualAppearance.js";
import { getFloatingViewport, intersectFloatingViewport, placeFloatingPanel } from "../editor/floatingPanelPosition.js";
import { registerBuilderDismissableLayer } from "../editor/builderDismissableLayer.js";
import {
  getEffectiveHeaderNavItemStyle,
  getHeaderElementId,
  getHeaderNavItemElementId,
  getHeaderNavStyleAttributes,
  HEADER_NAV_STYLE_DEFAULTS,
} from "../editor/landingHeaderEditing.js";
import {
  FOOTER_ELEMENT_TYPES,
  getFooterElementId,
  getFooterGroupElementId,
  getFooterLegalElementId,
  getFooterLinkElementId,
} from "../editor/landingFooterEditing.js";
import { getActionElementId } from "../editor/landingEditorSelection.js";
import { hasSectionRelativeBlockLayout } from "./sectionRelativeBlockLayout.js";
import "./LandingRendererV3.css";
import "./LandingRendererV4.css";
import "./LandingVisualSystemV5.css";

function SocialIcon({ provider }) {
  if (provider === "facebook") return <span aria-hidden="true">f</span>;
  if (provider === "linkedin") return <span aria-hidden="true">in</span>;
  if (provider === "x") return <span aria-hidden="true">X</span>;
  if (provider === "instagram") return <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none"/></svg>;
  if (provider === "youtube") return <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="2.5" y="5" width="19" height="14" rx="4"/><path d="m10 9 5 3-5 3Z" fill="currentColor" stroke="none"/></svg>;
  if (provider === "tiktok") return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 4v11a4 4 0 1 1-3-3.87M14 4c.4 2.5 2 4 5 4"/></svg>;
  if (provider === "email") return <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m4 7 8 6 8-6"/></svg>;
  return <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18"/></svg>;
}

function SocialLinks({ content, editorMode = false, renderField = null, block = null }) {
  return <nav className="landing-social" aria-label="Redes sociales" data-variant={content.variant || "outline"} data-size={content.size || "md"} data-gap={content.gap || "md"} data-align={content.align || "start"} data-color={content.color || "text"}>{content.links.filter((link) => link.enabled !== false).map((link, index) => <a key={`${link.provider}-${link.url}-${index}`} href={link.url} onClick={editorLink(editorMode)} rel="noopener noreferrer" aria-label={link.label} data-provider={link.provider}><span className="landing-social-icon"><SocialIcon provider={link.provider}/></span><span className="landing-social-label">{renderField && block ? field(renderField, block, "links.label", link.label, { index, singleLine: true }) : link.label}</span></a>)}</nav>;
}

function resolveNavigationHref(item, resolvePageLink) {
  if (!item.target) return item.href;
  if (item.target.type === "section") return `#${item.target.anchor}`;
  if (item.target.type === "page") return resolvePageLink?.(item.target.asset_id) || "#";
  if (item.target.type === "email") return `mailto:${item.target.email}`;
  if (item.target.type === "phone") return `tel:${item.target.phone}`;
  return item.target.url;
}

const CLASSIC_HEADER_PRESETS = new Set(["classic", "logo_nav_cta"]);
const PROFESSIONAL_HEADER_PRESETS = new Set(["boxed", "floating_pill", "minimal", "centered", "split", "glass", "custom"]);

function getHeaderLayoutContract(block) {
  const preset = block?.content?.preset;
  if (CLASSIC_HEADER_PRESETS.has(preset)) return "classic-row";
  if (preset === "custom" && (block?.style?.max_width || "none") === "none") return "classic-row";
  return PROFESSIONAL_HEADER_PRESETS.has(preset) ? "desktop-row" : undefined;
}

function SiteHeader({ block, sectionId, regionId, selection, appearance, editorMode, resolvePageLink }) {
  const [open, setOpen] = useState(false);
  const { content } = block;
  const links = content.nav_items.map((item, index) => ({ item, index })).filter(({ item }) => item.enabled);
  const selectionAttributes = (elementType, explicitElementId) => {
    if (!editorMode) return {};
    const elementId = explicitElementId || getHeaderElementId(block.id, elementType);
    if (!elementId) return {};
    return {
      "data-builder-selectable": true,
      "data-selection-level": "element",
      "data-section-id": sectionId,
      "data-region-id": regionId,
      "data-block-id": block.id,
      "data-element-id": elementId,
      "data-element-type": elementType,
      "data-selected": (selection?.level === "element" && selection.elementId === elementId) || undefined,
    };
  };
  const globalNavStyle = { ...HEADER_NAV_STYLE_DEFAULTS, ...(content.nav_style || {}) };
  return <header className="landing-site-header landing-header-inner" data-header-container="inner" data-header-layout={getHeaderLayoutContract(block)} {...appearanceData(appearance)} data-preset={content.preset} data-surface={content.surface} data-text-color={content.text_color} data-shadow={content.shadow} data-border={content.border} data-spacing={content.spacing} data-alignment={content.alignment} data-sticky={content.sticky || undefined}>
    <a className="landing-site-brand" href="#top" onClick={editorLink(editorMode)} {...selectionAttributes("brand")}>{content.logo_url && <img src={content.logo_url} alt="" data-size={content.logo_size}/>}<strong>{content.brand_name}</strong></a>
    <button type="button" className="landing-header-toggle" data-open={open || undefined} data-builder-editor-control={editorMode || undefined} aria-expanded={open} aria-label={open ? "Cerrar navegación" : "Abrir navegación"} onClick={() => setOpen((value) => !value)}><span/><span/><span/></button>
    <div className="landing-header-menu" data-open={open || undefined}><nav className="landing-header-nav" aria-label="Navegación principal" {...getHeaderNavStyleAttributes(globalNavStyle)} {...selectionAttributes("navigation")}>{links.map(({ item, index }) => {
      const elementId = getHeaderNavItemElementId(item, block.id, index);
      return <a className="landing-header-nav-item" key={elementId} href={resolveNavigationHref(item, resolvePageLink)} {...getHeaderNavStyleAttributes(getEffectiveHeaderNavItemStyle(content, item))} {...selectionAttributes("nav_item", elementId)} onClick={(event) => { editorLink(editorMode)?.(event); setOpen(false); }}>{item.label}</a>;
    })}</nav>{content.cta.enabled && <a className="landing-header-cta" href={content.cta.href} onClick={(event) => { editorLink(editorMode)?.(event); setOpen(false); }} {...selectionAttributes("button")}>{content.cta.label}</a>}</div>
  </header>;
}

function SiteFooter({ block, selection, editorMode, resolvePageLink }) {
  const { content } = block;
  const selectionAttributes = (elementType, elementId) => {
    if (!editorMode || !elementId) return {};
    return {
      "data-builder-selectable": true,
      "data-selection-level": "element",
      "data-element-id": elementId,
      "data-element-type": elementType,
      "data-selected": selection?.level === "element" && selection.elementId === elementId || undefined,
    };
  };
  const fixedElement = (elementType) => selectionAttributes(elementType, getFooterElementId(block.id, elementType));
  return <footer className="landing-site-footer" data-footer-container="inner" data-footer-content-width={block.style?.max_width || "none"} data-preset={content.preset} data-surface={content.surface} data-text-color={content.text_color} data-border={content.border} data-footer-spacing={content.spacing} data-footer-gap={content.gap} data-footer-alignment={content.alignment}>
    <div className="landing-footer-main">
      <div className="landing-footer-brand" {...fixedElement(FOOTER_ELEMENT_TYPES.brand)}>
        {content.brand.logo_url && <img className="landing-footer-logo" src={content.brand.logo_url} alt="" data-size={content.brand.logo_size}/>}
        {content.brand.name && <strong>{content.brand.name}</strong>}
        {content.brand.tagline && <p>{content.brand.tagline}</p>}
      </div>
      <div className="landing-footer-navigation" {...fixedElement(FOOTER_ELEMENT_TYPES.navigation)}>
        {content.link_groups.map((group, groupIndex) => {
          const groupElementId = getFooterGroupElementId(group, block.id, groupIndex);
          return <nav className="landing-footer-link-group" key={groupElementId} aria-label={group.title || "Enlaces del footer"} {...selectionAttributes(FOOTER_ELEMENT_TYPES.linkGroup, groupElementId)}>
            {group.title && <strong>{group.title}</strong>}
            <div>{group.links.filter((link) => link.enabled).map((link, linkIndex) => {
              const elementId = getFooterLinkElementId(link, group, block.id, groupIndex, linkIndex);
              return <a key={elementId} href={resolveNavigationHref(link, resolvePageLink)} onClick={editorLink(editorMode)} {...selectionAttributes(FOOTER_ELEMENT_TYPES.linkItem, elementId)}>{link.label}</a>;
            })}</div>
          </nav>;
        })}
      </div>
      {content.social_enabled && <div className="landing-footer-social" {...fixedElement(FOOTER_ELEMENT_TYPES.social)}><SocialLinks content={content.social} editorMode={editorMode}/></div>}
    </div>
    <div className="landing-footer-bottom" {...fixedElement(FOOTER_ELEMENT_TYPES.bottom)}>
      <p>{content.copyright}</p>
      <nav className="landing-footer-legal" aria-label="Enlaces legales">{content.legal_links.filter((link) => link.enabled).map((link, index) => {
        const elementId = getFooterLegalElementId(link, block.id, index);
        return <a key={elementId} href={resolveNavigationHref(link, resolvePageLink)} onClick={editorLink(editorMode)} {...selectionAttributes(FOOTER_ELEMENT_TYPES.legalItem, elementId)}>{link.label}</a>;
      })}</nav>
    </div>
  </footer>;
}

function ImageBlock({ block }) {
  const [failedUrl, setFailedUrl] = useState(null);
  const source = block.content.source;
  const failed = source.kind === "external" && failedUrl === source.url;
  if (source.kind !== "external" || failed) return <div role="img" aria-label={block.content.decorative ? undefined : block.content.alt} data-landing-placeholder="image"><span>{failed ? "No se pudo cargar la imagen" : "Imagen"}</span></div>;
  return <img src={source.url} alt={block.content.decorative ? "" : block.content.alt} data-fit={block.content.fit || "cover"} data-aspect={block.content.aspect_ratio || "auto"} data-radius={block.content.radius || "md"} data-focal={block.content.focal_position || "center"} onError={() => setFailedUrl(source.url)}/>;
}

const field = (renderField, block, name, value, options = {}) => renderField ? renderField({ block, field: name, value: value ?? "", ...options }) : value;
const editorLink = (editorMode) => editorMode ? (event) => event.preventDefault() : undefined;
const EDITOR_BLOCK_LABELS = {
  heading: "Título", text: "Texto", image: "Imagen", action_group: "Botones",
  form_reference: "Formulario", logo: "Logo", feature_item: "Beneficio",
  stat: "Métrica", testimonial: "Testimonio", video: "Video",
  pricing_card: "Precio", faq_item: "FAQ", divider: "Separador",
  spacer: "Espacio", social_links: "Social", site_header: "Header", site_footer: "Footer",
};

function EditorMenu({ label, layerId, children }) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef(null);
  const panelRef = useRef(null);
  const [position, setPosition] = useState({ x: 12, y: 12 });
  useEffect(() => {
    if (!open || typeof document === "undefined") return undefined;
    return registerBuilderDismissableLayer({ target:document, layerId, onDismiss:()=>setOpen(false) });
  }, [layerId, open]);
  useLayoutEffect(() => {
    if (!open || !triggerRef.current || !panelRef.current) return undefined;
    const place = () => {
      const viewport = getFloatingViewport(window.visualViewport, window.innerWidth, window.innerHeight);
      const editor = triggerRef.current?.closest(".landing-editor")?.getBoundingClientRect();
      const bounds = intersectFloatingViewport(viewport, editor);
      setPosition(placeFloatingPanel(triggerRef.current.getBoundingClientRect(), panelRef.current.getBoundingClientRect(), bounds));
    };
    place();
    const visualViewport = window.visualViewport;
    window.addEventListener("resize", place);
    visualViewport?.addEventListener("resize", place);
    visualViewport?.addEventListener("scroll", place);
    return () => {
      window.removeEventListener("resize", place);
      visualViewport?.removeEventListener("resize", place);
      visualViewport?.removeEventListener("scroll", place);
    };
  }, [open]);
  return <div className="landing-editor-menu" data-builder-editor-control data-builder-dismiss-layer={layerId} onClick={(event) => event.stopPropagation()}>
    <button ref={triggerRef} type="button" className="landing-editor-menu-trigger" aria-label={label} title={label} aria-expanded={open} onClick={() => setOpen((value) => !value)}>•••</button>
    {open && typeof document !== "undefined" && createPortal(<div ref={panelRef} className="landing-floating-panel landing-editor-menu-floating" data-builder-editor-control data-builder-dismiss-layer={layerId} style={{ left:position.x, top:position.y }} role="menu" onClick={(event) => event.stopPropagation()}>{children}</div>, document.body)}
  </div>;
}

function BlockChrome({ block, selected, editorActions }) {
  return <div className={`landing-block-chrome ${selected ? "is-selected" : ""}`} data-builder-editor-control>
    <span>{EDITOR_BLOCK_LABELS[block.type] || block.type}</span>
    <button type="button" draggable data-drag-kind="block" data-drag-id={block.id} aria-label={`Arrastrar ${EDITOR_BLOCK_LABELS[block.type] || block.type}`} data-drag-handle title="Arrastrar bloque">⋮⋮</button>
    {!selected && <EditorMenu label={`Opciones de ${EDITOR_BLOCK_LABELS[block.type] || "bloque"}`} layerId={`landing-editor-menu-${block.id}`}>
      <strong>{EDITOR_BLOCK_LABELS[block.type] || "Bloque"}</strong>
      <button type="button" onClick={() => editorActions?.openPanel?.({ kind: "block", id: block.id })}>Opciones avanzadas</button>
      <button type="button" onClick={() => editorActions?.duplicate?.({ kind: "block", id: block.id })}>Duplicar bloque</button>
      <button type="button" className="is-danger" onClick={() => editorActions?.remove?.({ kind: "block", id: block.id })}>Eliminar bloque</button>
    </EditorMenu>}
  </div>;
}

function BlockContent({ block, sectionId, regionId, selection, resolveForm, resolvePageLink, buttonDefaults = {}, renderField = null, editorMode = false }) {
  switch (block.type) {
    case "site_header": return <SiteHeader block={block} sectionId={sectionId} regionId={regionId} selection={selection} appearance={block.style?.appearance} editorMode={editorMode} resolvePageLink={resolvePageLink}/>;
    case "site_footer": return <SiteFooter block={block} selection={selection} editorMode={editorMode} resolvePageLink={resolvePageLink}/>;
    case "heading": { const Tag = `h${block.content.level}`; return <Tag>{field(renderField, block, "text", block.content.text, { singleLine: true })}</Tag>; }
    case "text": return <p>{field(renderField, block, "text", block.content.text)}</p>;
    case "image": return <ImageBlock block={block}/>;
    case "action_group": return <div className="landing-action-group" role="group" aria-label="Acciones">{block.content.actions.map((action, index) => { const style = { ...buttonDefaults, ...action }; const elementId = getActionElementId(action, block.id); const selected = selection?.level === "element" && selection.elementId === elementId; const elementSelection = { level:"element", sectionId, regionId, blockId:block.id, elementId, elementType:"button" }; return <a key={elementId} href={action.href} onClick={editorLink(editorMode)} data-builder-selectable={editorMode || undefined} data-selection-level={editorMode ? "element" : undefined} data-element-id={editorMode ? elementId : undefined} data-element-type={editorMode ? "button" : undefined} data-selected={selected || undefined} data-variant={style.variant || "primary"} data-size={style.size || "md"} data-width={style.width || "auto"} data-radius={style.radius} data-shadow={style.shadow} data-border={style.border} data-background={style.background} data-text-color={style.text_color} data-border-color={style.border_color}>{field(renderField, block, "actions.label", action.label, { index, singleLine: true, selection: elementSelection })}</a>; })}</div>;
    case "form_reference": return resolveForm ? resolveForm(block.content.asset_id, block.content.label) : <section aria-label={block.content.label} data-form-reference={block.content.asset_id || "unassigned"}/>;
    case "logo": { if (!block.content.url) return <div role="img" aria-label={block.content.alt} data-landing-placeholder="image"><span>Logo</span></div>; const image = <img className="landing-logo" src={block.content.url} alt={block.content.alt} data-width={block.content.width}/>; return block.content.href ? <a href={block.content.href} onClick={editorLink(editorMode)} rel="noopener noreferrer">{image}</a> : image; }
    case "feature_item": return <article className="landing-feature"><span aria-hidden="true" data-feature-icon={block.content.icon}>✦</span><h3>{field(renderField, block, "title", block.content.title, { singleLine: true })}</h3><p>{field(renderField, block, "description", block.content.description)}</p>{block.content.href && <a href={block.content.href} onClick={editorLink(editorMode)}>Más información</a>}</article>;
    case "stat": return <dl className="landing-stat"><div><dt>{field(renderField, block, "label", block.content.label, { singleLine: true })}</dt><dd>{field(renderField, block, "value", block.content.value, { singleLine: true })}</dd></div>{(block.content.supporting_text || renderField) && <p>{field(renderField, block, "supporting_text", block.content.supporting_text || "", { placeholder: "Texto de apoyo" })}</p>}</dl>;
    case "testimonial": return <figure className="landing-testimonial">{block.content.avatar_url && <img src={block.content.avatar_url} alt=""/>}<blockquote>{field(renderField, block, "quote", block.content.quote)}</blockquote><figcaption><strong>{field(renderField, block, "person_name", block.content.person_name, { singleLine: true })}</strong><span>{field(renderField, block, "role_company", block.content.role_company, { singleLine: true })}</span></figcaption></figure>;
    case "video": { const src = safeVideoEmbedUrl(block.content.url); return src ? <div className="landing-video"><iframe src={src} title={block.content.title} loading="lazy" allow="accelerometer; autoplay; encrypted-media; picture-in-picture" allowFullScreen referrerPolicy="strict-origin-when-cross-origin"/></div> : <div role="img" aria-label={block.content.title} data-landing-placeholder="video">Video no disponible</div>; }
    case "pricing_card": return <article className="landing-pricing" data-emphasis={block.content.emphasis || undefined}><header><h3>{field(renderField, block, "plan_name", block.content.plan_name, { singleLine: true })}</h3><p><strong>{field(renderField, block, "price", block.content.price, { singleLine: true })}</strong><span>{field(renderField, block, "cadence", block.content.cadence, { singleLine: true })}</span></p></header><p>{field(renderField, block, "description", block.content.description)}</p><ul>{block.content.features.map((feature, index) => <li key={`${index}-${feature}`}>{field(renderField, block, "features", feature, { index, singleLine: true })}</li>)}</ul><a href={block.content.cta_url} onClick={editorLink(editorMode)}>{field(renderField, block, "cta_label", block.content.cta_label, { singleLine: true })}</a></article>;
    case "faq_item": return <details className="landing-faq" open={block.content.default_open || undefined}><summary>{field(renderField, block, "question", block.content.question, { singleLine: true })}</summary><p>{field(renderField, block, "answer", block.content.answer)}</p></details>;
    case "divider": return <hr className="landing-divider" data-style={block.content.style} data-width={block.content.width} data-spacing={block.content.spacing}/>;
    case "spacer": return <div className="landing-spacer" data-size={block.content.size} aria-hidden="true"/>;
    case "social_links": return <SocialLinks content={block.content} editorMode={editorMode} renderField={renderField} block={block}/>;
    default: return null;
  }
}

function Block(props) {
  return <div className="landing-visual-surface" {...appearanceData(props.block.style?.appearance)}><BlockContent {...props}/></div>;
}

function DropZone({ target, actions }) {
  if (!actions) return null;
  const active = actions.dropTarget?.kind === target.kind && actions.dropTarget?.blockId === target.blockId && actions.dropTarget?.sectionId === target.sectionId && actions.dropTarget?.regionId === target.regionId;
  const placing = Boolean(actions.pendingInsert);
  const validPlacement = placing && isPlacementTarget(actions.pendingInsert, target);
  return <button type="button" className={`landing-drop-zone ${active ? "is-active" : ""} ${validPlacement ? "is-mobile-placement" : ""}`} data-builder-editor-control data-drop-kind={target.kind} data-block-id-target={target.blockId} data-section-id-target={target.sectionId} data-region-id-target={target.regionId} aria-label={validPlacement ? "Colocar aquí" : "Insertar aquí"} tabIndex={validPlacement ? 0 : -1} onClick={validPlacement ? (event) => { event.preventDefault(); event.stopPropagation(); actions.onPlace?.(target); } : undefined}><span>{validPlacement ? "+ Colocar aquí" : "+ Añadir aquí"}</span></button>;
}

function isPlacementTarget(payload, target) {
  if (!payload || !target) return false;
  if (payload.kind === "palette-pattern" || payload.kind === "palette-block") return target.kind === "block-before" || target.kind === "region-end";
  return false;
}

function getDedicatedHeaderSurface(section) {
  if (section?.regions?.length !== 1 || section.regions[0]?.blocks?.length !== 1) return null;
  const block = section.regions[0].blocks[0];
  return block?.type === "site_header" ? { blockId: block.id, regionId: section.regions[0].id, layout: getHeaderLayoutContract(block) } : null;
}

function getDedicatedFooterSurface(section) {
  if (section?.regions?.length !== 1 || section.regions[0]?.blocks?.length !== 1) return null;
  const block = section.regions[0].blocks[0];
  return block?.type === "site_footer" ? { blockId: block.id, regionId: section.regions[0].id } : null;
}

const tokenValue = (token) => token ? `var(--lp-${token === "page_background" ? "page" : token === "primary" ? "accent" : token})` : undefined;
function sectionBackground(background) {
  if (!background || typeof background === "string" || ["none", "transparent"].includes(background.type)) return {};
  if (background.type === "solid") return { "--lp-section-background": tokenValue(background.color) };
  if (background.type === "gradient") return { "--lp-section-background": `var(--lp-gradient-${background.gradient})` };
  if (background.type === "image") return { "--lp-section-image": `url("${background.url.replace(/["\\\n\r()]/g, "")}")`, "--lp-section-fit": background.fit || "cover", "--lp-section-position": background.position || "center", "--lp-section-overlay": tokenValue(background.overlay_color || "text"), "--lp-section-overlay-opacity": (background.overlay_opacity || 0) / 100 };
  return {};
}

export default function LandingRenderer({ document, resolveForm = null, resolvePageLink = null, editorMode = false, selection = null, editorActions = null, renderField = null }) {
  assertLandingDocument(document);
  const rendererRef = useRef(null);
  useLayoutEffect(() => {
    const root = rendererRef.current;
    if (!root || typeof ResizeObserver === "undefined") return undefined;
    const syncSectionGeometry = () => {
      root.querySelectorAll("section[data-section-id]").forEach((section) => {
        const sectionStyle = getComputedStyle(section);
        const sectionRect = section.getBoundingClientRect();
        const paddingLeft = Number.parseFloat(sectionStyle.paddingLeft) || 0;
        const paddingRight = Number.parseFloat(sectionStyle.paddingRight) || 0;
        const borderLeft = Number.parseFloat(sectionStyle.borderLeftWidth) || 0;
        const usableLeft = sectionRect.left + borderLeft + paddingLeft;
        const usableWidth = Math.max(0, section.clientWidth - paddingLeft - paddingRight);
        section.querySelectorAll("[data-section-relative=true], [data-tablet-section-relative=true], [data-mobile-section-relative=true]").forEach((block) => {
          const region = block.closest('[data-selection-level="group"]');
          if (!region) return;
          const offset = usableLeft - region.getBoundingClientRect().left;
          block.style.setProperty("--lp-section-offset", `${offset}px`);
          block.style.setProperty("--lp-section-center-offset", `${offset + usableWidth / 2}px`);
          block.style.setProperty("--lp-section-end-offset", `${offset + usableWidth}px`);
          block.style.setProperty("--lp-section-width-full", `${usableWidth}px`);
          block.style.setProperty("--lp-section-width-wide", `${usableWidth * 0.9}px`);
          block.style.setProperty("--lp-section-width-standard", `${usableWidth * 0.75}px`);
          block.style.setProperty("--lp-section-width-narrow", `${usableWidth * 0.5}px`);
          block.style.setProperty("--lp-section-width-mobile-wide", `${usableWidth * 0.96}px`);
          block.style.setProperty("--lp-section-width-mobile-standard", `${usableWidth * 0.88}px`);
          block.style.setProperty("--lp-section-width-mobile-narrow", `${usableWidth * 0.72}px`);
        });
      });
    };
    syncSectionGeometry();
    const observer = new ResizeObserver(syncSectionGeometry);
    observer.observe(root);
    root.querySelectorAll("section[data-section-id]").forEach((section) => observer.observe(section));
    return () => observer.disconnect();
  }, [document]);
  const design = document.settings.design_system;
  const style = { "--lp-page": design.colors.page_background || "#ffffff", "--lp-surface": design.colors.surface || "#ffffff", "--lp-text": design.colors.text || "#151515", "--lp-muted": design.colors.muted || "#6b6b6b", "--lp-accent": design.colors.primary || "#9b7618", "--lp-font": design.typography.body || "Inter, system-ui, sans-serif", "--lp-heading-font": design.typography.headings || design.typography.body || "Inter, system-ui, sans-serif", "--lp-radius": design.radii.button || "12px", "--lp-card-radius": design.radii.card || "16px", "--lp-media-radius": design.radii.media || "16px", "--lp-width": design.content_widths.standard || "1120px" };
  const terminalFooter = getDedicatedFooterSurface(document.sections.at(-1));
  return <main ref={rendererRef} className="landing-renderer" data-terminal-footer={terminalFooter ? true : undefined} lang={document.locale} style={style}>
    {document.sections.map((section, sectionIndex) => {
      const headerSurface = getDedicatedHeaderSurface(section);
      const footerSurface = getDedicatedFooterSurface(section);
      const headerSurfaceSelected = editorMode
        && selection?.level === "block"
        && selection.blockId === headerSurface?.blockId;
      const footerUsesSectionTarget = Boolean(footerSurface && editorActions?.dragPayload?.kind === "section");
      return <div className={`landing-editor-section-wrap${footerSurface ? " is-site-footer-wrap" : ""}`} key={section.id}>
      <DropZone target={{ kind: "section-before", sectionId: section.id }} actions={!footerSurface || footerUsesSectionTarget ? editorActions : null}/>
      <section id={section.anchor || undefined} draggable={editorMode} data-builder-selectable={editorMode || undefined} data-selection-level="section" data-section-role={headerSurface ? "site_header" : footerSurface ? "site_footer" : undefined} data-header-layout={headerSurface?.layout} data-header-surface-block-id={editorMode ? headerSurface?.blockId : undefined} data-header-surface-region-id={editorMode ? headerSurface?.regionId : undefined} data-header-surface-selected={headerSurfaceSelected || undefined} data-footer-surface-block-id={editorMode ? footerSurface?.blockId : undefined} data-footer-surface-region-id={editorMode ? footerSurface?.regionId : undefined} data-drag-kind="section" data-drag-id={section.id} data-selected={(selection?.level === "section" && selection.sectionId === section.id) || undefined} data-selection-ancestor={(selection && selection.sectionId === section.id && selection.level !== "section") || undefined} data-section-id={section.id} data-layout={section.layout} data-align={section.style?.align || "start"} data-spacing={section.style?.spacing || "md"} data-padding-top={section.style?.padding_top} data-padding-bottom={section.style?.padding_bottom} data-content-width={section.style?.content_width || "standard"} data-background={typeof section.style?.background === "object" ? section.style.background.type : section.style?.background ? "solid" : "inherit"} data-border={section.style?.border} data-radius={section.style?.radius} data-shadow={section.style?.shadow} data-tablet-align={section.responsive?.tablet?.align} data-mobile-align={section.responsive?.mobile?.align} data-tablet-layout={section.responsive?.tablet?.layout} data-mobile-layout={section.responsive?.mobile?.layout} data-tablet-hidden={section.responsive?.tablet?.hidden || undefined} data-mobile-hidden={section.responsive?.mobile?.hidden || undefined} data-tablet-spacing={section.responsive?.tablet?.spacing} data-mobile-spacing={section.responsive?.mobile?.spacing} style={sectionBackground(section.style?.background)}>
        <div className="landing-section-visual-surface" {...appearanceData(section.style?.appearance)} aria-hidden="true"/>
        <div className="landing-section-composition" data-composition-layout={section.layout} data-composition-width={section.style?.content_width || "standard"} data-composition-align={section.style?.align || "start"} data-tablet-composition-align={section.responsive?.tablet?.align} data-mobile-composition-align={section.responsive?.mobile?.align} data-tablet-composition-layout={section.responsive?.tablet?.layout} data-mobile-composition-layout={section.responsive?.mobile?.layout}>
        {section.regions.map((region, regionIndex) => <div key={region.id} data-builder-selectable={editorMode || undefined} data-selection-level="group" data-selected={(selection?.level === "group" && selection.regionId === region.id) || undefined} data-selection-ancestor={(selection && selection.regionId === region.id && !["section","group"].includes(selection.level)) || undefined} data-region-id={region.id} data-region-span={region.span} data-tablet-incomplete-row={(section.layout === "columns" && section.regions.length > 1 && section.regions.length % 2 === 1 && regionIndex === section.regions.length - 1) || undefined}>
          {region.blocks.map((block) => <div className="landing-editor-block-wrap" key={block.id}>
            {(!footerSurface || !footerUsesSectionTarget) && <DropZone target={{ kind: "block-before", blockId: block.id, regionId: region.id }} actions={editorActions}/>}
            <div
              draggable={editorMode && editorActions?.editing?.blockId !== block.id}
              data-builder-selectable={editorMode || undefined}
              data-selection-level="block"
              data-drag-kind="block"
              data-drag-id={block.id}
              data-selected={(selection?.level === "block" && selection.blockId === block.id) || undefined}
              data-selection-ancestor={(selection?.level === "element" && selection.blockId === block.id) || undefined}
              data-header-surface-proxy={(editorMode && block.id === headerSurface?.blockId) || undefined}
              data-block-id={block.id}
              data-block-type={block.type}
              data-align={block.style?.align || "start"}
              data-block-align={block.type === "site_footer" ? "start" : block.style?.align || "start"}
              data-section-relative={block.type === "site_footer" ? undefined : hasSectionRelativeBlockLayout(block, section) || undefined}
              data-color={block.style?.color}
              data-text-variant={block.style?.text_variant}
              data-text-size={block.style?.text_size}
              data-text-weight={block.style?.text_weight}
              data-font-family={block.style?.font_family}
              data-line-height={block.style?.line_height}
              data-letter-spacing={block.style?.letter_spacing}
              data-max-width={block.type === "site_footer" ? "none" : block.style?.max_width || "none"}
              data-spacing={block.style?.spacing}
              data-padding-top={block.style?.padding_top || "none"}
              data-padding-bottom={block.style?.padding_bottom || "none"}
              data-border={block.style?.border}
              data-radius={block.style?.radius}
              data-shadow={block.style?.shadow}
              data-tablet-align={block.responsive?.tablet?.align}
              data-mobile-align={block.responsive?.mobile?.align}
              data-tablet-block-align={block.responsive?.tablet?.align}
              data-mobile-block-align={block.responsive?.mobile?.align}
              data-tablet-section-relative={hasSectionRelativeBlockLayout(block, section, "tablet") || undefined}
              data-mobile-section-relative={hasSectionRelativeBlockLayout(block, section, "mobile") || undefined}
              data-tablet-hidden={block.responsive?.tablet?.hidden || undefined}
              data-mobile-hidden={block.responsive?.mobile?.hidden || undefined}
              data-tablet-spacing={block.responsive?.tablet?.spacing}
              data-mobile-spacing={block.responsive?.mobile?.spacing}
              data-tablet-max-width={block.responsive?.tablet?.max_width}
              data-mobile-max-width={block.responsive?.mobile?.max_width}
              data-tablet-text-size={block.responsive?.tablet?.text_size}
              data-mobile-text-size={block.responsive?.mobile?.text_size}
              data-tablet-text-variant={block.responsive?.tablet?.text_variant}
              data-mobile-text-variant={block.responsive?.mobile?.text_variant}
              data-tablet-line-height={block.responsive?.tablet?.line_height}
              data-mobile-line-height={block.responsive?.mobile?.line_height}
              data-tablet-letter-spacing={block.responsive?.tablet?.letter_spacing}
              data-mobile-letter-spacing={block.responsive?.mobile?.letter_spacing}
              data-tablet-padding-top={block.responsive?.tablet?.padding_top}
              data-mobile-padding-top={block.responsive?.mobile?.padding_top}
              data-tablet-padding-bottom={block.responsive?.tablet?.padding_bottom}
              data-mobile-padding-bottom={block.responsive?.mobile?.padding_bottom}
            >
              {editorMode && !(selection?.level === "element" && selection.blockId === block.id) && <BlockChrome block={block} selected={selection?.level === "block" && selection.blockId === block.id} editorActions={editorActions}/>}
              <Block block={block} sectionId={section.id} regionId={region.id} selection={selection} resolveForm={resolveForm} resolvePageLink={resolvePageLink} buttonDefaults={design.buttons} renderField={editorMode ? renderField : null} editorMode={editorMode}/>
            </div>
            {block.id !== footerSurface?.blockId && <DropZone target={{ kind: "block-after", blockId: block.id, regionId: region.id }} actions={editorActions}/>}
          </div>)}
          {region.id !== footerSurface?.regionId && <DropZone target={{ kind: "region-end", regionId: region.id }} actions={editorActions}/>}
        </div>)}
        </div>
      </section>
      {!footerSurface && (!editorActions?.pendingInsert || sectionIndex === document.sections.length - 1) && <DropZone target={{ kind: "section-after", sectionId: section.id }} actions={editorActions}/>}
    </div>;
    })}
  </main>;
}

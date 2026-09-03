import { useState } from "react";
import { assertLandingDocument, safeVideoEmbedUrl } from "../document/landingDocument.js";

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
  spacer: "Espacio", social_links: "Social",
};


function EditorMenu({ label, children }) {
  return <details className="landing-editor-menu" onClick={(event) => event.stopPropagation()}>
    <summary aria-label={label} title={label}>•••</summary>
    <div className="landing-editor-menu-popover">{children}</div>
  </details>;
}

function SectionChrome({ section, editorActions }) {
  return <div className="landing-section-chrome">
    <EditorMenu label="Opciones de sección">
      <strong>Sección</strong>
      <button type="button" onClick={() => editorActions?.openPanel?.({ kind: "section", id: section.id })}>Diseño y columnas</button>
      <button type="button" onClick={() => editorActions?.duplicate?.({ kind: "section", id: section.id })}>Duplicar sección</button>
      <button type="button" className="is-danger" onClick={() => editorActions?.remove?.({ kind: "section", id: section.id })}>Eliminar sección</button>
    </EditorMenu>
  </div>;
}

function BlockChrome({ block, selected, editorActions }) {
  return <div className={`landing-block-chrome ${selected ? "is-selected" : ""}`}>
    <span>{EDITOR_BLOCK_LABELS[block.type] || block.type}</span>
    <button type="button" draggable data-drag-kind="block" data-drag-id={block.id} aria-label={`Arrastrar ${EDITOR_BLOCK_LABELS[block.type] || block.type}`} data-drag-handle title="Arrastrar bloque">⋮⋮</button>
    <EditorMenu label={`Opciones de ${EDITOR_BLOCK_LABELS[block.type] || "bloque"}`}>
      <strong>{EDITOR_BLOCK_LABELS[block.type] || "Bloque"}</strong>
      <button type="button" onClick={() => editorActions?.openPanel?.({ kind: "block", id: block.id })}>Opciones avanzadas</button>
      <button type="button" onClick={() => editorActions?.duplicate?.({ kind: "block", id: block.id })}>Duplicar bloque</button>
      <button type="button" className="is-danger" onClick={() => editorActions?.remove?.({ kind: "block", id: block.id })}>Eliminar bloque</button>
    </EditorMenu>
  </div>;
}

function Block({ block, resolveForm, buttonDefaults = {}, renderField = null, editorMode = false }) {
  switch (block.type) {
    case "heading": { const Tag = `h${block.content.level}`; return <Tag>{field(renderField, block, "text", block.content.text, { singleLine: true })}</Tag>; }
    case "text": return <p>{field(renderField, block, "text", block.content.text)}</p>;
    case "image": return <ImageBlock block={block}/>;
    case "action_group": return <div role="group" aria-label="Acciones">{block.content.actions.map((action, index) => { const style = { ...buttonDefaults, ...action }; return <a key={`${action.label}-${action.href}-${index}`} href={action.href} onClick={editorLink(editorMode)} data-variant={style.variant || "primary"} data-size={style.size || "md"} data-width={style.width || "auto"} data-radius={style.radius} data-shadow={style.shadow} data-border={style.border} data-background={style.background} data-text-color={style.text_color} data-border-color={style.border_color}>{field(renderField, block, "actions.label", action.label, { index, singleLine: true })}</a>; })}</div>;
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
    case "social_links": return <nav className="landing-social" aria-label="Redes sociales">{block.content.links.map((link, index) => <a key={`${link.provider}-${link.url}-${index}`} href={link.url} onClick={editorLink(editorMode)} rel="noopener noreferrer" aria-label={link.label} data-provider={link.provider}>{field(renderField, block, "links.label", link.label, { index, singleLine: true })}</a>)}</nav>;
    default: return null;
  }
}

function DropZone({ target, actions }) {
  if (!actions) return null;
  const active = actions.dropTarget?.kind === target.kind && actions.dropTarget?.blockId === target.blockId && actions.dropTarget?.sectionId === target.sectionId && actions.dropTarget?.regionId === target.regionId;
  return <button type="button" className={`landing-drop-zone ${active ? "is-active" : ""}`} data-drop-kind={target.kind} data-block-id-target={target.blockId} data-section-id-target={target.sectionId} data-region-id-target={target.regionId} aria-label="Insertar aquí" tabIndex={-1}><span>+ Añadir aquí</span></button>;
}

const tokenValue = (token) => token ? `var(--lp-${token === "page_background" ? "page" : token === "primary" ? "accent" : token})` : undefined;
function sectionBackground(background) {
  if (!background || typeof background === "string" || ["none", "transparent"].includes(background.type)) return {};
  if (background.type === "solid") return { "--lp-section-background": tokenValue(background.color) };
  if (background.type === "gradient") return { "--lp-section-background": `var(--lp-gradient-${background.gradient})` };
  if (background.type === "image") return { "--lp-section-image": `url("${background.url.replace(/["\\\n\r()]/g, "")}")`, "--lp-section-fit": background.fit || "cover", "--lp-section-position": background.position || "center", "--lp-section-overlay": tokenValue(background.overlay_color || "text"), "--lp-section-overlay-opacity": (background.overlay_opacity || 0) / 100 };
  return {};
}

export default function LandingRenderer({ document, resolveForm = null, editorMode = false, selection = null, editorActions = null, renderField = null }) {
  assertLandingDocument(document);
  const design = document.settings.design_system;
  const style = { "--lp-page": design.colors.page_background || "#ffffff", "--lp-surface": design.colors.surface || "#ffffff", "--lp-text": design.colors.text || "#151515", "--lp-muted": design.colors.muted || "#6b6b6b", "--lp-accent": design.colors.primary || "#9b7618", "--lp-font": design.typography.body || "Inter, system-ui, sans-serif", "--lp-heading-font": design.typography.headings || design.typography.body || "Inter, system-ui, sans-serif", "--lp-radius": design.radii.button || "12px", "--lp-card-radius": design.radii.card || "16px", "--lp-media-radius": design.radii.media || "16px", "--lp-width": design.content_widths.standard || "1120px" };
  return <main className="landing-renderer" lang={document.locale} style={style}>
    {document.sections.map((section) => <div className="landing-editor-section-wrap" key={section.id}>
      <DropZone target={{ kind: "section-before", sectionId: section.id }} actions={editorActions}/>
      <section draggable={editorMode} data-drag-kind="section" data-drag-id={section.id} data-selected={(selection?.kind === "section" && selection.id === section.id) || undefined} data-section-id={section.id} data-layout={section.layout} data-align={section.style?.align || "start"} data-spacing={section.style?.spacing || "md"} data-padding-top={section.style?.padding_top} data-padding-bottom={section.style?.padding_bottom} data-content-width={section.style?.content_width || "standard"} data-background={typeof section.style?.background === "object" ? section.style.background.type : section.style?.background ? "solid" : "inherit"} data-border={section.style?.border} data-radius={section.style?.radius} data-shadow={section.style?.shadow} data-tablet-align={section.responsive?.tablet?.align} data-mobile-align={section.responsive?.mobile?.align} data-tablet-layout={section.responsive?.tablet?.layout} data-mobile-layout={section.responsive?.mobile?.layout} data-tablet-hidden={section.responsive?.tablet?.hidden || undefined} data-mobile-hidden={section.responsive?.mobile?.hidden || undefined} data-tablet-spacing={section.responsive?.tablet?.spacing} data-mobile-spacing={section.responsive?.mobile?.spacing} style={sectionBackground(section.style?.background)}>
        {editorMode && <SectionChrome section={section} editorActions={editorActions}/>}
        {section.regions.map((region) => <div key={region.id} data-region-id={region.id} data-region-span={region.span}>
          {region.blocks.map((block) => <div className="landing-editor-block-wrap" key={block.id}>
            <DropZone target={{ kind: "block-before", blockId: block.id, regionId: region.id }} actions={editorActions}/>
            <div draggable={editorMode && editorActions?.editing?.blockId !== block.id} data-drag-kind="block" data-drag-id={block.id} data-selected={(selection?.kind === "block" && selection.id === block.id) || undefined} data-block-id={block.id} data-align={block.style?.align || "start"} data-color={block.style?.color} data-text-variant={block.style?.text_variant} data-text-size={block.style?.text_size} data-text-weight={block.style?.text_weight} data-font-family={block.style?.font_family} data-max-width={block.style?.max_width} data-spacing={block.style?.spacing} data-border={block.style?.border} data-radius={block.style?.radius} data-shadow={block.style?.shadow} data-tablet-align={block.responsive?.tablet?.align} data-mobile-align={block.responsive?.mobile?.align} data-tablet-hidden={block.responsive?.tablet?.hidden || undefined} data-mobile-hidden={block.responsive?.mobile?.hidden || undefined} data-tablet-spacing={block.responsive?.tablet?.spacing} data-mobile-spacing={block.responsive?.mobile?.spacing}>
              {editorMode && <BlockChrome block={block} selected={selection?.kind === "block" && selection.id === block.id} editorActions={editorActions}/>}
              <Block block={block} resolveForm={resolveForm} buttonDefaults={design.buttons} renderField={editorMode ? renderField : null} editorMode={editorMode}/>
            </div>
            <DropZone target={{ kind: "block-after", blockId: block.id, regionId: region.id }} actions={editorActions}/>
          </div>)}
          <DropZone target={{ kind: "region-end", regionId: region.id }} actions={editorActions}/>
        </div>)}
      </section>
      <DropZone target={{ kind: "section-after", sectionId: section.id }} actions={editorActions}/>
    </div>)}
  </main>;
}

import { useState } from "react";
import { assertLandingDocument, safeVideoEmbedUrl } from "../document/landingDocument.js";

function ImageBlock({ block }) {
  const [failedUrl, setFailedUrl] = useState(null);
  const source = block.content.source;
  const failed = source.kind === "external" && failedUrl === source.url;
  if (source.kind !== "external" || failed) return <div role="img" aria-label={block.content.decorative ? undefined : block.content.alt} data-landing-placeholder="image"><span>{failed ? "No se pudo cargar la imagen" : "Imagen"}</span></div>;
  return <img src={source.url} alt={block.content.decorative ? "" : block.content.alt} data-fit={block.content.fit || "cover"} data-aspect={block.content.aspect_ratio || "auto"} data-radius={block.content.radius || "md"} data-focal={block.content.focal_position || "center"} onError={() => setFailedUrl(source.url)}/>;
}

function Block({ block, resolveForm, buttonDefaults = {} }) {
  switch (block.type) {
    case "heading": { const Tag = `h${block.content.level}`; return <Tag>{block.content.text}</Tag>; }
    case "text": return <p>{block.content.text}</p>;
    case "image": return <ImageBlock block={block}/>;
    case "action_group": return <div role="group" aria-label="Acciones">{block.content.actions.map((action) => { const style = { ...buttonDefaults, ...action }; return <a key={`${action.label}-${action.href}`} href={action.href} data-variant={style.variant || "primary"} data-size={style.size || "md"} data-width={style.width || "auto"} data-radius={style.radius} data-shadow={style.shadow} data-border={style.border} data-background={style.background} data-text-color={style.text_color} data-border-color={style.border_color}>{action.label}</a>; })}</div>;
    case "form_reference": return resolveForm ? resolveForm(block.content.asset_id, block.content.label) : <section aria-label={block.content.label} data-form-reference={block.content.asset_id || "unassigned"}/>;
    case "logo": { if (!block.content.url) return <div role="img" aria-label={block.content.alt} data-landing-placeholder="image"><span>Logo</span></div>; const image = <img className="landing-logo" src={block.content.url} alt={block.content.alt} data-width={block.content.width}/>; return block.content.href ? <a href={block.content.href} rel="noopener noreferrer">{image}</a> : image; }
    case "feature_item": return <article className="landing-feature"><span aria-hidden="true" data-feature-icon={block.content.icon}>✦</span><h3>{block.content.title}</h3><p>{block.content.description}</p>{block.content.href && <a href={block.content.href}>Más información</a>}</article>;
    case "stat": return <dl className="landing-stat"><div><dt>{block.content.label}</dt><dd>{block.content.value}</dd></div>{block.content.supporting_text && <p>{block.content.supporting_text}</p>}</dl>;
    case "testimonial": return <figure className="landing-testimonial">{block.content.avatar_url && <img src={block.content.avatar_url} alt=""/>}<blockquote>{block.content.quote}</blockquote><figcaption><strong>{block.content.person_name}</strong><span>{block.content.role_company}</span></figcaption></figure>;
    case "video": { const src = safeVideoEmbedUrl(block.content.url); return src ? <div className="landing-video"><iframe src={src} title={block.content.title} loading="lazy" allow="accelerometer; autoplay; encrypted-media; picture-in-picture" allowFullScreen referrerPolicy="strict-origin-when-cross-origin"/></div> : <div role="img" aria-label={block.content.title} data-landing-placeholder="video">Video no disponible</div>; }
    case "pricing_card": return <article className="landing-pricing" data-emphasis={block.content.emphasis || undefined}><header><h3>{block.content.plan_name}</h3><p><strong>{block.content.price}</strong><span>{block.content.cadence}</span></p></header><p>{block.content.description}</p><ul>{block.content.features.map((feature) => <li key={feature}>{feature}</li>)}</ul><a href={block.content.cta_url}>{block.content.cta_label}</a></article>;
    case "faq_item": return <details className="landing-faq" open={block.content.default_open || undefined}><summary>{block.content.question}</summary><p>{block.content.answer}</p></details>;
    case "divider": return <hr className="landing-divider" data-style={block.content.style} data-width={block.content.width} data-spacing={block.content.spacing}/>;
    case "spacer": return <div className="landing-spacer" data-size={block.content.size} aria-hidden="true"/>;
    case "social_links": return <nav className="landing-social" aria-label="Redes sociales">{block.content.links.map((link) => <a key={`${link.provider}-${link.url}`} href={link.url} rel="noopener noreferrer" aria-label={link.label} data-provider={link.provider}>{link.label}</a>)}</nav>;
    default: return null;
  }
}

function DropZone({ target, actions }) {
  if (!actions) return null;
  const active = actions.dropTarget?.kind === target.kind && actions.dropTarget?.blockId === target.blockId && actions.dropTarget?.sectionId === target.sectionId && actions.dropTarget?.regionId === target.regionId;
  return <button
    type="button"
    className={`landing-drop-zone ${active ? "is-active" : ""}`}
    data-drop-kind={target.kind}
    data-block-id-target={target.blockId}
    data-section-id-target={target.sectionId}
    data-region-id-target={target.regionId}
    aria-label="Insertar aquí"
    tabIndex={-1}
  ><span>+ Añadir aquí</span></button>;
}

const tokenValue = (token) => token ? `var(--lp-${token === "page_background" ? "page" : token === "primary" ? "accent" : token})` : undefined;
function sectionBackground(background) {
  if (!background || typeof background === "string" || ["none", "transparent"].includes(background.type)) return {};
  if (background.type === "solid") return { "--lp-section-background": tokenValue(background.color) };
  if (background.type === "gradient") return { "--lp-section-background": `var(--lp-gradient-${background.gradient})` };
  if (background.type === "image") return { "--lp-section-image": `url("${background.url.replace(/["\\\n\r()]/g, "")}")`, "--lp-section-fit": background.fit || "cover", "--lp-section-position": background.position || "center", "--lp-section-overlay": tokenValue(background.overlay_color || "text"), "--lp-section-overlay-opacity": (background.overlay_opacity || 0) / 100 };
  return {};
}

export default function LandingRenderer({ document, resolveForm = null, editorMode = false, selection = null, editorActions = null }) {
  assertLandingDocument(document);
  const design = document.settings.design_system;
  const style = { "--lp-page": design.colors.page_background || "#ffffff", "--lp-surface": design.colors.surface || "#ffffff", "--lp-text": design.colors.text || "#151515", "--lp-muted": design.colors.muted || "#6b6b6b", "--lp-accent": design.colors.primary || "#9b7618", "--lp-font": design.typography.body || "Inter, system-ui, sans-serif", "--lp-radius": design.radii.button || "12px", "--lp-card-radius": design.radii.card || "16px", "--lp-media-radius": design.radii.media || "16px", "--lp-width": design.content_widths.standard || "1120px" };
  return <main className="landing-renderer" lang={document.locale} style={style}>
    {document.sections.map((section) => <div className="landing-editor-section-wrap" key={section.id}>
      <DropZone target={{ kind: "section-before", sectionId: section.id }} actions={editorActions}/>
      <section draggable={editorMode} data-drag-kind="section" data-drag-id={section.id} data-selected={(selection?.kind === "section" && selection.id === section.id) || undefined} data-section-id={section.id} data-layout={section.layout} data-align={section.style?.align || "start"} data-spacing={section.style?.spacing || "md"} data-padding-top={section.style?.padding_top} data-padding-bottom={section.style?.padding_bottom} data-content-width={section.style?.content_width || "standard"} data-background={typeof section.style?.background === "object" ? section.style.background.type : section.style?.background ? "solid" : "inherit"} data-border={section.style?.border} data-radius={section.style?.radius} data-shadow={section.style?.shadow} data-tablet-align={section.responsive?.tablet?.align} data-mobile-align={section.responsive?.mobile?.align} data-tablet-layout={section.responsive?.tablet?.layout} data-mobile-layout={section.responsive?.mobile?.layout} data-tablet-hidden={section.responsive?.tablet?.hidden || undefined} data-mobile-hidden={section.responsive?.mobile?.hidden || undefined} data-tablet-spacing={section.responsive?.tablet?.spacing} data-mobile-spacing={section.responsive?.mobile?.spacing} style={sectionBackground(section.style?.background)}>
        {editorMode && <div className="landing-section-chrome"><span>SECTION</span><button type="button" aria-label="Arrastrar sección" data-drag-handle>⋮⋮</button><button type="button" onClick={(event) => { event.stopPropagation(); editorActions?.duplicate({ kind: "section", id: section.id }); }}>Duplicar</button><button type="button" onClick={(event) => { event.stopPropagation(); editorActions?.remove({ kind: "section", id: section.id }); }}>Eliminar</button></div>}
        {section.regions.map((region) => <div key={region.id} data-region-id={region.id} data-region-span={region.span}>
          {region.blocks.map((block) => <div className="landing-editor-block-wrap" key={block.id}>
            <DropZone target={{ kind: "block-before", blockId: block.id, regionId: region.id }} actions={editorActions}/>
            <div draggable={editorMode} data-drag-kind="block" data-drag-id={block.id} data-selected={(selection?.kind === "block" && selection.id === block.id) || undefined} data-block-id={block.id} data-align={block.style?.align || "start"} data-color={block.style?.color} data-text-variant={block.style?.text_variant} data-text-size={block.style?.text_size} data-text-weight={block.style?.text_weight} data-max-width={block.style?.max_width} data-spacing={block.style?.spacing} data-border={block.style?.border} data-radius={block.style?.radius} data-shadow={block.style?.shadow} data-tablet-align={block.responsive?.tablet?.align} data-mobile-align={block.responsive?.mobile?.align} data-tablet-hidden={block.responsive?.tablet?.hidden || undefined} data-mobile-hidden={block.responsive?.mobile?.hidden || undefined} data-tablet-spacing={block.responsive?.tablet?.spacing} data-mobile-spacing={block.responsive?.mobile?.spacing}>
              {editorMode && <div className="landing-block-chrome"><span>{block.type.replace("_", " ")}</span><button type="button" aria-label={`Arrastrar ${block.type}`} data-drag-handle>⋮⋮</button></div>}
              <Block block={block} resolveForm={resolveForm} buttonDefaults={design.buttons}/>
              {editorMode && selection?.kind === "block" && selection.id === block.id && <div className="landing-context-toolbar"><span>{block.type.replace("_", " ")}</span><button type="button" onClick={(event) => { event.stopPropagation(); editorActions?.move({ kind: "block", id: block.id }, -1); }} aria-label="Mover arriba">↑</button><button type="button" onClick={(event) => { event.stopPropagation(); editorActions?.move({ kind: "block", id: block.id }, 1); }} aria-label="Mover abajo">↓</button><button type="button" onClick={(event) => { event.stopPropagation(); editorActions?.duplicate({ kind: "block", id: block.id }); }}>Duplicar</button><button type="button" onClick={(event) => { event.stopPropagation(); editorActions?.remove({ kind: "block", id: block.id }); }}>Eliminar</button></div>}
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

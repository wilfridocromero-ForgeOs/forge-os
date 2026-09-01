import { useState } from "react";
import { assertLandingDocument } from "../document/landingDocument.js";

function ImageBlock({ block }) {
  const [failedUrl, setFailedUrl] = useState(null);
  const source = block.content.source;
  const failed = source.kind === "external" && failedUrl === source.url;
  if (source.kind !== "external" || failed) return <div role="img" aria-label={block.content.decorative ? undefined : block.content.alt} data-landing-placeholder="image"><span>{failed ? "No se pudo cargar la imagen" : "Imagen"}</span></div>;
  return <img src={source.url} alt={block.content.decorative ? "" : block.content.alt} onError={() => setFailedUrl(source.url)}/>;
}

function Block({ block, resolveForm }) {
  switch (block.type) {
    case "heading": { const Tag = `h${block.content.level}`; return <Tag>{block.content.text}</Tag>; }
    case "text": return <p>{block.content.text}</p>;
    case "image": return <ImageBlock block={block}/>;
    case "action_group": return <div role="group" aria-label="Acciones">{block.content.actions.map((action) => <a key={`${action.label}-${action.href}`} href={action.href} data-variant={action.variant}>{action.label}</a>)}</div>;
    case "form_reference": return resolveForm ? resolveForm(block.content.asset_id, block.content.label) : <section aria-label={block.content.label} data-form-reference={block.content.asset_id || "unassigned"}/>;
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

export default function LandingRenderer({ document, resolveForm = null, editorMode = false, selection = null, editorActions = null }) {
  assertLandingDocument(document);
  const design = document.settings.design_system;
  const style = { "--lp-page": design.colors.page_background || "#ffffff", "--lp-text": design.colors.text || "#151515", "--lp-accent": design.colors.primary || "#9b7618", "--lp-font": design.typography.body || "Inter, system-ui, sans-serif", "--lp-radius": design.radii.button || "12px", "--lp-width": design.content_widths.standard || "1120px" };
  return <main className="landing-renderer" lang={document.locale} style={style}>
    {document.sections.map((section) => <div className="landing-editor-section-wrap" key={section.id}>
      <DropZone target={{ kind: "section-before", sectionId: section.id }} actions={editorActions}/>
      <section draggable={editorMode} data-drag-kind="section" data-drag-id={section.id} data-selected={(selection?.kind === "section" && selection.id === section.id) || undefined} data-section-id={section.id} data-layout={section.layout} data-align={section.style?.align || "start"}>
        {editorMode && <div className="landing-section-chrome"><span>SECTION</span><button type="button" aria-label="Arrastrar sección" data-drag-handle>⋮⋮</button><button type="button" onClick={(event) => { event.stopPropagation(); editorActions?.duplicate({ kind: "section", id: section.id }); }}>Duplicar</button><button type="button" onClick={(event) => { event.stopPropagation(); editorActions?.remove({ kind: "section", id: section.id }); }}>Eliminar</button></div>}
        {section.regions.map((region) => <div key={region.id} data-region-id={region.id} data-region-span={region.span}>
          {region.blocks.map((block) => <div className="landing-editor-block-wrap" key={block.id}>
            <DropZone target={{ kind: "block-before", blockId: block.id, regionId: region.id }} actions={editorActions}/>
            <div draggable={editorMode} data-drag-kind="block" data-drag-id={block.id} data-selected={(selection?.kind === "block" && selection.id === block.id) || undefined} data-block-id={block.id} data-align={block.style?.align || "start"}>
              {editorMode && <div className="landing-block-chrome"><span>{block.type.replace("_", " ")}</span><button type="button" aria-label={`Arrastrar ${block.type}`} data-drag-handle>⋮⋮</button></div>}
              <Block block={block} resolveForm={resolveForm}/>
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

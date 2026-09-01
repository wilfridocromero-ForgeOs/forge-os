import { assertLandingDocument } from "../document/landingDocument.js";

function Block({ block, resolveForm }) {
  switch (block.type) {
    case "heading": {
      const Tag = `h${block.content.level}`;
      return <Tag>{block.content.text}</Tag>;
    }
    case "text": return <p>{block.content.text}</p>;
    case "image": return block.content.source.kind === "external"
      ? <img src={block.content.source.url} alt={block.content.decorative ? "" : block.content.alt}/>
      : <div role="img" aria-label={block.content.decorative ? undefined : block.content.alt} data-landing-placeholder="image"/>;
    case "action_group": return <div role="group" aria-label="Acciones">{block.content.actions.map((action) => <a key={`${action.label}-${action.href}`} href={action.href} data-variant={action.variant}>{action.label}</a>)}</div>;
    case "form_reference": return resolveForm
      ? resolveForm(block.content.asset_id, block.content.label)
      : <section aria-label={block.content.label} data-form-reference={block.content.asset_id || "unassigned"}/>;
    default: return null;
  }
}

export default function LandingRenderer({ document, resolveForm = null, editorMode = false, selection = null }) {
  assertLandingDocument(document);
  const design = document.settings.design_system;
  const style = {
    "--lp-page": design.colors.page_background || "#ffffff",
    "--lp-text": design.colors.text || "#151515",
    "--lp-accent": design.colors.primary || "#9b7618",
    "--lp-font": design.typography.body || "Inter, system-ui, sans-serif",
    "--lp-radius": design.radii.button || "12px",
    "--lp-width": design.content_widths.standard || "1120px",
  };
  return <main className="landing-renderer" lang={document.locale} style={style}>
    {document.sections.map((section) => <section
      key={section.id}
      draggable={editorMode}
      data-selected={(selection?.kind === "section" && selection.id === section.id) || undefined}
      data-section-id={section.id}
      data-layout={section.layout}
      data-align={section.style?.align || "start"}
    >
      {section.regions.map((region) => <div key={region.id} data-region-id={region.id} data-region-span={region.span}>
        {region.blocks.map((block) => <div
          key={block.id}
          draggable={editorMode}
          data-selected={(selection?.kind === "block" && selection.id === block.id) || undefined}
          data-block-id={block.id}
          data-align={block.style?.align || "start"}
        ><Block block={block} resolveForm={resolveForm}/></div>)}
      </div>)}
    </section>)}
  </main>;
}

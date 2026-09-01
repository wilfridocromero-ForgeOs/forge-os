import { assertLandingDocument } from "../document/landingDocument.js";

function Block({ block, resolveForm }) {
  switch (block.type) {
    case "heading": { const Tag = `h${block.content.level}`; return <Tag>{block.content.text}</Tag>; }
    case "text": return <p>{block.content.text}</p>;
    case "image": return block.content.source.kind === "external" ? <img src={block.content.source.url} alt={block.content.decorative ? "" : block.content.alt} /> : <div role="img" aria-label={block.content.decorative ? undefined : block.content.alt} data-landing-placeholder="image" />;
    case "action_group": return <div role="group" aria-label="Acciones">{block.content.actions.map((action) => <a key={`${action.label}-${action.href}`} href={action.href} data-variant={action.variant}>{action.label}</a>)}</div>;
    case "form_reference": return resolveForm ? resolveForm(block.content.asset_id, block.content.label) : <section aria-label={block.content.label} data-form-reference={block.content.asset_id || "unassigned"} />;
    default: return null;
  }
}

export default function LandingRenderer({ document, resolveForm = null }) {
  assertLandingDocument(document);
  return <main className="landing-renderer" lang={document.locale}>{document.sections.map((section) => <section key={section.id} data-layout={section.layout}>{section.regions.map((region) => <div key={region.id} data-region-span={region.span}>{region.blocks.map((block) => <Block key={block.id} block={block} resolveForm={resolveForm} />)}</div>)}</section>)}</main>;
}

import { assertLandingDocument, createPrimitiveBlock } from "./landingDocument.js";

const clone = (value) => structuredClone(value);
const locateRegion = (document, regionId) => document.sections.flatMap((section) => section.regions).find((region) => region.id === regionId);
const locateBlock = (document, blockId) => document.sections.flatMap((section) => section.regions).flatMap((region) => region.blocks).find((block) => block.id === blockId);
const mergeDefined = (base, changes) => { const next = { ...base, ...clone(changes) }; for (const key of Object.keys(next)) if (next[key] === undefined) delete next[key]; return next; };

export const sectionContainsSiteFooter = (section) => section?.regions?.some((region) => region.blocks?.some((block) => block.type === "site_footer")) || false;

export function inspectSiteFooter(document) {
  const locations = [];
  for (const [sectionIndex, section] of document.sections.entries()) for (const [regionIndex, region] of section.regions.entries()) for (const [blockIndex, block] of region.blocks.entries()) {
    if (block.type === "site_footer") locations.push({ section, sectionIndex, region, regionIndex, block, blockIndex });
  }
  return { count: locations.length, location: locations[0] || null };
}

export const isDedicatedSiteFooterSection = (section) => section?.regions?.length === 1
  && section.regions[0].blocks?.length === 1
  && section.regions[0].blocks[0].type === "site_footer";

export function enforceSiteFooterOrder(document) {
  const footer = inspectSiteFooter(document);
  if (footer.count > 1) throw new Error("BUILDER_SITE_FOOTER_ALREADY_EXISTS");
  if (footer.location && !isDedicatedSiteFooterSection(footer.location.section)) throw new Error("BUILDER_SITE_FOOTER_REQUIRES_DEDICATED_SECTION");
  if (footer.location && footer.location.sectionIndex !== document.sections.length - 1) {
    const [section] = document.sections.splice(footer.location.sectionIndex, 1);
    document.sections.push(section);
  }
  return document;
}

export function insertSectionWithFooterContract(document, section, requestedIndex = document.sections.length) {
  enforceSiteFooterOrder(document);
  const currentFooter = inspectSiteFooter(document);
  const candidateFooter = inspectSiteFooter({ sections:[section] });
  if (candidateFooter.count > 1 || (candidateFooter.count === 1 && currentFooter.count === 1)) throw new Error("BUILDER_SITE_FOOTER_ALREADY_EXISTS");
  if (candidateFooter.count === 1 && !isDedicatedSiteFooterSection(section)) throw new Error("BUILDER_SITE_FOOTER_REQUIRES_DEDICATED_SECTION");

  const upperBoundary = candidateFooter.count === 1
    ? document.sections.length
    : currentFooter.location?.sectionIndex ?? document.sections.length;
  const insertion = candidateFooter.count === 1
    ? document.sections.length
    : Math.min(Math.max(0, requestedIndex), upperBoundary);
  document.sections.splice(insertion, 0, clone(section));
  enforceSiteFooterOrder(document);
  return insertion;
}

export function applyLandingOperation(input, operation) {
  assertLandingDocument(input);
  const document = clone(input);
  enforceSiteFooterOrder(document);
  switch (operation.type) {
    case "add_section": insertSectionWithFooterContract(document, operation.section, operation.index ?? document.sections.length); break;
    case "update_section": { const section = document.sections.find((item) => item.id === operation.section_id); if (!section) throw new Error("BUILDER_SECTION_NOT_FOUND"); Object.assign(section, clone(operation.changes)); break; }
    case "update_section_style": { const section = document.sections.find((item) => item.id === operation.section_id); if (!section) throw new Error("BUILDER_SECTION_NOT_FOUND"); section.style = mergeDefined(section.style || {}, operation.changes); if (!Object.keys(section.style).length) delete section.style; break; }
    case "reset_section_style": { const section = document.sections.find((item) => item.id === operation.section_id); if (!section) throw new Error("BUILDER_SECTION_NOT_FOUND"); delete section.style; break; }
    case "remove_section": { const count = document.sections.length; document.sections = document.sections.filter((item) => item.id !== operation.section_id); if (document.sections.length === count) throw new Error("BUILDER_SECTION_NOT_FOUND"); break; }
    case "add_block": {
      const region = locateRegion(document, operation.region_id);
      if (!region) throw new Error("BUILDER_REGION_NOT_FOUND");
      const owner = document.sections.find((section) => section.regions.some((item) => item.id === region.id));
      if (operation.block_type === "site_footer") {
        if (inspectSiteFooter(document).count) throw new Error("BUILDER_SITE_FOOTER_ALREADY_EXISTS");
        if (owner?.regions.length !== 1 || region.blocks.length !== 0) throw new Error("BUILDER_SITE_FOOTER_REQUIRES_DEDICATED_SECTION");
      } else if (sectionContainsSiteFooter(owner)) throw new Error("BUILDER_SITE_FOOTER_POSITION_LOCKED");
      region.blocks.splice(operation.index ?? region.blocks.length, 0, createPrimitiveBlock(operation.block_type, operation.block_id, operation.content));
      break;
    }
    case "update_block_content": { const block = locateBlock(document, operation.block_id); if (!block) throw new Error("BUILDER_BLOCK_NOT_FOUND"); block.content = { ...block.content, ...clone(operation.changes) }; break; }
    case "update_block_style": { const block = locateBlock(document, operation.block_id); if (!block) throw new Error("BUILDER_BLOCK_NOT_FOUND"); block.style = mergeDefined(block.style || {}, operation.changes); if (!Object.keys(block.style).length) delete block.style; break; }
    case "reset_block_style": { const block = locateBlock(document, operation.block_id); if (!block) throw new Error("BUILDER_BLOCK_NOT_FOUND"); delete block.style; break; }
    case "update_block_responsive": { const block = locateBlock(document, operation.block_id); if (!block) throw new Error("BUILDER_BLOCK_NOT_FOUND"); block.responsive = { ...(block.responsive || {}), [operation.breakpoint]: mergeDefined(block.responsive?.[operation.breakpoint] || {}, operation.changes) }; break; }
    case "reset_block_responsive": { const block = locateBlock(document, operation.block_id); if (!block) throw new Error("BUILDER_BLOCK_NOT_FOUND"); if (block.responsive) { delete block.responsive[operation.breakpoint]; if (!Object.keys(block.responsive).length) delete block.responsive; } break; }
    case "update_section_responsive": { const section = document.sections.find((item) => item.id === operation.section_id); if (!section) throw new Error("BUILDER_SECTION_NOT_FOUND"); section.responsive = { ...(section.responsive || {}), [operation.breakpoint]: mergeDefined(section.responsive?.[operation.breakpoint] || {}, operation.changes) }; break; }
    case "reset_section_responsive": { const section = document.sections.find((item) => item.id === operation.section_id); if (!section) throw new Error("BUILDER_SECTION_NOT_FOUND"); if (section.responsive) { delete section.responsive[operation.breakpoint]; if (!Object.keys(section.responsive).length) delete section.responsive; } break; }
    case "move_block": {
      const source = document.sections.flatMap((section) => section.regions).find((region) => region.blocks.some((block) => block.id === operation.block_id));
      const target = locateRegion(document, operation.target_region_id);
      if (!source || !target) throw new Error("BUILDER_BLOCK_NOT_FOUND");
      const block = source.blocks.find((item) => item.id === operation.block_id);
      const targetOwner = document.sections.find((section) => section.regions.some((region) => region.id === target.id));
      if (block?.type === "site_footer" || sectionContainsSiteFooter(targetOwner)) throw new Error("BUILDER_SITE_FOOTER_POSITION_LOCKED");
      const index = source.blocks.findIndex((item) => item.id === operation.block_id);
      source.blocks.splice(index, 1);
      target.blocks.splice(operation.index ?? target.blocks.length, 0, block);
      break;
    }
    case "remove_block": {
      const footer = inspectSiteFooter(document);
      if (footer.location?.block.id === operation.block_id) {
        document.sections.splice(footer.location.sectionIndex, 1);
        break;
      }
      let removed = false;
      for (const region of document.sections.flatMap((section) => section.regions)) {
        const count = region.blocks.length;
        region.blocks = region.blocks.filter((block) => block.id !== operation.block_id);
        removed ||= region.blocks.length !== count;
      }
      if (!removed) throw new Error("BUILDER_BLOCK_NOT_FOUND");
      break;
    }
    case "update_page_tokens": document.settings.design_system = { ...document.settings.design_system, ...clone(operation.changes) }; break;
    default: throw new Error("BUILDER_OPERATION_INVALID");
  }
  return assertLandingDocument(enforceSiteFooterOrder(document));
}

export function applyLandingOperations(document, operations) {
  return operations.reduce(applyLandingOperation, document);
}

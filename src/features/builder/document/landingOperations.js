import { assertLandingDocument, createPrimitiveBlock } from "./landingDocument.js";

const clone = (value) => structuredClone(value);
const locateRegion = (document, regionId) => document.sections.flatMap((section) => section.regions).find((region) => region.id === regionId);
const locateBlock = (document, blockId) => document.sections.flatMap((section) => section.regions).flatMap((region) => region.blocks).find((block) => block.id === blockId);

export function applyLandingOperation(input, operation) {
  assertLandingDocument(input);
  const document = clone(input);
  switch (operation.type) {
    case "add_section": document.sections.splice(operation.index ?? document.sections.length, 0, clone(operation.section)); break;
    case "update_section": { const section = document.sections.find((item) => item.id === operation.section_id); if (!section) throw new Error("BUILDER_SECTION_NOT_FOUND"); Object.assign(section, clone(operation.changes)); break; }
    case "remove_section": { const count = document.sections.length; document.sections = document.sections.filter((item) => item.id !== operation.section_id); if (document.sections.length === count) throw new Error("BUILDER_SECTION_NOT_FOUND"); break; }
    case "add_block": { const region = locateRegion(document, operation.region_id); if (!region) throw new Error("BUILDER_REGION_NOT_FOUND"); region.blocks.splice(operation.index ?? region.blocks.length, 0, createPrimitiveBlock(operation.block_type, operation.block_id, operation.content)); break; }
    case "update_block_content": { const block = locateBlock(document, operation.block_id); if (!block) throw new Error("BUILDER_BLOCK_NOT_FOUND"); block.content = { ...block.content, ...clone(operation.changes) }; break; }
    case "update_block_style": { const block = locateBlock(document, operation.block_id); if (!block) throw new Error("BUILDER_BLOCK_NOT_FOUND"); block.style = { ...(block.style || {}), ...clone(operation.changes) }; break; }
    case "move_block": { const source = document.sections.flatMap((section) => section.regions).find((region) => region.blocks.some((block) => block.id === operation.block_id)); const target = locateRegion(document, operation.target_region_id); if (!source || !target) throw new Error("BUILDER_BLOCK_NOT_FOUND"); const index = source.blocks.findIndex((block) => block.id === operation.block_id); const [block] = source.blocks.splice(index, 1); target.blocks.splice(operation.index ?? target.blocks.length, 0, block); break; }
    case "remove_block": { let removed = false; for (const region of document.sections.flatMap((section) => section.regions)) { const count = region.blocks.length; region.blocks = region.blocks.filter((block) => block.id !== operation.block_id); removed ||= region.blocks.length !== count; } if (!removed) throw new Error("BUILDER_BLOCK_NOT_FOUND"); break; }
    case "update_page_tokens": document.settings.design_system = { ...document.settings.design_system, ...clone(operation.changes) }; break;
    default: throw new Error("BUILDER_OPERATION_INVALID");
  }
  return assertLandingDocument(document);
}

export function applyLandingOperations(document, operations) {
  return operations.reduce(applyLandingOperation, document);
}

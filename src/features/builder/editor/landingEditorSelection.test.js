import assert from "node:assert/strict";
import test from "node:test";
import {
  createBlockSelection,
  carryActionElementIds,
  createElementSelection,
  createGroupSelection,
  createSectionSelection,
  getActionElementId,
  getSelectionPath,
  reconcileBuilderSelection,
  resolveBuilderSelectionTarget,
  selectParent,
} from "./landingEditorSelection.js";
import {
  FOOTER_ELEMENT_TYPES,
  getFooterElementId,
  getFooterGroupElementId,
  getFooterLegalElementId,
  getFooterLinkElementId,
} from "./landingFooterEditing.js";
import { getHeaderElementId, getHeaderNavItemElementId } from "./landingHeaderEditing.js";

const actionA = { label: "Comenzar", href: "#" };
const actionB = { label: "Comenzar", href: "#" };
const footerGroup = {
  id: "empresa",
  title: "Empresa",
  links: [
    { id: "servicios", label: "Servicios", href: "#servicios", enabled: true },
    { id: "contacto", label: "Contacto", href: "#contacto", enabled: true },
  ],
};
const footerBlock = {
  id: "footer-1",
  type: "site_footer",
  content: {
    brand: { name: "ORVESEN", logo_url: "", logo_size: "md", tagline: "Inteligencia empresarial." },
    link_groups: [footerGroup],
    social_enabled: true,
    social: { variant: "icons", size: "md", gap: "md", align: "start", color: "text", links: [] },
    copyright: "Copyright ORVESEN",
    legal_links: [{ id: "privacidad", label: "Privacidad", href: "/privacidad", enabled: true }],
  },
};
const document = {
  sections: [{
    id: "section-1",
    regions: [{
      id: "region-1",
      blocks: [
        { id: "heading-1", type: "heading", content: { text: "Título" } },
        { id: "text-1", type: "text", content: { text: "Texto" } },
        { id: "actions-1", type: "action_group", content: { actions: [actionA, actionB] } },
        { id: "header-1", type: "site_header", content: { brand_name: "ORVESEN", logo_url: "", logo_size: "md", nav_items: [
          { label: "Oculto", href: "#oculto", enabled: false },
          { label: "Servicios", href: "#servicios", enabled: true },
          { id: "contacto", label: "Contacto", href: "#contacto", enabled: true },
        ], cta: { label: "Comenzar", href: "#contacto", enabled: true } } },
        footerBlock,
      ],
    }],
  }],
};

function node(level, dataset = {}, parent = null, control = false) {
  const current = {
    dataset: { selectionLevel: level, ...dataset },
    closest(selector) {
      if (selector === "[data-builder-editor-control]") return control ? current : parent?.closest(selector) || null;
      if (selector === "[data-builder-selectable][data-selection-level]") return current;
      if (selector === `[data-selection-level="${level}"]`) return current;
      return parent?.closest(selector) || null;
    },
  };
  return current;
}

const sectionNode = () => node("section", { sectionId: "section-1" });
const groupNode = () => node("group", { regionId: "region-1" }, sectionNode());
const blockNode = (blockId) => node("block", { blockId }, groupNode());
const headerSurfaceNode = () => node("section", {
  sectionId: "section-1",
  headerSurfaceBlockId: "header-1",
  headerSurfaceRegionId: "region-1",
});
const footerSurfaceNode = () => node("section", {
  sectionId: "section-1",
  footerSurfaceBlockId: "footer-1",
  footerSurfaceRegionId: "region-1",
});

test("resolver returns the most specific canonical section, group and block path", () => {
  assert.deepEqual(resolveBuilderSelectionTarget(sectionNode()), createSectionSelection("section-1"));
  assert.deepEqual(resolveBuilderSelectionTarget(groupNode()), createGroupSelection("section-1", "region-1"));
  assert.deepEqual(resolveBuilderSelectionTarget(blockNode("heading-1")), createBlockSelection("section-1", "region-1", "heading-1"));
  assert.deepEqual(resolveBuilderSelectionTarget(blockNode("text-1")), createBlockSelection("section-1", "region-1", "text-1"));
});

test("Actions background is a block while its exact Button is an element", () => {
  const block = blockNode("actions-1");
  const elementId = getActionElementId(actionA, "actions-1");
  const button = node("element", { blockId: "actions-1", elementId, elementType: "button" }, block);
  assert.deepEqual(resolveBuilderSelectionTarget(block), createBlockSelection("section-1", "region-1", "actions-1"));
  assert.deepEqual(resolveBuilderSelectionTarget(button), createElementSelection({ sectionId: "section-1", regionId: "region-1", blockId: "actions-1", elementId, elementType: "button" }));
});

test("Header background and Brand, Nav and CTA resolve to their exact hierarchy", () => {
  const block = blockNode("header-1");
  const brandId = getHeaderElementId("header-1", "brand");
  const navigationId = getHeaderElementId("header-1", "navigation");
  const ctaId = getHeaderElementId("header-1", "button");
  const brand = node("element", { blockId: "header-1", elementId: brandId, elementType: "brand" }, block);
  const navigation = node("element", { blockId: "header-1", elementId: navigationId, elementType: "navigation" }, block);
  const cta = node("element", { blockId: "header-1", elementId: ctaId, elementType: "button" }, block);

  assert.deepEqual(resolveBuilderSelectionTarget(block), createBlockSelection("section-1", "region-1", "header-1"));
  assert.deepEqual(resolveBuilderSelectionTarget(brand), createElementSelection({ sectionId: "section-1", regionId: "region-1", blockId: "header-1", elementId: brandId, elementType: "brand" }));
  assert.deepEqual(resolveBuilderSelectionTarget(navigation), createElementSelection({ sectionId: "section-1", regionId: "region-1", blockId: "header-1", elementId: navigationId, elementType: "navigation" }));
  assert.deepEqual(resolveBuilderSelectionTarget(cta), createElementSelection({ sectionId: "section-1", regionId: "region-1", blockId: "header-1", elementId: ctaId, elementType: "button" }));
  assert.equal(selectParent(resolveBuilderSelectionTarget(cta), document).blockId, "header-1");
});

test("the dedicated Header outer surface resolves to the Header block", () => {
  const surface = headerSurfaceNode();
  const background = {
    closest(selector) {
      if (selector === "[data-builder-editor-control]") return null;
      return surface.closest(selector);
    },
  };
  const expected = createBlockSelection("section-1", "region-1", "header-1");
  assert.deepEqual(resolveBuilderSelectionTarget(surface), expected);
  assert.deepEqual(resolveBuilderSelectionTarget(background), expected);
});

test("a click inside each Header child resolves the child instead of the outer Header surface", () => {
  const surface = headerSurfaceNode();
  const group = node("group", { regionId:"region-1" }, surface);
  const block = node("block", { blockId:"header-1" }, group);
  for (const elementType of ["brand", "navigation", "button"]) {
    const elementId = getHeaderElementId("header-1", elementType);
    const element = node("element", { blockId:"header-1", elementId, elementType }, block);
    const child = {
      closest(selector) {
        if (selector === "[data-builder-editor-control]") return null;
        return element.closest(selector);
      },
    };
    assert.deepEqual(
      resolveBuilderSelectionTarget(child),
      createElementSelection({ sectionId:"section-1", regionId:"region-1", blockId:"header-1", elementId, elementType }),
    );
  }
});

test("a Nav Item uses its original document index, does not bubble to Header and selects Nav as parent", () => {
  const header = document.sections[0].regions[0].blocks.find((block) => block.id === "header-1");
  const item = header.content.nav_items[1];
  const elementId = getHeaderNavItemElementId(item, header.id, 1);
  const surface = headerSurfaceNode();
  const group = node("group", { regionId: "region-1" }, surface);
  const block = node("block", { blockId: header.id }, group);
  const navigation = node("element", {
    blockId: header.id,
    elementId: getHeaderElementId(header.id, "navigation"),
    elementType: "navigation",
  }, block);
  const itemNode = node("element", { blockId: header.id, elementId, elementType: "nav_item" }, navigation);
  const selection = resolveBuilderSelectionTarget(itemNode);

  assert.deepEqual(selection, createElementSelection({
    sectionId: "section-1",
    regionId: "region-1",
    blockId: header.id,
    elementId,
    elementType: "nav_item",
  }));
  assert.deepEqual(selectParent(selection, document), createElementSelection({
    sectionId: "section-1",
    regionId: "region-1",
    blockId: header.id,
    elementId: getHeaderElementId(header.id, "navigation"),
    elementType: "navigation",
  }));
  assert.equal(getSelectionPath(selection, document).at(-1).elementId, elementId);
});

test("Footer background and every supported child resolve to their granular target", () => {
  const block = blockNode(footerBlock.id);
  const navigationId = getFooterElementId(footerBlock.id, FOOTER_ELEMENT_TYPES.navigation);
  const navigation = node("element", {
    elementId: navigationId,
    elementType: FOOTER_ELEMENT_TYPES.navigation,
  }, block);
  const groupId = getFooterGroupElementId(footerGroup, footerBlock.id, 0);
  const group = node("element", {
    elementId: groupId,
    elementType: FOOTER_ELEMENT_TYPES.linkGroup,
  }, navigation);
  const link = footerGroup.links[0];
  const linkId = getFooterLinkElementId(link, footerGroup, footerBlock.id, 0, 0);
  const linkNode = node("element", {
    elementId: linkId,
    elementType: FOOTER_ELEMENT_TYPES.linkItem,
  }, group);
  const bottomId = getFooterElementId(footerBlock.id, FOOTER_ELEMENT_TYPES.bottom);
  const bottom = node("element", {
    elementId: bottomId,
    elementType: FOOTER_ELEMENT_TYPES.bottom,
  }, block);
  const legal = footerBlock.content.legal_links[0];
  const legalId = getFooterLegalElementId(legal, footerBlock.id, 0);
  const legalNode = node("element", {
    elementId: legalId,
    elementType: FOOTER_ELEMENT_TYPES.legalItem,
  }, bottom);

  assert.deepEqual(resolveBuilderSelectionTarget(block), createBlockSelection("section-1", "region-1", footerBlock.id));
  for (const elementType of [FOOTER_ELEMENT_TYPES.brand, FOOTER_ELEMENT_TYPES.social]) {
    const elementId = getFooterElementId(footerBlock.id, elementType);
    assert.deepEqual(
      resolveBuilderSelectionTarget(node("element", { elementId, elementType }, block)),
      createElementSelection({ sectionId:"section-1", regionId:"region-1", blockId:footerBlock.id, elementId, elementType }),
    );
  }
  assert.equal(resolveBuilderSelectionTarget(navigation).elementId, navigationId);
  assert.equal(resolveBuilderSelectionTarget(group).elementId, groupId);
  assert.equal(resolveBuilderSelectionTarget(linkNode).elementId, linkId);
  assert.equal(resolveBuilderSelectionTarget(bottom).elementId, bottomId);
  assert.equal(resolveBuilderSelectionTarget(legalNode).elementId, legalId);
});

test("Footer selection paths expose Navigation, Link Group and Bottom as real parents", () => {
  const groupId = getFooterGroupElementId(footerGroup, footerBlock.id, 0);
  const linkId = getFooterLinkElementId(footerGroup.links[0], footerGroup, footerBlock.id, 0, 0);
  const linkSelection = createElementSelection({
    sectionId:"section-1",
    regionId:"region-1",
    blockId:footerBlock.id,
    elementId:linkId,
    elementType:FOOTER_ELEMENT_TYPES.linkItem,
  });
  const linkPath = getSelectionPath(linkSelection, document);
  assert.deepEqual(linkPath.map((item) => item.level), ["section", "group", "block", "element", "element", "element"]);
  assert.deepEqual(linkPath.slice(3).map((item) => item.elementType), [
    FOOTER_ELEMENT_TYPES.navigation,
    FOOTER_ELEMENT_TYPES.linkGroup,
    FOOTER_ELEMENT_TYPES.linkItem,
  ]);
  assert.equal(selectParent(linkSelection, document).elementId, groupId);
  assert.equal(selectParent(selectParent(linkSelection, document), document).elementType, FOOTER_ELEMENT_TYPES.navigation);

  const legal = footerBlock.content.legal_links[0];
  const legalSelection = createElementSelection({
    sectionId:"section-1",
    regionId:"region-1",
    blockId:footerBlock.id,
    elementId:getFooterLegalElementId(legal, footerBlock.id, 0),
    elementType:FOOTER_ELEMENT_TYPES.legalItem,
  });
  assert.deepEqual(getSelectionPath(legalSelection, document).slice(3).map((item) => item.elementType), [
    FOOTER_ELEMENT_TYPES.bottom,
    FOOTER_ELEMENT_TYPES.legalItem,
  ]);
  assert.equal(selectParent(legalSelection, document).elementType, FOOTER_ELEMENT_TYPES.bottom);

  for (const elementType of [FOOTER_ELEMENT_TYPES.brand, FOOTER_ELEMENT_TYPES.navigation, FOOTER_ELEMENT_TYPES.social, FOOTER_ELEMENT_TYPES.bottom]) {
    const selection = createElementSelection({
      sectionId:"section-1",
      regionId:"region-1",
      blockId:footerBlock.id,
      elementId:getFooterElementId(footerBlock.id, elementType),
      elementType,
    });
    assert.equal(selectParent(selection, document).level, "block");
  }
});

test("Footer elements that disappear or become disabled fall back safely to their block", () => {
  const link = footerGroup.links[0];
  const linkSelection = createElementSelection({
    sectionId:"section-1",
    regionId:"region-1",
    blockId:footerBlock.id,
    elementId:getFooterLinkElementId(link, footerGroup, footerBlock.id, 0, 0),
    elementType:FOOTER_ELEMENT_TYPES.linkItem,
  });
  const disabledLink = structuredClone(document);
  disabledLink.sections[0].regions[0].blocks.find((block) => block.id === footerBlock.id).content.link_groups[0].links[0].enabled = false;
  assert.deepEqual(reconcileBuilderSelection(linkSelection, disabledLink), createBlockSelection("section-1", "region-1", footerBlock.id));

  const withoutLink = structuredClone(document);
  withoutLink.sections[0].regions[0].blocks.find((block) => block.id === footerBlock.id).content.link_groups[0].links.shift();
  assert.deepEqual(reconcileBuilderSelection(linkSelection, withoutLink), createBlockSelection("section-1", "region-1", footerBlock.id));

  const socialSelection = createElementSelection({
    sectionId:"section-1",
    regionId:"region-1",
    blockId:footerBlock.id,
    elementId:getFooterElementId(footerBlock.id, FOOTER_ELEMENT_TYPES.social),
    elementType:FOOTER_ELEMENT_TYPES.social,
  });
  const withoutSocial = structuredClone(document);
  withoutSocial.sections[0].regions[0].blocks.find((block) => block.id === footerBlock.id).content.social_enabled = false;
  assert.deepEqual(reconcileBuilderSelection(socialSelection, withoutSocial), createBlockSelection("section-1", "region-1", footerBlock.id));
});

test("the dedicated Footer outer surface can resolve directly to the Footer block", () => {
  assert.deepEqual(
    resolveBuilderSelectionTarget(footerSurfaceNode()),
    createBlockSelection("section-1", "region-1", footerBlock.id),
  );
});

test("a removed or disabled Nav Item falls back safely to its Header block", () => {
  const header = document.sections[0].regions[0].blocks.find((block) => block.id === "header-1");
  const item = header.content.nav_items[2];
  const selection = createElementSelection({
    sectionId: "section-1",
    regionId: "region-1",
    blockId: header.id,
    elementId: getHeaderNavItemElementId(item, header.id, 2),
    elementType: "nav_item",
  });
  const disabled = structuredClone(document);
  disabled.sections[0].regions[0].blocks.find((block) => block.id === header.id).content.nav_items[2].enabled = false;
  assert.deepEqual(reconcileBuilderSelection(selection, disabled), createBlockSelection("section-1", "region-1", header.id));
  const removed = structuredClone(document);
  removed.sections[0].regions[0].blocks.find((block) => block.id === header.id).content.nav_items.splice(2, 1);
  assert.deepEqual(reconcileBuilderSelection(selection, removed), createBlockSelection("section-1", "region-1", header.id));
});

test("disabled Header CTA falls back to Header while Brand and Nav remain stable", () => {
  const cta = createElementSelection({ sectionId: "section-1", regionId: "region-1", blockId: "header-1", elementId: getHeaderElementId("header-1", "button"), elementType: "button" });
  const withoutCta = structuredClone(document);
  withoutCta.sections[0].regions[0].blocks.find((block) => block.id === "header-1").content.cta.enabled = false;
  assert.deepEqual(reconcileBuilderSelection(cta, withoutCta), createBlockSelection("section-1", "region-1", "header-1"));

  for (const elementType of ["brand", "navigation"]) {
    const selection = createElementSelection({ sectionId: "section-1", regionId: "region-1", blockId: "header-1", elementId: getHeaderElementId("header-1", elementType), elementType });
    assert.deepEqual(reconcileBuilderSelection(selection, withoutCta), selection);
  }
});

test("legacy Buttons receive unique stable session identities without mutating JSON", () => {
  const before = JSON.stringify(document);
  const first = getActionElementId(actionA, "actions-1");
  assert.equal(getActionElementId(actionA, "actions-1"), first);
  assert.notEqual(getActionElementId(actionB, "actions-1"), first);
  assert.equal(JSON.stringify(document), before);
});

test("legacy Button identity survives immutable edits without entering the document", () => {
  const previous = structuredClone(document);
  const before = JSON.stringify(previous);
  const action = previous.sections[0].regions[0].blocks[2].content.actions[0];
  const elementId = getActionElementId(action, "actions-1");
  const next = structuredClone(previous);
  next.sections[0].regions[0].blocks[2].content.actions[0].label = "Continuar";
  carryActionElementIds(previous, next);
  assert.equal(getActionElementId(next.sections[0].regions[0].blocks[2].content.actions[0], "actions-1"), elementId);
  assert.equal(JSON.stringify(previous), before);
  assert.equal("id" in next.sections[0].regions[0].blocks[2].content.actions[0], false);
});

test("duplicating a legacy Button preserves the original session identity and gives the copy its own", () => {
  const previous = structuredClone(document);
  previous.sections[0].regions[0].blocks[2].content.actions = [structuredClone(actionA)];
  const previousAction = previous.sections[0].regions[0].blocks[2].content.actions[0];
  const originalId = getActionElementId(previousAction, "actions-1");
  const next = structuredClone(previous);
  next.sections[0].regions[0].blocks[2].content.actions.push(structuredClone(previousAction));
  carryActionElementIds(previous, next);
  const [original, copy] = next.sections[0].regions[0].blocks[2].content.actions;
  assert.equal(getActionElementId(original, "actions-1"), originalId);
  assert.notEqual(getActionElementId(copy, "actions-1"), originalId);
  assert.equal("id" in original || "id" in copy, false);
});

test("selection path and parent traversal follow Section > Group > Block > Element", () => {
  const element = createElementSelection({ sectionId: "section-1", regionId: "region-1", blockId: "actions-1", elementId: getActionElementId(actionA, "actions-1"), elementType: "button" });
  assert.deepEqual(getSelectionPath(element, document).map((item) => item.level), ["section", "group", "block", "element"]);
  const block = selectParent(element, document);
  assert.equal(block.level, "block");
  assert.equal(selectParent(block, document).level, "group");
  assert.equal(selectParent(selectParent(block, document), document).level, "section");
  assert.equal(selectParent(createSectionSelection("section-1"), document), null);
});

test("editor and insertion controls are ignored instead of clearing selection", () => {
  assert.equal(resolveBuilderSelectionTarget(node("block", { blockId: "actions-1" }, groupNode(), true)), undefined);
  assert.equal(resolveBuilderSelectionTarget(null), null);
});

test("viewport-safe reconciliation preserves valid targets and refreshes moved ancestry", () => {
  const selected = createBlockSelection("section-1", "region-1", "heading-1");
  assert.deepEqual(reconcileBuilderSelection(selected, document), selected);
  const moved = structuredClone(document);
  moved.sections[0].regions.push({ id: "region-2", blocks: [moved.sections[0].regions[0].blocks.shift()] });
  assert.deepEqual(reconcileBuilderSelection(selected, moved), createBlockSelection("section-1", "region-2", "heading-1"));
});

test("removed element falls back to its Actions block and removed block to its Group", () => {
  const element = createElementSelection({ sectionId: "section-1", regionId: "region-1", blockId: "actions-1", elementId: getActionElementId(actionB, "actions-1"), elementType: "button" });
  const withoutButton = { sections: [{ ...document.sections[0], regions: [{ ...document.sections[0].regions[0], blocks: document.sections[0].regions[0].blocks.map((block) => block.id === "actions-1" ? { ...block, content: { actions: [actionA] } } : block) }] }] };
  assert.deepEqual(reconcileBuilderSelection(element, withoutButton), createBlockSelection("section-1", "region-1", "actions-1"));
  const withoutBlock = { sections: [{ ...document.sections[0], regions: [{ ...document.sections[0].regions[0], blocks: document.sections[0].regions[0].blocks.filter((block) => block.id !== "actions-1") }] }] };
  assert.deepEqual(reconcileBuilderSelection(element, withoutBlock), createGroupSelection("section-1", "region-1"));
});

test("an unsupported internal element type falls back to its valid Block", () => {
  const selection = createElementSelection({ sectionId: "section-1", regionId: "region-1", blockId: "actions-1", elementId: getActionElementId(actionA, "actions-1"), elementType: "form-field" });
  assert.deepEqual(reconcileBuilderSelection(selection, document), createBlockSelection("section-1", "region-1", "actions-1"));
});

test("a Pattern child resolves through its actual section and group hierarchy", () => {
  const child = blockNode("heading-1");
  const selection = resolveBuilderSelectionTarget(child);
  assert.deepEqual(getSelectionPath(selection, document).map((item) => item.level), ["section", "group", "block"]);
});

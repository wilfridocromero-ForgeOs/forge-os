import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const read = (name) => readFile(new URL(name, import.meta.url), "utf8");

test("visual editor exposes empty canvas, palette, patterns and responsive previews", async () => {
  const source = await read("./LandingPageEditor.jsx");
  for (const contract of ["Comienza tu p", "Heading", "Text", "Image", "Actions", "Form", "Logo", "Feature", "Stat", "Testimonial", "Video", "Pricing", "FAQ", "Social", "Desktop", "Tablet", "Mobile"]) assert.match(source, new RegExp(contract));
  assert.match(source, /LANDING_PATTERN_CATALOG/);
  assert.match(source, /createLandingPattern/);
});

test("visual controls route breakpoint presentation changes away from desktop base", async () => {
  const source = await read("./LandingPageEditor.jsx");
  assert.match(source, /preview=\{state\.preview\}/);
  assert.match(source, /RESPONSIVE_BLOCK_STYLE_KEYS/);
  assert.match(source, /type:"update_block_responsive"/);
  assert.match(source, /breakpoint:preview/);
  assert.match(source, /preview === "desktop"/);
  assert.match(source, /type:"update_section_responsive"/);
  assert.match(source, /preview !== "desktop" && key === "align"/);
});

test("inspector and save UX cover Forms, conflict and structural controls", async () => {
  const source = await read("./LandingPageEditor.jsx");
  const renderer = await read("../renderer/LandingRenderer.jsx");
  for (const contract of ["form_reference", "Recargar versi", "Copiar cambios locales", "Reintentar guardado", "Duplicar", "Eliminar", "Subir", "Bajar"]) assert.match(source, new RegExp(contract));
  assert.match(source, /listBuilderAssets\(\{ assetType: "form", includeArchived: false \}\)/);
  assert.match(renderer, /data-block-id/);
  assert.match(renderer, /data-section-id/);
});

test("mobile editor uses horizontal add controls and a properties bottom sheet", async () => {
  const source = await read("./LandingPageEditor.jsx");
  const styles = await read("./LandingEditor.css");
  assert.match(styles, /@media\(max-width:900px\)/);
  assert.match(styles, /\.landing-palette\{display:flex;overflow-x:auto/);
  assert.match(styles, /\.landing-inspector\{position:fixed/);
  assert.doesNotMatch(styles, /overflow-x:visible/);
  assert.match(source, /beginMobilePlacement\(\{ kind: "palette-block", id: type, label \}\)/);
  assert.match(source, /beginMobilePlacement\(\{ kind: "palette-pattern", id: item\.id, label: item\.label \}\)/);
  assert.match(source, /pendingInsert \? <button type="button" className="landing-empty-place"/);
  assert.match(source, /\{!pendingInsert && <nav className="landing-mobile-context"/);
  assert.match(source, /has-context-toolbar/);
  assert.match(styles, /\.landing-editor\.has-context-toolbar \.landing-canvas-shell/);
  assert.match(styles, /\.landing-editor\.is-mobile-placing \.landing-mobile-placement-bar\{bottom:/);
  const toolbarStyles = await read("./BuilderContextToolbarV12.css");
  assert.match(toolbarStyles, /max-width:calc\(100vw - 1\.1rem\)!important/);
  assert.match(toolbarStyles, /overflow-x:auto!important/);
  assert.match(toolbarStyles, /overflow-y:hidden!important/);
  assert.match(toolbarStyles, /\.landing-element-toolbar-v3>\*\{flex:0 0 auto\}/);
});

test("properties use accessible native accordion groups and schema-backed Button surfaces", async () => {
  const source = await read("./LandingPageEditor.jsx");
  const styles = await read("./LandingEditor.css");
  for (const label of ["Content", "Appearance", "Responsive", "ButtonDesignInspector", "Primary", "Secondary", "Outline", "Ghost", "Gradient", "Glass", "Soft", "Elevated"]) assert.match(source, new RegExp(label));
  assert.match(source, /<details className="landing-inspector-accordion"/);
  assert.match(source, /<summary>/);
  assert.match(styles, /summary:focus-visible/);
});

test("contextual toolbar keeps destructive and quick-edit actions available", async () => {
  const source = await read("./LandingPageEditor.jsx");
  const styles = await read("./BuilderContextToolbarV12.css");
  for (const contract of ["toolbarDeleteNeedsConfirmation", "Eliminar Header", "FormQuickEditor", "saveBuilderFormDraft", "spacer-size", "header-nav", "section-anchor", "line_height", "letter_spacing"]) assert.match(source, new RegExp(contract));
  assert.match(source, /data-controls=\{declaredControls\.join/);
  assert.match(styles, /landing-form-quick-editor/);
  assert.match(styles, /width:max-content!important/);
  assert.match(styles, /overflow-x:auto!important/);
  assert.match(styles, /@media\(max-width:900px\).*overflow-x:auto/s);
});

test("floating quick panels use measured visual viewport containment", async () => {
  const source = await read("./LandingPageEditor.jsx");
  const styles = await read("./BuilderContextToolbarV12.css");
  assert.match(source, /constrainFloatingPanel/);
  assert.match(source, /getFloatingViewport\(window\.visualViewport/);
  assert.match(source, /panelRef\.current\?\.getBoundingClientRect/);
  assert.match(source, /visualViewport/);
  assert.doesNotMatch(source, /window\.innerWidth - 372/);
  assert.doesNotMatch(source, /window\.innerHeight - 160/);
  assert.match(source, /className="landing-floating-panel"/);
  assert.doesNotMatch(source, /className="[^"]*landing-quick-portal-panel[^"]*landing-floating-panel/);
  assert.match(source, /<div className="landing-floating-panel-content">\{children\}<\/div>/);
  assert.match(styles, /\.landing-floating-panel-content\{[^}]*min-height:0[^}]*overflow:auto/);
  assert.match(styles, /\.landing-floating-panel :is\(button,input,select,textarea\)\{color:inherit\}/);
  assert.match(styles, /\.landing-floating-panel\{[^}]*width:max-content[^}]*max-width:min\(360px,calc\(100vw - 24px\)\)/);
});

test("context toolbar is intrinsic, viewport-clamped and scrolls internally", async () => {
  const styles = await read("./BuilderContextToolbarV12.css");
  assert.match(styles, /\.landing-element-toolbar-v3\{[^}]*width:max-content!important/);
  assert.match(styles, /\.landing-element-toolbar-v3\{[^}]*max-width:min\(calc\(100% - 1\.25rem\),880px\)!important/);
  assert.match(styles, /\.landing-element-toolbar-v3\{[^}]*overflow-x:auto!important[^}]*overflow-y:hidden!important/);
  assert.doesNotMatch(styles, /\.landing-element-toolbar-v3\{[^}]*overflow:visible!important/);
});

test("page frame remains centered and renderer fills it independently from sidebar width", async () => {
  const styles = await readFile(new URL("./LandingEditor.css", import.meta.url), "utf8");
  assert.match(styles, /\.landing-editor-body\{[^}]*grid-template-columns:13rem minmax\(0,1fr\)/);
  assert.match(styles, /\.landing-canvas-shell\{[^}]*min-width:0[^}]*overflow:auto/);
  assert.match(styles, /\.landing-viewport\{[^}]*width:min\(100%,(?:1280|1320)px\)[^}]*margin:0 auto/);
  assert.match(styles, /\.landing-page-frame\{[^}]*width:100%/);
  assert.match(styles, /\.landing-page-frame>.landing-renderer\{width:100%!important;min-width:0!important\}/);
});

test("connected Form edits validate before optimistic state or RPC persistence", async () => {
  const source = await readFile(new URL("./LandingPageEditor.jsx", import.meta.url), "utf8");
  const validationIndex = source.indexOf("const formValidation = validateFormDocument(document)");
  const optimisticIndex = source.indexOf("setForms((items) => items.map", validationIndex);
  const rpcIndex = source.indexOf("saveBuilderFormDraft({", validationIndex);
  assert.ok(validationIndex > -1 && validationIndex < optimisticIndex && optimisticIndex < rpcIndex);
  assert.match(source, /changeFormFieldType\(item,event\.target\.value\)/);
});

test("primary toolbar popovers retain their option content", async () => {
  const source = await read("./LandingPageEditor.jsx");
  for (const id of ["width", "spacing", "font", "weight", "color", "appearance", "form-connect", "form-fields", "form-design", "header-layout", "header-nav", "header-cta", "header-appearance", "more"]) {
    assert.match(source, new RegExp(`id="${id}"`));
  }
  assert.match(source, /\[\["narrow","50%"\],\["standard","75%"\],\["wide","90%"\],\["none","100%"\]\]/);
  assert.match(source, /id="width"[\s\S]*?<div className="landing-option-grid">/);
  assert.match(source, /id="form-fields"[\s\S]*?<FormQuickEditor/);
  assert.match(source, /id="header-layout"[\s\S]*?<HeaderLayoutPanel/);
});

test("editor leaves only after autosave flush confirms persistence", async () => {
  const source = await read("./LandingPageEditor.jsx");
  assert.match(source, /const saved = await autosaveRef\.current\?\.flush\(\)/);
  assert.match(source, /if \(saved === false\)/);
  assert.match(source, /Reintenta antes de salir/);
  assert.match(source, /onSaved: \(revision, document\) => \{ if \(!active\) return; setError\(\(current\) => current === autosaveErrorRef\.current/);
});

test("canvas delegates hierarchical selection, ignores editor controls and deselects outside", async () => {
  const source = await read("./LandingPageEditor.jsx");
  assert.match(source, /resolveBuilderSelectionTarget\(event\.target\)/);
  assert.match(source, /if \(selection === undefined\) return/);
  assert.match(source, /closest\?\.\("\.landing-page-frame"\)/);
  assert.match(source, /dispatch\(\{ type: "select", selection: null \}\)/);
  assert.doesNotMatch(source, /event\.target\.closest\("button"\) \|\| event\.target\.closest\("\[data-edit-field\]"\)/);
});

test("Button element context exposes focused UX and returns to its Actions parent", async () => {
  const source = await read("./LandingPageEditor.jsx");
  assert.match(source, /selection\.level === "element"/);
  assert.match(source, /id="button-text"/);
  assert.match(source, /id="button-action"/);
  assert.match(source, /id="button-more"/);
  assert.match(source, />Diseño<\/button>/);
  assert.match(source, /aria-label="Seleccionar grupo Actions">↑/);
  assert.doesNotMatch(source, />Editar Actions</);
  assert.match(source, /onSelectParent=\{\(\) => dispatch\(\{ type: "select", selection: selectParent/);
  assert.match(source, /descriptor\.selection \|\| \{ kind: "block"/);
  assert.match(source, /const descriptor = \{ blockId: block\.id, field, index, selection \}/);
  assert.match(source, /if \(state\?\.dirty\) autosaveRef\.current\?\.schedule/);
  assert.match(source, /\}, \[state\?\.dirty, state\?\.document\]\);/);
  assert.doesNotMatch(source, /if \(state\?\.dirty\)[^\n]*\}, \[state\]\)/);
});

test("Button and Actions use separate property surfaces", async () => {
  const source = await read("./LandingPageEditor.jsx");
  assert.match(source, /function ButtonDesignInspector/);
  assert.match(source, /Estos controles modifican únicamente el botón seleccionado/);
  assert.match(source, /Aquí se configura únicamente el layout de Actions/);
  assert.match(source, /updateButtonAtIndex\(actions, actionIndex, changes\)/);
  assert.match(source, /resetButtonDesign\(actions, actionIndex\)/);
  assert.doesNotMatch(source, /function ActionControls/);
  assert.doesNotMatch(source, /function ActionSurfacePresets/);
});

test("floating Button panels share outside-click and two-step Escape dismissal", async () => {
  const source = await read("./LandingPageEditor.jsx");
  assert.match(source, /registerBuilderDismissableLayer/);
  assert.match(source, /data-builder-dismiss-layer=\{BUILDER_CONTEXT_LAYER\}/);
  assert.match(source, /data-builder-dismiss-layer=\{BUILDER_INSPECTOR_LAYER\}/);
  assert.match(source, /else if \(panelOpen\) setPanelOpen\(false\); else dispatch\(\{ type: "select", selection: null \}\)/);
});

test("Header toolbar separates layout, content, appearance and secondary behavior without duplicate surfaces", async () => {
  const source = await read("./LandingPageEditor.jsx");
  const start = source.indexOf('if (block.type === "site_header")');
  const end = source.indexOf('if (block.type === "spacer")', start);
  const headerToolbar = source.slice(start, end);
  assert.ok(start > -1 && end > start);
  for (const id of ["header-layout", "header-brand", "header-nav", "header-cta", "header-appearance", "header-more"]) assert.match(headerToolbar, new RegExp(`id="${id}"`));
  assert.doesNotMatch(headerToolbar, /id="header-preset"|id="header-surface"|\{appearanceControls\}/);
  assert.match(headerToolbar, /Mantener Header sticky/);
  assert.match(headerToolbar, /aria-label="Seleccionar grupo">↑/);
  assert.match(source, /!\["site_header", "site_footer"\]\.includes\(target\?\.block\?\.type\)/);
  assert.match(source, /case "site_header": return null/);
  assert.doesNotMatch(source, /\[\["logo_nav_cta","Logo \+ navegación \+ CTA"\][\s\S]*\["transparent","Transparent"\]/);
});

test("Header presets use persisted state and keep structural and appearance resets distinct", async () => {
  const source = await read("./LandingPageEditor.jsx");
  assert.match(source, /data-preset-state=\{linked \? "preset" : "custom"\}/);
  assert.match(source, /const legacy = Boolean\(activePreset && !linked\)/);
  assert.match(source, />Desvincular<\/button>/);
  assert.match(source, />Quitar preset<\/button>/);
  assert.match(source, />Restablecer estructura<\/button>/);
  assert.match(source, />Restablecer apariencia<\/button>/);
  assert.match(source, /customizeAppearance\(value, changes\)/);
  assert.match(source, /if \(content\.preset !== "custom"\) onContentChange\(\{preset:"custom"\}, "header-layout-custom"\)/);
  assert.match(source, /if \(appearance\.preset\) onAppearanceChange\(detachAppearancePreset\(appearance\)\)/);
  assert.match(source, /onContentChange\(removeHeaderPreset\(content\), "header-layout-custom"\)/);
  assert.doesNotMatch(source, /headerLayoutDetached|onHeaderLayoutBindingChange/);
});

test("Header child selection has focused Brand, Nav, Nav Item and CTA controls", async () => {
  const source = await read("./LandingPageEditor.jsx");
  for (const id of ["header-child-brand", "header-child-nav-style", "header-child-nav", "header-nav-item-content", "header-nav-item-design", "header-nav-item-more", "header-child-cta-text", "header-child-cta-action"]) assert.match(source, new RegExp(`id="${id}"`));
  assert.match(source, /selected\.block\?\.type === "site_header"/);
  assert.match(source, /aria-label=\{`Seleccionar \$\{parentLabel\}`\}/);
  assert.match(source, /common\("Nav"\)/);
  assert.match(source, />Restablecer al estilo del Nav<\/button>/);
  assert.match(source, /selected\.block\?\.type !== "site_header" && selection\.elementType === "button"/);
});

test("Header Nav editors separate global styling from partial item overrides", async () => {
  const source = await read("./LandingPageEditor.jsx");
  assert.match(source, /data-style-scope=\{itemOverride \? "item" : "global"\}/);
  assert.match(source, /itemOverride && <option value="">Heredar del Nav<\/option>/);
  assert.match(source, /updateHeaderNavStyle\(content, changes\)/);
  assert.match(source, /updateHeaderNavItemStyle\(content, item\.id, changes, itemIndex\)/);
  assert.match(source, /resetHeaderNavItemStyle\(content, item\.id, itemIndex\)/);
  assert.match(source, /item\.href\?\.startsWith\("mailto:"\)/);
  assert.match(source, /item\.href\?\.startsWith\("tel:"\)/);
  assert.match(source, /id:`nav-\$\{createBuilderId\(\)\}`/);
});

test("Header appearance keeps the structural Section separate from the inner container", async () => {
  const source = await read("./LandingPageEditor.jsx");
  assert.match(source, /Superficie exterior · Section/);
  assert.match(source, /Contenedor interno · Header/);
  assert.match(source, /type:"update_section_style", section_id:selected\.section\.id/);
  assert.match(source, /type:"update_block_style", block_id:block\.id/);
  assert.match(source, /Ancho del contenedor interno/);
});

test("Builder floating panel choices remain legible before hover and expose selected and disabled states", async () => {
  const styles = await read("./BuilderContextToolbarV12.css");
  assert.match(styles, /\.landing-floating-panel\{[^}]*--le-text:#f5f5f4/);
  assert.match(styles, /\.landing-floating-panel option\{[^}]*background:#17181c[^}]*color:#f5f5f4/);
  assert.match(styles, /\.landing-floating-panel[^}]*button:disabled[^}]*opacity:/);
  assert.match(styles, /\.landing-floating-panel[^}]*\.is-active/);
});

test("Header controls reuse the shared dismissable floating layer and stay reachable on mobile", async () => {
  const source = await read("./LandingPageEditor.jsx");
  const styles = await read("./BuilderContextToolbarV12.css");
  for (const id of ["header-layout", "header-brand", "header-nav", "header-cta", "header-appearance", "header-more"]) {
    assert.match(source, new RegExp(`<QuickPopover id="${id}"`));
  }
  assert.match(source, /data-builder-dismiss-layer=\{BUILDER_CONTEXT_LAYER\}/);
  assert.match(source, /setOpenMenu\(open \? null : id\)/);
  assert.match(source, /menuState\.selectionIdentity === selectionIdentity \? menuState\.id : null/);
  assert.match(styles, /landing-header-toolbar>\.landing-quick-icon,\.landing-header-child-toolbar>\.landing-quick-icon\{display:grid!important\}/);
  assert.match(styles, /max-width:calc\(100vw - 1\.1rem\)!important/);
  assert.match(styles, /\.landing-header-nav-style-editor\{width:min\(21rem,calc\(100vw - 3\.5rem\)\)\}/);
  assert.match(styles, /@media\(max-width:720px\)\{\.landing-header-nav-style-editor\{width:auto\}\.landing-header-nav-style-grid\{grid-template-columns:1fr\}\}/);
});

test("Footer V1 is available from the palette and owns one contextual editing surface", async () => {
  const source = await read("./LandingPageEditor.jsx");
  assert.match(source, /type: "site_footer", label: "Footer"/);
  const start = source.indexOf('if (block.type === "site_footer")');
  const end = source.indexOf('if (block.type === "spacer")', start);
  const footerToolbar = source.slice(start, end);
  assert.ok(start > -1 && end > start);
  for (const id of ["footer-layout", "footer-brand", "footer-links", "footer-social", "footer-appearance", "footer-more"]) assert.match(footerToolbar, new RegExp(`id="${id}"`));
  assert.match(footerToolbar, /landing-footer-toolbar/);
  assert.match(footerToolbar, /<span className="landing-quick-kind">Footer<\/span>/);
  assert.match(footerToolbar, /<span>Layout<\/span>/);
  assert.match(footerToolbar, /<span>Marca<\/span>/);
  assert.match(footerToolbar, /<span>Links<\/span>/);
  assert.match(footerToolbar, /<span>Social<\/span>/);
  assert.match(footerToolbar, /<span>Apariencia<\/span>/);
  assert.match(source, /case "site_footer": return null/);
});

test("Footer V1 editors cover presets, content, links, social, bottom and granular contexts", async () => {
  const source = await read("./LandingPageEditor.jsx");
  for (const contract of [
    "FOOTER_LAYOUT_PRESETS",
    "applyFooterLayoutPreset",
    "getFooterPresetBlockStyle",
    "FooterBrandEditor",
    "FooterLinksEditor",
    "addFooterLink",
    "removeFooterLink",
    "moveFooterLink",
    "FooterSocialEditor",
    "FooterBottomEditor",
    "FooterAppearanceEditor",
    "social_enabled",
    "legal_links",
    "copyright",
  ]) assert.match(source, new RegExp(contract));
  for (const elementType of ["brand", "navigation", "linkGroup", "linkItem", "social", "bottom", "legalItem"]) assert.match(source, new RegExp(`FOOTER_ELEMENT_TYPES\\.${elementType}`));
  assert.match(source, /type:"update_block_content",block_id:block\.id/);
  assert.match(source, /type:"update_block_style",block_id:block\.id/);
  assert.match(source, /type:"update_section_style",section_id:selected\.section\.id/);
});

test("editor insertion routes treat the unique Footer as the final structural boundary", async () => {
  const source = await read("./LandingPageEditor.jsx");
  assert.match(source, /if \(type === "site_footer"\)/);
  assert.match(source, /if \(inspectSiteFooter\(current\)\.count\) return/);
  assert.match(source, /createPattern\("footer_simple"\)/);
  assert.match(source, /if \(sectionContainsSiteFooter\(targetSection\)\) targetRegion = null/);
  assert.match(source, /if \(sectionContainsSiteFooter\(section\) && inspectSiteFooter\(current\)\.count\) return/);
  assert.match(source, /applyLandingDrop\(current,payload,target,\{createId:createBuilderId\}\)/);
  assert.match(source, /const targetRegionId = sectionContainsSiteFooter\(targetSection\) \? null : regionId/);
  assert.match(source, /if \(next !== state\.document\) replace\(next,"move"\)/);
  assert.match(source, /if \(next !== state\.document\) replace\(next,"duplicate"\)/);
  // The drop path resolves against the live editor document and applies the
  // deterministic resolver decision, never the document captured by the handler.
  assert.match(source, /const current = stateRef\.current\?\.document \|\| state\.document/);
  assert.match(source, /const decision = resolveLandingDrop\(current, payload, target, \{ createPattern \}\)/);
  assert.match(source, /else if \(decision\.document !== current\) replace\(decision\.document, "drag"\)/);
  assert.doesNotMatch(source, /replace\(next,"drag"\)/);
  const start = source.indexOf('if (block.type === "site_footer")');
  const end = source.indexOf('if (block.type === "spacer")',start);
  const footerToolbar = source.slice(start,end);
  assert.doesNotMatch(footerToolbar,/Duplicar Footer|Mover arriba|Mover abajo/);
  assert.match(footerToolbar,/permanece siempre al final y no puede duplicarse/);
});

test("terminal Footer makes the editor frame intrinsic and removes the synthetic page tail", async () => {
  const source = await read("./LandingPageEditor.jsx");
  const interactionStyles = await read("./BuilderInteractionV6.css");
  const editorStyles = await read("./LandingEditor.css");

  assert.match(source, /const hasTerminalFooter = footerState\.count === 1/);
  assert.match(source, /isDedicatedSiteFooterSection\(footerState\.location\.section\)/);
  assert.equal((source.match(/data-terminal-footer=\{hasTerminalFooter \|\| undefined\}/g) || []).length, 2);
  assert.match(interactionStyles, /landing-viewport\[data-terminal-footer=true\]\{[^}]*min-height:0!important/);
  assert.match(interactionStyles, /landing-page-frame\[data-terminal-footer=true\]>\.landing-renderer::after\{[^}]*content:none/);
  assert.doesNotMatch(editorStyles, /Document Height Final Guard/);
});

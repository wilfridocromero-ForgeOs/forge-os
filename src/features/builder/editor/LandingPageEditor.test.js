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
  for (const contract of ["form_reference", "Recargar versi", "Copiar cambios locales", "Reintentar guardado", "Duplicar", "Eliminar", "Subir", "Bajar"]) assert.match(source, new RegExp(contract));
  assert.match(source, /listBuilderAssets\(\{ assetType: "form", includeArchived: false \}\)/);
  assert.match(source, /data-block-id/);
  assert.match(source, /data-section-id/);
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

test("properties use accessible native accordion groups and controlled action surfaces", async () => {
  const source = await read("./LandingPageEditor.jsx");
  const styles = await read("./LandingEditor.css");
  for (const label of ["Content", "Appearance", "Responsive", "Surface preset", "Flat", "Soft", "Raised", "Glass", "Outline", "Premium"]) assert.match(source, new RegExp(label));
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
  for (const id of ["width", "spacing", "font", "weight", "color", "appearance", "form-connect", "form-fields", "form-design", "header-preset", "header-nav", "more"]) {
    assert.match(source, new RegExp(`id="${id}"`));
  }
  assert.match(source, /\[\["narrow","50%"\],\["standard","75%"\],\["wide","90%"\],\["none","100%"\]\]/);
  assert.match(source, /id="width"[\s\S]*?<div className="landing-option-grid">/);
  assert.match(source, /id="form-fields"[\s\S]*?<FormQuickEditor/);
  assert.match(source, /id="header-preset"[\s\S]*?<div className="landing-header-preset-grid">/);
});

test("editor leaves only after autosave flush confirms persistence", async () => {
  const source = await read("./LandingPageEditor.jsx");
  assert.match(source, /const saved = await autosaveRef\.current\?\.flush\(\)/);
  assert.match(source, /if \(saved === false\)/);
  assert.match(source, /Reintenta antes de salir/);
  assert.match(source, /onSaved: \(revision, document\) => \{ setError\(\(current\) => current === autosaveErrorRef\.current/);
});

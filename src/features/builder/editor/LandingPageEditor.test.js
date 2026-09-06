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
  assert.match(styles, /overflow:visible/);
  assert.match(styles, /@media\(max-width:900px\).*overflow-x:auto/s);
});

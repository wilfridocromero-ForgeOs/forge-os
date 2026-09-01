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
  const styles = await read("./LandingEditor.css");
  assert.match(styles, /@media\(max-width:900px\)/);
  assert.match(styles, /\.landing-palette\{display:flex;overflow-x:auto/);
  assert.match(styles, /\.landing-inspector\{position:fixed/);
  assert.doesNotMatch(styles, /overflow-x:visible/);
});

test("properties use accessible native accordion groups and controlled action surfaces", async () => {
  const source = await read("./LandingPageEditor.jsx");
  const styles = await read("./LandingEditor.css");
  for (const label of ["Content", "Appearance", "Responsive", "Surface preset", "Flat", "Soft", "Raised", "Glass", "Outline", "Premium"]) assert.match(source, new RegExp(label));
  assert.match(source, /<details className="landing-inspector-accordion"/);
  assert.match(source, /<summary>/);
  assert.match(styles, /summary:focus-visible/);
});

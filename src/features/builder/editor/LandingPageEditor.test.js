import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const read = (name) => readFile(new URL(name, import.meta.url), "utf8");

test("visual editor exposes empty canvas, palette, patterns and responsive previews", async () => {
  const source = await read("./LandingPageEditor.jsx");
  for (const contract of ["Comienza tu p", "Heading", "Text", "Image", "Actions", "Form", "Hero", "CTA", "Lead Capture", "Desktop", "Tablet", "Mobile"]) assert.match(source, new RegExp(contract));
  assert.match(source, /createHeroPattern/);
  assert.match(source, /createLeadCapturePattern/);
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

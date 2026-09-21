import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const read = (name) => readFile(new URL(name, import.meta.url), "utf8");

test("Pages selector exposes active Page, ordered list, retry and compact create flow", async () => {
  const source = await read("./LandingPagesControl.jsx");
  for (const contract of ["Página", "PÁGINAS", "Nueva página", "Nombre de página", "URL sugerida", "Crear página", "Reintentar"]) {
    assert.match(source, new RegExp(contract));
  }
  assert.match(source, /orderBuilderSitePages\(pages\)/);
  assert.match(source, /getActiveBuilderSitePage\(orderedPages, assetId\)/);
  assert.match(source, /aria-current=\{active \? "page" : undefined\}/);
  assert.match(source, /suggestUniqueBuilderPageSlug\(name, orderedPages\)/);
  assert.match(source, /submitting \|\| busy/);
});

test("Pages selector is dismissable, touch-sized and contained on mobile without a blocking backdrop", async () => {
  const source = await read("./LandingPagesControl.jsx");
  const styles = await read("./LandingPagesControl.css");
  assert.match(source, /registerBuilderDismissableLayer/);
  assert.match(source, /data-builder-dismiss-layer=\{BUILDER_PAGES_LAYER\}/);
  assert.match(source, /reason === "escape" && creating/);
  assert.doesNotMatch(source, /window\.location|location\.reload|backdrop/);
  assert.match(styles, /@media\(max-width:900px\)/);
  assert.match(styles, /position:fixed/);
  assert.match(styles, /right:\.55rem;left:\.55rem;width:auto/);
  assert.match(styles, /max-height:calc\(100dvh/);
  assert.match(styles, /min-height:2\.9rem/);
  assert.match(styles, /overflow:auto/);
});

test("editor integrates Site loading, create RPC and flush-before-switch lifecycle", async () => {
  const editor = await read("./LandingPageEditor.jsx");
  assert.match(editor, /loadBuilderSiteForPage\(asset\.id\)/);
  assert.match(editor, /siteId: siteModel\.site\.id/);
  assert.match(editor, /createPage: createBuilderSitePage/);
  assert.match(editor, /flushAndNavigateToBuilderPage/);
  assert.match(editor, /createAndNavigateToBuilderPage/);
  assert.match(editor, /clearPageTransientState/);
  assert.match(editor, /<LandingPagesControl assetId=\{asset\.id\}/);
  assert.match(editor, /setPendingInsert\(null\)/);
  assert.match(editor, /dispatch\(\{ type: "select", selection: null \}\)/);
});

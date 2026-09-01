import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("renderer is semantic, query-free and safely omits unknown blocks", async () => {
  const source = await readFile(new URL("./LandingRenderer.jsx", import.meta.url), "utf8");
  assert.match(source, /assertLandingDocument\(document\)/);
  assert.match(source, /<main/);
  assert.match(source, /<section/);
  assert.match(source, /default: return null/);
  assert.doesNotMatch(source, /supabase|contentEditable|dangerouslySetInnerHTML/);
});

test("renderer does not mutate its document input", async () => {
  const source = await readFile(new URL("./LandingRenderer.jsx", import.meta.url), "utf8");
  assert.doesNotMatch(source, /document\.(sections|settings)\s*=|\.push\(|\.splice\(/);
});

test("action group alignment maps start, center and end to flex justification", async () => {
  const source = await readFile(new URL("./LandingRenderer.jsx", import.meta.url), "utf8");
  const styles = await readFile(new URL("./LandingRenderer.css", import.meta.url), "utf8");
  assert.match(source, /data-align=\{block\.style\?\.align \|\| "start"\}/);
  assert.match(styles, /\[data-align=start\]>\[role=group\]\{justify-content:flex-start\}/);
  assert.match(styles, /\[data-align=center\]>\[role=group\]\{justify-content:center\}/);
  assert.match(styles, /\[data-align=end\]>\[role=group\]\{justify-content:flex-end\}/);
});

test("professional renderer keeps semantic and safe output contracts", async () => {
  const source = await readFile(new URL("./LandingRenderer.jsx", import.meta.url), "utf8");
  for (const contract of ["landing-logo", "landing-feature", "landing-stat", "<blockquote>", "safeVideoEmbedUrl", "landing-pricing", "<details", "<summary>", "landing-divider", "landing-spacer", "landing-social"]) assert.match(source, new RegExp(contract));
  assert.doesNotMatch(source, /dangerouslySetInnerHTML|srcDoc/);
});

test("renderer maps controlled backgrounds and typography without arbitrary HTML or CSS", async () => {
  const source = await readFile(new URL("./LandingRenderer.jsx", import.meta.url), "utf8");
  const styles = await readFile(new URL("./LandingRenderer.css", import.meta.url), "utf8");
  assert.match(source, /sectionBackground\(section\.style\?\.background\)/);
  assert.match(source, /replace\(\/\["\\\\\\n\\r\(\)\]\//);
  for (const contract of ["data-text-variant", "data-text-size", "data-text-weight", "data-max-width", "--lp-gradient-aurora"]) assert.match(source + styles, new RegExp(contract));
});

test("renderer exposes tablet and mobile differences on the same document tree", async () => {
  const source = await readFile(new URL("./LandingRenderer.jsx", import.meta.url), "utf8");
  const styles = await readFile(new URL("./LandingRenderer.css", import.meta.url), "utf8");
  for (const contract of ["data-tablet-align", "data-mobile-align", "data-tablet-hidden", "data-mobile-hidden", "data-tablet-layout", "data-mobile-layout"]) assert.match(source, new RegExp(contract));
  assert.match(styles, /data-tablet-hidden=true/); assert.match(styles, /data-mobile-hidden=true/);
});

test("renderer resolves controlled section surfaces and inherited action styles", async () => {
  const source = await readFile(new URL("./LandingRenderer.jsx", import.meta.url), "utf8");
  const styles = await readFile(new URL("./LandingRenderer.css", import.meta.url), "utf8");
  for (const contract of ["data-border", "data-radius", "data-shadow", "data-padding-top", "data-padding-bottom", "buttonDefaults", "data-background", "data-text-color", "data-border-color"]) assert.match(source, new RegExp(contract));
  for (const contract of ["data-variant=outline", "data-variant=ghost", "data-width=full", "data-radius=pill", "data-shadow=elevated"]) assert.match(styles, new RegExp(contract));
});

test("professional grids reflow before text becomes unreadable", async () => {
  const styles = await readFile(new URL("./LandingRenderer.css", import.meta.url), "utf8");
  assert.doesNotMatch(styles, /\.landing-renderer\{[^}]*overflow-wrap:anywhere/);
  assert.doesNotMatch(styles, /word-break:break-all/);
  assert.match(styles, />\.landing-editor-section-wrap\{[^}]*container:landing-section/);
  assert.doesNotMatch(styles, /\[data-section-id\][^{]*\{[^}]*container:landing-section/);
  assert.match(styles, /@container landing-section \(max-width:760px\)/);
  assert.match(styles, /@container landing-section \(max-width:480px\)/);
  assert.match(styles, /grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(styles, /\[data-layout=columns\]\{display:block\}/);
  for (const card of ["landing-pricing", "landing-stat", "landing-feature", "landing-testimonial"]) assert.match(styles, new RegExp(card));
});

test("editor chrome remains overlay-only and cannot become a grid sibling", async () => {
  const source = await readFile(new URL("./LandingRenderer.jsx", import.meta.url), "utf8");
  const styles = await readFile(new URL("../editor/LandingEditor.css", import.meta.url), "utf8");
  assert.match(source, /className="landing-editor-section-wrap"/);
  for (const chrome of ["landing-section-chrome", "landing-block-chrome", "landing-context-toolbar"]) {
    assert.match(styles, new RegExp(`\\.${chrome}[^}]*|${chrome}`));
  }
  assert.match(styles, /landing-section-chrome[^}]*position:absolute|position:absolute[^}]*landing-section-chrome/);
});

test("button surfaces derive safe depth and interaction states from controlled presets", async () => {
  const styles = await readFile(new URL("./LandingRenderer.css", import.meta.url), "utf8");
  for (const contract of ["data-shadow=soft", "data-shadow=medium", "inset 0 1px", ":active", "data-variant=outline"]) assert.match(styles, new RegExp(contract));
});

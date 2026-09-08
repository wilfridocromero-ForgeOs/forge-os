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
  assert.match(source, /data-block-align=\{block\.style\?\.align \|\| "start"\}/);
  assert.match(styles, /\[data-block-id\]\[data-block-align=start\]\{margin-left:0;margin-right:auto\}/);
  assert.match(styles, /\[data-block-id\]\[data-block-align=center\]\{margin-left:auto;margin-right:auto\}/);
  assert.match(styles, /\[data-block-id\]\[data-block-align=end\]\{margin-left:auto;margin-right:0\}/);
  assert.match(styles, /\[data-block-id\]\[data-align=center\]>\[role=group\]\{justify-content:center\}/);
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

test("renderer applies responsive width and typography without replacing desktop attributes", async () => {
  const source = await readFile(new URL("./LandingRenderer.jsx", import.meta.url), "utf8");
  const styles = await readFile(new URL("./LandingRenderer.css", import.meta.url), "utf8");
  for (const contract of ["data-mobile-max-width", "data-tablet-max-width", "data-mobile-text-size", "data-tablet-text-size", "data-mobile-padding-top", "data-tablet-padding-top", "data-mobile-block-align", "data-tablet-block-align"]) assert.match(source, new RegExp(contract));
  assert.match(styles, /landing-preview-mobile[^}]*data-mobile-max-width=narrow/);
  assert.match(styles, /landing-preview-tablet[^}]*data-tablet-max-width=narrow/);
  assert.match(styles, /@media\(max-width:767px\)[\s\S]*data-mobile-text-size=xl/);
  assert.match(styles, /@media\(min-width:768px\) and \(max-width:1023px\)[\s\S]*data-tablet-text-size=xl/);
});

test("block position stays independent from internal text alignment", async () => {
  const source = await readFile(new URL("./LandingRenderer.jsx", import.meta.url), "utf8");
  const styles = await readFile(new URL("./LandingRenderer.css", import.meta.url), "utf8");
  assert.match(source, /data-block-align=/);
  assert.match(styles, /data-block-align=center[^}]*margin-left:auto[^}]*margin-right:auto/);
  assert.doesNotMatch(styles, /data-block-align=center[^}]*text-align:center/);
});

test("form and heading widths are owned by the visible block layout node", async () => {
  const source = await readFile(new URL("./LandingRenderer.jsx", import.meta.url), "utf8");
  const interactionStyles = await readFile(new URL("../editor/BuilderInteractionV6.css", import.meta.url), "utf8");
  assert.match(source, /data-block-id=\{block\.id\}[\s\S]*?data-block-align=\{block\.style\?\.align/);
  assert.match(source, /data-max-width=\{block\.style\?\.max_width \|\| "none"\}/);
  assert.match(interactionStyles, /\[data-block-id\]\[data-max-width=standard\]\{width:min\(75%,52rem\)!important\}/);
  assert.match(source, /data-mobile-block-align=\{block\.responsive\?\.mobile\?\.align\}/);
  assert.match(source, /data-tablet-max-width=\{block\.responsive\?\.tablet\?\.max_width\}/);
  assert.doesNotMatch(source, /className="landing-editor-block-wrap"[^>]*data-block-layout/);
  assert.match(interactionStyles, /data-max-width=standard\]:not\(\[data-mobile-max-width\]\)/);
  assert.match(interactionStyles, /data-max-width=standard\]:not\(\[data-tablet-max-width\]\)/);
});

test("section, block and textual content use distinct layout owners", async () => {
  const source = await readFile(new URL("./LandingRenderer.jsx", import.meta.url), "utf8");
  const styles = await readFile(new URL("./LandingRenderer.css", import.meta.url), "utf8");
  assert.match(source, /data-section-id=\{section\.id\}[\s\S]*?data-align=\{section\.style\?\.align/);
  assert.match(source, /className="landing-section-composition"/);
  assert.match(source, /data-composition-width=\{section\.style\?\.content_width \|\| "standard"\}/);
  assert.match(source, /data-composition-align=\{section\.style\?\.align \|\| "start"\}/);
  assert.match(styles, /landing-section-composition\[data-composition-align=center\]\{margin-left:auto;margin-right:auto\}/);
  assert.match(styles, /data-composition-width=standard\]\{--lp-composition-width:75%/);
  assert.doesNotMatch(source, /data-group-align=/);
  assert.doesNotMatch(styles, /\[data-section-id\][^{]*\{[^}]*--lp-group-width/);
  assert.match(styles, /\[data-block-type=heading\],\.landing-renderer \[data-block-type=text\]\{text-align:left\}/);
  assert.match(styles, /\[data-block-type=heading\]>:is\(h1,h2,h3,h4,h5,h6\)[^}]*margin-left:0/);
});

test("responsive pattern composition balances an incomplete tablet row and stacks on mobile", async () => {
  const source = await readFile(new URL("./LandingRenderer.jsx", import.meta.url), "utf8");
  const styles = await readFile(new URL("./LandingRenderer.css", import.meta.url), "utf8");
  assert.match(source, /data-tablet-incomplete-row=/);
  assert.match(source, /section\.regions\.length % 2 === 1/);
  assert.match(styles, /data-tablet-incomplete-row=true[^}]*grid-column:1\/-1[^}]*width:calc/);
  assert.match(styles, /data-composition-align=center[^}]*data-tablet-incomplete-row=true[^}]*justify-self:center/);
  assert.match(styles, /landing-preview-mobile[^}]*landing-section-composition[^}]*display:block/);
});

test("section responsive alignment is exposed separately from child alignment", async () => {
  const source = await readFile(new URL("./LandingRenderer.jsx", import.meta.url), "utf8");
  const styles = await readFile(new URL("./LandingRenderer.css", import.meta.url), "utf8");
  assert.match(source, /data-tablet-composition-align=\{section\.responsive\?\.tablet\?\.align\}/);
  assert.match(source, /data-mobile-composition-align=\{section\.responsive\?\.mobile\?\.align\}/);
  assert.match(styles, /data-tablet-composition-align=end[^}]*margin-left:auto[^}]*margin-right:0/);
  assert.doesNotMatch(styles, /data-composition-align=center[^}]*text-align:center/);
});

test("canvas geometry stays stable while composition width and alignment change", async () => {
  const styles = await readFile(new URL("./LandingRenderer.css", import.meta.url), "utf8");
  assert.match(styles, /landing-renderer>\[data-section-id\],\.landing-renderer>\.landing-editor-section-wrap>\[data-section-id\]\{[^}]*width:100%[^}]*max-width:var\(--lp-width\)[^}]*margin-left:auto[^}]*margin-right:auto/);
  assert.match(styles, /landing-section-composition\{[^}]*width:var\(--lp-composition-width,75%\)/);
  assert.match(styles, /data-composition-width=narrow\]\{--lp-composition-width:50%/);
  assert.match(styles, /data-composition-width=wide\]\{--lp-composition-width:90%/);
  assert.doesNotMatch(styles, /\[data-section-id\]\[data-align=(?:start|center|end)\][^{]*\{[^}]*margin-(?:left|right)/);
  assert.doesNotMatch(styles, /\[data-section-id\]\[data-content-width=(?:narrow|standard|wide)\][^{]*\{[^}]*max-width/);
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

test("section chrome uses the shared viewport-aware floating panel contract", async () => {
  const source = await readFile(new URL("./LandingRenderer.jsx", import.meta.url), "utf8");
  const styles = await readFile(new URL("../editor/BuilderContextToolbarV12.css", import.meta.url), "utf8");
  assert.match(source, /placeFloatingPanel\(triggerRef\.current\.getBoundingClientRect\(\), panelRef\.current\.getBoundingClientRect\(\), bounds\)/);
  assert.match(source, /intersectFloatingViewport\(viewport, editor\)/);
  assert.match(source, /className="landing-floating-panel landing-editor-menu-floating"/);
  assert.match(styles, /landing-editor-menu-floating[^}]*display:grid/);
  assert.doesNotMatch(source, /<details className="landing-editor-menu"/);
});

test("button surfaces derive safe depth and interaction states from controlled presets", async () => {
  const styles = await readFile(new URL("./LandingRenderer.css", import.meta.url), "utf8");
  for (const contract of ["data-shadow=soft", "data-shadow=medium", "inset 0 1px", ":active", "data-variant=outline"]) assert.match(styles, new RegExp(contract));
});

test("explicit headers expose touch navigation while Socials remains independent", async () => {
  const source = await readFile(new URL("./LandingRenderer.jsx", import.meta.url), "utf8");
  const styles = await readFile(new URL("./LandingRenderer.css", import.meta.url), "utf8");
  const editorHeaderStyles = await readFile(new URL("../editor/BuilderHeaderFormsV8.css", import.meta.url), "utf8");
  assert.match(source, /case "site_header": return <SiteHeader/);
  assert.match(source, /aria-expanded=\{open\}/);
  assert.match(styles, /landing-header-menu\[data-open=true\]/);
  assert.doesNotMatch(source, /isComposedHeader|data-site-header/);
  assert.match(source, /case "social_links": return <nav className="landing-social"/);
  assert.match(source, /resolveNavigationHref/);
  assert.match(source, /id=\{section\.anchor \|\| undefined\}/);
  for (const provider of ["instagram", "facebook", "linkedin", "youtube", "tiktok", "email"]) {
    assert.match(source, new RegExp(`provider === "${provider}"`));
  }
  assert.doesNotMatch(styles + editorHeaderStyles, /\[data-section-id\]:has\(\.landing-social\)/);
  assert.doesNotMatch(editorHeaderStyles, /\[data-region-id\][^{]*\{[^}]*display:flex/);
});

test("mobile placement exposes one canonical target for every logical boundary", async () => {
  const source = await readFile(new URL("./LandingRenderer.jsx", import.meta.url), "utf8");
  assert.match(source, /payload\.kind === "palette-pattern" \|\| payload\.kind === "palette-block"/);
  assert.match(source, /target\.kind === "block-before" \|\| target\.kind === "region-end"/);
  assert.doesNotMatch(source, /if \(payload\.kind === "palette-pattern"\) return \["section-before"/);
  assert.doesNotMatch(source, /if \(payload\.kind === "palette-block"\) return target\.kind === "block-before" \|\| target\.kind === "block-after"/);
});

test("mobile Header remains separated and transparent presets retain a legible surface", async () => {
  const source = await readFile(new URL("./LandingRenderer.jsx", import.meta.url), "utf8");
  const styles = await readFile(new URL("./LandingRendererV4.css", import.meta.url), "utf8");
  assert.match(source, /data-block-type=\{block\.type\}/);
  assert.match(styles, /@media \(max-width:900px\)/);
  assert.match(styles, /\[data-block-id\]\[data-block-type=site_header\]\{margin-bottom:1rem!important\}/);
  assert.match(styles, /\.landing-site-header\[data-surface=transparent\]\{background:color-mix/);
  assert.match(styles, /border-bottom:1px solid/);
});

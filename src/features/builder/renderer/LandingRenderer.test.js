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
  assert.match(source, /data-block-align=\{block\.type === "site_footer" \? "start" : block\.style\?\.align \|\| "start"\}/);
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
  assert.match(source, /data-block-id=\{block\.id\}[\s\S]*?data-block-align=\{block\.type === "site_footer" \? "start" : block\.style\?\.align/);
  assert.match(source, /data-max-width=\{block\.type === "site_footer" \? "none" : block\.style\?\.max_width \|\| "none"\}/);
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
  assert.match(styles, /landing-renderer>\[data-section-id\],\.landing-renderer>\.landing-editor-section-wrap>\[data-section-id\]\{[^}]*width:100%[^}]*max-width:none[^}]*margin-left:0[^}]*margin-right:0/);
  assert.match(styles, /landing-section-composition\{[^}]*width:var\(--lp-composition-width,75%\)/);
  assert.match(styles, /data-composition-width=narrow\]\{--lp-composition-width:50%/);
  assert.match(styles, /data-composition-width=wide\]\{--lp-composition-width:90%/);
  assert.doesNotMatch(styles, /\[data-section-id\]\[data-align=(?:start|center|end)\][^{]*\{[^}]*margin-(?:left|right)/);
  assert.doesNotMatch(styles, /\[data-section-id\]\[data-content-width=(?:narrow|standard|wide)\][^{]*\{[^}]*max-width/);
});

test("inactive insertion chrome cannot expose a page-background seam above a Section", async () => {
  const styles = await readFile(new URL("../editor/LandingEditor.css", import.meta.url), "utf8");
  assert.match(styles, /\.landing-drop-zone,[^{]*\{height:0;opacity:0;pointer-events:none;background:transparent\}/);
  assert.match(styles, /\.landing-canvas-shell\.is-dragging \.landing-drop-zone\{height:18px/);
  assert.match(styles, /\.landing-renderer \.landing-drop-zone\.is-mobile-placement\{[^}]*height:2\.65rem!important/);
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

test("block chrome remains overlay-only and cannot become a grid sibling", async () => {
  const source = await readFile(new URL("./LandingRenderer.jsx", import.meta.url), "utf8");
  const styles = await readFile(new URL("../editor/LandingEditor.css", import.meta.url), "utf8");
  assert.match(source, /landing-editor-section-wrap\$\{footerSurface \? " is-site-footer-wrap" : ""\}/);
  for (const chrome of ["landing-block-chrome", "landing-context-toolbar"]) {
    assert.match(styles, new RegExp(`\\.${chrome}[^}]*|${chrome}`));
  }
});

test("editor menus use the shared viewport-aware floating panel contract", async () => {
  const source = await readFile(new URL("./LandingRenderer.jsx", import.meta.url), "utf8");
  const styles = await readFile(new URL("../editor/BuilderContextToolbarV12.css", import.meta.url), "utf8");
  assert.match(source, /placeFloatingPanel\(triggerRef\.current\.getBoundingClientRect\(\), panelRef\.current\.getBoundingClientRect\(\), bounds\)/);
  assert.match(source, /intersectFloatingViewport\(viewport, editor\)/);
  assert.match(source, /className="landing-floating-panel landing-editor-menu-floating"/);
  assert.match(source, /registerBuilderDismissableLayer/);
  assert.match(source, /data-builder-dismiss-layer=\{layerId\}/);
  assert.match(styles, /landing-editor-menu-floating[^}]*display:grid/);
  assert.doesNotMatch(source, /<details className="landing-editor-menu"/);
});

test("sections use direct selection without rendering floating chrome lifecycle code", async () => {
  const source = await readFile(new URL("./LandingRenderer.jsx", import.meta.url), "utf8");
  const editorStyles = await readFile(new URL("../editor/LandingEditor.css", import.meta.url), "utf8");
  assert.doesNotMatch(source, /SectionChrome|sectionChromePosition|MutationObserver|data-positioned/);
  assert.doesNotMatch(editorStyles, /landing-section-chrome|data-positioned/);
  assert.match(source, /data-selected=\{\(selection\?\.level === "section"/);
});

test("renderer declares the granular hierarchy and only the selected Button is primary", async () => {
  const source = await readFile(new URL("./LandingRenderer.jsx", import.meta.url), "utf8");
  const styles = await readFile(new URL("../editor/LandingEditor.css", import.meta.url), "utf8");
  for (const level of ["section", "group", "block", "element"]) assert.match(source, new RegExp(`data-selection-level=.*${level}`));
  for (const attribute of ["data-builder-selectable", "data-section-id", "data-region-id", "data-block-id", "data-element-id", "data-element-type", "data-builder-editor-control"]) assert.match(source, new RegExp(attribute));
  assert.match(source, /selection\?\.level === "element" && selection\.elementId === elementId/);
  assert.match(source, /<Block block=\{block\} sectionId=\{section\.id\} regionId=\{region\.id\} selection=\{selection\}/);
  assert.doesNotMatch(source, /<a[^>]*data-block-id=/);
  assert.match(source, /!\(selection\?\.level === "element" && selection\.blockId === block\.id\)/);
  assert.match(styles, /\[data-section-id\]:hover:not\(\[data-selected=true\]\)/);
  assert.doesNotMatch(styles, /\.landing-page-frame\s+\[data-selected=true\]\{outline:none!important\}/);
  assert.match(styles, /\[data-selection-level=element\]\[data-selected=true\]/);
});

test("action alignment reaches the real button group through the visual surface at every breakpoint", async () => {
  const source = await readFile(new URL("./LandingRenderer.jsx", import.meta.url), "utf8");
  const styles = await readFile(new URL("./LandingRendererV4.css", import.meta.url), "utf8");
  assert.match(source, /className="landing-action-group" role="group"/);
  assert.match(styles, /\.landing-action-group\{width:100%\}/);
  for (const [alignment, justification] of [["start", "flex-start"], ["center", "center"], ["end", "flex-end"]]) {
    assert.match(styles, new RegExp(`data-block-align=${alignment}[^}]*landing-visual-surface[^}]*landing-action-group\\{justify-content:${justification}`));
    assert.match(styles, new RegExp(`data-mobile-block-align=${alignment}[^}]*landing-action-group\\{justify-content:`));
    assert.match(styles, new RegExp(`data-tablet-block-align=${alignment}[^}]*landing-action-group\\{justify-content:`));
  }
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
  assert.match(source, /function SocialLinks\(/);
  assert.match(source, /case "social_links": return <SocialLinks/);
  assert.match(source, /resolveNavigationHref/);
  assert.match(source, /id=\{section\.anchor \|\| undefined\}/);
  for (const provider of ["instagram", "facebook", "linkedin", "youtube", "tiktok", "email"]) {
    assert.match(source, new RegExp(`provider === "${provider}"`));
  }
  assert.doesNotMatch(styles + editorHeaderStyles, /\[data-section-id\]:has\(\.landing-social\)/);
  assert.doesNotMatch(editorHeaderStyles, /\[data-region-id\][^{]*\{[^}]*display:flex/);
});

test("site_footer renders one semantic responsive component while legacy Footer blocks remain supported", async () => {
  const source = await readFile(new URL("./LandingRenderer.jsx", import.meta.url), "utf8");
  const styles = await readFile(new URL("./LandingRenderer.css", import.meta.url), "utf8");

  assert.match(source, /case "site_footer": return <SiteFooter/);
  assert.match(source, /return <footer className="landing-site-footer"/);
  assert.match(source, /<nav className="landing-footer-link-group"/);
  assert.match(source, /<nav className="landing-footer-legal"/);
  assert.match(source, /onClick=\{editorLink\(editorMode\)\}/);
  assert.match(source, /case "social_links": return <SocialLinks/);
  assert.match(source, /data-footer-surface-block-id=\{editorMode \? footerSurface\?\.blockId : undefined\}/);
  assert.match(source, /data-footer-surface-region-id=\{editorMode \? footerSurface\?\.regionId : undefined\}/);

  for (const selector of [
    ".landing-site-footer",
    ".landing-footer-main",
    ".landing-footer-brand",
    ".landing-footer-navigation",
    ".landing-footer-link-group",
    ".landing-footer-social",
    ".landing-footer-bottom",
    ".landing-footer-legal",
  ]) assert.match(styles, new RegExp(selector.replaceAll(".", "\\.")));
  for (const preset of ["centered", "columns", "minimal", "split"]) {
    assert.match(styles, new RegExp(`landing-site-footer\\[data-preset=${preset}\\]`));
  }
  assert.match(styles, /@container landing-section \(max-width:760px\)/);
  assert.match(styles, /@container landing-section \(max-width:480px\)/);
  assert.doesNotMatch(styles, /section:last-child|:has\(\.landing-social\)/);
  const footerStyles = styles.slice(styles.indexOf("ORVESEN Footer V1"));
  assert.doesNotMatch(footerStyles, /position:(?:absolute|fixed)/);
  assert.doesNotMatch(footerStyles, /\.landing-(?:site-footer|footer-main)\{[^}]*\bheight:/);
});

test("Footer granular targets never duplicate Section, Region or Block geometry ownership", async () => {
  const source = await readFile(new URL("./LandingRenderer.jsx", import.meta.url), "utf8");
  const styles = await readFile(new URL("./LandingRenderer.css", import.meta.url), "utf8");
  const footerStart = source.indexOf("function SiteFooter(");
  const footerEnd = source.indexOf("function ImageBlock(", footerStart);
  const footer = source.slice(footerStart, footerEnd);

  assert.ok(footerStart >= 0 && footerEnd > footerStart);
  assert.match(footer, /if \(!editorMode \|\| !elementId\) return \{\}/);
  assert.match(footer, /"data-builder-selectable": true/);
  assert.match(footer, /"data-selection-level": "element"/);
  assert.match(footer, /"data-element-id": elementId/);
  assert.match(footer, /"data-element-type": elementType/);
  assert.doesNotMatch(footer, /"data-section-id"|"data-region-id"|"data-block-id"/);

  // These existing structural rules explain why duplicating the ownership
  // attributes distorted the Footer grid and editor chrome.
  assert.match(styles, /\.landing-renderer \[data-region-id\]\{grid-column:span var\(--region-span,12\)/);
  assert.match(styles, /\.landing-renderer \[data-block-id\]\+\[data-block-id\]\{margin-top:1rem\}/);
  assert.match(source, /data-section-id=\{section\.id\}/);
  assert.match(source, /data-region-id=\{region\.id\}/);
  assert.match(source, /data-block-id=\{block\.id\}/);
});

test("dedicated Footer owns the full structural surface and constrains only its inner content", async () => {
  const source = await readFile(new URL("./LandingRenderer.jsx", import.meta.url), "utf8");
  const styles = await readFile(new URL("./LandingRenderer.css", import.meta.url), "utf8");

  assert.match(source, /data-terminal-footer=\{terminalFooter \? true : undefined\}/);
  assert.match(source, /data-footer-content-width=\{block\.style\?\.max_width \|\| "none"\}/);
  assert.match(source, /data-block-align=\{block\.type === "site_footer" \? "start" :/);
  assert.match(source, /data-section-relative=\{block\.type === "site_footer" \? undefined :/);
  assert.match(source, /data-max-width=\{block\.type === "site_footer" \? "none" :/);

  const terminalStyles = styles.slice(styles.indexOf("terminal full-width surface contract"));
  assert.match(terminalStyles, /is-site-footer-wrap > \[data-section-role="site_footer"\]\{[^}]*width:100%!important[^}]*max-width:none!important[^}]*padding:0!important/);
  assert.match(terminalStyles, /is-site-footer-wrap > \[data-section-role="site_footer"\] > \.landing-section-composition\{[^}]*width:100%!important[^}]*max-width:none!important/);
  assert.match(terminalStyles, /data-footer-content-width="narrow"[^}]*max-width:38rem/);
  assert.match(terminalStyles, /data-footer-content-width="standard"[^}]*max-width:52rem/);
  assert.match(terminalStyles, /data-footer-content-width="wide"[^}]*max-width:68rem/);
  assert.match(terminalStyles, /data-footer-content-width="none"[^}]*max-width:none/);
  assert.doesNotMatch(terminalStyles, /data-section-role="site_footer"[^}]*background:transparent|landing-section-visual-surface[^}]*display:none/);
});

test("dedicated Footer exposes insertion only before its terminal surface", async () => {
  const source = await readFile(new URL("./LandingRenderer.jsx", import.meta.url), "utf8");
  assert.match(source, /footerUsesSectionTarget = Boolean\(footerSurface && editorActions\?\.dragPayload\?\.kind === "section"\)/);
  assert.match(source, /actions=\{!footerSurface \|\| footerUsesSectionTarget \? editorActions : null\}/);
  assert.match(source, /\(!footerSurface \|\| !footerUsesSectionTarget\) && <DropZone target=\{\{ kind: "block-before"/);
  assert.match(source, /block\.id !== footerSurface\?\.blockId && <DropZone target=\{\{ kind: "block-after"/);
  assert.match(source, /region\.id !== footerSurface\?\.regionId && <DropZone target=\{\{ kind: "region-end"/);
  assert.match(source, /!footerSurface && \(!editorActions\?\.pendingInsert[^\n]+kind: "section-after"/);
  assert.match(source, /<DropZone target=\{\{ kind: "block-before"/);
});

test("Header exposes granular Brand, Nav and CTA targets only in editor mode", async () => {
  const source = await readFile(new URL("./LandingRenderer.jsx", import.meta.url), "utf8");
  assert.match(source, /function SiteHeader\(\{ block, sectionId, regionId, selection, appearance, editorMode/);
  assert.match(source, /if \(!editorMode\) return \{\}/);
  assert.match(source, /getHeaderElementId\(block\.id, elementType\)/);
  for (const attribute of ["data-builder-selectable", "data-selection-level", "data-section-id", "data-region-id", "data-block-id", "data-element-id", "data-element-type", "data-selected"]) {
    assert.match(source, new RegExp(attribute));
  }
  assert.match(source, /selectionAttributes\("brand"\)/);
  assert.match(source, /selectionAttributes\("navigation"\)/);
  assert.match(source, /selectionAttributes\("button"\)/);
  assert.match(source, /className="landing-header-toggle"[^>]*data-builder-editor-control=\{editorMode \|\| undefined\}/);
});

test("Header Nav renders the global style, per-item override and stable legacy item index", async () => {
  const source = await readFile(new URL("./LandingRenderer.jsx", import.meta.url), "utf8");
  const styles = await readFile(new URL("./LandingRenderer.css", import.meta.url), "utf8");
  assert.match(source, /content\.nav_items\.map\(\(item, index\) => \(\{ item, index \}\)\)\.filter\(\(\{ item \}\) => item\.enabled\)/);
  assert.match(source, /getHeaderNavStyleAttributes\(globalNavStyle\)/);
  assert.match(source, /getHeaderNavStyleAttributes\(getEffectiveHeaderNavItemStyle\(content, item\)\)/);
  assert.match(source, /getHeaderNavItemElementId\(item, block\.id, index\)/);
  assert.match(source, /selectionAttributes\("nav_item", elementId\)/);
  for (const attribute of ["data-nav-font-family", "data-nav-font-size", "data-nav-font-weight", "data-nav-gap", "data-nav-padding-x", "data-nav-padding-y", "data-nav-background", "data-nav-border", "data-nav-radius", "data-nav-hover-background", "data-nav-active-background"]) {
    assert.match(styles, new RegExp(attribute));
  }
  assert.match(styles, /@media\(max-width:767px\)/);
  assert.match(styles, /landing-header-menu \.landing-header-nav\{display:grid;width:100%/);
  assert.match(styles, /landing-header-menu \.landing-header-nav-item\{width:100%;max-width:100%/);
});

test("Header outer Section and inner visual container remain separate style owners", async () => {
  const source = await readFile(new URL("./LandingRenderer.jsx", import.meta.url), "utf8");
  const styles = await readFile(new URL("./LandingRenderer.css", import.meta.url), "utf8");
  assert.match(source, /className="landing-section-visual-surface"/);
  assert.match(source, /className="landing-site-header landing-header-inner" data-header-container="inner"/);
  assert.match(source, /style=\{sectionBackground\(section\.style\?\.background\)\}/);
  assert.match(styles, /landing-site-header\[data-header-container=inner\]\{box-sizing:border-box;max-width:100%\}/);
  assert.match(styles, /landing-renderer>\[data-section-id\][^}]*width:100%;max-width:none/);
});

test("preview rendering excludes editor chrome and Header-only selection metadata", async () => {
  const source = await readFile(new URL("./LandingRenderer.jsx", import.meta.url), "utf8");
  assert.match(source, /if \(!editorMode\) return \{\}/);
  assert.match(source, /\{editorMode && !\(selection\?\.level === "element"/);
  assert.match(source, /renderField=\{editorMode \? renderField : null\}/);
  assert.match(source, /data-builder-selectable=\{editorMode \|\| undefined\}/);
});

test("current Header Composer presets finish in one desktop row without shrinking the structural surface", async () => {
  const source = await readFile(new URL("./LandingRenderer.jsx", import.meta.url), "utf8");
  const styles = await readFile(new URL("./LandingRenderer.css", import.meta.url), "utf8");
  const v4Start = styles.lastIndexOf("Final cascade for the current Composer presets.");
  const v4End = styles.lastIndexOf("/* End ORVESEN Header - Desktop Professional V4. */");
  assert.ok(v4Start > styles.lastIndexOf("ORVESEN Header â€” Desktop Professional V3"));
  assert.ok(v4End > v4Start);
  const v4 = styles.slice(v4Start, v4End);

  assert.match(source, /const CLASSIC_HEADER_PRESETS = new Set\(\["classic", "logo_nav_cta"\]\)/);
  assert.match(source, /const PROFESSIONAL_HEADER_PRESETS = new Set\(\["boxed", "floating_pill", "minimal", "centered", "split", "glass", "custom"\]\)/);
  assert.match(v4, /@media \(min-width:768px\)/);
  assert.match(v4, /data-header-layout\$="-row"[^}]*display:flex!important;[^}]*flex-direction:row!important;[^}]*flex-wrap:nowrap!important/);
  assert.match(v4, /grid-template-columns:none!important;[^}]*grid-template-rows:none!important/);
  assert.match(v4, /> \.landing-header-menu\{[^}]*display:flex!important;[^}]*flex:1 1 0!important;[^}]*flex-wrap:nowrap!important/);
  assert.match(v4, /> \.landing-header-menu > \.landing-header-nav\{[^}]*display:flex!important;[^}]*flex:1 1 0!important;[^}]*flex-wrap:nowrap!important/);
  assert.match(v4, /data-preset="split"\] > \.landing-header-menu\{[^}]*flex:0 1 auto!important;[^}]*margin-left:auto!important/);
  assert.doesNotMatch(v4, /data-preset="centered"[^}]*display:grid|grid-template-rows:auto auto/);
  assert.doesNotMatch(v4, /@media \(max-width:/);
  assert.match(styles, /data-preset=cta_heavy[^}]*landing-header-cta\{min-width:9rem/);
  assert.match(styles, /landing-site-header\{[^}]*width:100%/);
  assert.doesNotMatch(styles, /landing-site-header\[data-preset=[^\]]+\][^{]*\{[^}]*width:(?:50|75|90)%/);
  assert.ok(styles.lastIndexOf(".landing-site-header[data-preset=minimal] .landing-header-cta{display:inline-flex}") > styles.lastIndexOf(".landing-site-header[data-preset=minimal] .landing-header-cta{display:none}"));
});

test("Header block selection follows its dedicated outer surface without changing published geometry", async () => {
  const source = await readFile(new URL("./LandingRenderer.jsx", import.meta.url), "utf8");
  const editorStyles = await readFile(new URL("../editor/LandingEditor.css", import.meta.url), "utf8");
  const publishedStyles = await readFile(new URL("./LandingRenderer.css", import.meta.url), "utf8")
    + await readFile(new URL("./LandingRendererV3.css", import.meta.url), "utf8")
    + await readFile(new URL("./LandingRendererV4.css", import.meta.url), "utf8")
    + await readFile(new URL("./LandingVisualSystemV5.css", import.meta.url), "utf8");

  assert.match(source, /section\?\.regions\?\.length !== 1 \|\| section\.regions\[0\]\?\.blocks\?\.length !== 1/);
  assert.match(source, /block\?\.type === "site_header" \? \{ blockId: block\.id, regionId: section\.regions\[0\]\.id, layout: getHeaderLayoutContract\(block\) \} : null/);
  assert.match(source, /data-header-surface-block-id=\{editorMode \? headerSurface\?\.blockId : undefined\}/);
  assert.match(source, /data-header-surface-region-id=\{editorMode \? headerSurface\?\.regionId : undefined\}/);
  assert.match(source, /data-header-surface-selected=\{headerSurfaceSelected \|\| undefined\}/);
  assert.match(source, /selection\?\.level === "block"\s*&& selection\.blockId === headerSurface\?\.blockId/);

  const outerSelector = ".landing-page-frame section[data-selection-level=section][data-selection-ancestor=true][data-header-surface-selected=true]";
  assert.match(editorStyles, new RegExp(outerSelector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\{[^}]*outline:"));
  assert.match(source, /data-header-surface-proxy=\{\(editorMode && block\.id === headerSurface\?\.blockId\) \|\| undefined\}/);
  assert.match(editorStyles, /\[data-block-id\]\[data-block-type=site_header\]\[data-header-surface-proxy=true\]\[data-selected=true\]\{outline:none!important\}/);
  assert.doesNotMatch(editorStyles, /\[data-block-type=site_header\]\[data-selected=true\]\{outline:none!important\}/);
  const outerRule = editorStyles.match(/section\[data-selection-level=section\]\[data-selection-ancestor=true\]\[data-header-surface-selected=true\]\{([^}]*)\}/)?.[1] || "";
  assert.doesNotMatch(outerRule, /(?:^|;)\s*(?:width|max-width|margin|padding|display|grid-template-columns)\s*:/);
  assert.match(editorStyles, /@media\(max-width:900px\)\{\s*\.landing-page-frame section\[data-selection-level=section\]\[data-selection-ancestor=true\]\[data-header-surface-selected=true\]\{outline-offset:-2px!important\}/);
  assert.match(publishedStyles, /landing-site-header\{[^}]*width:100%/);
});

test("a Header in a mixed section keeps its normal block outline", async () => {
  const source = await readFile(new URL("./LandingRenderer.jsx", import.meta.url), "utf8");
  const editorStyles = await readFile(new URL("../editor/LandingEditor.css", import.meta.url), "utf8");
  assert.match(source, /section\?\.regions\?\.length !== 1 \|\| section\.regions\[0\]\?\.blocks\?\.length !== 1/);
  assert.match(source, /data-header-surface-proxy=\{\(editorMode && block\.id === headerSurface\?\.blockId\) \|\| undefined\}/);
  assert.match(editorStyles, /\[data-selected=true\]\{outline-offset:3px;outline:2px/);
  assert.doesNotMatch(editorStyles, /\[data-block-type=site_header\]\[data-selected=true\]\{outline:none!important\}/);
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
  const rendererStyles = await readFile(new URL("./LandingRenderer.css", import.meta.url), "utf8");
  assert.match(source, /data-block-type=\{block\.type\}/);
  assert.match(styles, /@media \(max-width:900px\)/);
  assert.match(styles, /\[data-block-id\]\[data-block-type=site_header\]\{margin-bottom:0!important\}/);
  assert.match(rendererStyles, /landing-site-header\[data-header-container=inner\]\[data-surface=transparent\]>\.landing-header-menu\{background:var\(--lp-surface\)\}/);
  assert.match(rendererStyles, /border-top:1px solid color-mix/);
});

test("all professional Header presets share the final row contract while Composer tokens remain authoritative", async () => {
  const source = await readFile(new URL("./LandingRenderer.jsx", import.meta.url), "utf8");
  const styles = await readFile(new URL("./LandingRenderer.css", import.meta.url), "utf8");
  const start = styles.lastIndexOf("Final cascade for the current Composer presets.");
  const end = styles.lastIndexOf("/* End ORVESEN Header - Desktop Professional V4. */");
  assert.ok(start >= 0 && end > start);
  assert.ok(start > styles.lastIndexOf("ORVESEN Header â€” Desktop Professional V3"));
  const desktop = styles.slice(start, end);

  assert.match(source, /const CLASSIC_HEADER_PRESETS = new Set\(\["classic", "logo_nav_cta"\]\)/);
  assert.match(source, /const PROFESSIONAL_HEADER_PRESETS = new Set\(\["boxed", "floating_pill", "minimal", "centered", "split", "glass", "custom"\]\)/);
  assert.match(source, /if \(CLASSIC_HEADER_PRESETS\.has\(preset\)\) return "classic-row"/);
  assert.match(source, /if \(preset === "custom" && \(block\?\.style\?\.max_width \|\| "none"\) === "none"\) return "classic-row"/);
  assert.match(source, /return PROFESSIONAL_HEADER_PRESETS\.has\(preset\) \? "desktop-row" : undefined/);
  assert.match(source, /data-header-layout=\{getHeaderLayoutContract\(block\)\}/);
  assert.match(desktop, /@media \(min-width:768px\)/);
  assert.match(desktop, /landing-site-header\[data-header-container="inner"\]\[data-header-layout\$="-row"\]\{[\s\S]*?display:flex!important;[\s\S]*?flex-direction:row!important;[\s\S]*?flex-wrap:nowrap!important;[\s\S]*?align-items:center!important/);
  assert.match(desktop, /data-spacing="sm"\][^{]*\{\s*padding:\.52rem/);
  assert.match(desktop, /data-spacing="md"\][^{]*\{\s*padding:\.64rem/);
  assert.match(desktop, /data-spacing="lg"\][^{]*\{\s*padding:\.88rem/);
  assert.match(desktop, /> \.landing-site-brand\{[\s\S]*?flex:0 0 auto!important/);
  assert.match(desktop, /> \.landing-header-menu\{[\s\S]*?display:flex!important;[\s\S]*?flex:1 1 0!important;[\s\S]*?flex-wrap:nowrap!important/);
  assert.match(desktop, /> \.landing-header-menu > \.landing-header-nav\{[\s\S]*?display:flex!important;[\s\S]*?flex:1 1 0!important;[\s\S]*?flex-wrap:nowrap!important/);
  assert.match(desktop, /gap:var\(--lh-nav-gap,\.75rem\)!important/);
  assert.match(desktop, /padding:var\(--lh-nav-padding-y,\.3rem\) var\(--lh-nav-padding-x,\.5rem\)!important/);
  assert.match(desktop, /border-radius:var\(--lh-nav-radius,0\)!important/);
  assert.match(desktop, /font-size:var\(--lh-nav-size,\.95rem\)!important/);
  assert.match(desktop, /data-nav-hover-background="transparent"[^}]+background:transparent!important/);
  assert.match(desktop, /data-nav-hover-background="surface"[^}]+background:color-mix\(/);
  assert.match(desktop, /border-radius:var\(--visual-radius,inherit\)!important/);
  assert.doesNotMatch(desktop, /position:absolute|(?:^|[;{])height:\s*\d/);
  assert.doesNotMatch(desktop, /data-preset="(?:boxed|floating_pill|minimal|centered|glass)"[^}]*background:/);

  const header = source.slice(source.indexOf("return <header className=\"landing-site-header"), source.indexOf("</header>;", source.indexOf("return <header className=\"landing-site-header")));
  assert.ok(header.indexOf("landing-site-brand") < header.indexOf("landing-header-menu"));
  assert.ok(header.indexOf("landing-header-nav") < header.indexOf("landing-header-cta"));
  assert.match(styles, /@media\(max-width:767px\)\{\.landing-site-header\{grid-template-columns:minmax\(0,1fr\) auto\}\.landing-header-toggle\{display:block\}/);
});

test("Classic Header spacing is not inflated by generic block or granular editor margins", async () => {
  const styles = await readFile(new URL("./LandingRenderer.css", import.meta.url), "utf8");
  assert.match(styles, /\.landing-renderer \.landing-site-header\[data-header-layout\$="-row"\]\{margin-block:0\}/);
  assert.match(styles, /\.landing-renderer \.landing-site-header\[data-header-layout\$="-row"\] :is\(\.landing-header-nav-item,\.landing-header-cta\)\[data-block-id\]\{margin-top:0\}/);
  assert.match(styles, /\.landing-renderer \[data-block-id\]\+\[data-block-id\]\{margin-top:1rem\}/);
  assert.match(styles, /\.landing-renderer \[data-spacing=md\]\{margin-block:1rem\}/);
});

test("dedicated Header compact defaults preserve explicit and generic Section spacing", async () => {
  const source = await readFile(new URL("./LandingRenderer.jsx", import.meta.url), "utf8");
  const styles = await readFile(new URL("./LandingRenderer.css", import.meta.url), "utf8");
  const v3 = await readFile(new URL("./LandingRendererV3.css", import.meta.url), "utf8");
  const v4 = await readFile(new URL("./LandingRendererV4.css", import.meta.url), "utf8");

  assert.match(source, /data-section-role=\{headerSurface \? "site_header" : footerSurface \? "site_footer" : undefined\}/);
  assert.match(source, /data-header-layout=\{headerSurface\?\.layout\}/);
  assert.match(styles, /\[data-section-role=site_header\]\[data-header-layout=classic-row\]:not\(\[data-padding-top\]\)\{padding-top:8px!important\}/);
  assert.match(styles, /\[data-section-role=site_header\]\[data-header-layout=classic-row\]:not\(\[data-padding-bottom\]\)\{padding-bottom:8px!important\}/);
  assert.match(v3, /\[data-section-id\][^{]*\{padding-block:48px\}/);
  assert.match(v4, /\[data-section-id\][^{]*\{padding-block:48px\}/);
  assert.doesNotMatch(styles, /\.landing-editor[^\n{]*\[data-section-role=site_header\]/);
});

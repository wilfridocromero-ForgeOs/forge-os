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

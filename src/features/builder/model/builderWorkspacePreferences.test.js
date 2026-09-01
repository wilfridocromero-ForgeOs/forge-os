import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import {
  BUILDER_WORKSPACE_PREFERENCES_KEY,
  clampBuilderZoom,
  formatBuilderZoom,
  getBuilderNodePresentation,
  readBuilderWorkspacePreferences,
  writeBuilderWorkspacePreferences,
} from "./builderWorkspacePreferences.js";

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
}

test("Builder workspace defaults to an immersive sidebar without affecting stored data", () => {
  assert.deepEqual(readBuilderWorkspacePreferences(memoryStorage()), {
    globalSidebarCollapsed: true,
    paletteCollapsed: false,
  });
});

test("workspace collapse preferences survive reload and malformed values fail safely", () => {
  const storage = memoryStorage();
  writeBuilderWorkspacePreferences({ globalSidebarCollapsed: false, paletteCollapsed: true }, storage);
  assert.deepEqual(readBuilderWorkspacePreferences(storage), {
    globalSidebarCollapsed: false,
    paletteCollapsed: true,
  });
  assert.deepEqual(readBuilderWorkspacePreferences(memoryStorage({ [BUILDER_WORKSPACE_PREFERENCES_KEY]: "{" })), {
    globalSidebarCollapsed: true,
    paletteCollapsed: false,
  });
});

test("zoom is constrained to the professional 25–150 percent range", () => {
  assert.equal(clampBuilderZoom(0.1), 0.25);
  assert.equal(clampBuilderZoom(2), 1.5);
  assert.equal(formatBuilderZoom(0.75), "75%");
});

test("nodes avoid repeating the default label and retain configuration status", () => {
  const definition = { label: "Landing", defaultLabel: "Landing" };
  assert.deepEqual(getBuilderNodePresentation({ label: "Landing" }, definition), {
    typeLabel: "Landing",
    customLabel: null,
    statusLabel: "Sin configurar",
  });
  assert.equal(getBuilderNodePresentation({ label: "Landing principal" }, definition).customLabel, "Landing principal");
  assert.equal(getBuilderNodePresentation({ label: "Landing", asset_id: "asset" }, definition).statusLabel, "Asset vinculado");
});

test("canvas source keeps native zoom, fit, resize and accessible controls", async () => {
  const source = await readFile(new URL("../components/BuilderCanvas.jsx", import.meta.url), "utf8");
  assert.match(source, /minZoom=\{0\.25\}/);
  assert.match(source, /maxZoom=\{1\.5\}/);
  assert.match(source, /fitView\(/);
  assert.match(source, /dispatchEvent\(new Event\("resize"\)\)/);
  assert.match(source, /aria-label="Controles de zoom del canvas"/);
});

test("workspace source preserves mobile list and inspector while panels affect canvas layout", async () => {
  const workspace = await readFile(new URL("../pages/BuilderWorkspace.jsx", import.meta.url), "utf8");
  const styles = await readFile(new URL("../Builder.css", import.meta.url), "utf8");
  assert.match(workspace, /layoutKey=\{`\$\{paletteCollapsed\}-\$\{Boolean\(selected\)\}`\}/);
  assert.match(workspace, /BuilderFlowList/);
  assert.match(workspace, /aria-label="Inspector del paso"/);
  assert.match(styles, /@media\(max-width:767px\)/);
  assert.match(styles, /\.builder-canvas\{display:none\}/);
  assert.match(styles, /\.builder-flow-list\{display:block/);
  assert.match(workspace, /aria-expanded=\{!paletteCollapsed\}/);
  assert.match(workspace, /updateGrowthNode/);
  assert.match(workspace, /updateGrowthSystem/);
  assert.match(workspace, /validation\.valid/);
});

test("global sidebar collapse is scoped to Builder workspace and remains restorable", async () => {
  const layout = await readFile(new URL("../../../components/Layout/AppLayout.jsx", import.meta.url), "utf8");
  const sidebar = await readFile(new URL("../../../components/Layout/Sidebar.jsx", import.meta.url), "utf8");
  assert.match(layout, /\^\\\/construir\\\/sistemas/);
  assert.match(layout, /sidebarCollapsed = isBuilderWorkspace/);
  assert.match(sidebar, /aria-expanded=\{!collapsed\}/);
  assert.match(sidebar, /Expandir navegaci/);
  assert.match(sidebar, /Contraer navegaci/);
});

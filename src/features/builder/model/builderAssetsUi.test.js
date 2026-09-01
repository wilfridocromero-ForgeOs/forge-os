import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("Builder Home exposes create, filter, rename, open and archive asset flows", async () => {
  const source = await read("../components/BuilderAssetLibrary.jsx");
  for (const contract of ["Nuevo asset", "Páginas", "Formularios", "Renombrar", "Archivar", "Abrir"]) {
    assert.match(source, new RegExp(contract));
  }
});

test("node inspector supports compatible selection, atomic creation, open and unlink", async () => {
  const source = await read("../components/BuilderAssetBinding.jsx");
  assert.match(source, /assetType: node\.node_type/);
  assert.match(source, /isAssetCompatibleWithNode/);
  assert.match(source, /createBuilderAsset\(name, node\.node_type, node\.id\)/);
  assert.match(source, /Abrir asset/);
  assert.match(source, /Desvincular/);
});

test("asset workspace routes Landing pages into the editor and preserves Form metadata", async () => {
  const page = await read("../pages/BuilderAssetWorkspace.jsx");
  const styles = await read("../BuilderAssets.css");
  assert.match(page, /LandingPageEditor/);
  assert.match(page, /asset_type === "landing_page"/);
  assert.match(page, /Editor visual pendiente/);
  assert.match(page, /Dónde participa/);
  assert.match(styles, /@media \(max-width: 767px\)/);
  assert.match(styles, /var\(--bb-card\)/);
});

test("routing supports direct typed assets under the certified nested Vercel rule", async () => {
  const app = await read("../../../App.jsx");
  const vercel = await read("../../../../vercel.json");
  assert.match(app, /\/construir\/assets\/:assetType\/:assetId/);
  assert.match(vercel, /\/construir\/:path\*/);
});

test("asset service never sends organization identity from the browser", async () => {
  const service = await read("../services/BuilderAssetService.js");
  const rpcCall = service.slice(service.indexOf("supabase.rpc"), service.indexOf("if (!targetNodeId)"));
  assert.doesNotMatch(rpcCall, /organization_id/);
  assert.match(rpcCall, /target_node_id/);
});

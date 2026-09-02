import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("asset listing embeds owned versions through the explicit ownership relationship", async () => {
  const source = await readFile(new URL("./BuilderAssetService.js", import.meta.url), "utf8");
  assert.match(source, /builder_asset_versions!builder_asset_versions_organization_id_asset_id_fkey\(/);
  assert.doesNotMatch(source, /builder_asset_versions\(id,version_number/);
  assert.doesNotMatch(source, /builder_asset_versions!builder_assets_published_version_fkey\(/);
});

test("draft service loads explicitly and saves through CAS RPC without organization identity", async () => {
  const source = await readFile(new URL("./BuilderAssetService.js", import.meta.url), "utf8");
  assert.match(source, /from\("builder_asset_drafts"\)/);
  assert.match(source, /rpc\("save_builder_asset_draft"/);
  assert.match(source, /expected_revision: expectedRevision/);
  assert.doesNotMatch(source.slice(source.indexOf("saveBuilderAssetDraft")), /organization_id:/);
  assert.match(source, /BuilderDraftConflictError/);
});

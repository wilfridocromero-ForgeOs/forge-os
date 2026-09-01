import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("draft service loads explicitly and saves through CAS RPC without organization identity", async () => {
  const source = await readFile(new URL("./BuilderAssetService.js", import.meta.url), "utf8");
  assert.match(source, /from\("builder_asset_drafts"\)/);
  assert.match(source, /rpc\("save_builder_asset_draft"/);
  assert.match(source, /expected_revision: expectedRevision/);
  assert.doesNotMatch(source.slice(source.indexOf("saveBuilderAssetDraft")), /organization_id:/);
  assert.match(source, /BuilderDraftConflictError/);
});

import assert from "node:assert/strict";
import test from "node:test";
import { builderAssetRoute, isAssetCompatibleWithNode, isBuilderAssetType, latestBuilderAssetVersion } from "./builderAssets.js";

const ID = "11111111-1111-4111-8111-111111111111";

test("supports only Phase 2 canonical asset types", () => {
  assert.equal(isBuilderAssetType("landing_page"), true);
  assert.equal(isBuilderAssetType("form"), true);
  assert.equal(isBuilderAssetType("store"), false);
});

test("compatibility requires matching node type and an active draft asset", () => {
  assert.equal(isAssetCompatibleWithNode({ asset_type: "landing_page", lifecycle: "draft" }, { node_type: "landing_page" }), true);
  assert.equal(isAssetCompatibleWithNode({ asset_type: "form", lifecycle: "draft" }, { node_type: "landing_page" }), false);
  assert.equal(isAssetCompatibleWithNode({ asset_type: "landing_page", lifecycle: "archived" }, { node_type: "landing_page" }), false);
});

test("typed routes retain safe asset identity and latest version is deterministic", () => {
  assert.equal(builderAssetRoute({ id: ID, asset_type: "form" }), `/construir/assets/form/${ID}`);
  assert.equal(latestBuilderAssetVersion([{ version_number: 1 }, { version_number: 3 }, { version_number: 2 }]).version_number, 3);
  assert.equal(latestBuilderAssetVersion([]), null);
});

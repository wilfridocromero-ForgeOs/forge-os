import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const path = new URL("../migrations/20260901020615_builder_assets_foundation.sql", import.meta.url);
const sql = readFileSync(path, "utf8");

for (const fragment of [
  "create table public.builder_assets",
  "create table public.builder_asset_versions",
  "add column asset_id uuid",
  "foreign key (organization_id, asset_id)",
  "enable row level security",
  "create policy builder_assets_select",
  "create policy builder_asset_versions_select",
  "create or replace function public.create_builder_asset",
  "create trigger builder_assets_create_initial_version",
  "security invoker",
  "set search_path = ''",
  "BUILDER_ASSET_BINDING_INVALID",
]) assert.ok(sql.includes(fragment), `Missing contract: ${fragment}`);

assert.match(sql, /asset_type in \('landing_page', 'form'\)/);
assert.match(sql, /target_asset\.asset_type <> new\.node_type/);
assert.match(sql, /target_asset\.lifecycle <> 'draft'/);
assert.match(sql, /references public\.builder_assets\(organization_id, id\)/);
assert.match(sql, /created_by = \(select auth\.uid\(\)\)/);
assert.match(sql, /organization_id = \(select public\.current_user_organization_id\(\)\)/);
assert.match(sql, /revoke all on public\.builder_assets, public\.builder_asset_versions from public, anon/);
assert.match(sql, /grant select, insert, update on public\.builder_assets to authenticated/);
assert.doesNotMatch(sql, /service_role/i);
assert.doesNotMatch(sql, /security definer/i);
assert.doesNotMatch(sql, /storage\.objects/i);

console.log("Builder assets migration contract: OK");

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const path = new URL("../migrations/20260901222338_builder_landing_publishing_v1.sql", import.meta.url);
const sql = readFileSync(path, "utf8");

for (const fragment of [
  "add column public_slug text",
  "add column published_version_id uuid",
  "add column published_at timestamptz",
  "builder_assets_published_version_fkey",
  "foreign key (organization_id, id, published_version_id)",
  "state in ('draft', 'published')",
  "create trigger builder_asset_versions_are_immutable",
  "create or replace function public.publish_builder_landing",
  "create or replace function public.unpublish_builder_landing",
  "create or replace function public.get_published_builder_landing",
  "BUILDER_PUBLISH_CONFLICT",
  "BUILDER_PUBLIC_SLUG_IMMUTABLE",
  "BUILDER_PUBLISHED_ASSET_CANNOT_ARCHIVE",
  "for update",
  "security definer",
  "set search_path = ''",
]) assert.ok(sql.toLowerCase().includes(fragment.toLowerCase()), `Missing publishing contract: ${fragment}`);

assert.match(sql, /insert into public\.builder_asset_versions[\s\S]*?'published'/);
assert.match(sql, /target_draft\.revision <> expected_revision/);
assert.match(sql, /target_draft\.document, caller_id/);
assert.match(sql, /set published_version_id = null, published_at = null/);
assert.match(sql, /version\.state = 'published'/);
assert.match(sql, /asset\.public_slug = requested_public_slug/);
assert.match(sql, /grant execute on function public\.get_published_builder_landing\(text\) to anon, authenticated/);
assert.match(sql, /revoke all on public\.builder_asset_versions from anon/);
assert.match(sql, /revoke insert, update on public\.builder_assets from authenticated/);
assert.match(sql, /grant update \(name, lifecycle, archived_at\) on public\.builder_assets to authenticated/);
assert.match(sql, /\^tel:\[\+0-9\(\)\. -\]\+\$/);
assert.doesNotMatch(sql, /grant\s+select[^;]*builder_asset_(?:drafts|versions|dependencies)[^;]*anon/i);

const immutableTrigger = sql.match(/create or replace function public\.builder_asset_versions_are_immutable\(\)[\s\S]*?\$\$;/)?.[0] || "";
assert.match(immutableTrigger, /BUILDER_ASSET_VERSION_IMMUTABLE/);
assert.match(sql, /before update or delete on public\.builder_asset_versions/);
const publishSignature = sql.match(/create or replace function public\.publish_builder_landing\(([\s\S]*?)\)\nreturns table/)?.[1] || "";
assert.match(publishSignature, /target_asset_id uuid/);
assert.match(publishSignature, /expected_revision bigint/);
assert.doesNotMatch(publishSignature, /organization_id/);

console.log("Builder Landing publishing migration contract: OK");

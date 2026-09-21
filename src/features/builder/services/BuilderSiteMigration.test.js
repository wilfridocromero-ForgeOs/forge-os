import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { createLandingDocument, createPrimitiveBlock, validateLandingDocument } from "../document/landingDocument.js";
import { createLandingPattern } from "../document/landingPatterns.js";

const migrationUrl = new URL(
  "../../../../supabase/migrations/20260915184800_builder_multipage_v1_pages_core.sql",
  import.meta.url,
);
const builderAssetsFoundationUrl = new URL(
  "../../../../supabase/migrations/20260901020615_builder_assets_foundation.sql",
  import.meta.url,
);
const migration = await readFile(migrationUrl, "utf8");
const builderAssetsFoundation = await readFile(builderAssetsFoundationUrl, "utf8");

function sliceBetween(start, end) {
  const startIndex = migration.indexOf(start);
  const endIndex = migration.indexOf(end, startIndex + start.length);
  assert.notEqual(startIndex, -1, `missing ${start}`);
  assert.notEqual(endIndex, -1, `missing ${end}`);
  return migration.slice(startIndex, endIndex);
}

test("Multipage V1 creates only the Site identity and Page membership tables", () => {
  assert.match(migration, /create table public\.builder_sites \(/);
  assert.match(migration, /create table public\.builder_site_pages \(/);
  assert.match(migration, /page_asset_id uuid primary key/);
  assert.match(migration, /constraint builder_site_pages_site_fkey[\s\S]*references public\.builder_sites\(organization_id, id\)/);
  assert.match(migration, /constraint builder_site_pages_asset_fkey[\s\S]*references public\.builder_assets\(organization_id, id\)/);
  assert.match(migration, /target_asset\.asset_type <> 'landing_page'/);
  assert.doesNotMatch(migration, /create table public\.builder_site_(domains|seo|analytics)/);
  assert.doesNotMatch(migration, /alter table public\.builder_asset_drafts/);
  assert.doesNotMatch(migration, /builder_landing_document_v1_is_valid/);
});

test("slug and Home invariants are enforced by constraints, indexes, and a deferred final-state check", () => {
  assert.match(migration, /builder_site_pages_slug_check[\s\S]*and slug ~ '\^\//);
  assert.match(migration, /builder_site_pages_home_slug_check[\s\S]*is_home and slug = '\/'[\s\S]*not is_home and slug <> '\/'/);
  assert.match(migration, /when btrim\(coalesce\(candidate, ''\)\) ~ '\^\/\/' then null/);
  assert.match(migration, /create unique index builder_site_pages_site_slug_key[\s\S]*\(site_id, slug\)/);
  assert.doesNotMatch(migration, /on public\.builder_site_pages\(slug\)/);
  assert.match(migration, /create unique index builder_site_pages_one_home_key[\s\S]*on public\.builder_site_pages\(site_id\)[\s\S]*where is_home/);
  assert.match(migration, /create constraint trigger builder_site_pages_require_home[\s\S]*deferrable initially deferred/);
  assert.match(migration, /BUILDER_SITE_HOME_REQUIRED/);
});

test("only active legacy landing assets are backfilled as one-page Sites", () => {
  const backfill = sliceBetween("do $$", "create or replace function private.builder_bootstrap_site_for_landing_asset");
  assert.match(builderAssetsFoundation, /lifecycle text not null default 'draft'[\s\S]*lifecycle in \('draft', 'archived'\)/);
  assert.match(builderAssetsFoundation, /lifecycle = 'archived' and archived_at is not null[\s\S]*lifecycle = 'draft' and archived_at is null/);
  assert.match(backfill, /from public\.builder_assets asset[\s\S]*asset\.asset_type = 'landing_page'/);
  assert.match(backfill, /asset\.lifecycle = 'draft'/);
  assert.match(backfill, /asset\.archived_at is null/);
  assert.match(backfill, /not exists[\s\S]*public\.builder_site_pages/);
  assert.match(backfill, /order by asset\.created_at, asset\.id/);
  assert.match(backfill, /insert into public\.builder_sites/);
  assert.match(backfill, /insert into public\.builder_site_pages/);
  assert.match(backfill, /'\/'[\s\S]*true,[\s\S]*1/);
  assert.doesNotMatch(backfill, /update public\.builder_assets/);
  assert.doesNotMatch(backfill, /builder_asset_drafts|builder_asset_versions|document\s*=/);
});

test("archived legacy landing assets remain untouched and cannot enter the backfill", () => {
  const backfill = sliceBetween("do $$", "create or replace function private.builder_bootstrap_site_for_landing_asset");
  assert.match(backfill, /asset\.lifecycle = 'draft'[\s\S]*asset\.archived_at is null/);
  assert.doesNotMatch(backfill, /lifecycle = 'archived'|archived_at is not null/);
  assert.doesNotMatch(backfill, /update public\.builder_assets|delete from public\.builder_assets/);
});

test("new standalone landing assets bootstrap a Site while Forms remain outside Multipage", () => {
  const bootstrap = sliceBetween(
    "create or replace function private.builder_bootstrap_site_for_landing_asset",
    "create trigger builder_assets_bootstrap_site",
  );
  assert.match(bootstrap, /if new\.asset_type <> 'landing_page' then[\s\S]*return new/);
  assert.match(bootstrap, /insert into public\.builder_sites/);
  assert.match(bootstrap, /insert into public\.builder_site_pages/);
  assert.match(migration, /create trigger builder_assets_bootstrap_site[\s\S]*after insert on public\.builder_assets/);
});

test("RLS is organization-scoped, read-only from the Data API, and mutations stay behind authenticated RPCs", () => {
  assert.match(migration, /alter table public\.builder_sites enable row level security/);
  assert.match(migration, /alter table public\.builder_site_pages enable row level security/);
  assert.match(migration, /create policy builder_sites_select[\s\S]*current_user_organization_id\(\)[\s\S]*module_key = 'builder'/);
  assert.match(migration, /create policy builder_site_pages_select[\s\S]*current_user_organization_id\(\)[\s\S]*module_key = 'builder'/);
  assert.match(migration, /revoke all on public\.builder_sites from public, anon, authenticated/);
  assert.match(migration, /revoke all on public\.builder_site_pages from public, anon, authenticated/);
  assert.match(migration, /grant select on public\.builder_sites to authenticated/);
  assert.match(migration, /grant select on public\.builder_site_pages to authenticated/);
  assert.doesNotMatch(migration, /grant (insert|update|delete)[^;]*builder_site/);

  for (const name of [
    "create_builder_site_page",
    "update_builder_site_page",
    "duplicate_builder_site_page",
    "set_builder_site_home",
    "delete_builder_site_page",
  ]) {
    const body = sliceBetween(`create or replace function public.${name}`, `alter function private.builder_normalize_site_page_slug`);
    assert.match(body, /security definer/);
    assert.match(body, /set search_path = ''/);
    assert.match(body, /auth\.uid\(\)/);
    assert.match(body, /current_user_organization_id\(\)/);
    assert.match(body, /can_manage_organization/);
    assert.match(migration, new RegExp(`revoke all on function public\\.${name}\\(`));
    assert.match(migration, new RegExp(`grant execute on function public\\.${name}\\([^;]+to authenticated`));
  }
});

test("supported mutations serialize on the Site and preserve critical page invariants", () => {
  const rpcArea = sliceBetween("create or replace function public.create_builder_site_page", "alter function private.builder_normalize_site_page_slug");
  assert.ok((rpcArea.match(/from public\.builder_sites site[\s\S]{0,180}for update/g) || []).length >= 5);

  const create = sliceBetween("create or replace function public.create_builder_site_page", "create or replace function public.update_builder_site_page");
  assert.match(create, /insert into public\.builder_assets[\s\S]*'landing_page'/);
  assert.match(create, /BUILDER_PAGE_SLUG_CONFLICT/);
  assert.match(create, /is_home, position[\s\S]*false,[\s\S]*next_position/);

  const duplicate = sliceBetween("create or replace function public.duplicate_builder_site_page", "create or replace function public.set_builder_site_home");
  assert.match(duplicate, /insert into public\.builder_assets/);
  assert.match(duplicate, /requested_slug is not null and btrim\(requested_slug\) ~ '\^\/\/'[\s\S]*BUILDER_PAGE_SLUG_INVALID/);
  assert.match(duplicate, /set document = source_draft\.document/);
  assert.match(duplicate, /insert into public\.builder_asset_dependencies/);
  assert.match(duplicate, /false,[\s\S]*next_position/);

  const home = sliceBetween("create or replace function public.set_builder_site_home", "create or replace function public.delete_builder_site_page");
  assert.match(home, /builder_next_site_page_slug[\s\S]*previous_home_asset\.name/);
  assert.match(home, /set is_home = false, slug = previous_home_slug/);
  assert.match(home, /set is_home = true, slug = '\/'/);

  const remove = sliceBetween("create or replace function public.delete_builder_site_page", "alter function private.builder_normalize_site_page_slug");
  assert.match(remove, /page_count <= 1[\s\S]*BUILDER_SITE_LAST_PAGE_REQUIRED/);
  assert.match(remove, /target_page\.is_home[\s\S]*BUILDER_SITE_HOME_DELETE_FORBIDDEN/);
  assert.match(remove, /delete from public\.builder_site_pages/);
  assert.match(remove, /set lifecycle = 'archived', archived_at = now\(\)/);
});

test("foreign-key cascades remove only memberships while page deletion preserves assets and drafts", () => {
  assert.match(migration, /builder_site_pages_site_fkey[\s\S]*references public\.builder_sites\(organization_id, id\)[\s\S]*on delete cascade/);
  assert.match(migration, /builder_site_pages_asset_fkey[\s\S]*references public\.builder_assets\(organization_id, id\)[\s\S]*on delete cascade/);
  const remove = sliceBetween("create or replace function public.delete_builder_site_page", "alter function private.builder_normalize_site_page_slug");
  assert.doesNotMatch(remove, /delete from public\.builder_assets|delete from public\.builder_asset_drafts/);
  assert.match(remove, /update public\.builder_assets[\s\S]*set lifecycle = 'archived', archived_at = now\(\)/);
});

test("all SQL data access inside SECURITY DEFINER RPCs is schema-qualified", () => {
  const rpcArea = sliceBetween("create or replace function public.create_builder_site_page", "alter function private.builder_normalize_site_page_slug");
  assert.doesNotMatch(
    rpcArea,
    /^\s*(?:from|join|insert into|update|delete from)\s+(?!public\.|private\.)[a-z_]+/im,
  );
});

test("LandingDocument V1 remains unchanged and Header/Footer stay inside each independent page document", () => {
  const document = createLandingDocument();
  document.sections = [
    {
      id: crypto.randomUUID(),
      layout: "stack",
      regions: [{ id: crypto.randomUUID(), span: 12, blocks: [createPrimitiveBlock("site_header", crypto.randomUUID())] }],
    },
    createLandingPattern("site_footer"),
  ];
  const snapshot = structuredClone(document);
  assert.equal(validateLandingDocument(document).valid, true);
  assert.deepEqual(document, snapshot);
  assert.equal(document.sections.at(-1).regions[0].blocks[0].type, "site_footer");
});

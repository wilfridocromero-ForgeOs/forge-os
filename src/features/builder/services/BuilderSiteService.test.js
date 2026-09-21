import assert from "node:assert/strict";
import test from "node:test";
import {
  createBuilderSiteService,
  normalizeBuilderPageSlug,
  orderBuilderSitePages,
  suggestUniqueBuilderPageSlug,
} from "./BuilderSiteServiceCore.js";

function queryResult(result, calls) {
  const query = {
    select(value) { calls.push(["select", value]); return query; },
    eq(column, value) { calls.push(["eq", column, value]); return query; },
    single() { calls.push(["single"]); return Promise.resolve(result); },
    order(column, options) { calls.push(["order", column, options]); return Promise.resolve(result); },
  };
  return query;
}

test("page slugs are lowercase, kebab-case, accent-safe, and path-prefixed", () => {
  assert.equal(normalizeBuilderPageSlug(" Sobre nosotros "), "/sobre-nosotros");
  assert.equal(normalizeBuilderPageSlug("Página Única"), "/pagina-unica");
  assert.equal(normalizeBuilderPageSlug("/Servicios/Empresas/"), "/servicios-empresas");
  assert.equal(normalizeBuilderPageSlug("/"), "/");
  assert.equal(normalizeBuilderPageSlug("//servicios"), "");
  assert.equal(normalizeBuilderPageSlug("***"), "");
});

test("slug suggestions are unique inside one site without reserving other sites", () => {
  const pages = [{ slug: "/servicios" }, { slug: "/servicios-2" }];
  assert.equal(suggestUniqueBuilderPageSlug("Servicios", pages), "/servicios-3");
  assert.equal(suggestUniqueBuilderPageSlug("Servicios", []), "/servicios");
  assert.ok(suggestUniqueBuilderPageSlug("a".repeat(120), [{ slug: `/${"a".repeat(120)}` }]).length <= 121);
});

test("Pages are ordered with Home first and then by stable position", () => {
  const pages = [
    { page_asset_id: "page-3", name: "Nosotros", slug: "/nosotros", is_home: false, position: 3 },
    { page_asset_id: "page-1", name: "Inicio", slug: "/", is_home: true, position: 9 },
    { page_asset_id: "page-2", name: "Servicios", slug: "/servicios", is_home: false, position: 2 },
    { page_asset_id: "page-4", name: "Contacto", slug: "/contacto", is_home: false, position: 3 },
  ];
  assert.deepEqual(orderBuilderSitePages(pages).map((page) => page.page_asset_id), ["page-1", "page-2", "page-4", "page-3"]);
  assert.deepEqual(pages.map((page) => page.page_asset_id), ["page-3", "page-1", "page-2", "page-4"]);
});

test("site loading resolves membership then lists ordered page assets through explicit FKs", async () => {
  const calls = [];
  const responses = [
    { data: { site_id: "site-1", site: { id: "site-1" } }, error: null },
    { data: [{ site_id: "site-1", page_asset_id: "page-1", slug: "/", is_home: true, position: 1, asset: { id: "page-1", name: "Inicio" } }], error: null },
  ];
  const client = {
    from(table) { calls.push(["from", table]); return queryResult(responses.shift(), calls); },
  };

  const result = await createBuilderSiteService(client).loadForPage("page-1");
  assert.deepEqual(result.site, { id: "site-1" });
  assert.equal(result.pages[0].name, "Inicio");
  assert.deepEqual(calls.filter(([kind]) => kind === "from"), [
    ["from", "builder_site_pages"],
    ["from", "builder_site_pages"],
  ]);
  assert.ok(calls.some(([kind, value]) => kind === "select" && value.includes("builder_site_pages_site_fkey")));
  assert.ok(calls.some(([kind, value]) => kind === "select" && value.includes("builder_site_pages_asset_fkey")));
  assert.ok(calls.some(([kind, column, options]) => kind === "order" && column === "position" && options.ascending));
});

test("page mutations call only the transactional Pages Core RPC contract", async () => {
  const calls = [];
  const client = {
    async rpc(name, args) { calls.push([name, args]); return { data: { name }, error: null }; },
  };
  const service = createBuilderSiteService(client);

  await service.createPage({ siteId: "site-1", name: "Servicios", slug: "/servicios" });
  await service.updatePage({ pageAssetId: "page-2", name: "Soluciones", slug: "/soluciones" });
  await service.duplicatePage({ pageAssetId: "page-2" });
  await service.setHome("page-2");
  await service.deletePage("page-1");

  assert.deepEqual(calls, [
    ["create_builder_site_page", { target_site_id: "site-1", page_name: "Servicios", requested_slug: "/servicios" }],
    ["update_builder_site_page", { target_page_asset_id: "page-2", page_name: "Soluciones", requested_slug: "/soluciones" }],
    ["duplicate_builder_site_page", { source_page_asset_id: "page-2", page_name: null, requested_slug: null }],
    ["set_builder_site_home", { target_page_asset_id: "page-2" }],
    ["delete_builder_site_page", { target_page_asset_id: "page-1" }],
  ]);
});

test("known database invariant errors are preserved as stable service codes", async () => {
  const client = {
    async rpc() { return { data: null, error: { message: "duplicate: BUILDER_PAGE_SLUG_CONFLICT" } }; },
  };

  await assert.rejects(
    () => createBuilderSiteService(client).createPage({ siteId: "site-1", name: "Servicios" }),
    (error) => error.name === "BuilderSitePageError" && error.code === "BUILDER_PAGE_SLUG_CONFLICT",
  );
});

import assert from "node:assert/strict";
import test from "node:test";
import { createLandingDocument } from "../document/landingDocument.js";
import { createLandingAutosave } from "./landingAutosave.js";
import { createLandingEditorState, landingEditorReducer } from "./landingEditorState.js";
import {
  builderSitePageRoute,
  createAndNavigateToBuilderPage,
  flushAndNavigateToBuilderPage,
  getActiveBuilderSitePage,
} from "./landingPageSwitching.js";

const PAGE_A = "11111111-1111-4111-8111-111111111111";
const PAGE_B = "22222222-2222-4222-8222-222222222222";

test("active Page and SPA route resolve from the current page asset", () => {
  const pages = [{ page_asset_id: PAGE_A, name: "Inicio" }, { page_asset_id: PAGE_B, name: "Servicios" }];
  assert.equal(getActiveBuilderSitePage(pages, PAGE_B)?.name, "Servicios");
  assert.equal(getActiveBuilderSitePage(pages, "missing"), null);
  assert.equal(builderSitePageRoute(PAGE_B), `/construir/assets/landing_page/${PAGE_B}`);
});

test("Page switching flushes the current autosave before SPA navigation", async () => {
  const events = [];
  const autosave = {
    schedule(document, delay) { events.push(["schedule", document.page, delay]); },
    async flush() { events.push(["flush"]); return true; },
  };
  const result = await flushAndNavigateToBuilderPage({
    autosave,
    currentState: { dirty: true, document: { page: "A" } },
    currentPageAssetId: PAGE_A,
    targetPageAssetId: PAGE_B,
    onBeforeNavigate: () => events.push(["clear-transient-state"]),
    navigate: (route) => events.push(["navigate", route]),
  });
  assert.deepEqual(result, { ok: true, navigated: true });
  assert.deepEqual(events, [
    ["schedule", "A", 0],
    ["flush"],
    ["clear-transient-state"],
    ["navigate", `/construir/assets/landing_page/${PAGE_B}`],
  ]);
});

test("failed autosave blocks Page switching and keeps the current route", async () => {
  const routes = [];
  const result = await flushAndNavigateToBuilderPage({
    autosave: { schedule() {}, async flush() { return false; } },
    currentState: { dirty: true, document: { page: "A" } },
    currentPageAssetId: PAGE_A,
    targetPageAssetId: PAGE_B,
    navigate: (route) => routes.push(route),
  });
  assert.deepEqual(result, { ok: false, navigated: false });
  assert.deepEqual(routes, []);
});

test("creating a Page uses the existing RPC contract and makes its route active", async () => {
  const events = [];
  const result = await createAndNavigateToBuilderPage({
    autosave: { async flush() { events.push("flush"); return true; } },
    currentState: { dirty: false, document: { page: "A" } },
    siteId: "site-1",
    name: "Servicios",
    slug: "/servicios",
    createPage: async (input) => {
      events.push(["create", input]);
      return { site_id: "site-1", page_asset_id: PAGE_B, name: "Servicios", slug: "/servicios", is_home: false, position: 2 };
    },
    onBeforeNavigate: (page) => events.push(["clear", page.page_asset_id]),
    navigate: (route) => events.push(["navigate", route]),
  });
  assert.equal(result.ok, true);
  assert.equal(result.page.page_asset_id, PAGE_B);
  assert.deepEqual(events, [
    "flush",
    ["create", { siteId: "site-1", name: "Servicios", slug: "/servicios" }],
    ["clear", PAGE_B],
    ["navigate", `/construir/assets/landing_page/${PAGE_B}`],
  ]);
});

test("autosave instances remain bound to their own Page asset IDs", async () => {
  const writes = [];
  const makeQueue = (assetId) => {
    const queue = createLandingAutosave({
      save: async ({ expectedRevision, document }) => {
        writes.push({ assetId, expectedRevision, value: document.value });
        return { revision: expectedRevision + 1 };
      },
      onStatus() {}, onSaved() {}, onConflict() {}, onError() {},
      setTimer: (callback) => { callback(); return 1; },
      clearTimer() {},
    });
    queue.initialize(1);
    return queue;
  };
  const pageAQueue = makeQueue(PAGE_A);
  pageAQueue.schedule({ value: "A" }, 0);
  await pageAQueue.flush();
  const pageBQueue = makeQueue(PAGE_B);
  pageBQueue.schedule({ value: "B" }, 0);
  await pageBQueue.flush();
  assert.deepEqual(writes, [
    { assetId: PAGE_A, expectedRevision: 1, value: "A" },
    { assetId: PAGE_B, expectedRevision: 1, value: "B" },
  ]);
});

test("loading another Page resets history and selection without mutating its draft", () => {
  const pageADocument = createLandingDocument();
  const pageBDocument = createLandingDocument();
  pageBDocument.settings.seo.title = "Servicios";
  let state = createLandingEditorState({ revision: 4, document: pageADocument });
  state = { ...state, past: [structuredClone(pageADocument)], future: [structuredClone(pageADocument)], selection: { level: "section", sectionId: "stale" } };
  const next = landingEditorReducer(state, { type: "remote", draft: { revision: 9, document: pageBDocument } });
  assert.equal(next.revision, 9);
  assert.deepEqual(next.document, pageBDocument);
  assert.deepEqual(next.past, []);
  assert.deepEqual(next.future, []);
  assert.equal(next.selection, null);
  assert.equal(next.dirty, false);
});

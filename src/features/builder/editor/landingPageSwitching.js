import { builderAssetRoute } from "../model/builderAssets.js";

export function getActiveBuilderSitePage(pages = [], pageAssetId) {
  return pages.find((page) => page.page_asset_id === pageAssetId) || null;
}

export function builderSitePageRoute(pageAssetId) {
  return builderAssetRoute({ id: pageAssetId, asset_type: "landing_page" });
}

export async function flushCurrentLandingPage({ autosave, currentState }) {
  if (!autosave?.flush) return false;
  if (currentState?.dirty) autosave.schedule(currentState.document, 0);
  return autosave.flush();
}

export async function flushAndNavigateToBuilderPage({
  autosave,
  currentState,
  currentPageAssetId,
  targetPageAssetId,
  navigate,
  onBeforeNavigate = () => {},
}) {
  if (!targetPageAssetId) throw new Error("BUILDER_PAGE_NOT_FOUND");
  if (targetPageAssetId === currentPageAssetId) return { ok: true, navigated: false };

  const flushed = await flushCurrentLandingPage({ autosave, currentState });
  if (flushed === false) return { ok: false, navigated: false };

  onBeforeNavigate();
  navigate(builderSitePageRoute(targetPageAssetId));
  return { ok: true, navigated: true };
}

export async function createAndNavigateToBuilderPage({
  autosave,
  currentState,
  siteId,
  name,
  slug,
  createPage,
  navigate,
  onBeforeNavigate = () => {},
}) {
  const flushed = await flushCurrentLandingPage({ autosave, currentState });
  if (flushed === false) return { ok: false, page: null };
  const page = await createPage({ siteId, name, slug });
  onBeforeNavigate(page);
  navigate(builderSitePageRoute(page.page_asset_id));
  return { ok: true, page };
}

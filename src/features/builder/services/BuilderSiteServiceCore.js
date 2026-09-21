const PAGE_ERROR_CODES = Object.freeze([
  "BUILDER_ACCESS_DENIED",
  "BUILDER_PAGE_NAME_INVALID",
  "BUILDER_PAGE_SLUG_INVALID",
  "BUILDER_PAGE_SLUG_CONFLICT",
  "BUILDER_HOME_SLUG_IMMUTABLE",
  "BUILDER_SITE_HOME_REQUIRED",
  "BUILDER_SITE_HOME_DELETE_FORBIDDEN",
  "BUILDER_SITE_LAST_PAGE_REQUIRED",
  "BUILDER_PAGE_NOT_FOUND",
]);

function fail(error) {
  if (!error) return;
  const code = PAGE_ERROR_CODES.find((candidate) => error.message?.includes(candidate));
  if (code) {
    const normalized = new Error(code, { cause: error });
    normalized.name = "BuilderSitePageError";
    normalized.code = code;
    throw normalized;
  }
  throw error;
}

export function normalizeBuilderPageSlug(value) {
  const candidate = String(value ?? "").trim();
  if (candidate === "/") return "/";
  if (candidate.startsWith("//")) return "";
  const normalized = candidate
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized ? `/${normalized}` : "";
}

export function suggestUniqueBuilderPageSlug(name, pages = []) {
  const normalized = normalizeBuilderPageSlug(name);
  const base = (normalized && normalized !== "/" ? normalized : "/pagina")
    .slice(0, 121)
    .replace(/-+$/g, "");
  const used = new Set(pages.map((page) => page.slug));
  if (!used.has(base)) return base;
  let suffix = 2;
  let suggestion;
  do {
    const suffixValue = `-${suffix}`;
    suggestion = `${base.slice(0, 121 - suffixValue.length).replace(/-+$/g, "")}${suffixValue}`;
    suffix += 1;
  } while (used.has(suggestion));
  return suggestion;
}

export function orderBuilderSitePages(pages = []) {
  return [...pages].sort((left, right) => {
    if (Boolean(left.is_home) !== Boolean(right.is_home)) return left.is_home ? -1 : 1;
    const leftPosition = Number.isInteger(left.position) ? left.position : Number.MAX_SAFE_INTEGER;
    const rightPosition = Number.isInteger(right.position) ? right.position : Number.MAX_SAFE_INTEGER;
    if (leftPosition !== rightPosition) return leftPosition - rightPosition;
    const byName = String(left.name || "").localeCompare(String(right.name || ""), "es");
    return byName || String(left.page_asset_id || "").localeCompare(String(right.page_asset_id || ""));
  });
}

export function createBuilderSiteService(client) {
  return Object.freeze({
    async loadForPage(pageAssetId) {
      const { data: membership, error: membershipError } = await client
        .from("builder_site_pages")
        .select("site_id,site:builder_sites!builder_site_pages_site_fkey(id,organization_id,created_at,updated_at)")
        .eq("page_asset_id", pageAssetId)
        .single();
      fail(membershipError);

      const { data: pages, error: pagesError } = await client
        .from("builder_site_pages")
        .select("site_id,page_asset_id,slug,is_home,position,created_at,updated_at,asset:builder_assets!builder_site_pages_asset_fkey(id,organization_id,asset_type,name,lifecycle,created_at,updated_at)")
        .eq("site_id", membership.site_id)
        .order("position", { ascending: true });
      fail(pagesError);

      return {
        site: membership.site,
        pages: orderBuilderSitePages((pages || []).map((page) => ({
          ...page,
          name: page.asset?.name || "",
        }))),
      };
    },

    async createPage({ siteId, name, slug = null }) {
      const { data, error } = await client.rpc("create_builder_site_page", {
        target_site_id: siteId,
        page_name: name,
        requested_slug: slug,
      });
      fail(error);
      return data;
    },

    async updatePage({ pageAssetId, name = null, slug = null }) {
      const { data, error } = await client.rpc("update_builder_site_page", {
        target_page_asset_id: pageAssetId,
        page_name: name,
        requested_slug: slug,
      });
      fail(error);
      return data;
    },

    async duplicatePage({ pageAssetId, name = null, slug = null }) {
      const { data, error } = await client.rpc("duplicate_builder_site_page", {
        source_page_asset_id: pageAssetId,
        page_name: name,
        requested_slug: slug,
      });
      fail(error);
      return data;
    },

    async setHome(pageAssetId) {
      const { data, error } = await client.rpc("set_builder_site_home", {
        target_page_asset_id: pageAssetId,
      });
      fail(error);
      return data;
    },

    async deletePage(pageAssetId) {
      const { data, error } = await client.rpc("delete_builder_site_page", {
        target_page_asset_id: pageAssetId,
      });
      fail(error);
      return data;
    },
  });
}

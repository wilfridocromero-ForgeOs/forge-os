import { supabase } from "../../../lib/supabase.js";
import { createBuilderSiteService } from "./BuilderSiteServiceCore.js";

export {
  createBuilderSiteService,
  normalizeBuilderPageSlug,
  orderBuilderSitePages,
  resolveBuilderSitePagePath,
  suggestUniqueBuilderPageSlug,
} from "./BuilderSiteServiceCore.js";

const builderSiteService = createBuilderSiteService(supabase);

export const loadBuilderSiteForPage = (pageAssetId) => builderSiteService.loadForPage(pageAssetId);
export const createBuilderSitePage = (input) => builderSiteService.createPage(input);
export const updateBuilderSitePage = (input) => builderSiteService.updatePage(input);
export const duplicateBuilderSitePage = (input) => builderSiteService.duplicatePage(input);
export const setBuilderSiteHome = (pageAssetId) => builderSiteService.setHome(pageAssetId);
export const deleteBuilderSitePage = (pageAssetId) => builderSiteService.deletePage(pageAssetId);

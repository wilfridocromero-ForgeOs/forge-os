export const BUILDER_WORKSPACE_PREFERENCES_KEY = "orvesen.builder.workspace.v1";

export const DEFAULT_BUILDER_WORKSPACE_PREFERENCES = Object.freeze({
  globalSidebarCollapsed: true,
  paletteCollapsed: false,
});

export function readBuilderWorkspacePreferences(storage = globalThis.localStorage) {
  if (!storage) return { ...DEFAULT_BUILDER_WORKSPACE_PREFERENCES };
  try {
    const stored = JSON.parse(storage.getItem(BUILDER_WORKSPACE_PREFERENCES_KEY) || "null");
    return {
      globalSidebarCollapsed: stored?.globalSidebarCollapsed ?? true,
      paletteCollapsed: stored?.paletteCollapsed ?? false,
    };
  } catch {
    return { ...DEFAULT_BUILDER_WORKSPACE_PREFERENCES };
  }
}

export function writeBuilderWorkspacePreferences(preferences, storage = globalThis.localStorage) {
  if (!storage) return;
  storage.setItem(BUILDER_WORKSPACE_PREFERENCES_KEY, JSON.stringify({
    globalSidebarCollapsed: Boolean(preferences.globalSidebarCollapsed),
    paletteCollapsed: Boolean(preferences.paletteCollapsed),
  }));
}

export function clampBuilderZoom(zoom) {
  return Math.min(1.5, Math.max(0.25, zoom));
}

export function formatBuilderZoom(zoom) {
  return `${Math.round(clampBuilderZoom(zoom) * 100)}%`;
}

export function getBuilderNodePresentation(node, definition) {
  const customLabel = node.label?.trim() && node.label.trim() !== definition.defaultLabel
    ? node.label.trim()
    : null;
  return { typeLabel: definition.label, customLabel, statusLabel: node.asset_id ? "Asset vinculado" : "Sin configurar" };
}

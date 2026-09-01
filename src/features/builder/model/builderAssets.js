export const BUILDER_ASSET_TYPES = Object.freeze({
  landing_page: { label: "Página", nodeType: "landing_page" },
  form: { label: "Formulario", nodeType: "form" },
});

export function isBuilderAssetType(value) {
  return Object.hasOwn(BUILDER_ASSET_TYPES, value);
}

export function isAssetCompatibleWithNode(asset, node) {
  return Boolean(asset && node && asset.asset_type === node.node_type && asset.lifecycle === "draft");
}

export function builderAssetRoute(asset) {
  return `/construir/assets/${asset.asset_type}/${asset.id}`;
}

export function latestBuilderAssetVersion(versions = []) {
  return versions.reduce((latest, version) => (
    !latest || version.version_number > latest.version_number ? version : latest
  ), null);
}

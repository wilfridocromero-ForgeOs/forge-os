const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CLIENT_ID_PATTERN = /^[1-9][0-9]*$/;

function entitySurface(type, route, prefix, pattern = UUID_PATTERN) {
  const entityId = route.slice(prefix.length);
  return pattern.test(entityId)
    ? { type, route, entity_id: entityId }
    : null;
}

export function deriveOrbSurfaceContext(pathname, searchParams = null) {
  const route = typeof pathname === "string" ? pathname : "";
  if (route === "/") return { type: "dashboard", route };
  if (route === "/orvesen-ia") return { type: "orvesen_ai", route };
  if (route === "/clientes") return { type: "clients", route };
  if (route.startsWith("/proyectos/")) {
    const surface = entitySurface("project", route, "/proyectos/");
    const taskId = searchParams?.get?.("task");
    return surface && UUID_PATTERN.test(taskId || "")
      ? { ...surface, task_id: taskId }
      : surface;
  }
  if (route === "/proyectos") return { type: "projects", route };
  if (route.startsWith("/clientes/")) return entitySurface("client", route, "/clientes/", CLIENT_ID_PATTERN);
  if (route === "/discovery") return { type: "discovery", route };
  if (route === "/discovery/builder") return { type: "discovery_builder", route };
  if (route.startsWith("/discovery/evaluaciones/")) {
    const parts = route.split("/").filter(Boolean);
    const assessmentId = parts[2];
    if (parts.length <= 4 && UUID_PATTERN.test(assessmentId)) {
      return { type: "discovery", route, entity_id: assessmentId };
    }
    return null;
  }
  if (route === "/orvesen-score" || route === "/business-score") {
    return { type: "score", route };
  }
  if (route === "/calendario") return { type: "calendar", route };
  if (route === "/score-builder") return { type: "score_builder", route };
  if (route === "/construir") return { type: "builder_hub", route };
  if (route.startsWith("/construir/assets/")) {
    const parts = route.split("/").filter(Boolean);
    const assetType = parts[2];
    const assetId = parts[3];
    return parts.length === 4 && (assetType === "landing_page" || assetType === "form") && UUID_PATTERN.test(assetId || "")
      ? { type: "builder_asset", route, entity_id: assetId, asset_type: assetType }
      : null;
  }
  if (route.startsWith("/construir/sistemas/")) {
    const surface = entitySurface("builder_system", route, "/construir/sistemas/");
    const nodeId = searchParams?.get?.("node");
    const assetId = searchParams?.get?.("asset");
    return surface && UUID_PATTERN.test(nodeId || "")
      ? { ...surface, node_id: nodeId, ...(UUID_PATTERN.test(assetId || "") ? { asset_id: assetId } : {}) }
      : surface;
  }
  if (route === "/cerebro") return { type: "brain", route };
  if (route === "/configuracion" || route.startsWith("/configuracion/")) {
    return { type: "settings", route };
  }
  return null;
}

export function deriveOrbSurfaceFromSearch(searchParams) {
  const source = searchParams?.get?.("from");
  if (source === "dashboard") return deriveOrbSurfaceContext("/");
  if (source?.startsWith("/")) {
    const parsed = new URL(source, "https://orvesen.local");
    return deriveOrbSurfaceContext(parsed.pathname, parsed.searchParams);
  }
  return deriveOrbSurfaceContext("/orvesen-ia");
}

export function buildOrbDestination(pathname, search = "") {
  const searchParams = new URLSearchParams(search);
  const surface = deriveOrbSurfaceContext(pathname, searchParams);
  if (!surface || surface.type === "orvesen_ai") return "/orvesen-ia";
  const source = surface.task_id
    ? `${surface.route}?tab=work&task=${surface.task_id}`
    : surface.route;
  return `/orvesen-ia?from=${encodeURIComponent(source)}`;
}

export function buildOrbRequestPayload({ conversationId, clientMessageId, message, surface = null, timezone = null }) {
  return {
    conversation_id: conversationId,
    client_message_id: clientMessageId,
    message,
    ...(surface ? { surface } : {}),
    ...(timezone ? { timezone } : {}),
  };
}

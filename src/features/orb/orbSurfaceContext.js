const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function entitySurface(type, route, prefix) {
  const entityId = route.slice(prefix.length);
  return UUID_PATTERN.test(entityId)
    ? { type, route, entity_id: entityId }
    : null;
}

export function deriveOrbSurfaceContext(pathname) {
  const route = typeof pathname === "string" ? pathname : "";
  if (route === "/") return { type: "dashboard", route };
  if (route === "/orvesen-ia") return { type: "orvesen_ai", route };
  if (route.startsWith("/proyectos/")) return entitySurface("project", route, "/proyectos/");
  if (route.startsWith("/clientes/")) return entitySurface("client", route, "/clientes/");
  if (route === "/discovery") return { type: "discovery", route };
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
  return null;
}

export function deriveOrbSurfaceFromSearch(searchParams) {
  const source = searchParams?.get?.("from");
  if (source === "dashboard") return deriveOrbSurfaceContext("/");
  if (source?.startsWith("/")) return deriveOrbSurfaceContext(source);
  return deriveOrbSurfaceContext("/orvesen-ia");
}

export function buildOrbDestination(pathname) {
  const surface = deriveOrbSurfaceContext(pathname);
  if (!surface || surface.type === "orvesen_ai") return "/orvesen-ia";
  return `/orvesen-ia?from=${encodeURIComponent(surface.route)}`;
}

export function buildOrbRequestPayload({ conversationId, clientMessageId, message, surface = null }) {
  return {
    conversation_id: conversationId,
    client_message_id: clientMessageId,
    message,
    ...(surface ? { surface } : {}),
  };
}

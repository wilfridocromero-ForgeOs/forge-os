export const ORB_SURFACE_TYPES = [
  "dashboard",
  "orvesen_ai",
  "project",
  "client",
  "discovery",
  "score",
  "calendar",
] as const;

export type OrbSurfaceType = typeof ORB_SURFACE_TYPES[number];
export type OrbSurfaceContext = {
  type: OrbSurfaceType;
  route: string;
  entity_id?: string;
  label?: string;
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_SURFACE_BYTES = 512;
const MAX_LABEL_CHARS = 120;
const ALLOWED_KEYS = new Set(["type", "route", "entity_id", "label"]);

function validRoute(type: OrbSurfaceType, route: string, entityId?: string) {
  if (type === "dashboard") return route === "/" && !entityId;
  if (type === "orvesen_ai") return route === "/orvesen-ia" && !entityId;
  if (type === "project") {
    return Boolean(entityId) && route === `/proyectos/${entityId}`;
  }
  if (type === "client") {
    return Boolean(entityId) && route === `/clientes/${entityId}`;
  }
  if (type === "discovery") {
    return !entityId
      ? route === "/discovery"
      : route === `/discovery/evaluaciones/${entityId}` ||
        route === `/discovery/evaluaciones/${entityId}/resultado`;
  }
  if (type === "score") {
    return !entityId &&
      (route === "/orvesen-score" || route === "/business-score");
  }
  return type === "calendar" && route === "/calendario" && !entityId;
}

export function normalizeOrbSurfaceContext(
  value: unknown,
): OrbSurfaceContext | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  if (JSON.stringify(value).length > MAX_SURFACE_BYTES) return null;
  const candidate = value as Record<string, unknown>;

  // Backward compatibility for the Dashboard-only Fase 3A contract.
  if (
    Object.keys(candidate).length === 2 && candidate.module === "dashboard" &&
    candidate.route === "/"
  ) {
    return { type: "dashboard", route: "/" };
  }
  if (Object.keys(candidate).some((key) => !ALLOWED_KEYS.has(key))) return null;
  if (
    !ORB_SURFACE_TYPES.includes(candidate.type as OrbSurfaceType) ||
    typeof candidate.route !== "string"
  ) return null;

  const type = candidate.type as OrbSurfaceType;
  const entityId = typeof candidate.entity_id === "string" &&
      UUID_PATTERN.test(candidate.entity_id)
    ? candidate.entity_id
    : undefined;
  if (candidate.entity_id !== undefined && !entityId) return null;
  if (!validRoute(type, candidate.route, entityId)) return null;

  const label = typeof candidate.label === "string"
    ? candidate.label.trim()
    : undefined;
  if (
    candidate.label !== undefined && (!label || label.length > MAX_LABEL_CHARS)
  ) return null;
  return {
    type,
    route: candidate.route,
    ...(entityId ? { entity_id: entityId } : {}),
    ...(label ? { label } : {}),
  };
}

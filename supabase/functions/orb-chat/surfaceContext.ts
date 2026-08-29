export const ORB_SURFACE_TYPES = [
  "dashboard",
  "orvesen_ai",
  "clients",
  "project",
  "projects",
  "client",
  "discovery",
  "discovery_builder",
  "score",
  "score_builder",
  "calendar",
  "builder_hub",
  "brain",
  "settings",
] as const;

export type OrbSurfaceType = typeof ORB_SURFACE_TYPES[number];
export type OrbSurfaceContext = {
  type: OrbSurfaceType;
  route: string;
  entity_id?: string;
  task_id?: string;
  label?: string;
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CLIENT_ID_PATTERN = /^[1-9][0-9]*$/;
const MAX_SURFACE_BYTES = 512;
const MAX_LABEL_CHARS = 120;
const ALLOWED_KEYS = new Set([
  "type",
  "route",
  "entity_id",
  "task_id",
  "label",
]);

function validEntityId(type: OrbSurfaceType, entityId: string) {
  return type === "client"
    ? CLIENT_ID_PATTERN.test(entityId)
    : UUID_PATTERN.test(entityId);
}

function validRoute(type: OrbSurfaceType, route: string, entityId?: string) {
  if (type === "dashboard") return route === "/" && !entityId;
  if (type === "orvesen_ai") return route === "/orvesen-ia" && !entityId;
  if (type === "clients") return route === "/clientes" && !entityId;
  if (type === "project") {
    return Boolean(entityId) && route === `/proyectos/${entityId}`;
  }
  if (type === "client") {
    return Boolean(entityId) && route === `/clientes/${entityId}`;
  }
  if (type === "projects") return route === "/proyectos" && !entityId;
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
  if (type === "calendar") return route === "/calendario" && !entityId;
  if (type === "score_builder") return route === "/score-builder" && !entityId;
  if (type === "discovery_builder") {
    return route === "/discovery/builder" && !entityId;
  }
  if (type === "builder_hub") return route === "/construir" && !entityId;
  if (type === "brain") return route === "/cerebro" && !entityId;
  return type === "settings" &&
    (route === "/configuracion" || route.startsWith("/configuracion/")) &&
    !entityId;
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
      validEntityId(type, candidate.entity_id)
    ? candidate.entity_id
    : undefined;
  if (candidate.entity_id !== undefined && !entityId) return null;
  const taskId = typeof candidate.task_id === "string" &&
      UUID_PATTERN.test(candidate.task_id)
    ? candidate.task_id
    : undefined;
  if (candidate.task_id !== undefined && (!taskId || type !== "project")) {
    return null;
  }
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
    ...(taskId ? { task_id: taskId } : {}),
    ...(label ? { label } : {}),
  };
}

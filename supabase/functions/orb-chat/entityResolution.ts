export type ResolvableEntity = {
  id: string | number;
  name: string;
};

export type EntityResolution =
  | { state: "EXACT"; entity: ResolvableEntity }
  | {
    state: "UNIQUE_CANDIDATE";
    requested: string;
    candidates: Array<{ name: string }>;
  }
  | {
    state: "AMBIGUOUS";
    requested: string;
    candidates: Array<{ name: string }>;
  }
  | { state: "NOT_FOUND"; requested: string; candidates: [] };

const UNIQUE_THRESHOLD = 0.82;
const CANDIDATE_THRESHOLD = 0.72;
const UNIQUE_MARGIN = 0.08;
const MAX_CANDIDATES = 3;

export function normalizeEntityName(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("es")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function editDistance(left: string, right: string) {
  const previous = Array.from(
    { length: right.length + 1 },
    (_, index) => index,
  );
  for (let row = 1; row <= left.length; row += 1) {
    let diagonal = previous[0];
    previous[0] = row;
    for (let column = 1; column <= right.length; column += 1) {
      const above = previous[column];
      previous[column] = Math.min(
        previous[column] + 1,
        previous[column - 1] + 1,
        diagonal + (left[row - 1] === right[column - 1] ? 0 : 1),
      );
      diagonal = above;
    }
  }
  return previous[right.length];
}

function tokenDice(left: string, right: string) {
  const leftTokens = new Set(left.split(" ").filter(Boolean));
  const rightTokens = new Set(right.split(" ").filter(Boolean));
  if (!leftTokens.size && !rightTokens.size) return 1;
  let overlap = 0;
  for (const token of leftTokens) if (rightTokens.has(token)) overlap += 1;
  return (2 * overlap) / (leftTokens.size + rightTokens.size);
}

export function entityNameSimilarity(leftValue: string, rightValue: string) {
  const left = normalizeEntityName(leftValue);
  const right = normalizeEntityName(rightValue);
  if (!left || !right) return 0;
  if (left === right) return 1;
  const edit = 1 -
    editDistance(left, right) / Math.max(left.length, right.length);
  return Math.max(edit, edit * 0.75 + tokenDice(left, right) * 0.25);
}

export function resolveEntityName(
  requestedValue: string,
  authorizedEntities: ResolvableEntity[],
): EntityResolution {
  const requested = requestedValue.trim();
  const normalized = normalizeEntityName(requested);
  if (!normalized) return { state: "NOT_FOUND", requested, candidates: [] };

  const exact = authorizedEntities.filter((entity) =>
    normalizeEntityName(entity.name) === normalized
  );
  if (exact.length === 1) return { state: "EXACT", entity: exact[0] };

  const ranked = authorizedEntities
    .map((entity) => ({
      entity,
      score: entityNameSimilarity(requested, entity.name),
    }))
    .filter(({ score }) => score >= CANDIDATE_THRESHOLD)
    .sort((left, right) =>
      right.score - left.score ||
      left.entity.name.localeCompare(right.entity.name)
    )
    .slice(0, MAX_CANDIDATES);

  if (!ranked.length) return { state: "NOT_FOUND", requested, candidates: [] };
  const [first, second] = ranked;
  if (
    first.score >= UNIQUE_THRESHOLD &&
    (!second || first.score - second.score >= UNIQUE_MARGIN)
  ) {
    return {
      state: "UNIQUE_CANDIDATE",
      requested,
      candidates: [{ name: first.entity.name }],
    };
  }
  return {
    state: "AMBIGUOUS",
    requested,
    candidates: ranked.map(({ entity }) => ({ name: entity.name })),
  };
}

export function entityResolutionMessage(
  entityLabel: "proyecto" | "cliente" | "responsable",
  resolution: EntityResolution,
) {
  if (resolution.state === "UNIQUE_CANDIDATE") {
    return `No encontré un ${entityLabel} llamado “${resolution.requested}”. ¿Te refieres a “${
      resolution.candidates[0].name
    }”?`;
  }
  if (resolution.state === "AMBIGUOUS") {
    const choices = resolution.candidates.map(({ name }) => `- ${name}`).join(
      "\n",
    );
    return `Encontré más de un ${entityLabel} parecido:\n${choices}\n¿Cuál quieres usar?`;
  }
  if (resolution.state === "NOT_FOUND") {
    return `No encontré un ${entityLabel} llamado “${resolution.requested}”. ¿Quieres revisar el nombre?`;
  }
  return null;
}

export function readTerminalEntityResolution(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const wrapper = value as { status?: unknown; data?: unknown };
  if (
    wrapper.status !== "ok" || !wrapper.data || typeof wrapper.data !== "object"
  ) return null;
  const data = wrapper.data as { entity_type?: unknown; resolution?: unknown };
  if (
    data.entity_type !== "project" && data.entity_type !== "client" &&
    data.entity_type !== "assignee"
  ) {
    return null;
  }
  const resolution = data.resolution as EntityResolution | undefined;
  if (!resolution || resolution.state === "EXACT") return null;
  return entityResolutionMessage(
    data.entity_type === "project"
      ? "proyecto"
      : data.entity_type === "client"
      ? "cliente"
      : "responsable",
    resolution,
  );
}

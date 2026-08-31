import {
  deriveOrganizationalIntelligence,
  loadOrganizationalIntelligence,
  type OrganizationalSourceData,
} from "./organizationalIntelligence.ts";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

const NOW = new Date("2026-08-30T12:00:00.000Z");
function fixture(
  overrides: Partial<OrganizationalSourceData> = {},
): OrganizationalSourceData {
  return {
    score: {
      status: "available",
      snapshot: { id: "score-1", coverage_percentage: 92, status: "partial" },
      divisions: [
        {
          division_id: "media",
          division_name: "Media",
          represented: true,
          performance_percentage: 38,
          coverage_percentage: 90,
        },
        {
          division_id: "os",
          division_name: "OS",
          represented: true,
          performance_percentage: 82,
          coverage_percentage: 95,
        },
      ],
    },
    discovery: {
      status: "available",
      assessments: [{
        id: "discovery-1",
        division_id: "media",
        status: "completed",
      }],
    },
    execution: { status: "empty", projects: [], tasks: [] },
    calendar: { status: "empty", items: [] },
    ...overrides,
  };
}

Deno.test("weak Score plus completed Discovery and no execution becomes a high evidence-backed priority", () => {
  const result = deriveOrganizationalIntelligence(fixture(), NOW);
  const signal = result.signals.find((item) =>
    item.kind === "diagnostic_score_alignment"
  );
  assert(signal?.level === "high", "high priority");
  assert(
    signal?.relationship === "same_division",
    "explicit division alignment",
  );
  assert(signal?.evidence.length === 3, "traceable evidence");
  assert(!signal?.conclusion.includes("caus"), "no causality claim");
});

Deno.test("active execution in the same division is acknowledged without claiming it resolves the finding", () => {
  const result = deriveOrganizationalIntelligence(
    fixture({
      execution: {
        status: "available",
        projects: [{ id: "project-1", division_id: "media", status: "active" }],
        tasks: [],
      },
    }),
    NOW,
  );
  const signal = result.signals.find((item) =>
    item.kind === "diagnostic_score_alignment"
  );
  assert(signal?.level === "medium", "existing execution lowers urgency");
  assert(
    Boolean(signal?.conclusion.includes("sin afirmar")),
    "conservative relationship",
  );
  assert(
    !signal?.conclusion.includes("resuelve el hallazgo"),
    "no fake linkage",
  );
});

Deno.test("overdue and blocked work surfaces an execution risk", () => {
  const result = deriveOrganizationalIntelligence(
    fixture({
      execution: {
        status: "available",
        projects: [{ id: "project-1", division_id: "os", status: "active" }],
        tasks: [{
          id: "task-1",
          status: "blocked",
          assigned_to: "user-1",
          due_at: "2026-08-29T12:00:00.000Z",
        }],
      },
    }),
    NOW,
  );
  const risk = result.signals.find((item) => item.kind === "execution_risk");
  assert(risk?.level === "critical", "blocked overdue work is critical");
  assert(risk?.evidence[0].entity_id === "task-1", "task provenance");
});

Deno.test("high Score with incomplete coverage retains a measurement warning", () => {
  const data = fixture();
  data.score.snapshot = {
    id: "score-1",
    master_score: 900,
    coverage_percentage: 72,
    status: "partial",
  };
  data.score.divisions = [{
    division_id: "os",
    division_name: "OS",
    represented: true,
    performance_percentage: 90,
  }];
  const result = deriveOrganizationalIntelligence(data, NOW);
  assert(
    result.signals.some((item) => item.kind === "measurement_gap"),
    "coverage gap",
  );
  assert(
    result.limitations.some((item) => item.includes("causalidad")),
    "truthfulness limitation",
  );
});

Deno.test("absence of completed Discovery is reported as limited evidence", () => {
  const data = fixture();
  data.discovery.assessments = [];
  data.discovery.status = "empty";
  const result = deriveOrganizationalIntelligence(data, NOW);
  assert(
    result.limitations.some((item) =>
      item.includes("No hay Discovery completado")
    ),
    "limited diagnostics",
  );
});

Deno.test("unavailable and unauthorized sources never become zero-valued facts", () => {
  const result = deriveOrganizationalIntelligence(
    fixture({
      discovery: { status: "unauthorized", assessments: [] },
      execution: { status: "unavailable", projects: [], tasks: [] },
    }),
    NOW,
  );
  assert(
    result.limitations.some((item) => item.includes("no se infiere contenido")),
    "unauthorized boundary",
  );
  assert(
    result.limitations.some((item) =>
      item.includes("no se interpreta como cero")
    ),
    "unavailable boundary",
  );
});

Deno.test("client reasoning remains outside the organization-wide snapshot", () => {
  const result = deriveOrganizationalIntelligence(fixture(), NOW);
  assert(!("clients" in result.sources), "client data is surface-specific");
  assert(
    JSON.stringify(result).length < 12000,
    "bounded token-conscious snapshot",
  );
});

Deno.test("source denials execute no business query", async () => {
  let queried = false;
  const client = {
    from() {
      queried = true;
      throw new Error("unauthorized source queried");
    },
  };
  const result = await loadOrganizationalIntelligence(
    client as never,
    "organization-1",
    {
      intelligence: true,
      projects: false,
      discovery: false,
      area_score: false,
      clients: false,
      calendar: false,
    },
    NOW,
  );
  assert(!queried, "no denied source query");
  assert(
    Object.values(result.sources).every((source) =>
      source.status === "unauthorized"
    ),
    "every denied source remains unauthorized",
  );
});

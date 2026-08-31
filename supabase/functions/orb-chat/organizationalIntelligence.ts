import type { SupabaseClient } from "@supabase/supabase-js";
import type { OrbToolPermissions } from "./tools/authorization.ts";

const ACTIVE_PROJECT_STATUSES = ["planned", "active", "blocked"];
const OPEN_TASK_STATUSES = ["pending", "in_progress", "blocked"];
const COLLECTION_LIMITS = Object.freeze({
  assessments: 3,
  categoriesPerAssessment: 3,
  projects: 6,
  tasks: 10,
  calendar: 5,
  signals: 6,
});

type SourceStatus = "available" | "empty" | "unavailable" | "unauthorized";
type Evidence = {
  module: "score" | "discovery" | "projects" | "tasks" | "calendar";
  entity_type: string;
  entity_id: string | null;
  metric: string;
  value: string | number | null;
};
type IntelligenceSignal = {
  kind: string;
  level: "critical" | "high" | "medium" | "low";
  confidence: "high" | "medium" | "low";
  relationship: "direct" | "same_division" | "none";
  conclusion: string;
  evidence: Evidence[];
};

export type OrganizationalSourceData = {
  score: {
    status: SourceStatus;
    snapshot: Record<string, unknown> | null;
    divisions: Array<Record<string, unknown>>;
  };
  discovery: {
    status: SourceStatus;
    assessments: Array<Record<string, unknown>>;
  };
  execution: {
    status: SourceStatus;
    projects: Array<Record<string, unknown>>;
    tasks: Array<Record<string, unknown>>;
  };
  calendar: {
    status: SourceStatus;
    items: Array<Record<string, unknown>>;
  };
};

function numeric(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

function boundedText(value: unknown, maximum = 180): string | null {
  const normalized = stringValue(value)?.trim();
  return normalized ? normalized.slice(0, maximum) : null;
}

function relation(value: unknown): Record<string, unknown> | null {
  if (Array.isArray(value)) return value[0] as Record<string, unknown> ?? null;
  return value && typeof value === "object"
    ? value as Record<string, unknown>
    : null;
}

function sourceStatus(authorized: boolean, failed: boolean, count: number) {
  if (!authorized) return "unauthorized" as const;
  if (failed) return "unavailable" as const;
  return count ? "available" as const : "empty" as const;
}

function rank(level: IntelligenceSignal["level"]) {
  return { critical: 4, high: 3, medium: 2, low: 1 }[level];
}

export function deriveOrganizationalIntelligence(
  sources: OrganizationalSourceData,
  now = new Date(),
) {
  const signals: IntelligenceSignal[] = [];
  const scoreDivisions = sources.score.divisions.flatMap((row) => {
    const performance = numeric(row.performance_percentage);
    const divisionId = stringValue(row.division_id);
    if (performance == null || !divisionId || row.represented === false) {
      return [];
    }
    return [{
      id: divisionId,
      name: stringValue(row.division_name) || "División",
      performance,
      coverage: numeric(row.coverage_percentage),
    }];
  }).sort((left, right) => left.performance - right.performance);

  if (scoreDivisions.length) {
    const weakest = scoreDivisions[0];
    const strongest = scoreDivisions.at(-1) || weakest;
    const materiallyWeaker = weakest.performance < 60 ||
      strongest.performance - weakest.performance >= 10;
    if (materiallyWeaker) {
      signals.push({
        kind: "score_weakness",
        level: weakest.performance < 40 ? "high" : "medium",
        confidence: "high",
        relationship: "direct",
        conclusion:
          `${weakest.name} es la división evaluada más débil en el Score actual.`,
        evidence: [{
          module: "score",
          entity_type: "division",
          entity_id: weakest.id,
          metric: "performance_percentage",
          value: weakest.performance,
        }],
      });
    }
  }

  const scoreSnapshot = sources.score.snapshot;
  const coverage = numeric(scoreSnapshot?.coverage_percentage);
  if (coverage != null && coverage < 100) {
    signals.push({
      kind: "measurement_gap",
      level: coverage < 60 ? "high" : "medium",
      confidence: "high",
      relationship: "direct",
      conclusion:
        "El Score no cubre todavía toda la organización; cualquier lectura general debe presentarse con su cobertura.",
      evidence: [{
        module: "score",
        entity_type: "company_score_snapshot",
        entity_id: stringValue(scoreSnapshot?.id),
        metric: "coverage_percentage",
        value: coverage,
      }],
    });
  }

  const openTasks = sources.execution.tasks.filter((task) =>
    OPEN_TASK_STATUSES.includes(String(task.status || ""))
  );
  const overdue = openTasks.filter((task) => {
    const dueAt = stringValue(task.due_at);
    return dueAt ? new Date(dueAt) < now : false;
  });
  if (overdue.length) {
    signals.push({
      kind: "execution_risk",
      level: overdue.some((task) => task.status === "blocked")
        ? "critical"
        : "high",
      confidence: "high",
      relationship: "direct",
      conclusion: `Hay ${overdue.length} ${
        overdue.length === 1 ? "tarea vencida" : "tareas vencidas"
      } dentro del trabajo visible.`,
      evidence: overdue.slice(0, 3).map((task) => ({
        module: "tasks",
        entity_type: "project_task",
        entity_id: stringValue(task.id),
        metric: "due_at",
        value: stringValue(task.due_at),
      })),
    });
  }
  const unassigned = openTasks.filter((task) => !task.assigned_to);
  if (unassigned.length) {
    signals.push({
      kind: "responsibility_gap",
      level: "medium",
      confidence: "high",
      relationship: "direct",
      conclusion: `Hay ${unassigned.length} ${
        unassigned.length === 1
          ? "tarea abierta sin responsable"
          : "tareas abiertas sin responsable"
      }.`,
      evidence: unassigned.slice(0, 3).map((task) => ({
        module: "tasks",
        entity_type: "project_task",
        entity_id: stringValue(task.id),
        metric: "assigned_to",
        value: null,
      })),
    });
  }

  const activeDivisionIds = new Set(
    sources.execution.projects.map((project) =>
      stringValue(project.division_id)
    )
      .filter((value): value is string => Boolean(value)),
  );
  for (const assessment of sources.discovery.assessments) {
    if (assessment.status !== "completed") continue;
    const divisionId = stringValue(assessment.division_id);
    if (!divisionId) continue;
    const scoreDivision = scoreDivisions.find((item) => item.id === divisionId);
    const projectInDivision = activeDivisionIds.has(divisionId);
    if (scoreDivision && scoreDivision.performance < 60) {
      signals.push({
        kind: "diagnostic_score_alignment",
        level: projectInDivision ? "medium" : "high",
        confidence: "high",
        relationship: "same_division",
        conclusion: projectInDivision
          ? `${scoreDivision.name} combina un Score débil con un diagnóstico completado; existe ejecución activa en la misma división, sin afirmar que resuelva cada hallazgo.`
          : `${scoreDivision.name} combina un Score débil con un diagnóstico completado y no muestra un proyecto activo en esa división.`,
        evidence: [
          {
            module: "score",
            entity_type: "division",
            entity_id: divisionId,
            metric: "performance_percentage",
            value: scoreDivision.performance,
          },
          {
            module: "discovery",
            entity_type: "assessment",
            entity_id: stringValue(assessment.id),
            metric: "status",
            value: "completed",
          },
          {
            module: "projects",
            entity_type: "division_execution",
            entity_id: divisionId,
            metric: "active_project_visible",
            value: projectInDivision ? 1 : 0,
          },
        ],
      });
    } else if (!projectInDivision) {
      signals.push({
        kind: "completed_diagnostic_without_follow_up",
        level: "medium",
        confidence: "medium",
        relationship: "same_division",
        conclusion:
          "Existe un diagnóstico completado sin un proyecto activo visible en la misma división; esto no prueba que sus hallazgos estén totalmente desatendidos.",
        evidence: [{
          module: "discovery",
          entity_type: "assessment",
          entity_id: stringValue(assessment.id),
          metric: "division_id",
          value: divisionId,
        }],
      });
    }
  }

  const completedDiscoveries =
    sources.discovery.assessments.filter((item) => item.status === "completed")
      .length;
  const limitations = [
    ...((sources.discovery.status === "available" ||
        sources.discovery.status === "empty") && !completedDiscoveries
      ? [
        "No hay Discovery completado entre los diagnósticos recientes autorizados.",
      ]
      : []),
    ...Object.entries(sources).filter(([, source]) =>
      source.status === "unauthorized" || source.status === "unavailable"
    ).map(([name, source]) =>
      source.status === "unauthorized"
        ? `${name}: fuente no autorizada; no se infiere contenido.`
        : `${name}: fuente temporalmente no disponible; no se interpreta como cero.`
    ),
    "No existen vínculos explícitos entre categorías Discovery y proyectos/tareas; las coincidencias por división son contexto, no causalidad.",
    "La mejora o deterioro histórico no se infiere sin snapshots comparables.",
  ];

  const prioritized = signals.sort((left, right) =>
    rank(right.level) - rank(left.level)
  ).slice(0, COLLECTION_LIMITS.signals);
  return {
    generated_at: now.toISOString(),
    scope: "active_organization",
    sources,
    signals: prioritized,
    recommended_focus: prioritized[0]
      ? {
        level: prioritized[0].level,
        kind: prioritized[0].kind,
        conclusion: prioritized[0].conclusion,
        basis: "deterministic_evidence",
      }
      : null,
    limitations,
    collection_limits: COLLECTION_LIMITS,
  };
}

export async function loadOrganizationalIntelligence(
  client: SupabaseClient,
  organizationId: string,
  permissions: OrbToolPermissions,
  now = new Date(),
) {
  let scoreFailed = false;
  let discoveryFailed = false;
  let executionFailed = false;
  let calendarFailed = false;
  let snapshot: Record<string, unknown> | null = null;
  let divisions: Array<Record<string, unknown>> = [];
  let assessments: Array<Record<string, unknown>> = [];
  let projects: Array<Record<string, unknown>> = [];
  let tasks: Array<Record<string, unknown>> = [];
  let calendarItems: Array<Record<string, unknown>> = [];

  if (permissions.area_score) {
    const result = await client.from("company_score_snapshots").select(
      "id,master_score,performance_percentage,coverage_percentage,status,calculated_at",
    ).eq("organization_id", organizationId).order("calculated_at", {
      ascending: false,
    }).limit(1).maybeSingle();
    scoreFailed = Boolean(result.error);
    snapshot = result.data as Record<string, unknown> | null;
    if (!scoreFailed && snapshot?.id) {
      const components = await client.from("company_score_snapshot_components")
        .select(
          "division_id,represented,division_performance_percentage,division_coverage_percentage,division:divisions!inner(id,name,organization_id)",
        )
        .eq("snapshot_id", snapshot.id).eq("organization_id", organizationId)
        .eq("division.organization_id", organizationId).limit(12);
      scoreFailed = Boolean(components.error);
      divisions = (components.data || []).map((row) => {
        const division = relation(row.division);
        return {
          division_id: row.division_id,
          division_name: division?.name ?? null,
          represented: row.represented,
          performance_percentage: row.division_performance_percentage,
          coverage_percentage: row.division_coverage_percentage,
        };
      });
    }
  }

  if (permissions.discovery) {
    const result = await client.from("discovery_assessments").select(
      "id,status,division_id,score,max_score,maturity_level,completed_at,updated_at",
    ).eq("organization_id", organizationId).eq("status", "completed")
      .order("completed_at", { ascending: false, nullsFirst: false })
      .limit(COLLECTION_LIMITS.assessments);
    discoveryFailed = Boolean(result.error);
    assessments = (result.data || []).map((row) => ({
      id: row.id,
      status: row.status,
      division_id: row.division_id,
      score: row.score,
      max_score: row.max_score,
      maturity_level: boundedText(row.maturity_level, 80),
      completed_at: row.completed_at,
      updated_at: row.updated_at,
    }));
    if (!discoveryFailed && assessments.length) {
      const ids = assessments.map((item) => String(item.id));
      const categories = await client.from("discovery_category_results")
        .select(
          "assessment_id,category_id,percentage,status,category:score_categories!inner(id,name)",
        )
        .in("assessment_id", ids).order("percentage", { ascending: true })
        .limit(
          COLLECTION_LIMITS.assessments *
            COLLECTION_LIMITS.categoriesPerAssessment,
        );
      discoveryFailed = Boolean(categories.error);
      if (!discoveryFailed) {
        assessments = assessments.map((assessment) => ({
          ...assessment,
          weakest_categories: (categories.data || []).filter((row) =>
            row.assessment_id === assessment.id
          ).slice(0, COLLECTION_LIMITS.categoriesPerAssessment).map((row) => ({
            category_id: row.category_id,
            name: boundedText(relation(row.category)?.name, 120),
            percentage: row.percentage,
            status: row.status,
          })),
        }));
      }
    }
  }

  if (permissions.projects) {
    const [projectResult, taskResult] = await Promise.all([
      client.from("projects").select(
        "id,name,status,progress,division_id,starts_at,due_at,updated_at",
      ).eq("organization_id", organizationId).in(
        "status",
        ACTIVE_PROJECT_STATUSES,
      )
        .order("updated_at", { ascending: false }).limit(
          COLLECTION_LIMITS.projects,
        ),
      client.from("project_tasks").select(
        "id,project_id,title,status,priority,assigned_to,starts_at,due_at,project:projects!inner(id,name,organization_id,division_id)",
      ).eq("project.organization_id", organizationId).eq(
        "is_recurrence_template",
        false,
      )
        .in("status", OPEN_TASK_STATUSES).order("due_at", {
          ascending: true,
          nullsFirst: false,
        })
        .limit(COLLECTION_LIMITS.tasks),
    ]);
    executionFailed = Boolean(projectResult.error || taskResult.error);
    projects = (projectResult.data || []).map((row) => ({
      id: row.id,
      name: boundedText(row.name, 100),
      status: row.status,
      progress: row.progress,
      division_id: row.division_id,
      starts_at: row.starts_at,
      due_at: row.due_at,
      updated_at: row.updated_at,
    }));
    tasks = (taskResult.data || []).map((row) => ({
      id: row.id,
      project_id: row.project_id,
      title: boundedText(row.title, 140),
      status: row.status,
      priority: row.priority,
      assigned_to: row.assigned_to,
      starts_at: row.starts_at,
      due_at: row.due_at,
    }));
  }

  if (permissions.calendar) {
    const horizon = new Date(now);
    horizon.setUTCDate(horizon.getUTCDate() + 7);
    const result = await client.from("calendar_events").select(
      "id,title,starts_at,ends_at,event_type,status,priority",
    ).eq("organization_id", organizationId).neq("status", "cancelled")
      .gte("starts_at", now.toISOString()).lt(
        "starts_at",
        horizon.toISOString(),
      )
      .order("starts_at").limit(COLLECTION_LIMITS.calendar);
    calendarFailed = Boolean(result.error);
    calendarItems = (result.data || []).map((row) => ({
      id: row.id,
      title: boundedText(row.title, 120),
      starts_at: row.starts_at,
      ends_at: row.ends_at,
      event_type: row.event_type,
      status: row.status,
      priority: row.priority,
    }));
  }

  if (scoreFailed) {
    snapshot = null;
    divisions = [];
  }
  if (discoveryFailed) assessments = [];
  if (executionFailed) {
    projects = [];
    tasks = [];
  }
  if (calendarFailed) calendarItems = [];

  return deriveOrganizationalIntelligence({
    score: {
      status: sourceStatus(
        permissions.area_score,
        scoreFailed,
        snapshot ? 1 : 0,
      ),
      snapshot,
      divisions,
    },
    discovery: {
      status: sourceStatus(
        permissions.discovery,
        discoveryFailed,
        assessments.length,
      ),
      assessments,
    },
    execution: {
      status: sourceStatus(
        permissions.projects,
        executionFailed,
        projects.length + tasks.length,
      ),
      projects,
      tasks,
    },
    calendar: {
      status: sourceStatus(
        permissions.calendar,
        calendarFailed,
        calendarItems.length,
      ),
      items: calendarItems,
    },
  }, now);
}

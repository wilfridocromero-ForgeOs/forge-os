import type { SupabaseClient } from "@supabase/supabase-js";

const OPEN_TASK_STATUSES = ["pending", "in_progress", "blocked"];
const ACTIVE_PROJECT_STATUSES = ["planned", "active", "blocked"];
const COLLECTION_LIMIT = 5;
const DASHBOARD_ADMIN_ROLES = new Set(["founder", "admin"]);

export type DashboardContextPermissions = {
  dashboard: boolean;
  clients: boolean;
  projects: boolean;
  discovery: boolean;
  calendar: boolean;
  score: boolean;
};

const DENIED_PERMISSIONS: DashboardContextPermissions = {
  dashboard: false,
  clients: false,
  projects: false,
  discovery: false,
  calendar: false,
  score: false,
};

async function readSource<T>(
  loader: () => PromiseLike<
    { data: T | null; error: unknown; count?: number | null }
  >,
  fallback: T,
) {
  try {
    const result = await loader();
    if (result.error) {
      return {
        available: false,
        status: "unavailable" as const,
        data: fallback,
        count: undefined,
      };
    }
    return {
      available: true,
      status: (result.count === 0 ||
          (result.count == null &&
            (result.data === null ||
              (Array.isArray(result.data) && result.data.length === 0))))
        ? "empty" as const
        : "available" as const,
      data: result.data ?? fallback,
      count: result.count ?? undefined,
    };
  } catch {
    return {
      available: false,
      status: "unavailable" as const,
      data: fallback,
      count: undefined,
    };
  }
}

function relation<T>(value: T | T[] | null | undefined): T | null {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

function unauthorized<T>(fallback: T) {
  return {
    available: false,
    status: "unauthorized" as const,
    data: fallback,
    count: undefined,
  };
}

export async function getDashboardContextPermissions(
  client: SupabaseClient,
  userId: string,
  role: string,
): Promise<DashboardContextPermissions> {
  if (DASHBOARD_ADMIN_ROLES.has(role)) {
    return {
      dashboard: true,
      clients: true,
      projects: true,
      discovery: true,
      calendar: true,
      score: true,
    };
  }
  try {
    const { data, error } = await client.from("member_module_access").select(
      "module_key,enabled",
    ).eq("user_id", userId);
    if (error) return { ...DENIED_PERMISSIONS };
    const configured = new Map(
      (data || []).map((
        item: { module_key: string; enabled: boolean },
      ) => [item.module_key, item.enabled]),
    );
    const access = (key: string, fallback: boolean) =>
      configured.has(key) ? configured.get(key) === true : fallback;
    const dashboard = access("dashboard", true);
    return {
      dashboard,
      clients: dashboard && access("clients", true),
      projects: dashboard && access("projects", true),
      discovery: dashboard && access("discovery", true),
      calendar: dashboard,
      score: dashboard && access("area_score", false),
    };
  } catch {
    return { ...DENIED_PERMISSIONS };
  }
}

export async function getAuthorizedDashboardContext(
  client: SupabaseClient,
  organizationId: string,
  userId: string,
  permissions: DashboardContextPermissions,
  now = new Date(),
) {
  const horizon = new Date(now);
  horizon.setUTCDate(horizon.getUTCDate() + 7);
  const [clients, projects, tasks, discovery, calendar, score] = await Promise
    .all([
      permissions.clients
        ? readSource(
          () =>
            client.from("clients").select("id", { count: "exact", head: true })
              .eq("organization_id", organizationId),
          [],
        )
        : Promise.resolve(unauthorized([])),
      permissions.projects
        ? readSource(
          () =>
            client.from("projects").select("id", { count: "exact", head: true })
              .eq("organization_id", organizationId).in(
                "status",
                ACTIVE_PROJECT_STATUSES,
              ),
          [],
        )
        : Promise.resolve(unauthorized([])),
      permissions.projects
        ? readSource(
          () =>
            client.from("project_tasks").select(
              "id,project_id,status,assigned_to,due_at,project:projects!inner(id,name,organization_id)",
              { count: "exact" },
            ).eq("project.organization_id", organizationId).eq(
              "is_recurrence_template",
              false,
            ).in("status", OPEN_TASK_STATUSES).order("due_at", {
              nullsFirst: false,
            }).limit(100),
          [],
        )
        : Promise.resolve(unauthorized([])),
      permissions.discovery
        ? readSource(
          () =>
            client.from("discovery_assessments").select("id", {
              count: "exact",
              head: true,
            }).eq("organization_id", organizationId).eq(
              "status",
              "in_progress",
            ),
          [],
        )
        : Promise.resolve(unauthorized([])),
      permissions.calendar
        ? readSource(
          () =>
            client.from("calendar_events").select(
              "id,starts_at,assigned_to,created_by",
            ).eq("organization_id", organizationId).eq("status", "scheduled")
              .gte(
                "starts_at",
                now.toISOString(),
              ).lt("starts_at", horizon.toISOString()).limit(50),
          [],
        )
        : Promise.resolve(unauthorized([])),
      permissions.score
        ? readSource(
          () =>
            client.from("company_score_snapshots").select(
              "id,master_score,performance_percentage,coverage_percentage,status,calculated_at",
            ).eq("organization_id", organizationId).order("calculated_at", {
              ascending: false,
            }).limit(1).maybeSingle(),
          null,
        )
        : Promise.resolve(unauthorized(null)),
    ]);
  const taskRows = Array.isArray(tasks.data) ? tasks.data : [];
  const tasksTruncated = tasks.available && typeof tasks.count === "number" &&
    tasks.count > taskRows.length;
  const projectWork = new Map<
    string,
    {
      entity_id: string;
      name: string;
      open_tasks: number;
      overdue_tasks: number;
    }
  >();
  for (const row of taskRows) {
    const project = relation<
      { id: string; name: string; organization_id: string }
    >(row.project);
    if (!project || project.organization_id !== organizationId) continue;
    const current = projectWork.get(project.id) ??
      {
        entity_id: project.id,
        name: String(project.name || "Proyecto").slice(0, 120),
        open_tasks: 0,
        overdue_tasks: 0,
      };
    current.open_tasks += 1;
    if (row.due_at && new Date(row.due_at) < now) current.overdue_tasks += 1;
    projectWork.set(project.id, current);
  }
  const calendarRows = Array.isArray(calendar.data) ? calendar.data : [];
  const visibleCalendar = calendarRows.filter((row) =>
    row.assigned_to === userId || row.created_by === userId
  );
  const scoreRow = score.data && typeof score.data === "object"
    ? score.data as Record<string, unknown>
    : null;
  return {
    module: "dashboard",
    generated_at: now.toISOString(),
    freshness: { mode: "live", generated_at: now.toISOString() },
    sources: {
      clients: {
        available: clients.available,
        status: clients.status,
        active_count: clients.available ? clients.count ?? 0 : null,
      },
      projects: {
        available: projects.available,
        status: projects.status,
        active_count: projects.available ? projects.count ?? 0 : null,
      },
      tasks: {
        available: tasks.available,
        status: tasks.status,
        open_count: tasks.available ? tasks.count ?? taskRows.length : null,
        overdue_count: tasks.available && !tasksTruncated
          ? taskRows.filter((row) => row.due_at && new Date(row.due_at) < now)
            .length
          : null,
        assigned_to_me_count: tasks.available && !tasksTruncated
          ? taskRows.filter((row) => row.assigned_to === userId).length
          : null,
        details_truncated: tasksTruncated,
        project_concentration: [...projectWork.values()].sort((a, b) =>
          b.open_tasks - a.open_tasks
        ).slice(0, COLLECTION_LIMIT),
      },
      discovery: {
        available: discovery.available,
        status: discovery.status,
        in_progress_count: discovery.available ? discovery.count ?? 0 : null,
      },
      calendar: {
        available: calendar.available,
        status: calendar.status,
        upcoming_7_days_count: calendar.available
          ? visibleCalendar.length
          : null,
      },
      score: {
        available: score.available,
        status: score.status,
        entity_id: scoreRow?.id ?? null,
        master_score: scoreRow?.master_score ?? null,
        performance_percentage: scoreRow?.performance_percentage ?? null,
        coverage_percentage: scoreRow?.coverage_percentage ?? null,
        score_status: scoreRow?.status ?? null,
        calculated_at: scoreRow?.calculated_at ?? null,
      },
    },
  };
}

export async function loadDashboardContextSafely(
  client: SupabaseClient,
  organizationId: string,
  userId: string,
  role: string,
  report: (message: string, detail: Record<string, string>) => void =
    console.error,
  provider: typeof getAuthorizedDashboardContext =
    getAuthorizedDashboardContext,
) {
  try {
    const permissions = await getDashboardContextPermissions(
      client,
      userId,
      role,
    );
    if (!permissions.dashboard) return null;
    return await provider(client, organizationId, userId, permissions);
  } catch {
    report("Orb dashboard context unavailable", {
      code: "DASHBOARD_CONTEXT_UNAVAILABLE",
    });
    return null;
  }
}

import type { SupabaseClient } from "@supabase/supabase-js";
import type { OrbToolPermission, OrbToolPermissions } from "./authorization.ts";
import { resolveEntityName } from "../entityResolution.ts";

const MAX_LIMIT = 25;
const DEFAULT_LIMIT = 10;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PROJECT_STATUSES = [
  "planned",
  "active",
  "blocked",
  "completed",
  "archived",
];
const TASK_SCOPES = ["open", "overdue", "mine", "upcoming", "all"];
const ASSESSMENT_STATUSES = ["in_progress", "completed"];
const CLIENT_STATUSES = ["lead", "active", "inactive", "archived"];

type Context = {
  client: SupabaseClient;
  organizationId: string;
  userId: string;
  conversationId?: string;
  userMessageId?: string;
  permissions: OrbToolPermissions;
  resolution?: {
    exactProjectIds: Set<string>;
    exactClientIds: Set<number>;
  };
  now?: Date;
};
type Definition = {
  name: string;
  description: string;
  permission: OrbToolPermission;
  parameters: Record<string, unknown>;
  handler: (ctx: Context, args: Record<string, unknown>) => Promise<unknown>;
};

function objectSchema(
  properties: Record<string, unknown>,
  required: string[] = [],
) {
  return { type: "object", properties, required, additionalProperties: false };
}
function limit(value: unknown) {
  if (value == null) return DEFAULT_LIMIT;
  if (
    !Number.isInteger(value) || Number(value) < 1 || Number(value) > MAX_LIMIT
  ) throw new Error("INVALID_ARGUMENTS");
  return Number(value);
}
function text(value: unknown, max = 120) {
  if (value == null || value === "") return null;
  if (typeof value !== "string" || value.length > max) {
    throw new Error("INVALID_ARGUMENTS");
  }
  return value.trim() || null;
}
function enumValue(value: unknown, allowed: string[]) {
  if (value == null || value === "") return null;
  if (typeof value !== "string" || !allowed.includes(value)) {
    throw new Error("INVALID_ARGUMENTS");
  }
  return value;
}
function uuid(value: unknown) {
  if (typeof value !== "string" || !UUID.test(value)) {
    throw new Error("INVALID_ARGUMENTS");
  }
  return value;
}
function positiveInteger(value: unknown) {
  if (!Number.isSafeInteger(value) || Number(value) < 1) {
    throw new Error("INVALID_ARGUMENTS");
  }
  return Number(value);
}
function assertKeys(args: Record<string, unknown>, allowed: string[]) {
  if (
    !args || Array.isArray(args) || typeof args !== "object" ||
    Object.keys(args).some((key) => !allowed.includes(key))
  ) throw new Error("INVALID_ARGUMENTS");
}
function relation<T>(value: T | T[] | null): T | null {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}
function safeError(error: unknown) {
  if (error instanceof Error && error.message === "ENTITY_NOT_RESOLVED") {
    return "entity_not_resolved";
  }
  return error instanceof Error && error.message === "INVALID_ARGUMENTS"
    ? "invalid_arguments"
    : "unavailable";
}

const definitions: Definition[] = [
  {
    name: "resolve_project",
    description:
      "Resuelve de forma determinista un nombre de proyecto visible. Para acciones por nombre, úsala antes de prepare_create_project_task. Solo EXACT autoriza reutilizar el project_id; cualquier candidato requiere aclaración del usuario.",
    permission: "projects",
    parameters: objectSchema({
      name: { type: "string", minLength: 1, maxLength: 120 },
    }, ["name"]),
    async handler({ client, organizationId, resolution }, args) {
      assertKeys(args, ["name"]);
      const requested = text(args.name);
      if (!requested) throw new Error("INVALID_ARGUMENTS");
      const { data, error } = await client.from("projects").select("id,name")
        .eq("organization_id", organizationId).order("updated_at", {
          ascending: false,
        }).limit(25);
      if (error) throw error;
      const resolved = resolveEntityName(requested, data || []);
      if (resolved.state === "EXACT") {
        resolution?.exactProjectIds.add(String(resolved.entity.id));
      }
      return { entity_type: "project", resolution: resolved };
    },
  },
  {
    name: "resolve_client",
    description:
      "Resuelve de forma determinista un nombre de cliente visible. Solo EXACT entrega identidad; candidatos aproximados requieren aclaración del usuario.",
    permission: "clients",
    parameters: objectSchema({
      name: { type: "string", minLength: 1, maxLength: 120 },
    }, ["name"]),
    async handler({ client, organizationId, resolution }, args) {
      assertKeys(args, ["name"]);
      const requested = text(args.name);
      if (!requested) throw new Error("INVALID_ARGUMENTS");
      const { data, error } = await client.from("clients").select(
        "id,company_name",
      ).eq("organization_id", organizationId).order("created_at", {
        ascending: false,
      }).limit(25);
      if (error) throw error;
      const resolved = resolveEntityName(
        requested,
        (data || []).map((row) => ({ id: row.id, name: row.company_name })),
      );
      if (resolved.state === "EXACT") {
        resolution?.exactClientIds.add(Number(resolved.entity.id));
      }
      return { entity_type: "client", resolution: resolved };
    },
  },
  {
    name: "prepare_create_project_task",
    description:
      "Prepara una propuesta confirmable para crear una tarea. No crea la tarea. Úsala solo cuando proyecto, título y fechas sean inequívocos; una fecha ambigua requiere aclaración previa.",
    permission: "projects",
    parameters: objectSchema({
      project_id: { type: "string", format: "uuid" },
      title: { type: "string", minLength: 2, maxLength: 180 },
      instructions: { type: ["string", "null"], maxLength: 10000 },
      assignee_id: { type: ["string", "null"], format: "uuid" },
      priority: { type: "string", enum: ["low", "medium", "high", "urgent"] },
      starts_at: { type: ["string", "null"], format: "date-time" },
      due_at: { type: ["string", "null"], format: "date-time" },
    }, [
      "project_id",
      "title",
      "instructions",
      "assignee_id",
      "priority",
      "starts_at",
      "due_at",
    ]),
    async handler({ client, conversationId, userMessageId, resolution }, args) {
      assertKeys(args, [
        "project_id",
        "title",
        "instructions",
        "assignee_id",
        "priority",
        "starts_at",
        "due_at",
      ]);
      if (!conversationId || !userMessageId) {
        throw new Error("INVALID_ARGUMENTS");
      }
      const title = text(args.title, 180);
      if (!title || title.length < 2) throw new Error("INVALID_ARGUMENTS");
      const instructions = text(args.instructions, 10000);
      const projectId = uuid(args.project_id);
      if (!resolution?.exactProjectIds.has(projectId)) {
        throw new Error("ENTITY_NOT_RESOLVED");
      }
      const assigneeId = args.assignee_id == null
        ? null
        : uuid(args.assignee_id);
      const priority = enumValue(args.priority, [
        "low",
        "medium",
        "high",
        "urgent",
      ]);
      const parseDate = (value: unknown) => {
        if (value == null) return null;
        if (
          typeof value !== "string" || !/(?:Z|[+-]\d{2}:\d{2})$/i.test(value)
        ) throw new Error("INVALID_ARGUMENTS");
        const parsed = new Date(value);
        if (!Number.isFinite(parsed.getTime())) {
          throw new Error("INVALID_ARGUMENTS");
        }
        return parsed.toISOString();
      };
      const startsAt = parseDate(args.starts_at);
      const dueAt = parseDate(args.due_at);
      if (startsAt && dueAt && dueAt < startsAt) {
        throw new Error("INVALID_ARGUMENTS");
      }
      const { data, error } = await client.rpc(
        "prepare_orb_project_task_proposal",
        {
          target_conversation_id: conversationId,
          target_user_message_id: userMessageId,
          target_project_id: projectId,
          requested_title: title,
          requested_instructions: instructions,
          requested_assignee_id: assigneeId,
          requested_priority: priority,
          requested_starts_at: startsAt,
          requested_due_at: dueAt,
        },
      );
      if (error) throw error;
      return {
        proposal_id: data.id,
        action_type: data.action_type,
        status: data.status,
        arguments_hash: data.arguments_hash,
        expires_at: data.expires_at,
        display: data.display_payload,
        confirmation_required: true,
      };
    },
  },
  {
    name: "list_projects",
    description: "Lista proyectos visibles, con filtros acotados.",
    permission: "projects",
    parameters: objectSchema({
      status: { type: ["string", "null"], enum: [...PROJECT_STATUSES, null] },
      search: { type: ["string", "null"], maxLength: 120 },
      limit: { type: "integer", minimum: 1, maximum: MAX_LIMIT },
    }, ["status", "search", "limit"]),
    async handler({ client, organizationId }, args) {
      assertKeys(args, ["status", "search", "limit"]);
      const take = limit(args.limit);
      const status = enumValue(args.status, PROJECT_STATUSES);
      const search = text(args.search);
      let query = client.from("projects").select(
        "id,name,status,progress,division_id,starts_at,due_at,completed_at",
      ).eq("organization_id", organizationId).order("updated_at", {
        ascending: false,
      }).limit(take);
      if (status) query = query.eq("status", status);
      if (search) {
        query = query.ilike("name", `%${search.replace(/[%_,()]/g, "")}%`);
      }
      const { data, error } = await query;
      if (error) throw error;
      return {
        items: data || [],
        limit: take,
        truncated: (data?.length || 0) === take,
      };
    },
  },
  {
    name: "list_tasks",
    description:
      "Lista tareas visibles abiertas, vencidas, propias, próximas o por proyecto.",
    permission: "projects",
    parameters: objectSchema({
      scope: { type: "string", enum: TASK_SCOPES },
      project_id: { type: ["string", "null"] },
      limit: { type: "integer", minimum: 1, maximum: MAX_LIMIT },
    }, ["scope", "project_id", "limit"]),
    async handler({ client, organizationId, userId, now = new Date() }, args) {
      assertKeys(args, ["scope", "project_id", "limit"]);
      const take = limit(args.limit);
      const scope = enumValue(args.scope, TASK_SCOPES) || "open";
      const projectId = args.project_id == null ? null : uuid(args.project_id);
      let query = client.from("project_tasks").select(
        "id,project_id,title,status,priority,assigned_to,starts_at,due_at,project:projects!inner(id,name,organization_id),assignee:users!project_tasks_assigned_to_fkey(id,first_name)",
      ).eq("project.organization_id", organizationId).eq(
        "is_recurrence_template",
        false,
      ).neq("status", "cancelled").order("due_at", {
        ascending: true,
        nullsFirst: false,
      }).limit(take);
      if (projectId) query = query.eq("project_id", projectId);
      if (scope === "mine") query = query.eq("assigned_to", userId);
      if (scope === "open" || scope === "mine") {
        query = query.in("status", ["pending", "in_progress", "blocked"]);
      }
      if (scope === "overdue") {
        query = query.in("status", ["pending", "in_progress", "blocked"]).lt(
          "due_at",
          now.toISOString(),
        );
      }
      if (scope === "upcoming") {
        const horizon = new Date(now);
        horizon.setUTCDate(horizon.getUTCDate() + 7);
        query = query.in("status", ["pending", "in_progress", "blocked"]).gte(
          "due_at",
          now.toISOString(),
        ).lte("due_at", horizon.toISOString());
      }
      const { data, error } = await query;
      if (error) throw error;
      return {
        items: (data || []).map((row) => ({
          ...row,
          project: relation(row.project),
          assignee: relation(row.assignee),
        })),
        limit: take,
        truncated: (data?.length || 0) === take,
      };
    },
  },
  {
    name: "get_project_summary",
    description: "Obtiene un resumen operativo mínimo de un proyecto visible.",
    permission: "projects",
    parameters: objectSchema(
      { project_id: { type: "string", format: "uuid" } },
      ["project_id"],
    ),
    async handler({ client, organizationId, now = new Date() }, args) {
      assertKeys(args, ["project_id"]);
      const projectId = uuid(args.project_id);
      const [project, tasks] = await Promise.all([
        client.from("projects").select(
          "id,name,status,progress,division_id,starts_at,due_at,completed_at",
        ).eq("id", projectId).eq("organization_id", organizationId)
          .maybeSingle(),
        client.from("project_tasks").select("id,status,due_at").eq(
          "project_id",
          projectId,
        ).eq("is_recurrence_template", false),
      ]);
      if (project.error || tasks.error) throw project.error || tasks.error;
      if (!project.data) return { status: "not_found" };
      const rows = tasks.data || [];
      return {
        project: project.data,
        tasks: {
          total: rows.length,
          open:
            rows.filter((x) =>
              ["pending", "in_progress", "blocked"].includes(x.status)
            ).length,
          completed: rows.filter((x) => x.status === "completed").length,
          overdue: rows.filter((x) =>
            x.due_at && new Date(x.due_at) < now &&
            ["pending", "in_progress", "blocked"].includes(x.status)
          ).length,
        },
      };
    },
  },
  {
    name: "list_discovery_assessments",
    description: "Lista evaluaciones Discovery visibles de forma resumida.",
    permission: "discovery",
    parameters: objectSchema({
      status: {
        type: ["string", "null"],
        enum: [...ASSESSMENT_STATUSES, null],
      },
      client_id: { type: ["string", "null"] },
      limit: { type: "integer", minimum: 1, maximum: MAX_LIMIT },
    }, ["status", "client_id", "limit"]),
    async handler({ client, organizationId }, args) {
      assertKeys(args, ["status", "client_id", "limit"]);
      const take = limit(args.limit);
      const status = enumValue(args.status, ASSESSMENT_STATUSES);
      const clientId = args.client_id == null ? null : uuid(args.client_id);
      let query = client.from("discovery_assessments").select(
        "id,status,client_id,division_id,score,max_score,started_at,completed_at,updated_at",
      ).eq("organization_id", organizationId).order("updated_at", {
        ascending: false,
      }).limit(take);
      if (status) query = query.eq("status", status);
      if (clientId) query = query.eq("client_id", clientId);
      const { data, error } = await query;
      if (error) throw error;
      return {
        items: data || [],
        limit: take,
        truncated: (data?.length || 0) === take,
      };
    },
  },
  {
    name: "get_discovery_summary",
    description:
      "Obtiene resultados agregados y categorías de una evaluación Discovery visible, sin respuestas libres.",
    permission: "discovery",
    parameters: objectSchema(
      { assessment_id: { type: "string", format: "uuid" } },
      ["assessment_id"],
    ),
    async handler({ client, organizationId }, args) {
      assertKeys(args, ["assessment_id"]);
      const assessmentId = uuid(args.assessment_id);
      const assessment = await client.from("discovery_assessments").select(
        "id,status,client_id,division_id,score,max_score,maturity_level,started_at,completed_at,updated_at",
      ).eq("id", assessmentId).eq("organization_id", organizationId)
        .maybeSingle();
      if (assessment.error) throw assessment.error;
      if (!assessment.data) return { status: "not_found" };

      const categories = await client.from("discovery_category_results")
        .select(
          "category_id,percentage,status,category:score_categories!inner(id,name)",
        ).eq("assessment_id", assessmentId).order("percentage", {
          ascending: true,
        }).limit(MAX_LIMIT);
      if (categories.error) throw categories.error;
      return {
        assessment: assessment.data,
        categories: (categories.data || []).map((row) => ({
          category_id: row.category_id,
          percentage: row.percentage,
          status: row.status,
          category: relation(row.category),
        })),
        categories_truncated: (categories.data?.length || 0) === MAX_LIMIT,
      };
    },
  },
  {
    name: "get_score_summary",
    description: "Obtiene el último Company Master Score canónico visible.",
    permission: "area_score",
    parameters: objectSchema({}, []),
    async handler({ client, organizationId }, args) {
      assertKeys(args, []);
      const { data, error } = await client.from("company_score_snapshots")
        .select(
          "id,master_score,performance_percentage,coverage_percentage,status,calculated_at",
        ).eq("organization_id", organizationId).order("calculated_at", {
          ascending: false,
        }).limit(1).maybeSingle();
      if (error) throw error;
      return { snapshot: data || null };
    },
  },
  {
    name: "get_score_breakdown",
    description:
      "Obtiene el desglose canónico por división del último Company Master Score visible.",
    permission: "area_score",
    parameters: objectSchema({}, []),
    async handler({ client, organizationId }, args) {
      assertKeys(args, []);
      const snapshot = await client.from("company_score_snapshots").select(
        "id,master_score,performance_percentage,coverage_percentage,status,calculated_at",
      ).eq("organization_id", organizationId).order("calculated_at", {
        ascending: false,
      }).limit(1).maybeSingle();
      if (snapshot.error) throw snapshot.error;
      if (!snapshot.data) return { snapshot: null, divisions: [] };

      const components = await client.from("company_score_snapshot_components")
        .select(
          "division_id,configured_weight,represented,division_performance_percentage,division_coverage_percentage,division:divisions!inner(id,name,organization_id)",
        ).eq("snapshot_id", snapshot.data.id).eq(
          "organization_id",
          organizationId,
        ).eq("division.organization_id", organizationId).order(
          "division_performance_percentage",
          { ascending: true, nullsFirst: false },
        ).limit(MAX_LIMIT);
      if (components.error) throw components.error;
      return {
        snapshot: snapshot.data,
        divisions: (components.data || []).map((row) => ({
          division_id: row.division_id,
          configured_weight: row.configured_weight,
          represented: row.represented,
          performance_percentage: row.division_performance_percentage,
          coverage_percentage: row.division_coverage_percentage,
          division: relation(row.division),
        })),
        divisions_truncated: (components.data?.length || 0) === MAX_LIMIT,
      };
    },
  },
  {
    name: "list_calendar_items",
    description:
      "Lista eventos y tareas visibles en un rango máximo de 31 días.",
    permission: "calendar",
    parameters: objectSchema({
      start_at: { type: "string", format: "date-time" },
      end_at: { type: "string", format: "date-time" },
      limit: { type: "integer", minimum: 1, maximum: MAX_LIMIT },
    }, ["start_at", "end_at", "limit"]),
    async handler({ client, organizationId, permissions }, args) {
      assertKeys(args, ["start_at", "end_at", "limit"]);
      const take = limit(args.limit);
      const start = new Date(String(args.start_at));
      const end = new Date(String(args.end_at));
      if (
        !Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) ||
        end <= start || end.getTime() - start.getTime() > 31 * 86400000
      ) throw new Error("INVALID_ARGUMENTS");
      const events = await client.from("calendar_events").select(
        "id,title,starts_at,ends_at,all_day,event_type,status,priority,assigned_to,created_by",
      ).eq("organization_id", organizationId).neq("status", "cancelled").gte(
        "starts_at",
        start.toISOString(),
      ).lt("starts_at", end.toISOString()).order("starts_at").limit(take);
      if (events.error) throw events.error;
      let tasks: Record<string, unknown>[] = [];
      if (permissions.projects) {
        const result = await client.from("project_tasks").select(
          "id,project_id,title,status,priority,assigned_to,starts_at,due_at,project:projects!inner(id,name,organization_id)",
        ).eq("project.organization_id", organizationId).eq(
          "is_recurrence_template",
          false,
        ).neq("status", "cancelled").gte("due_at", start.toISOString()).lt(
          "due_at",
          end.toISOString(),
        ).order("due_at").limit(take);
        if (!result.error) tasks = result.data || [];
      }
      return {
        items: [
          ...(events.data || []).map((x) => ({ source: "event", ...x })),
          ...tasks.map((x) => ({ source: "task", ...x })),
        ].slice(0, take),
        limit: take,
        truncated: (events.data?.length || 0) + tasks.length >= take,
      };
    },
  },
  {
    name: "list_clients",
    description: "Lista clientes visibles sin datos de contacto ni notas.",
    permission: "clients",
    parameters: objectSchema({
      status: { type: ["string", "null"], enum: [...CLIENT_STATUSES, null] },
      search: { type: ["string", "null"], maxLength: 120 },
      limit: { type: "integer", minimum: 1, maximum: MAX_LIMIT },
    }, ["status", "search", "limit"]),
    async handler({ client, organizationId }, args) {
      assertKeys(args, ["status", "search", "limit"]);
      const take = limit(args.limit);
      const status = enumValue(args.status, CLIENT_STATUSES);
      const search = text(args.search);
      let query = client.from("clients").select(
        "id,company_name,industry,status,created_at",
      ).eq("organization_id", organizationId).order("created_at", {
        ascending: false,
      }).limit(take);
      if (status) query = query.eq("status", status);
      if (search) {
        query = query.ilike(
          "company_name",
          `%${search.replace(/[%_,()]/g, "")}%`,
        );
      }
      const { data, error } = await query;
      if (error) throw error;
      return {
        items: data || [],
        limit: take,
        truncated: (data?.length || 0) === take,
      };
    },
  },
  {
    name: "get_client_summary",
    description:
      "Obtiene una ficha empresarial mínima y actividad reciente de un cliente visible, sin contacto ni notas.",
    permission: "clients",
    parameters: objectSchema(
      { client_id: { type: "integer", minimum: 1 } },
      ["client_id"],
    ),
    async handler({ client, organizationId }, args) {
      assertKeys(args, ["client_id"]);
      const clientId = positiveInteger(args.client_id);
      const clientResult = await client.from("clients").select(
        "id,company_name,industry,status,created_at",
      ).eq("id", clientId).eq("organization_id", organizationId)
        .maybeSingle();
      if (clientResult.error) throw clientResult.error;
      if (!clientResult.data) return { status: "not_found" };

      const [projects, assessments] = await Promise.all([
        client.from("projects").select(
          "id,name,status,due_at,updated_at",
        ).eq("client_id", clientId).eq("organization_id", organizationId)
          .order("updated_at", { ascending: false }).limit(6),
        client.from("discovery_assessments").select(
          "id,status,score,max_score,completed_at,updated_at",
        ).eq("client_id", clientId).eq("organization_id", organizationId)
          .order("updated_at", { ascending: false }).limit(6),
      ]);
      if (projects.error || assessments.error) {
        throw projects.error || assessments.error;
      }
      return {
        client: clientResult.data,
        projects: {
          items: (projects.data || []).slice(0, 5),
          truncated: (projects.data?.length || 0) > 5,
        },
        discoveries: {
          items: (assessments.data || []).slice(0, 5),
          truncated: (assessments.data?.length || 0) > 5,
        },
      };
    },
  },
];

export function createEntityResolutionSession() {
  return {
    exactProjectIds: new Set<string>(),
    exactClientIds: new Set<number>(),
  };
}

export function getAuthorizedToolDefinitions(permissions: OrbToolPermissions) {
  return definitions.filter((tool) => permissions[tool.permission]).map((
    { name, description, parameters },
  ) => ({ type: "function", name, description, parameters, strict: true }));
}

export async function executeOrbTool(
  ctx: Context,
  name: string,
  rawArguments: string,
) {
  const tool = definitions.find((item) => item.name === name);
  if (!tool || !ctx.permissions[tool.permission]) {
    return { status: "unauthorized" };
  }
  try {
    const args = JSON.parse(rawArguments || "{}");
    return { status: "ok", data: await tool.handler(ctx, args) };
  } catch (error) {
    return { status: safeError(error) };
  }
}

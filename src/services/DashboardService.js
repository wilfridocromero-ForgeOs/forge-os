import { getCalendarItemStatus, normalizeCalendarEvent, normalizeProjectTask } from "./CalendarService";
import { getCompanyScoreDashboard } from "./CompanyScoreService";
import { formatProjectActivity, formatActivityDate } from "../features/projects/projectActivityFormatter";
import { supabase } from "../lib/supabase";

const OPEN_TASK_STATUSES = ["pending", "in_progress", "blocked"];
const ACTIVE_PROJECT_STATUSES = ["planned", "active", "blocked"];
const TASK_FIELDS = "id,project_id,title,status,priority,assigned_to,starts_at,due_at,is_recurrence_template,project:projects!inner(id,name,organization_id,status)";
const EVENT_FIELDS = "id,organization_id,created_by,assigned_to,title,description,starts_at,ends_at,all_day,event_type,status,priority,visibility,remind_at";
const ACTIVITY_FIELDS = "id,project_id,actor_id,event_type,entity_type,entity_id,payload,created_at,project:projects!inner(id,name,organization_id),actor:users!project_activity_actor_id_fkey(first_name)";

function localDayBounds(now) {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const end = new Date(start);
  end.setDate(start.getDate() + 1);
  const horizon = new Date(start);
  horizon.setDate(start.getDate() + 7);
  return { start, end, horizon };
}

function sourceError(error) {
  return error?.message || "No se pudo cargar esta fuente.";
}

async function readSource(loader) {
  try {
    const result = await loader();
    if (result?.error) throw result.error;
    return { available: true, data: result?.data ?? result, count: result?.count ?? null, error: null };
  } catch (error) {
    return { available: false, data: null, count: null, error: sourceError(error) };
  }
}

function unwrapRelation(value) {
  return Array.isArray(value) ? value[0] : value;
}

function buildTaskSummary(source, { userId, now, dayStart, dayEnd }) {
  const rows = source.available ? source.data || [] : [];
  const items = rows.map((row) => normalizeProjectTask(row));
  const overdue = items.filter((item) => getCalendarItemStatus(item, now) === "overdue");
  const mine = items.filter((item) => item.assignedTo === userId);
  const mineOverdue = mine.filter((item) => getCalendarItemStatus(item, now) === "overdue");
  const today = mine.filter((item) => {
    const value = item.dueAt || item.startsAt;
    if (!value) return false;
    const date = new Date(value);
    return date >= dayStart && date < dayEnd && getCalendarItemStatus(item, now) !== "overdue";
  });
  const upcoming = mine.filter((item) => {
    const value = item.dueAt || item.startsAt;
    return value && new Date(value) >= dayEnd;
  });

  return {
    ...source,
    activeCount: source.count ?? rows.length,
    overdue,
    overdueCount: overdue.length,
    mineOverdue,
    today,
    upcoming,
  };
}

function buildCalendarSummary(source, { userId, dayStart, dayEnd }) {
  const rows = source.available ? source.data || [] : [];
  const items = rows.map(normalizeCalendarEvent)
    .filter((item) => item.assignedTo === userId || item.createdBy === userId)
    .sort((left, right) => new Date(left.startsAt) - new Date(right.startsAt));
  const today = items.filter((item) => {
    const date = new Date(item.startsAt);
    return date >= dayStart && date < dayEnd;
  });
  const upcoming = items.filter((item) => new Date(item.startsAt) >= dayEnd);
  return { ...source, items, today, upcoming };
}

function buildActivities(source) {
  if (!source.available) return { ...source, items: [] };
  const items = (source.data || []).map((row) => {
    const actor = unwrapRelation(row.actor);
    const project = unwrapRelation(row.project);
    return {
      id: row.id,
      projectId: row.project_id,
      projectName: project?.name || "Proyecto",
      time: formatActivityDate(row.created_at),
      title: formatProjectActivity({ ...row, actor_name: actor?.first_name || null }),
      description: project?.name || "Actividad de proyecto",
      createdAt: row.created_at,
    };
  });
  return { ...source, items };
}

export async function getDashboardData({ organizationId, userId, now = new Date() }) {
  const { start, end, horizon } = localDayBounds(now);
  const [score, clients, projects, tasks, calendar, discovery, activity] = await Promise.all([
    readSource(() => getCompanyScoreDashboard(organizationId)),
    readSource(() => supabase.from("clients").select("id", { count: "exact", head: true }).eq("organization_id", organizationId)),
    readSource(() => supabase.from("projects").select("id", { count: "exact", head: true }).eq("organization_id", organizationId).in("status", ACTIVE_PROJECT_STATUSES)),
    readSource(() => supabase.from("project_tasks").select(TASK_FIELDS, { count: "exact" })
      .eq("project.organization_id", organizationId).eq("is_recurrence_template", false)
      .in("status", OPEN_TASK_STATUSES).order("due_at", { nullsFirst: false }).limit(100)),
    readSource(() => supabase.from("calendar_events").select(EVENT_FIELDS)
      .eq("organization_id", organizationId).eq("status", "scheduled")
      .gte("starts_at", start.toISOString()).lt("starts_at", horizon.toISOString())
      .order("starts_at").limit(50)),
    readSource(() => supabase.from("discovery_assessments")
      .select("id,status,division_id,started_at,updated_at", { count: "exact" })
      .eq("organization_id", organizationId).eq("status", "in_progress")
      .order("updated_at", { ascending: false }).limit(10)),
    readSource(() => supabase.from("project_activity").select(ACTIVITY_FIELDS)
      .eq("project.organization_id", organizationId).order("created_at", { ascending: false }).limit(4)),
  ]);

  return {
    generatedAt: now.toISOString(),
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || null,
    score,
    clients,
    projects,
    tasks: buildTaskSummary(tasks, { userId, now, dayStart: start, dayEnd: end }),
    calendar: buildCalendarSummary(calendar, { userId, dayStart: start, dayEnd: end }),
    discovery: { ...discovery, pendingCount: discovery.count ?? (discovery.data || []).length },
    activity: buildActivities(activity),
  };
}

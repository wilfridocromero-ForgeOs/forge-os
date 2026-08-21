import { supabase } from "../lib/supabase";

const EVENT_COLUMNS = "id, organization_id, created_by, assigned_to, title, description, starts_at, ends_at, all_day, event_type, status, priority, visibility, remind_at";
const TASK_COLUMNS = "id, project_id, title, description, status, priority, assigned_to, starts_at, due_at, recurrence_schedule_id, scheduled_for, is_recurrence_template, project:projects!inner(id, name, division_id, organization_id), assignee:users!project_tasks_assigned_to_fkey(id, first_name)";
const OPEN_TASK_STATUSES = ["pending", "in_progress", "blocked"];

export const CALENDAR_STATUS_META = Object.freeze({
  pending: Object.freeze({ label: "Pendiente", className: "calendar-status-pending" }),
  in_progress: Object.freeze({ label: "En progreso", className: "calendar-status-in-progress" }),
  blocked: Object.freeze({ label: "Bloqueada", className: "calendar-status-blocked" }),
  completed: Object.freeze({ label: "Completada", className: "calendar-status-completed" }),
  overdue: Object.freeze({ label: "Vencida", className: "calendar-status-overdue" }),
  event: Object.freeze({ label: "Evento", className: "calendar-status-event" }),
});

export function getCalendarItemStatus(item, now = new Date()) {
  if (item.sourceType === "event") return "event";
  if (item.status === "completed") return "completed";
  if (item.dueAt && new Date(item.dueAt) < now && OPEN_TASK_STATUSES.includes(item.status)) return "overdue";
  if (OPEN_TASK_STATUSES.includes(item.status)) return item.status;
  return "pending";
}

export function getCalendarStatusMeta(item, now = new Date()) {
  const status = getCalendarItemStatus(item, now);
  return { status, ...CALENDAR_STATUS_META[status] };
}

function iso(value) {
  return new Date(value).toISOString();
}

export function normalizeCalendarEvent(event) {
  return {
    key: `event:${event.id}`, sourceType: "event", sourceId: event.id, taskId: null,
    projectId: null, projectName: null, divisionId: null, title: event.title,
    description: event.description, startsAt: event.starts_at, endsAt: event.ends_at,
    dueAt: null, status: event.status, priority: event.priority, assignedTo: event.assigned_to,
    assigneeName: null, createdBy: event.created_by, allDay: event.all_day,
    eventType: event.event_type, visibility: event.visibility, remindAt: event.remind_at,
  };
}

export function normalizeProjectTask(task) {
  const project = Array.isArray(task.project) ? task.project[0] : task.project;
  const assignee = Array.isArray(task.assignee) ? task.assignee[0] : task.assignee;
  return {
    key: `task:${task.id}`, sourceType: "task", sourceId: task.id, taskId: task.id,
    projectId: task.project_id, projectName: project?.name || "Proyecto",
    divisionId: project?.division_id || null, title: task.title, description: task.description,
    startsAt: task.starts_at || task.due_at, endsAt: task.starts_at && task.due_at ? task.due_at : null,
    dueAt: task.due_at, status: task.status, priority: task.priority,
    assignedTo: task.assigned_to, assigneeName: assignee?.first_name || null, createdBy: null,
    allDay: false, eventType: "project_task", visibility: null, remindAt: null,
    recurrenceScheduleId: task.recurrence_schedule_id, scheduledFor: task.scheduled_for,
  };
}

export function isCalendarTask(task) {
  return !task.is_recurrence_template && task.status !== "cancelled" && Boolean(task.starts_at || task.due_at);
}

export function isCalendarEvent(event) {
  return event.status !== "cancelled";
}

export async function getCalendarFeed({ organizationId, rangeStart, rangeEnd, now = new Date() }) {
  const start = iso(rangeStart);
  const end = iso(rangeEnd);
  const current = iso(now);
  const eventQuery = supabase.from("calendar_events").select(EVENT_COLUMNS)
    .eq("organization_id", organizationId).lt("starts_at", end)
    .or(`ends_at.gte.${start},and(ends_at.is.null,starts_at.gte.${start})`)
    .neq("status", "cancelled").order("starts_at");
  const taskQuery = supabase.from("project_tasks").select(TASK_COLUMNS)
    .eq("project.organization_id", organizationId).eq("is_recurrence_template", false)
    .neq("status", "cancelled")
    .or([
      `and(starts_at.lt.${end},due_at.gte.${start})`,
      `and(starts_at.gte.${start},starts_at.lt.${end})`,
      `and(due_at.gte.${start},due_at.lt.${end})`,
      `and(due_at.lt.${current},status.in.(${OPEN_TASK_STATUSES.join(",")}))`,
    ].join(",")).order("starts_at", { nullsFirst: false });
  const [eventsResult, tasksResult] = await Promise.all([eventQuery, taskQuery]);
  if (eventsResult.error) throw eventsResult.error;
  if (tasksResult.error) throw tasksResult.error;
  return [
    ...(eventsResult.data || []).filter(isCalendarEvent).map(normalizeCalendarEvent),
    ...(tasksResult.data || []).filter(isCalendarTask).map(normalizeProjectTask),
  ]
    .sort((left, right) => new Date(left.startsAt) - new Date(right.startsAt));
}

export function filterCalendarFeed(items, { scope = "mine", source = "all", status = "all", userId, now = new Date() } = {}) {
  return items.filter((item) => {
    if (scope === "mine" && item.assignedTo !== userId && !(item.sourceType === "event" && item.createdBy === userId)) return false;
    if (source !== "all" && item.sourceType !== source) return false;
    const semanticStatus = getCalendarItemStatus(item, now);
    if (status === "active") {
      if (item.sourceType === "event") return item.status !== "completed";
      return ["pending", "in_progress", "blocked"].includes(semanticStatus);
    }
    if (status === "completed") return item.status === "completed";
    if (status === "overdue") return semanticStatus === "overdue";
    return true;
  });
}

export function groupCalendarAgenda(items, now = new Date()) {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1);
  const afterTomorrow = new Date(tomorrow); afterTomorrow.setDate(tomorrow.getDate() + 1);
  const groups = { overdue: [], previous: [], today: [], tomorrow: [], upcoming: [] };
  items.forEach((item) => {
    const date = new Date(item.startsAt);
    if (getCalendarItemStatus(item, now) === "overdue") groups.overdue.push(item);
    else if (date < today) groups.previous.push(item);
    else if (date < tomorrow) groups.today.push(item);
    else if (date < afterTomorrow) groups.tomorrow.push(item);
    else groups.upcoming.push(item);
  });
  return groups;
}

export function buildCalendarDay(items) {
  const uniqueItems = Array.from(new Map(items.map((item) => [item.key, item])).values());
  const tasks = uniqueItems.filter((item) => item.sourceType === "task");
  const events = uniqueItems.filter((item) => item.sourceType === "event");
  const taskGroups = tasks.reduce((groups, task) => {
    const key = task.assignedTo || "unassigned";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(task);
    return groups;
  }, new Map());
  return {
    items: uniqueItems,
    tasks,
    events,
    taskGroups,
    peopleCount: new Set(uniqueItems.map((item) => item.assignedTo).filter(Boolean)).size,
  };
}

import { supabase } from "../lib/supabase";

const projectSelection = `
  id, organization_id, division_id, client_id, name, description, priority,
  status, progress, owner_id, created_by, starts_at, due_at, completed_at,
  created_at, updated_at,
  divisions(id, name),
  clients(id, company_name, contact_name),
  owner:users!projects_owner_id_fkey(id, first_name, title)
`;

export async function getProjects(organizationId) {
  if (!organizationId) return [];
  const { data, error } = await supabase.from("projects").select(projectSelection)
    .eq("organization_id", organizationId).order("created_at", { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function getProjectOptions(organizationId) {
  if (!organizationId) return { clients: [], users: [] };
  const [clientsResult, usersResult] = await Promise.all([
    supabase.from("clients").select("id, company_name, contact_name").eq("organization_id", organizationId).order("company_name"),
    supabase.from("users").select("id, first_name, title").eq("organization_id", organizationId).order("first_name"),
  ]);
  if (clientsResult.error) throw clientsResult.error;
  if (usersResult.error) throw usersResult.error;
  return { clients: clientsResult.data || [], users: usersResult.data || [] };
}

function normalizeProject(values, organizationId, userId) {
  return {
    organization_id: organizationId,
    division_id: values.division_id,
    client_id: values.client_id || null,
    name: values.name.trim(),
    description: values.description?.trim() || null,
    priority: values.priority,
    status: values.status,
    owner_id: values.owner_id || null,
    starts_at: values.starts_at ? new Date(`${values.starts_at}T00:00:00`).toISOString() : null,
    due_at: values.due_at ? new Date(`${values.due_at}T23:59:59`).toISOString() : null,
    completed_at: values.status === "completed" ? new Date().toISOString() : null,
    created_by: userId,
  };
}

export async function createProject(values, organizationId, userId) {
  const payload = normalizeProject(values, organizationId, userId);
  const { data, error } = await supabase.from("projects").insert(payload).select(projectSelection).single();
  if (error) throw error;
  await supabase.from("project_activity").insert({ project_id: data.id, actor_id: userId, event_type: "project_created", payload: { status: data.status } });
  return data;
}

export async function updateProject(projectId, values, organizationId, userId) {
  const payload = normalizeProject(values, organizationId, userId);
  delete payload.created_by;
  const { data, error } = await supabase.from("projects").update(payload).eq("id", projectId).select(projectSelection).single();
  if (error) throw error;
  await supabase.from("project_activity").insert({ project_id: data.id, actor_id: userId, event_type: "project_updated", payload: { status: data.status, progress: data.progress } });
  return data;
}

export async function deleteProject(projectId, userId) {
  await supabase.from("project_activity").insert({ project_id: projectId, actor_id: userId, event_type: "project_deleted" });
  const { error } = await supabase.from("projects").delete().eq("id", projectId);
  if (error) throw error;
}

export async function getProjectWork(projectId) {
  const [tasksResult, deliverablesResult] = await Promise.all([
    supabase.from("project_tasks").select("id, project_id, title, description, status, priority, work_type, assigned_to, due_at, completed_at, created_by, created_at, assignee:users!project_tasks_assigned_to_fkey(id, first_name, title)").eq("project_id", projectId).order("created_at"),
    supabase.from("project_deliverables").select("id, project_id, title, description, status, due_at, approved_at, created_by, created_at").eq("project_id", projectId).order("created_at"),
  ]);
  if (tasksResult.error) throw tasksResult.error;
  if (deliverablesResult.error) throw deliverablesResult.error;
  return { tasks: tasksResult.data || [], deliverables: deliverablesResult.data || [] };
}

export async function createProjectTask(projectId, values, userId) {
  const { data, error } = await supabase.from("project_tasks").insert({
    project_id: projectId,
    title: values.title.trim(),
    work_type: values.work_type || "task",
    priority: values.priority || "medium",
    assigned_to: values.assigned_to || null,
    due_at: values.due_at ? new Date(`${values.due_at}T23:59:59`).toISOString() : null,
    created_by: userId,
  }).select("*").single();
  if (error) throw error;
  return data;
}

export async function updateProjectTask(taskId, changes) {
  const payload = { ...changes };
  if (changes.status) payload.completed_at = changes.status === "completed" ? new Date().toISOString() : null;
  const { data, error } = await supabase.from("project_tasks").update(payload).eq("id", taskId).select("*").single();
  if (error) throw error;
  return data;
}

export async function deleteProjectTask(taskId) {
  const { error } = await supabase.from("project_tasks").delete().eq("id", taskId);
  if (error) throw error;
}

export async function createProjectDeliverable(projectId, values, userId) {
  const { data, error } = await supabase.from("project_deliverables").insert({
    project_id: projectId,
    title: values.title.trim(),
    due_at: values.due_at ? new Date(`${values.due_at}T23:59:59`).toISOString() : null,
    created_by: userId,
  }).select("*").single();
  if (error) throw error;
  return data;
}

export async function updateProjectDeliverable(deliverableId, changes, userId) {
  const payload = { ...changes };
  if (changes.status) {
    payload.approved_at = changes.status === "approved" ? new Date().toISOString() : null;
    payload.approved_by = changes.status === "approved" ? userId : null;
  }
  const { data, error } = await supabase.from("project_deliverables").update(payload).eq("id", deliverableId).select("*").single();
  if (error) throw error;
  return data;
}

export async function deleteProjectDeliverable(deliverableId) {
  const { error } = await supabase.from("project_deliverables").delete().eq("id", deliverableId);
  if (error) throw error;
}

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

export async function getProject(projectId, organizationId) {
  if (!projectId || !organizationId) return null;
  const { data, error } = await supabase.from("projects").select(projectSelection)
    .eq("id", projectId).eq("organization_id", organizationId).maybeSingle();
  if (error) throw error;
  return data;
}

export async function getProjectOptions(organizationId) {
  if (!organizationId) return { clients: [], users: [] };
  const [clientsResult, membershipsResult] = await Promise.all([
    supabase.from("clients").select("id, company_name, contact_name").eq("organization_id", organizationId).order("company_name"),
    supabase.from("organization_memberships").select("user_id, role").eq("organization_id", organizationId),
  ]);
  if (clientsResult.error) throw clientsResult.error;
  if (membershipsResult.error) throw membershipsResult.error;
  const memberIds = (membershipsResult.data || []).map((membership) => membership.user_id);
  if (!memberIds.length) return { clients: clientsResult.data || [], users: [] };
  const { data: users, error: usersError } = await supabase.from("users")
    .select("id, first_name, title, division, division_id").in("id", memberIds).order("first_name");
  if (usersError) throw usersError;
  return { clients: clientsResult.data || [], users: users || [] };
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
    created_by: userId,
  };
}

export async function createProject(values, organizationId, userId) {
  const payload = normalizeProject(values, organizationId, userId);
  const { data, error } = await supabase.from("projects").insert(payload).select(projectSelection).single();
  if (error) throw error;
  return data;
}

export async function updateProject(projectId, values, organizationId, userId) {
  const payload = normalizeProject(values, organizationId, userId);
  delete payload.created_by;
  const { data, error } = await supabase.from("projects").update(payload).eq("id", projectId).select(projectSelection).single();
  if (error) throw error;
  return data;
}

export async function archiveProject(projectId) {
  const { data, error } = await supabase.from("projects").update({ status: "archived" })
    .eq("id", projectId).select(projectSelection).single();
  if (error) throw error;
  return data;
}

export async function getProjectActivity(projectId, beforeActivityId = null, pageSize = 30) {
  if (!projectId) return [];
  const { data, error } = await supabase.rpc("get_project_activity_page", {
    target_project_id: projectId,
    before_activity_id: beforeActivityId,
    page_size: pageSize,
  });
  if (error) throw error;
  return data || [];
}

export async function getProjectComments(projectId) {
  if (!projectId) return [];
  const { data, error } = await supabase.rpc("get_project_comments", { target_project_id: projectId });
  if (error) throw error;
  return data || [];
}

export async function createProjectComment(projectId, body, authorId, parentId = null) {
  const { data, error } = await supabase.from("project_comments").insert({
    project_id: projectId,
    author_id: authorId,
    body: body.trim(),
    parent_id: parentId,
  }).select("id").single();
  if (error) throw error;
  return data;
}

export async function updateProjectComment(commentId, body) {
  const { error } = await supabase.from("project_comments").update({ body: body.trim() }).eq("id", commentId);
  if (error) throw error;
}

export async function deleteProjectComment(commentId) {
  const { error } = await supabase.from("project_comments").update({ deleted_at: new Date().toISOString() }).eq("id", commentId);
  if (error) throw error;
}

export async function getProjectMembers(projectId) {
  if (!projectId) return [];
  const { data, error } = await supabase.from("project_members")
    .select("id, project_id, user_id, role, added_by, created_at, updated_at, user:users!project_members_user_id_fkey(id, first_name, title, division, division_id)")
    .eq("project_id", projectId).order("created_at");
  if (error) throw error;
  return data || [];
}

export async function addProjectMember(projectId, userId, role, actorId) {
  const { data, error } = await supabase.from("project_members")
    .insert({ project_id: projectId, user_id: userId, role, added_by: actorId })
    .select("id, project_id, user_id, role, added_by, created_at, updated_at, user:users!project_members_user_id_fkey(id, first_name, title, division, division_id)")
    .single();
  if (error) throw error;
  return data;
}

export async function updateProjectMemberRole(memberId, role) {
  const { data, error } = await supabase.from("project_members").update({ role })
    .eq("id", memberId)
    .select("id, project_id, user_id, role, added_by, created_at, updated_at, user:users!project_members_user_id_fkey(id, first_name, title, division, division_id)")
    .single();
  if (error) throw error;
  return data;
}

export async function removeProjectMember(memberId) {
  const { error } = await supabase.from("project_members").delete().eq("id", memberId);
  if (error) throw error;
}

export async function getProjectWork(projectId) {
  const [tasksResult, deliverablesResult] = await Promise.all([
    supabase.from("project_tasks").select("id, project_id, title, description, status, priority, work_type, position, assigned_to, due_at, completed_at, completed_by, created_by, created_at, assignee:users!project_tasks_assigned_to_fkey(id, first_name, title)").eq("project_id", projectId).order("position").order("created_at"),
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
    description: values.description?.trim() || null,
    work_type: values.work_type || "task",
    status: values.status || "pending",
    priority: values.priority || "medium",
    position: Number.isInteger(values.position) ? values.position : 0,
    assigned_to: values.assigned_to || null,
    due_at: values.due_at ? new Date(`${values.due_at}T23:59:59`).toISOString() : null,
    created_by: userId,
  }).select("*").single();
  if (error) throw error;
  return data;
}

export async function updateProjectTask(taskId, changes) {
  const { data, error } = await supabase.from("project_tasks").update(changes).eq("id", taskId).select("*").single();
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

export async function updateProjectDeliverable(deliverableId, changes) {
  const { data, error } = await supabase.from("project_deliverables").update(changes).eq("id", deliverableId).select("*").single();
  if (error) throw error;
  return data;
}

export async function deleteProjectDeliverable(deliverableId) {
  const { error } = await supabase.from("project_deliverables").delete().eq("id", deliverableId);
  if (error) throw error;
}

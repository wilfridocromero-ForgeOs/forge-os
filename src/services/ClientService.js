import { supabase } from "../lib/supabase";

const CLIENT_FIELDS = `
  id, organization_id, company_name, contact_name, email, phone, website,
  industry, status, workspace_organization_id, portal_enabled, created_at
`;

const ACTIVE_PROJECT_STATUSES = new Set(["planned", "active", "blocked"]);

function newest(left, right) {
  return new Date(right.updated_at || right.completed_at || right.created_at || 0)
    - new Date(left.updated_at || left.completed_at || left.created_at || 0);
}

function enrichClient(client, assessments = [], projects = []) {
  const clientAssessments = assessments.filter((item) => String(item.client_id) === String(client.id)).sort(newest);
  const clientProjects = projects.filter((item) => String(item.client_id) === String(client.id));
  const latestDiscovery = clientAssessments[0] || null;
  return {
    ...client,
    discoveryCount: clientAssessments.length,
    discoveryStatus: latestDiscovery?.status || null,
    latestDiscovery,
    projectCount: clientProjects.length,
    activeProjectCount: clientProjects.filter((item) => ACTIVE_PROJECT_STATUSES.has(item.status)).length,
    projects: clientProjects,
    assessments: clientAssessments,
  };
}

export async function getClients(organizationId) {
  const [clientsResult, assessmentsResult, projectsResult] = await Promise.all([
    supabase.from("clients").select(CLIENT_FIELDS).eq("organization_id", organizationId).order("created_at", { ascending: false }),
    supabase.from("discovery_assessments").select("id,client_id,status,score,max_score,completed_at,updated_at").eq("organization_id", organizationId).not("client_id", "is", null),
    supabase.from("projects").select("id,client_id,name,status,due_at,updated_at").eq("organization_id", organizationId).not("client_id", "is", null),
  ]);
  if (clientsResult.error) throw clientsResult.error;
  return (clientsResult.data || []).map((client) => ({
    ...enrichClient(client, assessmentsResult.error ? [] : assessmentsResult.data, projectsResult.error ? [] : projectsResult.data),
    contextPartial: Boolean(assessmentsResult.error || projectsResult.error),
  }));
}

export async function getClient(clientId, organizationId) {
  let clientQuery = supabase.from("clients").select(CLIENT_FIELDS).eq("id", clientId);
  if (organizationId) clientQuery = clientQuery.eq("organization_id", organizationId);

  const [clientResult, assessmentsResult, projectsResult, invitationResult] = await Promise.all([
    clientQuery.single(),
    supabase.from("discovery_assessments").select("id,client_id,status,score,max_score,completed_at,updated_at,division_id").eq("client_id", clientId).order("updated_at", { ascending: false }),
    supabase.from("projects").select("id,client_id,name,status,due_at,updated_at,project_tasks(id,status,due_at,title)").eq("client_id", clientId).order("updated_at", { ascending: false }),
    supabase.from("user_invitations").select("id,status,email,created_at,expires_at").eq("source_client_id", clientId).order("created_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  if (clientResult.error) throw clientResult.error;
  return {
    ...enrichClient(clientResult.data, assessmentsResult.error ? [] : assessmentsResult.data, projectsResult.error ? [] : projectsResult.data),
    portalInvitation: invitationResult.error ? null : invitationResult.data || null,
    contextPartial: Boolean(assessmentsResult.error || projectsResult.error || invitationResult.error),
  };
}

export async function createClient(clientData) {
  const payload = sanitizeClientInput(clientData);
  const { data, error } = await supabase.from("clients").insert({
    ...payload,
    organization_id: clientData.organization_id,
    owner_id: clientData.owner_id,
  }).select(CLIENT_FIELDS).single();
  if (error) throw error;
  return enrichClient(data);
}

export async function updateClient(clientId, organizationId, updates) {
  const { data, error } = await supabase.from("clients")
    .update(sanitizeClientInput(updates))
    .eq("id", clientId).eq("organization_id", organizationId)
    .select(CLIENT_FIELDS).single();
  if (error) throw error;
  return data;
}

export async function archiveClient(clientId, organizationId) {
  return updateClient(clientId, organizationId, { status: "archived" });
}

export async function restoreClient(clientId, organizationId) {
  return updateClient(clientId, organizationId, { status: "lead" });
}

export async function getClientDeletionEligibility(clientId) {
  const { data, error } = await supabase.rpc("get_client_deletion_eligibility", { target_client_id: clientId });
  if (error) throw error;
  return data;
}

export async function deleteClientSafely(clientId) {
  const { error } = await supabase.rpc("delete_client_if_empty", { target_client_id: clientId });
  if (error) throw error;
}

export async function getClientNotes(clientId) {
  const { data, error } = await supabase.from("client_notes")
    .select("id,content,created_at,updated_at,created_by,author:users!client_notes_created_by_fkey(first_name)")
    .eq("client_id", clientId).order("created_at", { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function createClientNote({ clientId, organizationId, userId, content }) {
  const { error } = await supabase.from("client_notes").insert({
    client_id: clientId, organization_id: organizationId, created_by: userId, content: content.trim(),
  });
  if (error) throw error;
}

function sanitizeClientInput(input) {
  const value = (field) => String(input[field] || "").trim() || null;
  return {
    company_name: String(input.company_name || "").trim(),
    contact_name: value("contact_name"),
    email: value("email"),
    phone: value("phone"),
    website: value("website"),
    industry: value("industry"),
    status: value("status") || "lead",
  };
}

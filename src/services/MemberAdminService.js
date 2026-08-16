import { supabase } from "../lib/supabase";

export const MEMBER_MODULES = [
  { key: "dashboard", label: "Dashboard" },
  { key: "clients", label: "Clientes" },
  { key: "discovery", label: "Discovery" },
  { key: "projects", label: "Proyectos" },
  { key: "area_score", label: "Scores de área" },
  { key: "playbooks", label: "Playbooks" },
];

export async function getMemberAdministrationData(organizationId) {
  const [membersResult, invitationsResult, modulesResult, scoreAccessResult, divisionsResult] = await Promise.all([
    supabase.rpc("admin_list_members_v2"),
    supabase.from("user_invitations").select("id, email, first_name, title, role, status, expires_at, division, created_at").eq("organization_id", organizationId).eq("status", "pending").order("created_at", { ascending: false }),
    supabase.from("member_module_access").select("user_id, module_key, enabled"),
    supabase.from("user_division_score_access").select("user_id, division_id"),
    supabase.from("divisions").select("id, name, active, position").eq("organization_id", organizationId).order("position").order("name"),
  ]);
  const error = [membersResult, invitationsResult, modulesResult, scoreAccessResult, divisionsResult].find((result) => result.error)?.error;
  if (error) throw error;
  return {
    members: (membersResult.data || []).filter((member) => member.organization_id === organizationId),
    invitations: invitationsResult.data || [],
    moduleAccess: modulesResult.data || [],
    scoreAccess: scoreAccessResult.data || [],
    divisions: divisionsResult.data || [],
  };
}

export async function updateMemberProfile(member, form) {
  const { data, error } = await supabase.rpc("admin_update_member_professional", {
    target_user_id: member.id,
    new_first_name: form.firstName.trim(),
    new_title: form.title.trim(),
    new_role: form.role,
    new_organization_id: member.organization_id,
    new_division: form.division,
    new_position: form.jobPosition.trim(),
    new_specialty: form.specialty.trim(),
  });
  if (error) throw error;
  return data;
}

async function syncJoinTable({ table, userId, column, currentIds, nextIds, extra = {} }) {
  const current = new Set(currentIds);
  const next = new Set(nextIds);
  const removed = [...current].filter((id) => !next.has(id));
  const added = [...next].filter((id) => !current.has(id));
  const requests = [];
  if (removed.length) requests.push(supabase.from(table).delete().eq("user_id", userId).in(column, removed));
  if (added.length) requests.push(supabase.from(table).insert(added.map((id) => ({ user_id: userId, [column]: id, ...extra }))));
  const results = await Promise.all(requests);
  const error = results.find((result) => result.error)?.error;
  if (error) throw error;
}

export async function updateMemberAccess({ userId, moduleKeys, currentScoreIds, scoreIds }) {
  const moduleResult = await supabase.from("member_module_access").upsert(
    MEMBER_MODULES.map(({ key }) => ({ user_id: userId, module_key: key, enabled: moduleKeys.includes(key), updated_at: new Date().toISOString() })),
    { onConflict: "user_id,module_key" },
  );
  if (moduleResult.error) throw moduleResult.error;
  await syncJoinTable({ table: "user_division_score_access", userId, column: "division_id", currentIds: currentScoreIds, nextIds: scoreIds });
}

export async function inviteOrganizationMember(payload) {
  const invitationPayload = {
    ...payload,
    role: payload.role === "admin" ? "organization_admin" : payload.role,
  };
  const { data, error } = await supabase.functions.invoke("invite-user", { body: invitationPayload });
  if (error || data?.error) throw new Error(data?.error || error?.message || "No se pudo enviar la invitación.");
  return data;
}

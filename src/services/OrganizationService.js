import { supabase } from "../lib/supabase";


export async function getUserOrganization(userId) {

  const { data, error } = await supabase
    .from("users")
    .select(`
      organization_id,
      organizations (
        id,
        name,
        created_at
      )
    `)
    .eq("id", userId)
    .single();


  if (error) {
    throw error;
  }


  return data.organization;
}

export async function updateOrganizationName({ organizationId, name, organizationType }) {
  const { data, error } = await supabase.rpc("admin_update_organization", {
    target_organization_id: organizationId,
    new_name: name.trim(),
    new_type: organizationType,
  });

  if (error) throw error;
  return data;
}

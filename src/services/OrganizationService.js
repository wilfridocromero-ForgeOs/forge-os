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
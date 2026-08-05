import { supabase } from "../lib/supabase";

export async function getDivisions(organizationId, { includeInactive = false } = {}) {
  if (!organizationId) return [];
  let query = supabase
    .from("divisions")
    .select("id, organization_id, name, slug, description, active, position")
    .eq("organization_id", organizationId)
    .order("position")
    .order("name");
  if (!includeInactive) query = query.eq("active", true);
  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

export async function createDivision(organizationId, input) {
  const slug = input.name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  const { data, error } = await supabase
    .from("divisions")
    .insert({ organization_id: organizationId, name: input.name.trim(), slug, description: input.description?.trim() || null })
    .select()
    .single();
  if (error) throw error;
  return data;
}

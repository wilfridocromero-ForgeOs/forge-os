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
    .insert({ organization_id: organizationId, name: input.name.trim(), slug, description: input.description?.trim() || null, position: input.position ?? 0 })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateDivision(divisionId, input) {
  const { data, error } = await supabase.from("divisions").update({
    name: input.name.trim(),
    description: input.description?.trim() || null,
    updated_at: new Date().toISOString(),
  }).eq("id", divisionId).select().single();
  if (error) throw error;
  return data;
}

export async function setDivisionActive(divisionId, active) {
  const { data, error } = await supabase.from("divisions").update({ active, updated_at: new Date().toISOString() }).eq("id", divisionId).select().single();
  if (error) throw error;
  return data;
}

export async function reorderDivisions(divisions) {
  const results = await Promise.all(divisions.map((division, position) => supabase.from("divisions").update({ position, updated_at: new Date().toISOString() }).eq("id", division.id)));
  const error = results.find((result) => result.error)?.error;
  if (error) throw error;
}

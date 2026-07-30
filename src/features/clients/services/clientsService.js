import { supabase } from "../../../lib/supabase";

export async function getClients() {
  const { data, error } = await supabase
    .from("clients")
    .select("*")
    .order("id", { ascending: true });

  if (error) throw error;

  return data;
}

export async function createClient(client) {
  const { data, error } = await supabase
    .from("clients")
    .insert([client])
    .select()
    .single();

  if (error) throw error;

  return data;
}

export async function updateClient(id, updates) {
  const { data, error } = await supabase
    .from("clients")
    .update(updates)
    .eq("id", id)
    .select()
    .single();

  if (error) throw error;

  return data;
}

export async function deleteClient(id) {
  const { error } = await supabase
    .from("clients")
    .delete()
    .eq("id", id);

  if (error) throw error;
}
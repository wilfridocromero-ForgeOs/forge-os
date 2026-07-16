import { supabase } from "../lib/supabase";

export async function getClients() {
  const { data, error } = await supabase
    .from("clients")
    .select("*")
    .order("id", { ascending: true });

  if (error) throw error;

  return data;
}

export async function createClient(client) {
  const { error } = await supabase
    .from("clients")
    .insert([client]);

  if (error) throw error;
}
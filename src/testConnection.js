import supabase from "./lib/supabase";

export async function testConnection() {
  const { data, error } = await supabase
    .from("organizations")
    .select("*");

  console.log("DATA:", data);
  console.log("ERROR:", error);
}
import { supabase } from "../lib/supabase";


export async function getDashboardData(organizationId) {


  const clients = await supabase
    .from("clients")
    .select("*", { count:"exact" })
    .eq(
      "organization_id",
      organizationId
    );


  const discoveries = await supabase
    .from("discoveries")
    .select("*", { count:"exact" })
    .eq(
      "organization_id",
      organizationId
    );


  return {

    clients:
      clients.count ?? 0,


    discoveries:
      discoveries.count ?? 0,

  };

}
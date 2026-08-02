import { supabase } from "../lib/supabase";


export async function getProjects(organizationId){

 const {
   data,
   error
 } = await supabase

 .from("projects")

 .select(`
    id,
    name,
    description,
    status,
    progress,
    client_id
 `)

 .eq(
   "organization_id",
   organizationId
 );


 if(error){
   throw error;
 }


 return data;

}
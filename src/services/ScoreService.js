import { supabase } from "../lib/supabase";


export async function getScores(
 organizationId
){

 const {
  data,
  error
 } = await supabase

 .from("scores")

 .select("*")

 .eq(
  "organization_id",
  organizationId
 );


 if(error){
   throw error;
 }


 return data;

}

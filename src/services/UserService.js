import { supabase } from "../lib/supabase";


export async function getCurrentUser() {

  const {
    data: {
      user
    },
    error
  } = await supabase.auth.getUser();


  if (error) {
    throw error;
  }


  return user;
}
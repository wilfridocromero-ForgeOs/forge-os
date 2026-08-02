import {
  createContext,
  useContext,
  useEffect,
  useState
} from "react";

import { supabase } from "../lib/supabase";

import { useAuth } from "./AuthContext";


const OrganizationContext = createContext(null);



export function OrganizationProvider({ children }) {

  const { user } = useAuth();


  const [organization, setOrganization] = useState(null);

  const [loading, setLoading] = useState(true);



  useEffect(() => {

    async function loadOrganization() {


      if (!user) {

        setOrganization(null);

        setLoading(false);

        return;

      }


      const {
        data,
        error
      } = await supabase

        .from("users")

        .select(`
          organization_id,
          organizations (
            id,
            name
          )
        `)

        .eq(
          "id",
          user.id
        )

        .single();



      if(error){

        console.error(
          "Organization error:",
          error
        );

        setLoading(false);

        return;

      }



      setOrganization(
        data?.organizations ?? null
      );


      setLoading(false);


    }



    loadOrganization();


  }, [user]);





  return (

    <OrganizationContext.Provider

      value={{
        organization,
        setOrganization,
        loading
      }}

    >

      {children}

    </OrganizationContext.Provider>

  );

}




export const useOrganization = () =>
  useContext(OrganizationContext);
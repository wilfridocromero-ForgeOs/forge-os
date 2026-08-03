import { createContext, useContext, useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

const AuthContext = createContext();

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState(null);

  useEffect(() => {
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      setLoading(false);
    });

    supabase.auth.getSession().then(({ data, error }) => {
      if (error) {
        console.error("No se pudo restaurar la sesión:", error.message);
      }

      setSession(data.session);
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    let active = true;

    if (!session?.user?.id) {
      setProfile(null);
      return undefined;
    }

    supabase
      .from("users")
      .select("first_name, organization_id, title")
      .eq("id", session.user.id)
      .maybeSingle()
      .then(({ data, error }) => {
        if (!active) return;

        if (error) {
          console.error("No se pudo cargar el perfil:", error.message);
          setProfile(null);
          return;
        }

        setProfile(data);
      });

    return () => {
      active = false;
    };
  }, [session?.user?.id]);

  const displayName =
    profile?.first_name ||
    session?.user?.user_metadata?.first_name ||
    session?.user?.email?.split("@")[0] ||
    "Usuario";

  const initial = displayName.trim().charAt(0).toUpperCase() || "U";
  const displayTitle = profile?.title || "Miembro";

  async function updateProfile({ firstName, title }) {
    if (!session?.user?.id) {
      throw new Error("No hay una sesión activa.");
    }

    const { data, error } = await supabase
      .from("users")
      .update({
        first_name: firstName.trim(),
        title: title.trim() || "Miembro",
      })
      .eq("id", session.user.id)
      .select("first_name, organization_id, title")
      .single();

    if (error) throw error;

    setProfile(data);
    return data;
  }

 return (
  <AuthContext.Provider
    value={{
      session,
      user: session?.user ?? null,
      profile,
      displayName,
      initial,
      displayTitle,
      updateProfile,
      loading,

      logout: () => supabase.auth.signOut(),
    }}
  >
    {children}
  </AuthContext.Provider>
);
}

export function useAuth() {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error("useAuth debe utilizarse dentro de AuthProvider.");
  }

  return context;
}

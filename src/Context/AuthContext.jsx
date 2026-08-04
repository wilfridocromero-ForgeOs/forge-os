import { createContext, useContext, useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

const AuthContext = createContext();

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState(null);
  const [profileUserId, setProfileUserId] = useState(null);
  const [moduleAccess, setModuleAccess] = useState([]);
  const [areaAccess, setAreaAccess] = useState([]);

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
      setProfileUserId(null);
      return undefined;
    }

    supabase
      .from("users")
      .select("first_name, organization_id, title, role")
      .eq("id", session.user.id)
      .maybeSingle()
      .then(({ data, error }) => {
        if (!active) return;

        if (error) {
          console.error("No se pudo cargar el perfil:", error.message);
          setProfile(null);
          setProfileUserId(session.user.id);
          return;
        }

        setProfile(data);
        setProfileUserId(session.user.id);
      });

    Promise.all([
      supabase.from("member_module_access").select("module_key, enabled").eq("user_id", session.user.id),
      supabase.from("user_area_access").select("area_id, is_primary, work_areas(id, name)").eq("user_id", session.user.id),
    ]).then(([modulesResult, areasResult]) => {
      if (!active) return;
      setModuleAccess(modulesResult.data || []);
      setAreaAccess(areasResult.data || []);
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
  const role = profile?.role || "member";
  const canManageUsers = role === "platform_owner" || role === "organization_admin";

  function canAccess(moduleKey) {
    if (canManageUsers) return true;
    const configured = moduleAccess.find((item) => item.module_key === moduleKey);
    if (configured) return configured.enabled;
    return moduleKey !== "area_score";
  }

  async function updateProfile({ firstName }) {
    if (!session?.user?.id) {
      throw new Error("No hay una sesión activa.");
    }

    const { data, error } = await supabase.rpc("update_my_profile", {
      new_first_name: firstName.trim(),
    });

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
      role,
      canManageUsers,
      canAccess,
      moduleAccess,
      areaAccess,
      updateProfile,
      loading: loading || Boolean(session?.user?.id && profileUserId !== session.user.id),

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

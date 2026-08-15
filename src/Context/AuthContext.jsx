import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import { CAPABILITIES, getRoleCapabilities } from "../config/capabilities";
import { updateOrganizationName as persistOrganizationName } from "../services/OrganizationService";

const AuthContext = createContext();

const ROLE_LABELS = {
  platform_owner: "Founder",
  organization_admin: "Propietario",
  area_lead: "Líder de área",
  member: "Miembro",
};

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [sessionResolved, setSessionResolved] = useState(false);
  const [identity, setIdentity] = useState({
    status: "idle",
    userId: null,
    profile: null,
    moduleAccess: [],
    error: null,
  });

  useEffect(() => {
    let active = true;

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (!active) return;
      setSession(nextSession);
      setSessionResolved(true);
      setIdentity((current) => {
        const nextUserId = nextSession?.user?.id ?? null;
        if (current.userId === nextUserId) return current;
        return {
          status: nextUserId ? "resolving" : "idle",
          userId: nextUserId,
          profile: null,
          moduleAccess: [],
          error: null,
        };
      });
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    let active = true;
    const userId = session?.user?.id;

    if (!userId) return undefined;

    Promise.all([
      supabase
        .from("users")
        .select("first_name, organization_id, title, role, organizations(id, name, organization_type, created_at, updated_at)")
        .eq("id", userId)
        .maybeSingle(),
      supabase.from("member_module_access").select("module_key, enabled").eq("user_id", userId),
    ])
      .then(([profileResult, modulesResult]) => {
        if (!active) return;

        const requestError = profileResult.error || modulesResult.error;
        if (requestError) {
          console.error("No se pudo resolver la identidad activa:", requestError.message);
          setIdentity({
            status: "error",
            userId,
            profile: null,
            moduleAccess: [],
            error: requestError,
          });
          return;
        }

        if (!profileResult.data) {
          setIdentity({
            status: "unauthorized",
            userId,
            profile: null,
            moduleAccess: [],
            error: null,
          });
          return;
        }

        const profile = profileResult.data;
        const hasValidRole = Object.hasOwn(ROLE_LABELS, profile.role);
        const organization = profile.organizations;

        setIdentity({
          status: !organization
            ? "no_organization"
            : hasValidRole
              ? "authorized"
              : "unauthorized",
          userId,
          profile,
          moduleAccess: modulesResult.data || [],
          error: null,
        });
      })
      .catch((error) => {
        if (!active) return;
        console.error("No se pudo resolver la identidad activa:", error);
        setIdentity({
          status: "error",
          userId,
          profile: null,
          moduleAccess: [],
          error,
        });
      });

    return () => {
      active = false;
    };
  }, [session?.user?.id]);

  const profile = identity.profile;
  const organization = profile?.organizations ?? null;
  const role = identity.status === "authorized" ? profile.role : null;
  const roleLabel = role ? ROLE_LABELS[role] : null;
  const capabilities = useMemo(() => getRoleCapabilities(role), [role]);
  const canManageUsers = capabilities[CAPABILITIES.manageMembers];
  const organizationType = organization?.organization_type ?? null;
  const isInternalOrganization = organizationType === "internal";
  const displayName =
    profile?.first_name ||
    session?.user?.user_metadata?.first_name ||
    session?.user?.email?.split("@")[0] ||
    "Usuario";
  const initial = displayName.trim().charAt(0).toUpperCase() || "U";

  const permissions = useMemo(() => ({
    canManageUsers,
    canAccess(moduleKey) {
      if (identity.status !== "authorized") return false;
      if (canManageUsers) return true;
      const configured = identity.moduleAccess.find((item) => item.module_key === moduleKey);
      if (configured) return configured.enabled;
      return moduleKey !== "area_score";
    },
  }), [canManageUsers, identity.moduleAccess, identity.status]);

  function hasCapability(capability) {
    return identity.status === "authorized" && capabilities[capability] === true;
  }

  async function updateProfile({ firstName }) {
    if (!session?.user?.id) throw new Error("No hay una sesión activa.");

    const { data, error } = await supabase.rpc("update_my_profile", {
      new_first_name: firstName.trim(),
    });
    if (error) throw error;

    setIdentity((current) => ({
      ...current,
      profile: { ...current.profile, ...data },
    }));
    return data;
  }

  async function updateOrganizationName(name) {
    if (!organization?.id || !organization.organization_type) {
      throw new Error("No hay una organización activa.");
    }
    if (!hasCapability(CAPABILITIES.updateOrganizationProfile)) {
      throw new Error("Tu rol no permite editar la organización.");
    }

    const updatedOrganization = await persistOrganizationName({
      organizationId: organization.id,
      name,
      organizationType: organization.organization_type,
    });

    setIdentity((current) => ({
      ...current,
      profile: {
        ...current.profile,
        organizations: updatedOrganization,
      },
    }));
    return updatedOrganization;
  }

  const authStatus = !sessionResolved
    ? "loading"
    : session
      ? "authenticated"
      : "unauthenticated";
  const loading = authStatus === "loading" || identity.status === "resolving";

  return (
    <AuthContext.Provider
      value={{
        session,
        user: session?.user ?? null,
        profile,
        organization,
        membership: profile
          ? { organizationId: profile.organization_id, role: profile.role }
          : null,
        authStatus,
        identityStatus: identity.status,
        identityError: identity.error,
        displayName,
        initial,
        displayTitle: roleLabel,
        jobTitle: profile?.title ?? null,
        role,
        roleLabel,
        capabilities,
        hasCapability,
        permissions,
        canManageUsers,
        organizationType,
        isInternalOrganization,
        canAccess: permissions.canAccess,
        moduleAccess: identity.moduleAccess,
        updateProfile,
        updateOrganizationName,
        loading,
        logout: () => supabase.auth.signOut(),
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

// Context providers and their consumer hooks intentionally share this module.
// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth debe utilizarse dentro de AuthProvider.");
  return context;
}

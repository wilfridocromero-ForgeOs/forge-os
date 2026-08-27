import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import { CAPABILITIES, getRoleCapabilities } from "../config/capabilities";
import { updateOrganizationName as persistOrganizationName } from "../services/OrganizationService";

const AuthContext = createContext();
const IDENTITY_RETRY_DELAYS_MS = [0, 500, 1500];

function isSessionAuthorizationError(error, status) {
  if (status === 401) return true;

  const code = String(error?.code || "").toUpperCase();
  const message = String(error?.message || "").toLowerCase();
  return code === "PGRST301" || message.includes("jwt") || message.includes("token");
}

const ROLE_LABELS = {
  founder: "Fundador",
  admin: "Administrador",
  area_lead: "Líder de área",
  member: "Miembro",
};

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [sessionResolved, setSessionResolved] = useState(false);
  const [identityRevision, setIdentityRevision] = useState(0);
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
        if (current.userId === nextUserId) {
          if (!nextUserId || current.status === "authorized") return current;
          return { ...current, status: "resolving", error: null };
        }
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

    async function resolveIdentity() {
      let lastError = null;
      let refreshedSession = false;

      setIdentity((current) => (
        current.userId === userId
          ? { ...current, status: "resolving", error: null }
          : current
      ));

      for (const delay of IDENTITY_RETRY_DELAYS_MS) {
        if (delay) await new Promise((resolve) => window.setTimeout(resolve, delay));
        if (!active) return;

        try {
          const [contextResult, modulesResult] = await Promise.all([
            supabase.rpc("get_my_authorization_context"),
            supabase.from("member_module_access").select("module_key, enabled").eq("user_id", userId),
          ]);
          if (!active) return;

          const requestError = contextResult.error || modulesResult.error;
          if (requestError) {
            lastError = requestError;

            const requestStatus = contextResult.error
              ? contextResult.status
              : modulesResult.status;
            if (!refreshedSession && isSessionAuthorizationError(requestError, requestStatus)) {
              refreshedSession = true;
              const refreshResult = await supabase.auth.refreshSession();
              if (!active) return;

              if (refreshResult.data.session) {
                setSession(refreshResult.data.session);
                setSessionResolved(true);
                continue;
              }

              if (!refreshResult.error) {
                setSession(null);
                setSessionResolved(true);
                setIdentity({
                  status: "idle",
                  userId: null,
                  profile: null,
                  moduleAccess: [],
                  error: null,
                });
                return;
              }

              lastError = refreshResult.error;
            }
            continue;
          }

          if (!contextResult.data) {
            setIdentity({
              status: "unauthorized",
              userId,
              profile: null,
              moduleAccess: [],
              error: null,
            });
            return;
          }

          const context = contextResult.data;
          const organization = context.organization;
          const membership = context.membership;
          const profile = {
            ...context.profile,
            organization_id: membership?.organization_id ?? null,
            role: membership?.role ?? null,
            organizations: organization,
          };
          const hasValidRole = Object.hasOwn(ROLE_LABELS, membership?.role);

          setIdentity({
            status: !organization
              ? "no_organization"
              : hasValidRole
                ? "authorized"
                : "unauthorized",
            userId,
            profile,
            membership,
            organizations: context.organizations || [],
            moduleAccess: modulesResult.data || [],
            error: null,
          });
          return;
        } catch (error) {
          lastError = error;
        }
      }

      if (!active) return;
      console.error("No se pudo resolver la identidad activa:", lastError);
      setIdentity({
        status: "error",
        userId,
        profile: null,
        moduleAccess: [],
        error: lastError,
      });
    }

    resolveIdentity();

    return () => {
      active = false;
    };
  }, [session?.access_token, session?.user?.id, identityRevision]);

  useEffect(() => {
    if (identity.status !== "error") return undefined;

    const retryWhenOnline = () => {
      setIdentity((current) => ({ ...current, status: "resolving", error: null }));
      setIdentityRevision((current) => current + 1);
    };
    const retryWhenVisible = () => {
      if (document.visibilityState === "visible") retryWhenOnline();
    };

    window.addEventListener("online", retryWhenOnline);
    window.addEventListener("pageshow", retryWhenOnline);
    document.addEventListener("visibilitychange", retryWhenVisible);

    return () => {
      window.removeEventListener("online", retryWhenOnline);
      window.removeEventListener("pageshow", retryWhenOnline);
      document.removeEventListener("visibilitychange", retryWhenVisible);
    };
  }, [identity.status]);

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

  async function setActiveOrganization(organizationId) {
    if (!session?.user?.id) throw new Error("No hay una sesión activa.");
    setIdentity((current) => ({ ...current, status: "resolving", error: null }));
    const { error } = await supabase.rpc("set_active_organization", {
      target_organization_id: organizationId,
    });
    if (error) {
      setIdentity((current) => ({ ...current, status: "error", error }));
      throw error;
    }
    setIdentityRevision((current) => current + 1);
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
        membership: identity.membership ?? null,
        organizations: identity.organizations ?? [],
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
        setActiveOrganization,
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

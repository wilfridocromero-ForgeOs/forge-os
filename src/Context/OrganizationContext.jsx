import { createContext, useContext } from "react";
import { useAuth } from "./AuthContext";

const OrganizationContext = createContext(null);

export function OrganizationProvider({ children }) {
  const authorization = useAuth();

  return (
    <OrganizationContext.Provider
      value={{
        organization: authorization.organization,
        activeOrganization: authorization.organization,
        organizations: authorization.organizations,
        membership: authorization.membership,
        role: authorization.role,
        permissions: authorization.permissions,
        capabilities: authorization.capabilities,
        hasCapability: authorization.hasCapability,
        setActiveOrganization: authorization.setActiveOrganization,
        loading: authorization.loading,
        status: authorization.identityStatus,
        error: authorization.identityError,
      }}
    >
      {children}
    </OrganizationContext.Provider>
  );
}

// Context providers and their consumer hooks intentionally share this module.
// eslint-disable-next-line react-refresh/only-export-components
export function useOrganization() {
  const context = useContext(OrganizationContext);
  if (!context) {
    throw new Error("useOrganization debe utilizarse dentro de OrganizationProvider.");
  }
  return context;
}

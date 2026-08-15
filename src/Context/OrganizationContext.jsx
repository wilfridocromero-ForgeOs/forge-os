import { createContext, useContext } from "react";
import { useAuth } from "./AuthContext";

const OrganizationContext = createContext(null);

export function OrganizationProvider({ children }) {
  const { organization, identityStatus, loading } = useAuth();

  return (
    <OrganizationContext.Provider
      value={{
        organization,
        loading,
        status: identityStatus,
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

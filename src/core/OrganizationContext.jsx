import {
  createContext,
  useContext,
  useMemo,
  useState,
} from "react";

import { organization as initialOrganization } from "../data/organization";
import { ai as initialAI } from "../data/ai";
import { modules } from "../data/modules";
import { permissions } from "../data/permissions";
import { navigation } from "../data/navigation";

const OrganizationContext = createContext(null);

export function OrganizationProvider({ children }) {
  const [organization, setOrganization] =
    useState(initialOrganization);

  const [ai, setAI] =
    useState(initialAI);

  const value = useMemo(
    () => ({
      organization,
      ai,
      modules,
      permissions,
      navigation,

      setOrganization,
      setAI,
    }),
    [
      organization,
      ai,
    ]
  );

  return (
    <OrganizationContext.Provider
      value={value}
    >
      {children}
    </OrganizationContext.Provider>
  );
}

export function useOrganization() {
  const context = useContext(
    OrganizationContext
  );

  if (!context) {
    throw new Error(
      "useOrganization debe utilizarse dentro de OrganizationProvider."
    );
  }

  return context;
}
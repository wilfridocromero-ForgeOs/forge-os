import { useOrganization } from "./OrganizationContext";

export default function usePermissions() {
  const { permissions } = useOrganization();

  function can(module, role = "owner") {
    if (!permissions[role]) return false;

    if (permissions[role].includes("*")) return true;

    return permissions[role].includes(module);
  }

  return {
    can,
    permissions,
  };
}
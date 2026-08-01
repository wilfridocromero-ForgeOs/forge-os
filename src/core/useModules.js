import { useOrganization } from "./OrganizationContext";

export default function useModules() {
  const { modules } = useOrganization();

  const enabledModules = modules.filter(
    (module) => module.enabled
  );

  const disabledModules = modules.filter(
    (module) => !module.enabled
  );

  function getModule(id) {
    return modules.find(
      (module) => module.id === id
    );
  }

  function isEnabled(id) {
    return modules.some(
      (module) =>
        module.id === id &&
        module.enabled
    );
  }

  return {
    modules,

    enabledModules,

    disabledModules,

    getModule,

    isEnabled,
  };
}
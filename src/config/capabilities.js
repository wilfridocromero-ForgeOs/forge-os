export const CAPABILITIES = Object.freeze({
  manageOrganization: "manageOrganization",
  updateOrganizationProfile: "updateOrganizationProfile",
  manageMembers: "manageMembers",
  manageDivisions: "manageDivisions",
  accessBuilderHub: "accessBuilderHub",
  createSystems: "createSystems",
  editSystems: "editSystems",
  publishSystems: "publishSystems",
});

const ADMIN_CAPABILITIES = Object.freeze(
  Object.fromEntries(Object.values(CAPABILITIES).map((capability) => [capability, true])),
);

const NO_ADMIN_CAPABILITIES = Object.freeze(
  Object.fromEntries(Object.values(CAPABILITIES).map((capability) => [capability, false])),
);

const ROLE_CAPABILITIES = Object.freeze({
  platform_owner: ADMIN_CAPABILITIES,
  organization_admin: Object.freeze({
    ...ADMIN_CAPABILITIES,
    updateOrganizationProfile: false,
  }),
  area_lead: NO_ADMIN_CAPABILITIES,
  member: NO_ADMIN_CAPABILITIES,
});

export function getRoleCapabilities(role) {
  return ROLE_CAPABILITIES[role] ?? NO_ADMIN_CAPABILITIES;
}

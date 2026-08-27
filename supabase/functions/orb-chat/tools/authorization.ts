import type { SupabaseClient } from "@supabase/supabase-js";

export type OrbToolPermission =
  | "projects"
  | "discovery"
  | "area_score"
  | "clients"
  | "calendar";
export type OrbToolPermissions = Record<OrbToolPermission, boolean>;

const ADMIN_ROLES = new Set(["platform_owner", "organization_admin"]);
const DENIED: OrbToolPermissions = {
  projects: false,
  discovery: false,
  area_score: false,
  clients: false,
  calendar: false,
};

export async function getOrbToolPermissions(
  client: SupabaseClient,
  userId: string,
  role: string,
): Promise<OrbToolPermissions> {
  if (ADMIN_ROLES.has(role)) {
    return {
      projects: true,
      discovery: true,
      area_score: true,
      clients: true,
      calendar: true,
    };
  }
  try {
    const { data, error } = await client.from("member_module_access").select(
      "module_key,enabled",
    ).eq("user_id", userId);
    if (error) return { ...DENIED };
    const configured = new Map(
      (data || []).map((
        row: { module_key: string; enabled: boolean },
      ) => [row.module_key, row.enabled]),
    );
    const access = (key: string, fallback: boolean) =>
      configured.has(key) ? configured.get(key) === true : fallback;
    return {
      projects: access("projects", true),
      discovery: access("discovery", true),
      area_score: access("area_score", false),
      clients: access("clients", true),
      // Calendar has no independent module key in the current authorization model.
      calendar: true,
    };
  } catch {
    return { ...DENIED };
  }
}

import { supabase } from "../lib/supabase";

export const NOTIFICATION_PAGE_SIZE = 25;

const notificationColumns = "id, organization_id, recipient_user_id, actor_user_id, type, title, body, entity_type, entity_id, project_id, task_id, source_type, source_id, action_url, metadata, read_at, created_at";

export async function getUnreadNotificationCount(userId, organizationId) {
  if (!userId || !organizationId) return 0;
  const { count, error } = await supabase.from("notifications").select("id", { count: "exact", head: true })
    .eq("recipient_user_id", userId).eq("organization_id", organizationId).is("read_at", null);
  if (error) throw error;
  return count || 0;
}

export async function getNotificationsPage(userId, organizationId, cursor = null) {
  if (!userId || !organizationId) return [];
  let query = supabase.from("notifications").select(notificationColumns)
    .eq("recipient_user_id", userId).eq("organization_id", organizationId)
    .order("created_at", { ascending: false }).order("id", { ascending: false })
    .limit(NOTIFICATION_PAGE_SIZE);

  if (cursor) {
    query = query.or(`created_at.lt.${cursor.created_at},and(created_at.eq.${cursor.created_at},id.lt.${cursor.id})`);
  }

  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

export async function markNotificationRead(notificationId) {
  if (!notificationId) return;
  const { error } = await supabase.from("notifications")
    .update({ read_at: new Date().toISOString() }).eq("id", notificationId).is("read_at", null);
  if (error) throw error;
}

export async function markAllNotificationsRead(userId, organizationId) {
  if (!userId || !organizationId) return;
  const { error } = await supabase.from("notifications").update({ read_at: new Date().toISOString() })
    .eq("recipient_user_id", userId).eq("organization_id", organizationId).is("read_at", null);
  if (error) throw error;
}

import { createClient } from "@supabase/supabase-js";
import webpush from "web-push";

type NotificationRecord = {
  id: string;
  organization_id: string;
  recipient_user_id: string;
  type: string;
  title: string;
  body: string | null;
  action_url: string | null;
};

type WebhookPayload = {
  type?: string;
  table?: string;
  schema?: string;
  record?: { id?: string };
};

type PushSubscriptionRecord = {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
};

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function secureEqual(left: string, right: string) {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) {
    mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return mismatch === 0;
}

function requiredSecret(name: string) {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing required secret: ${name}`);
  return value;
}

function serviceKey() {
  const modernKeys = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (modernKeys) {
    const parsed = JSON.parse(modernKeys) as Record<string, string>;
    if (parsed.default) return parsed.default;
  }
  return requiredSecret("SUPABASE_SERVICE_ROLE_KEY");
}

function safeActionUrl(value: string | null) {
  return value?.startsWith("/") && !value.startsWith("//") ? value : "/";
}

Deno.serve(async (request) => {
  if (request.method !== "POST") return json(405, { error: "method_not_allowed" });

  try {
    const expectedWebhookSecret = requiredSecret("PUSH_WEBHOOK_SECRET");
    const suppliedWebhookSecret = request.headers.get("x-orvesen-push-secret") || "";
    if (!secureEqual(suppliedWebhookSecret, expectedWebhookSecret)) {
      return json(401, { error: "unauthorized" });
    }

    const webhook = await request.json() as WebhookPayload;
    if (webhook.type !== "INSERT" || webhook.schema !== "public" || webhook.table !== "notifications" || !webhook.record?.id) {
      return json(400, { error: "invalid_webhook_payload" });
    }

    const supabase = createClient(requiredSecret("SUPABASE_URL"), serviceKey(), {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: notification, error: notificationError } = await supabase
      .from("notifications")
      .select("id, organization_id, recipient_user_id, type, title, body, action_url")
      .eq("id", webhook.record.id)
      .single<NotificationRecord>();
    if (notificationError || !notification) return json(404, { error: "notification_not_found" });

    const { data: subscriptions, error: subscriptionsError } = await supabase
      .from("push_subscriptions")
      .select("id, endpoint, p256dh, auth")
      .eq("user_id", notification.recipient_user_id)
      .eq("organization_id", notification.organization_id)
      .returns<PushSubscriptionRecord[]>();
    if (subscriptionsError) throw subscriptionsError;

    webpush.setVapidDetails(
      requiredSecret("VAPID_SUBJECT"),
      requiredSecret("VAPID_PUBLIC_KEY"),
      requiredSecret("VAPID_PRIVATE_KEY"),
    );

    const payload = JSON.stringify({
      notificationId: notification.id,
      title: notification.title,
      body: notification.body,
      actionUrl: safeActionUrl(notification.action_url),
      type: notification.type,
    });

    const results = await Promise.allSettled((subscriptions || []).map(async (subscription) => {
      try {
        await webpush.sendNotification({
          endpoint: subscription.endpoint,
          keys: { p256dh: subscription.p256dh, auth: subscription.auth },
        }, payload, { TTL: 300, urgency: "high" });
        await supabase.from("push_subscriptions")
          .update({ last_used_at: new Date().toISOString() })
          .eq("id", subscription.id)
          .eq("user_id", notification.recipient_user_id)
          .eq("organization_id", notification.organization_id);
        return { id: subscription.id, status: "sent" };
      } catch (deliveryError) {
        const statusCode = Number((deliveryError as { statusCode?: number }).statusCode || 0);
        if (statusCode === 404 || statusCode === 410) {
          await supabase.from("push_subscriptions")
            .delete()
            .eq("id", subscription.id)
            .eq("user_id", notification.recipient_user_id)
            .eq("organization_id", notification.organization_id);
          return { id: subscription.id, status: "expired" };
        }
        throw deliveryError;
      }
    }));

    const delivered = results.filter((result) => result.status === "fulfilled" && result.value.status === "sent").length;
    const expired = results.filter((result) => result.status === "fulfilled" && result.value.status === "expired").length;
    const failed = results.length - delivered - expired;
    return json(200, { notificationId: notification.id, subscriptions: results.length, delivered, expired, failed });
  } catch (error) {
    console.error("Push delivery failed", error instanceof Error ? error.message : error);
    return json(500, { error: "push_delivery_failed" });
  }
});

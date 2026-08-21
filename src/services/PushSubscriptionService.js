import { supabase } from "../lib/supabase";

const PUBLIC_VAPID_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY;
const SERVICE_WORKER_URL = "/sw.js";

export function getPushSupport() {
  const hasBrowserApis = typeof window !== "undefined" && typeof navigator !== "undefined";
  if (!hasBrowserApis || !("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
    return { supported: false, permission: "unsupported", configured: Boolean(PUBLIC_VAPID_KEY) };
  }
  return { supported: true, permission: window.Notification.permission, configured: Boolean(PUBLIC_VAPID_KEY) };
}

export async function getDevicePushState() {
  const support = getPushSupport();
  if (!support.supported || !support.configured) return { ...support, active: false };
  const registration = await navigator.serviceWorker.getRegistration("/");
  const subscription = await registration?.pushManager.getSubscription();
  return { ...support, active: Boolean(subscription) };
}

function urlBase64ToUint8Array(value) {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
  const bytes = atob(base64);
  return Uint8Array.from(bytes, (character) => character.charCodeAt(0));
}

function deviceLabel() {
  const platform = navigator.userAgentData?.platform || navigator.platform || "Dispositivo";
  return `${platform} · navegador web`.slice(0, 120);
}

async function persistSubscription(subscription, userId, organizationId) {
  const serialized = subscription.toJSON();
  if (!serialized.endpoint || !serialized.keys?.p256dh || !serialized.keys?.auth) {
    throw new Error("El navegador no devolvió una suscripción Web Push válida.");
  }

  const { error } = await supabase.from("push_subscriptions").upsert({
    organization_id: organizationId,
    user_id: userId,
    endpoint: serialized.endpoint,
    p256dh: serialized.keys.p256dh,
    auth: serialized.keys.auth,
    user_agent: navigator.userAgent.slice(0, 1000),
    device_label: deviceLabel(),
    last_used_at: new Date().toISOString(),
  }, { onConflict: "endpoint" });
  if (error) throw error;
}

export async function enableDevicePush(userId, organizationId) {
  if (!userId || !organizationId) throw new Error("No hay una sesión activa.");
  const support = getPushSupport();
  if (!support.supported) throw new Error("Este navegador no admite notificaciones Web Push.");
  if (!support.configured) throw new Error("Web Push todavía no está configurado para este entorno.");

  const permission = await window.Notification.requestPermission();
  if (permission !== "granted") return { ...support, permission, active: false };

  const registration = await navigator.serviceWorker.register(SERVICE_WORKER_URL, {
    scope: "/",
    updateViaCache: "none",
  });
  await navigator.serviceWorker.ready;
  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(PUBLIC_VAPID_KEY),
    });
  }
  await persistSubscription(subscription, userId, organizationId);
  return { supported: true, configured: true, permission, active: true };
}

export async function disableDevicePush(userId, organizationId) {
  if (!userId || !organizationId) throw new Error("No hay una sesión activa.");
  const registration = await navigator.serviceWorker.getRegistration("/");
  const subscription = await registration?.pushManager.getSubscription();
  if (!subscription) return getDevicePushState();

  const { error } = await supabase.from("push_subscriptions").delete()
    .eq("user_id", userId)
    .eq("organization_id", organizationId)
    .eq("endpoint", subscription.endpoint);
  if (error) throw error;
  await subscription.unsubscribe();
  return { ...getPushSupport(), active: false };
}

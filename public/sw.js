const DEFAULT_URL = "/";

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

function safeActionUrl(value) {
  return typeof value === "string" && value.startsWith("/") && !value.startsWith("//")
    ? value
    : DEFAULT_URL;
}

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data?.json() || {};
  } catch {
    payload = { body: event.data?.text() || "Tienes una nueva notificación." };
  }

  const actionUrl = safeActionUrl(payload.actionUrl);
  event.waitUntil(self.registration.showNotification(payload.title || "ORVESEN", {
    body: payload.body || "Tienes una nueva notificación.",
    icon: "/orvesen-mark.png",
    badge: "/orvesen-mark.png",
    tag: payload.notificationId ? `orvesen-${payload.notificationId}` : undefined,
    data: {
      actionUrl,
      notificationId: payload.notificationId || null,
      type: payload.type || null,
    },
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const actionUrl = safeActionUrl(event.notification.data?.actionUrl);
  const destination = new URL(actionUrl, self.location.origin).href;

  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const existing = windows.find((client) => new URL(client.url).origin === self.location.origin);
    if (existing) {
      await existing.focus();
      if ("navigate" in existing) await existing.navigate(destination);
      return;
    }
    await self.clients.openWindow(destination);
  })());
});

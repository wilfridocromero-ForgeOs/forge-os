const CURRENT_VERSION = import.meta.env.VITE_APP_VERSION;
const RELOAD_TARGET_KEY = "orvesen-reload-target";
const CHECK_INTERVAL_MS = 5 * 60 * 1000;

let installed = false;
let checking = false;

async function checkForCurrentVersion() {
  if (checking || !CURRENT_VERSION) return;
  checking = true;
  try {
    const response = await fetch(`/version.json?v=${encodeURIComponent(CURRENT_VERSION)}`, {
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
    if (!response.ok) return;
    const remoteVersion = String((await response.json())?.version || "");
    if (!remoteVersion) return;
    if (remoteVersion === CURRENT_VERSION) {
      sessionStorage.removeItem(RELOAD_TARGET_KEY);
      return;
    }
    if (sessionStorage.getItem(RELOAD_TARGET_KEY) === remoteVersion) return;
    sessionStorage.setItem(RELOAD_TARGET_KEY, remoteVersion);
    const nextUrl = new URL(window.location.href);
    nextUrl.searchParams.set("_appv", remoteVersion.slice(0, 12));
    window.location.replace(nextUrl.toString());
  } catch {
    // A temporary network failure must never interrupt the active application.
  } finally {
    checking = false;
  }
}

export function installVersionGuard() {
  if (!import.meta.env.PROD || installed) return;
  installed = true;
  window.addEventListener("focus", checkForCurrentVersion);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") checkForCurrentVersion();
  });
  window.setInterval(checkForCurrentVersion, CHECK_INTERVAL_MS);
  window.setTimeout(checkForCurrentVersion, 3000);
}

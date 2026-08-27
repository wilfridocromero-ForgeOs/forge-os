import "./versionGuard.css";
import { hasUnsavedWork } from "./dirtyState";
import {
  ASSET_RECOVERY_ATTEMPT_KEY,
  createVersionUpdateController,
  normalizeBuild,
  UPDATE_ATTEMPT_KEY,
} from "./versionUpdateCore";

const CURRENT_BUILD = normalizeBuild({
  version: import.meta.env.VITE_APP_VERSION,
  built_at: import.meta.env.VITE_APP_BUILD_TIME,
});
const UPDATE_BANNER_ID = "orvesen-version-update";
const CHECK_INTERVAL_MS = 5 * 60 * 1000;
const CHANNEL_NAME = "orvesen-version-updates";

let installed = false;
let checking = false;
let controller = null;

function storageRead(key) {
  try {
    return JSON.parse(sessionStorage.getItem(key) || "null");
  } catch {
    storageRemove(key);
    return null;
  }
}

function storageWrite(key, value) {
  try {
    sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    // A cache-busted navigation still works in restrictive browsing modes.
  }
}

function storageRemove(key) {
  try {
    sessionStorage.removeItem(key);
  } catch {
    // Storage can be unavailable.
  }
}

function currentRelativeUrl() {
  return `${window.location.pathname}${window.location.search}${window.location.hash}`;
}

function replaceRoute(returnTo) {
  const current = currentRelativeUrl();
  const clean = new URL(returnTo, window.location.origin);
  clean.searchParams.delete("_appv");
  clean.searchParams.delete("_appbt");
  clean.searchParams.delete("_asset_recovery");
  const next = `${clean.pathname}${clean.search}${clean.hash}`;
  if (next !== current) window.history.replaceState(window.history.state, "", next);
}

function completeAssetRecoveryBootstrap() {
  const attempt = storageRead(ASSET_RECOVERY_ATTEMPT_KEY);
  storageRemove(ASSET_RECOVERY_ATTEMPT_KEY);
  if (!attempt || Date.now() - Number(attempt.attemptedAt || 0) > 5 * 60 * 1000) return false;
  replaceRoute(attempt.returnTo || "/");
  return true;
}

function removeUpdateBanner() {
  document.getElementById(UPDATE_BANNER_ID)?.remove();
}

function renderUpdateState(state) {
  if (!document.body || state.status === "current") {
    removeUpdateBanner();
    return;
  }
  let banner = document.getElementById(UPDATE_BANNER_ID);
  if (!banner) {
    banner = document.createElement("aside");
    banner.id = UPDATE_BANNER_ID;
    banner.className = "orvesen-version-update";
    banner.setAttribute("role", "status");
    banner.setAttribute("aria-live", "polite");
    const copy = document.createElement("div");
    copy.className = "orvesen-version-update__copy";
    const title = document.createElement("strong");
    title.className = "orvesen-version-update__title";
    const description = document.createElement("span");
    description.className = "orvesen-version-update__description";
    copy.append(title, description);
    const action = document.createElement("button");
    action.className = "orvesen-version-update__action";
    action.type = "button";
    banner.append(copy, action);
    document.body.appendChild(banner);
  }
  const title = banner.querySelector(".orvesen-version-update__title");
  const description = banner.querySelector(".orvesen-version-update__description");
  const action = banner.querySelector(".orvesen-version-update__action");
  banner.dataset.state = state.status;
  banner.dataset.targetVersion = state.target?.version || "";

  if (state.status === "activating") {
    title.textContent = "Activando la nueva versión";
    description.textContent = "ORVESEN conservará esta ruta y se recargará una sola vez.";
    action.textContent = "Actualizando…";
    action.disabled = true;
    return;
  }
  if (state.status === "error") {
    title.textContent = "No pudimos completar la actualización";
    description.textContent = "Puedes seguir trabajando y volver a intentarlo más tarde.";
    action.textContent = "Actualización pendiente";
    action.disabled = true;
    return;
  }
  title.textContent = "Hay una nueva versión de ORVESEN";
  description.textContent = "Guarda tu trabajo antes de actualizar.";
  action.textContent = "Actualizar ahora";
  action.disabled = false;
  action.onclick = () => controller?.acceptUpdate({ hasUnsavedWork: hasUnsavedWork() });
}

async function fetchCurrentBuild() {
  const response = await fetch(`/version.json?current=${encodeURIComponent(CURRENT_BUILD.version)}`, {
    cache: "no-store",
    headers: { Accept: "application/json" },
  });
  return response.ok ? response.json() : null;
}

export function installVersionGuard() {
  if (!import.meta.env.PROD || installed || !CURRENT_BUILD) return () => {};
  installed = true;
  completeAssetRecoveryBootstrap();

  controller = createVersionUpdateController({
    currentBuild: CURRENT_BUILD,
    origin: window.location.origin,
    getCurrentUrl: currentRelativeUrl,
    readAttempt: () => storageRead(UPDATE_ATTEMPT_KEY),
    writeAttempt: (value) => storageWrite(UPDATE_ATTEMPT_KEY, value),
    clearAttempt: () => storageRemove(UPDATE_ATTEMPT_KEY),
    navigate: (url) => window.location.replace(url),
    replaceRoute,
    confirmUpdate: () => window.confirm("Hay trabajo sin guardar. Si actualizas ahora, esos cambios locales se perderán. ¿Continuar?"),
    onState: renderUpdateState,
  });
  controller.completeBootstrap();
  Object.defineProperty(window, "__ORVESEN_BUILD__", {
    configurable: true,
    value: Object.freeze({ ...CURRENT_BUILD }),
  });

  const channel = "BroadcastChannel" in window ? new BroadcastChannel(CHANNEL_NAME) : null;
  const observe = (build, broadcast = true) => {
    const decision = controller.observeRemote(build);
    if (broadcast && decision.status === "update_available") {
      channel?.postMessage({ type: "build", build: decision.build });
    }
  };
  channel?.addEventListener("message", (event) => {
    if (event.data?.type === "build") observe(event.data.build, false);
  });
  channel?.postMessage({ type: "build", build: CURRENT_BUILD });

  const checkForCurrentVersion = async () => {
    if (checking) return;
    checking = true;
    try {
      const remoteBuild = await fetchCurrentBuild();
      if (remoteBuild) observe(remoteBuild);
    } catch {
      // A temporary network failure must not interrupt the active application.
    } finally {
      checking = false;
    }
  };
  const checkWhenVisible = () => {
    if (document.visibilityState === "visible") void checkForCurrentVersion();
  };
  const initialCheck = window.setTimeout(checkForCurrentVersion, 3000);
  const interval = window.setInterval(checkForCurrentVersion, CHECK_INTERVAL_MS);
  window.addEventListener("focus", checkForCurrentVersion);
  window.addEventListener("online", checkForCurrentVersion);
  window.addEventListener("pageshow", checkForCurrentVersion);
  document.addEventListener("visibilitychange", checkWhenVisible);

  return () => {
    window.clearTimeout(initialCheck);
    window.clearInterval(interval);
    window.removeEventListener("focus", checkForCurrentVersion);
    window.removeEventListener("online", checkForCurrentVersion);
    window.removeEventListener("pageshow", checkForCurrentVersion);
    document.removeEventListener("visibilitychange", checkWhenVisible);
    channel?.close();
    removeUpdateBanner();
    delete window.__ORVESEN_BUILD__;
    controller = null;
    installed = false;
  };
}

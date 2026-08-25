import "./versionGuard.css";

const CURRENT_VERSION = import.meta.env.VITE_APP_VERSION;
const UPDATE_ATTEMPT_KEY = "orvesen-version-update-attempt";
const UPDATE_BANNER_ID = "orvesen-version-update";
const CHECK_INTERVAL_MS = 5 * 60 * 1000;

let installed = false;
let checking = false;

function removeUpdateBanner() {
  document.getElementById(UPDATE_BANNER_ID)?.remove();
}

function readUpdateAttempt() {
  try {
    return JSON.parse(sessionStorage.getItem(UPDATE_ATTEMPT_KEY) || "null");
  } catch {
    removeUpdateAttempt();
    return null;
  }
}

function writeUpdateAttempt(attempt) {
  try {
    sessionStorage.setItem(UPDATE_ATTEMPT_KEY, JSON.stringify(attempt));
  } catch {
    // The cache-busted navigation still works when session storage is unavailable.
  }
}

function removeUpdateAttempt() {
  try {
    sessionStorage.removeItem(UPDATE_ATTEMPT_KEY);
  } catch {
    // Storage can be unavailable in restrictive browsing modes.
  }
}

function currentRelativeUrl() {
  const currentUrl = new URL(window.location.href);
  currentUrl.searchParams.delete("_appv");
  return `${currentUrl.pathname}${currentUrl.search}${currentUrl.hash}`;
}

function safeReturnUrl(value) {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) return "/";
  const target = new URL(value, window.location.origin);
  return target.origin === window.location.origin
    ? `${target.pathname}${target.search}${target.hash}`
    : "/";
}

function clearCompletedUpdate(attempt = readUpdateAttempt(), notifyRouter = false) {
  removeUpdateAttempt();
  removeUpdateBanner();

  const currentUrl = new URL(window.location.href);
  const returnTo = attempt?.target === CURRENT_VERSION
    ? safeReturnUrl(attempt.returnTo)
    : `${currentUrl.pathname}${currentUrl.search}${currentUrl.hash}`;
  const cleanUrl = new URL(returnTo, window.location.origin);
  cleanUrl.searchParams.delete("_appv");

  if (`${cleanUrl.pathname}${cleanUrl.search}${cleanUrl.hash}` === `${currentUrl.pathname}${currentUrl.search}${currentUrl.hash}`) return;
  window.history.replaceState(
    window.history.state,
    "",
    `${cleanUrl.pathname}${cleanUrl.search}${cleanUrl.hash}`,
  );
  if (notifyRouter) window.dispatchEvent(new PopStateEvent("popstate"));
}

export function completeVersionUpdateBootstrap() {
  const updateAttempt = readUpdateAttempt();
  if (updateAttempt?.target !== CURRENT_VERSION) return false;

  clearCompletedUpdate(updateAttempt, true);
  return true;
}

function requestVersionUpdate(remoteVersion) {
  const previousAttempt = readUpdateAttempt();
  const returnTo = previousAttempt?.target === remoteVersion
    ? safeReturnUrl(previousAttempt.returnTo)
    : currentRelativeUrl();
  const nextUrl = new URL("/", window.location.origin);
  nextUrl.searchParams.set("_appv", remoteVersion);
  writeUpdateAttempt({
    from: CURRENT_VERSION,
    target: remoteVersion,
    returnTo,
    attemptedAt: Date.now(),
  });
  window.location.replace(nextUrl.toString());
}

function showUpdateBanner(remoteVersion) {
  if (!document.body) return;

  const previousAttempt = readUpdateAttempt();
  const retryingSameVersion =
    previousAttempt?.from === CURRENT_VERSION && previousAttempt?.target === remoteVersion;

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
    copy.appendChild(title);

    const description = document.createElement("span");
    description.className = "orvesen-version-update__description";
    copy.appendChild(description);

    const action = document.createElement("button");
    action.className = "orvesen-version-update__action";
    action.type = "button";
    action.textContent = "Actualizar ahora";

    banner.append(copy, action);
    document.body.appendChild(banner);
  }

  banner.dataset.targetVersion = remoteVersion;
  const title = banner.querySelector(".orvesen-version-update__title");
  const description = banner.querySelector(".orvesen-version-update__description");
  const action = banner.querySelector(".orvesen-version-update__action");

  title.textContent = retryingSameVersion
    ? "La actualización no terminó"
    : "Hay una nueva versión de ORVESEN";
  description.textContent = retryingSameVersion
    ? "Guarda tu trabajo y vuelve a intentarlo."
    : "Guarda tu trabajo antes de actualizar.";
  action.disabled = false;
  action.textContent = retryingSameVersion ? "Reintentar actualización" : "Actualizar ahora";
  action.onclick = () => {
    action.disabled = true;
    action.textContent = "Actualizando…";
    requestVersionUpdate(remoteVersion);
  };
}

async function checkForCurrentVersion() {
  if (checking || !CURRENT_VERSION) return;
  checking = true;
  try {
    const response = await fetch(`/version.json?v=${encodeURIComponent(CURRENT_VERSION)}`, {
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
    if (!response.ok) return;
    const remoteVersion = String((await response.json())?.version || "").trim();
    if (!remoteVersion) return;

    if (remoteVersion === CURRENT_VERSION) {
      if (readUpdateAttempt()?.target === CURRENT_VERSION) {
        removeUpdateBanner();
        return;
      }
      clearCompletedUpdate();
      return;
    }

    showUpdateBanner(remoteVersion);
  } catch {
    // A temporary network failure must never interrupt the active application.
  } finally {
    checking = false;
  }
}

export function installVersionGuard() {
  if (!import.meta.env.PROD || installed) return () => {};
  installed = true;

  const updateAttempt = readUpdateAttempt();
  if (updateAttempt?.target === CURRENT_VERSION) removeUpdateBanner();

  const checkWhenVisible = () => {
    if (document.visibilityState === "visible") checkForCurrentVersion();
  };
  const checkAfterPageShow = () => checkForCurrentVersion();
  const initialCheck = window.setTimeout(checkForCurrentVersion, 3000);
  const interval = window.setInterval(checkForCurrentVersion, CHECK_INTERVAL_MS);

  window.addEventListener("focus", checkForCurrentVersion);
  window.addEventListener("online", checkForCurrentVersion);
  window.addEventListener("pageshow", checkAfterPageShow);
  document.addEventListener("visibilitychange", checkWhenVisible);

  return () => {
    window.clearTimeout(initialCheck);
    window.clearInterval(interval);
    window.removeEventListener("focus", checkForCurrentVersion);
    window.removeEventListener("online", checkForCurrentVersion);
    window.removeEventListener("pageshow", checkAfterPageShow);
    document.removeEventListener("visibilitychange", checkWhenVisible);
    removeUpdateBanner();
    installed = false;
  };
}

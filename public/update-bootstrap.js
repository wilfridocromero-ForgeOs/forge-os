(function installOrvesenAssetRecovery() {
  const ATTEMPT_KEY = "orvesen-asset-recovery-attempt";
  const MAX_AGE_MS = 5 * 60 * 1000;
  let recoveryRequested = false;

  function currentRelativeUrl() {
    return `${window.location.pathname}${window.location.search}${window.location.hash}`;
  }

  function readAttempt() {
    try {
      return JSON.parse(window.sessionStorage.getItem(ATTEMPT_KEY) || "null");
    } catch {
      return null;
    }
  }

  function recoverOnce(event) {
    if (recoveryRequested) return false;
    const previous = readAttempt();
    if (previous && Date.now() - Number(previous.attemptedAt || 0) < MAX_AGE_MS) return false;

    recoveryRequested = true;
    event?.preventDefault?.();
    try {
      window.sessionStorage.setItem(ATTEMPT_KEY, JSON.stringify({
        returnTo: currentRelativeUrl(),
        attemptedAt: Date.now(),
      }));
    } catch {
      // The cache-busted navigation still works without storage.
    }
    const next = new URL("/", window.location.origin);
    next.searchParams.set("_asset_recovery", String(Date.now()));
    window.location.replace(next.toString());
    return true;
  }

  window.addEventListener("vite:preloadError", recoverOnce);
  window.addEventListener("error", (event) => {
    const target = event.target;
    const failedAsset = target && (target.tagName === "SCRIPT" || target.tagName === "LINK")
      ? String(target.src || target.href || "")
      : "";
    if (failedAsset.includes("/assets/")) recoverOnce(event);
  }, true);

  window.__ORVESEN_ASSET_RECOVERY__ = Object.freeze({ recoverOnce });
})();

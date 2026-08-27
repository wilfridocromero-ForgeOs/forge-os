export const UPDATE_ATTEMPT_KEY = "orvesen-version-update-attempt";
export const ASSET_RECOVERY_ATTEMPT_KEY = "orvesen-asset-recovery-attempt";
export const ATTEMPT_MAX_AGE_MS = 15 * 60 * 1000;
export const MAX_UPDATE_ATTEMPTS = 2;

export function normalizeBuild(value) {
  if (!value || typeof value !== "object") return null;
  const version = typeof value.version === "string" ? value.version.trim() : "";
  const builtAt = Number(value.built_at ?? value.builtAt);
  if (!version || version.length > 160 || !Number.isSafeInteger(builtAt) || builtAt <= 0) return null;
  return { version, builtAt };
}

export function classifyBuild(currentBuild, remoteValue) {
  const remoteBuild = normalizeBuild(remoteValue);
  if (!remoteBuild) return { status: "invalid", build: null };
  if (remoteBuild.version === currentBuild.version) return { status: "current", build: remoteBuild };
  if (remoteBuild.builtAt <= currentBuild.builtAt) return { status: "stale", build: remoteBuild };
  return { status: "update_available", build: remoteBuild };
}

export function safeRelativeUrl(value, origin) {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) return "/";
  const target = new URL(value, origin);
  return target.origin === origin ? `${target.pathname}${target.search}${target.hash}` : "/";
}

export function normalizeAttempt(value, now = Date.now()) {
  if (!value || typeof value !== "object") return null;
  const attemptedAt = Number(value.attemptedAt);
  const attempts = Number(value.attempts);
  if (!Number.isFinite(attemptedAt) || now - attemptedAt > ATTEMPT_MAX_AGE_MS || now < attemptedAt) return null;
  if (!Number.isInteger(attempts) || attempts < 1 || attempts > MAX_UPDATE_ATTEMPTS) return null;
  const target = normalizeBuild({ version: value.target, built_at: value.targetBuiltAt });
  return target ? { ...value, target: target.version, targetBuiltAt: target.builtAt, attempts } : null;
}

export function buildUpdateUrl(origin, build) {
  const target = new URL("/", origin);
  target.searchParams.set("_appv", build.version);
  target.searchParams.set("_appbt", String(build.builtAt));
  return target.toString();
}

export function createVersionUpdateController({
  currentBuild,
  origin,
  getCurrentUrl,
  readAttempt,
  writeAttempt,
  clearAttempt,
  navigate,
  replaceRoute,
  confirmUpdate = () => true,
  now = () => Date.now(),
  onState = () => {},
}) {
  let state = { status: "current", target: null, error: null };
  let navigationRequested = false;

  const publish = (next) => {
    state = next;
    onState(state);
    return state;
  };

  function completeBootstrap() {
    const attempt = normalizeAttempt(readAttempt(), now());
    if (!attempt) {
      clearAttempt();
      return false;
    }
    if (attempt.target !== currentBuild.version) return false;
    clearAttempt();
    replaceRoute(safeRelativeUrl(attempt.returnTo, origin));
    publish({ status: "current", target: null, error: null });
    return true;
  }

  function observeRemote(remoteValue) {
    const decision = classifyBuild(currentBuild, remoteValue);
    if (decision.status === "update_available") {
      publish({ status: "update_available", target: decision.build, error: null });
    } else if (decision.status === "current" || decision.status === "stale") {
      clearAttempt();
      publish({ status: "current", target: null, error: null });
    }
    return decision;
  }

  function acceptUpdate({ hasUnsavedWork = false } = {}) {
    if (state.status !== "update_available" || !state.target || navigationRequested) return false;
    if (hasUnsavedWork && !confirmUpdate()) return false;
    const previous = normalizeAttempt(readAttempt(), now());
    const attempts = previous?.target === state.target.version ? previous.attempts : 0;
    if (attempts >= MAX_UPDATE_ATTEMPTS) {
      publish({ status: "error", target: state.target, error: "ATTEMPTS_EXHAUSTED" });
      return false;
    }
    navigationRequested = true;
    writeAttempt({
      from: currentBuild.version,
      target: state.target.version,
      targetBuiltAt: state.target.builtAt,
      returnTo: previous?.target === state.target.version
        ? safeRelativeUrl(previous.returnTo, origin)
        : safeRelativeUrl(getCurrentUrl(), origin),
      attempts: attempts + 1,
      attemptedAt: now(),
    });
    publish({ status: "activating", target: state.target, error: null });
    try {
      navigate(buildUpdateUrl(origin, state.target));
      return true;
    } catch {
      navigationRequested = false;
      publish({ status: "error", target: state.target, error: "NAVIGATION_FAILED" });
      return false;
    }
  }

  return { acceptUpdate, completeBootstrap, getState: () => state, observeRemote };
}

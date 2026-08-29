export const VERSION_DIAGNOSTIC_HISTORY_KEY = "orvesen-version-diagnostics-v1";
export const VERSION_DIAGNOSTIC_TAB_KEY = "orvesen-version-diagnostic-tab-v1";
export const VERSION_DIAGNOSTIC_MAX_ENTRIES = 40;

const SOURCES = new Set([
  "initial",
  "poll",
  "focus",
  "online",
  "pageshow",
  "visibility",
  "broadcast",
  "bootstrap",
]);
const STATES = new Set(["current", "update_available", "activating", "error", "unknown"]);
const CLASSIFICATIONS = new Set(["current", "update_available", "stale", "invalid", "ignored"]);

function boundedString(value, maxLength = 160) {
  return typeof value === "string" ? value.slice(0, maxLength) : null;
}

function sanitizeBuild(value) {
  if (!value || typeof value !== "object") return null;
  const version = boundedString(value.version);
  const builtAt = Number(value.builtAt ?? value.built_at);
  return version && Number.isSafeInteger(builtAt) && builtAt > 0 ? { version, builtAt } : null;
}

export function sanitizeVersionDiagnostic(value) {
  if (!value || typeof value !== "object") return null;
  const timestamp = Number(value.timestamp);
  const tabId = boundedString(value.tabId, 80);
  if (!Number.isSafeInteger(timestamp) || timestamp <= 0 || !tabId) return null;
  const headers = value.headers && typeof value.headers === "object" ? {
    etag: boundedString(value.headers.etag),
    age: boundedString(value.headers.age, 32),
    xVercelCache: boundedString(value.headers.xVercelCache, 64),
  } : null;
  return {
    timestamp,
    tabId,
    source: SOURCES.has(value.source) ? value.source : "unknown",
    current: sanitizeBuild(value.current),
    remote: sanitizeBuild(value.remote),
    stateBefore: STATES.has(value.stateBefore) ? value.stateBefore : "unknown",
    classification: CLASSIFICATIONS.has(value.classification) ? value.classification : "invalid",
    stateAfter: STATES.has(value.stateAfter) ? value.stateAfter : "unknown",
    reason: boundedString(value.reason) || "unspecified",
    requestId: Number.isSafeInteger(value.requestId) && value.requestId > 0 ? value.requestId : null,
    visibility: value.visibility === "visible" || value.visibility === "hidden" ? value.visibility : "unknown",
    pageshowPersisted: typeof value.pageshowPersisted === "boolean" ? value.pageshowPersisted : null,
    headers,
    bannerEvent: value.bannerEvent === "shown" || value.bannerEvent === "hidden" ? value.bannerEvent : null,
  };
}

export function createVersionDiagnosticHistory({
  storage,
  tabId,
  maxEntries = VERSION_DIAGNOSTIC_MAX_ENTRIES,
  now = () => Date.now(),
} = {}) {
  const limit = Math.max(1, Math.min(100, Number(maxEntries) || VERSION_DIAGNOSTIC_MAX_ENTRIES));
  const read = () => {
    try {
      const parsed = JSON.parse(storage?.getItem(VERSION_DIAGNOSTIC_HISTORY_KEY) || "[]");
      if (!Array.isArray(parsed)) return [];
      return parsed.map(sanitizeVersionDiagnostic).filter(Boolean).slice(-limit);
    } catch {
      return [];
    }
  };
  let entries = read();
  const persist = () => {
    try {
      storage?.setItem(VERSION_DIAGNOSTIC_HISTORY_KEY, JSON.stringify(entries));
    } catch {
      // Diagnostics must never affect application availability.
    }
  };
  return Object.freeze({
    push(value) {
      const entry = sanitizeVersionDiagnostic({ ...value, timestamp: now(), tabId });
      if (!entry) return null;
      entries = [...entries, entry].slice(-limit);
      persist();
      return entry;
    },
    history: () => JSON.parse(JSON.stringify(entries)),
    clear() {
      entries = [];
      try {
        storage?.removeItem(VERSION_DIAGNOSTIC_HISTORY_KEY);
      } catch {
        // Diagnostics must never affect application availability.
      }
    },
  });
}

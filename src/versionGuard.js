import "./versionGuard.css";
import { hasUnsavedWork } from "./dirtyState";
import {
  ASSET_RECOVERY_ATTEMPT_KEY,
  createLatestRequestObserver,
  createVersionUpdateController,
  normalizeBuild,
  UPDATE_ATTEMPT_KEY,
} from "./versionUpdateCore";
import {
  createVersionDiagnosticHistory,
  VERSION_DIAGNOSTIC_TAB_KEY,
} from "./versionDiagnostics";

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
let lastDiagnostic = null;
let diagnosticHistory = null;

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
    // Puede no estar disponible en algunos modos del navegador.
  }
}

function storageRemove(key) {
  try {
    sessionStorage.removeItem(key);
  } catch {
    // Puede no estar disponible.
  }
}

function getDiagnosticTabId() {
  const existing = storageRead(VERSION_DIAGNOSTIC_TAB_KEY);

  if (typeof existing === "string" && existing.length <= 80) {
    return existing;
  }

  const generated =
    globalThis.crypto?.randomUUID?.() ||
    `tab-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

  storageWrite(VERSION_DIAGNOSTIC_TAB_KEY, generated);

  return generated;
}

function getDiagnosticStorage() {
  try {
    return window.localStorage;
  } catch {
    return null;
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
  clean.searchParams.delete("_refresh");
  clean.searchParams.delete("_check");

  const next = `${clean.pathname}${clean.search}${clean.hash}`;

  if (next !== current) {
    window.history.replaceState(window.history.state, "", next);
  }
}

function completeAssetRecoveryBootstrap() {
  const attempt = storageRead(ASSET_RECOVERY_ATTEMPT_KEY);

  storageRemove(ASSET_RECOVERY_ATTEMPT_KEY);

  if (
    !attempt ||
    Date.now() - Number(attempt.attemptedAt || 0) > 5 * 60 * 1000
  ) {
    return false;
  }

  replaceRoute(attempt.returnTo || "/");

  return true;
}

function removeUpdateBanner() {
  document.getElementById(UPDATE_BANNER_ID)?.remove();
}

function renderUpdateState(state) {
  /*
   * Esta parte es importante para el bug:
   * si una comprobación posterior confirma que estamos CURRENT,
   * el aviso desaparece inmediatamente.
   */
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

  const title = banner.querySelector(
    ".orvesen-version-update__title",
  );

  const description = banner.querySelector(
    ".orvesen-version-update__description",
  );

  const action = banner.querySelector(
    ".orvesen-version-update__action",
  );

  banner.dataset.state = state.status;
  banner.dataset.targetVersion = state.target?.version || "";

  if (state.status === "activating") {
    title.textContent = "Activando la nueva versión";

    description.textContent =
      "ORVESEN conservará esta ruta y se recargará una sola vez.";

    action.textContent = "Actualizando…";
    action.disabled = true;

    return;
  }

  if (state.status === "error") {
    title.textContent =
      "No pudimos completar la actualización";

    description.textContent =
      "Puedes seguir trabajando y volver a intentarlo más tarde.";

    action.textContent = "Actualización pendiente";
    action.disabled = true;

    return;
  }

  title.textContent =
    "Hay una nueva versión de ORVESEN";

  description.textContent =
    "Guarda tu trabajo antes de actualizar.";

  action.textContent = "Actualizar ahora";
  action.disabled = false;

  action.onclick = () =>
    controller?.acceptUpdate({
      hasUnsavedWork: hasUnsavedWork(),
    });
}

function recordDecision(
  decision,
  context = {},
  previous = { status: "unknown" },
) {
  const stateAfter =
    controller?.getState?.() || previous;

  const bannerEvent =
    previous.status !== "update_available" &&
    stateAfter.status === "update_available"
      ? "shown"
      : previous.status === "update_available" &&
          stateAfter.status === "current"
        ? "hidden"
        : null;

  lastDiagnostic = Object.freeze({
    current: Object.freeze({
      ...CURRENT_BUILD,
    }),

    remote: decision.build
      ? Object.freeze({
          ...decision.build,
        })
      : null,

    decision: decision.status,
    source: context.source || "unknown",
    reason: decision.reason || "unspecified",
  });

  diagnosticHistory?.push({
    source: context.source,
    current: CURRENT_BUILD,
    remote: decision.build,
    stateBefore: previous.status,
    classification: decision.status,
    stateAfter: stateAfter.status,
    reason: decision.reason,
    requestId: context.request,
    visibility: document.visibilityState,
    pageshowPersisted: context.pageshowPersisted,
    headers: context.headers,
    bannerEvent,
  });
}

async function fetchCurrentBuild() {
  /*
   * Cada consulta lleva un identificador único.
   *
   * Esto evita depender de una URL idéntica que un navegador,
   * proxy o CDN pudiera reutilizar.
   */
  const response = await fetch(
    `/version.json?current=${encodeURIComponent(
      CURRENT_BUILD.version,
    )}&_check=${Date.now()}`,
    {
      cache: "no-store",

      headers: {
        Accept: "application/json",
        "Cache-Control": "no-cache",
      },
    },
  );

  const headers = {
    etag: response.headers.get("etag"),
    age: response.headers.get("age"),
    xVercelCache:
      response.headers.get("x-vercel-cache"),
  };

  return {
    build: response.ok
      ? await response.json()
      : null,

    headers,
  };
}

export function installVersionGuard() {
  if (
    !import.meta.env.PROD ||
    installed ||
    !CURRENT_BUILD
  ) {
    return () => {};
  }

  installed = true;

  completeAssetRecoveryBootstrap();

  diagnosticHistory =
    createVersionDiagnosticHistory({
      storage: getDiagnosticStorage(),
      tabId: getDiagnosticTabId(),
    });

  controller =
    createVersionUpdateController({
      currentBuild: CURRENT_BUILD,

      origin: window.location.origin,

      getCurrentUrl: currentRelativeUrl,

      readAttempt: () =>
        storageRead(UPDATE_ATTEMPT_KEY),

      writeAttempt: (value) =>
        storageWrite(
          UPDATE_ATTEMPT_KEY,
          value,
        ),

      clearAttempt: () =>
        storageRemove(UPDATE_ATTEMPT_KEY),

      navigate: (url) =>
        window.location.replace(url),

      replaceRoute,

      confirmUpdate: () =>
        window.confirm(
          "Hay trabajo sin guardar. Si actualizas ahora, esos cambios locales se perderán. ¿Continuar?",
        ),

      onState: renderUpdateState,

      onDecision: recordDecision,
    });

  controller.completeBootstrap();

  Object.defineProperty(
    window,
    "__ORVESEN_BUILD__",
    {
      configurable: true,

      value: Object.freeze({
        ...CURRENT_BUILD,
      }),
    },
  );

  Object.defineProperty(
    window,
    "__ORVESEN_VERSION_DEBUG__",
    {
      configurable: true,

      value: Object.freeze({
        current: Object.freeze({
          ...CURRENT_BUILD,
        }),

        snapshot: () =>
          lastDiagnostic,

        history: () =>
          diagnosticHistory?.history() || [],

        clearHistory: () =>
          diagnosticHistory?.clear(),
      }),
    },
  );

  const channel =
    "BroadcastChannel" in window
      ? new BroadcastChannel(CHANNEL_NAME)
      : null;

  const observe = (
    build,
    {
      broadcast = true,
      ...context
    } = {},
  ) => {
    const decision =
      controller.observeRemote(
        build,
        context,
      );

    if (
      broadcast &&
      decision.status ===
        "update_available"
    ) {
      channel?.postMessage({
        type: "build",
        build: decision.build,
      });
    }
  };

  channel?.addEventListener(
    "message",
    (event) => {
      if (event.data?.type === "build") {
        observe(event.data.build, {
          broadcast: false,
          source: "broadcast",
        });
      }
    },
  );

  channel?.postMessage({
    type: "build",
    build: CURRENT_BUILD,
  });

  const requestObserver =
    createLatestRequestObserver(
      (build, context) =>
        observe(build, {
          ...context,
          broadcast: true,
        }),

      recordDecision,
    );

  const checkForCurrentVersion =
    async (
      source = "poll",
      eventContext = {},
    ) => {
      if (checking) return;

      checking = true;

      const completeRequest =
        requestObserver.begin(
          source,
          eventContext,
        );

      try {
        const remote =
          await fetchCurrentBuild();

        completeRequest(
          remote.build,
          {
            headers: remote.headers,
          },
        );
      } catch {
        /*
         * Un fallo temporal de red NO debe
         * interrumpir ORVESEN ni mostrar
         * una actualización falsa.
         */
      } finally {
        checking = false;
      }
    };

  const checkWhenVisible = () => {
    if (
      document.visibilityState ===
      "visible"
    ) {
      void checkForCurrentVersion(
        "visibility",
      );
    }
  };

  const initialCheck =
    window.setTimeout(
      () =>
        checkForCurrentVersion(
          "initial",
        ),
      3000,
    );

  const interval =
    window.setInterval(
      () =>
        checkForCurrentVersion(
          "poll",
        ),
      CHECK_INTERVAL_MS,
    );

  const checkOnFocus = () =>
    checkForCurrentVersion("focus");

  const checkWhenOnline = () =>
    checkForCurrentVersion("online");

  const checkOnPageShow = (event) =>
    checkForCurrentVersion(
      "pageshow",
      {
        pageshowPersisted:
          Boolean(event.persisted),
      },
    );

  window.addEventListener(
    "focus",
    checkOnFocus,
  );

  window.addEventListener(
    "online",
    checkWhenOnline,
  );

  window.addEventListener(
    "pageshow",
    checkOnPageShow,
  );

  document.addEventListener(
    "visibilitychange",
    checkWhenVisible,
  );

  return () => {
    window.clearTimeout(initialCheck);
    window.clearInterval(interval);

    window.removeEventListener(
      "focus",
      checkOnFocus,
    );

    window.removeEventListener(
      "online",
      checkWhenOnline,
    );

    window.removeEventListener(
      "pageshow",
      checkOnPageShow,
    );

    document.removeEventListener(
      "visibilitychange",
      checkWhenVisible,
    );

    channel?.close();

    removeUpdateBanner();

    delete window.__ORVESEN_BUILD__;
    delete window.__ORVESEN_VERSION_DEBUG__;

    controller = null;
    lastDiagnostic = null;
    diagnosticHistory = null;
    installed = false;
  };
}
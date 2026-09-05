export const UPDATE_ATTEMPT_KEY = "orvesen-version-update-attempt";
export const ASSET_RECOVERY_ATTEMPT_KEY = "orvesen-asset-recovery-attempt";

const ATTEMPT_TTL_MS = 5 * 60 * 1000;

export function normalizeBuild(value) {
  if (!value || typeof value !== "object") return null;

  const version = String(value.version || "").trim();
  const builtAt = Number(value.built_at);

  if (!version) return null;

  return {
    version,
    built_at: Number.isFinite(builtAt) ? builtAt : 0,
  };
}

export function classifyBuild(currentBuild, remoteBuild) {
  const current = normalizeBuild(currentBuild);
  const remote = normalizeBuild(remoteBuild);

  if (!current || !remote) {
    return {
      status: "unknown",
      build: remote,
      reason: "invalid_build",
    };
  }

  /*
   * El SHA/version es la identidad principal del build.
   *
   * Si ambos tienen exactamente la misma versión, el navegador YA está
   * ejecutando el build correcto aunque built_at sea distinto.
   */
  if (remote.version === current.version) {
    return {
      status: "current",
      build: remote,
      reason: "same_version",
    };
  }

  /*
   * Si conocemos las fechas de build, evitamos interpretar una respuesta
   * vieja de CDN/cache como una actualización nueva.
   */
  if (
    current.built_at > 0 &&
    remote.built_at > 0 &&
    remote.built_at <= current.built_at
  ) {
    return {
      status: "current",
      build: remote,
      reason: "remote_not_newer",
    };
  }

  return {
    status: "update_available",
    build: remote,
    reason: "newer_version",
  };
}

function isFreshAttempt(attempt) {
  return Boolean(
    attempt &&
      Number(attempt.attemptedAt) > 0 &&
      Date.now() - Number(attempt.attemptedAt) < ATTEMPT_TTL_MS,
  );
}

function buildUpdateUrl(origin, currentUrl, targetBuild) {
  const target = normalizeBuild(targetBuild);
  const url = new URL(currentUrl || "/", origin);

  url.searchParams.delete("_appv");
  url.searchParams.delete("_appbt");
  url.searchParams.delete("_asset_recovery");
  url.searchParams.delete("_check");
  url.searchParams.delete("_refresh");

  if (target?.version) {
    url.searchParams.set("_appv", target.version);
  }

  if (target?.built_at) {
    url.searchParams.set("_appbt", String(target.built_at));
  }

  /*
   * Hace única la navegación cuando el usuario realmente pulsa actualizar.
   */
  url.searchParams.set("_refresh", String(Date.now()));

  return `${url.pathname}${url.search}${url.hash}`;
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
  confirmUpdate,
  onState,
  onDecision,
} = {}) {
  const current = normalizeBuild(currentBuild);

  let state = {
    status: "current",
    target: null,
  };

  function emit() {
    onState?.({
      status: state.status,
      target: state.target ? { ...state.target } : null,
    });
  }

  function setState(status, target = null) {
    state = {
      status,
      target: normalizeBuild(target),
    };

    emit();
    return getState();
  }

  function getState() {
    return {
      status: state.status,
      target: state.target ? { ...state.target } : null,
    };
  }

  function observeRemote(remoteBuild, context = {}) {
    const decision = classifyBuild(current, remoteBuild);

    /*
     * IMPORTANTE:
     * Una comprobación válida que confirme el build actual SIEMPRE debe
     * limpiar un aviso anterior de actualización.
     *
     * Antes el estado update_available podía quedarse pegado aunque una
     * consulta posterior confirmara que el navegador estaba actualizado.
     */
    if (decision.status === "current") {
      if (
        state.status === "update_available" ||
        state.status === "error" ||
        state.status === "current"
      ) {
        setState("current", null);
      }

      onDecision?.(decision, context);
      return decision;
    }

    if (decision.status === "update_available") {
      const target = normalizeBuild(decision.build);

      /*
       * No degradamos el target si ya habíamos detectado uno más reciente.
       */
      if (
        state.status === "update_available" &&
        state.target &&
        target &&
        state.target.built_at > 0 &&
        target.built_at > 0 &&
        target.built_at < state.target.built_at
      ) {
        const ignored = {
          status: "current",
          build: target,
          reason: "older_than_pending_target",
        };

        onDecision?.(ignored, context);
        return ignored;
      }

      setState("update_available", target);
      onDecision?.(decision, context);
      return decision;
    }

    onDecision?.(decision, context);
    return decision;
  }

  function completeBootstrap() {
    const attempt = readAttempt?.();

    if (!attempt) {
      emit();
      return getState();
    }

    if (!isFreshAttempt(attempt)) {
      clearAttempt?.();
      emit();
      return getState();
    }

    const target = normalizeBuild(attempt.target);

    /*
     * Si después de la navegación estamos ejecutando exactamente el build
     * solicitado, la actualización terminó correctamente.
     */
    if (target && current && target.version === current.version) {
      clearAttempt?.();

      if (attempt.returnTo) {
        replaceRoute?.(attempt.returnTo);
      }

      setState("current", null);
      return getState();
    }

    /*
     * También consideramos completada la actualización si el build cargado
     * terminó siendo todavía más nuevo que el target solicitado.
     */
    if (
      target &&
      current &&
      target.built_at > 0 &&
      current.built_at > target.built_at
    ) {
      clearAttempt?.();

      if (attempt.returnTo) {
        replaceRoute?.(attempt.returnTo);
      }

      setState("current", null);
      return getState();
    }

    clearAttempt?.();
    setState("current", null);
    return getState();
  }

  function acceptUpdate({ hasUnsavedWork = false } = {}) {
    if (state.status !== "update_available" || !state.target) {
      return false;
    }

    if (hasUnsavedWork && confirmUpdate && !confirmUpdate()) {
      return false;
    }

    const returnTo = getCurrentUrl?.() || "/";
    const target = normalizeBuild(state.target);

    writeAttempt?.({
      target,
      returnTo,
      attemptedAt: Date.now(),
    });

    setState("activating", target);

    const nextUrl = buildUpdateUrl(origin, returnTo, target);

    try {
      navigate?.(nextUrl);
      return true;
    } catch {
      clearAttempt?.();
      setState("error", target);
      return false;
    }
  }

  emit();

  return {
    getState,
    observeRemote,
    completeBootstrap,
    acceptUpdate,
  };
}

export function createLatestRequestObserver(observe, recordDecision) {
  let sequence = 0;
  let latestCompleted = 0;

  return {
    begin(source = "unknown", eventContext = {}) {
      const request = ++sequence;

      return (build, context = {}) => {
        if (request < latestCompleted) {
          recordDecision?.(
            {
              status: "unknown",
              build: normalizeBuild(build),
              reason: "stale_request",
            },
            {
              ...eventContext,
              ...context,
              source,
              request,
            },
          );

          return {
            status: "unknown",
            build: normalizeBuild(build),
            reason: "stale_request",
          };
        }

        latestCompleted = request;

        return observe?.(build, {
          ...eventContext,
          ...context,
          source,
          request,
        });
      };
    },
  };
}
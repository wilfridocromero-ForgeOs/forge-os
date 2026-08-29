import { lazy, Suspense, useEffect, useMemo, useReducer, useRef } from "react";
import { ArrowUpRight, LoaderCircle, X } from "lucide-react";
import { Link, useLocation } from "react-router-dom";

import { buildOrbDestination } from "./orbSurfaceContext";
import { getOrbGlobalSurface, orbGlobalReducer } from "./orbGlobalState";
import "./OrbGlobal.css";

const OrbPanelExperience = lazy(() =>
  import("../../app/Orb").then((module) => ({
    default: module.OrbExperience,
  }))
);

export default function OrbGlobal() {
  const location = useLocation();
  const surface = useMemo(
    () => getOrbGlobalSurface(location.pathname, location.search),
    [location.pathname, location.search],
  );
  const [state, dispatch] = useReducer(orbGlobalReducer, {
    open: false,
    mounted: false,
  });
  const launcherRef = useRef(null);
  const closeRef = useRef(null);
  const panelRef = useRef(null);

  useEffect(() => {
    if (!surface && state.open) dispatch({ type: "close" });
  }, [state.open, surface]);

  useEffect(() => {
    if (!state.open) return undefined;
    const previouslyFocused = document.activeElement;
    const mobile = window.matchMedia("(max-width: 767px)").matches;
    const previousOverflow = document.body.style.overflow;
    if (mobile) document.body.style.overflow = "hidden";
    const focusTimer = window.setTimeout(() => closeRef.current?.focus(), 0);
    const handleKeyDown = (event) => {
      if (event.key === "Escape") dispatch({ type: "close" });
      if (event.key !== "Tab") return;
      const focusable = panelRef.current?.querySelectorAll(
        'a[href],button:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])',
      );
      if (!focusable?.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener("keydown", handleKeyDown);
      if (mobile) document.body.style.overflow = previousOverflow;
      if (previouslyFocused instanceof HTMLElement) previouslyFocused.focus();
    };
  }, [state.open]);

  if (!surface) return null;

  return <>
    <button
      ref={launcherRef}
      type="button"
      className={`orb-global-launcher ${state.open ? "is-open" : ""}`}
      aria-label="Abrir Orb"
      aria-expanded={state.open}
      aria-controls="orb-global-panel"
      onClick={() => dispatch({ type: state.open ? "close" : "open" })}
    >
      <span className="orb-global-launcher-mark"><img src="/orvesen-mark.png" alt="" /></span>
      <span>Orb</span>
    </button>

    {state.mounted ? <div
      className={`orb-global-layer ${state.open ? "is-open" : ""}`}
      aria-hidden={!state.open}
      inert={!state.open}
    >
      <button
        type="button"
        className="orb-global-backdrop"
        aria-label="Cerrar Orb"
        onClick={() => dispatch({ type: "close" })}
      />
      <aside
        ref={panelRef}
        id="orb-global-panel"
        className="orb-global-panel"
        aria-label="Orb contextual"
        aria-modal="true"
        role="dialog"
      >
        <header className="orb-global-header">
          <div>
            <span className="orb-global-kicker">ORVESEN IA</span>
            <strong>Orb</strong>
          </div>
          <div className="orb-global-header-actions">
            <Link
              to={buildOrbDestination(location.pathname, location.search)}
              onClick={() => dispatch({ type: "close" })}
              aria-label="Abrir Orb en página completa"
            >
              <ArrowUpRight size={18} />
            </Link>
            <button
              ref={closeRef}
              type="button"
              onClick={() => dispatch({ type: "close" })}
              aria-label="Cerrar Orb"
            >
              <X size={20} />
            </button>
          </div>
        </header>
        <div className="orb-global-content">
          <Suspense fallback={<div className="orb-global-loading"><LoaderCircle size={20} /> Cargando Orb</div>}>
            <OrbPanelExperience mode="panel" surfaceOverride={surface} />
          </Suspense>
        </div>
      </aside>
    </div> : null}
  </>;
}

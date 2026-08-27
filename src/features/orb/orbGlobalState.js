import { deriveOrbSurfaceContext } from "./orbSurfaceContext.js";

export function getOrbGlobalSurface(pathname) {
  const surface = deriveOrbSurfaceContext(pathname);
  return surface?.type === "orvesen_ai" ? null : surface;
}

export function orbGlobalReducer(state, action) {
  if (action.type === "open") return { ...state, open: true, mounted: true };
  if (action.type === "close") return { ...state, open: false };
  return state;
}

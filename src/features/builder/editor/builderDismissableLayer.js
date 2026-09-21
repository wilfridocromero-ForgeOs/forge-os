export const BUILDER_CONTEXT_LAYER = "landing-context-toolbar";
export const BUILDER_INSPECTOR_LAYER = "landing-inspector";

function eventPath(event) {
  if (typeof event?.composedPath === "function") return event.composedPath();
  const path = [];
  let current = event?.target;
  while (current) {
    path.push(current);
    current = current.parentNode;
  }
  return path;
}

export function isEventInsideBuilderLayer(event, layerId) {
  return eventPath(event).some((node) =>
    node?.dataset?.builderDismissLayer === layerId ||
    node?.getAttribute?.("data-builder-dismiss-layer") === layerId
  );
}

export function registerBuilderDismissableLayer({ target, layerId, onDismiss }) {
  if (!target?.addEventListener || !target?.removeEventListener || !layerId || typeof onDismiss !== "function") return () => {};
  const pointerDown = (event) => {
    if (!isEventInsideBuilderLayer(event, layerId)) onDismiss("outside", event);
  };
  const keyDown = (event) => {
    if (event.key !== "Escape") return;
    event.preventDefault?.();
    event.stopPropagation?.();
    onDismiss("escape", event);
  };
  target.addEventListener("pointerdown", pointerDown, true);
  target.addEventListener("keydown", keyDown, true);
  return () => {
    target.removeEventListener("pointerdown", pointerDown, true);
    target.removeEventListener("keydown", keyDown, true);
  };
}

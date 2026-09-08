const finite = (value, fallback) => Number.isFinite(value) ? value : fallback;

export function getFloatingViewport(visualViewport, fallbackWidth, fallbackHeight) {
  return {
    left: finite(visualViewport?.offsetLeft, 0),
    top: finite(visualViewport?.offsetTop, 0),
    width: finite(visualViewport?.width, fallbackWidth),
    height: finite(visualViewport?.height, fallbackHeight),
  };
}

export function intersectFloatingViewport(viewport, container) {
  if (!container) return viewport;
  const left = Math.max(viewport.left, finite(container.left, viewport.left));
  const top = Math.max(viewport.top, finite(container.top, viewport.top));
  const right = Math.min(viewport.left + viewport.width, finite(container.right, viewport.left + viewport.width));
  const bottom = Math.min(viewport.top + viewport.height, finite(container.bottom, viewport.top + viewport.height));
  return { left, top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
}

export function placeFloatingPanel(anchor, panel, viewport, safe = 12, gap = 8) {
  const fitsRight = anchor.right + gap + panel.width <= viewport.left + viewport.width - safe;
  const fitsLeft = anchor.left - gap - panel.width >= viewport.left + safe;
  const x = fitsRight ? anchor.right + gap : fitsLeft ? anchor.left - gap - panel.width : anchor.left;
  const fitsBelow = anchor.bottom + gap + panel.height <= viewport.top + viewport.height - safe;
  const y = fitsBelow ? anchor.bottom + gap : anchor.top - gap - panel.height;
  return constrainFloatingPanel({ x, y }, panel, viewport, safe);
}

export function constrainFloatingPanel(position, panel, viewport, safe = 12) {
  const minX = viewport.left + safe;
  const minY = viewport.top + safe;
  const maxX = Math.max(minX, viewport.left + viewport.width - panel.width - safe);
  const maxY = Math.max(minY, viewport.top + viewport.height - panel.height - safe);
  return {
    x: Math.min(maxX, Math.max(minX, finite(position?.x, minX))),
    y: Math.min(maxY, Math.max(minY, finite(position?.y, minY))),
  };
}

export function sameFloatingPosition(left, right) {
  return left.x === right.x && left.y === right.y;
}

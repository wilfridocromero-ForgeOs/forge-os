export function calculateAutoScrollVelocity({ pointerY, top, bottom, edgeSize = 120, minSpeed = 5, maxSpeed = 34 }) {
  if (![pointerY, top, bottom, edgeSize].every(Number.isFinite) || bottom <= top || edgeSize <= 0) return 0;
  const edge = Math.min(edgeSize, (bottom - top) / 2);
  if (pointerY < top + edge) {
    const strength = Math.min(1, Math.max(0, (top + edge - pointerY) / edge));
    return -(minSpeed + (maxSpeed - minSpeed) * strength ** 2);
  }
  if (pointerY > bottom - edge) {
    const strength = Math.min(1, Math.max(0, (pointerY - (bottom - edge)) / edge));
    return minSpeed + (maxSpeed - minSpeed) * strength ** 2;
  }
  return 0;
}

export function sameLandingDropTarget(left, right) {
  if (left === right) return true;
  if (!left || !right) return false;
  return left.kind === right.kind
    && left.blockId === right.blockId
    && left.sectionId === right.sectionId
    && left.regionId === right.regionId;
}

const dirtySources = new Set();

export function setUnsavedWork(source, isDirty) {
  if (typeof source !== "string" || !source.trim()) {
    throw new TypeError("An unsaved-work source name is required.");
  }

  if (isDirty) dirtySources.add(source);
  else dirtySources.delete(source);
}

export function clearUnsavedWork(source) {
  dirtySources.delete(source);
}

export function hasUnsavedWork() {
  return dirtySources.size > 0;
}

export function createLandingAutosave({ save, onStatus, onSaved, onConflict, onError, setTimer = setTimeout, clearTimer = clearTimeout }) {
  let revision; let pending = null; let active = false; let timer = null; let blocked = false; let waiters = [];
  const settle = () => { if (!active && !pending) { waiters.forEach((resolve) => resolve()); waiters = []; } };
  async function drain() {
    if (active || blocked || !pending) return;
    const document = pending; pending = null; active = true; onStatus("saving");
    try { const saved = await save({ expectedRevision: revision, document }); revision = saved.revision; onSaved(saved.revision, document); onStatus(pending ? "unsaved" : "saved"); }
    catch (error) { pending = document; blocked = true; if (error?.name === "BuilderDraftConflictError") { onStatus("conflict"); onConflict(error); } else { onStatus("error"); onError(error); } }
    finally { active = false; if (pending && !blocked) void drain(); else settle(); }
  }
  return {
    initialize(value) { revision = value; },
    schedule(document, delay = 600) { if (blocked) return; pending = document; onStatus("unsaved"); if (timer) clearTimer(timer); timer = setTimer(() => { timer = null; void drain(); }, delay); },
    async flush() { if (timer) { clearTimer(timer); timer = null; } if (blocked) return; void drain(); if (active || pending) await new Promise((resolve) => waiters.push(resolve)); },
    reset(value) { revision = value; pending = null; blocked = false; if (timer) clearTimer(timer); timer = null; onStatus("saved"); settle(); },
    retry() { if (!pending) return; blocked = false; void drain(); },
    dispose() { if (timer) clearTimer(timer); timer = null; },
  };
}

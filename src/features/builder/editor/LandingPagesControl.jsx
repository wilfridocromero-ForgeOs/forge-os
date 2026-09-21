import { useEffect, useMemo, useState } from "react";
import { Check, ChevronDown, LoaderCircle, Plus } from "lucide-react";
import { orderBuilderSitePages, suggestUniqueBuilderPageSlug } from "../services/BuilderSiteService.js";
import { getActiveBuilderSitePage } from "./landingPageSwitching.js";
import { registerBuilderDismissableLayer } from "./builderDismissableLayer.js";
import "./LandingPagesControl.css";

const BUILDER_PAGES_LAYER = "landing-pages-control";

export default function LandingPagesControl({
  assetId,
  assetName,
  pages,
  status,
  error,
  busy,
  onReload,
  onSelect,
  onCreate,
}) {
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [actionError, setActionError] = useState("");
  const orderedPages = useMemo(() => orderBuilderSitePages(pages), [pages]);
  const activePage = getActiveBuilderSitePage(orderedPages, assetId);
  const suggestedSlug = suggestUniqueBuilderPageSlug(name, orderedPages);

  useEffect(() => {
    if (!open || typeof document === "undefined") return undefined;
    return registerBuilderDismissableLayer({
      target: document,
      layerId: BUILDER_PAGES_LAYER,
      onDismiss: (reason) => {
        if (reason === "escape" && creating) {
          setCreating(false);
          setActionError("");
          return;
        }
        setOpen(false);
        setCreating(false);
        setActionError("");
      },
    });
  }, [creating, open]);

  async function selectPage(page) {
    if (page.page_asset_id === assetId) { setOpen(false); return; }
    if (busy) return;
    setActionError("");
    try {
      const switched = await onSelect(page);
      if (switched !== false) setOpen(false);
    } catch (value) {
      setActionError(value.message || "No se pudo abrir la página.");
    }
  }

  async function submit(event) {
    event.preventDefault();
    const normalizedName = name.trim();
    if (!normalizedName || submitting || busy) return;
    setSubmitting(true);
    setActionError("");
    try {
      await onCreate({ name: normalizedName, slug: suggestedSlug });
      setName("");
      setCreating(false);
      setOpen(false);
    } catch (value) {
      setActionError(value.message || "No se pudo crear la página.");
    } finally {
      setSubmitting(false);
    }
  }

  const visibleName = activePage?.name || assetName || "Página";
  const visibleSlug = activePage?.slug || "";

  return <div className="landing-pages-control" data-builder-editor-control data-builder-dismiss-layer={BUILDER_PAGES_LAYER}>
    <button
      type="button"
      className="landing-pages-trigger"
      aria-haspopup="dialog"
      aria-expanded={open}
      onClick={() => { setOpen((value) => !value); setActionError(""); }}
    >
      <span>Página</span>
      <strong>{visibleName}</strong>
      {visibleSlug && <small>{visibleSlug}</small>}
      <ChevronDown aria-hidden="true"/>
    </button>
    {open && <section className="landing-pages-popover" role="dialog" aria-label="Páginas del Site">
      <header><div><span>PÁGINAS</span><strong>{activePage ? `${orderedPages.length} ${orderedPages.length === 1 ? "página" : "páginas"}` : "Site"}</strong></div><button type="button" onClick={() => setOpen(false)} aria-label="Cerrar selector de páginas">×</button></header>
      <div className="landing-pages-list">
        {status === "loading" && !orderedPages.length && <p className="landing-pages-state"><LoaderCircle className="is-spinning"/> Cargando páginas…</p>}
        {status !== "loading" && !orderedPages.length && !error && <p className="landing-pages-state">No se encontraron páginas para este Site.</p>}
        {orderedPages.map((page) => {
          const active = page.page_asset_id === assetId;
          return <button
            type="button"
            key={page.page_asset_id}
            className={`landing-pages-item ${active ? "is-active" : ""}`}
            aria-current={active ? "page" : undefined}
            disabled={busy && !active}
            onClick={() => selectPage(page)}
          >
            <span className="landing-pages-item-mark">{active ? <Check aria-hidden="true"/> : null}</span>
            <span><strong>{page.name}</strong><small>{page.slug}</small></span>
            {page.is_home && <em>Home</em>}
          </button>;
        })}
      </div>
      {(error || actionError) && <div className="landing-pages-error" role="alert"><span>{actionError || error}</span>{error && !actionError && <button type="button" onClick={onReload}>Reintentar</button>}</div>}
      {creating ? <form className="landing-pages-create" onSubmit={submit}>
        <label>Nombre de página<input value={name} onChange={(event) => setName(event.target.value)} maxLength={120} autoFocus required placeholder="Servicios"/></label>
        <p>URL sugerida <strong>{suggestedSlug || "/pagina"}</strong></p>
        <div><button type="button" onClick={() => { setCreating(false); setActionError(""); }} disabled={submitting}>Cancelar</button><button type="submit" disabled={!name.trim() || submitting || busy}>{submitting ? "Creando…" : "Crear página"}</button></div>
      </form> : <button type="button" className="landing-pages-new" onClick={() => { setCreating(true); setName(""); setActionError(""); }} disabled={busy || status === "loading" || !activePage}><Plus aria-hidden="true"/> Nueva página</button>}
    </section>}
  </div>;
}

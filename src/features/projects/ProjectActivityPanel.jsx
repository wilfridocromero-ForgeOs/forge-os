import { useCallback, useEffect, useState } from "react";
import { History } from "lucide-react";
import Button from "../../components/ui/Button";
import { getProjectActivity } from "../../services/ProjectService";
import { formatActivityDate, formatProjectActivity } from "./projectActivityFormatter";

const PAGE_SIZE = 30;
const filters = [["all", "Todo"], ["project", "Proyecto"], ["task", "Tareas"], ["project_member", "Miembros"], ["comment", "Comentarios"]];

export default function ProjectActivityPanel({ projectId }) {
  const [rows, setRows] = useState([]);
  const [filter, setFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState("");

  const loadFirst = useCallback(async () => {
    setLoading(true); setError("");
    try { const data = await getProjectActivity(projectId, null, PAGE_SIZE); setRows(data); setHasMore(data.length === PAGE_SIZE); }
    catch (reason) { setError(reason.message || "No se pudo cargar la actividad."); }
    finally { setLoading(false); }
  }, [projectId]);
  // The callback synchronizes the timeline with Supabase when the selected project changes.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { loadFirst(); }, [loadFirst]);

  async function loadMore() {
    if (loadingMore || !rows.length) return;
    setLoadingMore(true); setError("");
    try { const data = await getProjectActivity(projectId, rows.at(-1).id, PAGE_SIZE); setRows((current) => [...current, ...data]); setHasMore(data.length === PAGE_SIZE); }
    catch (reason) { setError(reason.message || "No se pudo cargar más actividad."); }
    finally { setLoadingMore(false); }
  }

  const visible = filter === "all" ? rows : rows.filter((row) => row.entity_type === filter);
  return <section className="min-w-0 space-y-4">
    <div className="flex gap-2 overflow-x-auto pb-1">{filters.map(([key, label]) => <button type="button" key={key} onClick={() => setFilter(key)} className={`shrink-0 rounded-full border px-3 py-1.5 text-xs ${filter === key ? "border-zinc-500 bg-zinc-800 text-white" : "border-zinc-800 text-zinc-500"}`}>{label}</button>)}</div>
    {error && <p className="rounded-xl border border-red-900/50 bg-red-950/20 p-3 text-sm text-red-300">{error}</p>}
    {loading ? <p className="text-sm text-zinc-500">Cargando actividad…</p> : !visible.length ? <div className="rounded-2xl border border-dashed border-zinc-800 p-8 text-center"><History className="mx-auto text-zinc-600" size={24} /><h3 className="mt-3 font-medium text-white">Sin actividad registrada</h3><p className="mt-2 text-sm text-zinc-500">Los cambios operacionales aparecerán aquí.</p></div> : <ol className="space-y-3">{visible.map((row) => <li key={row.id} className="min-w-0 rounded-xl border border-zinc-800 p-4"><p className="break-words text-sm leading-6 text-zinc-200">{formatProjectActivity(row)}</p><time className="mt-1 block text-xs text-zinc-600" dateTime={row.created_at}>{formatActivityDate(row.created_at)}</time></li>)}</ol>}
    {hasMore && <div className="flex justify-center"><Button type="button" variant="ghost" onClick={loadMore} disabled={loadingMore}>{loadingMore ? "Cargando…" : "Cargar más"}</Button></div>}
  </section>;
}

import { useCallback, useEffect, useRef, useState } from "react";
import { Download, ExternalLink, FileText, Trash2, Upload } from "lucide-react";
import Button from "../../components/ui/Button";
import {
  deleteProjectFile,
  downloadProjectFile,
  getProjectFiles,
  previewProjectFile,
  uploadProjectFile,
} from "../../services/ProjectService";

const PAGE_SIZE = 30;

export default function ProjectFilesPanel({ projectId, organizationId, userId, canUpload, canManage }) {
  const inputRef = useRef(null);
  const [files, setFiles] = useState([]);
  const [uploads, setUploads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState("");

  const loadFirst = useCallback(async () => {
    setLoading(true); setError("");
    try { const data = await getProjectFiles(projectId, null, PAGE_SIZE); setFiles(data); setHasMore(data.length === PAGE_SIZE); }
    catch (reason) { setError(reason.message || "No se pudieron cargar los archivos."); }
    finally { setLoading(false); }
  }, [projectId]);
  useEffect(() => { loadFirst(); }, [loadFirst]);

  async function uploadSelected(event) {
    const selected = Array.from(event.target.files || []);
    event.target.value = "";
    if (!selected.length) return;
    const batch = selected.map((file) => ({ key: crypto.randomUUID(), name: file.name, progress: 0, status: "Pendiente", error: "" }));
    setUploads(batch); setError("");
    for (let index = 0; index < selected.length; index += 1) {
      const file = selected[index]; const item = batch[index];
      try {
        await uploadProjectFile({ projectId, organizationId, file, userId, onProgress(progress, status) {
          setUploads((current) => current.map((row) => row.key === item.key ? { ...row, progress, status } : row));
        } });
      } catch (reason) {
        setUploads((current) => current.map((row) => row.key === item.key ? { ...row, status: "Error", error: reason.message || "No se pudo subir." } : row));
      }
    }
    await loadFirst();
  }

  async function act(action) {
    setError("");
    try { await action(); }
    catch (reason) { setError(reason.message || "No se pudo completar la acción."); }
  }

  async function remove(file) {
    if (!window.confirm(`¿Eliminar “${file.file_name}”? La acción quedará registrada.`)) return;
    await act(async () => { await deleteProjectFile(file); setFiles((current) => current.filter((row) => row.id !== file.id)); });
  }

  async function loadMore() {
    if (loadingMore || !files.length) return;
    setLoadingMore(true); setError("");
    try {
      const data = await getProjectFiles(projectId, files.at(-1), PAGE_SIZE);
      setFiles((current) => [...current, ...data]); setHasMore(data.length === PAGE_SIZE);
    } catch (reason) { setError(reason.message || "No se pudieron cargar más archivos."); }
    finally { setLoadingMore(false); }
  }

  return <section className="min-w-0 space-y-5">
    <div className="flex min-w-0 flex-col gap-3 rounded-2xl border border-zinc-800 bg-zinc-950/40 p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0"><h3 className="font-semibold text-white">Archivos del proyecto</h3><p className="mt-1 text-sm text-zinc-500">Documentos e imágenes privadas. Máximo 50 MB por archivo.</p></div>
      {canUpload ? <><input ref={inputRef} type="file" multiple className="hidden" onChange={uploadSelected} accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.csv,.txt,.jpg,.jpeg,.png,.webp" /><Button type="button" onClick={() => inputRef.current?.click()}><Upload size={16} /> Subir archivo</Button></> : <span className="text-xs text-zinc-600">Solo lectura</span>}
    </div>
    {uploads.length > 0 && <div className="space-y-2 rounded-2xl border border-zinc-800 p-4"><div className="flex items-center justify-between"><h4 className="text-sm font-medium text-white">Carga de archivos</h4><button type="button" onClick={() => setUploads([])} className="text-xs text-zinc-500 hover:text-white">Ocultar completados</button></div>{uploads.map((item) => <div key={item.key} className="min-w-0"><div className="flex min-w-0 items-center justify-between gap-3 text-xs"><span className="min-w-0 truncate text-zinc-300" title={item.name}>{item.name}</span><span className={item.error ? "text-red-300" : "text-zinc-500"}>{item.status}</span></div><div className="mt-1 h-1 overflow-hidden rounded-full bg-zinc-800"><div className={`h-full transition-[width] ${item.error ? "bg-red-500" : "bg-white"}`} style={{ width: `${item.progress}%` }} /></div>{item.error && <p className="mt-1 text-xs text-red-300">{item.error}</p>}</div>)}</div>}
    {error && <p className="rounded-xl border border-red-900/50 bg-red-950/20 p-3 text-sm text-red-300">{error}</p>}
    {loading ? <p className="text-sm text-zinc-500">Cargando archivos…</p> : !files.length ? <div className="rounded-2xl border border-dashed border-zinc-800 p-8 text-center"><FileText className="mx-auto text-zinc-600" size={24} /><h3 className="mt-3 font-medium text-white">Sin archivos todavía</h3><p className="mt-2 text-sm text-zinc-500">Los documentos operacionales del proyecto aparecerán aquí.</p></div> : <div className="space-y-2">{files.map((file) => <FileRow key={file.id} file={file} canDelete={canManage || (canUpload && file.uploaded_by === userId)} onPreview={() => act(() => previewProjectFile(file))} onDownload={() => act(() => downloadProjectFile(file))} onDelete={() => remove(file)} />)}</div>}
    {hasMore && <div className="flex justify-center"><Button type="button" variant="ghost" onClick={loadMore} disabled={loadingMore}>{loadingMore ? "Cargando…" : "Cargar más"}</Button></div>}
  </section>;
}

function FileRow({ file, canDelete, onPreview, onDownload, onDelete }) {
  const previewable = file.mime_type === "application/pdf" || file.mime_type.startsWith("image/");
  return <article className="grid min-w-0 gap-3 rounded-xl border border-zinc-800 p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
    <div className="flex min-w-0 items-start gap-3"><div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-zinc-900 text-zinc-500"><FileText size={17} /></div><div className="min-w-0"><p className="truncate text-sm font-medium text-white" title={file.file_name}>{file.file_name}</p><p className="mt-1 break-words text-xs text-zinc-600">{formatBytes(file.size_bytes)} · {shortType(file.mime_type)} · {file.uploader_name || "Usuario"}</p><time className="mt-1 block text-xs text-zinc-700">{new Intl.DateTimeFormat("es", { dateStyle: "medium", timeStyle: "short" }).format(new Date(file.created_at))}</time></div></div>
    <div className="flex flex-wrap gap-2 sm:justify-end">{previewable && <button type="button" onClick={onPreview} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-zinc-800 px-3 text-xs text-zinc-300 hover:border-zinc-600"><ExternalLink size={14} /> Abrir</button>}<button type="button" onClick={onDownload} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-zinc-800 px-3 text-xs text-zinc-300 hover:border-zinc-600"><Download size={14} /> Descargar</button>{canDelete && <button type="button" onClick={onDelete} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-zinc-800 px-3 text-xs text-zinc-500 hover:border-red-900 hover:text-red-300"><Trash2 size={14} /> Eliminar</button>}</div>
  </article>;
}

function formatBytes(value) { const bytes = Number(value); if (bytes < 1024) return `${bytes} B`; if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`; return `${(bytes / 1048576).toFixed(1)} MB`; }
function shortType(value) { return value.replace("application/vnd.openxmlformats-officedocument.", "").replace("application/", "").replace("image/", "").toUpperCase(); }

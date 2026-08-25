import { useCallback, useEffect, useRef, useState } from "react";
import { Download, ExternalLink, FileText, Paperclip, Trash2, Upload } from "lucide-react";
import {
  deleteProjectFile, downloadProjectFile, getTaskReferenceFiles,
  previewProjectFile, uploadTaskReferenceFile,
} from "../../services/ProjectService";

export default function TaskReferenceFilesPanel({ taskId, projectId, organizationId, userId, canEdit, reportError }) {
  const inputRef = useRef(null);
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState([]);

  const load = useCallback(async () => {
    setLoading(true);
    try { setFiles(await getTaskReferenceFiles(taskId)); }
    catch (reason) { reportError(reason.message || "No se pudieron cargar las referencias."); }
    finally { setLoading(false); }
  }, [reportError, taskId]);

  useEffect(() => { load(); }, [load]);

  async function uploadSelected(event) {
    const selected = Array.from(event.target.files || []);
    event.target.value = "";
    if (!selected.length) return;
    const batch = selected.map((file) => ({ id: crypto.randomUUID(), name: file.name, progress: 0, status: "Pendiente", error: "" }));
    setUploading(batch); reportError("");
    for (let index = 0; index < selected.length; index += 1) {
      const file = selected[index]; const row = batch[index];
      try {
        await uploadTaskReferenceFile({ projectId, organizationId, taskId, file, userId, onProgress(progress, status) {
          setUploading((current) => current.map((item) => item.id === row.id ? { ...item, progress, status } : item));
        } });
      } catch (reason) {
        setUploading((current) => current.map((item) => item.id === row.id ? { ...item, status: "Error", error: reason.message || "No se pudo subir." } : item));
      }
    }
    await load();
  }

  async function act(action) {
    reportError("");
    try { await action(); }
    catch (reason) { reportError(reason.message || "No se pudo completar la acción con el archivo."); }
  }

  async function remove(file) {
    if (!window.confirm(`¿Eliminar “${file.file_name}” de las referencias de esta tarea?`)) return;
    await act(async () => { await deleteProjectFile(file); await load(); });
  }

  return <section className="min-w-0 space-y-3" aria-labelledby="task-reference-title">
    <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0"><h3 id="task-reference-title" className="flex items-center gap-2 text-lg font-semibold text-white"><Paperclip size={17} /> Archivos de referencia</h3><p className="mt-1 text-sm text-zinc-500">Material necesario para realizar el trabajo. No cuenta como evidencia.</p></div>
      {canEdit && <><input ref={inputRef} type="file" multiple className="hidden" onChange={uploadSelected} accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.csv,.txt,.jpg,.jpeg,.png,.webp" /><button type="button" onClick={() => inputRef.current?.click()} className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-xl border border-zinc-700 px-4 text-sm text-zinc-300 hover:border-zinc-500 hover:text-white"><Upload size={15} /> Añadir archivos</button></>}
    </div>

    {uploading.length > 0 && <div className="space-y-2 rounded-xl border border-zinc-800 p-3">{uploading.map((item) => <div key={item.id} className="min-w-0"><div className="flex min-w-0 justify-between gap-3 text-xs"><span className="min-w-0 break-words text-zinc-300">{item.name}</span><span className={item.error ? "shrink-0 text-red-300" : "shrink-0 text-zinc-500"}>{item.status}</span></div><div className="mt-1 h-1 overflow-hidden rounded-full bg-zinc-800"><div className={item.error ? "h-full bg-red-500" : "h-full bg-white"} style={{ width: `${item.progress}%` }} /></div>{item.error && <p className="mt-1 text-xs text-red-300">{item.error}</p>}</div>)}</div>}

    {loading ? <p className="text-sm text-zinc-500">Cargando referencias…</p> : files.length ? <div className="space-y-2">{files.map((file) => <ReferenceFile key={`${file.id}-${file.inherited}`} file={file} canDelete={canEdit && !file.inherited} onOpen={() => act(() => previewProjectFile(file))} onDownload={() => act(() => downloadProjectFile(file))} onDelete={() => remove(file)} />)}</div> : <div className="rounded-xl border border-dashed border-zinc-800 p-5 text-center"><FileText className="mx-auto text-zinc-600" size={21} /><p className="mt-2 text-sm text-zinc-400">Sin archivos de referencia</p><p className="mt-1 text-xs text-zinc-600">Las evidencias se entregan por separado.</p></div>}
  </section>;
}

function ReferenceFile({ file, canDelete, onOpen, onDownload, onDelete }) {
  const previewable = file.mime_type === "application/pdf" || file.mime_type.startsWith("image/");
  return <article className="grid min-w-0 gap-3 rounded-xl border border-zinc-800 p-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
    <div className="flex min-w-0 items-start gap-3"><span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-zinc-900 text-zinc-500"><FileText size={16} /></span><div className="min-w-0"><p className="break-words text-sm font-medium text-white">{file.file_name}</p><p className="mt-1 break-words text-xs text-zinc-600">{formatBytes(file.size_bytes)} · {shortType(file.mime_type)}{file.inherited ? " · Heredado de la tarea recurrente" : ""}</p></div></div>
    <div className="flex flex-wrap gap-2 sm:justify-end">{previewable && <button type="button" onClick={onOpen} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-zinc-800 px-3 text-xs text-zinc-300"><ExternalLink size={14} /> Abrir</button>}<button type="button" onClick={onDownload} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-zinc-800 px-3 text-xs text-zinc-300"><Download size={14} /> Descargar</button>{canDelete && <button type="button" onClick={onDelete} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-zinc-800 px-3 text-xs text-zinc-500 hover:text-red-300"><Trash2 size={14} /> Eliminar</button>}</div>
  </article>;
}

function formatBytes(value) { const bytes = Number(value); if (bytes < 1024) return `${bytes} B`; if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`; return `${(bytes / 1048576).toFixed(1)} MB`; }
function shortType(value) { return value.replace("application/vnd.openxmlformats-officedocument.", "").replace("application/", "").replace("image/", "").toUpperCase(); }

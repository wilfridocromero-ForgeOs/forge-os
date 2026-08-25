import { useEffect, useMemo, useRef, useState } from "react";
import { Archive, BookOpen, Download, FileText, FolderUp, Pause, Pencil, Play, RefreshCw, Search, Upload, X } from "lucide-react";

import Page from "../components/ui/Page";
import Card from "../components/ui/Card";
import { useAuth } from "../Context/AuthContext";
import { useDivisions } from "../hooks/useDivisions";
import { supabase } from "../lib/supabase";

const typeLabels = { sop: "SOP", playbook: "Playbook", policy: "Política", template: "Plantilla", reference: "Referencia" };
const statusLabels = { draft: "Borrador", review: "En revisión", approved: "Aprobado", archived: "Archivado" };
const extractionLabels = { pending: "Pendiente", processing: "Procesando…", completed: "Listo", failed: "Error" };
const chunkingLabels = { pending: "Pendiente", processing: "Procesando…", completed: "Listo", failed: "Error" };
const emptyMetadata = { document_type: "reference", division_id: "", folder_id: "", category: "", tags: "" };

function latestVersion(document) {
  return document.latest_version || {
    id: null,
    version_number: document.version,
    file_path: document.file_path,
    file_name: document.file_name,
    mime_type: document.mime_type,
    file_size: document.file_size,
    status: document.status,
    extraction_status: "pending",
    chunking_status: "pending",
  };
}

function allowedStatusTargets(status) {
  if (status === "draft") return ["draft", "review", "archived"];
  if (status === "review") return ["review", "draft", "approved", "archived"];
  if (status === "approved") return ["approved", "archived"];
  return ["archived"];
}

export default function Brain() {
  const { profile, user, canManageUsers } = useAuth();
  const { divisions } = useDivisions(profile?.organization_id);
  const [documents, setDocuments] = useState([]);
  const [folders, setFolders] = useState([]);
  const [search, setSearch] = useState("");
  const [type, setType] = useState("all");
  const [status, setStatus] = useState("all");
  const [folderId, setFolderId] = useState("all");
  const [uploadOpen, setUploadOpen] = useState(false);
  const [files, setFiles] = useState([]);
  const [metadata, setMetadata] = useState(emptyMetadata);
  const [queue, setQueue] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState("");
  const [versionTarget, setVersionTarget] = useState(null);
  const [editingDocument, setEditingDocument] = useState(null);
  const [editForm, setEditForm] = useState(null);
  const [processingVersionIds, setProcessingVersionIds] = useState([]);
  const [chunkingVersionIds, setChunkingVersionIds] = useState([]);
  const aborters = useRef(new Map());
  const extractionTimers = useRef(new Set());
  const chunkingRequests = useRef(new Set());
  const chunkingTimers = useRef(new Map());

  async function loadLibrary() {
    if (!profile?.organization_id) return;
    const [documentsResult, foldersResult] = await Promise.all([
      supabase.from("knowledge_documents").select("*, divisions(name), knowledge_folders(name), latest_version:knowledge_document_versions!knowledge_documents_latest_version_fkey(id, version_number, file_path, file_name, mime_type, file_size, status, submitted_for_review_at, submitted_by, approved_at, approved_by, extraction_status, extraction_error, extracted_at, extractor_version, chunking_status, chunking_error, chunked_at, chunker_version), current_version:knowledge_document_versions!knowledge_documents_current_version_fkey(id, version_number, status, approved_at, approved_by)").eq("organization_id", profile.organization_id).order("created_at", { ascending: false }),
      supabase.from("knowledge_folders").select("id, parent_id, name").eq("organization_id", profile.organization_id).order("name"),
    ]);
    const error = documentsResult.error || foldersResult.error;
    if (error) return setMessage(error.message);
    setDocuments(documentsResult.data || []);
    setFolders(foldersResult.data || []);
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { loadLibrary(); }, [profile?.organization_id]);

  useEffect(() => () => {
    extractionTimers.current.forEach((timer) => window.clearTimeout(timer));
    extractionTimers.current.clear();
    chunkingTimers.current.forEach((timer) => window.clearTimeout(timer));
    chunkingTimers.current.clear();
    chunkingRequests.current.clear();
  }, []);

  const filtered = useMemo(() => documents.filter((document) => {
    const haystack = `${document.title} ${document.description || ""} ${document.category || ""} ${(document.tags || []).join(" ")} ${document.divisions?.name || ""}`.toLowerCase();
    return (type === "all" || document.document_type === type)
      && (status === "all" || latestVersion(document).status === status)
      && (folderId === "all" || document.folder_id === folderId)
      && haystack.includes(search.toLowerCase());
  }), [documents, folderId, search, status, type]);

  function addFiles(fileList) {
    const incoming = Array.from(fileList || []);
    setFiles((current) => {
      const known = new Set(current.map((file) => `${file.name}:${file.size}:${file.lastModified}`));
      return [...current, ...incoming.filter((file) => !known.has(`${file.name}:${file.size}:${file.lastModified}`))];
    });
  }

  async function ensureFolder(relativePath, cache, baseParentId = null) {
    const parts = relativePath.split("/").slice(0, -1).filter(Boolean);
    let parentId = baseParentId;
    for (const name of parts) {
      const key = `${parentId || "root"}/${name}`;
      if (cache.has(key)) { parentId = cache.get(key); continue; }
      let query = supabase.from("knowledge_folders").select("id").eq("organization_id", profile.organization_id).eq("name", name);
      query = parentId ? query.eq("parent_id", parentId) : query.is("parent_id", null);
      const existing = await query.maybeSingle();
      if (existing.error) throw existing.error;
      if (existing.data) parentId = existing.data.id;
      else {
        const created = await supabase.from("knowledge_folders").insert({ organization_id: profile.organization_id, parent_id: parentId, division_id: metadata.division_id || null, name, created_by: user.id }).select("id").single();
        if (created.error) throw created.error;
        parentId = created.data.id;
      }
      cache.set(key, parentId);
    }
    return parentId;
  }

  async function uploadOne(item, folderCache) {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw new Error("La sesión expiró. Inicia sesión nuevamente.");
    const relativePath = item.file.webkitRelativePath || item.file.name;
    const linkedFolderId = versionTarget?.folder_id || await ensureFolder(relativePath, folderCache, metadata.folder_id || null);
    const safeName = item.file.name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9._-]+/g, "-");
    const objectPath = item.objectPath || `${profile.organization_id}/${crypto.randomUUID()}-${safeName}`;
    item.objectPath = objectPath;
    const encodedPath = objectPath.split("/").map(encodeURIComponent).join("/");
    const url = `${import.meta.env.VITE_SUPABASE_URL}/storage/v1/object/knowledge-base/${encodedPath}`;

    if (!item.storageUploaded) await new Promise((resolve, reject) => {
      const request = new XMLHttpRequest();
      aborters.current.set(item.id, request);
      request.open("POST", url);
      request.setRequestHeader("Authorization", `Bearer ${session.access_token}`);
      request.setRequestHeader("apikey", import.meta.env.VITE_SUPABASE_ANON_KEY);
      request.setRequestHeader("Content-Type", item.file.type || "application/octet-stream");
      request.upload.onprogress = (event) => event.lengthComputable && setQueue((current) => current.map((row) => row.id === item.id ? { ...row, progress: Math.round(event.loaded / event.total * 100) } : row));
      request.onload = () => request.status >= 200 && request.status < 300 ? resolve() : reject(new Error(`Carga rechazada (${request.status})`));
      request.onerror = () => reject(new Error("Se perdió la conexión durante la carga."));
      request.onabort = () => reject(new DOMException("Carga cancelada", "AbortError"));
      request.send(item.file);
    });
    item.storageUploaded = true;

    const title = versionTarget?.title || item.file.name.replace(/\.[^.]+$/, "");
    const saved = await supabase.rpc("register_knowledge_document_version", {
      target_document_id: versionTarget?.id || null,
      target_title: title,
      target_document_type: versionTarget?.document_type || metadata.document_type,
      target_division_id: versionTarget?.division_id || metadata.division_id || null,
      target_folder_id: linkedFolderId,
      target_category: versionTarget?.category || metadata.category.trim() || null,
      target_tags: versionTarget?.tags || metadata.tags.split(",").map((tag) => tag.trim()).filter(Boolean),
      target_author_name: versionTarget?.author_name || profile.first_name || user.email,
      target_file_path: objectPath,
      target_file_name: item.file.name,
      target_mime_type: item.file.type || null,
      target_file_size: item.file.size,
    }).single();
    if (saved.error) {
      const registered = await supabase.from("knowledge_document_versions").select("id").eq("file_path", objectPath).maybeSingle();
      if (!registered.error && !registered.data) {
        await supabase.storage.from("knowledge-base").remove([objectPath]);
        item.storageUploaded = false;
      }
      throw saved.error;
    }

    const extraction = await supabase.functions.invoke("process-knowledge-document", {
      body: { version_id: saved.data.version_id },
    });
    if (extraction.error) console.error("Knowledge extraction remains pending", extraction.error.message);
  }

  async function startUpload() {
    if (!files.length) return setMessage("Selecciona uno o más archivos.");
    if (versionTarget && files.length !== 1) return setMessage("Una nueva versión requiere exactamente un archivo.");
    const initial = files.map((file) => ({ id: crypto.randomUUID(), file, progress: 0, state: "pending", attempts: 0, error: "" }));
    setQueue(initial); setUploading(true); setMessage("");
    const folderCache = new Map();
    let cursor = 0;
    async function worker() {
      while (cursor < initial.length) {
        const item = initial[cursor++];
        let success = false;
        for (let attempt = 1; attempt <= 3 && !success; attempt += 1) {
          setQueue((current) => current.map((row) => row.id === item.id ? { ...row, state: "uploading", attempts: attempt } : row));
          try { await uploadOne(item, folderCache); success = true; setQueue((current) => current.map((row) => row.id === item.id ? { ...row, state: "complete", progress: 100 } : row)); }
          catch (error) {
            if (error.name === "AbortError") { setQueue((current) => current.map((row) => row.id === item.id ? { ...row, state: "cancelled", error: error.message } : row)); break; }
            if (attempt === 3) setQueue((current) => current.map((row) => row.id === item.id ? { ...row, state: "failed", error: error.message } : row));
            else await new Promise((resolve) => setTimeout(resolve, attempt * 1000));
          }
        }
        aborters.current.delete(item.id);
      }
    }
    await Promise.all(Array.from({ length: Math.min(4, initial.length) }, worker));
    setUploading(false); setMessage("El lote terminó. Revisa cualquier archivo marcado como fallido.");
    setFiles([]); await loadLibrary();
  }

  function cancelUploads() { aborters.current.forEach((request) => request.abort()); aborters.current.clear(); }
  async function openDocument(document) { const { data, error } = await supabase.storage.from("knowledge-base").createSignedUrl(latestVersion(document).file_path, 60); if (error) return setMessage(error.message); window.open(data.signedUrl, "_blank", "noopener,noreferrer"); }
  function beginNewVersion(document) {
    setVersionTarget(document);
    setFiles([]);
    setQueue([]);
    setMetadata({
      document_type: document.document_type,
      division_id: document.division_id || "",
      folder_id: document.folder_id || "",
      category: document.category || "",
      tags: (document.tags || []).join(", "),
    });
    setUploadOpen(true);
  }
  function beginEdit(document) {
    const version = latestVersion(document);
    setEditingDocument(document);
    setEditForm({ title: document.title, description: document.description || "", division_id: document.division_id || "", folder_id: document.folder_id || "", document_type: document.document_type, status: version.status, originalStatus: version.status, category: document.category || "", tags: (document.tags || []).join(", ") });
  }

  async function saveDocument() {
    if (!editForm.title.trim()) return setMessage("El documento necesita un título.");
    if (editForm.status !== editForm.originalStatus) {
      const transition = await supabase.rpc("transition_knowledge_document_version", {
        target_version_id: latestVersion(editingDocument).id,
        target_status: editForm.status,
      });
      if (transition.error) return setMessage(transition.error.message);
    }
    const { error } = await supabase.from("knowledge_documents").update({
      title: editForm.title.trim(), description: editForm.description.trim() || null,
      division_id: editForm.division_id || null, folder_id: editForm.folder_id || null,
      document_type: editForm.document_type,
      category: editForm.category.trim() || null,
      tags: editForm.tags.split(",").map((tag) => tag.trim()).filter(Boolean), updated_at: new Date().toISOString(),
    }).eq("id", editingDocument.id);
    if (error) return setMessage(error.message);
    setEditingDocument(null); setEditForm(null); setMessage("Documento actualizado correctamente."); await loadLibrary();
  }

  async function archiveDocument(document) {
    if (!window.confirm(`¿Archivar la versión vigente de ${document.title}? El archivo y su historial se conservarán.`)) return;
    const result = await supabase.rpc("transition_knowledge_document_version", {
      target_version_id: latestVersion(document).id,
      target_status: "archived",
    });
    if (result.error) return setMessage(result.error.message);
    setMessage("Versión archivada. El archivo y su historial permanecen intactos.");
    await loadLibrary();
  }

  function updateExtractionStatus(versionId, extraction) {
    setDocuments((current) => current.map((document) => (
      document.latest_version?.id === versionId
        ? { ...document, latest_version: { ...document.latest_version, ...extraction } }
        : document
    )));
  }

  function finishExtractionRequest(versionId) {
    setProcessingVersionIds((current) => current.filter((id) => id !== versionId));
  }

  async function pollExtraction(versionId, attempt = 0) {
    const result = await supabase
      .from("knowledge_document_versions")
      .select("extraction_status, extraction_error, extracted_at, extractor_version")
      .eq("id", versionId)
      .single();
    if (result.error) {
      finishExtractionRequest(versionId);
      setMessage("No se pudo actualizar el estado del procesamiento. Recarga la biblioteca para comprobarlo.");
      return;
    }

    updateExtractionStatus(versionId, result.data);
    if (result.data.extraction_status === "completed") {
      finishExtractionRequest(versionId);
      setMessage("Procesamiento terminado correctamente.");
      return;
    }
    if (result.data.extraction_status === "failed") {
      finishExtractionRequest(versionId);
      setMessage("El procesamiento no pudo completarse. Puedes reintentarlo desde la tarjeta.");
      return;
    }
    if (attempt >= 19) {
      finishExtractionRequest(versionId);
      setMessage("La solicitud fue aceptada y continúa en segundo plano. Recarga la biblioteca para consultar el estado final.");
      return;
    }

    const timer = window.setTimeout(() => {
      extractionTimers.current.delete(timer);
      pollExtraction(versionId, attempt + 1);
    }, 1500);
    extractionTimers.current.add(timer);
  }

  async function requestExtraction(document, retry = false) {
    const version = latestVersion(document);
    if (!version.id || processingVersionIds.includes(version.id)) return;
    if ((!retry && version.extraction_status !== "pending") || (retry && version.extraction_status !== "failed")) return;

    setProcessingVersionIds((current) => [...current, version.id]);
    setMessage(retry ? "Preparando el reintento…" : "Solicitando el procesamiento…");
    if (retry) {
      const retryResult = await supabase.rpc("retry_knowledge_document_extraction", { target_version_id: version.id });
      if (retryResult.error) {
        finishExtractionRequest(version.id);
        setMessage("No se pudo preparar el reintento. Comprueba tus permisos e inténtalo nuevamente.");
        return;
      }
      updateExtractionStatus(version.id, { extraction_status: "pending", extraction_error: null });
    }

    const extraction = await supabase.functions.invoke("process-knowledge-document", { body: { version_id: version.id } });
    if (extraction.error) {
      finishExtractionRequest(version.id);
      setMessage("No se pudo iniciar el procesamiento. Comprueba tu sesión y tus permisos.");
      return;
    }
    setMessage("Solicitud aceptada. Esperando el resultado del procesamiento…");
    pollExtraction(version.id);
  }

  function updateChunkingStatus(versionId, chunking) {
    setDocuments((current) => current.map((document) => (
      document.latest_version?.id === versionId
        ? { ...document, latest_version: { ...document.latest_version, ...chunking } }
        : document
    )));
  }

  function finishChunkingRequest(versionId) {
    chunkingRequests.current.delete(versionId);
    const timer = chunkingTimers.current.get(versionId);
    if (timer) window.clearTimeout(timer);
    chunkingTimers.current.delete(versionId);
    setChunkingVersionIds((current) => current.filter((id) => id !== versionId));
  }

  async function pollChunking(versionId, attempt = 0) {
    const result = await supabase
      .from("knowledge_document_versions")
      .select("chunking_status, chunking_error, chunked_at, chunker_version")
      .eq("id", versionId)
      .single();
    if (result.error) {
      finishChunkingRequest(versionId);
      setMessage("No se pudo actualizar el estado del conocimiento. Recarga la biblioteca para comprobarlo.");
      return;
    }

    updateChunkingStatus(versionId, result.data);
    if (result.data.chunking_status === "completed") {
      finishChunkingRequest(versionId);
      setMessage("Conocimiento generado correctamente.");
      return;
    }
    if (result.data.chunking_status === "failed") {
      finishChunkingRequest(versionId);
      setMessage("No se pudo generar el conocimiento. Revisa el error antes de intentar cualquier reintento.");
      return;
    }
    if (attempt >= 39) {
      finishChunkingRequest(versionId);
      setMessage("La solicitud fue aceptada y continúa en segundo plano. Recarga la biblioteca para consultar el estado final.");
      return;
    }

    const timer = window.setTimeout(() => {
      chunkingTimers.current.delete(versionId);
      pollChunking(versionId, attempt + 1);
    }, 1500);
    chunkingTimers.current.set(versionId, timer);
  }

  async function requestChunking(document) {
    const version = latestVersion(document);
    if (!version.id || !canManageUsers || chunkingRequests.current.has(version.id)) return;
    if (version.extraction_status !== "completed" || version.chunking_status !== "pending") return;

    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      setMessage("La sesión expiró. Inicia sesión nuevamente.");
      return;
    }

    chunkingRequests.current.add(version.id);
    setChunkingVersionIds((current) => [...current, version.id]);
    setMessage("Solicitando la generación de conocimiento…");
    const chunking = await supabase.functions.invoke("process-knowledge-chunks", {
      body: { version_id: version.id },
    });
    if (chunking.error) {
      finishChunkingRequest(version.id);
      setMessage("No se pudo iniciar la generación de conocimiento. Comprueba tu sesión y tus permisos.");
      return;
    }

    setMessage("Solicitud aceptada. Esperando el resultado del conocimiento…");
    pollChunking(version.id);
  }

  return <Page className="space-y-6">
    <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"><div><p className="text-xs uppercase tracking-[0.3em] text-zinc-500">Conocimiento empresarial</p><h1 className="mt-2 text-3xl font-semibold text-white">Cerebro ORVESEN</h1><p className="mt-2 text-zinc-400">Documentos versionados, organizados y listos para el equipo.</p></div>{canManageUsers && <button onClick={() => { setVersionTarget(null); setFiles([]); setQueue([]); setMetadata(emptyMetadata); setUploadOpen(true); }} className="flex items-center justify-center gap-2 rounded-xl bg-white px-5 py-3 font-medium text-black"><Upload size={18}/> Carga masiva</button>}</div>
    {message && <div className="rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-3 text-sm text-zinc-200">{message}</div>}
    <Card hover={false} contentClassName="p-3"><div className="grid gap-3 lg:grid-cols-[1fr_180px_180px_200px]"><label className="flex items-center gap-3 rounded-xl border border-zinc-800 bg-zinc-950 px-4"><Search size={18} className="text-zinc-500"/><input value={search} onChange={(e)=>setSearch(e.target.value)} className="min-w-0 flex-1 bg-transparent py-4 text-sm text-white outline-none" placeholder="Buscar por nombre, etiqueta o categoría"/></label><select className="field" value={type} onChange={(e)=>setType(e.target.value)}><option value="all">Todos los tipos</option>{Object.entries(typeLabels).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select><select className="field" value={status} onChange={(e)=>setStatus(e.target.value)}><option value="all">Todos los estados</option>{Object.entries(statusLabels).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select><select className="field" value={folderId} onChange={(e)=>setFolderId(e.target.value)}><option value="all">Todas las carpetas</option>{folders.map((folder)=><option key={folder.id} value={folder.id}>{folder.name}</option>)}</select></div></Card>
    {!filtered.length ? <Card hover={false} contentClassName="py-16 text-center"><BookOpen className="mx-auto text-zinc-600" size={42}/><h2 className="mt-4 font-semibold text-white">El Cerebro está listo</h2><p className="mt-2 text-sm text-zinc-400">Sube documentos o una carpeta completa para comenzar.</p></Card> : <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{filtered.map((document) => {
      const version = latestVersion(document);
      const extractionBusy = processingVersionIds.includes(version.id);
      const extractionLabel = extractionBusy && version.extraction_status === "pending"
        ? "Pendiente · solicitud enviada"
        : extractionLabels[version.extraction_status] || version.extraction_status;
      const chunkingBusy = chunkingVersionIds.includes(version.id);
      const chunkingLabel = chunkingBusy && version.chunking_status === "pending"
        ? "Pendiente · solicitud enviada"
        : chunkingLabels[version.chunking_status] || version.chunking_status;
      return <Card key={document.id} hover={false} contentClassName="flex h-full flex-col p-5"><div className="flex items-center justify-between"><span className="rounded-full border border-zinc-700 px-3 py-1 text-xs text-zinc-300">{statusLabels[version.status]}</span><FileText size={20}/></div><h2 className="mt-4 text-lg font-semibold text-white">{document.title}</h2><p className="mt-2 text-xs uppercase tracking-wider text-zinc-500">{document.divisions?.name || "General"} · última v{version.version_number}{document.current_version ? ` · vigente v${document.current_version.version_number}` : ""}</p><p className="mt-3 flex-1 text-sm text-zinc-400">{document.category || typeLabels[document.document_type]}{document.knowledge_folders?.name ? ` · ${document.knowledge_folders.name}` : ""}</p><div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs"><span className="text-zinc-500">Procesamiento: {extractionLabel}</span>{version.extraction_status === "pending" && canManageUsers && <button disabled={extractionBusy} onClick={() => requestExtraction(document)} className="flex items-center gap-1 text-emerald-300 disabled:cursor-wait disabled:text-zinc-500"><Play size={13}/> {extractionBusy ? "Solicitado" : "Procesar"}</button>}{version.extraction_status === "failed" && canManageUsers && <button disabled={extractionBusy} onClick={() => requestExtraction(document, true)} className="flex items-center gap-1 text-amber-300 disabled:cursor-wait disabled:text-zinc-500"><RefreshCw className={extractionBusy ? "animate-spin" : ""} size={13}/> {extractionBusy ? "Reintentando" : "Reintentar"}</button>}</div>{version.extraction_status === "completed" && <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs"><span className="text-zinc-500">Conocimiento: {chunkingLabel}</span>{version.chunking_status === "pending" && canManageUsers && <button disabled={chunkingBusy} onClick={() => requestChunking(document)} className="flex items-center gap-1 text-emerald-300 disabled:cursor-wait disabled:text-zinc-500"><BookOpen size={13}/> {chunkingBusy ? "Solicitado" : "Generar conocimiento"}</button>}</div>}<div className="mt-4 flex justify-between"><button onClick={()=>openDocument(document)} className="flex items-center gap-2 rounded-lg border border-zinc-700 px-3 py-2 text-sm"><Download size={16}/> Abrir</button>{canManageUsers&&<div className="flex gap-2"><button onClick={()=>beginNewVersion(document)} className="calendar-icon-button" aria-label="Subir nueva versión"><Upload size={16}/></button><button onClick={()=>beginEdit(document)} className="calendar-icon-button" aria-label="Editar documento"><Pencil size={16}/></button><button onClick={()=>archiveDocument(document)} className="calendar-icon-button" aria-label="Archivar versión"><Archive size={16}/></button></div>}</div></Card>;
    })}</div>}
    {uploadOpen && <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 p-3"><Card hover={false} className="w-full max-w-3xl" contentClassName="max-h-[92vh] overflow-y-auto p-5"><div className="flex justify-between"><div><h2 className="text-xl font-semibold text-white">{versionTarget ? "Nueva versión" : "Carga masiva"}</h2><p className="mt-1 text-sm text-zinc-400">{versionTarget ? `El archivo anterior de ${versionTarget.title} permanecerá en el historial.` : "Hasta cientos de archivos, con cuatro cargas paralelas y tres reintentos."}</p></div><button onClick={()=>{setUploadOpen(false);setVersionTarget(null);}} className="calendar-icon-button"><X size={18}/></button></div>
      <div onDragOver={(e)=>e.preventDefault()} onDrop={(e)=>{e.preventDefault();addFiles(e.dataTransfer.files);}} className="mt-5 rounded-2xl border border-dashed border-zinc-700 p-7 text-center"><FolderUp className="mx-auto text-zinc-500"/><p className="mt-3 text-sm text-zinc-300">Arrastra {versionTarget ? "un archivo" : "archivos"} aquí</p><div className="mt-4 flex flex-wrap justify-center gap-2"><label className="cursor-pointer rounded-xl bg-white px-4 py-2 text-sm font-medium text-black">Seleccionar {versionTarget ? "archivo" : "archivos"}<input hidden multiple={!versionTarget} type="file" onChange={(e)=>addFiles(e.target.files)}/></label>{!versionTarget && <label className="cursor-pointer rounded-xl border border-zinc-700 px-4 py-2 text-sm text-white">Seleccionar carpeta<input hidden multiple type="file" webkitdirectory="" directory="" onChange={(e)=>addFiles(e.target.files)}/></label>}</div><p className="mt-3 text-xs text-zinc-500">{files.length} archivo(s) seleccionados</p></div>
      {!versionTarget && <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3"><Field label="Biblioteca o carpeta"><select className="field" value={metadata.folder_id} onChange={(e)=>setMetadata({...metadata,folder_id:e.target.value})}><option value="">Raíz del Cerebro</option>{folders.map((folder)=><option key={folder.id} value={folder.id}>{folder.name}</option>)}</select></Field><Field label="División"><select className="field" value={metadata.division_id} onChange={(e)=>setMetadata({...metadata,division_id:e.target.value})}><option value="">General</option>{divisions.map((division)=><option key={division.id} value={division.id}>{division.name}</option>)}</select></Field><Field label="Tipo"><select className="field" value={metadata.document_type} onChange={(e)=>setMetadata({...metadata,document_type:e.target.value})}>{Object.entries(typeLabels).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></Field><Field label="Categoría"><input className="field" value={metadata.category} onChange={(e)=>setMetadata({...metadata,category:e.target.value})}/></Field><Field label="Etiquetas (separadas por coma)"><input className="field" value={metadata.tags} onChange={(e)=>setMetadata({...metadata,tags:e.target.value})}/></Field></div>}
      {!!queue.length && <div className="mt-5 max-h-52 space-y-2 overflow-y-auto">{queue.map((item)=><div key={item.id} className="rounded-xl bg-zinc-900 p-3"><div className="flex justify-between gap-3 text-xs"><span className="truncate text-zinc-300">{item.file.name}</span><span className="text-zinc-500">{item.state} · {item.progress}%</span></div><div className="mt-2 h-1.5 rounded bg-zinc-800"><div className="h-full rounded bg-white" style={{width:`${item.progress}%`}}/></div>{item.error&&<p className="mt-1 text-xs text-red-400">{item.error}</p>}</div>)}</div>}
      <div className="mt-6 flex justify-end gap-3">{uploading&&<button onClick={cancelUploads} className="flex items-center gap-2 rounded-xl border border-zinc-700 px-4 py-3 text-sm"><Pause size={16}/> Cancelar</button>}<button disabled={uploading||!files.length} onClick={startUpload} className="rounded-xl bg-white px-5 py-3 font-medium text-black disabled:opacity-50">{uploading?"Procesando lote…":"Subir lote"}</button></div>
    </Card></div>}
    {editingDocument && editForm && <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 p-3"><Card hover={false} className="w-full max-w-2xl" contentClassName="max-h-[92vh] overflow-y-auto p-5"><div className="flex items-start justify-between"><div><h2 className="text-xl font-semibold text-white">Editar documento</h2><p className="mt-1 text-sm text-zinc-400">Actualiza su información y administra el estado de la última versión.</p></div><button onClick={()=>{setEditingDocument(null);setEditForm(null);}} className="calendar-icon-button"><X size={18}/></button></div><div className="mt-5 grid gap-4 sm:grid-cols-2"><Field label="Título"><input className="field" value={editForm.title} onChange={(e)=>setEditForm({...editForm,title:e.target.value})}/></Field><Field label="Carpeta"><select className="field" value={editForm.folder_id} onChange={(e)=>setEditForm({...editForm,folder_id:e.target.value})}><option value="">Raíz del Cerebro</option>{folders.map((folder)=><option key={folder.id} value={folder.id}>{folder.name}</option>)}</select></Field><div className="sm:col-span-2"><Field label="Descripción"><textarea rows="3" className="field resize-none" value={editForm.description} onChange={(e)=>setEditForm({...editForm,description:e.target.value})}/></Field></div><Field label="División"><select className="field" value={editForm.division_id} onChange={(e)=>setEditForm({...editForm,division_id:e.target.value})}><option value="">General</option>{divisions.map((division)=><option key={division.id} value={division.id}>{division.name}</option>)}</select></Field><Field label="Tipo"><select className="field" value={editForm.document_type} onChange={(e)=>setEditForm({...editForm,document_type:e.target.value})}>{Object.entries(typeLabels).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></Field><Field label="Estado"><select className="field" value={editForm.status} onChange={(e)=>setEditForm({...editForm,status:e.target.value})}>{allowedStatusTargets(editForm.originalStatus).map((key)=><option key={key} value={key}>{statusLabels[key]}</option>)}</select></Field><Field label="Categoría"><input className="field" value={editForm.category} onChange={(e)=>setEditForm({...editForm,category:e.target.value})}/></Field><Field label="Etiquetas"><input className="field" value={editForm.tags} onChange={(e)=>setEditForm({...editForm,tags:e.target.value})}/></Field></div><div className="mt-6 flex justify-end gap-3"><button onClick={()=>{setEditingDocument(null);setEditForm(null);}} className="rounded-xl border border-zinc-700 px-5 py-3 text-sm text-zinc-200">Cancelar</button><button onClick={saveDocument} className="rounded-xl bg-white px-5 py-3 font-medium text-black">Guardar cambios</button></div></Card></div>}
  </Page>;
}

function Field({label,children}) { return <label><span className="mb-2 block text-sm text-zinc-400">{label}</span>{children}</label>; }

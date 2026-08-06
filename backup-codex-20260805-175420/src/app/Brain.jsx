import { useEffect, useMemo, useRef, useState } from "react";
import { BookOpen, Download, FileText, Folder, FolderUp, Pause, Search, Trash2, Upload, X } from "lucide-react";

import Page from "../components/ui/Page";
import Card from "../components/ui/Card";
import { useAuth } from "../Context/AuthContext";
import { useDivisions } from "../hooks/useDivisions";
import { supabase } from "../lib/supabase";

const typeLabels = { sop: "SOP", playbook: "Playbook", policy: "Política", template: "Plantilla", reference: "Referencia" };
const statusLabels = { draft: "Borrador", review: "En revisión", approved: "Aprobado", archived: "Archivado" };
const emptyMetadata = { document_type: "reference", status: "draft", division_id: "", category: "", version: 1, tags: "" };

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
  const aborters = useRef(new Map());

  async function loadLibrary() {
    if (!profile?.organization_id) return;
    const [documentsResult, foldersResult] = await Promise.all([
      supabase.from("knowledge_documents").select("*, divisions(name), knowledge_folders(name)").eq("organization_id", profile.organization_id).order("created_at", { ascending: false }),
      supabase.from("knowledge_folders").select("id, parent_id, name").eq("organization_id", profile.organization_id).order("name"),
    ]);
    const error = documentsResult.error || foldersResult.error;
    if (error) return setMessage(error.message);
    setDocuments(documentsResult.data || []);
    setFolders(foldersResult.data || []);
  }

  useEffect(() => { loadLibrary(); }, [profile?.organization_id]);

  const filtered = useMemo(() => documents.filter((document) => {
    const haystack = `${document.title} ${document.description || ""} ${document.category || ""} ${(document.tags || []).join(" ")} ${document.divisions?.name || ""}`.toLowerCase();
    return (type === "all" || document.document_type === type)
      && (status === "all" || document.status === status)
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

  async function ensureFolder(relativePath, cache) {
    const parts = relativePath.split("/").slice(0, -1).filter(Boolean);
    let parentId = null;
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
    const linkedFolderId = await ensureFolder(relativePath, folderCache);
    const safeName = item.file.name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9._-]+/g, "-");
    const objectPath = `${profile.organization_id}/${crypto.randomUUID()}-${safeName}`;
    const encodedPath = objectPath.split("/").map(encodeURIComponent).join("/");
    const url = `${import.meta.env.VITE_SUPABASE_URL}/storage/v1/object/knowledge-base/${encodedPath}`;

    await new Promise((resolve, reject) => {
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

    const title = item.file.name.replace(/\.[^.]+$/, "");
    const saved = await supabase.from("knowledge_documents").insert({
      organization_id: profile.organization_id, uploaded_by: user.id, title,
      document_type: metadata.document_type, division_id: metadata.division_id || null,
      folder_id: linkedFolderId, category: metadata.category.trim() || null,
      file_path: objectPath, file_name: item.file.name, mime_type: item.file.type || null,
      file_size: item.file.size, status: metadata.status, version: Number(metadata.version) || 1,
      tags: metadata.tags.split(",").map((tag) => tag.trim()).filter(Boolean), author_name: profile.first_name || user.email,
    });
    if (saved.error) {
      await supabase.storage.from("knowledge-base").remove([objectPath]);
      throw saved.error;
    }
  }

  async function startUpload() {
    if (!files.length) return setMessage("Selecciona uno o más archivos.");
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
    await loadLibrary();
  }

  function cancelUploads() { aborters.current.forEach((request) => request.abort()); aborters.current.clear(); }
  async function openDocument(document) { const { data, error } = await supabase.storage.from("knowledge-base").createSignedUrl(document.file_path, 60); if (error) return setMessage(error.message); window.open(data.signedUrl, "_blank", "noopener,noreferrer"); }
  async function deleteDocument(document) { if (!window.confirm(`¿Eliminar ${document.title}?`)) return; const storage = await supabase.storage.from("knowledge-base").remove([document.file_path]); if (storage.error) return setMessage(storage.error.message); const result = await supabase.from("knowledge_documents").delete().eq("id", document.id); if (result.error) return setMessage(result.error.message); await loadLibrary(); }

  return <Page className="space-y-6">
    <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"><div><p className="text-xs uppercase tracking-[0.3em] text-zinc-500">Conocimiento empresarial</p><h1 className="mt-2 text-3xl font-semibold text-white">Cerebro ORVESEN</h1><p className="mt-2 text-zinc-400">Documentos versionados, organizados y listos para el equipo.</p></div>{canManageUsers && <button onClick={() => setUploadOpen(true)} className="flex items-center justify-center gap-2 rounded-xl bg-white px-5 py-3 font-medium text-black"><Upload size={18}/> Carga masiva</button>}</div>
    {message && <div className="rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-3 text-sm text-zinc-200">{message}</div>}
    <Card hover={false} contentClassName="p-3"><div className="grid gap-3 lg:grid-cols-[1fr_180px_180px_200px]"><label className="flex items-center gap-3 rounded-xl border border-zinc-800 bg-zinc-950 px-4"><Search size={18} className="text-zinc-500"/><input value={search} onChange={(e)=>setSearch(e.target.value)} className="min-w-0 flex-1 bg-transparent py-4 text-sm text-white outline-none" placeholder="Buscar por nombre, etiqueta o categoría"/></label><select className="field" value={type} onChange={(e)=>setType(e.target.value)}><option value="all">Todos los tipos</option>{Object.entries(typeLabels).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select><select className="field" value={status} onChange={(e)=>setStatus(e.target.value)}><option value="all">Todos los estados</option>{Object.entries(statusLabels).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select><select className="field" value={folderId} onChange={(e)=>setFolderId(e.target.value)}><option value="all">Todas las carpetas</option>{folders.map((folder)=><option key={folder.id} value={folder.id}>{folder.name}</option>)}</select></div></Card>
    {!filtered.length ? <Card hover={false} contentClassName="py-16 text-center"><BookOpen className="mx-auto text-zinc-600" size={42}/><h2 className="mt-4 font-semibold text-white">El Cerebro está listo</h2><p className="mt-2 text-sm text-zinc-400">Sube documentos o una carpeta completa para comenzar.</p></Card> : <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{filtered.map((document)=><Card key={document.id} hover={false} contentClassName="flex h-full flex-col p-5"><div className="flex items-center justify-between"><span className="rounded-full border border-zinc-700 px-3 py-1 text-xs text-zinc-300">{statusLabels[document.status]}</span><FileText size={20}/></div><h2 className="mt-4 text-lg font-semibold text-white">{document.title}</h2><p className="mt-2 text-xs uppercase tracking-wider text-zinc-500">{document.divisions?.name || "General"} · v{document.version}</p><p className="mt-3 flex-1 text-sm text-zinc-400">{document.category || typeLabels[document.document_type]}{document.knowledge_folders?.name ? ` · ${document.knowledge_folders.name}` : ""}</p><div className="mt-4 flex justify-between"><button onClick={()=>openDocument(document)} className="flex items-center gap-2 rounded-lg border border-zinc-700 px-3 py-2 text-sm"><Download size={16}/> Abrir</button>{canManageUsers&&<button onClick={()=>deleteDocument(document)} className="calendar-icon-button"><Trash2 size={16}/></button>}</div></Card>)}</div>}
    {uploadOpen && <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 p-3"><Card hover={false} className="w-full max-w-3xl" contentClassName="max-h-[92vh] overflow-y-auto p-5"><div className="flex justify-between"><div><h2 className="text-xl font-semibold text-white">Carga masiva</h2><p className="mt-1 text-sm text-zinc-400">Hasta cientos de archivos, con cuatro cargas paralelas y tres reintentos.</p></div><button onClick={()=>setUploadOpen(false)} className="calendar-icon-button"><X size={18}/></button></div>
      <div onDragOver={(e)=>e.preventDefault()} onDrop={(e)=>{e.preventDefault();addFiles(e.dataTransfer.files);}} className="mt-5 rounded-2xl border border-dashed border-zinc-700 p-7 text-center"><FolderUp className="mx-auto text-zinc-500"/><p className="mt-3 text-sm text-zinc-300">Arrastra archivos aquí</p><div className="mt-4 flex flex-wrap justify-center gap-2"><label className="cursor-pointer rounded-xl bg-white px-4 py-2 text-sm font-medium text-black">Seleccionar archivos<input hidden multiple type="file" onChange={(e)=>addFiles(e.target.files)}/></label><label className="cursor-pointer rounded-xl border border-zinc-700 px-4 py-2 text-sm text-white">Seleccionar carpeta<input hidden multiple type="file" webkitdirectory="" directory="" onChange={(e)=>addFiles(e.target.files)}/></label></div><p className="mt-3 text-xs text-zinc-500">{files.length} archivo(s) seleccionados</p></div>
      <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3"><Field label="División"><select className="field" value={metadata.division_id} onChange={(e)=>setMetadata({...metadata,division_id:e.target.value})}><option value="">General</option>{divisions.map((division)=><option key={division.id} value={division.id}>{division.name}</option>)}</select></Field><Field label="Tipo"><select className="field" value={metadata.document_type} onChange={(e)=>setMetadata({...metadata,document_type:e.target.value})}>{Object.entries(typeLabels).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></Field><Field label="Estado"><select className="field" value={metadata.status} onChange={(e)=>setMetadata({...metadata,status:e.target.value})}>{Object.entries(statusLabels).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></Field><Field label="Categoría"><input className="field" value={metadata.category} onChange={(e)=>setMetadata({...metadata,category:e.target.value})}/></Field><Field label="Versión"><input className="field" min="1" type="number" value={metadata.version} onChange={(e)=>setMetadata({...metadata,version:e.target.value})}/></Field><Field label="Etiquetas (separadas por coma)"><input className="field" value={metadata.tags} onChange={(e)=>setMetadata({...metadata,tags:e.target.value})}/></Field></div>
      {!!queue.length && <div className="mt-5 max-h-52 space-y-2 overflow-y-auto">{queue.map((item)=><div key={item.id} className="rounded-xl bg-zinc-900 p-3"><div className="flex justify-between gap-3 text-xs"><span className="truncate text-zinc-300">{item.file.name}</span><span className="text-zinc-500">{item.state} · {item.progress}%</span></div><div className="mt-2 h-1.5 rounded bg-zinc-800"><div className="h-full rounded bg-white" style={{width:`${item.progress}%`}}/></div>{item.error&&<p className="mt-1 text-xs text-red-400">{item.error}</p>}</div>)}</div>}
      <div className="mt-6 flex justify-end gap-3">{uploading&&<button onClick={cancelUploads} className="flex items-center gap-2 rounded-xl border border-zinc-700 px-4 py-3 text-sm"><Pause size={16}/> Cancelar</button>}<button disabled={uploading||!files.length} onClick={startUpload} className="rounded-xl bg-white px-5 py-3 font-medium text-black disabled:opacity-50">{uploading?"Procesando lote…":"Subir lote"}</button></div>
    </Card></div>}
  </Page>;
}

function Field({label,children}) { return <label><span className="mb-2 block text-sm text-zinc-400">{label}</span>{children}</label>; }

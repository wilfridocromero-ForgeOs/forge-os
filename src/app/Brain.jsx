import { useEffect, useMemo, useState } from "react";
import { BookOpen, Download, FileText, Plus, Search, Trash2, Upload, X } from "lucide-react";

import Page from "../components/ui/Page";
import Card from "../components/ui/Card";
import { useAuth } from "../Context/AuthContext";
import { supabase } from "../lib/supabase";

const typeLabels = { sop: "SOP", playbook: "Playbook", policy: "Política", template: "Plantilla", reference: "Referencia" };

export default function Brain() {
  const { profile, user, canManageUsers } = useAuth();
  const [documents, setDocuments] = useState([]);
  const [search, setSearch] = useState("");
  const [type, setType] = useState("all");
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState("");
  const [form, setForm] = useState({ title: "", document_type: "sop", division: "", description: "", file: null });

  async function loadDocuments() {
    if (!profile?.organization_id) return;
    const { data, error } = await supabase.from("knowledge_documents").select("*").eq("organization_id", profile.organization_id).order("created_at", { ascending: false });
    if (error) return setMessage(error.message);
    setDocuments(data || []);
  }

  useEffect(() => { loadDocuments(); }, [profile?.organization_id]);

  const filtered = useMemo(() => documents.filter((document) => {
    const matchesType = type === "all" || document.document_type === type;
    const haystack = `${document.title} ${document.description || ""} ${document.division || ""}`.toLowerCase();
    return matchesType && haystack.includes(search.toLowerCase());
  }), [documents, search, type]);

  async function uploadDocument(event) {
    event.preventDefault();
    if (!form.file || !profile?.organization_id) return setMessage("Selecciona un archivo.");
    setUploading(true);
    setMessage("");
    const safeName = form.file.name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9._-]+/g, "-");
    const filePath = `${profile.organization_id}/${crypto.randomUUID()}-${safeName}`;
    const { error: uploadError } = await supabase.storage.from("knowledge-base").upload(filePath, form.file, { contentType: form.file.type || undefined });
    if (uploadError) { setUploading(false); return setMessage(uploadError.message); }
    const { error: metadataError } = await supabase.from("knowledge_documents").insert({
      organization_id: profile.organization_id,
      uploaded_by: user.id,
      title: form.title.trim(),
      document_type: form.document_type,
      division: form.division.trim() || null,
      description: form.description.trim() || null,
      file_path: filePath,
      file_name: form.file.name,
      mime_type: form.file.type || null,
      file_size: form.file.size,
    });
    if (metadataError) {
      await supabase.storage.from("knowledge-base").remove([filePath]);
      setUploading(false);
      return setMessage(metadataError.message);
    }
    setUploading(false);
    setUploadOpen(false);
    setForm({ title: "", document_type: "sop", division: "", description: "", file: null });
    setMessage("Documento añadido al Cerebro ORVESEN.");
    await loadDocuments();
  }

  async function openDocument(document) {
    const { data, error } = await supabase.storage.from("knowledge-base").createSignedUrl(document.file_path, 60);
    if (error) return setMessage(error.message);
    window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  }

  async function deleteDocument(document) {
    const { error: storageError } = await supabase.storage.from("knowledge-base").remove([document.file_path]);
    if (storageError) return setMessage(storageError.message);
    const { error } = await supabase.from("knowledge_documents").delete().eq("id", document.id);
    if (error) return setMessage(error.message);
    setMessage("Documento eliminado.");
    await loadDocuments();
  }

  return (
    <Page className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"><div><p className="text-xs uppercase tracking-[0.3em] text-zinc-500">Conocimiento interno</p><h1 className="mt-2 text-3xl font-semibold text-white">Cerebro ORVESEN</h1><p className="mt-2 text-zinc-400">La biblioteca central de SOP, playbooks, políticas y recursos del equipo.</p></div>{canManageUsers && <button onClick={() => setUploadOpen(true)} className="flex items-center justify-center gap-2 rounded-xl bg-white px-5 py-3 font-medium text-black"><Upload size={18} /> Añadir documento</button>}</div>
      {message && <div className="rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-3 text-sm text-zinc-200">{message}</div>}

      <Card hover={false} contentClassName="p-4 sm:p-5"><div className="grid gap-3 md:grid-cols-[1fr_220px]"><label className="relative"><Search className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-500" size={18} /><input value={search} onChange={(event) => setSearch(event.target.value)} className="field pl-11" placeholder="Buscar documentos, divisiones o temas..." /></label><select value={type} onChange={(event) => setType(event.target.value)} className="field"><option value="all">Todos los documentos</option>{Object.entries(typeLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></div></Card>

      {!filtered.length ? <Card hover={false} contentClassName="py-16 text-center"><BookOpen className="mx-auto text-zinc-600" size={42} /><h2 className="mt-4 font-semibold text-white">El Cerebro está listo</h2><p className="mt-2 text-sm text-zinc-400">Añade el primer SOP o playbook para comenzar a construir el conocimiento de ORVESEN.</p></Card> : <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{filtered.map((document) => <Card key={document.id} hover={false} contentClassName="flex h-full flex-col p-5"><div className="flex items-start justify-between gap-3"><span className="rounded-full border border-zinc-700 px-3 py-1 text-xs text-zinc-400">{typeLabels[document.document_type]}</span><FileText size={20} className="text-zinc-500" /></div><h2 className="mt-5 text-lg font-semibold text-white">{document.title}</h2>{document.division && <p className="mt-2 text-xs uppercase tracking-wider text-zinc-500">{document.division}</p>}<p className="mt-3 line-clamp-3 flex-1 text-sm leading-6 text-zinc-400">{document.description || document.file_name}</p><div className="mt-5 flex items-center justify-between gap-2"><button onClick={() => openDocument(document)} className="flex items-center gap-2 rounded-lg border border-zinc-700 px-3 py-2 text-sm text-zinc-200"><Download size={16} /> Abrir</button>{canManageUsers && <button onClick={() => deleteDocument(document)} className="calendar-icon-button" title="Eliminar"><Trash2 size={17} /></button>}</div></Card>)}</div>}

      {uploadOpen && <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/65 p-4 backdrop-blur-sm"><Card hover={false} className="w-full max-w-2xl" contentClassName="max-h-[90vh] overflow-y-auto p-6"><form onSubmit={uploadDocument}><div className="flex items-start justify-between"><div><h2 className="text-xl font-semibold text-white">Añadir conocimiento</h2><p className="mt-1 text-sm text-zinc-400">Sube un documento y clasifícalo para encontrarlo rápidamente.</p></div><button type="button" onClick={() => setUploadOpen(false)} className="calendar-icon-button"><X size={19} /></button></div><div className="mt-6 grid gap-4 md:grid-cols-2"><Field label="Título"><input required minLength="2" value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} className="field" /></Field><Field label="Tipo"><select value={form.document_type} onChange={(event) => setForm({ ...form, document_type: event.target.value })} className="field">{Object.entries(typeLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></Field><Field label="División"><input value={form.division} onChange={(event) => setForm({ ...form, division: event.target.value })} className="field" placeholder="Ej. Marketing" /></Field><Field label="Archivo"><input required type="file" accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.md" onChange={(event) => setForm({ ...form, file: event.target.files?.[0] || null })} className="field" /></Field><label className="md:col-span-2"><span className="mb-2 block text-sm text-zinc-400">Descripción</span><textarea rows="4" value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} className="field" /></label></div><div className="mt-6 flex justify-end"><button disabled={uploading} className="flex items-center gap-2 rounded-xl bg-white px-5 py-3 font-medium text-black disabled:opacity-60"><Plus size={18} /> {uploading ? "Subiendo..." : "Guardar documento"}</button></div></form></Card></div>}
    </Page>
  );
}

function Field({ label, children }) {
  return <label><span className="mb-2 block text-sm text-zinc-400">{label}</span>{children}</label>;
}

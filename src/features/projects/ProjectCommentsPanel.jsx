import { useCallback, useEffect, useMemo, useState } from "react";
import { CornerDownRight, Edit3, MessageSquare, Trash2, X } from "lucide-react";
import Button from "../../components/ui/Button";
import { createProjectComment, deleteProjectComment, getProjectComments, updateProjectComment } from "../../services/ProjectService";

const MAX_LENGTH = 5000;

export default function ProjectCommentsPanel({ projectId, userId, canComment, canModerate }) {
  const [comments, setComments] = useState([]);
  const [body, setBody] = useState("");
  const [replyTo, setReplyTo] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [editingBody, setEditingBody] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try { setComments(await getProjectComments(projectId)); }
    catch (reason) { setError(reason.message || "No se pudieron cargar los comentarios."); }
    finally { setLoading(false); }
  }, [projectId]);

  // The callback synchronizes the panel with Supabase when the selected project changes.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);

  const threads = useMemo(() => comments.filter((item) => !item.parent_id).map((root) => ({
    root,
    replies: comments.filter((item) => item.parent_id === root.id),
  })), [comments]);

  async function publish(event) {
    event.preventDefault();
    const clean = body.trim();
    if (!clean || saving) return;
    setSaving(true); setError("");
    try {
      await createProjectComment(projectId, clean, userId, replyTo?.id || null);
      setBody(""); setReplyTo(null); await load();
    } catch (reason) { setError(reason.message || "No se pudo publicar el comentario."); }
    finally { setSaving(false); }
  }

  async function saveEdit(commentId) {
    const clean = editingBody.trim();
    if (!clean || saving) return;
    setSaving(true); setError("");
    try { await updateProjectComment(commentId, clean); setEditingId(null); setEditingBody(""); await load(); }
    catch (reason) { setError(reason.message || "No se pudo editar el comentario."); }
    finally { setSaving(false); }
  }

  async function remove(comment) {
    if (!window.confirm("¿Eliminar este comentario? Las respuestas permanecerán visibles.")) return;
    setSaving(true); setError("");
    try { await deleteProjectComment(comment.id); await load(); }
    catch (reason) { setError(reason.message || "No se pudo eliminar el comentario."); }
    finally { setSaving(false); }
  }

  function keyboardSubmit(event) {
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") event.currentTarget.form?.requestSubmit();
  }

  return <section className="min-w-0 space-y-5">
    {canComment ? <form onSubmit={publish} className="min-w-0 rounded-2xl border border-zinc-800 bg-zinc-950/40 p-4">
      {replyTo && <div className="mb-3 flex min-w-0 items-center justify-between gap-3 rounded-xl bg-zinc-900 px-3 py-2 text-xs text-zinc-400"><span className="min-w-0 truncate">Respondiendo a {replyTo.author_name}</span><button type="button" aria-label="Cancelar respuesta" onClick={() => setReplyTo(null)}><X size={15} /></button></div>}
      <textarea aria-label="Escribir comentario" rows={4} maxLength={MAX_LENGTH} value={body} onChange={(event) => setBody(event.target.value)} onKeyDown={keyboardSubmit} placeholder="Escribe un comentario para el equipo…" className="w-full resize-y rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-3 text-sm text-white outline-none placeholder:text-zinc-600 focus:border-zinc-600" />
      <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"><span className="text-xs text-zinc-600">{body.length}/{MAX_LENGTH} · Ctrl/Cmd + Enter</span><Button type="submit" disabled={!body.trim() || saving}>{saving ? "Publicando…" : "Publicar"}</Button></div>
    </form> : <p className="rounded-xl border border-zinc-800 p-3 text-sm text-zinc-500">Puedes leer la conversación, pero tu rol no permite comentar.</p>}
    {error && <p className="rounded-xl border border-red-900/50 bg-red-950/20 p-3 text-sm text-red-300">{error}</p>}
    {loading ? <p className="text-sm text-zinc-500">Cargando comentarios…</p> : !threads.length ? <div className="rounded-2xl border border-dashed border-zinc-800 p-8 text-center"><MessageSquare className="mx-auto text-zinc-600" size={24} /><h3 className="mt-3 font-medium text-white">Sin comentarios todavía</h3><p className="mt-2 text-sm text-zinc-500">Inicia la conversación dentro del contexto del proyecto.</p></div> : <div className="space-y-4">{threads.map(({ root, replies }) => <article key={root.id} className="min-w-0 rounded-2xl border border-zinc-800 p-4">
      <Comment comment={root} userId={userId} canReply={canComment} canModerate={canModerate} saving={saving} editingId={editingId} editingBody={editingBody} onEditingBody={setEditingBody} onEdit={(item) => { setEditingId(item.id); setEditingBody(item.body || ""); }} onCancelEdit={() => setEditingId(null)} onSaveEdit={saveEdit} onDelete={remove} onReply={setReplyTo} />
      {replies.length > 0 && <div className="mt-4 space-y-3 border-l border-zinc-800 pl-3 sm:pl-5">{replies.map((reply) => <Comment key={reply.id} comment={reply} userId={userId} canReply={canComment} canModerate={canModerate} saving={saving} editingId={editingId} editingBody={editingBody} onEditingBody={setEditingBody} onEdit={(item) => { setEditingId(item.id); setEditingBody(item.body || ""); }} onCancelEdit={() => setEditingId(null)} onSaveEdit={saveEdit} onDelete={remove} onReply={() => setReplyTo(root)} />)}</div>}
    </article>)}</div>}
  </section>;
}

function Comment({ comment, userId, canReply, canModerate, saving, editingId, editingBody, onEditingBody, onEdit, onCancelEdit, onSaveEdit, onDelete, onReply }) {
  const own = comment.author_id === userId;
  const deleted = Boolean(comment.deleted_at);
  return <div className="min-w-0">
    <div className="flex min-w-0 flex-col gap-1 sm:flex-row sm:items-center sm:justify-between"><strong className="min-w-0 break-words text-sm text-white">{comment.author_name || "Usuario"}</strong><time className="shrink-0 text-xs text-zinc-600">{new Intl.DateTimeFormat("es", { dateStyle: "medium", timeStyle: "short" }).format(new Date(comment.created_at))}</time></div>
    {deleted ? <p className="mt-2 text-sm italic text-zinc-600">Comentario eliminado</p> : editingId === comment.id ? <div className="mt-3 space-y-2"><textarea rows={3} maxLength={MAX_LENGTH} value={editingBody} onChange={(event) => onEditingBody(event.target.value)} className="w-full rounded-xl border border-zinc-700 bg-zinc-950 p-3 text-sm text-white outline-none" /><div className="flex gap-2"><Button type="button" disabled={!editingBody.trim() || saving} onClick={() => onSaveEdit(comment.id)}>Guardar</Button><Button type="button" variant="ghost" onClick={onCancelEdit}>Cancelar</Button></div></div> : <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-zinc-300">{comment.body}</p>}
    {!deleted && <div className="mt-3 flex flex-wrap gap-3 text-xs text-zinc-500">{comment.edited_at && <span>(editado)</span>}{canReply && <button type="button" onClick={() => onReply(comment)} className="inline-flex items-center gap-1 hover:text-white"><CornerDownRight size={13} /> Responder</button>}{own && <button type="button" onClick={() => onEdit(comment)} className="inline-flex items-center gap-1 hover:text-white"><Edit3 size={13} /> Editar</button>}{(own || canModerate) && <button type="button" onClick={() => onDelete(comment)} className="inline-flex items-center gap-1 hover:text-red-300"><Trash2 size={13} /> Eliminar</button>}</div>}
  </div>;
}

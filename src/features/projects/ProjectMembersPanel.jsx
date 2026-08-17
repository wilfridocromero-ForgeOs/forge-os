import { useMemo, useState } from "react";
import { Plus, Trash2, UserRoundCheck } from "lucide-react";
import { addProjectMember, removeProjectMember, updateProjectMemberRole } from "../../services/ProjectService";

const roleLabels = { owner: "Propietario", member: "Miembro", observer: "Observador" };
const field = "min-w-0 rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2.5 text-sm text-white outline-none focus:border-zinc-600";

export default function ProjectMembersPanel({ projectId, members, organizationUsers, actorId, canManage, onChange }) {
  const [userId, setUserId] = useState("");
  const [role, setRole] = useState("member");
  const [error, setError] = useState("");
  const available = useMemo(() => organizationUsers.filter((user) => !members.some((member) => member.user_id === user.id)), [members, organizationUsers]);

  async function add(event) {
    event.preventDefault();
    if (!userId) return;
    try {
      setError("");
      const row = await addProjectMember(projectId, userId, role, actorId);
      onChange([...members, row]);
      setUserId("");
      setRole("member");
    } catch (reason) { setError(reason.message || "No se pudo añadir el miembro."); }
  }

  async function changeRole(member, nextRole) {
    try {
      setError("");
      const row = await updateProjectMemberRole(member.id, nextRole);
      onChange(members.map((item) => item.id === row.id ? row : item));
    } catch (reason) { setError(reason.message || "No se pudo actualizar el rol."); }
  }

  async function remove(member) {
    if (!window.confirm(`¿Quitar a ${member.user?.first_name || "este miembro"} del proyecto?`)) return;
    try {
      setError("");
      await removeProjectMember(member.id);
      onChange(members.filter((item) => item.id !== member.id));
    } catch (reason) { setError(reason.message || "No se pudo quitar el miembro."); }
  }

  return <section className="space-y-4">
    <div><h3 className="font-semibold text-white">Equipo del proyecto</h3><p className="mt-1 text-sm text-zinc-500">Roles operacionales independientes del rol organizacional.</p></div>
    {error && <p className="rounded-xl border border-red-900/50 bg-red-950/20 p-3 text-sm text-red-300">{error}</p>}
    {canManage && <form onSubmit={add} className="grid min-w-0 gap-2 rounded-2xl border border-zinc-800 p-3 sm:grid-cols-[minmax(0,1fr)_160px_auto]">
      <select aria-label="Usuario" value={userId} onChange={(event) => setUserId(event.target.value)} className={field}><option value="">Seleccionar persona</option>{available.map((user) => <option key={user.id} value={user.id}>{user.first_name || "Usuario"}{user.title ? ` · ${user.title}` : ""}</option>)}</select>
      <select aria-label="Rol del proyecto" value={role} onChange={(event) => setRole(event.target.value)} className={field}><option value="member">Miembro</option><option value="observer">Observador</option></select>
      <button type="submit" disabled={!userId} className="flex min-h-10 items-center justify-center gap-2 rounded-xl bg-white px-4 text-sm font-medium text-black disabled:opacity-40"><Plus size={16} /> Añadir</button>
    </form>}
    {!members.length && <div className="rounded-2xl border border-dashed border-zinc-800 p-8 text-center"><UserRoundCheck className="mx-auto text-zinc-600" size={24} /><p className="mt-3 text-sm text-zinc-500">Este proyecto todavía no tiene miembros.</p></div>}
    <div className="grid min-w-0 gap-3 sm:grid-cols-2">{members.map((member) => <article key={member.id} className="min-w-0 rounded-xl border border-zinc-800 p-4">
      <div className="flex min-w-0 items-start justify-between gap-3"><div className="min-w-0"><p className="truncate font-medium text-white">{member.user?.first_name || "Usuario"}</p><p className="mt-1 break-words text-xs text-zinc-500">{member.user?.title || member.user?.division || "Sin cargo"}</p></div>{member.role === "owner" && <span className="shrink-0 rounded-full bg-amber-950 px-2.5 py-1 text-xs text-amber-300">Owner</span>}</div>
      <div className="mt-4 flex min-w-0 items-center gap-2">{canManage && member.role !== "owner" ? <><select aria-label={`Rol de ${member.user?.first_name || "miembro"}`} value={member.role} onChange={(event) => changeRole(member, event.target.value)} className={`${field} flex-1`}><option value="member">Miembro</option><option value="observer">Observador</option></select><button type="button" onClick={() => remove(member)} aria-label="Quitar miembro" className="shrink-0 p-2 text-zinc-600 hover:text-red-300"><Trash2 size={16} /></button></> : <p className="text-sm text-zinc-400">{roleLabels[member.role]}</p>}</div>
    </article>)}</div>
  </section>;
}

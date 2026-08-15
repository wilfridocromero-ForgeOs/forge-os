import { ArrowLeft, Mail, Save, Shield, UserPlus, Users, X } from "lucide-react";
import { useEffect, useState } from "react";
import Card from "../../components/ui/Card";
import { useAuth } from "../../Context/AuthContext";
import { MEMBER_MODULES, getMemberAdministrationData, inviteOrganizationMember, updateMemberAccess, updateMemberProfile } from "../../services/MemberAdminService";

const ROLE_LABELS = { platform_owner: "Founder", organization_admin: "Propietario", area_lead: "Líder de área", member: "Miembro" };
const EDITABLE_ROLES = ["organization_admin", "area_lead", "member"];
const EMPTY_INVITE = { email: "", firstName: "", title: "Miembro del equipo", role: "member", division: "", jobPosition: "", specialty: "", moduleKeys: ["dashboard", "clients", "discovery"] };

export default function MembersSettings() {
  const { organization } = useAuth();
  const [data, setData] = useState(null);
  const [selectedId, setSelectedId] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [inviteOpen, setInviteOpen] = useState(false);

  async function load() {
    setLoading(true); setError("");
    try { setData(await getMemberAdministrationData(organization.id)); }
    catch (reason) { setError(reason.message); }
    finally { setLoading(false); }
  }

  useEffect(() => {
    let active = true;
    if (!organization?.id) return undefined;
    getMemberAdministrationData(organization.id)
      .then((result) => { if (active) setData(result); })
      .catch((reason) => { if (active) setError(reason.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [organization?.id]);
  const selected = data?.members.find((member) => member.id === selectedId);

  if (loading) return <StateCard text="Cargando miembros..." />;
  if (error) return <StateCard text={error} tone="error" action={load} />;

  return (
    <div className="min-w-0 space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div><p className="text-xs uppercase tracking-[0.3em] text-zinc-500">Configuración</p><h1 className="mt-2 text-3xl font-semibold text-white">Miembros</h1><p className="mt-2 text-zinc-400">Selecciona una persona para administrar su rol, división y accesos.</p></div>
        <button onClick={() => setInviteOpen(true)} className="inline-flex items-center justify-center gap-2 rounded-xl bg-white px-5 py-3 font-medium text-black"><Mail size={18} /> Invitar miembro</button>
      </div>
      {message && <div className="rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-3 text-sm text-zinc-200" role="status">{message}</div>}
      {inviteOpen && <InvitationForm data={data} organization={organization} onClose={() => setInviteOpen(false)} onSuccess={async (text) => { setMessage(text); setInviteOpen(false); await load(); }} />}

      <div className="grid min-w-0 gap-6 xl:grid-cols-[320px_minmax(0,1fr)]">
        <div className={selected ? "hidden xl:block" : "block"}>
          <MemberList members={data.members} invitations={data.invitations} selectedId={selectedId} onSelect={setSelectedId} />
        </div>
        <div className={!selected ? "hidden xl:block" : "min-w-0"}>
          {selected ? <MemberDetail key={selected.id} member={selected} data={data} onBack={() => setSelectedId("")} onSaved={async (text) => { setMessage(text); await load(); }} /> : <Card hover={false} contentClassName="flex min-h-[360px] items-center justify-center p-8 text-center"><div><Shield className="mx-auto text-zinc-600" size={36} /><p className="mt-4 text-zinc-400">Selecciona una persona para abrir su configuración.</p></div></Card>}
        </div>
      </div>
    </div>
  );
}

function MemberList({ members, invitations, selectedId, onSelect }) {
  return <div className="space-y-5"><Card hover={false} contentClassName="p-4"><div className="mb-3 flex items-center gap-2 px-2 text-sm font-medium text-zinc-300"><Users size={17} /> Miembros ({members.length})</div><div className="space-y-2">{members.map((member) => <button key={member.id} onClick={() => onSelect(member.id)} className={`flex w-full min-w-0 items-center gap-3 rounded-xl border px-3 py-3 text-left ${selectedId === member.id ? "border-zinc-500 bg-zinc-800" : "border-transparent bg-zinc-900/70 hover:border-zinc-700"}`}><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-zinc-800 font-semibold text-white">{(member.first_name || member.email || "U").charAt(0).toUpperCase()}</span><span className="min-w-0"><span className="block truncate font-medium text-white">{member.first_name || "Sin nombre"}</span><span className="block truncate text-xs text-zinc-500">{member.email}</span><span className="mt-1 block text-xs text-zinc-400">{ROLE_LABELS[member.role] || member.role} · {member.division || "Sin división"}</span></span></button>)}{!members.length && <p className="px-2 py-5 text-sm text-zinc-500">No hay miembros en esta organización.</p>}</div></Card>{invitations.length > 0 && <Card hover={false} contentClassName="p-4"><p className="px-2 text-sm font-medium text-zinc-300">Invitaciones pendientes ({invitations.length})</p><div className="mt-3 space-y-2">{invitations.map((invite) => <div key={invite.id} className="rounded-xl border border-dashed border-zinc-700 p-3"><p className="font-medium text-white">{invite.first_name}</p><p className="mt-1 break-all text-xs text-zinc-500">{invite.email}</p><p className="mt-2 text-xs text-amber-300">Pendiente · vence {formatDate(invite.expires_at)}</p></div>)}</div></Card>}</div>;
}

function MemberDetail({ member, data, onBack, onSaved }) {
  const protectedOwner = member.role === "platform_owner";
  const isLastOrganizationAdmin = member.role === "organization_admin" && data.members.filter((item) => item.role === "organization_admin").length === 1;
  const initialScoreIds = data.scoreAccess.filter((row) => row.user_id === member.id).map((row) => row.division_id);
  const initialModules = data.moduleAccess.filter((row) => row.user_id === member.id && row.enabled).map((row) => row.module_key);
  const [profile, setProfile] = useState({ firstName: member.first_name || "", title: member.title || "Miembro", role: member.role, division: member.division || "", jobPosition: member.job_position || "", specialty: member.specialty || "" });
  const [moduleKeys, setModuleKeys] = useState(initialModules);
  const [scoreIds, setScoreIds] = useState(initialScoreIds);
  const [saving, setSaving] = useState("");
  const [error, setError] = useState("");

  async function saveProfile(event) {
    event.preventDefault();
    if (!window.confirm(`Guardar cambios de identidad y rol para ${member.first_name || member.email}?`)) return;
    setSaving("profile"); setError("");
    try { await updateMemberProfile(member, profile); await onSaved("Perfil del miembro actualizado."); }
    catch (reason) { setError(reason.message); }
    finally { setSaving(""); }
  }
  async function saveAccess() {
    if (!window.confirm(`Aplicar los accesos seleccionados a ${member.first_name || member.email}?`)) return;
    setSaving("access"); setError("");
    try { await updateMemberAccess({ userId: member.id, moduleKeys, currentScoreIds: initialScoreIds, scoreIds }); await onSaved("Accesos del miembro actualizados."); }
    catch (reason) { setError(reason.message); }
    finally { setSaving(""); }
  }
  const toggle = (value, values, setter) => setter(values.includes(value) ? values.filter((item) => item !== value) : [...values, value]);

  return <div className="min-w-0 space-y-5"><button onClick={onBack} className="inline-flex items-center gap-2 text-sm text-zinc-400 hover:text-white xl:hidden"><ArrowLeft size={16} /> Volver a miembros</button>{protectedOwner && <div className="rounded-xl border border-amber-700/50 bg-amber-950/20 px-4 py-3 text-sm leading-6 text-amber-200">Este usuario es Founder global. Su rol y accesos están protegidos en esta fase para evitar una degradación accidental.</div>}{isLastOrganizationAdmin && !protectedOwner && <div className="rounded-xl border border-amber-700/50 bg-amber-950/20 px-4 py-3 text-sm leading-6 text-amber-200">Es el único Propietario de la organización. Su rol no puede degradarse hasta que exista otro Propietario.</div>}{error && <div className="rounded-xl border border-red-900 bg-red-950/20 px-4 py-3 text-sm text-red-300">{error}</div>}<Card hover={false} contentClassName="p-5 sm:p-6"><div className="flex min-w-0 items-center gap-4"><span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-zinc-800 text-lg font-semibold">{(member.first_name || member.email).charAt(0).toUpperCase()}</span><div className="min-w-0"><h2 className="truncate text-xl font-semibold text-white">{member.first_name || "Sin nombre"}</h2><p className="truncate text-sm text-zinc-400">{member.email}</p><p className="mt-1 text-xs text-zinc-500">{member.email_confirmed ? "Cuenta confirmada" : "Correo sin confirmar"}</p></div></div></Card><Card hover={false} contentClassName="p-5 sm:p-6"><form onSubmit={saveProfile}><h3 className="font-semibold text-white">Identidad organizacional</h3><div className="mt-5 grid gap-4 sm:grid-cols-2"><Field label="Nombre"><input className="field" value={profile.firstName} onChange={(event) => setProfile({ ...profile, firstName: event.target.value })} disabled={protectedOwner} required /></Field><Field label="Título visible"><input className="field" value={profile.title} onChange={(event) => setProfile({ ...profile, title: event.target.value })} disabled={protectedOwner} required /></Field><Field label="Rol"><select className="field" value={profile.role} onChange={(event) => setProfile({ ...profile, role: event.target.value })} disabled={protectedOwner || isLastOrganizationAdmin}>{EDITABLE_ROLES.map((role) => <option key={role} value={role}>{ROLE_LABELS[role]}</option>)}</select></Field><Field label="División principal"><select className="field" value={profile.division} onChange={(event) => setProfile({ ...profile, division: event.target.value })} disabled={protectedOwner}><option value="">Sin división</option>{data.divisions.filter((division) => division.active || division.name === profile.division).map((division) => <option key={division.id} value={division.name}>{division.name}{!division.active ? " (inactiva)" : ""}</option>)}</select></Field><Field label="Cargo profesional"><input className="field" value={profile.jobPosition} onChange={(event) => setProfile({ ...profile, jobPosition: event.target.value })} disabled={protectedOwner} /></Field><Field label="Especialidad"><input className="field" value={profile.specialty} onChange={(event) => setProfile({ ...profile, specialty: event.target.value })} disabled={protectedOwner} /></Field></div><button disabled={protectedOwner || saving === "profile"} className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-white px-5 py-3 font-medium text-black disabled:opacity-50 sm:w-auto"><Save size={17} /> {saving === "profile" ? "Guardando..." : "Guardar perfil"}</button></form></Card><Card hover={false} contentClassName="p-5 sm:p-6"><h3 className="font-semibold text-white">Accesos operativos</h3><p className="mt-2 text-sm leading-6 text-zinc-400">Estos accesos no otorgan capacidades administrativas.</p><AccessGroup title="Módulos" items={MEMBER_MODULES} selected={moduleKeys} onToggle={(id) => toggle(id, moduleKeys, setModuleKeys)} disabled={protectedOwner} /><AccessGroup title="Scores visibles" items={data.divisions.map((division) => ({ key: division.id, label: `${division.name}${division.active ? "" : " (inactiva)"}` }))} selected={scoreIds} onToggle={(id) => toggle(id, scoreIds, setScoreIds)} disabled={protectedOwner} empty="No hay divisiones." /><button type="button" onClick={saveAccess} disabled={protectedOwner || saving === "access"} className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-white px-5 py-3 font-medium text-black disabled:opacity-50 sm:w-auto"><Save size={17} /> {saving === "access" ? "Guardando..." : "Guardar accesos"}</button></Card></div>;
}

function InvitationForm({ data, organization, onClose, onSuccess }) {
  const [form, setForm] = useState(EMPTY_INVITE); const [sending, setSending] = useState(false); const [error, setError] = useState("");
  const activeDivisions = data.divisions.filter((division) => division.active);
  const toggleArray = (key, value) => setForm((current) => ({ ...current, [key]: current[key].includes(value) ? current[key].filter((item) => item !== value) : [...current[key], value] }));
  async function submit(event) { event.preventDefault(); setSending(true); setError(""); try { const result = await inviteOrganizationMember({ ...form, organizationId: organization.id }); await onSuccess(result?.message || "Invitación enviada correctamente."); } catch (reason) { setError(reason.message); } finally { setSending(false); } }
  return <Card hover={false} contentClassName="p-5 sm:p-6"><form onSubmit={submit}><div className="flex items-start justify-between gap-4"><div><h2 className="text-xl font-semibold text-white">Invitar miembro</h2><p className="mt-1 text-sm text-zinc-400">La invitación quedará pendiente hasta que la persona cree su acceso.</p></div><button type="button" onClick={onClose} className="rounded-lg p-2 text-zinc-400"><X size={20} /></button></div>{error && <p className="mt-4 text-sm text-red-300">{error}</p>}<div className="mt-6 grid gap-4 md:grid-cols-2"><Field label="Correo"><input required type="email" className="field" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} /></Field><Field label="Nombre"><input required minLength={2} maxLength={80} className="field" value={form.firstName} onChange={(event) => setForm({ ...form, firstName: event.target.value })} /></Field><Field label="Título visible"><input required minLength={2} maxLength={80} className="field" value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} /></Field><Field label="Rol"><select className="field" value={form.role} onChange={(event) => setForm({ ...form, role: event.target.value })}>{EDITABLE_ROLES.map((role) => <option key={role} value={role}>{ROLE_LABELS[role]}</option>)}</select></Field><Field label="División"><select className="field" value={form.division} onChange={(event) => setForm({ ...form, division: event.target.value })}><option value="">Sin división</option>{activeDivisions.map((division) => <option key={division.id} value={division.name}>{division.name}</option>)}</select></Field><Field label="Cargo profesional"><input className="field" value={form.jobPosition} onChange={(event) => setForm({ ...form, jobPosition: event.target.value })} /></Field><Field label="Especialidad"><input className="field" value={form.specialty} onChange={(event) => setForm({ ...form, specialty: event.target.value })} /></Field></div><AccessGroup title="Módulos iniciales" items={MEMBER_MODULES} selected={form.moduleKeys} onToggle={(id) => toggleArray("moduleKeys", id)} /><div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end"><button type="button" onClick={onClose} className="rounded-xl border border-zinc-700 px-5 py-3 text-zinc-300">Cancelar</button><button disabled={sending} className="inline-flex items-center justify-center gap-2 rounded-xl bg-white px-5 py-3 font-medium text-black disabled:opacity-50"><UserPlus size={17} /> {sending ? "Enviando..." : "Enviar invitación"}</button></div></form></Card>;
}

function AccessGroup({ title, items, selected, onToggle, disabled = false, empty = "" }) { return <fieldset className="mt-6" disabled={disabled}><legend className="mb-3 text-sm font-medium text-zinc-300">{title}</legend><div className="grid gap-2 sm:grid-cols-2">{items.map((item) => <label key={item.key} className="flex min-w-0 cursor-pointer items-center justify-between gap-3 rounded-xl border border-zinc-800 bg-zinc-900/60 px-4 py-3 text-sm text-zinc-200"><span className="min-w-0 break-words">{item.label}</span><input type="checkbox" checked={selected.includes(item.key)} onChange={() => onToggle(item.key)} /></label>)}{!items.length && <p className="text-sm text-zinc-500">{empty}</p>}</div></fieldset>; }
function Field({ label, children }) { return <label className="block min-w-0"><span className="mb-2 block text-sm text-zinc-400">{label}</span>{children}</label>; }
function StateCard({ text, tone, action }) { return <Card hover={false} contentClassName="p-8 text-center"><p className={tone === "error" ? "text-red-300" : "text-zinc-500"}>{text}</p>{action && <button onClick={action} className="mt-4 rounded-xl border border-zinc-700 px-4 py-2 text-sm">Reintentar</button>}</Card>; }
function formatDate(value) { return value ? new Intl.DateTimeFormat("es-BO", { dateStyle: "medium" }).format(new Date(value)) : "sin fecha"; }

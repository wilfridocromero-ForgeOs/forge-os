import { useEffect, useMemo, useState } from "react";
import { Check, Mail, Shield, UserPlus, Users, X } from "lucide-react";

import Page from "../components/ui/Page";
import Card from "../components/ui/Card";
import { useAuth } from "../Context/AuthContext";
import { supabase } from "../lib/supabase";

const modules = [
  ["dashboard", "Dashboard"],
  ["clients", "Clientes"],
  ["discovery", "Discovery"],
  ["projects", "Proyectos"],
  ["area_score", "Score de su área"],
  ["playbooks", "Playbooks"],
];

const emptyInvite = {
  email: "",
  firstName: "",
  title: "Miembro del equipo",
  role: "member",
  division: "",
  jobPosition: "",
  specialty: "",
  moduleKeys: ["dashboard", "clients", "discovery"],
};

export default function Settings() {
  const { canManageUsers, role } = useAuth();
  const [members, setMembers] = useState([]);
  const [organizations, setOrganizations] = useState([]);
  const [access, setAccess] = useState([]);
  const [areas, setAreas] = useState([]);
  const [scores, setScores] = useState([]);
  const [scoreAssignments, setScoreAssignments] = useState([]);
  const [selectedId, setSelectedId] = useState("");
  const [form, setForm] = useState({ first_name: "", title: "", role: "member", division: "", job_position: "", specialty: "" });
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [invite, setInvite] = useState(emptyInvite);
  const [sending, setSending] = useState(false);

  const selected = members.find((member) => member.id === selectedId);
  const internalOrganization = useMemo(
    () => organizations.find((organization) => organization.organization_type === "internal"),
    [organizations],
  );
  const isInternal = selected?.organization_id === internalOrganization?.id;
  const internalAreas = areas.filter((area) => area.organization_id === internalOrganization?.id);
  const latestScores = internalAreas.map((area) => ({ ...area, currentScore: scores.find((score) => score.area_id === area.id) }));

  async function loadData() {
    setLoading(true);
    setMessage("");
    const organizationsRequest = role === "platform_owner"
      ? supabase.rpc("admin_list_organizations")
      : supabase.from("organizations").select("id, name, organization_type").order("name");
    const [membersResult, organizationsResult, accessResult, areasResult, scoresResult, assignmentsResult] = await Promise.all([
      supabase.rpc("admin_list_members_v2"),
      organizationsRequest,
      supabase.from("member_module_access").select("user_id, module_key, enabled"),
      supabase.from("work_areas").select("id, organization_id, name"),
      supabase.from("area_scores").select("id, area_id, score, status, computed_at").order("computed_at", { ascending: false }),
      supabase.from("user_area_access").select("user_id, area_id, is_primary"),
    ]);
    const error = membersResult.error || organizationsResult.error || accessResult.error || areasResult.error || scoresResult.error || assignmentsResult.error;
    if (error) setMessage(error.message);
    setMembers(membersResult.data || []);
    setOrganizations(organizationsResult.data || []);
    setAccess(accessResult.data || []);
    setAreas(areasResult.data || []);
    setScores(scoresResult.data || []);
    setScoreAssignments(assignmentsResult.data || []);
    setLoading(false);
  }

  useEffect(() => {
    if (canManageUsers) loadData();
  }, [canManageUsers, role]);

  useEffect(() => {
    if (!selected) return;
    setForm({
      first_name: selected.first_name || "",
      title: selected.title || "Miembro del equipo",
      role: selected.role || "member",
      division: selected.division || "",
      job_position: selected.job_position || "",
      specialty: selected.specialty || "",
    });
    setMessage("");
  }, [selectedId]);

  async function saveMember(addToOrvesen = false) {
    const organizationId = addToOrvesen ? internalOrganization?.id : selected?.organization_id;
    if (!organizationId) return setMessage("No se encontró el equipo interno de ORVESEN.");
    setMessage("");
    const { error } = await supabase.rpc("admin_update_member_professional", {
      target_user_id: selectedId,
      new_first_name: form.first_name.trim(),
      new_title: form.title.trim(),
      new_role: form.role,
      new_organization_id: organizationId,
      new_division: form.division.trim(),
      new_position: form.job_position.trim(),
      new_specialty: form.specialty.trim(),
    });
    if (error) return setMessage(error.message);
    setMessage(addToOrvesen ? `${form.first_name} fue añadido al equipo ORVESEN.` : "Cambios guardados correctamente.");
    await loadData();
    setSelectedId(selectedId);
  }

  async function toggleScoreVisibility(areaId) {
    const currentIds = scoreAssignments.filter((item) => item.user_id === selectedId).map((item) => item.area_id);
    const nextIds = currentIds.includes(areaId) ? currentIds.filter((id) => id !== areaId) : [...currentIds, areaId];
    const { error } = await supabase.rpc("admin_set_member_score_access", {
      target_user_id: selectedId,
      allowed_area_ids: nextIds,
    });
    if (error) return setMessage(error.message);
    setMessage("Scores visibles actualizados.");
    await loadData();
  }

  async function toggleModule(moduleKey, enabled) {
    const { error } = await supabase.from("member_module_access").upsert({
      user_id: selectedId,
      module_key: moduleKey,
      enabled,
      updated_at: new Date().toISOString(),
    });
    if (error) return setMessage(error.message);
    await loadData();
  }

  function toggleInviteModule(moduleKey) {
    setInvite((current) => ({
      ...current,
      moduleKeys: current.moduleKeys.includes(moduleKey)
        ? current.moduleKeys.filter((item) => item !== moduleKey)
        : [...current.moduleKeys, moduleKey],
    }));
  }

  async function sendInvitation(event) {
    event.preventDefault();
    if (!internalOrganization?.id) return setMessage("No se encontró el equipo interno de ORVESEN.");
    setSending(true);
    setMessage("");
    const { data, error } = await supabase.functions.invoke("invite-user", {
      body: { ...invite, organizationId: internalOrganization.id, areaIds: [] },
    });
    setSending(false);
    if (error || data?.error) return setMessage(data?.error || error?.message || "No se pudo enviar la invitación.");
    setInviteOpen(false);
    setInvite(emptyInvite);
    setMessage("Invitación enviada. La persona recibirá un correo para entrar a ORVESEN.");
    await loadData();
  }

  if (!canManageUsers) {
    return <Page><Card hover={false} contentClassName="p-8"><h1 className="text-2xl font-semibold text-white">Acceso restringido</h1><p className="mt-3 text-zinc-400">Solo el fundador o un administrador puede gestionar el equipo.</p></Card></Page>;
  }

  return (
    <Page className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-zinc-500">Configuración</p>
          <h1 className="mt-2 text-3xl font-semibold text-white">Equipo ORVESEN</h1>
          <p className="mt-2 text-zinc-400">Añade personas, asigna su puesto y decide qué pueden utilizar.</p>
        </div>
        <button onClick={() => setInviteOpen(true)} className="flex items-center justify-center gap-2 rounded-xl bg-white px-5 py-3 font-medium text-black"><Mail size={18} /> Invitar persona nueva</button>
      </div>

      {message && <div className="rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-3 text-sm text-zinc-200">{message}</div>}

      <Card hover={false} contentClassName="p-5 sm:p-6">
        <div className="grid gap-4 md:grid-cols-2">
          <div className="rounded-xl border border-zinc-800 p-4"><p className="font-medium text-white">¿Ya tiene una cuenta?</p><p className="mt-2 text-sm leading-6 text-zinc-400">Búscala en la lista, completa su puesto y división, y pulsa <span className="text-white">Añadir al equipo ORVESEN</span>.</p></div>
          <div className="rounded-xl border border-zinc-800 p-4"><p className="font-medium text-white">¿Todavía no tiene cuenta?</p><p className="mt-2 text-sm leading-6 text-zinc-400">Usa <span className="text-white">Invitar persona nueva</span>. Recibirá un correo para crear su acceso.</p></div>
        </div>
      </Card>

      {inviteOpen && (
        <Card hover={false} contentClassName="p-6">
          <form onSubmit={sendInvitation}>
            <div className="flex items-start justify-between gap-4"><div><h2 className="text-xl font-semibold text-white">Invitar al equipo</h2><p className="mt-1 text-sm text-zinc-400">Esta opción es únicamente para alguien que todavía no aparece en la lista.</p></div><button type="button" onClick={() => setInviteOpen(false)} className="rounded-lg p-2 text-zinc-400"><X size={20} /></button></div>
            <div className="mt-6 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              <Field label="Correo"><input required type="email" value={invite.email} onChange={(event) => setInvite({ ...invite, email: event.target.value })} className="field" /></Field>
              <Field label="Nombre"><input required value={invite.firstName} onChange={(event) => setInvite({ ...invite, firstName: event.target.value })} className="field" /></Field>
              <Field label="Título visible"><input required value={invite.title} onChange={(event) => setInvite({ ...invite, title: event.target.value })} className="field" /></Field>
              <Field label="División"><input placeholder="Ej. Marketing" value={invite.division} onChange={(event) => setInvite({ ...invite, division: event.target.value })} className="field" /></Field>
              <Field label="Puesto"><input placeholder="Ej. Especialista digital" value={invite.jobPosition} onChange={(event) => setInvite({ ...invite, jobPosition: event.target.value })} className="field" /></Field>
              <Field label="Especialidad"><input placeholder="Ej. Redes sociales" value={invite.specialty} onChange={(event) => setInvite({ ...invite, specialty: event.target.value })} className="field" /></Field>
            </div>
            <p className="mt-6 mb-3 text-sm text-zinc-400">Accesos</p>
            <div className="flex flex-wrap gap-2">{modules.map(([key, label]) => <button type="button" key={key} onClick={() => toggleInviteModule(key)} className={`rounded-full border px-3 py-2 text-sm ${invite.moduleKeys.includes(key) ? "border-white bg-white text-black" : "border-zinc-700 text-zinc-300"}`}>{label}</button>)}</div>
            <div className="mt-6 flex justify-end"><button disabled={sending} className="rounded-xl bg-white px-5 py-3 font-medium text-black disabled:opacity-60">{sending ? "Enviando..." : "Enviar invitación"}</button></div>
          </form>
        </Card>
      )}

      <div className="grid gap-6 xl:grid-cols-[340px_1fr]">
        <Card hover={false} contentClassName="p-4 sm:p-5">
          <div className="mb-4 flex items-center gap-2 px-2 font-medium text-zinc-300"><Users size={18} /> Personas con cuenta</div>
          <div className="space-y-2">
            {loading && <p className="px-2 py-4 text-sm text-zinc-500">Cargando personas...</p>}
            {members.map((member) => <button key={member.id} onClick={() => setSelectedId(member.id)} className={`w-full rounded-xl border px-4 py-3 text-left ${selectedId === member.id ? "border-zinc-500 bg-zinc-800" : "border-transparent bg-zinc-900/70 hover:border-zinc-700"}`}><span className="block font-medium text-white">{member.first_name || "Sin nombre"}</span><span className="mt-1 block truncate text-xs text-zinc-500">{member.email}</span><span className="mt-2 inline-block rounded-full border border-zinc-700 px-2 py-1 text-[11px] text-zinc-400">{member.organization_name === internalOrganization?.name ? "Equipo ORVESEN" : "Cuenta disponible"}</span></button>)}
          </div>
        </Card>

        {!selected ? (
          <Card hover={false} contentClassName="flex min-h-[360px] items-center justify-center p-8 text-center"><div><Shield className="mx-auto text-zinc-600" size={36} /><p className="mt-4 text-zinc-400">Selecciona una persona de la lista para darle su puesto y acceso.</p></div></Card>
        ) : (
          <div className="space-y-6">
            <Card hover={false} contentClassName="p-6">
              <div className="flex items-center gap-2"><UserPlus size={19} /><h2 className="font-semibold text-white">Perfil y puesto</h2></div>
              <div className="mt-5 grid gap-5 md:grid-cols-2">
                <Field label="Nombre"><input value={form.first_name} onChange={(event) => setForm({ ...form, first_name: event.target.value })} className="field" /></Field>
                <Field label="Título visible"><input value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} className="field" /></Field>
                <Field label="División"><input placeholder="Ej. Marketing" value={form.division} onChange={(event) => setForm({ ...form, division: event.target.value })} className="field" /></Field>
                <Field label="Puesto"><input placeholder="Ej. Especialista digital" value={form.job_position} onChange={(event) => setForm({ ...form, job_position: event.target.value })} className="field" /></Field>
                <Field label="Especialidad"><input placeholder="Ej. Contenido y redes" value={form.specialty} onChange={(event) => setForm({ ...form, specialty: event.target.value })} className="field" /></Field>
                <Field label="Nivel de acceso"><select value={form.role} onChange={(event) => setForm({ ...form, role: event.target.value })} className="field"><option value="member">Miembro</option><option value="area_lead">Líder de área</option><option value="organization_admin">Administrador</option>{role === "platform_owner" && <option value="platform_owner">Propietario</option>}</select></Field>
              </div>
              <div className="mt-6 flex flex-col justify-end gap-3 sm:flex-row">
                {isInternal ? <button onClick={() => saveMember(false)} className="rounded-xl bg-white px-5 py-3 font-medium text-black">Guardar cambios</button> : <button onClick={() => saveMember(true)} className="flex items-center justify-center gap-2 rounded-xl bg-white px-5 py-3 font-medium text-black"><UserPlus size={18} /> Añadir al equipo ORVESEN</button>}
              </div>
            </Card>

            <Card hover={false} contentClassName="p-6">
              <div className="flex items-center gap-2"><Check size={18} /><h2 className="font-semibold text-white">Scores que podrá ver</h2></div>
              <p className="mt-2 text-sm text-zinc-400">La división de la persona no limita esta selección. Puedes permitirle consultar uno o varios scores.</p>
              <div className="mt-4 grid gap-2 sm:grid-cols-2">{latestScores.map((area) => { const checked = scoreAssignments.some((item) => item.user_id === selectedId && item.area_id === area.id); return <label key={area.id} className="flex cursor-pointer items-center justify-between rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-3 text-sm text-zinc-200"><span>{area.name} · {area.currentScore?.score ?? "Pendiente"}</span><input type="checkbox" checked={checked} onChange={() => toggleScoreVisibility(area.id)} /></label>; })}{!latestScores.length && <p className="text-sm text-zinc-500">Los scores aparecerán aquí automáticamente cuando cada división complete su evaluación.</p>}</div>
            </Card>

            <Card hover={false} contentClassName="p-6">
              <div className="flex items-center gap-2"><Check size={18} /><h2 className="font-semibold text-white">Secciones permitidas</h2></div>
              <p className="mt-2 text-sm text-zinc-400">Activa únicamente las áreas que esta persona necesita.</p>
              <div className="mt-4 grid gap-2 sm:grid-cols-2">{modules.map(([key, label]) => { const configured = access.find((item) => item.user_id === selectedId && item.module_key === key); const checked = configured ? configured.enabled : key !== "area_score"; return <label key={key} className="flex cursor-pointer items-center justify-between rounded-xl bg-zinc-900 px-4 py-3 text-sm text-zinc-200"><span>{label}</span><input type="checkbox" checked={checked} onChange={(event) => toggleModule(key, event.target.checked)} /></label>; })}</div>
            </Card>
          </div>
        )}
      </div>
    </Page>
  );
}

function Field({ label, children }) {
  return <label className="block"><span className="mb-2 block text-sm text-zinc-400">{label}</span>{children}</label>;
}

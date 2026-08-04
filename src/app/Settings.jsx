import { useEffect, useMemo, useState } from "react";
import { Building2, Check, Plus, Shield, Users } from "lucide-react";

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

const emptyForm = {
  first_name: "",
  title: "Miembro",
  role: "member",
  organization_id: "",
};

function slugify(value) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export default function Settings() {
  const { canManageUsers, role } = useAuth();
  const [members, setMembers] = useState([]);
  const [organizations, setOrganizations] = useState([]);
  const [areas, setAreas] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [access, setAccess] = useState([]);
  const [selectedId, setSelectedId] = useState("");
  const [form, setForm] = useState(emptyForm);
  const [newArea, setNewArea] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);

  const selected = members.find((member) => member.id === selectedId);
  const organizationAreas = useMemo(
    () => areas.filter((area) => area.organization_id === form.organization_id),
    [areas, form.organization_id],
  );

  async function loadData() {
    setLoading(true);
    const [membersResult, organizationsResult, areasResult, assignmentsResult, accessResult] = await Promise.all([
      supabase.rpc("admin_list_members"),
      supabase.from("organizations").select("id, name").order("name"),
      supabase.from("work_areas").select("id, organization_id, name, slug, active").order("name"),
      supabase.from("user_area_access").select("user_id, area_id, is_primary"),
      supabase.from("member_module_access").select("user_id, module_key, enabled"),
    ]);

    const error = membersResult.error || organizationsResult.error || areasResult.error || assignmentsResult.error || accessResult.error;
    if (error) setMessage(error.message);
    setMembers(membersResult.data || []);
    setOrganizations(organizationsResult.data || []);
    setAreas(areasResult.data || []);
    setAssignments(assignmentsResult.data || []);
    setAccess(accessResult.data || []);
    setLoading(false);
  }

  useEffect(() => {
    if (canManageUsers) loadData();
  }, [canManageUsers]);

  useEffect(() => {
    if (!selected) return;
    setForm({
      first_name: selected.first_name || "",
      title: selected.title || "Miembro",
      role: selected.role || "member",
      organization_id: selected.organization_id,
    });
    setMessage("");
  }, [selectedId]);

  async function saveMember() {
    setMessage("");
    const { error } = await supabase.rpc("admin_update_member", {
      target_user_id: selectedId,
      new_first_name: form.first_name,
      new_title: form.title,
      new_role: form.role,
      new_organization_id: form.organization_id,
    });
    if (error) return setMessage(error.message);
    setMessage("Usuario actualizado correctamente.");
    await loadData();
  }

  async function toggleArea(areaId, enabled) {
    setMessage("");
    const operation = enabled
      ? supabase.from("user_area_access").upsert({ user_id: selectedId, area_id: areaId })
      : supabase.from("user_area_access").delete().eq("user_id", selectedId).eq("area_id", areaId);
    const { error } = await operation;
    if (error) return setMessage(error.message);
    await loadData();
  }

  async function toggleModule(moduleKey, enabled) {
    setMessage("");
    const { error } = await supabase.from("member_module_access").upsert({
      user_id: selectedId,
      module_key: moduleKey,
      enabled,
      updated_at: new Date().toISOString(),
    });
    if (error) return setMessage(error.message);
    await loadData();
  }

  async function createArea(event) {
    event.preventDefault();
    if (!newArea.trim() || !form.organization_id) return;
    setMessage("");
    const { error } = await supabase.from("work_areas").insert({
      organization_id: form.organization_id,
      name: newArea.trim(),
      slug: slugify(newArea),
    });
    if (error) return setMessage(error.message);
    setNewArea("");
    setMessage("Área creada correctamente.");
    await loadData();
  }

  if (!canManageUsers) {
    return (
      <Page>
        <Card hover={false} contentClassName="p-8">
          <h1 className="text-2xl font-semibold text-white">Configuración protegida</h1>
          <p className="mt-3 text-zinc-400">Solo el fundador o un administrador autorizado puede gestionar usuarios.</p>
        </Card>
      </Page>
    );
  }

  return (
    <Page className="space-y-6">
      <div>
        <p className="text-xs uppercase tracking-[0.3em] text-zinc-500">Configuración</p>
        <h1 className="mt-2 text-3xl font-semibold text-white">Usuarios y permisos</h1>
        <p className="mt-2 text-zinc-400">Separa negocios, asigna títulos y controla qué área ve cada persona.</p>
      </div>

      {message && <div className="rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-3 text-sm text-zinc-200">{message}</div>}

      <div className="grid gap-6 xl:grid-cols-[360px_1fr]">
        <Card hover={false} contentClassName="p-4 sm:p-5">
          <div className="mb-4 flex items-center gap-2 px-2 text-sm font-medium text-zinc-300"><Users size={18} /> Usuarios</div>
          <div className="space-y-2">
            {loading && <p className="px-2 py-4 text-sm text-zinc-500">Cargando usuarios...</p>}
            {members.map((member) => (
              <button
                key={member.id}
                onClick={() => setSelectedId(member.id)}
                className={`w-full rounded-xl border px-4 py-3 text-left transition ${selectedId === member.id ? "border-zinc-500 bg-zinc-800" : "border-transparent bg-zinc-900/70 hover:border-zinc-700"}`}
              >
                <span className="block font-medium text-white">{member.first_name || "Sin nombre"}</span>
                <span className="mt-1 block truncate text-xs text-zinc-500">{member.email}</span>
                <span className="mt-1 block truncate text-xs text-zinc-400">{member.organization_name}</span>
              </button>
            ))}
          </div>
        </Card>

        {!selected ? (
          <Card hover={false} contentClassName="flex min-h-[360px] items-center justify-center p-8 text-center">
            <div><Shield className="mx-auto text-zinc-600" size={36} /><p className="mt-4 text-zinc-400">Selecciona una persona para administrar su acceso.</p></div>
          </Card>
        ) : (
          <div className="space-y-6">
            <Card hover={false} contentClassName="p-6">
              <div className="grid gap-5 md:grid-cols-2">
                <label className="block"><span className="mb-2 block text-sm text-zinc-400">Nombre</span><input value={form.first_name} onChange={(e) => setForm({ ...form, first_name: e.target.value })} className="w-full rounded-xl border border-zinc-700 bg-black px-4 py-3 text-white" /></label>
                <label className="block"><span className="mb-2 block text-sm text-zinc-400">Título visible</span><input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className="w-full rounded-xl border border-zinc-700 bg-black px-4 py-3 text-white" /></label>
                <label className="block"><span className="mb-2 block text-sm text-zinc-400">Nivel de acceso</span><select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} className="w-full rounded-xl border border-zinc-700 bg-black px-4 py-3 text-white"><option value="member">Miembro</option><option value="organization_admin">Administrador del negocio</option>{role === "platform_owner" && <option value="platform_owner">Propietario de ORVESEN</option>}</select></label>
                <label className="block"><span className="mb-2 block text-sm text-zinc-400">Negocio</span><select value={form.organization_id} onChange={(e) => setForm({ ...form, organization_id: e.target.value })} disabled={role !== "platform_owner"} className="w-full rounded-xl border border-zinc-700 bg-black px-4 py-3 text-white disabled:opacity-60">{organizations.map((organization) => <option key={organization.id} value={organization.id}>{organization.name}</option>)}</select></label>
              </div>
              <div className="mt-6 flex justify-end"><button onClick={saveMember} className="rounded-xl bg-white px-5 py-3 font-medium text-black">Guardar usuario</button></div>
            </Card>

            <div className="grid gap-6 lg:grid-cols-2">
              <Card hover={false} contentClassName="p-6">
                <div className="flex items-center gap-2"><Building2 size={18} /><h2 className="font-semibold text-white">Áreas de trabajo</h2></div>
                <form onSubmit={createArea} className="mt-4 flex gap-2"><input value={newArea} onChange={(e) => setNewArea(e.target.value)} placeholder="Ej. Ventas" className="min-w-0 flex-1 rounded-xl border border-zinc-700 bg-black px-4 py-2 text-white" /><button className="rounded-xl border border-zinc-700 px-3 text-white"><Plus size={18} /></button></form>
                <div className="mt-4 space-y-2">{organizationAreas.map((area) => { const checked = assignments.some((item) => item.user_id === selectedId && item.area_id === area.id); return <label key={area.id} className="flex cursor-pointer items-center justify-between rounded-xl bg-zinc-900 px-4 py-3 text-sm text-zinc-200"><span>{area.name}</span><input type="checkbox" checked={checked} onChange={(e) => toggleArea(area.id, e.target.checked)} /></label>; })}{organizationAreas.length === 0 && <p className="text-sm text-zinc-500">Crea la primera área de este negocio.</p>}</div>
              </Card>

              <Card hover={false} contentClassName="p-6">
                <div className="flex items-center gap-2"><Check size={18} /><h2 className="font-semibold text-white">Módulos permitidos</h2></div>
                <div className="mt-4 space-y-2">{modules.map(([key, label]) => { const configured = access.find((item) => item.user_id === selectedId && item.module_key === key); const checked = configured ? configured.enabled : key !== "area_score"; return <label key={key} className="flex cursor-pointer items-center justify-between rounded-xl bg-zinc-900 px-4 py-3 text-sm text-zinc-200"><span>{label}</span><input type="checkbox" checked={checked} onChange={(e) => toggleModule(key, e.target.checked)} /></label>; })}</div>
              </Card>
            </div>
          </div>
        )}
      </div>
    </Page>
  );
}

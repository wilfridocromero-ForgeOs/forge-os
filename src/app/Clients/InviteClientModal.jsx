import { useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

import { supabase } from "../../lib/supabase";

const moduleOptions = [
  ["dashboard", "Dashboard"],
  ["clients", "Clientes"],
  ["discovery", "Discovery"],
  ["projects", "Proyectos"],
  ["area_score", "Score del área"],
  ["playbooks", "Playbooks"],
];

const divisions = ["Dirección", "Marketing", "Studio Creativo", "Estrategia Digital", "Ventas", "Operaciones", "Finanzas", "Servicio al Cliente", "Tecnología"];
const positions = ["Director", "Gerente", "Líder", "Coordinador", "Especialista", "Analista", "Consultor", "Diseñador", "Ejecutivo", "Asistente"];

export default function InviteClientModal({ client, onClose, onInvited }) {
  const [form, setForm] = useState({
    email: client.email || "",
    firstName: client.contact_name || "",
    title: "Administrador del negocio",
    role: "organization_admin",
    division: "Dirección",
    jobPosition: "Director",
    specialty: "",
    moduleKeys: ["dashboard", "clients", "discovery", "projects", "area_score"],
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  function toggleModule(key) {
    setForm((current) => ({
      ...current,
      moduleKeys: current.moduleKeys.includes(key)
        ? current.moduleKeys.filter((item) => item !== key)
        : [...current.moduleKeys, key],
    }));
  }

  async function submit(event) {
    event.preventDefault();
    setLoading(true);
    setError("");
    const { data, error: inviteError } = await supabase.functions.invoke("invite-user", {
      body: {
        ...form,
        clientId: client.id,
        createWorkspace: true,
        organizationId: client.workspace_organization_id || "",
        areaIds: [],
      },
    });
    setLoading(false);
    if (inviteError || data?.error) return setError(data?.error || inviteError.message);
    await onInvited();
    onClose();
  }

  return createPortal(
    <div className="fixed inset-0 z-[100] overflow-y-auto bg-black/70 px-3 py-5 backdrop-blur-sm sm:px-5">
      <div className="mx-auto w-full max-w-3xl rounded-3xl border border-zinc-800 bg-[#111113] p-6 shadow-2xl sm:p-8">
        <div className="flex items-start justify-between gap-4">
          <div><p className="text-xs uppercase tracking-[0.25em] text-zinc-500">Crear acceso</p><h2 className="mt-2 text-2xl font-semibold text-white">Invitar a {client.company_name}</h2><p className="mt-2 text-sm text-zinc-400">Se conservará como cliente y también recibirá un espacio privado de negocio.</p></div>
          <button onClick={onClose} className="rounded-xl p-2 text-zinc-400 hover:bg-zinc-800 hover:text-white"><X size={20} /></button>
        </div>

        <form onSubmit={submit} className="mt-7">
          <div className="grid gap-4 md:grid-cols-2">
            <label><span className="mb-2 block text-sm text-zinc-400">Correo de acceso</span><input required type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="w-full rounded-xl border border-zinc-700 bg-black px-4 py-3 text-white" /></label>
            <label><span className="mb-2 block text-sm text-zinc-400">Nombre de la persona</span><input required value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} className="w-full rounded-xl border border-zinc-700 bg-black px-4 py-3 text-white" /></label>
            <label><span className="mb-2 block text-sm text-zinc-400">Nivel de acceso</span><select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} className="w-full rounded-xl border border-zinc-700 bg-black px-4 py-3 text-white"><option value="organization_admin">Administrador del negocio</option><option value="area_lead">Líder de área</option><option value="member">Miembro</option></select></label>
            <label><span className="mb-2 block text-sm text-zinc-400">Título visible</span><input required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className="w-full rounded-xl border border-zinc-700 bg-black px-4 py-3 text-white" /></label>
            <label><span className="mb-2 block text-sm text-zinc-400">División</span><input list="orvesen-divisions" value={form.division} onChange={(e) => setForm({ ...form, division: e.target.value })} className="w-full rounded-xl border border-zinc-700 bg-black px-4 py-3 text-white" /><datalist id="orvesen-divisions">{divisions.map((item) => <option key={item} value={item} />)}</datalist></label>
            <label><span className="mb-2 block text-sm text-zinc-400">Puesto</span><input list="orvesen-positions" value={form.jobPosition} onChange={(e) => setForm({ ...form, jobPosition: e.target.value })} className="w-full rounded-xl border border-zinc-700 bg-black px-4 py-3 text-white" /><datalist id="orvesen-positions">{positions.map((item) => <option key={item} value={item} />)}</datalist></label>
            <label className="md:col-span-2"><span className="mb-2 block text-sm text-zinc-400">Especialidad</span><input placeholder="Ej. Marketing Digital, Producción Audiovisual o Estrategia de Marca" value={form.specialty} onChange={(e) => setForm({ ...form, specialty: e.target.value })} className="w-full rounded-xl border border-zinc-700 bg-black px-4 py-3 text-white" /></label>
          </div>

          <div className="mt-6"><p className="mb-3 text-sm text-zinc-400">Módulos iniciales</p><div className="flex flex-wrap gap-2">{moduleOptions.map(([key, label]) => <button type="button" key={key} onClick={() => toggleModule(key)} className={`rounded-full border px-3 py-2 text-sm ${form.moduleKeys.includes(key) ? "border-white bg-white text-black" : "border-zinc-700 text-zinc-300"}`}>{label}</button>)}</div></div>
          {error && <p className="mt-5 rounded-xl border border-red-900/60 bg-red-950/30 p-3 text-sm text-red-300">{error}</p>}
          <div className="mt-7 flex justify-end gap-3"><button type="button" onClick={onClose} className="rounded-xl px-5 py-3 text-zinc-400">Cancelar</button><button disabled={loading} className="rounded-xl bg-white px-5 py-3 font-medium text-black disabled:opacity-60">{loading ? "Enviando..." : "Crear negocio y enviar invitación"}</button></div>
        </form>
      </div>
    </div>,
    document.body,
  );
}

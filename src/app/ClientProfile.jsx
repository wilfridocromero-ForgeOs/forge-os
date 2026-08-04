import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Building2, CalendarClock, CheckCircle2, Globe, Mail, MessageSquarePlus, Phone, ShieldCheck, Target } from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";

import Card from "../components/ui/Card";
import Page from "../components/ui/Page";
import { useAuth } from "../Context/AuthContext";
import { getClient } from "../services/ClientService";
import { supabase } from "../lib/supabase";

const statusLabels = { lead: "Lead", active: "Activo", activo: "Activo", paused: "Pausado", pausado: "Pausado", closed: "Cerrado", cerrado: "Cerrado" };

export default function ClientProfile() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [client, setClient] = useState(null);
  const [notes, setNotes] = useState([]);
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function loadProfile() {
    try {
      setLoading(true);
      setError("");
      const clientData = await getClient(id);
      const notesResult = await supabase.from("client_notes").select("id, content, created_at, created_by").eq("client_id", id).order("created_at", { ascending: false });
      if (notesResult.error) throw notesResult.error;
      setClient(clientData);
      setNotes(notesResult.data || []);
    } catch (loadError) {
      console.error(loadError);
      setError("No se pudo abrir la información de este cliente.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadProfile(); }, [id]);

  const insights = useMemo(() => {
    if (!client) return { completeness: 0, opportunities: [], actions: [] };
    const fields = [client.company_name, client.contact_name, client.email, client.phone, client.website, client.industry];
    const completeness = Math.round((fields.filter(Boolean).length / fields.length) * 100);
    const opportunities = [];
    const actions = [];
    if (!client.website) { opportunities.push("Presencia digital sin documentar"); actions.push("Añadir o revisar el sitio web del negocio."); }
    if (!client.industry) { opportunities.push("Industria sin clasificar"); actions.push("Definir la industria para mejorar el diagnóstico."); }
    if (!client.email) { opportunities.push("Canal de correo pendiente"); actions.push("Añadir un correo de contacto válido."); }
    if (!client.phone) { opportunities.push("Teléfono pendiente"); actions.push("Completar el número para seguimientos."); }
    if (!(client.score > 0)) actions.push("Completar Discovery para producir el primer score real.");
    return { completeness, opportunities, actions };
  }, [client]);

  async function addNote(event) {
    event.preventDefault();
    if (!note.trim() || !client) return;
    setSaving(true);
    const { error: noteError } = await supabase.from("client_notes").insert({ client_id: client.id, organization_id: client.organization_id, created_by: user.id, content: note.trim() });
    setSaving(false);
    if (noteError) return setError(noteError.message);
    setNote("");
    await loadProfile();
  }

  if (loading) return <Page><p className="text-sm text-zinc-500">Cargando cliente…</p></Page>;
  if (error && !client) return <Page><Card hover={false} contentClassName="p-8"><p className="text-red-300">{error}</p><button onClick={() => navigate("/clientes")} className="mt-4 text-sm text-white underline">Volver a clientes</button></Card></Page>;

  const score = client.score > 0 ? client.score : null;
  const daysActive = Math.max(0, Math.floor((Date.now() - new Date(client.created_at).getTime()) / 86400000));

  return (
    <Page className="space-y-5">
      <button onClick={() => navigate("/clientes")} className="flex items-center gap-2 text-sm text-zinc-400 hover:text-white"><ArrowLeft size={17} /> Volver a clientes</button>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"><div><p className="text-xs uppercase tracking-[0.3em] text-zinc-500">Ficha del negocio</p><h1 className="mt-2 text-3xl font-semibold text-white">{client.company_name}</h1><p className="mt-2 text-zinc-400">{client.contact_name || "Contacto pendiente"} · {client.industry || "Industria pendiente"}</p></div><span className="w-fit rounded-full border border-zinc-700 px-4 py-2 text-sm text-zinc-300">{statusLabels[String(client.status || "lead").toLowerCase()] || client.status}</span></div>

      {error && <div className="rounded-xl border border-red-900/40 bg-red-950/20 p-4 text-sm text-red-300">{error}</div>}

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Metric icon={Target} label="Score" value={score ?? "Pendiente"} detail={score ? "de 1000" : "Requiere Discovery"} />
        <Metric icon={CheckCircle2} label="Información" value={`${insights.completeness}%`} detail="Perfil completado" />
        <Metric icon={ShieldCheck} label="Portal" value={client.portal_enabled ? "Activo" : "Inactivo"} detail="Acceso del cliente" />
        <Metric icon={CalendarClock} label="Antigüedad" value={`${daysActive} d`} detail="Desde su registro" />
      </section>

      <section className="grid gap-4 xl:grid-cols-[1fr_.9fr]">
        <Card hover={false} contentClassName="p-5 sm:p-6"><h2 className="text-lg font-semibold text-white">Datos del negocio</h2><div className="mt-5 grid gap-4 sm:grid-cols-2"><Info icon={Building2} label="Contacto" value={client.contact_name} /><Info icon={Mail} label="Correo" value={client.email} /><Info icon={Phone} label="Teléfono" value={client.phone} /><Info icon={Globe} label="Sitio web" value={client.website} /></div></Card>
        <Card hover={false} contentClassName="p-5 sm:p-6"><h2 className="text-lg font-semibold text-white">Oportunidades detectadas</h2>{insights.opportunities.length ? <ul className="mt-4 space-y-3">{insights.opportunities.map((item) => <li key={item} className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-3 text-sm text-zinc-300">{item}</li>)}</ul> : <p className="mt-4 text-sm text-zinc-400">La información principal del negocio está completa.</p>}</Card>
      </section>

      <Card hover={false} contentClassName="p-5 sm:p-6"><h2 className="text-lg font-semibold text-white">Próximos pasos recomendados</h2>{insights.actions.length ? <div className="mt-4 grid gap-3 md:grid-cols-2">{insights.actions.map((action, index) => <div key={action} className="flex gap-3 rounded-xl border border-zinc-800 p-4"><span className="text-sm font-semibold text-zinc-500">{String(index + 1).padStart(2, "0")}</span><p className="text-sm text-zinc-300">{action}</p></div>)}</div> : <p className="mt-4 text-sm text-zinc-400">No hay acciones básicas pendientes. El siguiente nivel se generará con Discovery.</p>}</Card>

      <Card hover={false} contentClassName="p-5 sm:p-6"><div className="flex items-center gap-2"><MessageSquarePlus size={19} /><h2 className="text-lg font-semibold text-white">Notas del cliente</h2></div><form onSubmit={addNote} className="mt-4"><textarea value={note} onChange={(event) => setNote(event.target.value)} rows="3" maxLength="3000" className="field resize-none" placeholder="Escribe un seguimiento, acuerdo, cobro pendiente o información importante…" /><div className="mt-3 flex justify-end"><button disabled={saving || !note.trim()} className="rounded-xl bg-white px-5 py-3 text-sm font-medium text-black disabled:opacity-50">{saving ? "Guardando…" : "Guardar nota"}</button></div></form><div className="mt-5 space-y-3">{notes.map((item) => <div key={item.id} className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4"><p className="whitespace-pre-wrap text-sm leading-6 text-zinc-300">{item.content}</p><p className="mt-2 text-xs text-zinc-600">{new Date(item.created_at).toLocaleString("es-ES", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</p></div>)}{!notes.length && <p className="text-sm text-zinc-500">Todavía no hay anotaciones.</p>}</div></Card>
    </Page>
  );
}

function Metric({ icon: Icon, label, value, detail }) { return <Card hover={false} contentClassName="p-4"><div className="flex items-center justify-between"><p className="text-[11px] uppercase tracking-[0.22em] text-zinc-500">{label}</p><Icon size={16} className="text-zinc-500" /></div><p className="mt-3 text-xl font-semibold text-white sm:text-2xl">{value}</p><p className="mt-1 text-xs text-zinc-500">{detail}</p></Card>; }
function Info({ icon: Icon, label, value }) { return <div className="flex gap-3 rounded-xl border border-zinc-800 p-4"><Icon size={17} className="mt-0.5 shrink-0 text-zinc-500" /><div className="min-w-0"><p className="text-xs text-zinc-500">{label}</p><p className="mt-1 break-words text-sm text-zinc-200">{value || "Pendiente"}</p></div></div>; }

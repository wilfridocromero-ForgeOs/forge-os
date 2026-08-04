import { useEffect, useMemo, useState } from "react";
import { Building2, CheckCircle2, ClipboardCheck, Target } from "lucide-react";

import Card from "../components/ui/Card";
import Page from "../components/ui/Page";
import OrvesenScore from "../components/business/OrvesenScore";
import { useAuth } from "../Context/AuthContext";
import { supabase } from "../lib/supabase";

export default function BusinessScore() {
  const { profile } = useAuth();
  const [business, setBusiness] = useState(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!profile?.organization_id) return;
    setLoading(true);
    supabase.from("clients")
      .select("id, company_name, contact_name, industry, status, score, email, phone, website, portal_enabled")
      .eq("workspace_organization_id", profile.organization_id)
      .maybeSingle()
      .then(({ data, error }) => {
        if (error) setMessage(error.message);
        setBusiness(data || null);
        setLoading(false);
      });
  }, [profile?.organization_id]);

  const completeness = useMemo(() => {
    if (!business) return 0;
    const values = [business.company_name, business.contact_name, business.industry, business.email, business.phone, business.website];
    return Math.round((values.filter(Boolean).length / values.length) * 100);
  }, [business]);

  const score = business?.score > 0 ? business.score : null;

  return (
    <Page className="space-y-5">
      <div><p className="text-xs uppercase tracking-[0.3em] text-zinc-500">Inteligencia del negocio</p><h1 className="mt-2 text-3xl font-semibold text-white">Business Score</h1><p className="mt-2 text-zinc-400">Una evaluación exclusiva de tu negocio. No muestra información ni puntuaciones internas de ORVESEN.</p></div>
      {message && <div className="rounded-xl border border-zinc-700 bg-zinc-900 p-4 text-sm text-zinc-300">{message}</div>}
      <section className="grid gap-4 xl:grid-cols-[1fr_.8fr]">
        <OrvesenScore label="BUSINESS SCORE" score={score} max={1000} status={business?.status || "Evaluación pendiente"} description={score ? "Este resultado corresponde únicamente a tu negocio." : "Tu score aparecerá después de completar el diagnóstico inicial del negocio."} loading={loading} compact />
        <div className="grid grid-cols-2 gap-3 xl:grid-cols-1">
          <Summary icon={Building2} label="Negocio" value={business?.company_name || "Vinculación pendiente"} />
          <Summary icon={CheckCircle2} label="Perfil completo" value={`${completeness}%`} />
          <Summary icon={Target} label="Estado" value={business?.status || "Pendiente"} />
          <Summary icon={ClipboardCheck} label="Evaluación" value={score ? "Disponible" : "Sin completar"} />
        </div>
      </section>
      <Card hover={false} contentClassName="p-5 sm:p-6"><h2 className="text-lg font-semibold text-white">¿Qué incluirá este score?</h2><div className="mt-4 grid gap-3 md:grid-cols-2"><Item text="Salud operativa y organización" /><Item text="Presencia digital y experiencia del cliente" /><Item text="Ventas, seguimiento y oportunidades" /><Item text="Procesos, documentación y próximos pasos" /></div><p className="mt-5 text-sm leading-6 text-zinc-500">Los resultados se generarán con Discovery y datos reales. Nadie podrá escribir o alterar manualmente la puntuación.</p></Card>
    </Page>
  );
}

function Summary({ icon: Icon, label, value }) { return <Card hover={false} contentClassName="p-4"><div className="flex items-center justify-between"><p className="text-[11px] uppercase tracking-[0.22em] text-zinc-500">{label}</p><Icon size={16} className="text-zinc-500" /></div><p className="mt-3 text-base font-semibold text-white">{value}</p></Card>; }
function Item({ text }) { return <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4 text-sm text-zinc-300">{text}</div>; }

import { ArrowRight } from "lucide-react";
import { Link } from "react-router-dom";
import Page from "../components/ui/Page";
import Card from "../components/ui/Card";
import { builderEntries } from "../config/navigation";

export default function BuilderHub() {
  return (
    <Page className="space-y-7">
      <header>
        <p className="text-xs uppercase tracking-[0.3em] text-zinc-500">Sistema</p>
        <h1 className="mt-2 text-3xl font-semibold text-white">Construir</h1>
        <p className="mt-2 max-w-2xl text-zinc-400">
          Diseña los sistemas que ORVESEN utiliza para evaluar y operar tu organización.
        </p>
      </header>

      <section className="space-y-3" aria-labelledby="builders-title">
        <h2 id="builders-title" className="text-lg font-semibold text-white">Herramientas disponibles</h2>
        <div className="grid gap-4 lg:grid-cols-2">
          {builderEntries.map(({ label, description, to, icon: Icon }) => (
            <Link key={label} to={to} className="block min-w-0">
              <Card hover contentClassName="flex h-full items-start gap-4 p-6">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-zinc-700 bg-zinc-900"><Icon size={20} /></span>
                <div className="min-w-0 flex-1"><h3 className="font-semibold text-white">{label}</h3><p className="mt-2 text-sm leading-6 text-zinc-400">{description}</p><span className="mt-4 inline-flex items-center gap-2 text-sm text-white">Abrir <ArrowRight size={15} /></span></div>
              </Card>
            </Link>
          ))}
        </div>
      </section>
    </Page>
  );
}

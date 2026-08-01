import Button from "../../../components/ui/Button";
import SearchInput from "../../../components/ui/SearchInput";

export default function ClientToolbar() {
  return (
    <header className="mb-12">

      <div className="flex items-end justify-between">

        <div>

          <p className="text-xs uppercase tracking-[0.35em] text-zinc-500">
            ORVESEN CRM
          </p>

          <h1 className="mt-4 text-5xl font-semibold tracking-tight text-white">
            Clientes
          </h1>

          <p className="mt-4 max-w-xl leading-8 text-zinc-400">
            Gestiona todas las organizaciones desde una sola plataforma.
          </p>

        </div>

        <Button className="w-auto px-8">
          Nuevo Cliente
        </Button>

      </div>

      <div className="mt-10">

        <SearchInput placeholder="Buscar cliente..." />

      </div>

    </header>
  );
}
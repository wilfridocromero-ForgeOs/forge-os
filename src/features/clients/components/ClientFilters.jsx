import { Search } from "lucide-react";

export default function ClientFilters() {
  return (
    <div className="flex items-center justify-between gap-6">

      <div className="flex flex-1 items-center gap-4 rounded-2xl border border-zinc-800 bg-zinc-950 px-5 py-3">

        <Search size={18} className="text-zinc-500" />

        <input
          type="text"
          placeholder="Buscar cliente..."
          className="w-full bg-transparent text-white outline-none placeholder:text-zinc-500"
        />

      </div>

      <div className="flex gap-3">

        <button className="rounded-xl border border-zinc-700 px-4 py-2 text-sm text-white">
          Todos
        </button>

        <button className="rounded-xl border border-zinc-800 px-4 py-2 text-sm text-zinc-400">
          Activos
        </button>

        <button className="rounded-xl border border-zinc-800 px-4 py-2 text-sm text-zinc-400">
          Pendientes
        </button>

      </div>

    </div>
  );
}
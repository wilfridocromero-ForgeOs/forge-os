import {
  Bell,
  Search,
  Plus,
  ChevronDown,
} from "lucide-react";

function Header() {
  return (
    <header className="flex h-20 items-center justify-between border-b border-zinc-900 bg-[#0D0D0D] px-10">

      {/* Buscador */}

      <div className="flex items-center gap-4">

        <div className="flex w-[420px] items-center gap-3 rounded-2xl border border-zinc-800 bg-zinc-900 px-5 py-3 transition-all duration-300 hover:border-zinc-700">

          <Search
            size={18}
            className="text-zinc-500"
          />

          <input
            type="text"
            placeholder="Buscar clientes, proyectos..."
            className="w-full bg-transparent text-sm text-white placeholder:text-zinc-500 outline-none"
          />

        </div>

      </div>

      {/* Acciones */}

      <div className="flex items-center gap-5">

        {/* Nuevo */}

        <button className="flex items-center gap-2 rounded-xl border border-zinc-700 bg-zinc-900 px-5 py-3 text-sm font-medium text-white transition-all duration-300 hover:border-zinc-600 hover:bg-zinc-800">

          <Plus size={16} />

          Nuevo

        </button>

        {/* Notificaciones */}

        <button className="flex h-11 w-11 items-center justify-center rounded-xl border border-zinc-800 bg-zinc-900 text-zinc-400 transition-all duration-300 hover:border-zinc-600 hover:text-white">

          <Bell size={18} />

        </button>

        {/* Usuario */}

        <button className="flex items-center gap-3 rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-2 transition-all duration-300 hover:border-zinc-600">

          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-white text-sm font-bold text-black">
            W
          </div>

          <div className="text-left">

            <p className="text-sm font-semibold text-white">
              Wilfrido
            </p>

            <p className="text-xs text-zinc-500">
              Founder
            </p>

          </div>

          <ChevronDown
            size={16}
            className="text-zinc-500"
          />

        </button>

      </div>

    </header>
  );
}

export default Header;
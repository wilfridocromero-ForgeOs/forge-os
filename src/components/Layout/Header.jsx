import {
  Bell,
  Search,
  Plus,
  ChevronDown,
  Menu,
} from "lucide-react";

export default function Header({ setSidebarOpen }) {
  return (
    <header
      className="
        sticky
        top-0
        z-30

        flex
        h-18
        items-center
        justify-between

        border-b
        border-zinc-800

        bg-[#09090B]/95
        backdrop-blur-xl

        px-4
        sm:px-6
        lg:px-10
      "
    >
      {/* Lado izquierdo */}

      <div className="flex items-center gap-4">

        {/* Menú móvil */}

        <button
          onClick={() => setSidebarOpen(true)}
          className="
            flex
            h-11
            w-11
            items-center
            justify-center

            rounded-xl

            border
            border-zinc-800

            bg-zinc-900

            transition-colors
            hover:bg-zinc-800

            lg:hidden
          "
        >
          <Menu size={20} />
        </button>

        {/* Logo móvil */}

        <div className="lg:hidden">
          <h1 className="text-lg font-bold tracking-[0.20em]">
            ORVESEN
          </h1>
        </div>

        {/* Buscador */}

        <div
          className="
            hidden
            md:flex

            w-[420px]

            items-center
            gap-3

            rounded-2xl

            border
            border-zinc-800

            bg-zinc-900

            px-5
            py-3

            transition-colors
            focus-within:border-zinc-700
          "
        >
          <Search
            size={18}
            className="text-zinc-500"
          />

          <input
            type="text"
            placeholder="Buscar clientes, proyectos..."
            className="
              w-full
              bg-transparent

              text-sm
              text-white

              placeholder:text-zinc-500

              outline-none
            "
          />
        </div>

      </div>

      {/* Lado derecho */}

      <div className="flex items-center gap-3">

        {/* Nuevo */}

        <button
          className="
            hidden
            sm:flex

            items-center
            gap-2

            rounded-xl

            border
            border-zinc-700

            bg-zinc-900

            px-5
            py-3

            text-sm
            font-medium

            transition-colors
            hover:bg-zinc-800
          "
        >
          <Plus size={16} />
          Nuevo
        </button>

        {/* Notificaciones */}

        <button
          className="
            flex
            h-11
            w-11
            items-center
            justify-center

            rounded-xl

            border
            border-zinc-800

            bg-zinc-900

            transition-colors
            hover:bg-zinc-800
          "
        >
          <Bell size={18} />
        </button>

        {/* Usuario */}

        <button
          className="
            flex
            items-center
            gap-3

            rounded-xl

            border
            border-zinc-800

            bg-zinc-900

            px-3
            py-2

            transition-colors
            hover:bg-zinc-800
          "
        >
          <div
            className="
              flex
              h-10
              w-10
              items-center
              justify-center

              rounded-full

              bg-white

              font-bold

              text-black
            "
          >
            W
          </div>

          <div className="hidden lg:block text-left">

            <p className="text-sm font-semibold text-white">
              Wilfrido
            </p>

            <p className="text-xs text-zinc-500">
              Founder
            </p>

          </div>

          <ChevronDown
            size={16}
            className="hidden lg:block text-zinc-500"
          />
        </button>

      </div>

    </header>
  );
}
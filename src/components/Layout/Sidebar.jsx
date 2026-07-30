import {
  LayoutDashboard,
  Users,
  Brain,
  BarChart3,
  FolderKanban,
  CalendarDays,
  DollarSign,
  Bot,
  Settings,
} from "lucide-react";

import { NavLink } from "react-router-dom";

function Sidebar() {
  const menu = [
    { icon: LayoutDashboard, label: "Dashboard", path: "/" },
    { icon: Users, label: "Clientes", path: "/clientes" },
    { icon: Brain, label: "Discovery", path: "/discovery" },
    { icon: BarChart3, label: "ORVESEN Score", path: "/orvesen-score" },
    { icon: FolderKanban, label: "Proyectos", path: "/proyectos" },
    { icon: CalendarDays, label: "Calendario", path: "/calendario" },
    { icon: DollarSign, label: "Ventas", path: "/ventas" },
    { icon: Bot, label: "ORVESEN IA", path: "/ia" },
    { icon: Settings, label: "Configuración", path: "/configuracion" },
  ];

  return (
    <aside className="flex h-screen w-72 flex-col border-r border-zinc-900 bg-[#090909]">

      {/* Logo */}

      <div className="px-8 pt-10 pb-10">

        <img
          src="/logo.png"
          alt="ORVESEN"
          className="mb-8 h-28 w-auto object-contain"
          draggable={false}
        />

        <h1 className="text-2xl font-semibold tracking-[0.18em] text-white">
          ORVESEN
        </h1>

        <p className="mt-3 text-sm leading-6 text-zinc-500">
          Enterprise Intelligence Platform
        </p>

      </div>

      {/* Menú */}

      <nav className="flex-1 px-4">
        {menu.map((item) => {
          const Icon = item.icon;

          return (
            <NavLink key={item.label} to={item.path}>
              {({ isActive }) => (
                <div
                  className={`group relative mb-2 flex items-center gap-4 rounded-2xl px-5 py-4 transition-all duration-300 cursor-pointer ${
                    isActive
                      ? "bg-zinc-900 text-white"
                      : "text-zinc-500 hover:bg-zinc-900 hover:text-white"
                  }`}
                >
                  {isActive && (
                    <div className="absolute left-0 top-3 bottom-3 w-1 rounded-r-full bg-white" />
                  )}

                  <Icon size={20} strokeWidth={2} />

                  <span className="font-medium">
                    {item.label}
                  </span>
                </div>
              )}
            </NavLink>
          );
        })}
      </nav>

      {/* Usuario */}

      <div className="border-t border-zinc-900 p-6">

        <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-5">

          <p className="text-xs uppercase tracking-[0.25em] text-zinc-500">
            Founder
          </p>

          <h3 className="mt-3 text-lg font-semibold text-white">
            Wilfrido
          </h3>

          <p className="mt-1 text-sm text-zinc-500">
            Administrator
          </p>

        </div>

      </div>

    </aside>
  );
}

export default Sidebar;
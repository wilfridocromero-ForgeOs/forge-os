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

function Sidebar() {
  const menu = [
    { icon: LayoutDashboard, label: "Dashboard" },
    { icon: Users, label: "Clientes" },
    { icon: Brain, label: "Discovery" },
    { icon: BarChart3, label: "Forge Score" },
    { icon: FolderKanban, label: "Proyectos" },
    { icon: CalendarDays, label: "Calendario" },
    { icon: DollarSign, label: "Ventas" },
    { icon: Bot, label: "Auren AI" },
    { icon: Settings, label: "Configuración" },
  ];

  return (
    <aside className="flex h-screen w-72 flex-col border-r border-zinc-800 bg-zinc-950">
      <div className="border-b border-zinc-800 p-8">
        <h1 className="text-2xl font-bold text-yellow-400">
          Forge OS
        </h1>

        <p className="mt-2 text-sm text-zinc-500">
          Sistema Operativo Empresarial
        </p>
      </div>

      <nav className="flex-1 p-4">
        {menu.map((item) => {
          const Icon = item.icon;

          return (
            <button
              key={item.label}
              className="mb-2 flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left text-zinc-300 transition hover:bg-zinc-900 hover:text-yellow-400"
            >
              <Icon size={20} />

              {item.label}
            </button>
          );
        })}
      </nav>

      <div className="border-t border-zinc-800 p-5">
        <div className="rounded-xl bg-zinc-900 p-4">
          <p className="text-sm text-zinc-400">
            Founder Plan
          </p>

          <h3 className="mt-1 font-semibold text-white">
            Wilfrido
          </h3>
        </div>
      </div>
    </aside>
  );
}

export default Sidebar;
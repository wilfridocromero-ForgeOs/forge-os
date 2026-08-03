import { NavLink } from "react-router-dom";
import {
  LayoutDashboard,
  Users,
  Brain,
  BarChart3,
  FolderKanban,
  CalendarDays,
  DollarSign,
  X,
} from "lucide-react";
import { useAuth } from "../../Context/AuthContext";

const menu = [
  {
    title: "GENERAL",
    items: [
      {
        label: "Dashboard",
        icon: LayoutDashboard,
        to: "/",
      },
      {
        label: "Clientes",
        icon: Users,
        to: "/clientes",
      },
      {
        label: "Discovery",
        icon: Brain,
        to: "/discovery",
      },
      {
        label: "ORVESEN Score",
        icon: BarChart3,
        to: "/score",
      },
    ],
  },
  {
    title: "OPERACIONES",
    items: [
      {
        label: "Proyectos",
        icon: FolderKanban,
        to: "/proyectos",
      },
      {
        label: "Calendario",
        icon: CalendarDays,
        to: "/calendario",
      },
      {
        label: "Ventas",
        icon: DollarSign,
        to: "/ventas",
      },
    ],
  },
];

export default function Sidebar({
  sidebarOpen,
  setSidebarOpen,
}) {
  const { displayName, initial } = useAuth();

  return (
    <>
      {/* Overlay móvil */}

      <div
        onClick={() => setSidebarOpen(false)}
        className={`
          fixed
          inset-0
          z-40
          bg-black/45
          backdrop-blur-sm
          transition-opacity
          duration-200
          lg:hidden

          ${
            sidebarOpen
              ? "opacity-100"
              : "pointer-events-none opacity-0"
          }
        `}
      />

      {/* Sidebar */}

      <aside
        className={`
          fixed
          top-0
          left-0
          z-50

          flex
          h-screen
          w-[290px]
          max-w-[85vw]
          flex-col

          border-r
          border-zinc-800

          bg-[#09090B]

          transition-transform
          duration-200
          ease-out

          ${
            sidebarOpen
              ? "translate-x-0"
              : "-translate-x-full"
          }

          lg:translate-x-0
        `}
      >
        {/* Logo */}

        <div className="px-8 pt-8">

          <div className="flex items-center justify-between">

            <div>

              <h1 className="text-2xl font-bold tracking-[0.25em] sm:text-3xl">
                ORVESEN
              </h1>

              <p className="mt-3 text-xs tracking-[0.25em] text-zinc-500">
                Enterprise Intelligence
              </p>

            </div>

            <button
              onClick={() => setSidebarOpen(false)}
              className="
                rounded-xl
                p-2
                transition-colors
                hover:bg-zinc-900
                lg:hidden
              "
            >
              <X size={20} />
            </button>

          </div>

        </div>

        {/* Navegación */}

        <div className="mt-10 flex-1 overflow-y-auto px-5">

          {menu.map((section) => (
            <div
              key={section.title}
              className="mb-10"
            >
              <p className="mb-4 px-3 text-xs tracking-[0.30em] text-zinc-500">
                {section.title}
              </p>

              <div className="space-y-2">

                {section.items.map((item) => {
                  const Icon = item.icon;

                  return (
                    <NavLink
                      key={item.label}
                      to={item.to}
                      onClick={() => setSidebarOpen(false)}
                      className={({ isActive }) =>
                        `
                        flex
                        items-center
                        gap-4

                        rounded-2xl

                        px-4
                        py-4

                        transition-all
                        duration-200

                        ${
                          isActive
                            ? "bg-zinc-900 text-white"
                            : "text-zinc-400 hover:bg-zinc-900 hover:text-white hover:translate-x-1"
                        }
                      `
                      }
                    >
                      <Icon size={20} />

                      <span className="font-medium">
                        {item.label}
                      </span>

                    </NavLink>
                  );
                })}

              </div>

            </div>
          ))}

        </div>

        {/* Usuario */}

        <div className="border-t border-zinc-800 p-6">

          <div className="flex items-center gap-4">

            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-white font-bold text-black">
              {initial}
            </div>

            <div>

              <p className="font-semibold text-white">
                {displayName}
              </p>

              <p className="text-sm text-zinc-500">
                Miembro
              </p>

            </div>

          </div>

        </div>

      </aside>
    </>
  );
}

import { NavLink, useLocation } from "react-router-dom";
import { X } from "lucide-react";
import { useAuth } from "../../Context/AuthContext";
import { navigationGroups } from "../../config/navigation";
import Logo from "../display/Logo";

export default function Sidebar({
  sidebarOpen,
  setSidebarOpen,
}) {
  const { displayName, initial, displayTitle, canAccess, hasCapability, isInternalOrganization } = useAuth();
  const location = useLocation();

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

        <div className="px-5 pt-7">

          <div className="relative flex items-center justify-center">

            <Logo compact size="small" />

            <button
              onClick={() => setSidebarOpen(false)}
              className="
                rounded-xl
                p-2
                transition-colors
                hover:bg-zinc-900
                absolute right-0 lg:hidden
              "
            >
              <X size={20} />
            </button>

          </div>

        </div>

        {/* Navegación */}

        <div className="mt-10 flex-1 overflow-y-auto px-5">

          {navigationGroups.map((section) => (
            <div
              key={section.title}
              className="mb-10"
            >
              <p className="mb-4 px-3 text-xs tracking-[0.30em] text-zinc-500">
                {section.title}
              </p>

              <div className="space-y-2">

                {section.items.filter((item) => {
                  if (item.organization === "internal" && !isInternalOrganization) return false;
                  if (item.organization === "external" && isInternalOrganization) return false;
                  if (item.capability && !hasCapability(item.capability)) return false;
                  return !item.moduleKey || canAccess(item.moduleKey);
                }).map((item) => {
                  const Icon = item.icon;

                  return (
                    <NavLink
                      key={item.label}
                      to={item.to}
                      end={item.end || item.to === "/"}
                      onClick={() => setSidebarOpen(false)}
                      className={({ isActive }) => {
                        const itemIsActive = isActive || item.activePaths?.some((path) => location.pathname.startsWith(path));
                        return `
                        flex
                        items-center
                        gap-4

                        rounded-2xl

                        px-4
                        py-4

                        transition-all
                        duration-200

                        ${
                          itemIsActive
                            ? "bg-zinc-900 text-white"
                            : "text-zinc-400 hover:bg-zinc-900 hover:text-white hover:translate-x-1"
                        }
                      `;
                      }}
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
                {displayTitle}
              </p>

            </div>

          </div>

        </div>

      </aside>
    </>
  );
}

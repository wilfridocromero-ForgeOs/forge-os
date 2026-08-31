import { NavLink, useLocation } from "react-router-dom";
import { PanelLeftClose, PanelLeftOpen, X } from "lucide-react";
import { useAuth } from "../../Context/AuthContext";
import { navigationGroups } from "../../config/navigation";
import Logo from "../display/Logo";
import { buildOrbDestination } from "../../features/orb/orbSurfaceContext";

export default function Sidebar({
  sidebarOpen,
  setSidebarOpen,
  collapsed = false,
  collapsible = false,
  onCollapsedChange,
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
          ${collapsed ? "lg:w-[76px]" : "lg:w-[290px]"}
          max-w-[85vw]
          flex-col

          border-r
          border-zinc-800

          bg-[#09090B]

          transition-[transform,width]
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

        <div className={`${collapsed ? "lg:px-2" : ""} px-5 pt-7`}>

          <div className="relative flex items-center justify-center">

            <div className={collapsed ? "lg:hidden" : "contents"}>
              <Logo compact size="small" />
            </div>

            {collapsible && <button
              type="button"
              onClick={onCollapsedChange}
              className={`${collapsed ? "lg:static" : "absolute right-0"} hidden rounded-xl p-2 text-zinc-400 transition-colors hover:bg-zinc-900 hover:text-white lg:block`}
              aria-label={collapsed ? "Expandir navegaciÃ³n" : "Contraer navegaciÃ³n"}
              aria-expanded={!collapsed}
              title={collapsed ? "Expandir navegaciÃ³n" : "Contraer navegaciÃ³n"}
            >
              {collapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
            </button>}

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

        <div className={`${collapsed ? "lg:px-2" : ""} mt-10 flex-1 overflow-y-auto px-5`}>

          {navigationGroups.map((section) => (
            <div
              key={section.title}
              className="mb-10"
            >
              <p className={`${collapsed ? "lg:hidden" : ""} mb-4 px-3 text-xs tracking-[0.30em] text-zinc-500`}>
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
                      to={item.to === "/orvesen-ia" ? buildOrbDestination(location.pathname) : item.to}
                      end={item.end || item.to === "/"}
                      onClick={() => setSidebarOpen(false)}
                      className={({ isActive }) => {
                        const itemIsActive = isActive || item.activePaths?.some((path) => location.pathname.startsWith(path));
                        return `
                        flex
                        items-center
                        ${collapsed ? "lg:justify-center lg:gap-0 lg:px-0" : "gap-4"}

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

                      <span className={`${collapsed ? "lg:sr-only" : ""} font-medium`}>
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

        <div className={`${collapsed ? "lg:p-3" : ""} border-t border-zinc-800 p-6`}>

          <div className="flex items-center gap-4">

            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-white font-bold text-black">
              {initial}
            </div>

            <div className={collapsed ? "lg:hidden" : ""}>

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

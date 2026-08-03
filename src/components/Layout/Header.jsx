import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Menu as HeadlessMenu } from "@headlessui/react";
import {
  Bell,
  Search,
  Plus,
  ChevronDown,
  Menu,
  LogOut,
  User,
  Settings,
  Moon,
  Sun,
} from "lucide-react";

import { useAuth } from "../../Context/AuthContext";
import ProfileModal from "./ProfileModal";
import { useTheme } from "../../Context/ThemeContext";

export default function Header({ setSidebarOpen }) {
  const { logout, displayName, initial, displayTitle } = useAuth();
  const [profileOpen, setProfileOpen] = useState(false);
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();

  async function handleLogout() {
    await logout();
    navigate("/login");
  }

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

        <div className="lg:hidden">
          <h1 className="text-lg font-bold tracking-[0.20em]">
            ORVESEN
          </h1>
        </div>

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

        <button
          onClick={toggleTheme}
          title={theme === "dark" ? "Cambiar a modo claro" : "Cambiar a modo oscuro"}
          aria-label={theme === "dark" ? "Cambiar a modo claro" : "Cambiar a modo oscuro"}
          className="flex h-11 w-11 items-center justify-center rounded-xl border border-zinc-800 bg-zinc-900 transition-colors hover:bg-zinc-800"
        >
          {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
        </button>

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

        <HeadlessMenu as="div" className="relative">

          <HeadlessMenu.Button
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
              {initial}
            </div>

            <div className="hidden lg:block text-left">

              <p className="text-sm font-semibold">
                {displayName}
              </p>

              <p className="text-xs text-zinc-500">
                {displayTitle}
              </p>

            </div>

            <ChevronDown
              size={16}
              className="hidden lg:block text-zinc-500"
            />
          </HeadlessMenu.Button>

          <HeadlessMenu.Items
            className="
              absolute
              right-0
              mt-3
              w-56

              overflow-hidden

              rounded-2xl

              border
              border-zinc-800

              bg-[#111113]

              shadow-2xl
            "
          >

            <HeadlessMenu.Item>
              <button
                onClick={() => setProfileOpen(true)}
                className="flex w-full items-center gap-3 px-4 py-3 hover:bg-zinc-900"
              >
                <User size={18} />
                Perfil
              </button>
            </HeadlessMenu.Item>

            <HeadlessMenu.Item>
              <button className="flex w-full items-center gap-3 px-4 py-3 hover:bg-zinc-900">
                <Settings size={18} />
                Configuración
              </button>
            </HeadlessMenu.Item>

            <div className="border-t border-zinc-800" />

            <HeadlessMenu.Item>
              <button
                onClick={handleLogout}
                className="flex w-full items-center gap-3 px-4 py-3 text-red-400 hover:bg-zinc-900"
              >
                <LogOut size={18} />
                Cerrar sesión
              </button>
            </HeadlessMenu.Item>

          </HeadlessMenu.Items>

        </HeadlessMenu>

      </div>

      {profileOpen && <ProfileModal onClose={() => setProfileOpen(false)} />}
    </header>
  );
}

import Logo from "../components/display/Logo";
import LoginForm from "../components/forms/LoginForm";
import AuthBackground from "../components/display/AuthBackground";
import { Link } from "react-router-dom";

export default function Login() {
  return (
    <div
      className="
        relative
        min-h-screen
        overflow-hidden

        bg-[#09090B]

        flex
        items-center
        justify-center

        px-6
      "
    >
      {/* Fondo */}
      <AuthBackground />

      {/* Contenido */}
      <div className="relative z-10 w-full max-w-md">
        <div
          className="
            rounded-3xl

            border
            border-zinc-800

            bg-[#111113]/80
            backdrop-blur-xl

            p-10

            shadow-[0_30px_80px_rgba(0,0,0,.45)]
          "
        >
          {/* Logo */}

          <Logo />

          {/* Texto */}

          <div className="mt-10 text-center">
            <h2 className="text-2xl font-semibold text-white">
              Bienvenido nuevamente
            </h2>

            <p className="mt-3 text-sm leading-7 text-zinc-500">
              Inicia sesión para acceder a tu espacio de trabajo
              y continuar gestionando tu empresa con ORVESEN.
            </p>
          </div>

          {/* Formulario */}

          <div className="mt-10">
            <LoginForm />
          </div>

          {/* Footer */}

          <div className="mt-10 flex items-center justify-between border-t border-zinc-800 pt-6 text-sm">
            <span className="text-zinc-500">¿No tienes cuenta?</span>
            <Link className="text-white hover:underline" to="/register">
              Regístrate
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

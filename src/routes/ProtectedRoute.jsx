import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../Context/AuthContext";
import OrbGlobal from "../features/orb/OrbGlobal";

export default function ProtectedRoute() {
  const { session, loading, identityStatus } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="min-h-screen bg-[#09090B] flex items-center justify-center text-white">
        Cargando...
      </div>
    );
  }

  if (!session) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  if (identityStatus !== "authorized") {
    const message = identityStatus === "no_organization"
      ? "Tu usuario no tiene una organización activa."
      : identityStatus === "unauthorized"
        ? "Tu perfil no tiene una membresía o rol válido."
        : "No se pudo resolver tu acceso. Intenta actualizar la página.";

    return (
      <div className="min-h-screen bg-[#09090B] flex items-center justify-center px-6 text-center text-white">
        <div>
          <h1 className="text-xl font-semibold">Acceso no disponible</h1>
          <p className="mt-2 text-sm text-zinc-400">{message}</p>
        </div>
      </div>
    );
  }

  return <>
    <Outlet />
    <OrbGlobal />
  </>;
}

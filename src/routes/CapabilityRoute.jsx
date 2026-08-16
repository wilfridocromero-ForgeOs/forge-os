import { Link } from "react-router-dom";
import { useAuth } from "../Context/AuthContext";

export default function CapabilityRoute({ capability, children }) {
  const { hasCapability, loading, identityStatus, identityError } = useAuth();

  if (loading) {
    return <div className="flex min-h-[60vh] items-center justify-center text-sm text-zinc-400">Verificando permisos...</div>;
  }

  if (identityStatus === "error") {
    return (
      <div className="flex min-h-[60vh] items-center justify-center px-6 text-center">
        <div><h1 className="text-xl font-semibold text-white">No se pudieron verificar tus permisos</h1><p className="mt-2 text-sm text-red-300">{identityError?.message || "Intenta recargar la página."}</p></div>
      </div>
    );
  }

  if (hasCapability(capability)) return children;

  return (
    <div className="flex min-h-[60vh] items-center justify-center px-6 text-center">
      <div>
        <h1 className="text-xl font-semibold text-white">Acceso restringido</h1>
        <p className="mt-2 text-sm text-zinc-400">
          Tu rol actual no permite utilizar esta sección.
        </p>
        <Link className="mt-5 inline-block text-sm text-white underline underline-offset-4" to="/">
          Volver al Dashboard
        </Link>
      </div>
    </div>
  );
}

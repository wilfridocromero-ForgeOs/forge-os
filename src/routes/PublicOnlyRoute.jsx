import { Navigate, Outlet } from "react-router-dom";

import { useAuth } from "../Context/AuthContext";

export default function PublicOnlyRoute() {
  const { session, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#09090B] text-white">
        Cargando...
      </div>
    );
  }

  return session ? <Navigate to="/" replace /> : <Outlet />;
}

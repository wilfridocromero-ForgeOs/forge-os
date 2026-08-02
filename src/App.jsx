import { Route, Routes } from "react-router-dom";

import ProtectedRoute from "./routes/ProtectedRoute";
import PublicOnlyRoute from "./routes/PublicOnlyRoute";
import AppLayout from "./components/Layout/AppLayout";

import Login from "./auth/Login";
import Register from "./auth/Register";

import Dashboard from "./app/Dashboard";
import Clients from "./app/Clients";
import Discovery from "./app/Discovery";
import Projects from "./app/Projects";
import Score from "./app/Score";

export default function App() {
  return (
    <Routes>
      <Route element={<PublicOnlyRoute />}>
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
      </Route>

      <Route element={<ProtectedRoute />}>
        <Route element={<AppLayout />}>
          <Route index element={<Dashboard />} />
          <Route path="clientes" element={<Clients />} />
          <Route path="discovery" element={<Discovery />} />
          <Route path="proyectos" element={<Projects />} />
          <Route path="orvesen-score" element={<Score />} />
        </Route>
      </Route>

      <Route
        path="*"
        element={
          <div className="flex min-h-screen items-center justify-center bg-[#09090B] text-white">
            Página no encontrada
          </div>
        }
      />
    </Routes>
  );
}
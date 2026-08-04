import { Routes, Route } from "react-router-dom";

import ProtectedRoute from "./routes/ProtectedRoute";
import PublicOnlyRoute from "./routes/PublicOnlyRoute";
import AppLayout from "./components/Layout/AppLayout";

// Auth
import Login from "./auth/Login";
import Register from "./auth/Register";

// Pages
import Dashboard from "./app/Dashboard";
import Clients from "./app/Clients";
import Discovery from "./app/Discovery";
import Projects from "./app/Projects";
import Score from "./app/Score";
import Settings from "./app/Settings";


export default function App() {
  return (
    <Routes>

      {/* AUTH */}
      <Route element={<PublicOnlyRoute />}>
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
      </Route>


      {/* APP PROTEGIDA */}
      <Route element={<ProtectedRoute />}>
        <Route element={<AppLayout />}>

        <Route
          path="/"
          element={<Dashboard />}
        />

        <Route
          path="/clientes"
          element={<Clients />}
        />

        <Route
          path="/discovery"
          element={<Discovery />}
        />

        <Route
          path="/proyectos"
          element={<Projects />}
        />

        <Route
          path="/orvesen-score"
          element={<Score />}
        />

        <Route path="/configuracion" element={<Settings />} />

        </Route>
      </Route>


      {/* RUTA NO ENCONTRADA */}
      <Route
        path="*"
        element={
          <div className="min-h-screen bg-[#09090B] flex items-center justify-center text-white">
            Página no encontrada
          </div>
        }
      />

    </Routes>
  );
}

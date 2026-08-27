import { lazy, Suspense } from "react";
import { Navigate, Routes, Route } from "react-router-dom";

import ProtectedRoute from "./routes/ProtectedRoute";
import PublicOnlyRoute from "./routes/PublicOnlyRoute";
import CapabilityRoute from "./routes/CapabilityRoute";
import AppLayout from "./components/Layout/AppLayout";
import { CAPABILITIES } from "./config/capabilities";

// Auth
import Login from "./auth/Login";
import ResetPassword from "./auth/ResetPassword";

// Pages
import Dashboard from "./app/Dashboard";
import Clients from "./app/Clients";
import ClientProfile from "./app/ClientProfile";
import DiscoveryBuilder from "./app/Discovery";
import DiscoveryExecution, { DiscoveryResult, DiscoveryRunner } from "./app/DiscoveryExecution";
import Projects from "./app/Projects";
import ProjectPage from "./app/ProjectPage";
import Score from "./app/Score";
import SettingsHub, { AccountSettings, CompanySettings, DivisionsSettings, MembersSettingsPage } from "./app/SettingsHub";
import BuilderHub from "./app/BuilderHub";
import Calendar from "./app/Calendar";
import Brain from "./app/Brain";
import ScoreBuilder from "./app/ScoreBuilder";
import BusinessScore from "./app/BusinessScore";
import { useAuth } from "./Context/AuthContext";

const Orb = lazy(() => import("./app/Orb"));


export default function App() {
  return (
    <Routes>

      {/* AUTH */}
      <Route element={<PublicOnlyRoute />}>
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Login />} />
      </Route>

      <Route path="/reset-password" element={<ResetPassword />} />


      {/* APP PROTEGIDA */}
      <Route element={<ProtectedRoute />}>
        <Route path="/discovery/evaluaciones/:assessmentId" element={<DiscoveryRunner />} />

        <Route path="/discovery/evaluaciones/:assessmentId/resultado" element={<DiscoveryResult />} />

        <Route element={<AppLayout />}>

        <Route
          path="/"
          element={<Dashboard />}
        />

        <Route
          path="/clientes"
          element={<Clients />}
        />

        <Route path="/clientes/:id" element={<ClientProfile />} />

        <Route
          path="/discovery"
          element={<DiscoveryExecution />}
        />

        <Route path="/discovery/builder" element={<CapabilityRoute capability={CAPABILITIES.accessBuilderHub}><DiscoveryBuilder /></CapabilityRoute>} />

        <Route
          path="/proyectos"
          element={<Projects />}
        />

        <Route path="/proyectos/:projectId" element={<ProjectPage />} />

        <Route
          path="/orvesen-score"
          element={<InternalOnly><Score /></InternalOnly>}
        />

        <Route path="/business-score" element={<BusinessOnly><BusinessScore /></BusinessOnly>} />

        <Route path="/configuracion" element={<SettingsHub />} />

        <Route path="/configuracion/cuenta" element={<AccountSettings />} />

        <Route path="/configuracion/empresa" element={<CapabilityRoute capability={CAPABILITIES.manageOrganization}><CompanySettings /></CapabilityRoute>} />

        <Route path="/configuracion/miembros" element={<CapabilityRoute capability={CAPABILITIES.manageMembers}><MembersSettingsPage /></CapabilityRoute>} />

        <Route path="/configuracion/divisiones" element={<CapabilityRoute capability={CAPABILITIES.manageDivisions}><DivisionsSettings /></CapabilityRoute>} />

        <Route path="/calendario" element={<Calendar />} />

        <Route path="/cerebro" element={<Brain />} />

        <Route path="/orvesen-ia" element={<Suspense fallback={<OrbRouteLoading />}><Orb /></Suspense>} />

        <Route path="/construir" element={<CapabilityRoute capability={CAPABILITIES.accessBuilderHub}><BuilderHub /></CapabilityRoute>} />

        <Route path="/score-builder" element={<CapabilityRoute capability={CAPABILITIES.accessBuilderHub}><ScoreBuilder /></CapabilityRoute>} />

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

function OrbRouteLoading() {
  return <div className="flex min-h-[50vh] items-center justify-center text-sm text-zinc-500">Cargando Orb…</div>;
}

function InternalOnly({ children }) {
  const { isInternalOrganization } = useAuth();
  return isInternalOrganization ? children : <Navigate to="/business-score" replace />;
}

function BusinessOnly({ children }) {
  const { isInternalOrganization } = useAuth();
  return isInternalOrganization ? <Navigate to="/orvesen-score" replace /> : children;
}

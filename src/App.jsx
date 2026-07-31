import { Routes, Route } from "react-router-dom";

import AppLayout from "./components/Layout/AppLayout";

import Dashboard from "./app/Dashboard";
import Clients from "./app/Clients";
import Discovery from "./app/Discovery";
import ClientProfile from "./app/ClientProfile";
import Score from "./app/Score";

import Login from "./auth/Login";
import ProtectedRoute from "./routes/ProtectedRoute";

function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />

      <Route element={<ProtectedRoute />}>
        <Route element={<AppLayout />}>
          <Route path="/" element={<Dashboard />} />
          <Route path="/clientes" element={<Clients />} />
          <Route path="/clientes/:id" element={<ClientProfile />} />
          <Route path="/discovery" element={<Discovery />} />
          <Route path="/score" element={<Score />} />
        </Route>
      </Route>
    </Routes>
  );
}

export default App;
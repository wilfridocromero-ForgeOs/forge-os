import { Routes, Route } from "react-router-dom";

import AppLayout from "./components/Layout/AppLayout";

import Dashboard from "./app/Dashboard";
import Clients from "./app/Clients";
import Discovery from "./app/Discovery";
import ClientProfile from "./app/ClientProfile";

function App() {
  return (
    <AppLayout>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/clientes" element={<Clients />} />
        <Route path="/clientes/:id" element={<ClientProfile />} />
        <Route path="/discovery" element={<Discovery />} />
      </Routes>
    </AppLayout>
  );
}

export default App;
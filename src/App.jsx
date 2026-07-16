import { Routes, Route } from "react-router-dom";

import Sidebar from "./components/Sidebar";
import Header from "./components/Header";

import Dashboard from "./pages/Dashboard";
import Clients from "./pages/Clients";
import Discovery from "./pages/Discovery";

function App() {
  return (
    <div style={{ display: "flex" }}>
      <Sidebar />

      <div
        style={{
          flex: 1,
          background: "#0B0B0B",
          minHeight: "100vh",
          color: "white",
        }}
      >
        <Header />

        <div style={{ padding: "40px" }}>
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/clientes" element={<Clients />} />
            <Route path="/discovery" element={<Discovery />} />
          </Routes>
        </div>
      </div>
    </div>
  );
}

export default App;
function Sidebar() {
  return (
    <div
      style={{
        width: "260px",
        backgroundColor: "#111",
        color: "white",
        minHeight: "100vh",
        padding: "20px",
        boxSizing: "border-box",
      }}
    >
      <h2 style={{ color: "#D4AF37" }}>🔥 Forge OS</h2>

      <hr />

      <p>🏠 Dashboard</p>
      <p>👥 Clientes</p>
      <p>🧠 Discovery</p>
      <p>📊 Forge Score</p>
      <p>📁 Proyectos</p>
      <p>📅 Calendario</p>
      <p>💰 Ventas</p>
      <p>🤖 Auren AI</p>
      <p>⚙ Configuración</p>
    </div>
  );
}

export default Sidebar;
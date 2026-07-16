function Dashboard() {
  return (
    <div>
      <h1
        style={{
          color: "#D4AF37",
          fontSize: "48px",
          marginBottom: "10px",
        }}
      >
        Dashboard
      </h1>

      <p
        style={{
          color: "#AAA",
          marginBottom: "40px",
        }}
      >
        Bienvenido nuevamente, Wilfrido.
      </p>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
          gap: "20px",
        }}
      >
        <Card
          titulo="Clientes"
          numero="0"
          color="#4CAF50"
          icono="👥"
        />

        <Card
          titulo="Proyectos"
          numero="0"
          color="#2196F3"
          icono="📁"
        />

        <Card
          titulo="Ventas"
          numero="$0"
          color="#D4AF37"
          icono="💰"
        />

        <Card
          titulo="Discovery"
          numero="0"
          color="#9C27B0"
          icono="🧠"
        />
      </div>
    </div>
  );
}

function Card({ titulo, numero, color, icono }) {
  return (
    <div
      style={{
        background: "#161616",
        borderRadius: "16px",
        padding: "25px",
        border: "1px solid #2D2D2D",
      }}
    >
      <div
        style={{
          fontSize: "35px",
          marginBottom: "15px",
        }}
      >
        {icono}
      </div>

      <h3
        style={{
          color: "#DDD",
          marginBottom: "10px",
        }}
      >
        {titulo}
      </h3>

      <h1
        style={{
          color,
          margin: 0,
        }}
      >
        {numero}
      </h1>
    </div>
  );
}

export default Dashboard;
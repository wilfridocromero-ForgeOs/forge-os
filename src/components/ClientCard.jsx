function ClientCard({ client }) {
  return (
    <div
      style={{
        background: "#171717",
        border: "1px solid #2A2A2A",
        borderRadius: "12px",
        padding: "20px",
        marginBottom: "20px",
      }}
    >
      <h2 style={{ color: "#D4AF37", margin: 0 }}>
        {client.name}
      </h2>

      <p>🏢 {client.company}</p>

      <p>📞 {client.phone}</p>

      <p>📧 {client.email}</p>

      <p>
        <strong>Estado:</strong> {client.status}
      </p>

      <div
        style={{
          display: "flex",
          gap: "10px",
          marginTop: "15px",
        }}
      >
        <button>🧠 Discovery</button>

        <button>✏ Editar</button>

        <button>🗑 Eliminar</button>
      </div>
    </div>
  );
}

export default ClientCard;
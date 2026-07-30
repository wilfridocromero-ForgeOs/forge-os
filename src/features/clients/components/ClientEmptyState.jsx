export default function ClientEmptyState() {
  return (
    <div
      style={{
        background: "#171717",
        border: "1px solid #2a2a2a",
        borderRadius: "16px",
        padding: "60px",
        textAlign: "center",
      }}
    >
      <h2
        style={{
          color: "#D4AF37",
          marginBottom: "15px",
        }}
      >
        No hay clientes
      </h2>

      <p
        style={{
          color: "#888",
          margin: 0,
        }}
      >
        Comienza creando tu primer cliente para empezar a trabajar con
        ORVESEN.
      </p>
    </div>
  );
}
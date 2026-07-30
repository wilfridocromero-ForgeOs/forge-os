export default function ClientHeader({ onNewClient }) {
  return (
    <>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "30px",
        }}
      >
        <div>
          <h1
            style={{
              color: "#D4AF37",
              marginBottom: "8px",
            }}
          >
            👥 Clientes
          </h1>

          <p
            style={{
              color: "#999",
              margin: 0,
            }}
          >
            Administra todos los clientes de ORVESEN Digital.
          </p>
        </div>

        <button
          onClick={onNewClient}
          style={{
            background: "#D4AF37",
            color: "#000",
            border: "none",
            padding: "12px 22px",
            borderRadius: "10px",
            cursor: "pointer",
            fontWeight: "bold",
            fontSize: "15px",
          }}
        >
          + Nuevo Cliente
        </button>
      </div>

      <hr
        style={{
          borderColor: "#222",
          marginBottom: "30px",
        }}
      />
    </>
  );
}
import { useParams } from "react-router-dom";

function ClientProfile() {
  const { id } = useParams();

  return (
    <div style={{ color: "#fff" }}>
      <h1
        style={{
          color: "#D4AF37",
          marginBottom: "10px",
        }}
      >
        👤 Perfil del Cliente
      </h1>

      <p style={{ color: "#888", marginBottom: "35px" }}>
        Cliente ID: {id}
      </p>

      <div
        style={{
          background: "#171717",
          border: "1px solid #2a2a2a",
          borderRadius: "18px",
          padding: "30px",
          marginBottom: "25px",
        }}
      >
        <h2 style={{ color: "#D4AF37" }}>
          Forge Score
        </h2>

        <h1
          style={{
            fontSize: "48px",
            margin: "15px 0",
          }}
        >
          0 / 1000
        </h1>

        <div
          style={{
            height: "18px",
            background: "#2a2a2a",
            borderRadius: "10px",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              width: "0%",
              height: "100%",
              background: "#D4AF37",
            }}
          />
        </div>

        <p
          style={{
            marginTop: "15px",
            color: "#999",
          }}
        >
          Todavía no se ha ejecutado Forge Discovery.
        </p>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))",
          gap: "20px",
        }}
      >
        {[
          "Forge Discovery",
          "Branding",
          "Website",
          "Marketing",
          "Automatización",
          "Ventas",
          "Finanzas",
          "IA",
        ].map((item) => (
          <div
            key={item}
            style={{
              background: "#171717",
              border: "1px solid #2a2a2a",
              borderRadius: "15px",
              padding: "25px",
            }}
          >
            <h3
              style={{
                color: "#D4AF37",
                marginBottom: "15px",
              }}
            >
              {item}
            </h3>

            <button
              style={{
                width: "100%",
                background: "#D4AF37",
                color: "#000",
                border: "none",
                padding: "12px",
                borderRadius: "10px",
                cursor: "pointer",
                fontWeight: "bold",
              }}
            >
              Abrir
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

export default ClientProfile;
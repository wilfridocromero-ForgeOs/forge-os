import { useNavigate } from "react-router-dom";

export default function ClientCard({
  client,
  onEdit,
  onDelete,
}) {
  const navigate = useNavigate();

  return (
    <div
      onClick={() => navigate(`/clientes/${client.id}`)}
      style={{
        background: "#171717",
        padding: "20px",
        borderRadius: "12px",
        marginBottom: "15px",
        border: "1px solid #2a2a2a",
        cursor: "pointer",
        transition: "0.25s",
      }}
    >
      <h2
        style={{
          color: "#D4AF37",
          marginBottom: "10px",
        }}
      >
        {client.name}
      </h2>

      <p>🏢 {client.company}</p>

      <p>📞 {client.phone || "-"}</p>

      <p>📧 {client.email || "-"}</p>

      <p>
        Estado{" "}
        <span
          style={{
            color: "#D4AF37",
          }}
        >
          {client.status || "Lead"}
        </span>
      </p>

      <div
        style={{
          display: "flex",
          gap: "10px",
          marginTop: "20px",
        }}
      >
        <button
          onClick={(e) => {
            e.stopPropagation();
            onEdit(client);
          }}
          style={{
            background: "#D4AF37",
            color: "#000",
            border: "none",
            padding: "10px 16px",
            borderRadius: "8px",
            cursor: "pointer",
            fontWeight: "bold",
          }}
        >
          ✏ Editar
        </button>

        <button
          onClick={(e) => {
            e.stopPropagation();
            onDelete(client.id);
          }}
          style={{
            background: "#8B1E1E",
            color: "#fff",
            border: "none",
            padding: "10px 16px",
            borderRadius: "8px",
            cursor: "pointer",
          }}
        >
          🗑 Eliminar
        </button>
      </div>
    </div>
  );
}
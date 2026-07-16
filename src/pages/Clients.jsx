import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

function Clients() {
  const [clients, setClients] = useState([]);

  const loadClients = async () => {
    const { data, error } = await supabase
      .from("clients")
      .select("*")
      .order("id", { ascending: true });

    if (!error) {
      setClients(data);
    }
  };

  useEffect(() => {
    loadClients();
  }, []);

  return (
    <div>
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
            Administra todos los clientes de Forge Digital.
          </p>
        </div>

        <button
          style={{
            background: "#D4AF37",
            color: "#000",
            border: "none",
            padding: "12px 22px",
            borderRadius: "10px",
            cursor: "pointer",
            fontWeight: "bold",
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

      {clients.length === 0 ? (
        <p style={{ color: "#777" }}>
          No hay clientes registrados.
        </p>
      ) : (
        <div>
          {clients.map((client) => (
            <div
              key={client.id}
              style={{
                background: "#171717",
                padding: "20px",
                borderRadius: "12px",
                marginBottom: "15px",
                border: "1px solid #2a2a2a",
              }}
            >
              <h2 style={{ color: "#D4AF37" }}>
                {client.name}
              </h2>

              <p>🏢 {client.company}</p>

              <p>📞 {client.phone}</p>

              <p>📧 {client.email}</p>

              <p>Estado: {client.status}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default Clients;
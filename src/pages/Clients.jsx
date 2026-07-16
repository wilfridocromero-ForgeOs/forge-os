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
      <h1 style={{ color: "#D4AF37" }}>👥 Clientes</h1>

      <button
        onClick={async () => {
          const name = prompt("Nombre");
          if (!name) return;

          const company = prompt("Empresa");
          const phone = prompt("Teléfono");
          const email = prompt("Email");

          await supabase.from("clients").insert([
            {
              name,
              company,
              phone,
              email,
              status: "Nuevo",
            },
          ]);

          loadClients();
        }}
        style={{
          padding: "10px 20px",
          marginBottom: "25px",
          background: "#D4AF37",
          border: "none",
          borderRadius: "8px",
          cursor: "pointer",
          fontWeight: "bold",
        }}
      >
        + Nuevo Cliente
      </button>

      <table
        style={{
          width: "100%",
          borderCollapse: "collapse",
          color: "white",
        }}
      >
        <thead>
          <tr>
            <th>Nombre</th>
            <th>Empresa</th>
            <th>Teléfono</th>
            <th>Email</th>
            <th>Status</th>
          </tr>
        </thead>

        <tbody>
          {clients.map((client) => (
            <tr key={client.id}>
              <td>{client.name}</td>
              <td>{client.company}</td>
              <td>{client.phone}</td>
              <td>{client.email}</td>
              <td>{client.status}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default Clients;
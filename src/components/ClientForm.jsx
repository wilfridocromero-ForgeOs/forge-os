import { useState } from "react";

function ClientForm({ onSave }) {
  const [form, setForm] = useState({
    name: "",
    company: "",
    phone: "",
    email: "",
  });

  const handleChange = (e) => {
    setForm({
      ...form,
      [e.target.name]: e.target.value,
    });
  };

  return (
    <div
      style={{
        background: "#161616",
        padding: "25px",
        borderRadius: "15px",
        marginBottom: "30px",
      }}
    >
      <h2 style={{ color: "#D4AF37" }}>
        Nuevo Cliente
      </h2>

      <input
        name="name"
        placeholder="Nombre"
        value={form.name}
        onChange={handleChange}
      />

      <br />
      <br />

      <input
        name="company"
        placeholder="Empresa"
        value={form.company}
        onChange={handleChange}
      />

      <br />
      <br />

      <input
        name="phone"
        placeholder="Teléfono"
        value={form.phone}
        onChange={handleChange}
      />

      <br />
      <br />

      <input
        name="email"
        placeholder="Email"
        value={form.email}
        onChange={handleChange}
      />

      <br />
      <br />

      <button
        onClick={() => onSave(form)}
      >
        Guardar Cliente
      </button>
    </div>
  );
}

export default ClientForm;
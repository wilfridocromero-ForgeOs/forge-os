const inputStyle = {
  width: "100%",
  padding: "12px 14px",
  marginBottom: "15px",
  background: "#171717",
  border: "1px solid #2a2a2a",
  borderRadius: "10px",
  color: "#fff",
  fontSize: "15px",
  outline: "none",
  boxSizing: "border-box",
};

function ClientModal({
  show,
  form,
  setForm,
  onClose,
  onSave,
  editingClient,
}) {
  if (!show) return null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,.75)",
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        zIndex: 999,
      }}
    >
      <div
        style={{
          background: "#111",
          border: "1px solid #2a2a2a",
          borderRadius: "18px",
          width: "450px",
          padding: "30px",
          boxShadow: "0 0 40px rgba(0,0,0,.6)",
        }}
      >
        <h2
          style={{
            color: "#D4AF37",
            marginBottom: "25px",
          }}
        >
          {editingClient ? "Editar Cliente" : "Nuevo Cliente"}
        </h2>

        <input
          type="text"
          placeholder="Nombre"
          value={form.name}
          onChange={(e) =>
            setForm({
              ...form,
              name: e.target.value,
            })
          }
          style={inputStyle}
        />

        <input
          type="text"
          placeholder="Empresa"
          value={form.company}
          onChange={(e) =>
            setForm({
              ...form,
              company: e.target.value,
            })
          }
          style={inputStyle}
        />

        <input
          type="text"
          placeholder="Teléfono"
          value={form.phone}
          onChange={(e) =>
            setForm({
              ...form,
              phone: e.target.value,
            })
          }
          style={inputStyle}
        />

        <input
          type="email"
          placeholder="Email"
          value={form.email}
          onChange={(e) =>
            setForm({
              ...form,
              email: e.target.value,
            })
          }
          style={inputStyle}
        />

        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            gap: "10px",
            marginTop: "25px",
          }}
        >
          <button
            onClick={onClose}
            style={{
              padding: "12px 20px",
              background: "#222",
              color: "#fff",
              border: "none",
              borderRadius: "10px",
              cursor: "pointer",
            }}
          >
            Cancelar
          </button>

          <button
            onClick={onSave}
            style={{
              padding: "12px 20px",
              background: "#D4AF37",
              color: "#000",
              border: "none",
              borderRadius: "10px",
              cursor: "pointer",
              fontWeight: "bold",
            }}
          >
            {editingClient ? "Actualizar" : "Guardar"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default ClientModal;
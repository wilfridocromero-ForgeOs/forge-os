function Modal({
  open,
  title,
  children,
  onClose,
}) {
  if (!open) return null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,.75)",
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
      }}
    >
      <div
        style={{
          background: "#171717",
          width: "500px",
          borderRadius: "15px",
          padding: "30px",
        }}
      >
        <h2
          style={{
            color: "#D4AF37",
            marginBottom: "20px",
          }}
        >
          {title}
        </h2>

        {children}
      </div>
    </div>
  );
}

export default Modal;
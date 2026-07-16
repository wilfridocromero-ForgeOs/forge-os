function Button({
  children,
  onClick,
  type = "primary",
}) {
  const styles = {
    primary: {
      background: "#D4AF37",
      color: "#000",
    },

    secondary: {
      background: "#242424",
      color: "#fff",
    },

    danger: {
      background: "#B91C1C",
      color: "#fff",
    },
  };

  return (
    <button
      onClick={onClick}
      style={{
        ...styles[type],
        border: "none",
        padding: "12px 20px",
        borderRadius: "10px",
        cursor: "pointer",
        fontWeight: "bold",
        fontSize: "15px",
      }}
    >
      {children}
    </button>
  );
}

export default Button;
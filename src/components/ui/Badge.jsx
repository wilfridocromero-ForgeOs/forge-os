function Badge({ children, color = "#16A34A" }) {
  return (
    <span
      style={{
        background: color,
        color: "white",
        padding: "5px 12px",
        borderRadius: "50px",
        fontSize: "13px",
        fontWeight: "bold",
      }}
    >
      {children}
    </span>
  );
}

export default Badge;
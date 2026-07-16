function Card({ children }) {
  return (
    <div
      style={{
        background: "#171717",
        border: "1px solid #2A2A2A",
        borderRadius: "15px",
        padding: "25px",
        marginBottom: "20px",
        boxShadow: "0 0 15px rgba(0,0,0,.25)",
      }}
    >
      {children}
    </div>
  );
}

export default Card;
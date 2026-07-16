function Header() {
  return (
    <div
      style={{
        height: "75px",
        background: "#141414",
        borderBottom: "1px solid #2C2C2C",
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        padding: "0 30px",
      }}
    >
      <h2
        style={{
          color: "#D4AF37",
          margin: 0,
        }}
      >
        Forge OS
      </h2>

      <div
        style={{
          display: "flex",
          gap: "20px",
          alignItems: "center",
          color: "white",
          fontSize: "20px",
        }}
      >
        🔔

        👤 Wilfrido
      </div>
    </div>
  );
}

export default Header;
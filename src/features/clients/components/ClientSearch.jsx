export default function ClientSearch({
  search,
  setSearch,
}) {
  return (
    <div
      style={{
        marginBottom: "25px",
      }}
    >
      <input
        type="text"
        placeholder="🔍 Buscar cliente..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        style={{
          width: "100%",
          padding: "14px 18px",
          background: "#171717",
          border: "1px solid #2a2a2a",
          borderRadius: "12px",
          color: "#fff",
          fontSize: "15px",
          outline: "none",
          boxSizing: "border-box",
        }}
      />
    </div>
  );
}
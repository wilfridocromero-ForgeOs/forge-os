function EmptyState({
  title,
  description,
}) {
  return (
    <div
      style={{
        textAlign: "center",
        padding: "60px",
        color: "#888",
      }}
    >
      <h2>{title}</h2>

      <p>{description}</p>
    </div>
  );
}

export default EmptyState;
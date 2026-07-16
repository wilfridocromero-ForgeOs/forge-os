function PageHeader({
  title,
  subtitle,
  right,
}) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        marginBottom: "30px",
      }}
    >
      <div>
        <h1
          style={{
            color: "#D4AF37",
            marginBottom: "8px",
          }}
        >
          {title}
        </h1>

        <p
          style={{
            color: "#888",
            margin: 0,
          }}
        >
          {subtitle}
        </p>
      </div>

      {right}
    </div>
  );
}

export default PageHeader;
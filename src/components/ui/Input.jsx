function Input({
  placeholder,
  value,
  onChange,
  name,
  type = "text",
}) {
  return (
    <input
      type={type}
      name={name}
      placeholder={placeholder}
      value={value}
      onChange={onChange}
      style={{
        width: "100%",
        padding: "12px",
        marginBottom: "15px",
        background: "#222",
        border: "1px solid #333",
        color: "white",
        borderRadius: "8px",
        fontSize: "15px",
        boxSizing: "border-box",
      }}
    />
  );
}

export default Input;